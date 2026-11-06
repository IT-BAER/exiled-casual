// The Stalker balance harness (owner request, 4 November 2026). Test tooling only,
// like playtest.ts, and built on it unchanged: `playNextMap` plays every map and the
// shared Bot walks, aims, dodges and loots. This file steers the bot from outside -
// which skill a shot becomes, which passives are taken, what is worn and bought - and
// reads extra numbers off the world each tick through the harness's own `trace` hook.
//
// It steers by wrapping two Bot methods on the prototype (`decide`, `passives`) while a
// variant is active. Nothing changes for any other caller: with no variant active the
// wrappers call straight through, and the forked children run one variant at a time.
import { fork } from "node:child_process";
import { availableParallelism, setPriority } from "node:os";
import { fileURLToPath } from "node:url";
import { fp, toNumber } from "@exiled/fixed-point";
import {
  atlasGraph, atlasNodeTier, areaLevel, canAllocate, effectiveSkill, passivePoints, PASSIVE_TREE,
  rollItem, startNodeId, vendorBuyPrice,
} from "@exiled/rules";
import {
  SKILLS, ITEM_POOLS, MONSTERS, baseOf, isCurrency, itemStatMods, waystoneItem, weaponDamage,
} from "@exiled/content-runtime";
import type { Item, ItemPools } from "@exiled/content-schema";
import { MOUSE_SLOT_BASE, MOVE_SOCKET, SKILL_SLOT_COUNT, type EquipSlotId } from "@exiled/protocol";
import { Bot, SIGNATURE, AREA, type BotGame } from "./bot";
import { newCharacter, playNextMap, type MapRun } from "./playtest";
import { EQUIP_SLOTS_BY_CLASS } from "./equipment";
import { placeFirstFit } from "./inventory";
import { stockVendor } from "./vendor";
import type { Command } from "./loop";
import type { Entity } from "./ecs";
import type {
  SessionC, SkillsC, ProgressC, InventoryC, EquipmentC, Health, Mana, MonsterC, Position,
  Cooldowns, FlasksC, CastingC, BuffsC, StatusesC, VendorC,
} from "./components";

const HZ = 30;
const CLASS = "class.stalker";
export const SK = {
  snap: "skill.snap_shot.v1",
  pierce: "skill.piercing_shot.v1",
  vault: "skill.escape_shot.v1",
  rime: "skill.ice_shot.v1",
  split: "skill.split_arrow.v1",
  mark: "skill.snipers_mark.v1",
  arc: "skill.lightning_arrow.v1",
  sky: "skill.rain_of_arrows.v1",
  haste: "skill.haste.v1",
  blink: "skill.blink.v1",
} as const;

// ── Variants ─────────────────────────────────────────────────────────────────

/**
 * Which skills fire. `bot` leaves the shared bot alone (Piercing Shot, Split Arrow,
 * Snap Shot, Blink). Otherwise the bot proposes only the free attack and each shot
 * becomes the first ready skill of `pack` (on 3+ bodies within 2.5 of the target, or
 * a rare or boss) or `single`; Snap Shot when none is ready.
 */
export type SkillPolicy = "bot" | {
  single: readonly string[];
  pack: readonly string[];
  /** Marked Prey on a rare or boss target that is not marked yet. */
  mark?: boolean;
  /** Keep Windstride on. */
  haste?: boolean;
  /** Vaulting Shot away from a melee body within 2 units when below 60% life. */
  vault?: boolean;
  /** Default true: Blink stays on the bar and the bot's own escape uses it. */
  blink?: boolean;
};

/** `bot`: the harness refit (caster weights). `attack`: refit drops by `attackScore`. A rarity: one locked kit. */
export type GearPolicy = "bot" | "attack" | "starter" | "normal" | "magic" | "rare" | "unique";

