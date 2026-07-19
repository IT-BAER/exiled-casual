import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { AILMENT_TICK_INTERVAL, refreshBurning, burningTickDamage, type AilmentState } from "./ailment.js";

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
