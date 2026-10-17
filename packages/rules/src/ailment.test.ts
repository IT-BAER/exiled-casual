import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import {
  AILMENT_TICK_INTERVAL, refreshBurning, burningTickDamage, applySingleAilment, dotTickDamage, type AilmentState,
} from "./ailment.js";

describe("AILMENT_TICK_INTERVAL", () => {
  it("=== 6", () => {
    expect(AILMENT_TICK_INTERVAL).toBe(6);
  });
});

describe("refreshBurning", () => {
  it("from undefined: stacks === addStacks, expiryTick === nowTick + durationTicks", () => {
    const result = refreshBurning(undefined, 2, fp(8), 10, 60, 5);
    expect(result.kind).toBe("burning");
    expect(result.stacks).toBe(2);
    expect(result.dpsFixed).toBe(fp(8));
    expect(result.expiryTick).toBe(70); // 10 + 60
  });

  it("caps stacks at maxStacks", () => {
    const result = refreshBurning(undefined, 10, fp(8), 0, 60, 5);
    expect(result.stacks).toBe(5);
  });

  it("accumulates stacks on second refresh", () => {
    const first = refreshBurning(undefined, 3, fp(8), 0, 60, 5);
    const second = refreshBurning(first, 2, fp(8), 30, 60, 5);
    expect(second.stacks).toBe(5); // 3 + 2 = 5, below cap
    expect(second.expiryTick).toBe(90); // 30 + 60
  });

  it("second refresh updates expiryTick and caps stacks", () => {
    const first = refreshBurning(undefined, 4, fp(8), 0, 60, 5);
    const second = refreshBurning(first, 3, fp(8), 50, 60, 5); // 4 + 3 = 7, capped at 5
    expect(second.stacks).toBe(5);
    expect(second.expiryTick).toBe(110); // 50 + 60
  });

  it("does not mutate prev AilmentState", () => {
    const prev: AilmentState = { kind: "burning", stacks: 2, dpsFixed: fp(8), expiryTick: 60 };
    const prevStacks = prev.stacks;
    refreshBurning(prev, 1, fp(8), 0, 60, 5);
    expect(prev.stacks).toBe(prevStacks);
  });
});

describe("burningTickDamage", () => {
  it("stacks=3, dps=fp(8): trunc(3 * 8000 * 6 / 30) === 4800", () => {
    const a: AilmentState = { kind: "burning", stacks: 3, dpsFixed: fp(8), expiryTick: 999 };
    // 3 * 8000 * 6 / 30 = 144000 / 30 = 4800
    expect(burningTickDamage(a)).toBe(4800);
  });

  it("stacks=1, dps=fp(30): trunc(1 * 30000 * 6 / 30) === 6000", () => {
    const a: AilmentState = { kind: "burning", stacks: 1, dpsFixed: fp(30), expiryTick: 999 };
    expect(burningTickDamage(a)).toBe(6000);
  });
});

describe("applySingleAilment (poison, bleeding)", () => {
  it("poison takes 50% of a physical or chaos hit for 5 s", () => {
    expect(applySingleAilment("poison", undefined, fp(10), "chaos", 5)).toEqual({ dpsFixed: fp(5), expiryTick: 155 });
    expect(applySingleAilment("poison", undefined, fp(10), "physical", 5)).toEqual({ dpsFixed: fp(5), expiryTick: 155 });
  });

  it("bleeding takes 60% of a physical hit for 7 s", () => {
    expect(applySingleAilment("bleeding", undefined, fp(10), "physical", 0)).toEqual({ dpsFixed: fp(6), expiryTick: 210 });
  });

  it("a hit of the wrong type carries nothing", () => {
    expect(applySingleAilment("poison", undefined, fp(10), "fire", 0)).toBeUndefined();
    expect(applySingleAilment("bleeding", undefined, fp(10), "chaos", 0)).toBeUndefined();
    const live = { dpsFixed: fp(1), expiryTick: 30 };
    expect(applySingleAilment("bleeding", live, fp(10), "cold", 0)).toBe(live);
  });

  it("a weaker hit leaves the live one alone; a stronger or equal one replaces and refreshes", () => {
    const live = { dpsFixed: fp(5), expiryTick: 30 };
    expect(applySingleAilment("poison", live, fp(5), "chaos", 20)).toBe(live);
    expect(applySingleAilment("poison", live, fp(10), "chaos", 20)).toEqual({ dpsFixed: fp(5), expiryTick: 170 });
    expect(applySingleAilment("poison", live, fp(20), "chaos", 20)).toEqual({ dpsFixed: fp(10), expiryTick: 170 });
  });
});

describe("dotTickDamage", () => {
  it("is one interval's share of the dps, truncated", () => {
    expect(dotTickDamage(fp(2))).toBe(Math.trunc(fp(2) * AILMENT_TICK_INTERVAL / 30));
    expect(dotTickDamage(7)).toBe(1);
  });
});
