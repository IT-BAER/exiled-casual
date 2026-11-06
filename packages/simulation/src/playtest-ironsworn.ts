// The Ironsworn balance pilot: plays real maps in the real sim like playtest.ts, but
// chooses among ALL of the class's skills, takes a passive build on purpose, wears
// a chosen gear tier, and can shop and craft between maps. Test tooling only.
//
// The stock Bot still walks, loots, dodges and drinks; this wraps its commands and
// swaps the cast for the variant's pick. The sim checks neither the bar nor the
// class at cast time, so the pilot only casts what the variant put on the bar.
import {
  atlasGraph, atlasNodeTier, isNodeReachable, maxGemLevel, effectiveSkill, isUnlocked, canAllocate,
  passivePoints, PASSIVE_TREE, startNodeId, rollItem, waystoneRarity, xpToNext, START_LEVEL, vendorBuyPrice,
} from "@exiled/rules";
import {
  CONTENT_VERSION, ITEM_POOLS, SKILLS, isCurrency, itemStatMods, baseOf, weaponDamage, waystoneItem,
  isPermanentWaystone, WISDOM_SCROLL_BASE_ID,
} from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import { MOVE_SOCKET, type EquipSlotId } from "@exiled/protocol";
import { generateArea } from "@exiled/mapgen";
import { newCharacter } from "./playtest";
import { areaCollision } from "./areas";
import { grammarForNode } from "./systems/area-transition";
import { Bot, type BotGame as Game } from "./bot";
import { EQUIP_SLOTS_BY_CLASS } from "./equipment";
import { bodyRadiusOf } from "./body";
import { hasLineOfSight, type Collision } from "./collision";
import { recomputePlayerStats } from "./derived";
import { placeFirstFit } from "./inventory";
import type { Command } from "./loop";
import type { Entity } from "./ecs";
import type {
  SessionC, Cooldowns, FlasksC, ProgressC, SkillsC, ItemC, InventoryC, EquipmentC, Health, MonsterC,
  Mana, Position, BuffsC, DefensesC, OffenseC, VendorC,
} from "./components";

const HZ = 30;
const MAP_CAP_TICKS = 15 * 60 * HZ;
export const IRONSWORN = "class.ironsworn";
export const S = {
  strike: "skill.strike.v1", heavy: "skill.heavy_strike.v1", cry: "skill.infernal_cry.v1",
  blink: "skill.blink.v1", leap: "skill.leap_slam.v1", slam: "skill.ground_slam.v1",
  quake: "skill.earthquake.v1", det: "skill.determination.v1", sunder: "skill.sunder.v1",
  rage: "skill.blood_rage.v1",
} as const;
const REACH_MARGIN = 200; // fp(0.2), the bot's and the client's
const fp = (n: number) => Math.round(n * 1000);

export type GearTier = "starter" | "magic" | "rare" | "unique";
export type PassiveBuild = "greedy" | "none" | "offense" | "defense";

export interface Variant {
  label: string;
  /** stock: the unwrapped Bot and playtest.ts's caster refit, nothing else. */
  stock?: boolean;
  /** Skills for the six sockets, in preference order; Strike always sits in the last mouse socket. */
  bar?: string[];
  /** Cast first on a pack (3 within 2.5 of the target) or a rare/boss. */
  area?: string[];
  /** Damage skills in priority order. */
  main?: string[];
  /** Self buffs and the aura. */
  buffs?: string[];
  /** Leap used to close a gap of 3+ units. */
  gap?: boolean;
  passives?: PassiveBuild;
  /** Lab gear put on before the first map; the refit keeps going from there unless frozen. */
  gear?: GearTier;
  /** No refit at all: the gear tier is held for the whole run. */
  freezeGear?: boolean;
  /** Identify, sell, buy upgrades and spend orbs on worn gear between maps. */
  shop?: boolean;
}

export interface Job { variant: Variant; seed: number; maps: number; level: number; tier?: number }

type Kind = "normal" | "magic" | "rare" | "boss";
export interface IronRun {
  variant: string; seed: number; map: number; node: string; tier: number;
  cleared: boolean; stuck: boolean; seconds: number; deaths: number;
  /** Last hit and the biggest source over the 5 s recap window, per death. */
  killers: { last: string; top: string; topShare: number }[];
  kills: Record<Kind, number>;
  /** Seconds from a monster's first lost life to its death. */
  ttk: Record<Kind, number[]>;
  bossId: string | null; bossSeconds: number | null;
  /** Damage after mitigation that reached the player, by source ("Rare x" for rares). */
  taken: Record<string, number>;
  takenTotal: number;
  casts: Record<string, number>;
  lifeFlasks: number; manaFlasks: number;
  manaSpent: number;
  /** Seconds the pool sat under a fifth of its unreserved size. */
  lowManaSeconds: number;
  combatSeconds: number;
  levelStart: number; levelEnd: number; xpGained: number;
  drops: Record<"normal" | "magic" | "rare" | "unique" | "currency" | "waystone", number>;
  currency: Record<string, number>;
  uniques: Record<string, number>;
  gold: number;
  /** End-of-map sheet. */
  sheet: { maxLife: number; armour: number; damagePct: number; maxMana: number; passives: number; weapon: string };
  shop?: { sold: number; bought: number; goldSpent: number; orbsUsed: number; identified: number };
}

