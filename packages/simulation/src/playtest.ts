// A headless player for balance work: plays real generated maps in the real sim,
// the way a competent casual player would, and reports what the run felt like
// in numbers (clear time, deaths, kill rate, drop pacing, levels).
//
// Test tooling only. It reads the world and sends the same commands the client
// sends; the two shortcuts are named where they happen (a portal "click" sets
// pendingArea directly, since walking to the ring measures nothing).
import {
  atlasGraph, atlasNodeTier, isNodeReachable, maxGemLevel,
} from "@exiled/rules";
import { CONTENT_VERSION, isCurrency, itemStatMods, baseOf } from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import type { EquipSlotId } from "@exiled/protocol";
import { generateArea } from "@exiled/mapgen";
import { createCombatSim, spawnLabActors } from "./combat-sim";
import { equipStartingGear } from "./characters";
import { reseedDefaultAttack, grantSkills } from "./persist";
import { areaCollision } from "./areas";
import { grammarForNode } from "./systems/area-transition";
import { Bot, type BotOptions, type BotGame as Game } from "./bot";
import { EQUIP_SLOTS_BY_CLASS } from "./equipment";
import type { Entity } from "./ecs";
import type {
  SessionC, Cooldowns, FlasksC, ProgressC, SkillsC, ItemC, InventoryC, EquipmentC,
} from "./components";

const HZ = 30;
const MAP_CAP_TICKS = 15 * 60 * HZ;

export interface MapRun {
  classId: string;
  node: string;
  tier: number;
  /** Boss dead. False = out of portals or the 15 minute cap. */
  cleared: boolean;
  stuck: boolean;
  seconds: number;
  deaths: number;
  kills: number;
  /** Seconds within one second of a cast: fighting, at whatever range the class fights. */
  combatSeconds: number;
  drops: Record<"normal" | "magic" | "rare" | "unique" | "currency" | "waystone", number>;
  /** Seconds into the map of every magic-or-better equipment drop. */
  magicPlusAt: number[];
  levelStart: number;
  levelEnd: number;
  casts: Record<string, number>;
  flasks: number;
}

export type { BotOptions };

/**
 * A new character of `classId` in its hideout, dressed and barred like the client
 * makes one. `level` above 1 lifts it there the lab's way, with every gem at the
 * character's level: the upper bound on what that character could be carrying.
 */
export function newCharacter(classId: string, seed: number, level = 1): Game {
  const { sim, world, playerEntity } = createCombatSim(seed, { area: "hideout" });
  const session = world.query("session")[0]!;
  world.set<SessionC>(session, "session", { ...world.get<SessionC>(session, "session")!, classId });
  equipStartingGear(world, classId);
  world.set<SkillsC>(session, "skills", reseedDefaultAttack(world.get<SkillsC>(session, "skills")!, classId));
  grantSkills(world);
  for (let l = 1; l < level; l++) spawnLabActors(world, "levelup", 0, 0);
  if (level > 1) {
    const sk = world.get<SkillsC>(session, "skills")!;
    const gems = Object.fromEntries(Object.keys(sk.gems).map((id) => [id, { level: maxGemLevel(level), xp: 0 }]));
    world.set<SkillsC>(session, "skills", { ...sk, gems });
  }
  return { sim, world, player: playerEntity, session, classId };
}

