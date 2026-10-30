import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { ELEMENTS, resBlock } from "./index.js";
import {
  ID_PATTERN,
  validateSkillDef,
  validateMonsterDef,
  type SkillDef,
  type MonsterDef,
  type BossAbility,
} from "./index.js";

const validSkill: SkillDef = {
  id: "skill.ember_bolt.v1",
  name: "Ember Bolt",
  unlockLevel: 1,
  growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
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

  /**
   * The melee branch. Unlike a projectile it has no travel, so reach and arc are
   * the whole targeting rule and both have to survive validation.
   */
  it("accepts a meleeStrike effect", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [
        {
          type: "meleeStrike",
          reachFixed: fp(1.6),
          arcDegrees: 120,
          damage: { type: "physical", amountFixed: fp(14) },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a meleeStrike with an arc outside 0..360", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [
        {
          type: "meleeStrike",
          reachFixed: fp(1.6),
          arcDegrees: 400,
          damage: { type: "physical", amountFixed: fp(14) },
        } as never,
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("arcDegrees"))).toBe(true);
  });

  it("rejects a meleeStrike missing damage", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [{ type: "meleeStrike", reachFixed: fp(1.6), arcDegrees: 120 } as never],
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

  describe("a kit and a third phase", () => {
    const fire = { type: "fire", amountFixed: fp(9) } as const;
    const kit: BossAbility[] = [
      { id: "rain", kind: "volley", fromPhase: 3, cooldownTicks: 240, windupTicks: 36, rangeFixed: fp(9), damage: fire,
        count: 5, everyTicks: 5, radiusFixed: fp(1.3) },
      { id: "lances", kind: "volley", fromPhase: 3, cooldownTicks: 240, windupTicks: 27, rangeFixed: fp(12), damage: fire,
        count: 3, everyTicks: 9, lengthFixed: fp(12), halfWidthFixed: fp(0.6) },
      { id: "rift", kind: "line", fromPhase: 1, cooldownTicks: 200, windupTicks: 30, rangeFixed: fp(9), damage: fire,
        lengthFixed: fp(9), halfWidthFixed: fp(0.9) },
      { id: "charge", kind: "line", fromPhase: 1, cooldownTicks: 150, windupTicks: 18, rangeFixed: fp(7), damage: fire,
        lengthFixed: fp(9), halfWidthFixed: fp(0.8), overshootFixed: fp(2), minLengthFixed: fp(4), dashSpeedFixed: fp(14) },
      { id: "ring", kind: "ring", fromPhase: 1, cooldownTicks: 210, windupTicks: 36, rangeFixed: fp(7), damage: fire,
        innerFixed: fp(2.4), radiusFixed: fp(7) },
      { id: "nova", kind: "nova", fromPhase: 3, cooldownTicks: 120, windupTicks: 15, rangeFixed: fp(3.5), damage: fire,
        radiusFixed: fp(3) },
      { id: "brood", kind: "brood", fromPhase: 2, cooldownTicks: 300, windupTicks: 24, addDefId: "monster.cinder_imp.v1",
        count: 2, maxAlive: 6, phase3CooldownTicks: 210 },
    ];
    /** The kitted boss, with `patch` over its boss block and `at` over one ability. */
    const kitted = (patch: Record<string, unknown> = {}, at?: [number, Record<string, unknown>]) => ({
      ...validBossMonster,
      boss: {
        ...validBossMonster.boss!, phase3AtLifePct: 25, phase3CadenceMulPct: 85,
        abilities: kit.map((a, i) => (at?.[0] === i ? { ...a, ...at[1] } : a)),
        ...patch,
      },
    });

    it("accepts every kind of ability with a third phase", () => {
      expect(validateMonsterDef(kitted()).errors).toEqual([]);
    });

    it.each<[string, unknown]>([
      ["boss.phase3AtLifePct", kitted({ phase3AtLifePct: 50 })],
      ["boss.phase3CadenceMulPct", kitted({ phase3CadenceMulPct: undefined })],
      ["boss.abilities: must be an array", kitted({ abilities: {} })],
      ["boss.abilities[0].kind", kitted({}, [0, { kind: "beam" }])],
      ["boss.abilities[1].id", kitted({}, [1, { id: "rain" }])],
      ["boss.abilities[2].id", kitted({}, [2, { id: "Rift!" }])],
      ["boss.abilities[2].fromPhase", kitted({}, [2, { fromPhase: 4 }])],
      ["boss.abilities[0].fromPhase", kitted({ phase3AtLifePct: undefined, phase3CadenceMulPct: undefined })],
      ["boss.abilities[2].lengthFixed", kitted({}, [2, { lengthFixed: undefined }])],
      ["boss.abilities[3].minLengthFixed", kitted({}, [3, { minLengthFixed: undefined }])],
      ["boss.abilities[3].dashSpeedFixed", kitted({}, [3, { dashSpeedFixed: -1 }])],
      ["boss.abilities[4].innerFixed", kitted({}, [4, { innerFixed: fp(7) }])],
      ["boss.abilities[5].damage", kitted({}, [5, { damage: { type: "holy", amountFixed: 1 } }])],
      ["boss.abilities[5].rangeFixed", kitted({}, [5, { rangeFixed: undefined }])],
      ["boss.abilities[0].radiusFixed", kitted({}, [0, { lengthFixed: fp(3), halfWidthFixed: fp(1) }])],
      ["boss.abilities[0].count", kitted({}, [0, { count: 0 }])],
      ["boss.abilities[0].follow", kitted({}, [0, { follow: "yes" }])],
      ["boss.abilities[6].addDefId", kitted({}, [6, { addDefId: "imp" }])],
      ["boss.abilities[6].maxAlive", kitted({}, [6, { maxAlive: 0 }])],
    ])("reports %s", (path, def) => {
      expect(validateMonsterDef(def).errors.join("\n")).toContain(path);
    });
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

  it("takes a fan only when every projectile lands on the sim's 5 degree table", () => {
    const fan = (count: number, spreadDegrees: number) =>
      validateSkillDef({ ...validSkill, effects: [{ ...validSkill.effects[0]!, count, spreadDegrees } as SkillDef["effects"][0]] });
    expect(fan(3, 30).ok).toBe(true);
    expect(fan(2, 10).ok).toBe(true);
    expect(fan(3, 25).ok).toBe(false);
    expect(fan(0, 0).ok).toBe(false);
    expect(fan(3, 190).ok).toBe(false);
    const patched = (count: number) => validateSkillDef({
      ...validSkill,
      effects: [{ ...validSkill.effects[0]!, count: 3, spreadDegrees: 30 } as SkillDef["effects"][0]],
      growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [{ atLevel: 5, text: "more", patch: { count } }] },
    });
    expect(patched(4).ok).toBe(true);
    expect(patched(5).ok).toBe(false);
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

  const charge = {
    windupTicks: 18, speedFixed: fp(5.4), minRangeFixed: fp(3), maxRangeFixed: fp(7),
    cooldownTicks: 150, damageFixed: fp(6), radiusFixed: fp(1.1),
  };

  it("accepts a brute with or without a charge", () => {
    expect(validateMonsterDef({ ...base, archetype: "brute" }).ok).toBe(true);
    expect(validateMonsterDef({ ...base, archetype: "brute", charge }).ok).toBe(true);
  });

  it("rejects a charge on a non-brute or a boss", () => {
    const swarm = validateMonsterDef({ ...base, charge });
    expect(swarm.ok).toBe(false);
    expect(swarm.errors.join(" ")).toMatch(/charge/);
    const boss = validateMonsterDef({ ...base, archetype: "brute", charge, boss: {} });
    expect(boss.errors.join(" ")).toMatch(/charge/);
  });

  it("rejects a charge with a bad field", () => {
    const r = validateMonsterDef({ ...base, archetype: "brute", charge: { ...charge, speedFixed: -1 } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/charge\.speedFixed/);
  });
});

describe("validateSkillDef: gem growth", () => {
  const base = {
    id: "skill.test.v1",
    name: "Test",
    manaCostFixed: 0,
    cooldownTicks: 10,
    unlockLevel: 1,
    growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: 1000,
        radiusFixed: 300,
        maxRangeFixed: 14000,
        damage: { type: "physical", amountFixed: 11000 },
        // Present (even at 0) so a breakpoint patch of pierceCount names a real
        // field, exactly like the three authored projectile bases in
        // content-runtime/skills.ts.
        pierceCount: 0,
      },
    ],
  };

  it("accepts a minimal growth block", () => {
    expect(validateSkillDef(base).ok).toBe(true);
  });

  it("requires unlockLevel to be a positive integer", () => {
    expect(validateSkillDef({ ...base, unlockLevel: 0 }).ok).toBe(false);
    expect(validateSkillDef({ ...base, unlockLevel: 1.5 }).ok).toBe(false);
    const r = validateSkillDef({ ...base, unlockLevel: undefined });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("unlockLevel");
  });

  it("requires growth and its per-level percentages", () => {
    expect(validateSkillDef({ ...base, growth: undefined }).ok).toBe(false);
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: -1, manaPct: 4 }, breakpoints: [] },
    }).ok).toBe(false);
  });

  it("accepts an authored own-scalar and rejects an unknown field", () => {
    expect(validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
        breakpoints: [],
      },
    }).ok).toBe(true);
    expect(validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4, own: { field: "notAField", perMille: 20 } },
        breakpoints: [],
      },
    }).ok).toBe(false);
  });

  it("allows at most two breakpoints, in ascending order", () => {
    const bp = (atLevel: number) => ({ atLevel, text: "x", patch: { pierceCount: 1 } });
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [bp(5), bp(15)] },
    }).ok).toBe(true);
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [bp(5), bp(15), bp(18)] },
    }).ok).toBe(false);
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [bp(15), bp(5)] },
    }).ok).toBe(false);
  });

  it("rejects a breakpoint patch that is not a top-level scalar", () => {
    const r = validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4 },
        breakpoints: [{ atLevel: 5, text: "x", patch: { damage: { type: "fire", amountFixed: 1 } } }],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("scalar");
  });

  it("rejects a breakpoint that patches the field growth already grows", () => {
    const r = validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
        breakpoints: [{ atLevel: 5, text: "x", patch: { maxRangeFixed: 20000 } }],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("maxRangeFixed");
  });

  it("rejects a breakpoint patch keyed on `type`", () => {
    expect(validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4 },
        breakpoints: [{ atLevel: 5, text: "x", patch: { type: "teleport" } }],
      },
    }).ok).toBe(false);
  });

  it("accepts pierceCount on a projectile and rejects a negative one", () => {
    const withPierce = { ...base, effects: [{ ...base.effects[0], pierceCount: 2 }] };
    expect(validateSkillDef(withPierce).ok).toBe(true);
    const bad = { ...base, effects: [{ ...base.effects[0], pierceCount: -1 }] };
    expect(validateSkillDef(bad).ok).toBe(false);
  });

  it("rejects a breakpoint patch key absent from effects[0]", () => {
    const r = validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4 },
        breakpoints: [{ atLevel: 5, text: "x", patch: { pierceCounts: 1 } }],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("pierceCounts");
  });

  it("accepts an absent classId and rejects an empty one", () => {
    expect(validateSkillDef(base).ok).toBe(true);
    expect(validateSkillDef({ ...base, classId: "" }).ok).toBe(false);
    expect(validateSkillDef({ ...base, classId: "class.stalker" }).ok).toBe(true);
  });
});

describe("validateMonsterDef — onHit", () => {
  it("accepts poison and bleeding at 1..100%", () => {
    for (const ailment of ["poison", "bleeding"] as const) {
      for (const chancePct of [1, 50, 100]) {
        const r = validateMonsterDef({ ...validMonster, onHit: { ailment, chancePct } });
        expect(r.ok, `${ailment} ${chancePct}: ${r.errors.join(", ")}`).toBe(true);
      }
    }
  });

  it("rejects an unknown ailment", () => {
    const r = validateMonsterDef({ ...validMonster, onHit: { ailment: "burning", chancePct: 50 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("onHit.ailment"))).toBe(true);
  });

  it("rejects a chance outside 1..100 or fractional", () => {
    for (const chancePct of [0, 101, 12.5, "50"]) {
      const r = validateMonsterDef({ ...validMonster, onHit: { ailment: "poison", chancePct } });
      expect(r.ok, String(chancePct)).toBe(false);
      expect(r.errors.some((e) => e.includes("onHit.chancePct"))).toBe(true);
    }
  });

  it("rejects a non-object", () => {
    expect(validateMonsterDef({ ...validMonster, onHit: "poison" }).ok).toBe(false);
  });
});