// ── Character setup ─────────────────────────────────────────────────────────

/** A character at `level` (lab lift, gems at the level's cap), with the atlas cleared below `tier`. */
export function labCharacter(seed: number, level: number, tier: number, gear: GearTier | undefined): Game {
  const g = newCharacter(IRONSWORN, seed, level);
  if (tier > 1) {
    const s = sess(g);
    const graph = atlasGraph(s.atlasSeed);
    const done = graph.filter((n) => atlasNodeTier(graph, n.id) < tier).map((n) => n.id);
    g.world.set<SessionC>(g.session, "session", { ...s, completedNodes: done });
  }
  if (gear && gear !== "starter") wearTier(g, seed, gear, tier);
  return g;
}

const SLOT_BASE: Record<string, string> = {
  helmet: "base.ironsworn_helm", body: "base.ironsworn_plate", gloves: "base.ironsworn_gauntlets",
  boots: "base.ironsworn_sabatons", belt: "base.ironsworn_girdle", amulet: "base.ironsworn_torc",
  ring1: "base.ironsworn_signet", ring2: "base.ironsworn_signet", weapon1: "base.ironsworn_hammer",
  weapon2: "base.ironsworn_tower_shield",
};

/** One item of `rarity` on `baseId`, rolled the drop's way at the tier's area level. */
export function rollOn(baseId: string, rarity: "magic" | "rare" | "unique", seed: number, ilvl: number): Item | undefined {
  for (let k = 0; k < 4000; k++) {
    const item = rollItem(ITEM_POOLS, (seed * 7919 + k * 104729) >>> 0, ilvl, 0, rarity, 0, "ironsworn");
    if (item.baseId === baseId && item.rarity === rarity) {
      const { unidentified: _u, ...read } = item;
      return read;
    }
  }
  return undefined;
}

/** Every slot of the Ironsworn set at one rarity; "unique" is the three uniques plus rares elsewhere. */
function wearTier(g: Game, seed: number, tier: GearTier, mapTier: number): void {
  const ilvl = 2 + 6 * Math.max(0, mapTier - 1);
  const slots: Record<string, Item | undefined> = { ...g.world.get<EquipmentC>(g.session, "equipment")!.slots };
  Object.entries(SLOT_BASE).forEach(([slot, baseId], i) => {
    const wantUnique = tier === "unique" && ["weapon1", "weapon2", "body"].includes(slot);
    const rarity = wantUnique ? "unique" : tier === "unique" ? "rare" : (tier as "magic" | "rare");
    const item = rollOn(baseId, rarity, seed * 31 + i, ilvl);
    if (item) slots[slot] = item;
  });
  g.world.set<EquipmentC>(g.session, "equipment", { slots });
  recomputePlayerStats(g.world, { refill: true });
}

/** The six sockets from a preference list, unlocked skills only, then Strike. */
function barFor(g: Game, prefs: readonly string[]): (string | null)[] {
  const level = progress(g).level;
  const have = prefs.filter((id) => isUnlocked(SKILLS.get(id)!, level, IRONSWORN)).slice(0, 6);
  const bar: (string | null)[] = [have[0] ?? null, have[1] ?? null, have[2] ?? null, have[3] ?? null, have[4] ?? null,
    MOVE_SOCKET, have[5] ?? null, S.strike];
  return bar;
}

// ── Passive builds ──────────────────────────────────────────────────────────

const BUILD_TARGETS: Record<"offense" | "defense", string[]> = {
  // Cinder: crit, damage, crit, cast, then Ashen Heart (+45% damage, -60 life).
  offense: ["p.cinder.1.hub", "p.cinder.0.hub", "p.cinder.2.hub", "p.keystone.ashen_heart", "p.cinder.3.hub"],
  // Stone: armour, brawn, armour, life, then Iron Skin (+80% armour).
  defense: ["p.stone.0.hub", "p.stone.1.hub", "p.stone.2.hub", "p.stone.3.hub", "p.keystone.iron_skin"],
};
const BUILD_FALLBACK: Record<"offense" | "defense", Record<string, number>> = {
  offense: { spellDamagePct: 5, critChancePct: 2, castSpeedPct: 1 },
  defense: { maxLife: 3, strength: 3, armour: 1, armourPct: 2 },
};
const NODE = new Map(PASSIVE_TREE.map((n) => [n.id, n]));