/** `bot`: the shared bot's caster-weighted picks. `none`: nothing. Otherwise a spoke walked to its keystone. */
export type PassivePolicy = "bot" | "none" | "ember" | "ash" | "cinder" | "stone" | "bulwark" | "veil" | "storm" | "hearth";

export interface Variant {
  label: string;
  classId?: string;
  level: number;
  /** Maps per campaign. */
  maps: number;
  /** Fixed map tier (a fresh tier-T stone before every map, all lower nodes complete). Absent: the harness's own atlas walk. */
  tier?: number;
  skills: SkillPolicy;
  gear: GearPolicy;
  passives: PassivePolicy;
  /** Buy the best affordable `attackScore` upgrades off the shelf before every map. */
  vendor?: boolean;
  /**
   * `climb`: only the best stones are in the bag when a map opens, so the harness spends
   * one on a cleared node instead of falling back to the cheapest stone on a tier-1 node.
   */
  atlas?: "climb";
}

// ── Extra numbers, per map ───────────────────────────────────────────────────

export type MonsterClass = "normal" | "magic" | "rare" | "boss";

export interface Extra {
  /** Damage taken by source species (a rare marked "Rare "), after mitigation. */
  taken: Record<string, number>;
  /** Seconds from a monster's first lost life to its death; 0 for a one-shot. */
  ttk: Record<MonsterClass, number[]>;
  /** Mana paid for casts (effective cost at the gem's level). */
  manaSpent: number;
  /** Ticks within a second of a cast, and of those, ticks with mana below the cheapest policy skill. */
  combatTicks: number;
  dryTicks: number;
  lifeFlasks: number;
  manaFlasks: number;
}

export interface StalkerRun extends MapRun { extra: Extra }

export interface CampaignResult {
  label: string;
  seed: number;
  runs: StalkerRun[];
  end: {
    level: number;
    passives: number;
    points: number;
    /** The allocated node ids, for coverage. */
    allocated: string[];
    /** Gem level per skill at the end. */
    gems: Record<string, number>;
    gold: number;
    /** Rarity per worn slot. */
    worn: Record<string, string>;
    /** The bow's attack multiplier over the starter bow (phys sum + 2 x flat elemental, over 15). */
    bowMult: number;
    bought: number;
  };
}

// ── The steering, installed once ─────────────────────────────────────────────

interface Steer {
  variant: Variant;
  policy: Exclude<SkillPolicy, "bot"> | null;
  passive: ((g: BotGame, have: readonly string[]) => string | undefined) | null;
}
let active: Steer | null = null;

type BotInternals = { g: BotGame };
type BotProto = {
  decide(this: Bot, bossDead: boolean): Command[];
  passives(this: Bot, out: Command[], cmd: (c: Omit<Command, "tick" | "entity">) => Command): void;
};
const proto = Bot.prototype as unknown as BotProto;
const baseDecide = proto.decide;
const basePassives = proto.passives;
proto.decide = function (this: Bot, bossDead: boolean): Command[] {
  const out = baseDecide.call(this, bossDead);
  return active?.policy ? steerSkills((this as unknown as BotInternals).g, active.policy, out) : out;
};
proto.passives = function (this: Bot, out, cmd): void {
  if (!active?.passive) { basePassives.call(this, out, cmd); return; }
  const g = (this as unknown as BotInternals).g;
  const s = g.world.get<SessionC>(g.session, "session")!;
  const have = s.passives ?? [];
  if (have.length >= passivePoints(prog(g).level)) return;
  const id = active.passive(g, have);
  if (id) out.push(cmd({ type: "allocatePassive", passiveId: id }));
};

