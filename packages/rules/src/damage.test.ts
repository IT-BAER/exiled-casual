import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import type { DamageSpec, Defenses } from "@exiled/content-schema";
import { applyDamage } from "./damage.js";
import { ARMOUR_K } from "./stats.js";

// helpers
const firePkt = (amount: number): DamageSpec => ({ type: "fire", amountFixed: fp(amount) });
const physPkt = (amount: number): DamageSpec => ({ type: "physical", amountFixed: fp(amount) });
const fireDefenses = (res: number): Defenses => ({ fireResPct: res, armourFixed: 0 });
const physDefenses = (armour: number): Defenses => ({ fireResPct: 0, armourFixed: fp(armour) });

describe("applyDamage — fire", () => {
  it("0 res: result === amountFixed", () => {
    const amt = fp(100);
    expect(applyDamage(firePkt(100), fireDefenses(0))).toBe(amt);
  });

  it("50 res: result === trunc(amountFixed / 2)", () => {
    const amt = fp(100);
    expect(applyDamage(firePkt(100), fireDefenses(50))).toBe(Math.trunc(amt / 2));
  });

  it("90 res: capped at RES_CAP=75, result === trunc(amountFixed * 25 / 100)", () => {
    const amt = fp(100);
    const expected = Math.trunc(amt * 25 / 100);
    expect(applyDamage(firePkt(100), fireDefenses(90))).toBe(expected);
  });

  it("result never negative (extreme res)", () => {
    expect(applyDamage(firePkt(1), fireDefenses(100))).toBeGreaterThanOrEqual(0);
  });
});

describe("applyDamage — physical", () => {
  it("armour 0: result === amountFixed", () => {
    const amt = fp(100);
    expect(applyDamage(physPkt(100), physDefenses(0))).toBe(amt);
  });

  it("armour === ARMOUR_K: result === trunc(amountFixed / 2)", () => {
    const amt = fp(100);
    // armourFixed = 10000 = ARMOUR_K; expected = trunc(100000 * 10000 / 20000) = trunc(50000) = 50000
    const def: Defenses = { fireResPct: 0, armourFixed: ARMOUR_K };
    expect(applyDamage(physPkt(100), def)).toBe(Math.trunc(amt / 2));
  });

  it("armour fp(0.5) = 500: small reduction (< amt and > amt*0.9)", () => {
    const amt = fp(100);
    const def: Defenses = { fireResPct: 0, armourFixed: fp(0.5) };
    const result = applyDamage(physPkt(100), def);
    // trunc(100000 * 10000 / (500 + 10000)) = trunc(1000000000 / 10500) = trunc(95238.09...) = 95238
    expect(result).toBeLessThan(amt);
    expect(result).toBeGreaterThan(Math.trunc(amt * 0.9));
  });

  it("identical inputs produce identical output (determinism)", () => {
    const pkt = physPkt(50);
    const def: Defenses = { fireResPct: 0, armourFixed: fp(5) };
    expect(applyDamage(pkt, def)).toBe(applyDamage(pkt, def));
  });

  it("result never negative", () => {
    expect(applyDamage(physPkt(0), physDefenses(1000))).toBeGreaterThanOrEqual(0);
  });
});