/** The next node toward the build's first unmet target, or its best-scoring neighbour once all are met. */
export function nextPassive(build: "offense" | "defense", have: readonly string[]): string | undefined {
  for (const target of BUILD_TARGETS[build]) {
    if (have.includes(target)) continue;
    if (canAllocate(IRONSWORN, have, target)) return target;
    // A notable needs more than half its minors: take the cluster's minors first.
    const goals = NODE.get(target)!.kind === "notable"
      ? PASSIVE_TREE.filter((n) => n.kind === "minor" && n.id.startsWith(target.replace(/hub$/, "")) && !have.includes(n.id)).map((n) => n.id)
      : [target];
    const step = firstStepToward(have, new Set(goals));
    if (step) return step;
  }
  const w = BUILD_FALLBACK[build];
  return PASSIVE_TREE.filter((n) => canAllocate(IRONSWORN, have, n.id))
    .map((n) => ({ id: n.id, s: n.mods.reduce((a, m) => a + (w[m.stat] ?? 0) * m.value, 0) }))
    .sort((a, b) => b.s - a.s)[0]?.id;
}

function firstStepToward(have: readonly string[], goals: ReadonlySet<string>): string | undefined {
  const owned = new Set([startNodeId(IRONSWORN), ...have]);
  const prev = new Map<string, string | null>();
  const queue: string[] = [];
  for (const id of owned) { prev.set(id, null); queue.push(id); }
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (goals.has(id) && !owned.has(id)) {
      let at = id;
      while (prev.get(at) !== null && !owned.has(prev.get(at)!)) at = prev.get(at)!;
      return canAllocate(IRONSWORN, have, at) ? at : undefined;
    }
    for (const l of NODE.get(id)?.links ?? []) {
      if (prev.has(l) || NODE.get(l)?.kind === "start") continue;
      // A notable on the way is not a door until its cluster is half taken.
      if (!goals.has(l) && NODE.get(l)?.kind !== "minor") continue;
      prev.set(l, id);
      queue.push(l);
    }
  }
  return undefined;
}

// ── The pilot ───────────────────────────────────────────────────────────────

export class Pilot {
  constructor(private readonly g: Game, private readonly bot: Bot, private readonly v: Variant,
    private readonly collision: Collision) {}

  decide(bossDead: boolean): Command[] {
    const out = this.bot.decide(bossDead);
    if (this.v.stock) return out;
    const { world, sim, player } = this.g;
    const tick = sim.tick;
    let cmds = out;
    if (this.v.passives !== "greedy") {
      cmds = cmds.filter((c) => c.type !== "allocatePassive");
      const have = sess(this.g).passives ?? [];
      if (this.v.passives !== "none" && have.length < passivePoints(progress(this.g).level)) {
        const id = nextPassive(this.v.passives ?? "offense", have);
        if (id) cmds.push({ tick, entity: player, type: "allocatePassive", passiveId: id });
      }
    }
    if (sess(this.g).dead === 1) return cmds;
    if (cmds.some((c) => c.type === "useSkill" && c.skillId === S.blink)) return cmds;
    const p = world.get<Position>(player, "position")!;
    // The Bot's own threat read: walking out of a telegraph is never overridden.
    if (this.bot["threat"](p, tick)) return cmds;

    const botCast = cmds.find((c) => c.type === "useSkill");
    let t: Entity | undefined;
    if (botCast) t = this.nearestTo(botCast.data!["tx"]!, botCast.data!["ty"]!);
    else {
      const bt = this.bot["target"];
      if (bt !== undefined && world.alive.has(bt) && world.get<MonsterC>(bt, "monster")?.state !== "idle") t = bt;
    }
    if (t === undefined) return cmds;
    const tp = world.get<Position>(t, "position")!;
    const pick = this.pick(p, t, tp) ?? botCast?.skillId;
    if (!pick) return cmds;
    const rest = cmds.filter((c) => c !== botCast && c.type !== "moveTo" && c.type !== "stop");
    rest.push({ tick, entity: player, type: "useSkill", skillId: pick, data: { tx: tp.x, ty: tp.y } });
    return rest;
  }

