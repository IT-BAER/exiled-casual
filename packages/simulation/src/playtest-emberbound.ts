// Emberbound coverage playtest: every skill, passive build and gear tier the class can
// use, played headless on real generated maps and measured for the balance pass.
//
// Test tooling only, like playtest.ts, and built on it: the shared Bot still walks,
// targets, dodges, drinks and loots. What it cannot do is cast anything but its fixed
// four skills (SIGNATURE, AREA, the free attack, Blink), allocate by anything but its
// own weights, or shop. This file swaps those decisions per Bot INSTANCE (pickSkill
// and passives), so no shared file changes. Shortcuts are named where they happen:
// a fixed loadout is dressed straight into the equipment component, as the lab does.
import { toNumber } from "@exiled/fixed-point";
import {
  atlasGraph, atlasNodeTier, isNodeReachable, areaLevel, canAllocate, passivePoints, PASSIVE_TREE,
  startNodeId, rollItem, effectiveSkill, vendorBuyPrice,
} from "@exiled/rules";
import {
  CONTENT_VERSION, SKILLS, ITEM_POOLS, baseOf, isCurrency, itemStatMods, waystoneItem,
  WISDOM_SCROLL_BASE_ID, canonicalBaseId,
} from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import type { EquipSlotId } from "@exiled/protocol";
import { MOUSE_SLOT_BASE, MOVE_SOCKET, SKILL_SLOT_COUNT } from "@exiled/protocol";
import { generateArea } from "@exiled/mapgen";
import { areaCollision } from "./areas";
import { grammarForNode } from "./systems/area-transition";
import { Bot, type BotGame as Game } from "./bot";
import { newCharacter } from "./playtest";
import { EQUIP_SLOTS_BY_CLASS } from "./equipment";
import { recomputePlayerStats } from "./derived";
import { spawnLabActors } from "./combat-sim";
import { damageTypeOf } from "./damage-types";
import { activeBuffs, activeStatuses } from "./status";
import type { Command } from "./loop";
import type { Entity } from "./ecs";
import type {
  SessionC, Cooldowns, FlasksC, ProgressC, SkillsC, ItemC, InventoryC, EquipmentC, Health, MonsterC,
  Position, Mana, GroundAreaC, ProjectileC, SkillAreaC, VendorC, DefensesC, OffenseC, EnergyShieldC,
} from "./components";

const HZ = 30;
const MAP_CAP_TICKS = 15 * 60 * HZ;
export const EMBER = "class.emberbound";

export const SK = {
  spark: "skill.ember_spark.v1",
  bolt: "skill.ember_bolt.v1",
  dash: "skill.flame_dash.v1",
  blink: "skill.blink.v1",
  nova: "skill.ember_nova.v1",
  cinder: "skill.cinder_ground.v1",
  hex: "skill.flammability.v1",
  orb: "skill.solar_orb.v1",
  storm: "skill.firestorm.v1",
  herald: "skill.herald_of_ash.v1",
} as const;

// ── What a variant is ───────────────────────────────────────────────────────

/**
 * How the coverage bot fights. `stock` leaves the shared bot's own picks alone, so
 * a stock run is exactly `campaign()` with more meters on it.
 */
export interface Policy {
  stock?: boolean;
  /** The shared bot's ablation list, for stock runs. */
  without?: string[];
  /** Tried on every target, in order, while ready and in reach. The free attack comes last. */
  main?: string[];
  /** Tried first on a pack (three within 2.5 of the target) or a rare or boss. */
  aoe?: string[];
  /** Kindling Hex on a pack or a big target that is not already cursed. */
  hex?: boolean;
  /** Mantle of Embers switched on whenever it is off and the pool can hold it. */
  herald?: boolean;
  /** Blaze Step as travel: any walk of 5+ units while mana is above half. */
  dash?: boolean;
  /** Blink as travel, the same rule as `dash` (the shared bot only blinks below 35% life). */
  blinkTravel?: boolean;
  /** Blaze Step through a pack in reach, as a damage skill (the "dash main" variant). */
  dashAttack?: boolean;
  /** Ember Nova main: with Nova ready and the target out of its ring, walk in. */
  walkIn?: boolean;
  /** Keep Blink on the bar for the shared bot's low-life escape. Default true. */
  blink?: boolean;
  /** Natural campaign: re-pick the bar from this priority list at every map as skills unlock. */
  priority?: string[];
}

export type GearTier = "start" | "normal" | "magic" | "rare" | "unique";

export interface Build {
  label: string;
  /** Value per point of a stat; a node scores the sum. Absent = the shared bot's own weights. */
  weights?: Record<string, number>;
  /** A keystone walked to first, by the shortest legal route. */
  keystone?: string;
  /** No points spent at all (control). */
  none?: boolean;
}

export interface Job {
  variant: string;
  /** Only for stock parity runs of the other two classes; everything else is Emberbound. */
  classId?: string;
  seed: number;
  maps: number;
  /** Start level; gems sit at the level's cap, as newCharacter does. 1 = a fresh character. */
  level: number;
  /** Fixed map tier: a fresh tier-T stone before every map. Absent = climb on dropped stones. */
  tier?: number;
  policy: Policy;
  build?: Build;
  /** A fixed loadout. Absent = whatever drops, worn by the refit between maps. */
  gear?: GearTier;
  /** Between maps: identify, sell, and buy upgrades from the vendor. */
  vendor?: boolean;
  novice?: boolean;
  /** Stop a campaign after this many uncleared maps in a row. */
  stopAfterFails?: number;
}

