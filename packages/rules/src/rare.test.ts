import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import type { MonsterDef, RareModifier } from "@pact/content-schema";
import { makeRare } from "./rare.js";

const cinderImp: MonsterDef = {
  id: "monster.cinder_imp.v1",
  name: "Cinder Imp",
  maxLifeFixed: fp(40),        // 40000
  moveSpeedFixed: fp(2.4),     // 2400
  attackRangeFixed: fp(1.2),   // 1200
  attackDamage: { type: "physical", amountFixed: fp(6) }, // 6000
  attackCooldownTicks: 45,
  radiusFixed: fp(0.5),        // 500
  defenses: { fireResPct: 0, armourFixed: fp(0.5) }, // armour 500
};

const RARE_TEMPLATE: RareModifier = {
  lifeMulPct: 250,
  moveSpeedMulPct: 120,
  damageMulPct: 150,
  addedFireResPct: 30,
};

describe("makeRare", () => {
  it("applies life multiplier: trunc(40000 * 250 / 100) === 100000", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.maxLifeFixed).toBe(100000);
  });

  it("applies moveSpeed multiplier: trunc(2400 * 120 / 100) === 2880", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.moveSpeedFixed).toBe(2880);
  });

  it("applies damage multiplier: trunc(6000 * 150 / 100) === 9000", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.attackDamage.amountFixed).toBe(9000);
  });

  it("adds fire res: 0 + 30 === 30", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.defenses.fireResPct).toBe(30);
  });

  it("preserves id and name unchanged", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.id).toBe(cinderImp.id);
    expect(rare.name).toBe(cinderImp.name);
  });

  it("preserves attackDamage.type unchanged", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.attackDamage.type).toBe("physical");
  });

  it("does not mutate original def", () => {
    const originalLife = cinderImp.maxLifeFixed;
    const originalFireRes = cinderImp.defenses.fireResPct;
    makeRare(cinderImp, RARE_TEMPLATE);
    expect(cinderImp.maxLifeFixed).toBe(originalLife);
    expect(cinderImp.defenses.fireResPct).toBe(originalFireRes);
  });

  it("returns a new object (not same reference)", () => {
    expect(makeRare(cinderImp, RARE_TEMPLATE)).not.toBe(cinderImp);
  });
});
