import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { ELEMENTS, resBlock } from "./index.js";
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
  archetype: "swarm",
  maxLifeFixed: fp(40),
  moveSpeedFixed: fp(2.4),
  attackRangeFixed: fp(1.2),
  attackDamage: { type: "physical", amountFixed: fp(6) },
  attackCooldownTicks: 45,
  radiusFixed: fp(0.5),
  defenses: { resPct: resBlock(), armourFixed: fp(0.5) },
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

  it("accepts an optional castTicks", () => {
    const r = validateSkillDef({ ...validSkill, castTicks: 12 });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("a def with no castTicks still passes (regression)", () => {
    expect(validateSkillDef(validSkill).ok).toBe(true);
  });

  it("rejects negative castTicks", () => {
    const r = validateSkillDef({ ...validSkill, castTicks: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("castTicks"))).toBe(true);
  });

  it("rejects fractional castTicks", () => {
    const r = validateSkillDef({ ...validSkill, castTicks: 1.5 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("castTicks"))).toBe(true);
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
      attackDamage: { type: "holy", amountFixed: fp(6) },
    });
    expect(r.ok).toBe(false);
  });

  it("accepts every element as an attackDamage type", () => {
    for (const type of ELEMENTS) {
      const r = validateMonsterDef({ ...validMonster, attackDamage: { type, amountFixed: fp(6) } });
      expect(r.ok, type).toBe(true);
    }
  });

  it("rejects fractional armourFixed", () => {
    const r = validateMonsterDef({
      ...validMonster,
      defenses: { resPct: resBlock(), armourFixed: 1.5 },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects fireResPct above 100", () => {
    const r = validateMonsterDef({
      ...validMonster,
      defenses: { resPct: resBlock({ fire: 500 }), armourFixed: fp(0.5) },
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateMonsterDef — boss field", () => {
  const validBossMonster: MonsterDef = {
    ...validMonster,
    id: "monster.cinder_warden.v1",
    boss: {
      phase2AtLifePct: 50,
      slam: {
        windupTicks: 30,
        radiusFixed: fp(3.5),
        damageFixed: fp(28),
        cooldownTicks: 150,
        rangeFixed: fp(9),
      },
      phase2: {
        fireGroundDurationTicks: 120,
        addCount: 2,
        addDefId: "monster.cinder_imp.v1",
        cadenceMulPct: 70,
        fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(12), durationTicks: 60, maxStacks: 5 },
      },
    },
  };

  it("accepts a valid boss block", () => {
    const r = validateMonsterDef(validBossMonster);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("a def with no boss field still passes (regression)", () => {
    const r = validateMonsterDef(validMonster);
    expect(r.ok).toBe(true);
  });

  it("rejects phase2AtLifePct: 0", () => {
    const r = validateMonsterDef({
      ...validBossMonster,
      boss: { ...validBossMonster.boss!, phase2AtLifePct: 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("boss.phase2AtLifePct"))).toBe(true);
  });

  it("rejects phase2AtLifePct: 101", () => {
    const r = validateMonsterDef({
      ...validBossMonster,
      boss: { ...validBossMonster.boss!, phase2AtLifePct: 101 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("boss.phase2AtLifePct"))).toBe(true);
  });

  it("rejects malformed boss.slam (windupTicks: -1)", () => {
    const r = validateMonsterDef({
      ...validBossMonster,
      boss: {
        ...validBossMonster.boss!,
        slam: { ...validBossMonster.boss!.slam, windupTicks: -1 },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("boss.slam.windupTicks"))).toBe(true);
  });

  it("rejects boss.phase2.addDefId: 'not_an_id'", () => {
    const r = validateMonsterDef({
      ...validBossMonster,
      boss: {
        ...validBossMonster.boss!,
        phase2: { ...validBossMonster.boss!.phase2, addDefId: "not_an_id" },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("boss.phase2.addDefId"))).toBe(true);
  });

  it("rejects boss.phase2.fireGround with a bad kind", () => {
    const r = validateMonsterDef({
      ...validBossMonster,
      boss: {
        ...validBossMonster.boss!,
        phase2: {
          ...validBossMonster.boss!.phase2,
          fireGround: { ...validBossMonster.boss!.phase2.fireGround, kind: "chilled" },
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("boss.phase2.fireGround"))).toBe(true);
  });

  it("rejects a boss.phase2 missing fireGround", () => {
    const { fireGround: _f, ...phase2NoGround } = validBossMonster.boss!.phase2;
    const r = validateMonsterDef({
      ...validBossMonster,
      boss: { ...validBossMonster.boss!, phase2: phase2NoGround },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("boss.phase2.fireGround"))).toBe(true);
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

describe("validateMonsterDef archetypes", () => {
  const base = {
    id: "monster.test_thing.v1",
    name: "Test Thing",
    archetype: "swarm" as const,
    maxLifeFixed: fp(40), moveSpeedFixed: fp(2.4), attackRangeFixed: fp(1.2),
    attackDamage: { type: "physical" as const, amountFixed: fp(6) },
    attackCooldownTicks: 45, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock(), armourFixed: fp(0.5) },
  };

  it("accepts a valid swarm", () => {
    expect(validateMonsterDef(base).ok).toBe(true);
  });

  it("rejects a missing archetype", () => {
    const { archetype, ...noArch } = base;
    const r = validateMonsterDef(noArch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/archetype/);
  });

  it("rejects an unknown archetype", () => {
    const r = validateMonsterDef({ ...base, archetype: "sniper" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/archetype/);
  });

  it("rejects a shooter with no ranged spec", () => {
    const r = validateMonsterDef({ ...base, archetype: "shooter" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ranged/);
  });

  it("accepts a shooter with a ranged spec", () => {
    const r = validateMonsterDef({
      ...base, archetype: "shooter",
      ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a ranged spec on a non-shooter", () => {
    const r = validateMonsterDef({
      ...base, ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ranged/);
  });

  it("rejects a heavy with no slam", () => {
    const r = validateMonsterDef({ ...base, archetype: "heavy" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/heavy/);
  });

  it("accepts a heavy with a slam", () => {
    const r = validateMonsterDef({
      ...base, archetype: "heavy",
      heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a slam on a non-heavy", () => {
    const r = validateMonsterDef({
      ...base,
      heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/heavy/);
  });
});
