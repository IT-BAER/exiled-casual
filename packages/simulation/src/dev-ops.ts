// DEV-only cheats and inspection for the release playtest: put the world into any
// state in one message instead of farming it. The worker accepts them only in a
// dev build (sim-worker.ts); nothing in normal play calls this module.
import { ITEM_POOLS, MONSTERS, baseOf, currencyItem, waystoneItem } from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import { fp, type Fixed } from "@exiled/fixed-point";
import { MAP_PORTALS, type DevOp } from "@exiled/protocol";
import { atlasGraph, magicName, mapSeedFor, rollItem } from "@exiled/rules";
import { spawnPortalRing } from "./areas";
import type { BossC, Health, InventoryC, MonsterC, MoveTarget, PlayerC, Position, ProgressC, SessionC } from "./components";
import { recomputePlayerStats } from "./derived";
import type { World } from "./ecs";
import { placeFirstFit } from "./inventory";
import { grantSkills } from "./persist";

/** Whether a body of radius `r` fits at (x, y): the area's collision, which only the worker holds. */
type Walkable = (x: Fixed, y: Fixed, r: Fixed) => boolean;

export function applyDevOp(world: World, op: DevOp, walkable?: Walkable): void {
  const sessionE = world.query("session")[0];
  if (sessionE === undefined) return;
  const session = world.get<SessionC>(sessionE, "session")!;
  switch (op.op) {
    case "setLevel": {
      const p = world.get<ProgressC>(sessionE, "progress")!;
      world.set<ProgressC>(sessionE, "progress", { ...p, level: Math.max(1, Math.min(100, Math.trunc(op.level))), xp: 0 });
      recomputePlayerStats(world, { refill: true });
      grantSkills(world);
      return;
    }
    case "setGold": {
      const p = world.get<ProgressC>(sessionE, "progress")!;
      world.set<ProgressC>(sessionE, "progress", { ...p, gold: Math.max(0, Math.trunc(op.gold)) });
      return;
    }
    case "grantItem":
      put(world, sessionE, buildItem(op));
      return;
    case "grantCurrency": {
      const inv = world.get<InventoryC>(sessionE, "inventory")!;
      const at = inv.items.findIndex((p) => p.item.baseId === op.baseId);
      if (at !== -1) {
        const items = [...inv.items];
        items[at] = { ...items[at]!, count: (items[at]!.count ?? 1) + op.count };
        world.set<InventoryC>(sessionE, "inventory", { ...inv, items });
      } else {
        put(world, sessionE, currencyItem(op.baseId), op.count);
      }
      return;
    }
    case "grantWaystone":
      put(world, sessionE, waystoneItem(op.seed ?? 1, op.tier));
      return;
    case "openAtlas":
      world.set<SessionC>(sessionE, "session", { ...session, completedNodes: atlasGraph(session.atlasSeed).map((n) => n.id) });
      return;
    case "teleport": {
      // activateMap's session write without its stone, fog and tier rules.
      if (session.area !== "hideout") return;
      const seed = op.seed ?? 1;
      world.set<SessionC>(sessionE, "session", {
        ...session,
        mapSeed: mapSeedFor(seed, op.atlasNodeId),
        waystoneSeed: seed,
        areaTier: op.tier ?? 1,
        activeNodeId: op.atlasNodeId,
        portalsLeft: MAP_PORTALS,
        mapOpen: 1,
        pendingArea: "map",
      });
      spawnPortalRing(world, MAP_PORTALS);
      return;
    }
    case "toHideout":
      if (session.area !== "hideout") world.set<SessionC>(sessionE, "session", { ...session, pendingArea: "hideout" });
      return;
    case "boss":
      readyBoss(world, op.phase, walkable);
      return;
    case "dump":
      return;
  }
}

/** Eight ways round a boss, unit vectors x1000: literals, like the sim's rings. */
const AROUND: readonly (readonly [number, number])[] = [
  [1000, 0], [707, 707], [0, 1000], [-707, 707], [-1000, 0], [-707, -707], [0, -1000], [707, -707],
];
/** How far off the boss the player is put: inside its wake radius (10) and every kit's reach. */
const BESIDE_BOSS = fp(7);

