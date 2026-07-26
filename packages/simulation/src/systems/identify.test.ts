import { describe, it, expect } from "vitest";
import { Simulation } from "../loop";
import { registerIdentifySystem } from "./identify";
import { wisdomScroll } from "@exiled/content-runtime";
import type { InventoryC } from "../components";
import type { Item } from "@exiled/content-schema";

const UNREAD: Item = {
  baseId: "base.emberwand", rarity: "rare", itemLevel: 80, name: "Corpse Husk",
  affixes: [{ affixId: "affix.life", value: 33 }], unidentified: true,
};

/** A rare at (4,0) and, unless suppressed, a stack of scrolls at (0,0). */
function setup(scrolls: number) {
  const sim = new Simulation();
  registerIdentifySystem(sim);
  const w = sim.world;
  const player = w.create();
  const s = w.create();
  const items = [{ x: 4, y: 0, w: 1, h: 2, item: UNREAD }];
  if (scrolls > 0) items.unshift({ x: 0, y: 0, w: 1, h: 1, item: wisdomScroll(), count: scrolls } as never);
  w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, waystoneSeed: 0, waystones: [], areaTier: 5, activeNodeId: "n", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
  w.set(s, "inventory", { cols: 12, rows: 5, items });
  return { sim, w, sessionE: s, player };
}

const identify = (player: number, x: number, y: number) => ({ tick: 0, entity: player, type: "identifyItem", data: { x, y } });
const inv = (w: { get: (e: number, c: string) => unknown }, s: number) => w.get(s, "inventory") as InventoryC;

describe("registerIdentifySystem", () => {
  it("reveals the item and spends one scroll off the stack", () => {
    const { sim, w, sessionE, player } = setup(3);
    sim.step([identify(player, 4, 0)]);
    const after = inv(w, sessionE);
    expect(after.items.find((p) => p.x === 4)!.item.unidentified).toBeUndefined();
    expect(after.items.find((p) => p.x === 0)!.count).toBe(2);
  });

  it("clears the cell when the last scroll is spent", () => {
    const { sim, w, sessionE, player } = setup(1);
    sim.step([identify(player, 4, 0)]);
    const after = inv(w, sessionE);
    expect(after.items.length).toBe(1);
    expect(after.items[0]!.item.unidentified).toBeUndefined();
  });

  it("leaves the item unread when there is no scroll to spend", () => {
    const { sim, w, sessionE, player } = setup(0);
    sim.step([identify(player, 4, 0)]);
    expect(inv(w, sessionE).items[0]!.item.unidentified).toBe(true);
  });

  it("spends nothing on an already-identified item", () => {
    const { sim, w, sessionE, player } = setup(3);
    sim.step([identify(player, 4, 0)]);
    sim.step([identify(player, 4, 0)]);
    expect(inv(w, sessionE).items.find((p) => p.x === 0)!.count).toBe(2);
  });

  it("ignores a cell that holds nothing", () => {
    const { sim, w, sessionE, player } = setup(3);
    sim.step([identify(player, 9, 3)]);
    expect(inv(w, sessionE).items.find((p) => p.x === 0)!.count).toBe(3);
  });
});
