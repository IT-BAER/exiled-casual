import { describe, it, expect } from "vitest";
import { rollItem } from "./items.js";
import type { ItemPools } from "@exiled/content-schema";

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

  it("never returns a magic item with zero affixes when no affix is eligible", () => {
    const HIGH_ONLY: ItemPools = {
      bases: [{ id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 }],
      affixes: [{ id: "a.high", stat: "armour", label: "armour", minItemLevel: 90, min: 10, max: 60 }],
    };
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(HIGH_ONLY, s, 65, 2); // ilvl 65 < 90 => nothing eligible
      expect(!(it.rarity === "magic" && it.affixes.length === 0)).toBe(true);
    }
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

  // Pool with enough eligible affixes to exercise a full 3..6 rare roll.
  const RARE_POOLS: ItemPools = {
    bases: [{ id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 }],
    affixes: Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`, stat: `s${i}`, label: `l${i}`, minItemLevel: 1, min: 1, max: 10,
    })),
  };

  it("rolls rare items with 3..6 affixes at high ilvl / monsterRarity", () => {
    let sawRare = false;
    for (let s = 1; s <= 400; s++) {
      const it = rollItem(RARE_POOLS, s, 82, 3);
      if (it.rarity === "rare") {
        sawRare = true;
        expect(it.affixes.length).toBeGreaterThanOrEqual(3);
        expect(it.affixes.length).toBeLessThanOrEqual(6);
      }
    }
    expect(sawRare).toBe(true);
  });

  it("rare is rarer than magic", () => {
    const count = (r: string) =>
      Array.from({ length: 800 }, (_, s) => rollItem(RARE_POOLS, s + 1, 82, 3).rarity)
        .filter((x) => x === r).length;
    expect(count("rare")).toBeGreaterThan(0);
    expect(count("rare")).toBeLessThan(count("magic"));
  });

  it("gives rare items a deterministic two-word name; others have none", () => {
    for (let s = 1; s <= 400; s++) {
      const it = rollItem(RARE_POOLS, s, 82, 3);
      if (it.rarity === "rare") {
        expect(it.name).toBeDefined();
        expect(it.name!.trim().split(/\s+/).length).toBe(2);
        expect(rollItem(RARE_POOLS, s, 82, 3).name).toBe(it.name); // deterministic
      } else {
        expect(it.name).toBeUndefined();
      }
    }
  });
});
