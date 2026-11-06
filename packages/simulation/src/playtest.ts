// A headless player for balance work: plays real generated maps in the real sim,
// the way a competent casual player would, and reports what the run felt like
// in numbers (clear time, deaths, kill rate, drop pacing, levels).
//
// Test tooling only. It reads the world and sends the same commands the client
// sends; the two shortcuts are named where they happen (a portal "click" sets
// pendingArea directly, since walking to the ring measures nothing).
import {
  atlasGraph, atlasNodeTier, isNodeReachable, maxGemLevel, isUnlocked,
} from "@exiled/rules";
import {
  CONTENT_VERSION, isCurrency, itemStatMods, baseOf, weaponDamage, ATTACK_WEAPON_CLASSES, CLASSES,
  SKILLS, DEFAULT_ATTACK_BY_CLASS,
} from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import { SKILL_SLOT_COUNT, MOUSE_SLOT_BASE, MOVE_SOCKET, type EquipSlotId } from "@exiled/protocol";
import { generateArea } from "@exiled/mapgen";
import { createCombatSim, spawnLabActors } from "./combat-sim";
import { equipStartingGear } from "./characters";
import { reseedDefaultAttack, grantSkills } from "./persist";
import { areaCollision } from "./areas";
import { grammarForNode } from "./systems/area-transition";
import { Bot, KITS, type BotOptions, type BotGame as Game } from "./bot";
import { EQUIP_SLOTS_BY_CLASS, handsClash } from "./equipment";
import type { Entity } from "./ecs";
import type {
  SessionC, Cooldowns, FlasksC, ProgressC, SkillsC, ItemC, InventoryC, EquipmentC, Health, MonsterC,
  GroundAreaC, ProjectileC, SkillAreaC,
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
  /** The boss's def, and seconds from its first lost life to the last boss dying; null if it never died. */
  bossId: string | null;
  bossSeconds: number | null;
  /** Gold picked up in the map (the bot never shops, so this is the map's income). */
  gold: number;
  /** Rolled affixes on equipment drops by affix id, and uniques by name. */
  affixes: Record<string, number>;
  uniques: Record<string, number>;
  /** Each death's killing blow, "Rare " marking a rare: what the death screen names. */
  killers: string[];
  /** Damage sent to monsters (before their mitigation) by skill id; a pulse or burning tick by the skill that laid it. */
  dealt: Record<string, number>;
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
  refit(g, opts.kit ? "class" : "caster");
  if (opts.kit) slotKit(g);
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
    bossId: null, bossSeconds: null, gold: 0, affixes: {}, uniques: {}, killers: [], dealt: {},
  };
  const unhook = meterDealt(g, run.dealt);
  const goldStart = progress(g).gold;
  const seenItems = new Set<Entity>(g.world.query("item"));
  const bosses = g.world.query("boss");
  run.bossId = bosses.length > 0 ? g.world.get<MonsterC>(bosses[0]!, "monster")!.defId : null;
  let bossHitAt = -1;
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
    if (now.dead === 1 && !wasDead) {
      run.deaths++;
      const kb = g.sim.recentHits[g.sim.recentHits.length - 1];
      if (kb) run.killers.push(`${kb.rare ? "Rare " : ""}${kb.species}`);
    }
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
        // A unique's mods are fixed, not rolled from the pool, so it counts by name only.
        if (item.rarity === "unique") run.uniques[item.name!] = (run.uniques[item.name!] ?? 0) + 1;
        else for (const a of item.affixes) run.affixes[a.affixId] = (run.affixes[a.affixId] ?? 0) + 1;
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
    // After the boss: a few seconds to sweep the payout off the floor, then home.
    if (clearedAt >= 0 && (g.sim.tick - clearedAt > 60 * HZ || !bot.hasLootLeft())) break;
  }
  if (!run.cleared) {
    run.seconds = (g.sim.tick - start) / HZ;
    run.stuck = sess(g).area === "map";
  }
  unhook();
  run.levelEnd = progress(g).level;
  run.gold = progress(g).gold - goldStart;
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

/** What a caster wants from a stat, per point; anything unlisted is worth nothing. The stock refit, every class. */
const STAT_WEIGHT: Record<string, number> = {
  maxLife: 1, energyShield: 1, spellDamagePct: 2, castSpeedPct: 2, critChancePct: 0.5,
  fireResPct: 0.5, coldResPct: 0.5, lightningResPct: 0.5, chaosResPct: 0.3,
  armour: 0.1, armourPct: 0.3, maxMana: 0.3, manaRegenPct: 0.3, strength: 0.3,
  allElementalResPct: 1.5, attackFireDamage: 1, attackColdDamage: 1,
};