export interface EmberRun {
  variant: string;
  seed: number;
  map: number;
  node: string;
  tier: number;
  areaLevel: number;
  cleared: boolean;
  stuck: boolean;
  seconds: number;
  deaths: number;
  killers: string[];
  kills: number;
  killsByKind: Record<Kind, number>;
  /** Seconds from a monster's first lost life to its death, per kind, 0.1 s precision. */
  ttk: Record<Kind, number[]>;
  combatSeconds: number;
  levelStart: number;
  levelEnd: number;
  casts: Record<string, number>;
  /** Mana paid for casts, at each cast's effective cost. */
  manaSpent: number;
  /** Seconds with mana below the cheapest mana skill the bot leads with. */
  manaDrySec: number;
  lifeFlasks: number;
  manaFlasks: number;
  /** Damage that landed on him (after armour and resistance, before energy shield), by source. */
  taken: Record<string, number>;
  takenByType: Record<string, number>;
  /** Damage he sent at monsters before their mitigation, by skill; DoT ticks by ailment. */
  dealt: Record<string, number>;
  drops: Record<"normal" | "magic" | "rare" | "unique" | "currency" | "waystone", number>;
  currency: Record<string, number>;
  uniques: Record<string, number>;
  gold: number;
  goldSpent: number;
  bought: number;
  bossId: string | null;
  bossSeconds: number | null;
  /** End-of-map snapshot of the character. */
  gems: Record<string, number>;
  passives: number;
  stats: { maxLife: number; maxMana: number; es: number; armour: number; res: Record<string, number>; spellDamagePct: number; castSpeedPct: number; critChancePct: number };
}

type Kind = "normal" | "magic" | "rare" | "boss";

// ── Running a job ───────────────────────────────────────────────────────────

/** A job's campaign: one character, `maps` maps in a row, levels and gems carried. */
export function runJob(job: Job): EmberRun[] {
  const g = newCharacter(job.classId ?? EMBER, job.seed, job.level);
  if (job.gear && job.gear !== "start") dress(g, job.gear, areaLevel(job.tier ?? 1) + 2, job.seed);
  const runs: EmberRun[] = [];
  let fails = 0;
  for (let i = 0; i < job.maps; i++) {
    const r = playMap(g, job, i);
    if (!r) break;
    runs.push(r);
    fails = r.cleared ? 0 : fails + 1;
    if (job.stopAfterFails && fails >= job.stopAfterFails) break;
  }
  return runs;
}

