import { describe, it, expect } from "vitest";
import {
  BASE_DROP_PCT, MONSTER_QUANTITY_PCT, MONSTER_RARITY_PCT, MONSTER_ILVL_OFFSET,
  playerScaleMilli, quantityScaleMilli, rarityScaleMilli, dropCount,
  DROP_POOL, BOSS_DROP_POOL, dropCategory,
} from "./loot.js";

describe("playerScaleMilli", () => {
  // The two data points PoE's wiki publishes for the player channel's
  // diminishing returns: 50% quantity is worth 1.35x, 200% is worth 1.77x.
  // Anything claiming to be that curve has to hit both.
  it("reproduces the published 50% and 200% data points", () => {
    expect(playerScaleMilli(50)).toBe(1357);
    expect(playerScaleMilli(200)).toBe(1769);
  });

  it("is 1x at zero and never falls below it", () => {
    expect(playerScaleMilli(0)).toBe(1000);
    expect(playerScaleMilli(-50)).toBe(1000);
  });

  it("never reaches the linear value, and saturates below 2.25x", () => {
    expect(playerScaleMilli(100)).toBeLessThan(2000);
    expect(playerScaleMilli(10000)).toBeLessThan(2250);
  });

  it("is monotonic", () => {
    for (let p = 1; p < 500; p++) {
      expect(playerScaleMilli(p)).toBeGreaterThanOrEqual(playerScaleMilli(p - 1));
    }
  });

  // 0.9.9: "diminishing returns ... affects the less common ones more", so the
  // curve a tier uses is a knob, and a smaller one bites sooner.
  it("bites harder with a smaller constant", () => {
    expect(playerScaleMilli(200, 60)).toBeLessThan(playerScaleMilli(200, 125));
  });
});

describe("monster stat blocks", () => {
  // PoE's hidden MonsterMagic/MonsterRare/MonsterUnique mods, indexed
  // normal, magic, rare, unique.
  it("carries PoE's own datamined values", () => {
    expect(MONSTER_QUANTITY_PCT).toEqual([0, 600, 1400, 2850]);
    expect(MONSTER_RARITY_PCT).toEqual([0, 200, 1000, 1000]);
    expect(MONSTER_ILVL_OFFSET).toEqual([0, 1, 2, 2]);
  });
});

describe("quantityScaleMilli", () => {
  it("is 1x for a normal monster with no modifiers", () => {
    expect(quantityScaleMilli(0, 0, 0)).toBe(1000);
  });

  it("scales the monster channel linearly, with no diminishing returns", () => {
    expect(quantityScaleMilli(1, 0, 0)).toBe(7000);
    expect(quantityScaleMilli(2, 0, 0)).toBe(15000);
    expect(quantityScaleMilli(3, 0, 0)).toBe(29500);
  });

  it("multiplies the channels instead of adding them", () => {
    // 100% area and 100% player is not 3x: area is linear (2x), the player
    // channel is diminished to 1.555x, and the two multiply out to 3.110x.
    expect(playerScaleMilli(100)).toBe(1555);
    expect(quantityScaleMilli(0, 100, 100)).toBe(3110);
  });
});

describe("rarityScaleMilli", () => {
  it("gives a rare monster PoE's 11x and a boss the same", () => {
    expect(rarityScaleMilli(2, 0, 0)).toBe(11000);
    expect(rarityScaleMilli(3, 0, 0)).toBe(11000);
  });

  it("puts the player's rarity through diminishing returns too", () => {
    expect(rarityScaleMilli(0, 0, 200)).toBe(1769);
  });
});

describe("dropCategory", () => {
  const share = (pool: { currency: number; equipment: number }) =>
    Array.from({ length: 1000 }, (_, r) => dropCategory(r, pool)).filter((c) => c === "currency").length;

  it("splits an ordinary kill toward currency", () => {
    expect(share(DROP_POOL)).toBe(600);
  });

  it("splits a boss toward equipment", () => {
    expect(share(BOSS_DROP_POOL)).toBe(400);
  });
});

describe("dropCount", () => {
  const counts = (mr: number, quantityMilli = 1000) =>
    Array.from({ length: 1000 }, (_, roll) => dropCount(roll, mr, quantityMilli));
  const mean = (mr: number, q = 1000) => counts(mr, q).reduce((a, b) => a + b, 0) / 1000;

  it("pays a normal monster the calibrated base chance and nothing more", () => {
    const c = counts(0);
    expect(Math.max(...c)).toBe(1);
    expect(mean(0)).toBeCloseTo(BASE_DROP_PCT / 100, 2);
  });

  it("pays whole items plus one rolled remainder, PoE's own overflow rule", () => {
    // A rare's 2.1 expected items is always 2, and 10% of the time 3.
    const c = counts(2);
    expect(Math.min(...c)).toBe(2);
    expect(Math.max(...c)).toBe(3);
    expect(mean(2)).toBeCloseTo(2.1, 2);
  });

  it("pays a boss twice what a rare pays", () => {
    expect(mean(3) / mean(2)).toBeCloseTo(29.5 / 15, 1);
  });

  it("answers area and player quantity", () => {
    expect(mean(2, 2000)).toBeCloseTo(4.2, 1);
  });
});
