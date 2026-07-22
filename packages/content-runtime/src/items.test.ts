import { describe, it, expect } from "vitest";
import { ITEM_POOLS, baseOf, describeItem } from "./items.js";

describe("ITEM_POOLS", () => {
  it("has bases and affixes with positive base dimensions", () => {
    expect(ITEM_POOLS.bases.length).toBeGreaterThan(0);
    expect(ITEM_POOLS.affixes.length).toBeGreaterThan(0);
    for (const b of ITEM_POOLS.bases) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });
});

describe("describeItem", () => {
  it("names a normal item by its base and lists no affix lines", () => {
    const base = ITEM_POOLS.bases[0]!;
    const d = describeItem({ baseId: base.id, rarity: "normal", itemLevel: 65, affixes: [] });
    expect(d.name).toBe(base.name);
    expect(d.rarity).toBe("normal");
    expect(d.lines).toEqual([]);
  });
  it("formats magic affix lines as value + label", () => {
    const base = ITEM_POOLS.bases[0]!;
    const affix = ITEM_POOLS.affixes[0]!;
    const d = describeItem({ baseId: base.id, rarity: "magic", itemLevel: 65, affixes: [{ affixId: affix.id, value: 12 }] });
    expect(d.lines).toEqual([`+12 ${affix.label}`]);
  });
});

describe("baseOf", () => {
  it("throws on an unknown base id", () => {
    expect(() => baseOf("base.nope")).toThrow();
  });
});
