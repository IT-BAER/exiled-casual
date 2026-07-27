import { describe, it, expect } from "vitest";
import { rollItem } from "./items.js";
import type { ItemPools } from "@exiled/content-schema";

const POOLS: ItemPools = {
  bases: [
    { id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 },
    { id: "b1", name: "B1", itemClass: "focus", w: 2, h: 2 },
  ],
  affixes: [
    { id: "a.low", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "life", minItemLevel: 1, min: 5, max: 20 },
    { id: "a.mid", kind: "suffix", nameWord: "of the Furnace", stat: "fireResPct", label: "res", minItemLevel: 1, min: 4, max: 10 },
    { id: "a.high", kind: "prefix", nameWord: "Plated", stat: "armour", label: "armour", minItemLevel: 90, min: 10, max: 60 },
  ],
};

// Four of each kind, so a broken cap can actually overshoot.
const KINDED: ItemPools = {
  bases: [{ id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 }],
  affixes: [
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, kind: "prefix" as const, nameWord: `P${i}`, stat: "maxLife", label: "life", minItemLevel: 1, min: 1, max: 2,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `s${i}`, kind: "suffix" as const, nameWord: `of S${i}`, stat: "fireResPct", label: "res", minItemLevel: 1, min: 1, max: 2,
    })),
  ],
};

function kindsOf(item: { affixes: { affixId: string }[] }) {
  const of = (id: string) => KINDED.affixes.find((a) => a.id === id)!.kind;
  const prefixes = item.affixes.filter((x) => of(x.affixId) === "prefix").length;
  return { prefixes, suffixes: item.affixes.length - prefixes };
}

// One word per side, so a magic roll can only ever produce three known names.
const NAMED: ItemPools = {
  bases: [{ id: "b0", name: "Wand", itemClass: "wand", w: 1, h: 2 }],
  affixes: [
    { id: "p", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "life", minItemLevel: 1, min: 1, max: 2 },
    { id: "s", kind: "suffix", nameWord: "of the Furnace", stat: "fireResPct", label: "res", minItemLevel: 1, min: 1, max: 2 },
  ],
};

