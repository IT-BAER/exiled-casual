// DEV-only cheats and inspection for the release playtest: put the world into any
// state in one message instead of farming it. The worker accepts them only in a
// dev build (sim-worker.ts); nothing in normal play calls this module.
import { ITEM_POOLS, baseOf, currencyItem, waystoneItem } from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import { MAP_PORTALS, type DevOp } from "@exiled/protocol";
import { atlasGraph, magicName, mapSeedFor, rollItem } from "@exiled/rules";
import { spawnPortalRing } from "./areas";
import type { InventoryC, ProgressC, SessionC } from "./components";
import { recomputePlayerStats } from "./derived";
import type { World } from "./ecs";
import { placeFirstFit } from "./inventory";
import { grantSkills } from "./persist";

export function applyDevOp(world: World, op: DevOp): void {
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
    case "dump":
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
