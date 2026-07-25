import { describe, it, expect } from "vitest";
import { Simulation } from "../loop";
import { registerPickupSystem } from "./pickup";
import type { Item } from "@exiled/content-schema";

const ITEM: Item = { baseId: "b0", rarity: "normal", itemLevel: 65, affixes: [] };

function setup(playerXY: [number, number], itemXY: [number, number], invItems: unknown[] = []) {
  const sim = new Simulation();
  registerPickupSystem(sim);
  const w = sim.world;
  const player = w.create();
  w.set(player, "position", { x: playerXY[0], y: playerXY[1] });
  const s = w.create();
  w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, waystoneSeed: 0, waystones: [], areaTier: 5, activeNodeId: "n", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
  w.set(s, "inventory", { cols: 12, rows: 5, items: invItems });
  const ge = w.create();
  w.set(ge, "position", { x: itemXY[0], y: itemXY[1] });
  w.set(ge, "item", { item: ITEM, w: 2, h: 2 });
  return { sim, w, player, sessionE: s, ge };
}

const pickup = (player: number, entityId: number) => ({ tick: 0, entity: player, type: "pickupItem", data: { entityId } });

describe("registerPickupSystem", () => {
  it("moves an in-range ground item into the inventory and destroys it", () => {
    const { sim, w, player, sessionE, ge } = setup([1000, 1000], [1001, 1001]);
    sim.step([pickup(player, ge)]);
    expect(w.alive.has(ge)).toBe(false);
    const inv = w.get(sessionE, "inventory") as { items: unknown[] };
    expect(inv.items.length).toBe(1);
  });

  it("is a no-op when the item is out of range", () => {
    const { sim, w, player, sessionE, ge } = setup([0, 0], [1_000_000, 1_000_000]);
    sim.step([pickup(player, ge)]);
    expect(w.alive.has(ge)).toBe(true);
    expect((w.get(sessionE, "inventory") as { items: unknown[] }).items.length).toBe(0);
  });

  it("is a no-op with no ownership change when the grid is full", () => {
    const full = [{ x: 0, y: 0, w: 12, h: 5, item: ITEM }];
    const { sim, w, player, sessionE, ge } = setup([1000, 1000], [1001, 1001], full);
    sim.step([pickup(player, ge)]);
    expect(w.alive.has(ge)).toBe(true);
    expect((w.get(sessionE, "inventory") as { items: unknown[] }).items.length).toBe(1);
  });
});