function steerSkills(g: BotGame, pol: Exclude<SkillPolicy, "bot">, out: Command[]): Command[] {
  const { world, player } = g;
  const tick = g.sim.tick;
  if (out.some((c) => c.type === "revive")) return out;
  const p = world.get<Position>(player, "position")!;
  const h = world.get<Health>(player, "health")!;

  // Vaulting Shot as the way out: a melee body on him and life going.
  if (pol.vault && h.life * 10 < h.maxLife * 6 && ready(g, SK.vault)) {
    const close = world.query("monster", "position")
      .map((e) => ({ e, at: world.get<Position>(e, "position")! }))
      .filter((m) => world.get<MonsterC>(m.e, "monster")!.state !== "idle"
        && !MONSTERS.get(world.get<MonsterC>(m.e, "monster")!.defId)?.ranged && dist(p, m.at) < fp(2))
      .sort((a, b) => dist(p, a.at) - dist(p, b.at))[0];
    if (close) {
      return [...out.filter((c) => c.type === "useFlask" || c.type === "allocatePassive"),
        { tick, entity: player, type: "useSkill", skillId: SK.vault, data: { tx: close.at.x, ty: close.at.y } }];
    }
  }

  const i = out.findIndex((c) => c.type === "useSkill" && c.skillId === SK.snap);
  if (i < 0) {
    // Out of the fight: raise the aura if it is down.
    if (pol.haste && !hasteOn(g) && ready(g, SK.haste) && !out.some((c) => c.type === "useSkill")) {
      out.push({ tick, entity: player, type: "useSkill", skillId: SK.haste, data: { tx: p.x, ty: p.y } });
    }
    return out;
  }
  const c = out[i]!;
  const tx = c.data!["tx"]!, ty = c.data!["ty"]!;
  const target = world.query("monster", "position").find((e) => {
    const at = world.get<Position>(e, "position")!;
    return at.x === tx && at.y === ty;
  });
  const big = target !== undefined && (world.has(target, "boss") || world.get<MonsterC>(target, "monster")!.rare === 1);
  const packed = world.query("monster", "position")
    .filter((e) => dist({ x: tx, y: ty }, world.get<Position>(e, "position")!) < fp(2.5)).length >= 3;

  let pick: string | undefined;
  if (pol.mark && big && target !== undefined && !marked(g, target, tick) && ready(g, SK.mark)) pick = SK.mark;
  const order = packed || big ? [...pol.pack, ...pol.single] : [...pol.single, ...pol.pack];
  pick ??= order.find((id) => ready(g, id));
  if (pick) out[i] = { ...c, skillId: pick };
  return out;
}

/** On the bar, unlocked, off cooldown, paid for at its gem's cost, and no wind-up running. */
function ready(g: BotGame, id: string): boolean {
  const sk = g.world.get<SkillsC>(g.session, "skills")!;
  if (!sk.bar.includes(id) || sk.gems[id] === undefined) return false;
  const tick = g.sim.tick;
  if ((g.world.get<Cooldowns>(g.player, "cooldowns")?.[id] ?? 0) > tick) return false;
  const casting = g.world.get<CastingC>(g.player, "casting");
  if (casting && casting.untilTick > tick) return false;
  return g.world.get<Mana>(g.player, "mana")!.mana >= costOf(g, id);
}
function costOf(g: BotGame, id: string): number {
  const lvl = g.world.get<SkillsC>(g.session, "skills")!.gems[id]?.level ?? 1;
  return effectiveSkill(SKILLS.get(id)!, lvl).manaCostFixed;
}
function hasteOn(g: BotGame): boolean {
  return g.world.get<BuffsC>(g.player, "buffs")?.list.some((b) => b.id === "haste") ?? false;
}
function marked(g: BotGame, e: Entity, tick: number): boolean {
  return g.world.get<StatusesC>(e, "statuses")?.list.some((s) => s.id === "marked" && s.untilTick > tick) ?? false;
}

// ── Passive builds ───────────────────────────────────────────────────────────