function playMap(g: Game, job: Job, index: number): EmberRun | null {
  const visit = hideoutVisit(g, job);
  setBar(g, job.policy);
  if (job.tier !== undefined) stockStone(g, job.tier, job.seed, index);
  if (!openMap(g)) return null;
  const s = sess(g);
  const layout = generateArea(s.mapSeed, CONTENT_VERSION, grammarForNode(s.activeNodeId));
  const collision = areaCollision(g.world, "map", layout);
  const bot = new Bot(g, collision, { without: job.policy.without ?? [], novice: job.novice ?? false });
  const ctl = new Controller(g, bot, job);

  const run: EmberRun = {
    variant: job.variant, seed: job.seed, map: index + 1, node: s.activeNodeId, tier: s.areaTier,
    areaLevel: areaLevel(s.areaTier), cleared: false, stuck: false, seconds: 0, deaths: 0, killers: [],
    kills: 0, killsByKind: { normal: 0, magic: 0, rare: 0, boss: 0 }, ttk: { normal: [], magic: [], rare: [], boss: [] },
    combatSeconds: 0, levelStart: progress(g).level, levelEnd: 0, casts: {}, manaSpent: 0, manaDrySec: 0,
    lifeFlasks: 0, manaFlasks: 0, taken: {}, takenByType: {}, dealt: {},
    drops: { normal: 0, magic: 0, rare: 0, unique: 0, currency: 0, waystone: 0 }, currency: {}, uniques: {},
    gold: 0, goldSpent: visit.goldSpent, bought: visit.bought, bossId: null, bossSeconds: null,
    gems: {}, passives: 0, stats: snapshot(g),
  };
  const goldStart = progress(g).gold;
  const seenItems = new Set<Entity>(g.world.query("item"));
  const bosses = g.world.query("boss");
  run.bossId = bosses.length > 0 ? g.world.get<MonsterC>(bosses[0]!, "monster")!.defId : null;
  let bossHitAt = -1;
  let monsters = new Map<Entity, Kind>(g.world.query("monster").map((m) => [m, kindOf(g, m)]));
  const firstHit = new Map<Entity, number>();
  let wasDead = false;
  let clearedAt = -1;
  let lastCast = -HZ;
  const start = g.sim.tick;
  const dryAt = ctl.dryThreshold();
  const unhook = hookDealt(g, run.dealt);

  try {
    for (let t = 0; t < MAP_CAP_TICKS; t++) {
      const before = { cds: { ...cooldowns(g) }, f: flasks(g), mana: mana(g) };
      const stepTick = g.sim.tick;
      const cmds = ctl.decide(clearedAt >= 0);
      g.sim.step(cmds);
      const now = sess(g);
      if (now.area !== "map") break;

      for (const [id, until] of Object.entries(cooldowns(g))) {
        if (until !== before.cds[id]) {
          run.casts[id] = (run.casts[id] ?? 0) + 1;
          lastCast = t;
          const def = SKILLS.get(id);
          if (def) run.manaSpent += toNumber(effectiveSkill(def, gemLevel(g, id)).manaCostFixed);
        }
      }
      const f = flasks(g);
      if (f.life < before.f.life) run.lifeFlasks++;
      if (f.mana < before.f.mana) run.manaFlasks++;
      if (mana(g) < dryAt) run.manaDrySec += 1 / HZ;
      if (now.dead === 1 && !wasDead) {
        run.deaths++;
        const kb = g.sim.recentHits[g.sim.recentHits.length - 1];
        if (kb) run.killers.push(`${kb.rare ? "Rare " : ""}${kb.species}`);
      }
      wasDead = now.dead === 1;
      for (const h of g.sim.recentHits) {
        if (h.tick !== stepTick) continue;
        // An empty species is a shot whose shooter died before it landed.
        const who = `${h.rare ? "Rare " : ""}${h.species || "dead shooter"}`;
        run.taken[who] = (run.taken[who] ?? 0) + h.amount;
        const ty = damageTypeOf(h.type);
        run.takenByType[ty] = (run.takenByType[ty] ?? 0) + h.amount;
      }

      const alive = new Map<Entity, Kind>();
      for (const m of g.world.query("monster")) {
        alive.set(m, monsters.get(m) ?? kindOf(g, m));
        if (!firstHit.has(m)) {
          const h = g.world.get<Health>(m, "health");
          if (h && h.life < h.maxLife) firstHit.set(m, g.sim.tick);
        }
      }
      for (const [m, kind] of monsters) {
        if (alive.has(m)) continue;
        run.kills++;
        run.killsByKind[kind]++;
        const at = firstHit.get(m);
        if (at !== undefined) run.ttk[kind].push(Math.round(((g.sim.tick - at) / HZ) * 10) / 10);
      }
      monsters = alive;

      for (const e of g.world.query("item")) {
        if (seenItems.has(e)) continue;
        seenItems.add(e);
        const ic = g.world.get<ItemC>(e, "item")!;
        const item = ic.item;
        if (item.waystone) run.drops.waystone++;
        else if (isCurrency(item)) {
          run.drops.currency += ic.count ?? 1;
          const id = canonicalBaseId(item.baseId);
          run.currency[id] = (run.currency[id] ?? 0) + (ic.count ?? 1);
        } else {
          run.drops[item.rarity]++;
          if (item.rarity === "unique") run.uniques[item.name!] = (run.uniques[item.name!] ?? 0) + 1;
        }
      }
      if (t - lastCast < HZ) run.combatSeconds += 1 / HZ;

      if (bossHitAt < 0 && bosses.some((b) => {
        const h = g.world.alive.has(b) ? g.world.get<Health>(b, "health") : undefined;
        return !h || h.life < h.maxLife;
      })) bossHitAt = g.sim.tick;
      if (clearedAt < 0 && bosses.length > 0 && bosses.every((b) => !g.world.alive.has(b))) {
        clearedAt = g.sim.tick;
        run.cleared = true;
        run.seconds = (clearedAt - start) / HZ;
        run.bossSeconds = (clearedAt - bossHitAt) / HZ;
      }
      if (clearedAt >= 0 && (g.sim.tick - clearedAt > 60 * HZ || !bot.hasLootLeft())) break;
    }
  } finally {
    unhook();
  }
  if (!run.cleared) {
    run.seconds = (g.sim.tick - start) / HZ;
    run.stuck = sess(g).area === "map";
  }
  run.levelEnd = progress(g).level;
  run.gold = progress(g).gold - goldStart;
  const sk = g.world.get<SkillsC>(g.session, "skills")!;
  run.gems = Object.fromEntries(Object.values(SK).filter((id) => sk.gems[id]).map((id) => [id, sk.gems[id]!.level]));
  run.passives = (sess(g).passives ?? []).length;
  run.stats = snapshot(g);
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "hideout", mapOpen: 0, dead: 0 });
  g.sim.step([]);
  return run;
}

// ── The fight policy, on top of the shared bot ──────────────────────────────

interface Target { e: Entity; p: Position }
type Cmd = (c: Omit<Command, "tick" | "entity">) => Command;
/** The two shared-bot decisions this file replaces, by name, on one instance. */
interface BotHooks {
  pickSkill(p: Position, t: Target): string | undefined;
  passives(out: Command[], cmd: Cmd): void;
}

class Controller {
  private readonly pol: Policy;
  constructor(private readonly g: Game, private readonly bot: Bot, private readonly job: Job) {
    this.pol = job.policy;
    const hooks = bot as unknown as BotHooks;
    if (!this.pol.stock) hooks.pickSkill = (p, t) => this.pickSkill(p, t);
    if (job.build) {
      const build = job.build;
      hooks.passives = (out, cmd) => {
        if (build.none) return;
        const have = sess(g).passives ?? [];
        if (have.length >= passivePoints(progress(g).level)) return;
        const next = nextPassive(EMBER, have, build);
        if (next) out.push(cmd({ type: "allocatePassive", passiveId: next }));
      };
    }
  }

  /** Mana below which the lead skill cannot be cast. */
  dryThreshold(): number {
    const lead = this.pol.stock ? SK.bolt : ([...(this.pol.main ?? []), ...(this.pol.aoe ?? [])].find((id) => id !== SK.spark) ?? SK.bolt);
    return effectiveSkill(SKILLS.get(lead)!, gemLevel(this.g, lead)).manaCostFixed;
  }

