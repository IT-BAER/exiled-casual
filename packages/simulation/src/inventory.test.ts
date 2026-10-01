import { describe, it, expect } from "vitest";
import { placeFirstFit, sortInventory } from "./inventory";
import type { PlacedItem } from "./components";
import type { InventoryC } from "./components";
import type { Item } from "@exiled/content-schema";

const ITEM: Item = { baseId: "b0", rarity: "normal", itemLevel: 65, affixes: [] };
const empty = (): InventoryC => ({ cols: 12, rows: 5, items: [] });

describe("placeFirstFit", () => {
  it("places the first item at the top-left", () => {
    expect(placeFirstFit(empty(), 2, 2)).toEqual({ x: 0, y: 0 });
  });

  it("places the next item beside an occupied one", () => {
    const inv = empty();
    inv.items.push({ x: 0, y: 0, w: 2, h: 2, item: ITEM });
    expect(placeFirstFit(inv, 2, 2)).toEqual({ x: 2, y: 0 });
  });

  it("does not place a piece that would overflow the width", () => {
    const inv: InventoryC = { cols: 3, rows: 5, items: [] };
    expect(placeFirstFit(inv, 4, 1)).toBeNull();
  });

  it("returns null when the grid is full", () => {
    const inv: InventoryC = { cols: 2, rows: 2, items: [{ x: 0, y: 0, w: 2, h: 2, item: ITEM }] };
    expect(placeFirstFit(inv, 1, 1)).toBeNull();
  });
});

describe("sortInventory", () => {
  const gear = (baseId: string, rarity: Item["rarity"], w: number, h: number, x: number, y: number): PlacedItem =>
    ({ x, y, w, h, item: { baseId, rarity, itemLevel: 10, affixes: [] } });
  const coin = (baseId: string, count: number, x: number, y: number): PlacedItem =>
    ({ x, y, w: 1, h: 1, count, item: { baseId, rarity: "normal", itemLevel: 1, affixes: [] } });
  const stone = (tier: number, x: number, y: number): PlacedItem =>
    ({ x, y, w: 1, h: 1, item: { baseId: "map.waystone", rarity: "normal", itemLevel: 1, affixes: [], waystone: { seed: tier, tier } } });
  const bag = (items: PlacedItem[]): InventoryC => ({ cols: 12, rows: 5, items });
  const at = (inv: InventoryC, baseId: string) => inv.items.filter((p) => p.item.baseId === baseId);

  const messy = () => bag([
    coin("currency.wisdom", 3, 11, 4),
    gear("base.ironsworn_helm", "normal", 2, 2, 9, 0),
    stone(2, 5, 4),
    gear("base.ironsworn_plate", "rare", 2, 3, 6, 1),
    coin("currency.wisdom", 4, 0, 4),
    gear("base.ironsworn_hammer", "unique", 1, 3, 3, 0),
    stone(5, 7, 4),
    gear("base.ironsworn_helm", "unique", 2, 2, 0, 0),
  ]);

  it("merges same currency into one stack and keeps every other piece", () => {
    const out = sortInventory(messy())!;
    expect(at(out, "currency.wisdom")).toHaveLength(1);
    expect(at(out, "currency.wisdom")[0]!.count).toBe(7);
    expect(out.items).toHaveLength(7);
  });

  it("orders weapon, helmets (unique first), body, then currency, then waystones high tier first", () => {
    const out = sortInventory(messy())!;
    expect(out.items.map((p) => p.item.waystone ? `stone${p.item.waystone.tier}` : `${p.item.baseId}:${p.item.rarity}`)).toEqual([
      "base.ironsworn_hammer:unique",
      "base.ironsworn_helm:unique",
      "base.ironsworn_helm:normal",
      "base.ironsworn_plate:rare",
      "currency.wisdom:normal",
      "stone5",
      "stone2",
    ]);
  });

  it("gear fills from the left edge, currency and waystones from the right", () => {
    const out = sortInventory(messy())!;
    expect(out.items.slice(4).map((p) => [p.x, p.y])).toEqual([[11, 0], [11, 1], [11, 2]]);
  });

  it("packs column by column from the left, with no overlaps", () => {
    const out = sortInventory(messy())!;
    expect(out.items.find((p) => p.item.baseId === "base.ironsworn_hammer")).toMatchObject({ x: 0, y: 0 });
    for (const [i, a] of out.items.entries()) {
      for (const b of out.items.slice(i + 1)) {
        const clear = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(clear).toBe(true);
      }
    }
  });

  it("a sorted bag sorts to itself", () => {
    const once = sortInventory(messy())!;
    expect(sortInventory(once)).toEqual(once);
  });

  it("refuses, rather than drops, a bag it cannot repack", () => {
    // Two 2x3 bodies cannot both stand in a 2x5 grid: null, never one of them dropped.
    const tight: InventoryC = { cols: 2, rows: 6, items: [
      gear("base.ironsworn_plate", "normal", 2, 3, 0, 0),
      gear("base.ironsworn_plate", "normal", 2, 3, 0, 3),
    ] };
    expect(sortInventory({ ...tight, rows: 5 })).toBeNull();
  });

  const order = (inv: InventoryC) =>
    inv.items.map((p) => p.item.waystone ? `stone${p.item.waystone.tier}` : `${p.item.baseId}:${p.item.rarity}`);
  const noOverlaps = (inv: InventoryC) => {
    for (const [i, a] of inv.items.entries())
      for (const b of inv.items.slice(i + 1))
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
  };

  it("by rarity: uniques first, then rare, magic, normal, packed row by row from the top left", () => {
    const out = sortInventory(messy(), "rarity")!;
    expect(order(out)).toEqual([
      "base.ironsworn_hammer:unique",
      "base.ironsworn_helm:unique",
      "base.ironsworn_plate:rare",
      "base.ironsworn_helm:normal",
      "currency.wisdom:normal",
      "stone5",
      "stone2",
    ]);
    expect(out.items.slice(0, 3).map((p) => [p.x, p.y])).toEqual([[0, 0], [1, 0], [3, 0]]);
    noOverlaps(out);
    expect(sortInventory(out, "rarity")).toEqual(out);
  });

  it("by size: largest footprint first, row by row from the top left", () => {
    const out = sortInventory(messy(), "size")!;
    expect(order(out)).toEqual([
      "base.ironsworn_plate:rare",
      "base.ironsworn_helm:unique",
      "base.ironsworn_helm:normal",
      "base.ironsworn_hammer:unique",
      "currency.wisdom:normal",
      "stone5",
      "stone2",
    ]);
    expect(out.items.slice(0, 4).map((p) => [p.x, p.y])).toEqual([[0, 0], [2, 0], [4, 0], [6, 0]]);
    noOverlaps(out);
    expect(sortInventory(out, "size")).toEqual(out);
  });
});
