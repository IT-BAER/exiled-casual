import { describe, it, expect } from "vitest";
import {
  areaLevel, monsterTierScale, offerWaystones, atlasNodes, WAYSTONE_OFFER_COUNT,
} from "./atlas.js";

describe("atlas rules", () => {
  it("areaLevel is 64 + tier", () => {
    expect(areaLevel(1)).toBe(65);
    expect(areaLevel(15)).toBe(79);
  });

  it("monsterTierScale is per-mille, 1.0 at tier 0", () => {
    expect(monsterTierScale(0)).toEqual({ lifeMilli: 1000, dmgMilli: 1000 });
    expect(monsterTierScale(10)).toEqual({ lifeMilli: 2500, dmgMilli: 2000 });
  });

  it("offerWaystones is deterministic for a seed", () => {
    const a = offerWaystones(42, WAYSTONE_OFFER_COUNT);
    const b = offerWaystones(42, WAYSTONE_OFFER_COUNT);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    for (const w of a) {
      expect(w.tier).toBeGreaterThanOrEqual(1);
      expect(w.tier).toBeLessThanOrEqual(15);
      expect(Number.isInteger(w.seed)).toBe(true);
    }
    expect(new Set(a.map((w) => w.id)).size).toBe(3); // ids unique
  });

  it("different seeds usually differ", () => {
    expect(offerWaystones(1, 3)).not.toEqual(offerWaystones(2, 3));
  });

  it("atlasNodes is a fixed non-empty list with unique ids", () => {
    const n = atlasNodes();
    expect(n.length).toBeGreaterThanOrEqual(3);
    expect(new Set(n.map((x) => x.id)).size).toBe(n.length);
  });
});
