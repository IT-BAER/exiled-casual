import { describe, it, expect } from "vitest";
import { applyCurrency } from "./currency.js";
import type { Item, ItemPools } from "@exiled/content-schema";

// Four of each side so a rare can fill its 3+3 and an alchemy can want four.
const POOLS: ItemPools = {
  bases: [{ id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 }],
  affixes: [
    { id: "p1", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "life", minItemLevel: 1, min: 5, max: 20 },
    { id: "p2", kind: "prefix", nameWord: "Runic", stat: "spellDamagePct", label: "spell", minItemLevel: 1, min: 5, max: 20 },
    { id: "p3", kind: "prefix", nameWord: "Beryl", stat: "maxMana", label: "mana", minItemLevel: 1, min: 5, max: 20 },
    { id: "p4", kind: "prefix", nameWord: "Plated", stat: "armour", label: "armour", minItemLevel: 1, min: 5, max: 20 },
    { id: "s1", kind: "suffix", nameWord: "of the Furnace", stat: "fireResPct", label: "fire", minItemLevel: 1, min: 4, max: 10 },
    { id: "s2", kind: "suffix", nameWord: "of the Squall", stat: "coldResPct", label: "cold", minItemLevel: 1, min: 4, max: 10 },
    { id: "s3", kind: "suffix", nameWord: "of Menace", stat: "critChancePct", label: "crit", minItemLevel: 1, min: 4, max: 10 },
    { id: "s4", kind: "suffix", nameWord: "of Casting", stat: "castSpeedPct", label: "cast", minItemLevel: 1, min: 4, max: 10 },
  ],
};

const normal = (): Item => ({ baseId: "b0", rarity: "normal", itemLevel: 20, affixes: [] });
const magic = (n: number): Item => ({
  baseId: "b0", rarity: "magic", itemLevel: 20, name: "Hale B0",
  affixes: [{ affixId: "p1", value: 7 }, { affixId: "s1", value: 5 }].slice(0, n),
});
const rare = (n: number): Item => ({
  baseId: "b0", rarity: "rare", itemLevel: 20, name: "Dread Weaver",
  affixes: [
    { affixId: "p1", value: 7 }, { affixId: "p2", value: 8 }, { affixId: "p3", value: 9 },
    { affixId: "s1", value: 5 }, { affixId: "s2", value: 6 }, { affixId: "s3", value: 4 },
  ].slice(0, n),
});

describe("applyCurrency", () => {
  it("transmutation turns a normal item magic with one modifier", () => {
    const out = applyCurrency(POOLS, "currency.transmutation", normal(), 1)!;
    expect(out.rarity).toBe("magic");
    expect(out.affixes).toHaveLength(1);
  });

  it("transmutation names the magic item after its own modifier", () => {
    const out = applyCurrency(POOLS, "currency.transmutation", normal(), 1)!;
    expect(out.name).toContain("B0");
    expect(out.name).not.toBe("B0");
  });

  it("transmutation refuses anything that is not normal", () => {
    expect(applyCurrency(POOLS, "currency.transmutation", magic(1), 1)).toBeNull();
    expect(applyCurrency(POOLS, "currency.transmutation", rare(3), 1)).toBeNull();
  });

  it("augmentation adds a second modifier to a one-mod magic item", () => {
    const out = applyCurrency(POOLS, "currency.augmentation", magic(1), 3)!;
    expect(out.rarity).toBe("magic");
    expect(out.affixes).toHaveLength(2);
    expect(out.affixes[0]).toEqual({ affixId: "p1", value: 7 });
  });

  it("augmentation refuses a magic item that is already full", () => {
    expect(applyCurrency(POOLS, "currency.augmentation", magic(2), 3)).toBeNull();
  });

  it("elevation makes a magic item rare and keeps its rolls", () => {
    const before = magic(2);
    const out = applyCurrency(POOLS, "currency.elevation", before, 5)!;
    expect(out.rarity).toBe("rare");
    expect(out.affixes).toHaveLength(3);
    expect(out.affixes.slice(0, 2)).toEqual(before.affixes);
    expect(out.name).not.toBe(before.name);
  });

  it("alchemy makes a normal item rare with four fresh modifiers", () => {
    const out = applyCurrency(POOLS, "currency.alchemy", normal(), 7)!;
    expect(out.rarity).toBe("rare");
    expect(out.affixes).toHaveLength(4);
  });

  it("alchemy replaces a magic item's modifiers rather than keeping them", () => {
    // 99 is outside every roll range in the pool, so surviving it means "kept", not "rerolled".
    const before: Item = { ...magic(2), affixes: [{ affixId: "p1", value: 99 }, { affixId: "s1", value: 99 }] };
    const out = applyCurrency(POOLS, "currency.alchemy", before, 9)!;
    expect(out.affixes).toHaveLength(4);
    expect(out.affixes.some((a) => a.value === 99)).toBe(false);
  });

  it("embers adds a modifier to a rare with room left", () => {
    const before = rare(4);
    const out = applyCurrency(POOLS, "currency.embers", before, 11)!;
    expect(out.affixes).toHaveLength(5);
    expect(out.affixes.slice(0, 4)).toEqual(before.affixes);
    expect(out.name).toBe(before.name);
  });

  it("embers refuses a rare with six modifiers", () => {
    expect(applyCurrency(POOLS, "currency.embers", rare(6), 11)).toBeNull();
  });

  it("never overfills one side of a rare", () => {
    // Three prefixes and no suffixes: the next four must all land as suffixes.
    let item: Item = { ...rare(3), affixes: rare(6).affixes.slice(0, 3) };
    for (let i = 0; i < 3; i++) item = applyCurrency(POOLS, "currency.embers", item, 20 + i) ?? item;
    const kinds = item.affixes.map((a) => POOLS.affixes.find((d) => d.id === a.affixId)!.kind);
    expect(kinds.filter((k) => k === "prefix")).toHaveLength(3);
    expect(kinds.filter((k) => k === "suffix")).toHaveLength(3);
  });

  it("wisdom reveals an unidentified item and nothing else", () => {
    const unread: Item = { ...magic(2), unidentified: true };
    const out = applyCurrency(POOLS, "currency.wisdom", unread, 1)!;
    expect(out.unidentified).toBeUndefined();
    expect(out.affixes).toEqual(unread.affixes);
    expect(applyCurrency(POOLS, "currency.wisdom", magic(2), 1)).toBeNull();
  });

  it("refuses to craft on an item that has not been read yet", () => {
    const unread: Item = { ...normal(), unidentified: true };
    expect(applyCurrency(POOLS, "currency.transmutation", unread, 1)).toBeNull();
  });

  it("refuses uniques outright", () => {
    const u: Item = { baseId: "b0", rarity: "unique", itemLevel: 20, name: "Ashmaw", affixes: [] };
    expect(applyCurrency(POOLS, "currency.embers", u, 1)).toBeNull();
  });

  it("is deterministic in its seed", () => {
    expect(applyCurrency(POOLS, "currency.alchemy", normal(), 42))
      .toEqual(applyCurrency(POOLS, "currency.alchemy", normal(), 42));
    expect(applyCurrency(POOLS, "currency.alchemy", normal(), 42))
      .not.toEqual(applyCurrency(POOLS, "currency.alchemy", normal(), 43));
  });

  it("leaves the item it was handed untouched", () => {
    const before = magic(1);
    applyCurrency(POOLS, "currency.augmentation", before, 3);
    expect(before.affixes).toHaveLength(1);
  });

  it("returns null for a currency it does not know", () => {
    expect(applyCurrency(POOLS, "currency.mirror", rare(3), 1)).toBeNull();
  });
});