/** Enter the next map the character can open, play it to the end, walk home. */
export function playNextMap(g: Game, opts: BotOptions = {}): MapRun | null {
  refit(g);
  if (!openMap(g)) return null;
  const s = sess(g);
  const layout = generateArea(s.mapSeed, CONTENT_VERSION, grammarForNode(s.activeNodeId));
  // Built from the same world the sim's own collision was, so the bot sees the
  // containers and furniture as blockers exactly like the movement system does.
  const collision = areaCollision(g.world, "map", layout);
  const bot = new Bot(g, collision, opts);
  const run: MapRun = {
    classId: g.classId, node: s.activeNodeId, tier: s.areaTier, cleared: false, stuck: false,
    seconds: 0, deaths: 0, kills: 0, combatSeconds: 0,
    drops: { normal: 0, magic: 0, rare: 0, unique: 0, currency: 0, waystone: 0 },
    magicPlusAt: [], levelStart: progress(g).level, levelEnd: 0, casts: {}, flasks: 0,
  };
  const seenItems = new Set<Entity>(g.world.query("item"));
  const bosses = g.world.query("boss");
  let monsters = new Set<Entity>(g.world.query("monster"));
  let wasDead = false;
  let clearedAt = -1;
  let lastCast = -HZ;
  const start = g.sim.tick;

  for (let t = 0; t < MAP_CAP_TICKS; t++) {
    const before = { cds: { ...cooldowns(g) }, flasks: flaskCharges(g) };
    g.sim.step(bot.decide(clearedAt >= 0));
    opts.trace?.(g.world, g.player, g.sim.tick - start);
    const now = sess(g);
    if (now.area !== "map") break; // died out of portals: sent home

    for (const [id, until] of Object.entries(cooldowns(g))) {
      if (until !== before.cds[id]) { run.casts[id] = (run.casts[id] ?? 0) + 1; lastCast = t; }
    }
    if (flaskCharges(g) < before.flasks) run.flasks++;
    if (now.dead === 1 && !wasDead) run.deaths++;
    wasDead = now.dead === 1;

    const alive = new Set<Entity>(g.world.query("monster"));
    for (const m of monsters) if (!alive.has(m)) run.kills++;
    monsters = alive;

    for (const e of g.world.query("item")) {
      if (seenItems.has(e)) continue;
      seenItems.add(e);
      const item = g.world.get<ItemC>(e, "item")!.item;
      if (item.waystone) run.drops.waystone++;
      else if (isCurrency(item)) run.drops.currency++;
      else {
        run.drops[item.rarity]++;
        if (item.rarity !== "normal") run.magicPlusAt.push((g.sim.tick - start) / HZ);
      }
    }
    if (t - lastCast < HZ) run.combatSeconds += 1 / HZ;

    if (clearedAt < 0 && bosses.length > 0 && bosses.every((b) => !g.world.alive.has(b))) {
      clearedAt = g.sim.tick;
      run.cleared = true;
      run.seconds = (clearedAt - start) / HZ;
    }
    // After the boss: a few seconds to sweep the payout off the floor, then home.
    if (clearedAt >= 0 && (g.sim.tick - clearedAt > 60 * HZ || !bot.hasLootLeft())) break;
  }
  if (!run.cleared) {
    run.seconds = (g.sim.tick - start) / HZ;
    run.stuck = sess(g).area === "map";
  }
  run.levelEnd = progress(g).level;
  // Walking through the return portal: the same session edit the click makes.
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "hideout", mapOpen: 0, dead: 0 });
  g.sim.step([]);
  return run;
}

/** `maps` maps in a row on one character, carrying level, gems and stones forward. */
export function campaign(classId: string, seed: number, maps: number, opts: BotOptions = {}, level = 1): MapRun[] {
  const g = newCharacter(classId, seed, level);
  const runs: MapRun[] = [];
  for (let i = 0; i < maps; i++) {
    const r = playNextMap(g, opts);
    if (!r) break;
    runs.push(r);
  }
  return runs;
}

// ── Between maps ─────────────────────────────────────────────────────────────

/** What a caster wants from a stat, per point; anything unlisted is worth nothing. */
const STAT_WEIGHT: Record<string, number> = {
  maxLife: 1, energyShield: 1, spellDamagePct: 2, castSpeedPct: 2, critChancePct: 0.5,
  fireResPct: 0.5, coldResPct: 0.5, lightningResPct: 0.5, chaosResPct: 0.3,
  armour: 0.1, armourPct: 0.3, maxMana: 0.3, manaRegenPct: 0.3, strength: 0.3,
};
const score = (item: Item) => itemStatMods(item).reduce((a, m) => a + (STAT_WEIGHT[m.stat] ?? 0) * m.value, 0);

