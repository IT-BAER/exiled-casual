import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock, type DamageSpec, type Defenses } from "@exiled/content-schema";
import { applyDamage, physicalMitigationPct } from "./damage.js";
import { ARMOUR_DMG_MULT, PDR_CAP } from "./stats.js";

// helpers
const firePkt = (amount: number): DamageSpec => ({ type: "fire", amountFixed: fp(amount) });
const physPkt = (amount: number): DamageSpec => ({ type: "physical", amountFixed: fp(amount) });
const fireDefenses = (res: number): Defenses => ({ resPct: resBlock({ fire: res }), armourFixed: 0 });
const physDefenses = (armour: number): Defenses => ({ resPct: resBlock(), armourFixed: fp(armour) });

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

describe("applyDamage — every element resists only itself", () => {
  const elements = ["fire", "cold", "lightning", "chaos"] as const;

  it("a hit is cut by its own element's resistance", () => {
    for (const el of elements) {
      const pkt: DamageSpec = { type: el, amountFixed: fp(100) };
      const def: Defenses = { resPct: resBlock({ [el]: 50 }), armourFixed: 0 };
      expect(applyDamage(pkt, def), el).toBe(Math.trunc(fp(100) / 2));
    }
  });

  it("resistance to another element does nothing, and armour never answers an element", () => {
    const coldHit: DamageSpec = { type: "cold", amountFixed: fp(100) };
    expect(applyDamage(coldHit, { resPct: resBlock({ fire: 75 }), armourFixed: fp(1000) }))
      .toBe(fp(100));
  });

  it("RES_CAP applies per element, not to their sum", () => {
    const def: Defenses = { resPct: resBlock({ chaos: 90, cold: 90 }), armourFixed: 0 };
    expect(applyDamage({ type: "chaos", amountFixed: fp(100) }, def)).toBe(Math.trunc(fp(100) * 25 / 100));
    expect(applyDamage({ type: "cold", amountFixed: fp(100) }, def)).toBe(Math.trunc(fp(100) * 25 / 100));
  });
});

describe("applyDamage — physical", () => {
  it("armour 0: result === amountFixed", () => {
    const amt = fp(100);
    expect(applyDamage(physPkt(100), physDefenses(0))).toBe(amt);
  });

  // The whole point of armour over flat reduction: the same rating stops a much
  // larger share of a small hit than of a big one. A curve that ignores the hit
  // makes one chest piece mitigate a boss slam as well as a trash swipe.
  it("the same armour stops a smaller share of a larger hit", () => {
    const def = physDefenses(50);
    const small = applyDamage(physPkt(6), def) / fp(6);
    const large = applyDamage(physPkt(60), def) / fp(60);
    expect(large).toBeGreaterThan(small);
  });

  it("armour === 10x the hit: exactly half the hit lands (PoE2 anchor)", () => {
    // DR = A / (A + 10 * D) = 100 / (100 + 100) = 50%
    const def: Defenses = { resPct: resBlock(), armourFixed: fp(10) * ARMOUR_DMG_MULT };
    expect(applyDamage(physPkt(10), def)).toBe(Math.trunc(fp(10) / 2));
  });

  it("armour === 5x the hit: a third of the hit is stopped (PoE2 anchor)", () => {
    // DR = 50 / (50 + 100) = 33.3% -> rounds to 33
    const def: Defenses = { resPct: resBlock(), armourFixed: fp(50) };
    expect(applyDamage(physPkt(10), def)).toBe(Math.trunc(fp(10) * 67 / 100));
  });

  it("mitigation is hard-capped at PDR_CAP even against absurd armour", () => {
    const def: Defenses = { resPct: resBlock(), armourFixed: fp(100000) };
    expect(applyDamage(physPkt(10), def)).toBe(Math.trunc(fp(10) * (100 - PDR_CAP) / 100));
  });

  it("identical inputs produce identical output (determinism)", () => {
    const pkt = physPkt(50);
    const def: Defenses = { resPct: resBlock(), armourFixed: fp(5) };
    expect(applyDamage(pkt, def)).toBe(applyDamage(pkt, def));
  });

  it("result never negative", () => {
    expect(applyDamage(physPkt(0), physDefenses(1000))).toBeGreaterThanOrEqual(0);
  });
});

describe("physicalMitigationPct", () => {
  // PoE2's published reference points, all against the same formula.
  it.each([
    [5, 33],
    [10, 50],
    [20, 67],
    [30, 75],
    [90, 90],
  ])("armour %ix the hit mitigates %i%%", (multiple, pct) => {
    expect(physicalMitigationPct(fp(10) * multiple, fp(10))).toBe(pct);
  });

  it("no armour or no hit mitigates nothing", () => {
    expect(physicalMitigationPct(0, fp(10))).toBe(0);
    expect(physicalMitigationPct(fp(50), 0)).toBe(0);
  });

  it("never exceeds PDR_CAP", () => {
    expect(physicalMitigationPct(fp(1e6), fp(1))).toBe(PDR_CAP);
  });

  it("is the exact complement of what applyDamage lets through", () => {
    const hit = fp(37);
    const def: Defenses = { resPct: resBlock(), armourFixed: fp(212) };
    const pct = physicalMitigationPct(def.armourFixed, hit);
    expect(applyDamage({ type: "physical", amountFixed: hit }, def))
      .toBe(Math.trunc(hit * (100 - pct) / 100));
  });
});