/** The spoke's own nodes, rings 0-3, its keystone, then its outer-ring cluster; the walk takes them in that order. */
export function spokeBuild(spoke: string): (g: BotGame, have: readonly string[]) => string | undefined {
  const prefix = `p.${spoke}.`;
  const keystone = PASSIVE_TREE.find((n) => n.kind === "keystone" && n.links.some((l) => l.startsWith(`${prefix}3.`)))!.id;
  const rank = (id: string): number => id === keystone ? 3.5 : Number(id.slice(prefix.length, prefix.length + 1));
  const targets = new Set(PASSIVE_TREE.filter((n) => n.id.startsWith(prefix) || n.id === keystone).map((n) => n.id));
  const byId = new Map(PASSIVE_TREE.map((n) => [n.id, n]));
  return (g, have) => {
    const classId = g.classId;
    const open = PASSIVE_TREE.filter((n) => canAllocate(classId, have, n.id));
    // A notable as soon as it opens, else the innermost ring first.
    const mine = open.filter((n) => targets.has(n.id))
      .sort((a, b) => rank(a.id) - rank(b.id) || Number(b.kind === "notable") - Number(a.kind === "notable") || a.id.localeCompare(b.id));
    if (mine.length > 0) return mine[0]!.id;
    // Off the spoke: the open node nearest (in links) to a target still to take.
    const want = [...targets].filter((t) => !have.includes(t));
    if (want.length === 0) return undefined;
    const distTo = new Map<string, number>(want.map((t) => [t, 0]));
    for (let frontier = want; frontier.length > 0;) {
      const next: string[] = [];
      for (const id of frontier) for (const l of byId.get(id)!.links) {
        if (distTo.has(l) || l === startNodeId(classId)) continue;
        distTo.set(l, distTo.get(id)! + 1);
        next.push(l);
      }
      frontier = next;
    }
    return open.filter((n) => distTo.has(n.id))
      .sort((a, b) => distTo.get(a.id)! - distTo.get(b.id)! || a.id.localeCompare(b.id))[0]?.id;
  };
}

// ── Gear ─────────────────────────────────────────────────────────────────────

const STALKER_BASES: Record<EquipSlotId, string | undefined> = {
  helmet: "base.stalker_hood", body: "base.stalker_leathers", gloves: "base.stalker_gloves",
  boots: "base.stalker_boots", belt: "base.stalker_strap", weapon1: "base.stalker_bow",
  weapon2: "base.stalker_buckler", amulet: "base.stalker_talisman", ring1: "base.stalker_band", ring2: "base.stalker_band",
} as Record<EquipSlotId, string | undefined>;
const SLOT_ORDER: EquipSlotId[] = ["weapon1", "weapon2", "helmet", "body", "gloves", "boots", "belt", "amulet", "ring1", "ring2"];

/**
 * What a bow user wants from an item, per point, against the starter bow. The bow
 * itself counts by its attack multiplier (100 points per 1.0x); a ring's flat
 * elemental to attacks is 2/15 of a starter-bow hit per point (weapon.ts). Cast speed
 * only shortens the wind-up of a skill whose beat is its cooldown, so it is nearly worthless.
 */
const ATTACK_WEIGHT: Record<string, number> = {
  maxLife: 1, energyShield: 1, spellDamagePct: 1.5, critChancePct: 0.4, strength: 0.6,
  fireResPct: 0.5, coldResPct: 0.5, lightningResPct: 0.5, chaosResPct: 0.3, allElementalResPct: 1.5,
  armour: 0.1, armourPct: 0.3, energyShieldPct: 0.3, maxMana: 0.4, manaRegenPct: 0.4, castSpeedPct: 0.1,
  attackFireDamage: 13, attackColdDamage: 13,
};
export function bowMult(item: Item | undefined): number {
  const w = weaponDamage(item);
  return (w.physMin + w.physMax + 2 * (w.fire + w.cold)) / 15;
}
export function attackScore(item: Item): number {
  const cls = baseOf(item.baseId).itemClass;
  const stats = itemStatMods(item).reduce((a, m) => a + (ATTACK_WEIGHT[m.stat] ?? 0) * m.value, 0);
  return cls === "bow" ? stats + 100 * bowMult(item) : stats;
}