/**
 * The hideout visit: wear every upgrade in the bag (through the real equipItem
 * command), then empty the bag of equipment. Emptying stands in for the vendor
 * and the stash, which change nothing a map run measures.
 */
function refit(g: Game): void {
  const inv = () => g.world.get<InventoryC>(g.session, "inventory")!;
  for (const placed of [...inv().items]) {
    if (placed.item.waystone || isCurrency(placed.item)) continue;
    const slots = EQUIP_SLOTS_BY_CLASS[baseOf(placed.item.baseId).itemClass] ?? [];
    const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
    const slot = slots.find((sl) => !worn[sl] || score(placed.item) > score(worn[sl]!));
    if (!slot) continue;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "equipItem", slot: slot as EquipSlotId, data: { x: placed.x, y: placed.y } }]);
  }
  const kept = inv().items.filter((p) => p.item.waystone || isCurrency(p.item));
  g.world.set<InventoryC>(g.session, "inventory", { ...inv(), items: kept });
}

// ── Opening a map ────────────────────────────────────────────────────────────

/**
 * Use the best stone on the lowest-tier node not yet cleared, falling back to a
 * cleared one (PoE1's rule: you can always go back). Returns false when no stone
 * opens anything.
 */
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
  // The cheapest stone that still opens the node, so the good ones are saved.
  const need = atlasNodeTier(graph, node.id);
  const stone = [...stones].reverse().find((p) => p.item.waystone!.tier >= need)!;
  g.sim.step([{ tick: g.sim.tick, type: "activateMap", atlasNodeId: node.id, data: { x: stone.x, y: stone.y } }]);
  if (sess(g).mapOpen !== 1) return false;
  // Stepping into the ring: the same session edit the portal click makes.
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "map" });
  g.sim.step([]);
  return sess(g).area === "map";
}

// ── Small readers ───────────────────────────────────────────────────────────

function sess(g: Game): SessionC { return g.world.get<SessionC>(g.session, "session")!; }
function progress(g: Game): ProgressC { return g.world.get<ProgressC>(g.session, "progress")!; }
function cooldowns(g: Game): Cooldowns { return g.world.get<Cooldowns>(g.player, "cooldowns") ?? {}; }
function flaskCharges(g: Game): number {
  const f = g.world.get<FlasksC>(g.player, "flasks");
  return f ? f.lifeCharges + f.manaCharges : 0;
}

// ── Reporting ───────────────────────────────────────────────────────────────

export interface Summary {
  maps: number;
  clearRate: number;
  deathsPerMap: number;
  meanClearSec: number;
  killsPerCombatSec: number;
  /** Mean seconds between magic-or-better equipment drops. */
  magicPlusGapSec: number;
  raresPerMap: number;
}

export function summarize(runs: readonly MapRun[]): Summary {
  const n = runs.length || 1;
  const sum = (f: (r: MapRun) => number) => runs.reduce((a, r) => a + f(r), 0);
  const cleared = runs.filter((r) => r.cleared);
  const magicPlus = sum((r) => r.magicPlusAt.length);
  return {
    maps: runs.length,
    clearRate: cleared.length / n,
    deathsPerMap: sum((r) => r.deaths) / n,
    meanClearSec: cleared.reduce((a, r) => a + r.seconds, 0) / (cleared.length || 1),
    killsPerCombatSec: sum((r) => r.kills) / (sum((r) => r.combatSeconds) || 1),
    magicPlusGapSec: sum((r) => r.seconds) / (magicPlus || 1),
    raresPerMap: sum((r) => r.drops.rare + r.drops.unique) / n,
  };
}

