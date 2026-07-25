import { describe, it, expect } from "vitest";
import { rollItem } from "@exiled/rules";
import { ITEM_POOLS } from "@exiled/content-runtime";

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

describe("shipped affix pool", () => {
  it("carries enough of each side for a rare to fill PoE's 3 prefixes + 3 suffixes", () => {
    const best = { prefixes: 0, suffixes: 0 };
    let full = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const s = sides(rollItem(ITEM_POOLS, seed, 80, 3, "rare"));
      best.prefixes = Math.max(best.prefixes, s.prefixes);
      best.suffixes = Math.max(best.suffixes, s.suffixes);
      if (s.prefixes === 3 && s.suffixes === 3) full++;
    }
    expect(best).toEqual({ prefixes: 3, suffixes: 3 });
    expect(full).toBeGreaterThan(0);
  });
});
