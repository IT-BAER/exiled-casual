import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerSkillCast } from "./skill-cast";
import { createCombatSim } from "../combat-sim";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";
import type { SkillDef } from "@exiled/content-schema";
import type { Position, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC, CastingC, OffenseC, Health, SessionC, SkillsC } from "../components";

// Authored skill defs matching the contract tables exactly.
const EMBER_BOLT: SkillDef = {
  id: "skill.ember_bolt.v1",
  name: "Ember Bolt",
  manaCostFixed: fp(8),   // 8000
  cooldownTicks: 6,
  unlockLevel: 1,
  growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
  effects: [{
    type: "spawnProjectile",
    speedPerSecFixed: fp(12),  // 12000
    radiusFixed: fp(0.4),      // 400
    maxRangeFixed: fp(20),     // 20000
    damage: { type: "fire", amountFixed: fp(25) },
  }],
};

const CINDER_GROUND: SkillDef = {
  id: "skill.cinder_ground.v1",
  name: "Cinder Ground",
  manaCostFixed: fp(20),
  cooldownTicks: 30,
  unlockLevel: 1,
  growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
  effects: [{
    type: "spawnGroundArea",
    radiusFixed: fp(2.5),
    durationTicks: 90,
    ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(8), durationTicks: 60, maxStacks: 5 },
  }],
};

const BLINK: SkillDef = {
  id: "skill.blink.v1",
  name: "Blink",
  manaCostFixed: fp(15),
  cooldownTicks: 90,
  unlockLevel: 1,
  growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
  effects: [{ type: "teleport", distanceFixed: fp(5) }],
};

const DELAYED_BOLT: SkillDef = {
  ...EMBER_BOLT,
  id: "skill.test_delayed_bolt.v1",
  castTicks: 3,
  cooldownTicks: 0,
};

/** The melee default attack: free, and it lands the tick it is cast. */
const CLEAVE: SkillDef = {
  id: "skill.test_cleave.v1",
  name: "Cleave",
  manaCostFixed: 0,
  cooldownTicks: 0,
  unlockLevel: 1,
  growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
  effects: [{
    type: "meleeStrike",
    reachFixed: fp(2),
    arcDegrees: 120,
    damage: { type: "physical", amountFixed: fp(14) },
  }],
};

const DELAYED_CLEAVE: SkillDef = {
  ...CLEAVE,
  id: "skill.test_delayed_cleave.v1",
  castTicks: 3,
};

const ALL_SKILLS = new Map<string, SkillDef>([
  [EMBER_BOLT.id, EMBER_BOLT],
  [CINDER_GROUND.id, CINDER_GROUND],
  [BLINK.id, BLINK],
  [CLEAVE.id, CLEAVE],
  [DELAYED_BOLT.id, DELAYED_BOLT],
  [DELAYED_CLEAVE.id, DELAYED_CLEAVE],
]);

function makeCaster(sim: Simulation, mana = fp(60)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: 0, y: 0 });
  sim.world.set<Mana>(e, "mana", { mana, maxMana: fp(60), regen: 0 });
  sim.world.set<Faction>(e, "faction", { team: 0 });
  sim.world.set<Cooldowns>(e, "cooldowns", {});
  return e;
}

/** A session entity carrying one gem at the given level, the fold's real input. */
function makeSessionWithGem(sim: Simulation, skillId: string, level: number) {
  const e = sim.world.create();
  sim.world.set<SessionC>(e, "session", {
    area: "hideout", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, areaTier: 0,
    activeNodeId: "", completedNodes: [], portalsLeft: 0, mapOpen: 0, pendingArea: "",
  });
  sim.world.set<SkillsC>(e, "skills", { gems: { [skillId]: { level, xp: 0 } }, bar: [] });
  return e;
}

/** Ember Bolt with pierce added as a gem-5 breakpoint, per the contract tables. */
const PIERCE_BOLT: SkillDef = {
  ...EMBER_BOLT,
  id: "skill.test_pierce_bolt.v1",
  effects: [{ ...EMBER_BOLT.effects[0]!, pierceCount: 0 } as SkillDef["effects"][0]],
  growth: {
    perLevel: { damagePct: 6, manaPct: 4 },
    breakpoints: [{ atLevel: 5, text: "pierce", patch: { pierceCount: 1 } }],
  },
};

function makeEnemyForCastTest(sim: Simulation, x: number, y: number) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<Health>(e, "health", { life: fp(50), maxLife: fp(50) });
  sim.world.set<Faction>(e, "faction", { team: 1 });
  return e;
}

