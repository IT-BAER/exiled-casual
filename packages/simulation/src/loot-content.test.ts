import { describe, it, expect } from "vitest";
import { rollItem } from "@exiled/rules";
import { ITEM_POOLS, baseOf } from "@exiled/content-runtime";

// Lives here rather than in content-runtime: this is the shipped affix pool run through
// the real generator, and only this package depends on both @exiled/rules and content.

/** Prefix/suffix counts of a rolled item, read back off the shipped affix pool. */
function sides(item: { affixes: { affixId: string }[] }) {
  const kinds = item.affixes.map((ia) => ITEM_POOLS.affixes.find((a) => a.id === ia.affixId)!.kind);
  return {
    prefixes: kinds.filter((k) => k === "prefix").length,
    suffixes: kinds.filter((k) => k === "suffix").length,
  };
}

/** Widest prefix/suffix split any base reached, keyed by base id. */
function bestPerBase(ilvl: number, seeds: number) {
  const best = new Map<string, { prefixes: number; suffixes: number }>();
  for (const b of ITEM_POOLS.bases) best.set(b.id, { prefixes: 0, suffixes: 0 });
  for (let seed = 1; seed <= seeds; seed++) {
    const item = rollItem(ITEM_POOLS, seed, ilvl, 3, "rare");
    const b = best.get(item.baseId)!;
    const s = sides(item);
    b.prefixes = Math.max(b.prefixes, s.prefixes);
    b.suffixes = Math.max(b.suffixes, s.suffixes);
  }
  return best;
}

describe("shipped affix pool", () => {
  // Per base, not just pool-wide: each item class draws from its own slice of the pool,
  // so a pool that is wide overall can still starve one class.
  it("carries enough of each side for every base to fill PoE's 3 prefixes + 3 suffixes", () => {
    for (const ilvl of [1, 80]) {
      for (const [baseId, best] of bestPerBase(ilvl, 2000)) {
        expect({ baseId, ilvl, ...best }).toEqual({ baseId, ilvl, prefixes: 3, suffixes: 3 });
      }
    }
  });

  // The mods PoE would never print on that class: armour on a caster weapon, cast speed
  // on a chest. Both sides matter, so a pool tagged for only one class is not enough.
  it("keeps class-bound mods off the classes that cannot have them", () => {
    const forbidden: Record<string, string[]> = {
      wand: ["affix.armour", "affix.life"],
      focus: ["affix.armour"],
      body: ["affix.cast_speed", "affix.crit_chance"],
      helmet: ["affix.cast_speed", "affix.crit_chance"],
    };
    for (let seed = 1; seed <= 2000; seed++) {
      const item = rollItem(ITEM_POOLS, seed, 80, 3, "rare");
      const banned = forbidden[baseOf(item.baseId).itemClass] ?? [];
      for (const ia of item.affixes) expect(banned).not.toContain(ia.affixId);
    }
  });
});