/**
 * The area's boss made ready to show `phase`: back in phase 1 with every attack off
 * cooldown and nothing rooted, its life just under that phase's line so it crosses
 * into it on its next ticks, and the player put beside it on open floor, the way
 * he already stood first so the camera does not swing across the arena.
 */
function readyBoss(world: World, phase: 1 | 2 | 3, walkable?: Walkable): void {
  const boss = world.query("boss", "monster", "position", "health")[0];
  const player = world.query("player", "position")[0];
  if (boss === undefined || player === undefined) return;
  const spec = MONSTERS.get(world.get<MonsterC>(boss, "monster")!.defId)?.boss;
  if (!spec) return;
  const h = world.get<Health>(boss, "health")!;
  const line = phase === 3 ? spec.phase3AtLifePct ?? spec.phase2AtLifePct : spec.phase2AtLifePct;
  world.set<Health>(boss, "health", { ...h, life: phase === 1 ? h.maxLife : Math.trunc((h.maxLife * (line - 1)) / 100) });
  const { volleyAbility: _a, volleyLeft: _l, volleyAtTick: _t, ...b } = world.get<BossC>(boss, "boss")!;
  world.set<BossC>(boss, "boss", { ...b, phase: 1, nextAbilityTick: 0, rootedUntilTick: 0, abilityReadyTicks: [], broodAtTick: 0 });
  // Its phase-2 entry raises adds again, on top of any the last call raised.
  for (const m of world.query("monster").filter((m) => world.get<MonsterC>(m, "monster")!.summoned === 1)) world.destroy(m);
  const bp = world.get<Position>(boss, "position")!;
  const pp = world.get<Position>(player, "position")!;
  const r = world.get<PlayerC>(player, "player")?.bodyRadius ?? fp(0.4);
  const toward = ([dx, dy]: readonly [number, number]) => dx * (pp.x - bp.x) + dy * (pp.y - bp.y);
  for (const [dx, dy] of [...AROUND].sort((a, c) => toward(c) - toward(a))) {
    const x = bp.x + Math.trunc((dx * BESIDE_BOSS) / 1000);
    const y = bp.y + Math.trunc((dy * BESIDE_BOSS) / 1000);
    if (walkable && !walkable(x, y, r)) continue;
    world.set<Position>(player, "position", { x, y });
    const target = world.get<MoveTarget>(player, "moveTarget");
    if (target) world.set<MoveTarget>(player, "moveTarget", { x, y, active: 0 });
    return;
  }
}

/** Every component on the player and the session singleton, as plain data. */
export function devDump(world: World, tick: number): unknown {
  const player = world.query("player")[0];
  const sessionE = world.query("session")[0];
  const of = (e: number | undefined) =>
    e === undefined ? {} : Object.fromEntries(world.componentNames().filter((c) => world.has(e, c)).map((c) => [c, world.get(e, c)]));
  return { tick, player: of(player), session: of(sessionE) };
}

function buildItem(op: Extract<DevOp, { op: "grantItem" }>): Item {
  const unique = op.uniqueId ? ITEM_POOLS.uniques?.find((u) => u.id === op.uniqueId) : undefined;
  const baseId = unique?.baseId ?? op.baseId;
  const pools = { ...ITEM_POOLS, bases: ITEM_POOLS.bases.filter((b) => b.id === baseId), uniques: unique ? [unique] : [] };
  const item = rollItem(pools, op.seed ?? 1, op.itemLevel ?? 80, 3, op.rarity);
  if (op.affixes) {
    item.affixes = op.affixes.map((a) => ({ ...a }));
    if (item.rarity === "magic") item.name = magicName(ITEM_POOLS, baseOf(baseId).name, item.affixes);
  }
  delete item.unidentified;
  return item;
}

function put(world: World, sessionE: number, item: Item, count?: number): void {
  const inv = world.get<InventoryC>(sessionE, "inventory")!;
  const base = baseOf(item.baseId);
  const cell = placeFirstFit(inv, base.w, base.h);
  if (!cell) return;
  world.set<InventoryC>(sessionE, "inventory", {
    ...inv,
    items: [...inv.items, { ...cell, w: base.w, h: base.h, item, ...(count !== undefined ? { count } : {}) }],
  });
}
