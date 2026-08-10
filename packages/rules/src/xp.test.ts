import { describe, it, expect } from "vitest";
import {
  START_LEVEL, MAX_LEVEL,
  xpToNext, monsterXp, xpPenaltyPct, xpAward, levelBonus, gainXp,
} from "./xp";

describe("xpToNext", () => {
  it("rises with level and is zero at the cap", () => {
    expect(xpToNext(START_LEVEL)).toBe(30);
    expect(xpToNext(START_LEVEL + 1)).toBe(120);
    expect(xpToNext(MAX_LEVEL)).toBe(0);
  });
});

describe("monsterXp", () => {
  it("scales with area level and pays rares and bosses more", () => {
    expect(monsterXp(65, "normal")).toBe(65);
    expect(monsterXp(65, "rare")).toBe(520);
    expect(monsterXp(65, "boss")).toBe(2600);
    expect(monsterXp(79, "normal")).toBe(79);
  });
});

describe("xpPenaltyPct", () => {
  it("pays in full inside the tolerance band, then decays to a floor", () => {
    expect(xpPenaltyPct(65, 65)).toBe(100);
    expect(xpPenaltyPct(65, 68)).toBe(100);
    expect(xpPenaltyPct(65, 69)).toBe(90);
    expect(xpPenaltyPct(65, 74)).toBe(40);
    // Symmetric: outlevelling an area costs the same as overreaching one.
    expect(xpPenaltyPct(75, 65)).toBe(30);
    expect(xpPenaltyPct(65, 99)).toBe(10);
  });
});

describe("xpAward", () => {
  it("is the monster's value after the level-difference penalty, as an integer", () => {
    expect(xpAward(65, 65, "boss")).toBe(2600);
    // areaLevel 69 boss = 2760 at 90% = 2484
    expect(xpAward(65, 69, "boss")).toBe(2484);
    expect(Number.isInteger(xpAward(65, 71, "normal"))).toBe(true);
  });
});

describe("levelBonus", () => {
  it("grants nothing at the starting level and grows from there", () => {
    expect(levelBonus(START_LEVEL)).toEqual({ maxLife: 0, maxMana: 0 });
    expect(levelBonus(START_LEVEL + 10)).toEqual({ maxLife: 21, maxMana: 7 });
  });
});

describe("a character starts at 1 and climbs to 100", () => {
  it("starts at level 1", () => {
    expect(START_LEVEL).toBe(1);
  });

  it("levels fast at the start and slowly at the end", () => {
    expect(xpToNext(1)).toBeLessThan(100);
    expect(xpToNext(50)).toBeGreaterThan(xpToNext(49));
    expect(xpToNext(99)).toBeGreaterThan(100_000);
    expect(xpToNext(100)).toBe(0);
  });

  it("is monotonic, so no level is ever cheaper than the one before it", () => {
    // Stop short of the cap: xpToNext(100) is deliberately 0 ("nothing to
    // buy" once you're done), not a cheaper level-up.
    for (let lv = 1; lv < MAX_LEVEL - 1; lv++) {
      expect(xpToNext(lv + 1)).toBeGreaterThanOrEqual(xpToNext(lv));
    }
  });

  it("returns whole numbers only", () => {
    for (let lv = 1; lv <= 100; lv++) {
      expect(Number.isSafeInteger(xpToNext(lv))).toBe(true);
    }
  });

  it("hands out the same total life and mana across the longer climb", () => {
    // 210 life and 70 mana was the whole-climb total at 65-100. Keep the total,
    // spread it over 99 levels, or every level-up silently gets stronger.
    expect(levelBonus(100)).toEqual({ maxLife: 210, maxMana: 70 });
    expect(levelBonus(1)).toEqual({ maxLife: 0, maxMana: 0 });
  });

  it("never hands out a fractional pool", () => {
    for (let lv = 1; lv <= 100; lv++) {
      const b = levelBonus(lv);
      expect(Number.isSafeInteger(b.maxLife)).toBe(true);
      expect(Number.isSafeInteger(b.maxMana)).toBe(true);
    }
  });
});

describe("gainXp", () => {
  it("accumulates below the threshold", () => {
    // xpToNext(1) = 30, so 25 stays on level 1.
    expect(gainXp(1, 0, 25)).toEqual({ level: 1, xp: 25 });
  });

  it("levels up and carries the remainder", () => {
    // xpToNext(1) = 30, so 25 + 10 = 35 crosses it with 5 left over.
    expect(gainXp(1, 25, 10)).toEqual({ level: 2, xp: 5 });
  });

  it("handles a single award crossing several levels", () => {
    // 30 (1→2) + 120 (2→3) = 150, leaving 50 on level 3.
    expect(gainXp(1, 0, 200)).toEqual({ level: 3, xp: 50 });
  });

  it("stops dead at the cap instead of banking unusable xp", () => {
    expect(gainXp(MAX_LEVEL, 0, 999_999)).toEqual({ level: MAX_LEVEL, xp: 0 });
  });
});
