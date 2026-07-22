import { describe, it, expect } from "vitest";
import { rollItem } from "./items.js";
import type { ItemPools } from "@pact/content-schema";

const POOLS: ItemPools = {
  bases: [
    { id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 },
    { id: "b1", name: "B1", itemClass: "focus", w: 2, h: 2 },
  ],
  affixes: [
    { id: "a.low", stat: "maxLife", label: "life", minItemLevel: 1, min: 5, max: 20 },
    { id: "a.mid", stat: "maxMana", label: "mana", minItemLevel: 1, min: 4, max: 10 },
    { id: "a.high", stat: "armour", label: "armour", minItemLevel: 90, min: 10, max: 60 },
  ],
};

describe("rollItem", () => {
  it("is deterministic for the same inputs", () => {
    const a = rollItem(POOLS, 12345, 70, 1);
    const b = rollItem(POOLS, 12345, 70, 1);
    expect(a).toEqual(b);
  });

  it("differs for different seeds (at least sometimes)", () => {
    const items = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(rollItem(POOLS, i + 1, 70, 1))));
    expect(items.size).toBeGreaterThan(1);
  });

  it("magic items have 1..2 affixes, normal have 0", () => {
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(POOLS, s, 70, 1);
      if (it.rarity === "magic") {
        expect(it.affixes.length).toBeGreaterThanOrEqual(1);
        expect(it.affixes.length).toBeLessThanOrEqual(2);
      } else {
        expect(it.affixes.length).toBe(0);
      }
    }
  });

  it("never rolls an affix above the item level", () => {
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(POOLS, s, 70, 2);
      expect(it.affixes.some((x) => x.affixId === "a.high")).toBe(false);
    }
  });

  it("rolls more magic at higher ilvl / monsterRarity", () => {
    const magicAt = (ilvl: number, mr: number) =>
      Array.from({ length: 400 }, (_, s) => rollItem(POOLS, s + 1, ilvl, mr))
        .filter((x) => x.rarity === "magic").length;
    expect(magicAt(79, 2)).toBeGreaterThan(magicAt(65, 1));
  });

  it("affix values fall within the affix range", () => {
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(POOLS, s, 70, 2);
      for (const ia of it.affixes) {
        const a = POOLS.affixes.find((x) => x.id === ia.affixId)!;
        expect(ia.value).toBeGreaterThanOrEqual(a.min);
        expect(ia.value).toBeLessThanOrEqual(a.max);
      }
    }
  });
});