/**
 * What each class's own kit wants, per point (the three balance pilots' weights,
 * 4 Nov). A flat point of elemental on every attack is 2/15 to 2/16 of a starter
 * weapon's hit, so it weighs like 12-13 points of increased damage.
 */
const CLASS_WEIGHT: Record<string, Record<string, number>> = {
  "class.emberbound": { ...STAT_WEIGHT, fireDamage: 2, coldDamage: 1.5, energyShieldPct: 0.5 },
  "class.stalker": {
    maxLife: 1, energyShield: 1, spellDamagePct: 1.5, critChancePct: 0.4, strength: 0.6,
    fireResPct: 0.5, coldResPct: 0.5, lightningResPct: 0.5, chaosResPct: 0.3, allElementalResPct: 1.5,
    armour: 0.1, armourPct: 0.3, energyShieldPct: 0.3, maxMana: 0.4, manaRegenPct: 0.4, castSpeedPct: 0.1,
    attackFireDamage: 13, attackColdDamage: 13,
  },
  "class.ironsworn": {
    maxLife: 1, strength: 2, energyShield: 0.8, spellDamagePct: 1, critChancePct: 0.15,
    fireResPct: 0.4, coldResPct: 0.4, lightningResPct: 0.4, chaosResPct: 0.2, allElementalResPct: 1.2,
    armour: 0.15, armourPct: 0.4, maxMana: 0.2, manaRegenPct: 0.1, castSpeedPct: 0.3,
    attackFireDamage: 12, attackColdDamage: 12,
  },
};
/** What each class holds in its hands; any other hand piece scores -Infinity. */
const HANDS: Record<string, ReadonlySet<string>> = {
  "class.emberbound": new Set(["wand", "focus", "shield"]),
  "class.stalker": new Set(["bow", "quiver"]),
  "class.ironsworn": new Set(["mace", "sword", "shield"]),
};
const HAND_CLASSES = new Set(["wand", "focus", "shield", "quiver", "mace", "sword", "bow"]);
/** Local weapon stats: an attack weapon's own damage, counted once through `weaponDamage`. */
const LOCAL_WEAPON = new Set(["physicalDamage", "physicalDamagePct", "fireDamage", "coldDamage"]);

/** An attack weapon's damage per second over the class's starting weapon's, x100. A bow's beat is its cooldown, so speed is left out. */
function weaponPoints(classId: string, item: Item): number {
  const rate = (it: Item) => {
    const w = weaponDamage(it);
    return (w.physMin + w.physMax + 2 * (w.fire + w.cold)) * (baseOf(it.baseId).itemClass === "bow" ? 1 : w.aps);
  };
  const start = CLASSES[classId]?.startingGear.weapon1;
  const base = start ? rate({ baseId: start, rarity: "normal", itemLevel: 1, affixes: [] }) : 0;
  return base > 0 ? (100 * rate(item)) / base : 0;
}

/**
 * How much a piece is worth to a class. `caster` is the stock refit's one table for
 * every class (the parity of record); `class` is the class's own kit's.
 */
export function gearScore(classId: string, item: Item, mode: "caster" | "class" = "class"): number {
  if (mode === "caster") return itemStatMods(item).reduce((a, m) => a + (STAT_WEIGHT[m.stat] ?? 0) * m.value, 0);
  const cls = baseOf(item.baseId).itemClass;
  if (HAND_CLASSES.has(cls) && !HANDS[classId]?.has(cls)) return -Infinity;
  const attack = ATTACK_WEAPON_CLASSES.has(cls);
  const w = CLASS_WEIGHT[classId] ?? STAT_WEIGHT;
  const stats = itemStatMods(item).reduce((a, m) => a + (attack && LOCAL_WEAPON.has(m.stat) ? 0 : (w[m.stat] ?? 0) * m.value), 0);
  return attack ? stats + weaponPoints(classId, item) : stats;
}

/**
 * The hideout visit: wear every upgrade in the bag (through the real equipItem
 * command), then empty the bag of equipment. Emptying stands in for the vendor
 * and the stash, which change nothing a map run measures. A piece that would push
 * the other hand off counts that hand's loss, and nothing ever empties the main hand.
 */