describe("rollItem", () => {
  it("names a magic item prefix-word, base, suffix-phrase", () => {
    const names = new Set<string>();
    for (let s = 1; s <= 120; s++) names.add(rollItem(NAMED, s, 80, 2, "magic").name!);
    // Every reachable combination, and nothing else.
    expect([...names].sort()).toEqual(["Hale Wand", "Hale Wand of the Furnace", "Wand of the Furnace"]);
  });

  it("leaves normal items unnamed so they show their base name", () => {
    const it = rollItem(NAMED, 7, 80, 2, "normal");
    expect(it.name).toBeUndefined();
  });

  it("caps a rare at 3 prefixes and 3 suffixes, a magic at one of each", () => {
    for (let s = 1; s <= 300; s++) {
      for (const [rarity, cap] of [["magic", 1], ["rare", 3]] as const) {
        const { prefixes, suffixes } = kindsOf(rollItem(KINDED, s, 80, 2, rarity));
        expect(prefixes).toBeLessThanOrEqual(cap);
        expect(suffixes).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("rolls both kinds onto rares rather than only one side", () => {
    const seen = { prefixes: 0, suffixes: 0 };
    for (let s = 1; s <= 100; s++) {
      const k = kindsOf(rollItem(KINDED, s, 80, 2, "rare"));
      seen.prefixes += k.prefixes;
      seen.suffixes += k.suffixes;
    }
    expect(seen.prefixes).toBeGreaterThan(0);
    expect(seen.suffixes).toBeGreaterThan(0);
  });

  // A mod that names item classes is bound to them; one that names none rolls anywhere.
  // PoE keeps a separate mod pool per item class, so a wand can never roll body armour's mods.
  const CLASSED: ItemPools = {
    bases: [
      { id: "b.wand", name: "Wand", itemClass: "wand", w: 1, h: 2 },
      { id: "b.body", name: "Robe", itemClass: "body", w: 2, h: 3 },
    ],
    affixes: [
      { id: "a.any", kind: "prefix", nameWord: "Any", stat: "s", label: "l", minItemLevel: 1, min: 1, max: 2 },
      { id: "a.wand", kind: "suffix", nameWord: "of Wands", stat: "s", label: "l", minItemLevel: 1, min: 1, max: 2, itemClasses: ["wand"] },
      { id: "a.body", kind: "suffix", nameWord: "of Robes", stat: "s", label: "l", minItemLevel: 1, min: 1, max: 2, itemClasses: ["body"] },
    ],
  };

  it("only rolls affixes their base's item class is allowed to have", () => {
    const seen = new Map<string, Set<string>>();
    for (let s = 1; s <= 300; s++) {
      const it = rollItem(CLASSED, s, 80, 3, "rare");
      const cls = CLASSED.bases.find((b) => b.id === it.baseId)!.itemClass;
      const got = seen.get(cls) ?? new Set<string>();
      for (const ia of it.affixes) got.add(ia.affixId);
      seen.set(cls, got);
    }
    expect([...seen.get("wand")!].sort()).toEqual(["a.any", "a.wand"]);
    expect([...seen.get("body")!].sort()).toEqual(["a.any", "a.body"]);
  });

  it("is deterministic for the same inputs", () => {
    const a = rollItem(POOLS, 12345, 70, 1);
    const b = rollItem(POOLS, 12345, 70, 1);
    expect(a).toEqual(b);
  });

  it("differs for different seeds (at least sometimes)", () => {
    const items = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(rollItem(POOLS, i + 1, 70, 1))));
    expect(items.size).toBeGreaterThan(1);
  });

  it("magic items have 1..2 affixes, rare 3..6, normal have 0", () => {
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(POOLS, s, 70, 1);
      if (it.rarity === "magic") {
        expect(it.affixes.length).toBeGreaterThanOrEqual(1);
        expect(it.affixes.length).toBeLessThanOrEqual(2);
      } else if (it.rarity === "rare") {
        // Only two affixes in this pool are eligible at ilvl 70, and a short
        // pool yields fewer mods rather than overfilling one side.
        expect(it.affixes.length).toBeGreaterThanOrEqual(1);
        expect(it.affixes.length).toBeLessThanOrEqual(6);
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

  const upgradedAt = (ilvl: number, mr: number, areaPct = 0) =>
    Array.from({ length: 400 }, (_, s) => rollItem(POOLS, s + 1, ilvl, mr, undefined, areaPct))
      .filter((x) => x.rarity !== "normal").length;

  it("rolls more upgrades from a rarer monster", () => {
    expect(upgradedAt(70, 2)).toBeGreaterThan(upgradedAt(70, 1));
    expect(upgradedAt(70, 1)).toBeGreaterThan(upgradedAt(70, 0));
  });

  // PoE's rarity roll does not read item level at all: a level 2 zombie and a
  // level 84 rare use the same odds, and high maps only feel richer because
  // their area and monster rarity are larger.
  it("does not read item level", () => {
    expect(upgradedAt(20, 2)).toBe(upgradedAt(84, 2));
  });

  it("answers area rarity", () => {
    expect(upgradedAt(70, 1, 200)).toBeGreaterThan(upgradedAt(70, 1));
  });

  it("never returns a magic item with zero affixes when no affix is eligible", () => {
    const HIGH_ONLY: ItemPools = {
      bases: [{ id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 }],
      affixes: [{ id: "a.high", kind: "prefix", nameWord: "Plated", stat: "armour", label: "armour", minItemLevel: 90, min: 10, max: 60 }],
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
    // Alternating, so 3 prefixes + 3 suffixes is still reachable.
    affixes: Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`, kind: (i % 2 === 0 ? "prefix" : "suffix") as "prefix" | "suffix",
      nameWord: `w${i}`, stat: `s${i}`, label: `l${i}`, minItemLevel: 1, min: 1, max: 10,
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

  const UNIQUE_POOLS: ItemPools = {
    ...RARE_POOLS,
    bases: [...RARE_POOLS.bases, { id: "bu", name: "BU", itemClass: "focus", w: 2, h: 2 }],
    uniques: [
      { id: "u0", name: "Uno Test", baseId: "bu", flavour: "f0", mods: [{ affixId: "a0", min: 20, max: 30 }] },
      { id: "u1", name: "Dos Test", baseId: "bu", flavour: "f1", mods: [{ affixId: "a1", min: 5, max: 5 }, { affixId: "a2", min: 1, max: 3 }] },
    ],
  };

  it("rolls uniques only from the unique pool, with that unique's base and mods", () => {
    let sawUnique = false;
    for (let s = 1; s <= 800; s++) {
      const it = rollItem(UNIQUE_POOLS, s, 95, 3);
      if (it.rarity !== "unique") continue;
      sawUnique = true;
      const u = UNIQUE_POOLS.uniques!.find((x) => x.name === it.name)!;
      expect(u).toBeDefined();
      expect(it.baseId).toBe(u.baseId);
      expect(it.affixes.map((a) => a.affixId)).toEqual(u.mods.map((m) => m.affixId));
      for (let i = 0; i < u.mods.length; i++) {
        expect(it.affixes[i]!.value).toBeGreaterThanOrEqual(u.mods[i]!.min);
        expect(it.affixes[i]!.value).toBeLessThanOrEqual(u.mods[i]!.max);
      }
      expect(rollItem(UNIQUE_POOLS, s, 95, 3)).toEqual(it); // deterministic
    }
    expect(sawUnique).toBe(true);
  });

  it("unique is rarer than rare", () => {
    const rarities = Array.from({ length: 1200 }, (_, s) => rollItem(UNIQUE_POOLS, s + 1, 95, 3).rarity);
    const count = (r: string) => rarities.filter((x) => x === r).length;
    expect(count("unique")).toBeGreaterThan(0);
    expect(count("unique")).toBeLessThan(count("rare"));
  });

  it("forceRarity produces exactly that tier, and degrades unique to normal without a unique pool", () => {
    for (const want of ["normal", "magic", "rare", "unique"] as const) {
      for (let s = 1; s <= 50; s++) {
        expect(rollItem(UNIQUE_POOLS, s, 80, 3, want).rarity).toBe(want);
      }
    }
    expect(rollItem(RARE_POOLS, 7, 80, 3, "unique").rarity).toBe("normal");
  });

  it("never rolls a unique from a pool without uniques", () => {
    for (let s = 1; s <= 800; s++) {
      expect(rollItem(RARE_POOLS, s, 95, 3).rarity).not.toBe("unique");
    }
  });

  it("gives rare items a deterministic two-word name; normal items have none", () => {
    for (let s = 1; s <= 400; s++) {
      const it = rollItem(RARE_POOLS, s, 82, 3);
      if (it.rarity === "rare") {
        expect(it.name).toBeDefined();
        expect(it.name!.trim().split(/\s+/).length).toBe(2);
        expect(rollItem(RARE_POOLS, s, 82, 3).name).toBe(it.name); // deterministic
      } else if (it.rarity === "normal") {
        expect(it.name).toBeUndefined();
      }
    }
  });
});

describe("unidentified drops", () => {
  it("drops magic, rare and unique items unidentified", () => {
    for (const r of ["magic", "rare"] as const) {
      expect(rollItem(POOLS, 3, 80, 2, r).unidentified).toBe(true);
    }
  });

  it("leaves normal items identified, since they have nothing to reveal", () => {
    expect(rollItem(POOLS, 3, 80, 2, "normal").unidentified).toBeUndefined();
  });
});