  decide(bossDead: boolean): Command[] {
    const out = this.bot.decide(bossDead);
    if (this.pol.stock) return out;
    const { world, player } = this.g;
    const tick = this.g.sim.tick;
    if (sess(this.g).dead === 1) return out;
    const casting = out.some((c) => c.type === "useSkill");
    const p = world.get<Position>(player, "position")!;
    if (!casting && this.pol.herald && this.ready(SK.herald)
      && !activeBuffs(world, player, tick).some((b) => b.skillId === SK.herald)) {
      out.push({ tick, entity: player, type: "useSkill", skillId: SK.herald, data: { tx: p.x + 1000, ty: p.y } });
      return out;
    }
    const travel = this.pol.dash ? SK.dash : this.pol.blinkTravel ? SK.blink : undefined;
    if (!casting && travel && this.ready(travel)) {
      const m = world.get<Mana>(player, "mana")!;
      const walk = out.find((c) => c.type === "moveTo");
      if (walk && m.mana * 2 > m.maxMana) {
        const to = { x: walk.data!["x"]!, y: walk.data!["y"]! };
        if (dist(p, to) >= 5000) out.push({ tick, entity: player, type: "useSkill", skillId: travel, data: { tx: to.x, ty: to.y } });
      }
    }
    return out;
  }

  private pickSkill(p: Position, t: Target): string | undefined {
    const w = this.g.world;
    const d = dist(p, t.p);
    const packed = w.query("monster", "position").filter((m) => dist(t.p, w.get<Position>(m, "position")!) < 2500).length >= 3;
    const big = w.has(t.e, "boss") || w.get<MonsterC>(t.e, "monster")!.rare === 1;
    if (this.pol.hex && (packed || big) && this.ready(SK.hex) && d <= this.range(SK.hex)
      && !activeStatuses(w, t.e, this.g.sim.tick).some((s) => s.id === "flammable")) return SK.hex;
    if (packed || big) for (const id of this.pol.aoe ?? []) if (this.fits(id, p, t, d, packed)) return id;
    for (const id of this.pol.main ?? []) if (this.fits(id, p, t, d, packed)) return id;
    // Nova main: walk into the ring while it is up; the free attack covers the cooldown.
    if (this.pol.walkIn && this.ready(SK.nova) && d > this.novaReach(t)) return undefined;
    return this.onBar(SK.spark) && d <= this.range(SK.spark) ? SK.spark : undefined;
  }

  private fits(id: string, p: Position, t: Target, d: number, packed: boolean): boolean {
    if (!this.ready(id)) return false;
    const w = this.g.world;
    switch (id) {
      case SK.nova: return d <= this.novaReach(t);
      case SK.cinder:
        // A second field on a burning target is mana for nothing (the shared bot's rule).
        return !w.query("groundArea", "position").some((e) => {
          const a = w.get<GroundAreaC>(e, "groundArea")!;
          return a.team === 0 && a.skillId === SK.cinder && dist(t.p, w.get<Position>(e, "position")!) < a.radius;
        });
      case SK.dash: return this.pol.dashAttack === true && packed && d <= this.range(SK.dash);
      case SK.herald: return false;
      default: return d <= this.range(id);
    }
  }

  private novaReach(t: Target): number {
    const e = effectiveSkill(SKILLS.get(SK.nova)!, gemLevel(this.g, SK.nova)).effects[0]!;
    const r = e.type === "areaHit" ? e.radiusFixed : 3000;
    return r + bodyOf(this.g, t.e) - 300;
  }

  /** How far the skill reaches at his gem level; ground skills land where aimed. */
  private range(id: string): number {
    const e = effectiveSkill(SKILLS.get(id)!, gemLevel(this.g, id)).effects[0]!;
    if (e.type === "spawnProjectile") return Math.trunc(e.maxRangeFixed * 0.9);
    if ((e.type === "areaHit" || e.type === "applyStatus") && e.maxRangeFixed !== undefined) return e.maxRangeFixed;
    if (e.type === "travel") return e.distanceFixed;
    return 14000;
  }

  private onBar(id: string): boolean {
    const s = this.g.world.get<SkillsC>(this.g.session, "skills");
    return !!s && s.bar.includes(id);
  }

  /** Off cooldown, on the bar, and payable at its EFFECTIVE (gem-scaled) cost. */
  ready(id: string): boolean {
    if (!this.onBar(id)) return false;
    const cd = cooldowns(this.g)[id] ?? 0;
    const cost = effectiveSkill(SKILLS.get(id)!, gemLevel(this.g, id)).manaCostFixed;
    return cd <= this.g.sim.tick && mana(this.g) >= cost;
  }
}

/** The skills a policy fights with, and the bar that holds them. */
export function kitOf(pol: Policy, level: number): string[] {
  if (pol.priority) {
    const open = pol.priority.filter((id) => SKILLS.get(id)!.unlockLevel <= level);
    return open.slice(0, MOUSE_SLOT_BASE + 1);
  }
  const ids = new Set<string>([...(pol.main ?? []), ...(pol.aoe ?? [])]);
  if (pol.hex) ids.add(SK.hex);
  if (pol.herald) ids.add(SK.herald);
  if (pol.dash || pol.dashAttack) ids.add(SK.dash);
  if (pol.blink !== false) ids.add(SK.blink);
  ids.delete(SK.spark);
  return [...ids];
}