export function refit(g: Game, mode: "caster" | "class" = "caster"): void {
  const inv = () => g.world.get<InventoryC>(g.session, "inventory")!;
  const score = (it: Item) => gearScore(g.classId, it, mode);
  // equipItem refuses an unread piece; the bot reads every drop for free, standing in for its scrolls.
  const read = inv().items.map((p) => { const { unidentified: _u, ...item } = p.item; return { ...p, item }; });
  g.world.set<InventoryC>(g.session, "inventory", { ...inv(), items: read });
  for (const placed of [...inv().items]) {
    if (placed.item.waystone || isCurrency(placed.item)) continue;
    const cls = baseOf(placed.item.baseId).itemClass;
    const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
    const gainAt = (sl: EquipSlotId): number => {
      const other = sl === "weapon1" ? "weapon2" : sl === "weapon2" ? "weapon1" : undefined;
      const held = other ? worn[other] : undefined;
      const heldCls = held ? baseOf(held.baseId).itemClass : undefined;
      const clash = held && (sl === "weapon1" ? handsClash(cls, heldCls) : handsClash(heldCls, cls));
      if (clash && other === "weapon1") return -Infinity;
      return score(placed.item) - (worn[sl] ? score(worn[sl]!) : 0) - (clash ? score(held) : 0);
    };
    const slots = (EQUIP_SLOTS_BY_CLASS[cls] ?? []) as EquipSlotId[];
    // The stock refit takes the first slot it beats; a class kit the slot it beats most.
    const slot = mode === "caster"
      ? slots.find((sl) => gainAt(sl) > 0)
      : slots.filter((sl) => gainAt(sl) > 0).sort((a, b) => gainAt(b) - gainAt(a))[0];
    if (!slot) continue;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "equipItem", slot, data: { x: placed.x, y: placed.y } }]);
  }
  const kept = inv().items.filter((p) => p.item.waystone || isCurrency(p.item));
  g.world.set<InventoryC>(g.session, "inventory", { ...inv(), items: kept });
}

/**
 * The kit's bar, as a player re-binds it when a skill opens: the first six unlocked
 * kit skills in the five numbered sockets and the free mouse one, move on the left
 * button, the class's free attack on the right.
 */
function slotKit(g: Game): void {
  const level = progress(g).level;
  const kit = KITS[g.classId]!.bar.filter((id) => isUnlocked(SKILLS.get(id)!, level, g.classId));
  const bar: (string | null)[] = new Array(SKILL_SLOT_COUNT).fill(null);
  const sockets = [0, 1, 2, 3, 4, MOUSE_SLOT_BASE + 1];
  kit.slice(0, sockets.length).forEach((id, i) => { bar[sockets[i]!] = id; });
  bar[MOUSE_SLOT_BASE] = MOVE_SOCKET;
  bar[MOUSE_SLOT_BASE + 2] = DEFAULT_ATTACK_BY_CLASS[g.classId]!;
  g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "setSkillBar", bar }]);
}

// ── Opening a map ────────────────────────────────────────────────────────────

/**
 * Use the best stone on the lowest-tier node not yet cleared, falling back to the
 * highest cleared one the stone opens (PoE1's rule: you can always go back), so one
 * lost map does not send the climb back to tier 1. Returns false when no stone
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
      const byTier = atlasNodeTier(graph, a.id) - atlasNodeTier(graph, b.id);
      return ca - cb || (ca === 1 ? -byTier : byTier);
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

// ── Damage dealt, by skill ──────────────────────────────────────────────────

/**
 * Wraps the sim's enqueueDamage to name the skill behind every hit on a monster
 * (the Emberbound pilot's meter, 4 Nov). Read-only: the event goes through as it
 * came. A bolt is named by his projectile in flight carrying that amount, an impact
 * by his skill area resolving this tick with it, a pulse by its ground area, a
 * burning tick by the skill on the ailment. Returns the unhook.
 */
function meterDealt(g: Game, dealt: Record<string, number>): () => void {
  const sim = g.sim;
  const orig = sim.enqueueDamage;
  sim.enqueueDamage = (ev) => {
    const w = g.world;
    if (w.has(ev.target, "monster")) {
      let key = "other";
      if (ev.source === ev.target) key = ev.skillId ?? `dot.${ev.ailment ?? "burning"}`;
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
      dealt[key] = (dealt[key] ?? 0) + ev.amountFixed / 1000;
    }
    orig.call(sim, ev);
  };
  return () => { sim.enqueueDamage = orig; };
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

