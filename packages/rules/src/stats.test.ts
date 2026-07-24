import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { StatBlock, baseCasterStats, RES_CAP, ARMOUR_K } from "./stats.js";

describe("constants", () => {
  it("RES_CAP === 75", () => {
    expect(RES_CAP).toBe(75);
  });

  it("ARMOUR_K === fp(10) === 10000", () => {
    expect(ARMOUR_K).toBe(10000);
    expect(ARMOUR_K).toBe(fp(10));
  });
});

describe("baseCasterStats", () => {
  it("returns exact contract values", () => {
    const s: StatBlock = baseCasterStats();
    expect(s.maxLifeFixed).toBe(fp(100));        // 100000
    expect(s.maxManaFixed).toBe(fp(60));          // 60000
    expect(s.manaRegenPerSecFixed).toBe(fp(6));   // 6000
    expect(s.moveSpeedFixed).toBe(fp(4.2));       // 4200
    expect(s.fireResPct).toBe(0);
    expect(s.armourFixed).toBe(fp(0));            // 0
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = baseCasterStats();
    const b = baseCasterStats();
    expect(a).not.toBe(b);
  });
});