  private nearestTo(x: number, y: number): Entity | undefined {
    let best: Entity | undefined;
    let bd = Infinity;
    for (const e of this.g.world.query("monster", "position")) {
      const q = this.g.world.get<Position>(e, "position")!;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private onBar(id: string): boolean {
    return this.g.world.get<SkillsC>(this.g.session, "skills")!.bar.includes(id);
  }

  private eff(id: string) {
    const lvl = this.g.world.get<SkillsC>(this.g.session, "skills")!.gems[id]?.level ?? 1;
    return effectiveSkill(SKILLS.get(id)!, lvl);
  }

  private ready(id: string): boolean {
    if (!this.onBar(id)) return false;
    const { world, sim, player } = this.g;
    if ((world.get<Cooldowns>(player, "cooldowns")?.[id] ?? 0) > sim.tick) return false;
    const m = world.get<Mana>(player, "mana")!;
    const skill = this.eff(id);
    const aura = skill.effects.find((e) => e.type === "applyBuff" && e.durationTicks === 0);
    const hold = aura && aura.type === "applyBuff" ? Math.trunc((m.maxMana * (aura.reserveManaPct ?? 0)) / 100) : 0;
    return m.mana >= skill.manaCostFixed + hold;
  }

  private buffOn(buffId: string): boolean {
    const tick = this.g.sim.tick;
    return (this.g.world.get<BuffsC>(this.g.player, "buffs")?.list ?? [])
      .some((b) => b.id === buffId && (b.untilTick === 0 || b.untilTick > tick + 15));
  }

  /** How far from the target's centre this skill still lands on it. */
  private reach(id: string, r: number): number {
    const e = this.eff(id).effects[0]!;
    if (e.type === "meleeStrike") return e.reachFixed + r - REACH_MARGIN;
    if (e.type === "travel") return e.distanceFixed + Math.trunc((e.arrival?.radiusFixed ?? 0) / 2);
    if (e.type === "areaHit") {
      // Faultline: the slam cone carries it; Earthsplitter: the rolling line.
      if (id === S.quake) return fp(3.5) + r - REACH_MARGIN;
      const run = (e.maxRangeFixed ?? 0) + (e.stepFixed ?? 0) * ((e.count ?? 1) - 1);
      return Math.trunc((run + e.radiusFixed) * 0.85);
    }
    if (e.type === "applyStatus") return e.radiusFixed ?? fp(4);
    return Infinity;
  }

  private pick(p: Position, t: Entity, tp: Position): string | undefined {
    const { world } = this.g;
    const d = Math.hypot(p.x - tp.x, p.y - tp.y);
    const r = bodyRadiusOf(world, t);
    const mons = world.query("monster", "position").map((e) => ({ e, q: world.get<Position>(e, "position")!, m: world.get<MonsterC>(e, "monster")! }));
    const awakeNear = mons.filter((x) => x.m.state !== "idle" && Math.hypot(x.q.x - p.x, x.q.y - p.y) < fp(5)).length;
    const big = world.has(t, "boss") || world.get<MonsterC>(t, "monster")!.rare === 1;
    const packed = mons.filter((x) => Math.hypot(x.q.x - tp.x, x.q.y - tp.y) < fp(2.5)).length >= 3;
    const h = world.get<Health>(this.g.player, "health")!;

    for (const id of this.v.buffs ?? []) {
      if (!this.ready(id)) continue;
      if (id === S.det && !this.buffOn("determination")) return id;
      if (id === S.rage && !this.buffOn("blood_rage") && (big || awakeNear >= 2) && h.life * 10 > h.maxLife * 4) return id;
      if (id === S.cry && !this.buffOn("infernal_cry") && (big || awakeNear >= 2) && d <= this.reach(id, r)) return id;
    }
    if (this.v.gap && d >= fp(3) && this.ready(S.leap) && d <= this.reach(S.leap, r)
      && hasLineOfSight(this.collision, p.x, p.y, tp.x, tp.y, fp(0.5))) return S.leap;
    for (const id of this.v.area ?? []) {
      if ((packed || big) && this.ready(id) && d <= this.reach(id, r)) return id;
    }
    for (const id of this.v.main ?? []) {
      if (this.ready(id) && d <= this.reach(id, r)) return id;
    }
    return this.ready(S.strike) && d <= this.reach(S.strike, r) ? S.strike : undefined;
  }
}

// ── One map ─────────────────────────────────────────────────────────────────

export function playMap(g: Game, v: Variant, seed: number, mapIndex: number, labTier?: number): IronRun | null {
  const shop = v.shop ? hideout(g, v) : undefined;
  if (!v.freezeGear) refit(g, v.stock === true);
  if (!v.shop) emptyBag(g);
  if (labTier !== undefined) giveStone(g, seed, mapIndex, labTier);
  if (v.bar) g.sim.step([{ tick: g.sim.tick, type: "setSkillBar", bar: barFor(g, v.bar) }]);
  if (!openMap(g, labTier !== undefined)) return null;
  const s = sess(g);
  const layout = generateArea(s.mapSeed, CONTENT_VERSION, grammarForNode(s.activeNodeId));
  const collision = areaCollision(g.world, "map", layout);
  const bot = new Bot(g, collision, {});
  const pilot = new Pilot(g, bot, v, collision);
  const kinds: Kind[] = ["normal", "magic", "rare", "boss"];
  const run: IronRun = {
    variant: v.label, seed, map: mapIndex, node: s.activeNodeId, tier: s.areaTier,
    cleared: false, stuck: false, seconds: 0, deaths: 0, killers: [],
    kills: Object.fromEntries(kinds.map((k) => [k, 0])) as Record<Kind, number>,
    ttk: Object.fromEntries(kinds.map((k) => [k, []])) as unknown as Record<Kind, number[]>,
    bossId: null, bossSeconds: null, taken: {}, takenTotal: 0, casts: {}, lifeFlasks: 0, manaFlasks: 0,
    manaSpent: 0, lowManaSeconds: 0, combatSeconds: 0, levelStart: progress(g).level, levelEnd: 0, xpGained: 0,
    drops: { normal: 0, magic: 0, rare: 0, unique: 0, currency: 0, waystone: 0 }, currency: {}, uniques: {},
    gold: 0, sheet: { maxLife: 0, armour: 0, damagePct: 0, maxMana: 0, passives: 0, weapon: "" },
    ...(shop ? { shop } : {}),
  };
  const xpStart = totalXp(progress(g));
  const goldStart = progress(g).gold;
  const seen = new Set<Entity>(g.world.query("item"));
  const bosses = g.world.query("boss");
  run.bossId = bosses.length > 0 ? g.world.get<MonsterC>(bosses[0]!, "monster")!.defId : null;
  let bossHitAt = -1;
  const firstHit = new Map<Entity, number>();
  const kindOf = new Map<Entity, Kind>();
  let wasDead = false;
  let clearedAt = -1;
  let lastCast = -HZ;
  let lastHitTick = g.sim.tick - 1;
  const start = g.sim.tick;

  for (let t = 0; t < MAP_CAP_TICKS; t++) {
    const cds = { ...(g.world.get<Cooldowns>(g.player, "cooldowns") ?? {}) };
    const f0 = flasks(g);
    const m0 = g.world.get<Mana>(g.player, "mana")!.mana;
    g.sim.step(pilot.decide(clearedAt >= 0));
    const now = sess(g);
    if (now.area !== "map") break;

    for (const [id, until] of Object.entries(g.world.get<Cooldowns>(g.player, "cooldowns") ?? {})) {
      if (until !== cds[id]) { run.casts[id] = (run.casts[id] ?? 0) + 1; lastCast = t; }
    }
    const f1 = flasks(g);
    if (f1.life < f0.life) run.lifeFlasks++;
    if (f1.mana < f0.mana) run.manaFlasks++;
    const mana = g.world.get<Mana>(g.player, "mana")!;
    if (mana.mana < m0 - mana.regen - 1) run.manaSpent += (m0 - mana.mana) / 1000;
    if (mana.mana * 5 < mana.maxMana) run.lowManaSeconds += 1 / HZ;

    for (const hit of g.sim.recentHits) {
      if (hit.tick <= lastHitTick) continue;
      const key = `${hit.rare ? "Rare " : ""}${hit.species.replace(/^monster\.|\.v1$/g, "")}`;
      run.taken[key] = (run.taken[key] ?? 0) + hit.amount;
      run.takenTotal += hit.amount;
    }
    lastHitTick = g.sim.tick - 1;

    if (now.dead === 1 && !wasDead) {
      run.deaths++;
      const hits = g.sim.recentHits;
      const last = hits[hits.length - 1];
      const by = new Map<string, number>();
      let sum = 0;
      for (const h of hits) { const k = `${h.rare ? "Rare " : ""}${h.species}`; by.set(k, (by.get(k) ?? 0) + h.amount); sum += h.amount; }
      const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
      run.killers.push({ last: last ? `${last.rare ? "Rare " : ""}${last.species}` : "?", top: top?.[0] ?? "?", topShare: top && sum > 0 ? top[1] / sum : 0 });
    }
    wasDead = now.dead === 1;

    const alive = new Set<Entity>();
    for (const e of g.world.query("monster")) {
      alive.add(e);
      if (!kindOf.has(e)) {
        const m = g.world.get<MonsterC>(e, "monster")!;
        kindOf.set(e, g.world.has(e, "boss") ? "boss" : m.rare === 1 ? "rare" : m.magic === 1 ? "magic" : "normal");
      }
      if (!firstHit.has(e)) {
        const hl = g.world.get<Health>(e, "health");
        if (hl && hl.life < hl.maxLife) firstHit.set(e, g.sim.tick);
      }
    }
    for (const [e, kind] of kindOf) {
      if (alive.has(e)) continue;
      run.kills[kind]++;
      const at = firstHit.get(e);
      if (at !== undefined) run.ttk[kind].push((g.sim.tick - at) / HZ);
      kindOf.delete(e);
      firstHit.delete(e);
    }

    for (const e of g.world.query("item")) {
      if (seen.has(e)) continue;
      seen.add(e);
      const item = g.world.get<ItemC>(e, "item")!.item;
      if (item.waystone) run.drops.waystone++;
      else if (isCurrency(item)) { run.drops.currency++; run.currency[item.baseId] = (run.currency[item.baseId] ?? 0) + 1; }
      else {
        run.drops[item.rarity]++;
        if (item.rarity === "unique") run.uniques[item.name!] = (run.uniques[item.name!] ?? 0) + 1;
      }
    }
    if (t - lastCast < HZ) run.combatSeconds += 1 / HZ;

    if (bossHitAt < 0 && bosses.some((b) => {
      const hl = g.world.alive.has(b) ? g.world.get<Health>(b, "health") : undefined;
      return !hl || hl.life < hl.maxLife;
    })) bossHitAt = g.sim.tick;
    if (clearedAt < 0 && bosses.length > 0 && bosses.every((b) => !g.world.alive.has(b))) {
      clearedAt = g.sim.tick;
      run.cleared = true;
      run.seconds = (clearedAt - start) / HZ;
      run.bossSeconds = (clearedAt - bossHitAt) / HZ;
    }
    if (clearedAt >= 0 && (g.sim.tick - clearedAt > 60 * HZ || !bot.hasLootLeft())) break;
  }
  if (!run.cleared) {
    run.seconds = (g.sim.tick - start) / HZ;
    run.stuck = sess(g).area === "map";
  }
  run.levelEnd = progress(g).level;
  run.xpGained = totalXp(progress(g)) - xpStart;
  run.gold = progress(g).gold - goldStart;
  const h = g.world.get<Health>(g.player, "health")!;
  const w1 = g.world.get<EquipmentC>(g.session, "equipment")!.slots["weapon1"];
  run.sheet = {
    maxLife: h.maxLife / 1000,
    armour: (g.world.get<DefensesC>(g.player, "defenses")?.armour ?? 0) / 1000,
    damagePct: g.world.get<OffenseC>(g.player, "offense")?.spellDamagePct ?? 0,
    maxMana: g.world.get<Mana>(g.player, "mana")!.maxMana / 1000,
    passives: (sess(g).passives ?? []).length,
    weapon: w1 ? `${w1.rarity} ${baseOf(w1.baseId).name} ${weaponDamage(w1).physMin}-${weaponDamage(w1).physMax}` : "none",
  };
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "hideout", mapOpen: 0, dead: 0 });
  g.sim.step([]);
  return run;
}