/** One piece for `slot` at `rarity`, rolled on the Stalker base for it. A unique where the slot has one, else a rare. */
function rollFor(slot: EquipSlotId, rarity: "normal" | "magic" | "rare" | "unique", seed: number, ilvl: number): Item {
  const baseId = STALKER_BASES[slot]!;
  const base = ITEM_POOLS.bases.find((b) => b.id === baseId)!;
  const uniques = (ITEM_POOLS.uniques ?? []).filter((u) => u.baseId === baseId);
  const pools: ItemPools = { bases: [base], affixes: ITEM_POOLS.affixes, uniques };
  const want = rarity === "unique" && uniques.length === 0 ? "rare" : rarity;
  const item = rollItem(pools, seed, ilvl, 0, want, 0, "stalker");
  delete item.unidentified;
  return item;
}

function equipKit(g: BotGame, rarity: "normal" | "magic" | "rare" | "unique", seed: number, ilvl: number): void {
  SLOT_ORDER.forEach((slot, k) => {
    // Rings and the amulet need their level: equipItem refuses them below it.
    const item = rollFor(slot, rarity, (seed * 7919 + k * 104729) >>> 0, ilvl);
    if ((baseOf(item.baseId).stats?.reqLevel ?? 1) > prog(g).level) return;
    wear(g, item, slot);
  });
}

/** Into the bag, then on through the real equipItem command. */
function wear(g: BotGame, item: Item, slot: EquipSlotId): boolean {
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  const b = baseOf(item.baseId);
  const at = placeFirstFit(inv, b.w, b.h);
  if (!at) return false;
  g.world.set<InventoryC>(g.session, "inventory", { ...inv, items: [...inv.items, { x: at.x, y: at.y, w: b.w, h: b.h, item }] });
  g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "equipItem", slot, data: { x: at.x, y: at.y } }]);
  return g.world.get<EquipmentC>(g.session, "equipment")!.slots[slot] === item;
}

/** The best slot for `item` and how much it beats what is there, by attackScore. */
function upgrade(g: BotGame, item: Item): { slot: EquipSlotId; gain: number } | null {
  if (item.waystone || isCurrency(item)) return null;
  if ((baseOf(item.baseId).stats?.reqLevel ?? 1) > prog(g).level) return null;
  const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
  let best: { slot: EquipSlotId; gain: number } | null = null;
  for (const slot of EQUIP_SLOTS_BY_CLASS[baseOf(item.baseId).itemClass] ?? []) {
    const cur = worn[slot];
    const gain = attackScore(item) - (cur ? attackScore(cur) : 0);
    if (gain > 0 && (!best || gain > best.gain)) best = { slot, gain };
  }
  return best;
}

/** The attack-aware refit: every upgrade in the bag, best first, then the bag emptied of equipment. */
function attackRefit(g: BotGame): void {
  for (;;) {
    const inv = g.world.get<InventoryC>(g.session, "inventory")!;
    const cand = inv.items.map((p) => ({ p, u: upgrade(g, p.item) })).filter((x) => x.u)
      .sort((a, b) => b.u!.gain - a.u!.gain)[0];
    if (!cand) break;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "equipItem", slot: cand.u!.slot, data: { x: cand.p.x, y: cand.p.y } }]);
    if (g.world.get<EquipmentC>(g.session, "equipment")!.slots[cand.u!.slot] !== cand.p.item) break;
  }
  stripGear(g);
}

/** Equipment out of the bag, so the harness's own refit finds nothing to swap. */
function stripGear(g: BotGame): void {
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  g.world.set<InventoryC>(g.session, "inventory", { ...inv, items: inv.items.filter((p) => p.item.waystone || isCurrency(p.item)) });
}