function setBar(g: Game, pol: Policy): void {
  if (pol.stock) return;
  const level = progress(g).level;
  const kit = kitOf(pol, level).filter((id) => SKILLS.get(id)!.unlockLevel <= level);
  // Five numbered sockets, the free mouse socket, move on the left button, the free attack on the right.
  const bar: (string | null)[] = new Array(SKILL_SLOT_COUNT).fill(null);
  const free = [0, 1, 2, 3, 4, MOUSE_SLOT_BASE + 1];
  kit.slice(0, free.length).forEach((id, i) => { bar[free[i]!] = id; });
  bar[MOUSE_SLOT_BASE] = MOVE_SOCKET;
  bar[MOUSE_SLOT_BASE + 2] = SK.spark;
  g.sim.step([{ tick: g.sim.tick, type: "setSkillBar", bar }]);
}

// ── Passive builds ──────────────────────────────────────────────────────────

/** The shared bot's own weights (bot.ts PASSIVE_WEIGHT; anything unlisted worth 1, notables x3). */
const STOCK_PASSIVE_WEIGHT: Record<string, number> = { spellDamagePct: 3, castSpeedPct: 3, maxLife: 3, critChancePct: 2, manaRegenPct: 2 };

function nodeScore(n: (typeof PASSIVE_TREE)[number], w: Record<string, number>): number {
  return n.mods.reduce((a, m) => a + (w[m.stat] ?? 0) * m.value, 0);
}

/**
 * The next node a build takes: on the way to its keystone first, then the best node
 * it can take now, then one step toward the nearest node worth anything to it.
 */
export function nextPassive(classId: string, have: readonly string[], build: Build): string | undefined {
  if (!build.weights) {
    const pick = PASSIVE_TREE.filter((n) => canAllocate(classId, have, n.id))
      .map((n) => ({ n, s: n.mods.reduce((a, m) => a + (STOCK_PASSIVE_WEIGHT[m.stat] ?? 1), 0) * (n.kind === "notable" ? 3 : 1) }))
      .sort((a, b) => b.s - a.s)[0];
    return pick?.n.id;
  }
  const w = build.weights;
  if (build.keystone && !have.includes(build.keystone)) {
    const step = stepToward(classId, have, (id) => id === build.keystone);
    if (step) return step;
  }
  const open = PASSIVE_TREE.filter((n) => canAllocate(classId, have, n.id))
    .map((n) => ({ id: n.id, s: nodeScore(n, w) }))
    .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
  if (open[0] && open[0].s > 0) return open[0].id;
  return stepToward(classId, have, (id) => {
    const n = PASSIVE_TREE.find((x) => x.id === id)!;
    return n.kind !== "keystone" && nodeScore(n, w) > 0;
  }) ?? open[0]?.id;
}

/** First node of the shortest route (minors and keystones only) to a node `goal` accepts. */
function stepToward(classId: string, have: readonly string[], goal: (id: string) => boolean): string | undefined {
  const byId = new Map(PASSIVE_TREE.map((n) => [n.id, n]));
  const start = startNodeId(classId);
  const roots = PASSIVE_TREE.filter((n) => n.kind !== "notable" && canAllocate(classId, have, n.id)).map((n) => n.id).sort();
  const root = new Map<string, string>(roots.map((r) => [r, r]));
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (goal(id)) return root.get(id);
    for (const l of [...byId.get(id)!.links].sort()) {
      const n = byId.get(l)!;
      if (root.has(l) || have.includes(l) || l === start || n.kind === "notable" || n.kind === "start") continue;
      root.set(l, root.get(id)!);
      queue.push(l);
    }
  }
  return undefined;
}

/** Points from the class door to a keystone, by stepToward's route. */
export function keystoneCost(classId: string, keystone: string): number {
  const have: string[] = [];
  for (let i = 0; i < 200 && !have.includes(keystone); i++) {
    const s = stepToward(classId, have, (id) => id === keystone);
    if (!s) return -1;
    have.push(s);
  }
  return have.length;
}

// ── Gear ────────────────────────────────────────────────────────────────────

const LOADOUT: readonly [EquipSlotId, string][] = [
  ["helmet", "base.ember_cowl"], ["body", "base.ember_robe"], ["gloves", "base.ember_wraps"],
  ["boots", "base.ember_slippers"], ["belt", "base.ember_sash"], ["weapon1", "base.ember_wand"],
  ["weapon2", "base.ember_focus"], ["amulet", "base.ember_pendant"], ["ring1", "base.ember_loop"], ["ring2", "base.ember_loop"],
];

/**
 * A full Ember loadout at one rarity, read, dressed straight into the equipment
 * component as the lab does. "unique" wears the three Ember uniques (Ashmaw,
 * Emberchoir, Cinderveil) and rares everywhere else. The Ember Wand needs level 8;
 * below it the Kindling Wand stands in.
 */