export function campaignIron(job: Job): IronRun[] {
  const { variant: v, seed, maps, level, tier } = job;
  const g = tier !== undefined || v.gear ? labCharacter(seed, level, tier ?? 1, v.gear) : newCharacter(IRONSWORN, seed, level);
  const runs: IronRun[] = [];
  for (let i = 0; i < maps; i++) {
    const r = playMap(g, v, seed, i, tier);
    if (!r) break;
    runs.push(r);
  }
  return runs;
}

// ── Between maps ─────────────────────────────────────────────────────────────

/** playtest.ts's caster weights, kept for the stock variant so it matches the harness. */
const CASTER_WEIGHT: Record<string, number> = {
  maxLife: 1, energyShield: 1, spellDamagePct: 2, castSpeedPct: 2, critChancePct: 0.5,
  fireResPct: 0.5, coldResPct: 0.5, lightningResPct: 0.5, chaosResPct: 0.3,
  armour: 0.1, armourPct: 0.3, maxMana: 0.3, manaRegenPct: 0.3, strength: 0.3,
  allElementalResPct: 1.5, attackFireDamage: 1, attackColdDamage: 1,
};
/** What a hammer-swinger wants, per point: a point of increased damage = 1, a Life = 1. */
const IRON_WEIGHT: Record<string, number> = {
  maxLife: 1, strength: 2, energyShield: 0.8, spellDamagePct: 1, critChancePct: 0.15,
  fireResPct: 0.4, coldResPct: 0.4, lightningResPct: 0.4, chaosResPct: 0.2, allElementalResPct: 1.2,
  armour: 0.15, armourPct: 0.4, maxMana: 0.2, manaRegenPct: 0.1, castSpeedPct: 0.3,
  // A flat point on every attack is 2/16 of the starter hammer's average: 12.5% more.
  attackFireDamage: 12, attackColdDamage: 12,
};
const LOCAL_WEAPON = new Set(["physicalDamage", "physicalDamagePct", "fireDamage", "coldDamage"]);

