import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import {
  AILMENT_TICK_INTERVAL, refreshBurning, burningTickDamage, applySingleAilment, dotTickDamage, type AilmentState,
  FREEZE_DECAY_TICKS, freezeBuildup, freezeBuildupAt, shockChancePct,
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
  it("poison takes 50% of a physical or chaos hit for 2 s", () => {
    expect(applySingleAilment("poison", undefined, fp(10), "chaos", 5)).toEqual({ dpsFixed: fp(5), expiryTick: 65 });
    expect(applySingleAilment("poison", undefined, fp(10), "physical", 5)).toEqual({ dpsFixed: fp(5), expiryTick: 65 });
  });

  it("bleeding takes 40% of a physical hit for 5 s", () => {
    expect(applySingleAilment("bleeding", undefined, fp(10), "physical", 0)).toEqual({ dpsFixed: fp(4), expiryTick: 150 });
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
    expect(applySingleAilment("poison", live, fp(10), "chaos", 20)).toEqual({ dpsFixed: fp(5), expiryTick: 80 });
    expect(applySingleAilment("poison", live, fp(20), "chaos", 20)).toEqual({ dpsFixed: fp(10), expiryTick: 80 });
  });
});

describe("dotTickDamage", () => {
  it("is one interval's share of the dps, truncated", () => {
    expect(dotTickDamage(fp(2))).toBe(Math.trunc(fp(2) * AILMENT_TICK_INTERVAL / 30));
    expect(dotTickDamage(7)).toBe(1);
  });
});

describe("freeze buildup", () => {
  it("freezes once cold damage worth FREEZE_LIFE_PCT of max life has landed, in any number of hits", () => {
    const life = fp(100);
    expect(freezeBuildup(0, fp(15), life)).toBe(50);
    expect(freezeBuildup(50, fp(15), life)).toBe(100);
    expect(freezeBuildup(90, fp(60), life)).toBe(100);
    // Three hits of exactly a third: rounded up, the meter fills.
    expect([1, 2, 3].reduce((pct) => freezeBuildup(pct, fp(10), life), 0)).toBe(100);
  });

  it("starts over when the last cold hit is older than the decay window", () => {
    const life = fp(100);
    expect(freezeBuildupAt({ pct: 80, tick: 100 }, fp(3), life, 100 + FREEZE_DECAY_TICKS)).toBe(90);
    expect(freezeBuildupAt({ pct: 80, tick: 100 }, fp(3), life, 101 + FREEZE_DECAY_TICKS)).toBe(10);
  });
});

describe("shock chance", () => {
  it("is certain for a hit worth SHOCK_LIFE_PCT of max life and proportional below", () => {
    const life = fp(100);
    expect(shockChancePct(fp(40), life)).toBe(100);
    expect(shockChancePct(fp(80), life)).toBe(100);
    expect(shockChancePct(fp(10), life)).toBe(25);
    expect(shockChancePct(0, life)).toBe(0);
  });
});
