import { describe, it, expect } from "vitest";
import {
  START_LEVEL, MAX_LEVEL,
  xpToNext, monsterXp, xpPenaltyPct, xpAward, levelBonus, gainXp,
} from "./xp";

describe("xpToNext", () => {
  it("rises with level and is zero at the cap", () => {
    expect(xpToNext(START_LEVEL)).toBe(60_000);
    expect(xpToNext(START_LEVEL + 1)).toBe(100_000);
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
    expect(levelBonus(START_LEVEL + 10)).toEqual({ maxLife: 60, maxMana: 20 });
  });
});

describe("gainXp", () => {
  it("accumulates below the threshold", () => {
    expect(gainXp(65, 0, 2600)).toEqual({ level: 65, xp: 2600 });
  });

  it("levels up and carries the remainder", () => {
    expect(gainXp(65, 59_000, 2000)).toEqual({ level: 66, xp: 1000 });
  });

  it("handles a single award crossing several levels", () => {
    // 60k (65→66) + 100k (66→67) = 160k, leaving 40k on level 67.
    expect(gainXp(65, 0, 200_000)).toEqual({ level: 67, xp: 40_000 });
  });

  it("stops dead at the cap instead of banking unusable xp", () => {
    expect(gainXp(MAX_LEVEL, 0, 999_999)).toEqual({ level: MAX_LEVEL, xp: 0 });
  });
});