export function ironScore(item: Item): number {
  const cls = baseOf(item.baseId).itemClass;
  const melee = cls === "mace" || cls === "sword";
  let s = 0;
  for (const m of itemStatMods(item)) {
    if (melee && LOCAL_WEAPON.has(m.stat)) continue;
    s += (IRON_WEIGHT[m.stat] ?? 0) * m.value;
  }
  if (melee) {
    const w = weaponDamage(item);
    // Percent more damage than the starter hammer (6-10 at 1.45): the hit scales by
    // the average, the beat by attacks per second.
    s += 100 * (((w.physMin + w.physMax + 2 * (w.fire + w.cold)) * w.aps) / (16 * 1.45) - 1);
  }
  return s;
}
const casterScore = (item: Item) => itemStatMods(item).reduce((a, m) => a + (CASTER_WEIGHT[m.stat] ?? 0) * m.value, 0);
/** Bows and wands scale a swing by their numbers in this sim; nobody swings a bow, so they are skipped. */
const wearable = (item: Item) => !["bow", "wand", "focus"].includes(baseOf(item.baseId).itemClass);

function refit(g: Game, stock: boolean): void {
  const score = stock ? casterScore : ironScore;
  const inv = () => g.world.get<InventoryC>(g.session, "inventory")!;
  for (const placed of [...inv().items]) {
    if (placed.item.waystone || isCurrency(placed.item)) continue;
    if (!stock && !wearable(placed.item)) continue;
    const slots = EQUIP_SLOTS_BY_CLASS[baseOf(placed.item.baseId).itemClass] ?? [];
    const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
    const slot = stock
      ? slots.find((sl) => !worn[sl] || score(placed.item) > score(worn[sl]!))
      : [...slots].sort((a, b) => (worn[a] ? score(worn[a]!) : -1e9) - (worn[b] ? score(worn[b]!) : -1e9))
        .find((sl) => !worn[sl] || score(placed.item) > score(worn[sl]!));
    if (!slot) continue;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "equipItem", slot: slot as EquipSlotId, data: { x: placed.x, y: placed.y } }]);
  }
}