/** Buy what beats the worn piece by the most, while gold lasts; returns pieces bought. */
function shop(g: BotGame): number {
  let bought = 0;
  for (;;) {
    const shelf = g.world.get<VendorC>(g.session, "vendor");
    const gold = prog(g).gold;
    const cand = (shelf?.items ?? []).map((p) => ({ p, u: upgrade(g, p.item), price: vendorBuyPrice(p.item) }))
      .filter((x) => x.u && x.price <= gold)
      .sort((a, b) => b.u!.gain - a.u!.gain)[0];
    if (!cand) return bought;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "buyItem", data: { x: cand.p.x, y: cand.p.y } }]);
    if (prog(g).gold === gold) return bought;
    bought++;
    attackRefit(g);
  }
}

// ── Atlas ────────────────────────────────────────────────────────────────────

/** Every node below `tier` complete and one fresh tier-T stone in the bag, the stones before it gone. */
function stoneForTier(g: BotGame, tier: number, seed: number): void {
  const s = g.world.get<SessionC>(g.session, "session")!;
  const graph = atlasGraph(s.atlasSeed);
  const below = graph.filter((n) => atlasNodeTier(graph, n.id) < tier).map((n) => n.id);
  g.world.set<SessionC>(g.session, "session", { ...s, completedNodes: [...new Set([...s.completedNodes, ...below])] });
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  const kept = inv.items.filter((p) => !p.item.waystone);
  const at = placeFirstFit({ ...inv, items: kept }, 1, 1)!;
  g.world.set<InventoryC>(g.session, "inventory", { ...inv, items: [...kept, { x: at.x, y: at.y, w: 1, h: 1, item: waystoneItem(seed, tier) }] });
}

/** Stones below the best tier out of the bag; given back after the map. */
function holdLowStones(g: BotGame): Item[] {
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  const best = Math.max(0, ...inv.items.filter((p) => p.item.waystone).map((p) => p.item.waystone!.tier));
  const low = inv.items.filter((p) => p.item.waystone && p.item.waystone.tier < best);
  g.world.set<InventoryC>(g.session, "inventory", { ...inv, items: inv.items.filter((p) => !low.includes(p)) });
  return low.map((p) => p.item);
}
function returnStones(g: BotGame, items: Item[]): void {
  for (const item of items) {
    const inv = g.world.get<InventoryC>(g.session, "inventory")!;
    const at = placeFirstFit(inv, 1, 1);
    if (!at) return;
    g.world.set<InventoryC>(g.session, "inventory", { ...inv, items: [...inv.items, { x: at.x, y: at.y, w: 1, h: 1, item }] });
  }
}

// ── One campaign ─────────────────────────────────────────────────────────────

