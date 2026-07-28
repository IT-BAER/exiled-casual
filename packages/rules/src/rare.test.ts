import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock, type MonsterDef, type RareModifier } from "@exiled/content-schema";
import { makeRare } from "./rare.js";

const cinderImp: MonsterDef = {
  id: "monster.cinder_imp.v1",
  name: "Cinder Imp",
  archetype: "swarm",
  maxLifeFixed: fp(40),        // 40000
  moveSpeedFixed: fp(2.4),     // 2400
  attackRangeFixed: fp(1.2),   // 1200
  attackDamage: { type: "physical", amountFixed: fp(6) }, // 6000
  attackCooldownTicks: 45,
  radiusFixed: fp(0.5),        // 500
  defenses: { resPct: resBlock(), armourFixed: fp(0.5) }, // armour 500
};

const RARE_TEMPLATE: RareModifier = {
  lifeMulPct: 250,
  moveSpeedMulPct: 120,
  damageMulPct: 150,
  element: "lightning",
  addedResPct: 30,
  namePrefix: "Storm-Touched",
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

  it("adds resistance to its own element only: 0 + 30 === 30 lightning", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.defenses.resPct).toEqual({ fire: 0, cold: 0, lightning: 30, chaos: 0 });
  });

  it("preserves id and prefixes the name with the theme", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.id).toBe(cinderImp.id);
    expect(rare.name).toBe("Storm-Touched Cinder Imp");
  });

  it("converts the attack to its element, so armour no longer answers it", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.attackDamage.type).toBe("lightning");
  });

  it("does not mutate original def", () => {
    const originalLife = cinderImp.maxLifeFixed;
    const originalRes = { ...cinderImp.defenses.resPct };
    const originalType = cinderImp.attackDamage.type;
    makeRare(cinderImp, RARE_TEMPLATE);
    expect(cinderImp.maxLifeFixed).toBe(originalLife);
    expect(cinderImp.defenses.resPct).toEqual(originalRes);
    expect(cinderImp.attackDamage.type).toBe(originalType);
  });

  it("returns a new object (not same reference)", () => {
    expect(makeRare(cinderImp, RARE_TEMPLATE)).not.toBe(cinderImp);
  });
});