/** The harness's stand-in for vendor and stash: the bag keeps stones and currency only. */
function emptyBag(g: Game): void {
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  g.world.set<InventoryC>(g.session, "inventory", { ...inv, items: inv.items.filter((p) => p.item.waystone || isCurrency(p.item)) });
}

/**
 * The hideout visit a player makes: read every unread item, wear upgrades, sell
 * the rest, buy what the shelf has that beats a worn piece, then spend the orbs on
 * worn gear (every orb here only adds a modifier, so each one is an upgrade).
 */
function hideout(g: Game, v: Variant): NonNullable<IronRun["shop"]> {
  const out = { sold: 0, bought: 0, goldSpent: 0, orbsUsed: 0, identified: 0 };
  const inv = () => g.world.get<InventoryC>(g.session, "inventory")!;
  const step = (c: Omit<Command, "tick" | "entity">) => g.sim.step([{ tick: g.sim.tick, entity: g.player, ...c }]);
  const unread = inv().items.filter((p) => p.item.unidentified).length;
  const have = inv().items.find((p) => p.item.baseId === WISDOM_SCROLL_BASE_ID)?.count ?? 0;
  const staple = g.world.get<VendorC>(g.session, "vendor")?.items.find((p) => p.item.baseId === WISDOM_SCROLL_BASE_ID);
  for (let k = have; staple && k < unread; k++) {
    const g0 = progress(g).gold;
    step({ type: "buyItem", data: { x: staple.x, y: staple.y } });
    if (progress(g).gold >= g0) break;
    out.goldSpent += g0 - progress(g).gold;
  }
  const wis = inv().items.find((p) => p.item.baseId === WISDOM_SCROLL_BASE_ID);
  if (wis && unread > 0) {
    step({ type: "applyCurrencyAll", data: { fromX: wis.x, fromY: wis.y } });
    out.identified = unread - inv().items.filter((p) => p.item.unidentified).length;
  }
  refit(g, false);
  for (const p of [...inv().items]) {
    if (p.item.waystone || isCurrency(p.item) || p.item.unidentified) continue;
    const before = inv().items.length;
    step({ type: "sellItem", data: { x: p.x, y: p.y } });
    if (inv().items.length < before) out.sold++;
  }
  for (let k = 0; k < 6; k++) {
    const shelf = g.world.get<VendorC>(g.session, "vendor")?.items ?? [];
    const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
    const gold = progress(g).gold;
    const best = shelf
      .filter((p) => !isCurrency(p.item) && wearable(p.item) && (baseOf(p.item.baseId).stats?.reqLevel ?? 1) <= progress(g).level)
      .map((p) => {
        const slots = EQUIP_SLOTS_BY_CLASS[baseOf(p.item.baseId).itemClass] ?? [];
        const gain = Math.max(...slots.map((sl) => ironScore(p.item) - (worn[sl] ? ironScore(worn[sl]!) : 0)));
        return { p, gain };
      })
      .filter((x) => x.gain > 5)
      .sort((a, b) => b.gain - a.gain)
      .find((x) => vendorBuyPrice(x.p.item) <= gold);
    if (!best) break;
    const g0 = progress(g).gold;
    step({ type: "buyItem", data: { x: best.p.x, y: best.p.y } });
    if (progress(g).gold < g0) { out.bought++; out.goldSpent += g0 - progress(g).gold; refit(g, false); } else break;
  }
  const ORBS = ["currency.alchemy", "currency.transmutation", "currency.augmentation", "currency.elevation", "currency.embers"];
  for (const orb of ORBS) {
    for (let guard = 0; guard < 40; guard++) {
      const stack = inv().items.find((p) => p.item.baseId === orb);
      if (!stack) break;
      const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
      const order = Object.keys(worn).sort((a, b) => ironScore(worn[a]!) - ironScore(worn[b]!));
      let spent = false;
      for (const slot of order) {
        const n0 = stack.count ?? 1;
        step({ type: "applyCurrency", slot: slot as EquipSlotId, data: { fromX: stack.x, fromY: stack.y } });
        const after = inv().items.find((p) => p.item.baseId === orb);
        if (!after || (after.count ?? 1) < n0) { spent = true; out.orbsUsed++; break; }
      }
      if (!spent) break;
    }
  }
  emptyBag(g);
  return out;
}