export function runVariant(v: Variant, seed: number): CampaignResult {
  const classId = v.classId ?? CLASS;
  const g = newCharacter(classId, seed, v.level);
  const policy = v.skills === "bot" ? null : v.skills;
  active = {
    variant: v,
    policy,
    passive: v.passives === "bot" ? null : v.passives === "none" ? () => undefined : spokeBuild(v.passives),
  };
  try {
    const s0 = g.world.get<SessionC>(g.session, "session")!;
    // A character who reached this level has seen the shelf restock on every level-up.
    g.world.set<VendorC>(g.session, "vendor", stockVendor(s0.atlasSeed, v.level, classId));
    if (policy) setBar(g, policy);
    const ilvl = v.tier ? areaLevel(v.tier) : Math.max(1, v.level);
    if (v.gear !== "bot" && v.gear !== "attack" && v.gear !== "starter") equipKit(g, v.gear, seed, ilvl);

    const runs: StalkerRun[] = [];
    let bought = 0;
    for (let i = 0; i < v.maps; i++) {
      if (v.gear === "attack") attackRefit(g);
      else if (v.gear !== "bot") stripGear(g);
      if (v.vendor) bought += shop(g);
      if (v.tier) stoneForTier(g, v.tier, (seed * 1_000_003 + i * 7_777) >>> 0);
      if (policy) setBar(g, policy);
      const held = v.atlas === "climb" && !v.tier ? holdLowStones(g) : [];
      const extra = blankExtra();
      const r = playNextMap(g, { without: policy ? withoutFor(policy) : [], trace: tracer(g, extra, policy) });
      returnStones(g, held);
      if (!r) break;
      runs.push({ ...r, affixes: {}, extra });
    }
    const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
    return {
      label: v.label, seed, runs,
      end: {
        level: prog(g).level,
        passives: (g.world.get<SessionC>(g.session, "session")!.passives ?? []).length,
        allocated: [...(g.world.get<SessionC>(g.session, "session")!.passives ?? [])],
        gems: Object.fromEntries(Object.entries(g.world.get<SkillsC>(g.session, "skills")!.gems).map(([k, x]) => [k, x.level])),
        points: passivePoints(prog(g).level),
        gold: prog(g).gold,
        worn: Object.fromEntries(Object.entries(worn).filter(([, it]) => it).map(([k, it]) => [k, it!.rarity])),
        bowMult: bowMult(worn["weapon1"]),
        bought,
      },
    };
  } finally {
    active = null;
  }
}

/** The bot proposes only the free attack (and Blink if kept); the policy turns its shots into skills. */
function withoutFor(pol: Exclude<SkillPolicy, "bot">): string[] {
  return [SIGNATURE[CLASS]!, AREA[CLASS]!, ...(pol.blink === false ? [SK.blink] : [])];
}

/** Five numbered sockets and the free mouse socket, as a player would bind them: the policy's skills, then Blink. */
function setBar(g: BotGame, pol: Exclude<SkillPolicy, "bot">): void {
  const want = [...new Set([...pol.single, ...pol.pack, ...(pol.mark ? [SK.mark] : []), ...(pol.haste ? [SK.haste] : []),
    ...(pol.vault ? [SK.vault] : []), ...(pol.blink === false ? [] : [SK.blink])])];
  const sockets = [0, 1, 2, 3, 4, MOUSE_SLOT_BASE + 1];
  if (want.length > sockets.length) throw new Error(`bar holds ${sockets.length} skills, policy asks for ${want.length}`);
  const bar: (string | null)[] = new Array(SKILL_SLOT_COUNT).fill(null);
  bar[MOUSE_SLOT_BASE] = MOVE_SOCKET;
  bar[MOUSE_SLOT_BASE + 2] = SK.snap;
  want.forEach((id, k) => { bar[sockets[k]!] = id; });
  g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "setSkillBar", bar }]);
}

function blankExtra(): Extra {
  return { taken: {}, ttk: { normal: [], magic: [], rare: [], boss: [] }, manaSpent: 0, combatTicks: 0, dryTicks: 0, lifeFlasks: 0, manaFlasks: 0 };
}