export function dress(g: Game, tier: GearTier, ilvl: number, seed: number): void {
  const level = progress(g).level;
  const slots: Record<string, Item> = {};
  LOADOUT.forEach(([slot, baseId], i) => {
    const id = slot === "weapon1" && level < 8 ? "base.ember_kindling_wand" : baseId;
    const unique = tier === "unique" ? (ITEM_POOLS.uniques ?? []).find((u) => u.baseId === id) : undefined;
    const pools = { bases: [baseOf(id)], affixes: ITEM_POOLS.affixes, uniques: unique ? [unique] : [] };
    const rarity = tier === "unique" ? (unique ? "unique" : "rare") : tier === "start" ? "normal" : tier;
    const item = rollItem(pools, (Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0, ilvl, 0, rarity);
    delete item.unidentified;
    slots[slot] = item;
  });
  g.world.set<EquipmentC>(g.session, "equipment", { slots });
  recomputePlayerStats(g.world, { refill: true });
}

/** playtest.ts's caster scorer (STAT_WEIGHT), and the flat spell fire it leaves out. */
const STOCK_STAT_WEIGHT: Record<string, number> = {
  maxLife: 1, energyShield: 1, spellDamagePct: 2, castSpeedPct: 2, critChancePct: 0.5,
  fireResPct: 0.5, coldResPct: 0.5, lightningResPct: 0.5, chaosResPct: 0.3,
  armour: 0.1, armourPct: 0.3, maxMana: 0.3, manaRegenPct: 0.3, strength: 0.3,
  allElementalResPct: 1.5, attackFireDamage: 1, attackColdDamage: 1,
};
const EMBER_STAT_WEIGHT: Record<string, number> = { ...STOCK_STAT_WEIGHT, fireDamage: 2, coldDamage: 1.5, energyShieldPct: 0.5 };
const score = (item: Item, w: Record<string, number>) => itemStatMods(item).reduce((a, m) => a + (w[m.stat] ?? 0) * m.value, 0);

/**
 * Between maps. A fixed loadout is left alone; otherwise wear every upgrade in the bag
 * (playtest.ts's refit, through the real equipItem). With `vendor`, read unread drops
 * with Wisdom, sell the rest and buy shelf upgrades; without it the bag is emptied of
 * equipment, which is what playtest.ts does.
 */
function hideoutVisit(g: Game, job: Job): { goldSpent: number; bought: number } {
  const res = { goldSpent: 0, bought: 0 };
  if (job.gear) return res;
  const w = job.policy.stock ? STOCK_STAT_WEIGHT : EMBER_STAT_WEIGHT;
  const inv = () => g.world.get<InventoryC>(g.session, "inventory")!;
  const step = (c: Omit<Command, "tick" | "entity">) => g.sim.step([{ tick: g.sim.tick, entity: g.player, ...c }]);
  const equipment = (p: { item: Item }) => !p.item.waystone && !isCurrency(p.item);
  if (job.vendor) {
    for (;;) {
      const unread = inv().items.find((p) => equipment(p) && p.item.unidentified === true);
      if (!unread) break;
      let scroll = inv().items.find((p) => canonicalBaseId(p.item.baseId) === WISDOM_SCROLL_BASE_ID);
      if (!scroll) {
        const shelf = g.world.get<VendorC>(g.session, "vendor")!;
        const cell = shelf.items.find((p) => p.item.baseId === WISDOM_SCROLL_BASE_ID);
        if (!cell || progress(g).gold < vendorBuyPrice(cell.item)) break;
        const gold = progress(g).gold;
        step({ type: "buyItem", data: { x: cell.x, y: cell.y } });
        res.goldSpent += gold - progress(g).gold;
        scroll = inv().items.find((p) => canonicalBaseId(p.item.baseId) === WISDOM_SCROLL_BASE_ID);
        if (!scroll) break;
      }
      const n = inv().items.length;
      step({ type: "applyCurrency", data: { fromX: scroll.x, fromY: scroll.y, x: unread.x, y: unread.y } });
      if (inv().items.find((p) => p.x === unread.x && p.y === unread.y)?.item.unidentified === true && inv().items.length === n) break;
    }
  }
  const wearUpgrades = () => {
    for (const placed of [...inv().items]) {
      if (!equipment(placed)) continue;
      const slots = EQUIP_SLOTS_BY_CLASS[baseOf(placed.item.baseId).itemClass] ?? [];
      const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
      const slot = slots.find((sl) => !worn[sl] || score(placed.item, w) > score(worn[sl]!, w));
      if (!slot) continue;
      step({ type: "equipItem", slot: slot as EquipSlotId, data: { x: placed.x, y: placed.y } });
    }
  };
  wearUpgrades();
  if (job.vendor) {
    for (const placed of [...inv().items]) if (equipment(placed)) step({ type: "sellItem", data: { x: placed.x, y: placed.y } });
    // Best gain per gold first, re-read after every purchase.
    for (let guard = 0; guard < 12; guard++) {
      const shelf = g.world.get<VendorC>(g.session, "vendor")!;
      const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
      const level = progress(g).level;
      const offers = shelf.items.filter((p) => equipment(p) && (baseOf(p.item.baseId).stats?.reqLevel ?? 1) <= level)
        .map((p) => {
          const slots = EQUIP_SLOTS_BY_CLASS[baseOf(p.item.baseId).itemClass] ?? [];
          const gain = Math.max(-Infinity, ...slots.map((sl) => score(p.item, w) - (worn[sl] ? score(worn[sl]!, w) : 0)));
          return { p, gain, price: vendorBuyPrice(p.item) };
        })
        .filter((o) => o.gain > 0 && o.price <= progress(g).gold)
        .sort((a, b) => b.gain / Math.max(1, b.price) - a.gain / Math.max(1, a.price));
      const best = offers[0];
      if (!best) break;
      const gold = progress(g).gold;
      step({ type: "buyItem", data: { x: best.p.x, y: best.p.y } });
      if (progress(g).gold === gold) break;
      res.goldSpent += gold - progress(g).gold;
      res.bought++;
      wearUpgrades();
      for (const placed of [...inv().items]) if (equipment(placed)) step({ type: "sellItem", data: { x: placed.x, y: placed.y } });
    }
  }
  const kept = inv().items.filter((p) => !equipment(p));
  g.world.set<InventoryC>(g.session, "inventory", { ...inv(), items: kept });
  return res;
}

// ── Opening a map ────────────────────────────────────────────────────────────

/** Fixed-tier runs: one fresh stone of the tier, every other stone taken out. */
function stockStone(g: Game, tier: number, seed: number, index: number): void {
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  const items = inv.items.filter((p) => !p.item.waystone);
  const cell = firstFree({ ...inv, items });
  if (!cell) return;
  const stoneSeed = (Math.imul(seed + 7, 0x9e3779b1) ^ Math.imul(index + 3, 0x85ebca6b)) >>> 0;
  items.push({ x: cell.x, y: cell.y, w: 1, h: 1, item: waystoneItem(stoneSeed, tier) });
  g.world.set<InventoryC>(g.session, "inventory", { ...inv, items });
}

function firstFree(inv: InventoryC): { x: number; y: number } | null {
  for (let y = 0; y < inv.rows; y++) for (let x = 0; x < inv.cols; x++) {
    if (!inv.items.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h)) return { x, y };
  }
  return null;
}