describe("registerSkillCast", () => {
  it("holds a delayed spell until its cast window ends", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    const cmd = {
      tick: 0, entity: caster, type: "useSkill", skillId: DELAYED_BOLT.id,
      data: { tx: fp(10), ty: 0 },
    };

    sim.step([cmd]);
    expect(sim.world.query("projectile")).toHaveLength(0);
    expect(sim.world.get<CastingC>(caster, "casting")?.untilTick).toBe(3);

    sim.step([{ ...cmd, tick: 1 }]);
    sim.step([{ ...cmd, tick: 2 }]);
    expect(sim.world.query("projectile")).toHaveLength(0);

    sim.step();
    expect(sim.world.query("projectile")).toHaveLength(1);
    expect(sim.world.get<CastingC>(caster, "casting")).toBeUndefined();
  });

  it("does not queue another cast while the first one is winding up", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    const cmd = {
      tick: 0, entity: caster, type: "useSkill", skillId: DELAYED_BOLT.id,
      data: { tx: fp(10), ty: 0 },
    };

    sim.step([cmd]);
    sim.step([{ ...cmd, tick: 1 }]);
    sim.step([{ ...cmd, tick: 2 }]);
    sim.step();

    expect(sim.world.query("projectile")).toHaveLength(1);
    expect(sim.world.get<Mana>(caster, "mana")?.mana).toBe(fp(60) - fp(8));
  });

  it("gives a held skill a completed tick before the next wind-up starts", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    const held = (tick: number) => ({
      tick, entity: caster, type: "useSkill" as const, skillId: DELAYED_BOLT.id,
      data: { tx: fp(10), ty: 0 },
    });

    for (let tick = 0; tick <= 3; tick++) sim.step([held(tick)]);
    expect(sim.world.query("projectile")).toHaveLength(1);
    expect(sim.world.get<CastingC>(caster, "casting")).toBeUndefined();

    sim.step([held(4)]);
    expect(sim.world.query("projectile")).toHaveLength(1);
    expect(sim.world.get<CastingC>(caster, "casting")?.untilTick).toBe(7);
  });

  it("delays a melee hit until the attack wind-up ends", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim);
    const foe = makeEnemyForCastTest(sim, fp(1.5), 0);
    const cmd = {
      tick: 0, entity: caster, type: "useSkill", skillId: DELAYED_CLEAVE.id,
      data: { tx: fp(5), ty: 0 },
    };

    sim.step([cmd]);
    expect(sim.damageQueue).toEqual([]);
    sim.step([{ ...cmd, tick: 1 }]);
    sim.step([{ ...cmd, tick: 2 }]);
    expect(sim.damageQueue).toEqual([]);
    sim.step([{ ...cmd, tick: 3 }]);
    expect(sim.damageQueue).toEqual([
      { target: foe, source: caster, amountFixed: fp(14), type: 1 },
    ]);
  });

  it("useSkill ember_bolt spawns exactly one projectile entity and deducts mana", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.ember_bolt.v1",
      data: { tx: fp(10), ty: 0 },
    }]);

    const mana = sim.world.get<Mana>(caster, "mana")!;
    expect(mana.mana).toBe(fp(60) - fp(8)); // mana deducted

    const cds = sim.world.get<Cooldowns>(caster, "cooldowns")!;
    expect(cds["skill.ember_bolt.v1"]).toBe(6); // tick 0 + cooldownTicks 6

    // exactly one projectile entity (not the caster)
    const projectiles = sim.world.query("projectile").filter(e => e !== caster);
    expect(projectiles).toHaveLength(1);

    const proj = sim.world.get<ProjectileC>(projectiles[0]!, "projectile")!;
    expect(proj.damageType).toBe(0); // fire
    expect(proj.damageAmount).toBe(fp(25));
    expect(proj.remainingRange).toBe(fp(20));
    expect(proj.radius).toBe(fp(0.4));
    expect(proj.team).toBe(0);
    expect(proj.ownerId).toBe(caster);

    const projPos = sim.world.get<Position>(projectiles[0]!, "position")!;
    // starts at caster position
    expect(projPos.x).toBe(0);
    expect(projPos.y).toBe(0);
  });

  it("scales a spell's hit by the caster's increased spell damage", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.world.set<OffenseC>(caster, "offense", { spellDamagePct: 37, castSpeedPct: 0, critChancePct: 0 });
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.ember_bolt.v1",
      data: { tx: fp(10), ty: 0 },
    }]);

    const proj = sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!;
    expect(proj.damageAmount).toBe(fp(34.25)); // trunc(25000 * 137 / 100)
  });

  it("shortens the cast by the caster's increased cast speed", () => {
    const sim = new Simulation();
    const emberSlow: SkillDef = { ...EMBER_BOLT, castTicks: 8 };
    registerSkillCast(sim, new Map([[emberSlow.id, emberSlow]]));
    const caster = makeCaster(sim, fp(60));
    sim.world.set<OffenseC>(caster, "offense", { spellDamagePct: 0, castSpeedPct: 15, critChancePct: 0 });
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: emberSlow.id,
      data: { tx: fp(10), ty: 0 },
    }]);

    // PoE: cast time is base / (1 + increases). 8 ticks at 15% is 6.95, floored to 6.
    expect(sim.world.get<CastingC>(caster, "casting")!.untilTick).toBe(6);
    // The renderer paces the swing by this, so it has to be the SHORTENED length
    // and not the skill's base, or a fast cast plays a clip that outlives it.
    expect(sim.world.get<CastingC>(caster, "casting")!.ticks).toBe(6);
  });

  it("a skill with no crit chance of its own never crits, whatever gear says", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS, undefined, 1234);
    const caster = makeCaster(sim, fp(60));
    sim.world.set<OffenseC>(caster, "offense", { spellDamagePct: 0, castSpeedPct: 0, critChancePct: 500 });
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: EMBER_BOLT.id, data: { tx: fp(10), ty: 0 },
    }]);

    const proj = sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!;
    expect(proj.damageAmount).toBe(fp(25)); // increases scale a base of zero, which is zero
  });

  it("a critical strike deals double, PoE's 100% base critical damage bonus", () => {
    const sim = new Simulation();
    const alwaysCrit: SkillDef = { ...EMBER_BOLT, critChancePct: 100 };
    registerSkillCast(sim, new Map([[alwaysCrit.id, alwaysCrit]]), undefined, 1234);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: alwaysCrit.id, data: { tx: fp(10), ty: 0 },
    }]);

    const proj = sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!;
    expect(proj.damageAmount).toBe(fp(50));
  });

  it("gear's increased crit multiplies the skill's own base, it does not add to it", () => {
    // Base 8% with +25% increased is 10.00%, so a roll under 1000 of 10000 crits
    // and one at or above it does not. Two seeds, picked to land either side.
    const skill: SkillDef = { ...EMBER_BOLT, critChancePct: 8 };
    const dmg = (seed: number): number => {
      const sim = new Simulation();
      registerSkillCast(sim, new Map([[skill.id, skill]]), undefined, seed);
      const caster = makeCaster(sim, fp(60));
      sim.world.set<OffenseC>(caster, "offense", { spellDamagePct: 0, castSpeedPct: 0, critChancePct: 25 });
      sim.step([{ tick: 0, entity: caster, type: "useSkill", skillId: skill.id, data: { tx: fp(10), ty: 0 } }]);
      return sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!.damageAmount;
    };
    // A 10% chance means the same cast crits under one seed and not under another.
    const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(dmg);
    expect(results).toContain(fp(50));  // some seed crits
    expect(results).toContain(fp(25));  // most do not
  });

  it("leaves an ailment's damage over time alone: spell damage scales hits only", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.world.set<OffenseC>(caster, "offense", { spellDamagePct: 50, castSpeedPct: 0, critChancePct: 0 });
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.cinder_ground.v1",
      data: { tx: fp(3), ty: 0 },
    }]);

    const area = sim.world.get<GroundAreaC>(sim.world.query("groundArea")[0]!, "groundArea")!;
    expect(area.dps).toBe(fp(8));
  });

  it("second cast while on cooldown spawns nothing and spends no mana", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    const cmd = { tick: 0, entity: caster, type: "useSkill", skillId: "skill.ember_bolt.v1", data: { tx: fp(10), ty: 0 } };
    sim.step([cmd]); // first cast succeeds
    const manaAfterFirst = sim.world.get<Mana>(caster, "mana")!.mana;
    // tick is now 1, cooldown readyTick is 6 — still on cooldown
    sim.step([{ ...cmd, tick: 1 }]);
    const manaAfterSecond = sim.world.get<Mana>(caster, "mana")!.mana;
    expect(manaAfterSecond).toBe(manaAfterFirst); // no additional spend
    const projectiles = sim.world.query("projectile").filter(e => e !== caster);
    expect(projectiles).toHaveLength(1); // still only one projectile
  });

  it("insufficient mana spawns nothing", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(5)); // less than fp(8) cost
    sim.step([{ tick: 0, entity: caster, type: "useSkill", skillId: "skill.ember_bolt.v1", data: { tx: fp(10), ty: 0 } }]);
    expect(sim.world.query("projectile")).toHaveLength(0);
    expect(sim.world.get<Mana>(caster, "mana")!.mana).toBe(fp(5)); // unchanged
  });

  it("cinder_ground spawns one groundArea entity", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.cinder_ground.v1",
      data: { tx: fp(5), ty: fp(5) },
    }]);
    const areas = sim.world.query("groundArea");
    expect(areas).toHaveLength(1);
    const ga = sim.world.get<GroundAreaC>(areas[0]!, "groundArea")!;
    expect(ga.radius).toBe(fp(2.5));
    expect(ga.expiryTick).toBe(90); // tick 0 + durationTicks 90
    expect(ga.ailmentKind).toBe("burning");
    expect(ga.stacksPerApply).toBe(1);
    expect(ga.maxStacks).toBe(5);
  });

  it("a cast with castTicks>0 sets CastingC.untilTick = tick + castTicks", () => {
    const sim = new Simulation();
    const emberSlow: SkillDef = { ...EMBER_BOLT, castTicks: 8 };
    registerSkillCast(sim, new Map([[emberSlow.id, emberSlow]]));
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: emberSlow.id, data: { tx: fp(10), ty: 0 },
    }]);
    expect(sim.world.get<CastingC>(caster, "casting")!.untilTick).toBe(8);
  });

  it("paces the animation by the repeat interval, not the wind-up", () => {
    const sim = new Simulation();
    // Wind-up 8, cooldown 20: a held button fires every 20 ticks, so that is
    // the beat the arm has to fill. Pacing the clip by the 8 made it play more
    // than twice too fast and then stand still for the remaining 12.
    const slowRepeat: SkillDef = { ...EMBER_BOLT, castTicks: 8, cooldownTicks: 20 };
    registerSkillCast(sim, new Map([[slowRepeat.id, slowRepeat]]));
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: slowRepeat.id, data: { tx: fp(10), ty: 0 },
    }]);
    const casting = sim.world.get<CastingC>(caster, "casting")!;
    expect(casting.untilTick).toBe(8);  // the bolt still leaves on the wind-up
    expect(casting.ticks).toBe(20);     // the arm still has the whole beat
  });

  it("a wind-up longer than the cooldown paces by the wind-up", () => {
    const sim = new Simulation();
    const slowCast: SkillDef = { ...EMBER_BOLT, castTicks: 30, cooldownTicks: 6 };
    registerSkillCast(sim, new Map([[slowCast.id, slowCast]]));
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: slowCast.id, data: { tx: fp(10), ty: 0 },
    }]);
    expect(sim.world.get<CastingC>(caster, "casting")!.ticks).toBe(30);
  });

  it("an instant cast (no castTicks) sets no CastingC", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.blink.v1", data: { tx: fp(10), ty: 0 },
    }]);
    expect(sim.world.get<CastingC>(caster, "casting")).toBeUndefined();
  });

  it("blink moves caster toward aim by at most fp(5)", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.blink.v1",
      data: { tx: fp(10), ty: 0 },
    }]);
    const pos = sim.world.get<Position>(caster, "position")!;
    // aim is fp(10) away; blink distance is fp(5) — should land at fp(5), y=0
    expect(pos.x).toBe(fp(5));
    expect(pos.y).toBe(0);
  });

  it("blink will not land inside a wall — shortens to the nearest walkable point", () => {
    // Floor on cx0..3, wall on cx4..7. A full fp(5) blink would land at cx5 (wall).
    const collision = gridCollision(
      makeGrid([
        "....####",
        "....####",
        "....####",
      ]),
    );
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS, { active: collision });
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.blink.v1", data: { tx: fp(10), ty: 0 },
    }]);
    const pos = sim.world.get<Position>(caster, "position")!;
    expect(pos.x).toBeGreaterThan(0);      // it did move
    expect(pos.x).toBeLessThan(fp(4));     // but stopped short of the wall
    expect(collision.isWalkable(pos.x, pos.y, 0)).toBe(true);
  });

  it("blink does not cross a wall it could clear", () => {
    // One column of wall at cx4 with open floor behind it. Picking the farthest
    // walkable fraction lands at cx5 and calls it legal; that is a free teleport
    // through the wall, and the whole "skills go through walls" report.
    const collision = gridCollision(
      makeGrid([
        "....#...",
        "....#...",
        "....#...",
      ]),
    );
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS, { active: collision });
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.blink.v1", data: { tx: fp(10), ty: 0 },
    }]);
    expect(sim.world.get<Position>(caster, "position")!.x).toBeLessThan(fp(4));
  });

  /**
   * The melee branch. It is the only effect that resolves inside the cast itself,
   * so the observable is the damage queue after one step, not a spawned entity.
   */
  describe("meleeStrike", () => {
    function makeEnemy(sim: Simulation, x: number, y: number) {
      const e = sim.world.create();
      sim.world.set<Position>(e, "position", { x, y });
      sim.world.set<Health>(e, "health", { life: fp(50), maxLife: fp(50) });
      sim.world.set<Faction>(e, "faction", { team: 1 });
      return e;
    }
    function cleave(sim: Simulation, caster: number, tx: number, ty: number) {
      sim.step([{ tick: 0, entity: caster, type: "useSkill", skillId: CLEAVE.id, data: { tx, ty } }]);
    }

    it("hits an enemy in front, inside reach", () => {
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      const caster = makeCaster(sim);
      const foe = makeEnemy(sim, fp(1.5), 0);
      cleave(sim, caster, fp(5), 0);
      expect(sim.damageQueue).toEqual([
        { target: foe, source: caster, amountFixed: fp(14), type: 1 },
      ]);
    });

    it("hits every enemy in the wedge at once, unlike a projectile", () => {
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      const caster = makeCaster(sim);
      const a = makeEnemy(sim, fp(1.5), 0);
      const b = makeEnemy(sim, fp(1.2), fp(0.6));
      cleave(sim, caster, fp(5), 0);
      expect(sim.damageQueue.map((d) => d.target).sort()).toEqual([a, b].sort());
    });

    it("misses an enemy behind the swing", () => {
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      const caster = makeCaster(sim);
      makeEnemy(sim, fp(-1.5), 0);
      cleave(sim, caster, fp(5), 0);
      expect(sim.damageQueue).toEqual([]);
    });

    it("misses an enemy past its reach", () => {
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      const caster = makeCaster(sim);
      makeEnemy(sim, fp(3.5), 0);
      cleave(sim, caster, fp(5), 0);
      expect(sim.damageQueue).toEqual([]);
    });

    it("never hits its own team", () => {
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      const caster = makeCaster(sim);
      const friend = makeEnemy(sim, fp(1.5), 0);
      sim.world.set<Faction>(friend, "faction", { team: 0 });
      cleave(sim, caster, fp(5), 0);
      expect(sim.damageQueue).toEqual([]);
    });
  });

  describe("gem levels fold into the cast", () => {
    it("a gem 1 caster spawns exactly the projectile the def describes", () => {
      // Existing behaviour, restated as a pin: without it, a bug in the fold that
      // scales at gem 1 has nothing to fail against.
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      makeSessionWithGem(sim, EMBER_BOLT.id, 1);
      const caster = makeCaster(sim, fp(60));
      sim.step([{
        tick: 0, entity: caster, type: "useSkill",
        skillId: EMBER_BOLT.id, data: { tx: fp(10), ty: 0 },
      }]);

      const proj = sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!;
      expect(proj.damageAmount).toBe(fp(25));
      expect(sim.world.get<Mana>(caster, "mana")!.mana).toBe(fp(60) - fp(8));
    });

    it("a gem 10 caster's bolt hits harder and costs more mana than a gem 1 one", () => {
      // Set the session's SkillsC gem to level 10, cast, read the spawned
      // ProjectileC.damageAmount and the mana actually spent. Assert both rose, and
      // assert damage rose by MORE than mana in ratio.
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      makeSessionWithGem(sim, EMBER_BOLT.id, 10);
      const caster = makeCaster(sim, fp(60));
      sim.step([{
        tick: 0, entity: caster, type: "useSkill",
        skillId: EMBER_BOLT.id, data: { tx: fp(10), ty: 0 },
      }]);

      const proj = sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!;
      // +6%/level compounded over 9 steps: trunc(25000 * 1.06^9) = 42233.
      expect(proj.damageAmount).toBe(42233);
      const manaSpent = fp(60) - sim.world.get<Mana>(caster, "mana")!.mana;
      // +4%/level compounded over 9 steps: trunc(8000 * 1.04^9) = 11381.
      expect(manaSpent).toBe(11381);
      expect(proj.damageAmount).toBeGreaterThan(fp(25));
      expect(manaSpent).toBeGreaterThan(fp(8));
      // Damage's ratio to base (42233/25000) beats mana's ratio to base
      // (11381/8000), checked by cross-multiplication to stay integer.
      expect(proj.damageAmount * fp(8)).toBeGreaterThan(manaSpent * fp(25));
    });

    it("a gem 5 caster's bolt pierces, a gem 4 caster's does not", () => {
      // Assert ProjectileC.pierceLeft is 1 at gem 5 and undefined at gem 4. This is
      // the breakpoint reaching the sim, which no rules-level test can prove.
      const skills = new Map([[PIERCE_BOLT.id, PIERCE_BOLT]]);
      const pierceLeftAt = (level: number): number | undefined => {
        const sim = new Simulation();
        registerSkillCast(sim, skills);
        makeSessionWithGem(sim, PIERCE_BOLT.id, level);
        const caster = makeCaster(sim, fp(60));
        sim.step([{
          tick: 0, entity: caster, type: "useSkill",
          skillId: PIERCE_BOLT.id, data: { tx: fp(10), ty: 0 },
        }]);
        return sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!.pierceLeft;
      };

      expect(pierceLeftAt(5)).toBe(1);
      expect(pierceLeftAt(4)).toBeUndefined();
    });

    it("a caster with no SkillsC casts at gem 1 rather than throwing", () => {
      // Every legacy test world has no session and therefore no SkillsC.
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      const caster = makeCaster(sim, fp(60));
      expect(() => sim.step([{
        tick: 0, entity: caster, type: "useSkill",
        skillId: EMBER_BOLT.id, data: { tx: fp(10), ty: 0 },
      }])).not.toThrow();

      const proj = sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!;
      expect(proj.damageAmount).toBe(fp(25));
      expect(sim.world.get<Mana>(caster, "mana")!.mana).toBe(fp(60) - fp(8));
    });

    it("a gem level-up landing inside a wind-up does not change what that cast resolves as", () => {
      // The cast is paid for at gem 4 (untilTick 3). Levelling the gem to 5 while
      // it is still in flight must not let the gem-5 number leak into a cast
      // already paid for — CastingC.gemLevel is what stops that, not a re-read
      // of the caster's current level at resolution.
      const sim = new Simulation();
      registerSkillCast(sim, ALL_SKILLS);
      const session = makeSessionWithGem(sim, DELAYED_BOLT.id, 4);
      const caster = makeCaster(sim, fp(60));
      sim.step([{
        tick: 0, entity: caster, type: "useSkill",
        skillId: DELAYED_BOLT.id, data: { tx: fp(10), ty: 0 },
      }]);
      expect(sim.world.get<CastingC>(caster, "casting")!.gemLevel).toBe(4);

      // Level the gem to 5 mid wind-up (untilTick is 3; the wind-up is still open).
      const skills = sim.world.get<SkillsC>(session, "skills")!;
      sim.world.set<SkillsC>(session, "skills", {
        ...skills, gems: { ...skills.gems, [DELAYED_BOLT.id]: { level: 5, xp: 0 } },
      });

      sim.step(); // tick 1
      sim.step(); // tick 2
      sim.step(); // tick 3: the wind-up resolves

      const proj = sim.world.get<ProjectileC>(sim.world.query("projectile")[0]!, "projectile")!;
      // +6%/level compounded over 3 steps (gem 4): trunc(25000 * 1.06^3) = 29775.
      // The gem-5 number (4 steps) is 31561 — a mutant that re-reads the current
      // gem level at resolution instead of `casting.gemLevel` produces that
      // number here instead, failing this assertion.
      expect(proj.damageAmount).toBe(29775);
    });
  });

  it("a cast projectile names the skill that made it, so the client can draw it", () => {
    const { sim, world, playerEntity } = createCombatSim(7, { monsters: false });
    sim.step([{
      tick: sim.tick, entity: playerEntity, type: "useSkill",
      skillId: "skill.ember_bolt.v1", data: { tx: fp(0), ty: fp(6) },
    }]);
    for (let i = 0; i < 9; i++) sim.step(); // ember_bolt's castTicks wind-up
    const proj = world.query("projectile")[0]!;
    expect(world.get<ProjectileC>(proj, "projectile")!.skillId).toBe("skill.ember_bolt.v1");
  });

});
