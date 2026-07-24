import { describe, it, expect } from "vitest";
import { placeFirstFit } from "./inventory";
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
