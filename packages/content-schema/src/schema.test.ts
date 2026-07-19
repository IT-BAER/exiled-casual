import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import {
  ID_PATTERN,
  validateSkillDef,
  validateMonsterDef,
  type SkillDef,
  type MonsterDef,
} from "./index.js";

const validSkill: SkillDef = {
  id: "skill.ember_bolt.v1",
  name: "Ember Bolt",
  manaCostFixed: fp(8),
  cooldownTicks: 6,
  effects: [
    {
      type: "spawnProjectile",
      speedPerSecFixed: fp(12),
      radiusFixed: fp(0.4),
      maxRangeFixed: fp(20),
      damage: { type: "fire", amountFixed: fp(25) },
    },
  ],
};

const validMonster: MonsterDef = {
  id: "monster.cinder_imp.v1",
  name: "Cinder Imp",
  maxLifeFixed: fp(40),
  moveSpeedFixed: fp(2.4),
  attackRangeFixed: fp(1.2),
  attackDamage: { type: "physical", amountFixed: fp(6) },
  attackCooldownTicks: 45,
  radiusFixed: fp(0.5),
  defenses: { fireResPct: 0, armourFixed: fp(0.5) },
};

describe("ID_PATTERN", () => {
  it("matches valid skill id", () => {
    expect(ID_PATTERN.test("skill.ember_bolt.v1")).toBe(true);
  });
  it("matches valid monster id", () => {
    expect(ID_PATTERN.test("monster.cinder_imp.v1")).toBe(true);
  });
  it("rejects PascalCase", () => {
    expect(ID_PATTERN.test("EmberBolt")).toBe(false);
  });
  it("rejects too-short path", () => {
    expect(ID_PATTERN.test("skill.x")).toBe(false);
  });
  it("rejects unknown prefix", () => {
    expect(ID_PATTERN.test("item.sword.v1")).toBe(false);
  });
});

describe("validateSkillDef", () => {
  it("accepts a valid SkillDef", () => {
    const r = validateSkillDef(validSkill);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects bad id", () => {
    const r = validateSkillDef({ ...validSkill, id: "EmberBolt" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects negative manaCost", () => {
    const r = validateSkillDef({ ...validSkill, manaCostFixed: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("manaCostFixed"))).toBe(true);
  });

  it("rejects fractional manaCost (non-integer)", () => {
    const r = validateSkillDef({ ...validSkill, manaCostFixed: 1.5 });
    expect(r.ok).toBe(false);
  });

  it("rejects negative cooldownTicks", () => {
    const r = validateSkillDef({ ...validSkill, cooldownTicks: -1 });
    expect(r.ok).toBe(false);
  });

  it("rejects empty effects array", () => {
    const r = validateSkillDef({ ...validSkill, effects: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("effects"))).toBe(true);
  });

  it("rejects unknown effect type", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [{ type: "summonMinion" } as never],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects spawnProjectile missing damage field", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [
        {
          type: "spawnProjectile",
          speedPerSecFixed: fp(12),
          radiusFixed: fp(0.4),
          maxRangeFixed: fp(20),
          // damage omitted
        } as never,
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-object input", () => {
    const r = validateSkillDef(null);
    expect(r.ok).toBe(false);
  });
});

describe("validateMonsterDef", () => {
  it("accepts a valid MonsterDef", () => {
    const r = validateMonsterDef(validMonster);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects bad id", () => {
    const r = validateMonsterDef({ ...validMonster, id: "CinderImp" });
    expect(r.ok).toBe(false);
  });

  it("rejects negative maxLifeFixed", () => {
    const r = validateMonsterDef({ ...validMonster, maxLifeFixed: -1 });
    expect(r.ok).toBe(false);
  });

  it("rejects fractional attackCooldownTicks", () => {
    const r = validateMonsterDef({ ...validMonster, attackCooldownTicks: 1.5 });
    expect(r.ok).toBe(false);
  });

  it("rejects missing defenses", () => {
    const { defenses: _d, ...noDefenses } = validMonster;
    const r = validateMonsterDef(noDefenses);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("defenses"))).toBe(true);
  });

  it("rejects invalid attackDamage type", () => {
    const r = validateMonsterDef({
      ...validMonster,
      attackDamage: { type: "lightning", amountFixed: fp(6) },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects fractional armourFixed", () => {
    const r = validateMonsterDef({
      ...validMonster,
      defenses: { fireResPct: 0, armourFixed: 1.5 },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects fireResPct above 100", () => {
    const r = validateMonsterDef({
      ...validMonster,
      defenses: { fireResPct: 500, armourFixed: fp(0.5) },
    });
    expect(r.ok).toBe(false);
  });
});

describe("Fixed field integer enforcement", () => {
  it("rejects fractional speedPerSecFixed in spawnProjectile", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [
        {
          type: "spawnProjectile",
          speedPerSecFixed: 0.4,
          radiusFixed: fp(0.4),
          maxRangeFixed: fp(20),
          damage: { type: "fire", amountFixed: fp(25) },
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("speedPerSecFixed"))).toBe(true);
  });

  it("rejects negative radiusFixed in spawnProjectile", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [
        {
          type: "spawnProjectile",
          speedPerSecFixed: fp(12),
          radiusFixed: -5,
          maxRangeFixed: fp(20),
          damage: { type: "fire", amountFixed: fp(25) },
        },
      ],
    });
    expect(r.ok).toBe(false);
  });
});