// ── Opening a map ────────────────────────────────────────────────────────────

/** A fresh plain stone of `tier` each lab map, so every lab map is that tier with no modifiers. */
function giveStone(g: Game, seed: number, mapIndex: number, tier: number): void {
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  const items = inv.items.filter((p) => !p.item.waystone || isPermanentWaystone(p.item));
  let ws = (Math.imul(seed + 1, 2654435761) ^ Math.imul(mapIndex + 1, 40503)) >>> 0;
  while (waystoneRarity(ws) !== "normal") ws = (ws + 0x9e3779b9) >>> 0;
  const at = placeFirstFit({ ...inv, items }, 1, 1);
  if (at === null) throw new Error("lab stone: bag full");
  items.push({ x: at.x, y: at.y, w: 1, h: 1, item: waystoneItem(ws, tier) });
  g.world.set<InventoryC>(g.session, "inventory", { ...inv, items });
}

function openMap(g: Game, lab: boolean): boolean {
  const s = sess(g);
  const graph = atlasGraph(s.atlasSeed);
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  const stones = inv.items.filter((p) => p.item.waystone).sort((a, b) => b.item.waystone!.tier - a.item.waystone!.tier);
  if (stones.length === 0) return false;
  const best = stones[0]!.item.waystone!.tier;
  const open = graph
    .filter((n) => isNodeReachable(graph, s.completedNodes, n.id) && atlasNodeTier(graph, n.id) <= best)
    .sort((a, b) => {
      const ca = s.completedNodes.includes(a.id) ? 1 : 0;
      const cb = s.completedNodes.includes(b.id) ? 1 : 0;
      return ca - cb || atlasNodeTier(graph, a.id) - atlasNodeTier(graph, b.id);
    });
  const node = open[0];
  if (!node) return false;
  const need = atlasNodeTier(graph, node.id);
  const stone = [...stones].reverse().find((p) => p.item.waystone!.tier >= need)!;
  // A lab stone must be the one used, or the permanent Tier 1 opens a low node.
  const use = lab && stones[0]!.item.waystone!.tier > need && stones.some((p) => !isPermanentWaystone(p.item)) ? stones[0]! : stone;
  g.sim.step([{ tick: g.sim.tick, type: "activateMap", atlasNodeId: node.id, data: { x: use.x, y: use.y } }]);
  if (sess(g).mapOpen !== 1) return false;
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "map" });
  g.sim.step([]);
  return sess(g).area === "map";
}

// ── Small readers ───────────────────────────────────────────────────────────

function sess(g: Game): SessionC { return g.world.get<SessionC>(g.session, "session")!; }
function progress(g: Game): ProgressC { return g.world.get<ProgressC>(g.session, "progress")!; }
function flasks(g: Game): { life: number; mana: number } {
  const f = g.world.get<FlasksC>(g.player, "flasks");
  return { life: f?.lifeCharges ?? 0, mana: f?.manaCharges ?? 0 };
}
function totalXp(p: ProgressC): number {
  let s = p.xp;
  for (let l = START_LEVEL; l < p.level; l++) s += xpToNext(l);
  return s;
}
