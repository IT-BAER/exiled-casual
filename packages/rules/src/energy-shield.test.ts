import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import {
  absorbWithEnergyShield, esRechargePerTick,
  ES_RECHARGE_PCT_PER_SEC, ES_CHAOS_MULT,
} from "./energy-shield.js";

describe("absorbWithEnergyShield", () => {
  it("a full shield eats the whole hit", () => {
    expect(absorbWithEnergyShield(fp(30), fp(100), false)).toEqual({ toLife: 0, esCost: fp(30) });
  });

  it("an overflowing hit spills the remainder onto life", () => {
    expect(absorbWithEnergyShield(fp(30), fp(10), false)).toEqual({ toLife: fp(20), esCost: fp(10) });
  });

  it("chaos drains the shield twice as fast for the same stopping power", () => {
    // 10 shield stops only 5 chaos damage, and is emptied doing it.
    expect(absorbWithEnergyShield(fp(30), fp(10), true))
      .toEqual({ toLife: fp(25), esCost: fp(10) });
    expect(absorbWithEnergyShield(fp(5), fp(100), true))
      .toEqual({ toLife: 0, esCost: fp(5) * ES_CHAOS_MULT });
  });

  it("no shield means the hit lands untouched", () => {
    expect(absorbWithEnergyShield(fp(30), 0, false)).toEqual({ toLife: fp(30), esCost: 0 });
  });
});

describe("esRechargePerTick", () => {
  it("refills the pool in eight seconds, as an integer", () => {
    const max = fp(1000);
    const perTick = esRechargePerTick(max);
    expect(perTick).toBe(Math.trunc((max * ES_RECHARGE_PCT_PER_SEC) / 1000 / 30));
    expect(perTick * 30 * 8).toBeCloseTo(max, -3);
  });

  it("a pool too small to divide recharges at zero rather than fractionally", () => {
    expect(esRechargePerTick(1)).toBe(0);
  });
});