/** playtest.ts's openMap: the lowest-tier uncleared node the best stone opens, the cheapest stone that does. */
function openMap(g: Game): boolean {
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
  g.sim.step([{ tick: g.sim.tick, type: "activateMap", atlasNodeId: node.id, data: { x: stone.x, y: stone.y } }]);
  if (sess(g).mapOpen !== 1) return false;
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "map" });
  g.sim.step([]);
  return sess(g).area === "map";
}

// ── Damage dealt, by skill ──────────────────────────────────────────────────

/**
 * Wraps this sim's enqueueDamage to name the skill behind every hit on a monster.
 * Read-only: the event goes through untouched. A projectile is named by the bolt of
 * his still in flight carrying that amount, an impact by the skill area resolving
 * this tick with it, a pulse by its ground area; a burning tick names its victim,
 * so burning is one bucket whatever lit it.
 */
function hookDealt(g: Game, dealt: Record<string, number>): () => void {
  const sim = g.sim;
  const orig = sim.enqueueDamage;
  sim.enqueueDamage = (ev) => {
    const w = g.world;
    if (w.has(ev.target, "monster")) {
      let key = "other";
      if (ev.source === ev.target) key = `dot.${ev.ailment ?? "burning"}`;
      else if (w.has(ev.source, "groundArea")) key = w.get<GroundAreaC>(ev.source, "groundArea")!.skillId ?? "ground";
      else if (ev.source === g.player && ev.via === "projectile") {
        const pr = w.query("projectile").map((e) => w.get<ProjectileC>(e, "projectile")!)
          .find((x) => x.ownerId === g.player && x.remainingRange > 0
            && (x.damageAmount === ev.amountFixed || (x.extraDamage ?? []).some((d) => d.amount === ev.amountFixed)));
        key = pr?.skillId ?? "projectile";
      } else if (ev.source === g.player) {
        const area = w.query("skillArea").map((e) => w.get<SkillAreaC>(e, "skillArea")!)
          .find((a) => a.ownerId === g.player && a.impactTick === sim.tick && a.parts.some((x) => x.amount === ev.amountFixed));
        key = area?.skillId ?? "hit";
      }
      dealt[key] = (dealt[key] ?? 0) + toNumber(ev.amountFixed);
    }
    orig.call(sim, ev);
  };
  return () => { sim.enqueueDamage = orig; };
}

// ── The bench: one skill on inert dummies, no map, no bot ───────────────────

export interface BenchRow {
  skill: string;
  gem: number;
  targets: number;
  extra: string;
  seconds: number;
  casts: number;
  /** Damage taken by all dummies per second (after their mitigation and any curse). */
  dps: number;
  /** The same, per dummy. */
  dpsPerTarget: number;
  manaPerSec: number;
}

/**
 * `skill` cast on cooldown for `seconds` at a cluster of inert dummies healed to full
 * every tick, mana refilled every tick: the skill's raw damage rate and its price.
 * `extra` adds Kindling Hex on the cluster (kept up) or Mantle of Embers (switched on).
 */
