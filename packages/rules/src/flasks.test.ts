import { describe, it, expect } from "vitest";
import { flaskRecovery, bossChargeSteps, FLASK_RECOVERY_PCT } from "./flasks.js";

describe("flaskRecovery", () => {
  it("returns 30% of max floored", () => {
    expect(flaskRecovery(100)).toBe(30);
    expect(flaskRecovery(33)).toBe(Math.floor((33 * FLASK_RECOVERY_PCT) / 100));
  });

  it("is never negative for max 0", () => {
    expect(flaskRecovery(0)).toBe(0);
  });
});

describe("bossChargeSteps", () => {
  const max = 1000;

  it("pays nothing for a hit that stays inside one tenth", () => {
    expect(bossChargeSteps(1000, 950, max)).toBe(0);
  });

  it("pays one charge for the tenth a hit crosses", () => {
    expect(bossChargeSteps(910, 890, max)).toBe(1);
  });

  it("pays for every tenth a single large hit crosses", () => {
    expect(bossChargeSteps(1000, 700, max)).toBe(2);
  });

  it("pays nothing for the killing blow — death.ts pays that one", () => {
    expect(bossChargeSteps(50, 0, max)).toBe(0);
  });

  it("never goes negative", () => {
    expect(bossChargeSteps(0, 0, max)).toBe(0);
    expect(bossChargeSteps(100, 200, max)).toBe(0); // healed, not hit
  });

  it("is inert without a maximum", () => {
    expect(bossChargeSteps(10, 0, 0)).toBe(0);
  });
});
