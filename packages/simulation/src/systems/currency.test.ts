import { describe, it, expect } from "vitest";
import { currencyItem } from "@exiled/content-runtime";
import { World } from "../ecs";
import { Simulation } from "../loop";
import { registerCurrencySystem } from "./currency";
import type { InventoryC, SessionC, PlacedItem } from "../components";

/** A session holding `items`, plus the system under test. */
function bench(items: PlacedItem[]): { sim: Simulation; world: World; inv: () => InventoryC } {
  const sim = new Simulation();
  const { world } = sim;
  const e = world.create();
  world.set<SessionC>(e, "session", {
    area: "map", atlasSeed: 1, mapSeed: 1, waystoneSeed: 0, waystones: [], areaTier: 1,
    activeNodeId: "", completedNodes: [], portalsLeft: 1, mapOpen: 0, pendingArea: "",
  });
  world.set<InventoryC>(e, "inventory", { cols: 12, rows: 5, items });
  registerCurrencySystem(sim);
  return { sim, world, inv: () => world.get<InventoryC>(e, "inventory")! };
}

const cell = (x: number, y: number, item: PlacedItem["item"], count?: number): PlacedItem =>
  ({ x, y, w: 1, h: 1, item, ...(count === undefined ? {} : { count }) });

const wand = (over: Partial<PlacedItem["item"]> = {}) => ({
  baseId: "base.emberwand", rarity: "normal" as const, itemLevel: 20, affixes: [], ...over,
});

const apply = (sim: Simulation, from: [number, number], to: [number, number]) =>
  sim.step([{ tick: 1, entity: 0, type: "applyCurrency", data: { fromX: from[0], fromY: from[1], x: to[0], y: to[1] } }]);

describe("currency system", () => {
  it("spends one scroll to reveal an unidentified item", () => {
    const { sim, inv } = bench([
      cell(0, 0, currencyItem("currency.wisdom"), 3),
      cell(2, 0, wand({ rarity: "magic", affixes: [{ affixId: "affix.mana", value: 9 }], unidentified: true })),
    ]);
    apply(sim, [0, 0], [2, 0]);
    expect(inv().items[1]!.item.unidentified).toBeUndefined();
    expect(inv().items[0]!.count).toBe(2);
  });

  it("spends one orb to turn a normal item magic", () => {
    const { sim, inv } = bench([
      cell(0, 0, currencyItem("currency.transmutation"), 2),
      cell(2, 0, wand()),
    ]);
    apply(sim, [0, 0], [2, 0]);
    expect(inv().items[1]!.item.rarity).toBe("magic");
    expect(inv().items[1]!.item.affixes).toHaveLength(1);
    expect(inv().items[0]!.count).toBe(1);
  });

  it("removes the stack when the last unit is spent", () => {
    const { sim, inv } = bench([
      cell(0, 0, currencyItem("currency.transmutation"), 1),
      cell(2, 0, wand()),
    ]);
    apply(sim, [0, 0], [2, 0]);
    expect(inv().items).toHaveLength(1);
    expect(inv().items[0]!.item.rarity).toBe("magic");
  });

  it("charges nothing when the transition refuses the target", () => {
    // Embers adds to a rare; a normal item is not a legal target for it.
    const { sim, inv } = bench([
      cell(0, 0, currencyItem("currency.embers"), 2),
      cell(2, 0, wand()),
    ]);
    apply(sim, [0, 0], [2, 0]);
    expect(inv().items[0]!.count).toBe(2);
    expect(inv().items[1]!.item.rarity).toBe("normal");
  });

  it("never spends currency on currency", () => {
    const { sim, inv } = bench([
      cell(0, 0, currencyItem("currency.transmutation"), 2),
      cell(2, 0, currencyItem("currency.wisdom"), 5),
    ]);
    apply(sim, [0, 0], [2, 0]);
    expect(inv().items[0]!.count).toBe(2);
    expect(inv().items[1]!.count).toBe(5);
  });

  it("ignores a source cell that holds no currency", () => {
    const { sim, inv } = bench([cell(0, 0, wand()), cell(2, 0, wand())]);
    apply(sim, [0, 0], [2, 0]);
    expect(inv().items.every((p) => p.item.rarity === "normal")).toBe(true);
  });

  it("is deterministic: the same tick and cells craft the same item", () => {
    const roll = () => {
      const { sim, inv } = bench([
        cell(0, 0, currencyItem("currency.alchemy"), 1),
        cell(2, 0, wand()),
      ]);
      apply(sim, [0, 0], [2, 0]);
      return inv().items[0]!.item;
    };
    expect(roll()).toEqual(roll());
  });
});