function tracer(g: BotGame, x: Extra, pol: Exclude<SkillPolicy, "bot"> | null) {
  const seen = new Map<Entity, { cls: MonsterClass; hurtAt: number }>();
  let lastHit = g.sim.tick;
  let cds: Cooldowns = { ...(g.world.get<Cooldowns>(g.player, "cooldowns") ?? {}) };
  let fl = flasks(g);
  let lastCast = -HZ;
  const manaSkills = pol ? [...pol.single, ...pol.pack].filter((id) => SKILLS.get(id)!.manaCostFixed > 0)
    : [SIGNATURE[g.classId]!];
  return (): void => {
    const { world, sim } = g;
    const tick = sim.tick;
    for (const e of world.query("monster")) {
      let s = seen.get(e);
      if (!s) {
        const m = world.get<MonsterC>(e, "monster")!;
        s = { cls: world.has(e, "boss") ? "boss" : m.rare === 1 ? "rare" : m.magic === 1 ? "magic" : "normal", hurtAt: -1 };
        seen.set(e, s);
      }
      if (s.hurtAt < 0) {
        const h = world.get<Health>(e, "health");
        if (h && h.life < h.maxLife) s.hurtAt = tick;
      }
    }
    for (const [e, s] of seen) {
      if (world.alive.has(e) && world.has(e, "monster")) continue;
      // Never seen hurt alive: killed by the hit that first touched it, a one-shot.
      x.ttk[s.cls].push(s.hurtAt >= 0 ? (tick - s.hurtAt) / HZ : 0);
      seen.delete(e);
    }
    for (const h of sim.recentHits) {
      if (h.tick <= lastHit) continue;
      const k = `${h.rare ? "Rare " : ""}${h.species.replace(/^monster\.|\.v1$/g, "") || "shot of a dead monster"}`;
      x.taken[k] = (x.taken[k] ?? 0) + h.amount;
    }
    lastHit = sim.recentHits.length > 0 ? Math.max(lastHit, sim.recentHits[sim.recentHits.length - 1]!.tick) : lastHit;
    const now = g.world.get<Cooldowns>(g.player, "cooldowns") ?? {};
    for (const [id, until] of Object.entries(now)) {
      if (until === cds[id]) continue;
      lastCast = tick;
      x.manaSpent += toNumber(costOf(g, id));
    }
    cds = { ...now };
    const f = flasks(g);
    if (f.life < fl.life) x.lifeFlasks++;
    if (f.mana < fl.mana) x.manaFlasks++;
    fl = f;
    if (tick - lastCast < HZ) {
      x.combatTicks++;
      const cheapest = Math.min(...manaSkills.filter((id) => g.world.get<SkillsC>(g.session, "skills")!.gems[id]).map((id) => costOf(g, id)));
      if (Number.isFinite(cheapest) && g.world.get<Mana>(g.player, "mana")!.mana < cheapest) x.dryTicks++;
    }
  };
}

function flasks(g: BotGame): { life: number; mana: number } {
  const f = g.world.get<FlasksC>(g.player, "flasks");
  return { life: f?.lifeCharges ?? 0, mana: f?.manaCharges ?? 0 };
}
function prog(g: BotGame): ProgressC { return g.world.get<ProgressC>(g.session, "progress")!; }
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number { return Math.hypot(a.x - b.x, a.y - b.y); }

// ── Many campaigns, across child processes ───────────────────────────────────

export interface StalkerJob { variant: Variant; seed: number }

/**
 * Each job in a child process at below-normal priority (two sibling sessions share
 * this machine), results in job order. Deterministic like `campaigns()`.
 */
export function runJobs(jobs: readonly StalkerJob[], procs = Math.max(1, Math.min(4, availableParallelism() >> 2)),
  onDone?: (done: number, total: number) => void): Promise<CampaignResult[]> {
  const script = fileURLToPath(new URL("./playtest-stalker-fork.mjs", import.meta.url));
  const out: CampaignResult[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  return new Promise((resolve, reject) => {
    if (jobs.length === 0) return resolve(out);
    for (let p = 0; p < Math.min(procs, jobs.length); p++) {
      const child = fork(script, [], {
        execArgv: ["--experimental-transform-types", "--no-warnings"],
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      try { if (child.pid) setPriority(child.pid, 10); } catch { /* priority is a courtesy, not a requirement */ }
      child.on("message", (m: { id?: number; result?: CampaignResult }) => {
        if (m.result) {
          out[m.id!] = m.result;
          onDone?.(++done, jobs.length);
          if (done === jobs.length) resolve(out);
        }
        if (next < jobs.length) child.send({ id: next, ...jobs[next++] });
        else child.disconnect();
      });
      child.on("error", reject);
      child.on("exit", (code) => { if (code !== 0) reject(new Error(`stalker playtest child exited with ${code}`)); });
    }
  });
}