export function benchSkill(skill: string, gem: number, targets: number, extra: "" | "hex" | "herald" = "", seconds = 20, seed = 1): BenchRow {
  const g = newCharacter(EMBER, seed, 24);
  const sk = g.world.get<SkillsC>(g.session, "skills")!;
  g.world.set<SkillsC>(g.session, "skills", { ...sk, gems: { ...sk.gems, [skill]: { level: gem, xp: 0 }, [SK.hex]: { level: gem, xp: 0 }, [SK.herald]: { level: gem, xp: 0 } } });
  // The sim casts only what is on the bar: the benched skill and both helpers, at level 24 every one is unlocked.
  const bar: (string | null)[] = new Array(SKILL_SLOT_COUNT).fill(null);
  [skill, SK.hex, SK.herald].filter((id, i, a) => a.indexOf(id) === i).forEach((id, i) => { bar[i] = id; });
  bar[MOUSE_SLOT_BASE] = MOVE_SOCKET;
  bar[MOUSE_SLOT_BASE + 2] = SK.spark;
  g.sim.step([{ tick: g.sim.tick, type: "setSkillBar", bar }]);
  const me = g.world.get<Position>(g.player, "position")!;
  spawnLabActors(g.world, "clear", 0, 0);
  spawnLabActors(g.world, "dummy", me.x, me.y, targets);
  const dummies = g.world.query("monster");
  // A pack as the bot reads one (three within 2.5): one dummy at the centre, the rest
  // on a one-unit ring round it, five units in front of him. The lab's own layout
  // spreads five across seven units, wider than any pack.
  const c = { x: me.x, y: me.y + 5000 };
  const spots = dummies.map((_, i) => {
    const a = (2 * Math.PI * (i - 1)) / Math.max(1, dummies.length - 1);
    return i === 0 ? { ...c } : { x: c.x + Math.round(Math.cos(a) * 1000), y: c.y + Math.round(Math.sin(a) * 1000) };
  });
  // Pinned every tick: an inert dummy knocked out of a ring never walks back in, a monster does.
  const pin = () => dummies.forEach((d, i) => g.world.set<Position>(d, "position", { ...spots[i]! }));
  pin();
  const home = { ...me };
  // Nova hits round him and a dash runs through the cluster: stand where each can.
  const standAt = skill === SK.nova ? { x: c.x, y: c.y - 1500 } : skill === SK.dash ? { x: c.x, y: c.y - 4000 } : home;
  const refill = () => {
    const m = g.world.get<Mana>(g.player, "mana")!;
    g.world.set<Mana>(g.player, "mana", { ...m, mana: m.maxMana });
  };
  const cast = (id: string) => g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "useSkill", skillId: id, data: { tx: c.x, ty: c.y } }]);
  g.world.set<Position>(g.player, "position", standAt);
  if (extra === "herald") { refill(); cast(SK.herald); for (let i = 0; i < 12; i++) g.sim.step([]); }
  let dealt = 0;
  let casts = 0;
  let manaUsed = 0;
  const ticks = seconds * HZ;
  for (let t = 0; t < ticks; t++) {
    refill();
    pin();
    const cd = cooldowns(g);
    const hexed = activeStatuses(g.world, dummies[0]!, g.sim.tick).some((s) => s.id === "flammable");
    if (skill === SK.dash && (cd[SK.dash] ?? 0) <= g.sim.tick && !g.world.has(g.player, "casting")) {
      g.world.set<Position>(g.player, "position", standAt);
    }
    const id = extra === "hex" && !hexed && (cd[SK.hex] ?? 0) <= g.sim.tick ? SK.hex : skill;
    const was = cd[id];
    cast(id);
    if (cooldowns(g)[id] !== was) {
      if (id === skill) casts++;
      manaUsed += toNumber(effectiveSkill(SKILLS.get(id)!, gem).manaCostFixed);
    }
    for (const d of dummies) {
      const h = g.world.get<Health>(d, "health");
      if (!h) continue;
      dealt += toNumber(h.maxLife - h.life);
      g.world.set<Health>(d, "health", { ...h, life: h.maxLife });
    }
  }
  return {
    skill, gem, targets, extra, seconds, casts,
    dps: Math.round((dealt / seconds) * 10) / 10,
    dpsPerTarget: Math.round((dealt / seconds / targets) * 10) / 10,
    manaPerSec: Math.round((manaUsed / seconds) * 10) / 10,
  };
}

// ── Small readers ───────────────────────────────────────────────────────────

function sess(g: Game): SessionC { return g.world.get<SessionC>(g.session, "session")!; }
function progress(g: Game): ProgressC { return g.world.get<ProgressC>(g.session, "progress")!; }
function cooldowns(g: Game): Cooldowns { return g.world.get<Cooldowns>(g.player, "cooldowns") ?? {}; }
function mana(g: Game): number { return g.world.get<Mana>(g.player, "mana")!.mana; }
function flasks(g: Game): { life: number; mana: number } {
  const f = g.world.get<FlasksC>(g.player, "flasks");
  return { life: f?.lifeCharges ?? 0, mana: f?.manaCharges ?? 0 };
}
function gemLevel(g: Game, id: string): number {
  return g.world.get<SkillsC>(g.session, "skills")?.gems[id]?.level ?? 1;
}
function kindOf(g: Game, m: Entity): Kind {
  if (g.world.has(m, "boss")) return "boss";
  const mc = g.world.get<MonsterC>(m, "monster")!;
  return mc.rare === 1 ? "rare" : mc.magic === 1 ? "magic" : "normal";
}
function bodyOf(g: Game, e: Entity): number {
  return g.world.get<MonsterC>(e, "monster")?.bodyRadius ?? 500;
}
function dist(a: Position, b: Position): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function snapshot(g: Game): EmberRun["stats"] {
  const w = g.world;
  const h = w.get<Health>(g.player, "health")!;
  const m = w.get<Mana>(g.player, "mana")!;
  const d = w.get<DefensesC>(g.player, "defenses");
  const o = w.get<OffenseC>(g.player, "offense");
  const es = w.get<EnergyShieldC>(g.player, "energyShield");
  return {
    maxLife: toNumber(h.maxLife), maxMana: toNumber(m.maxMana), es: es ? toNumber(es.maxEs) : 0,
    armour: d ? toNumber(d.armour) : 0, res: d ? { ...d.res } : {},
    spellDamagePct: o?.spellDamagePct ?? 0, castSpeedPct: o?.castSpeedPct ?? 0, critChancePct: o?.critChancePct ?? 0,
  };
}
