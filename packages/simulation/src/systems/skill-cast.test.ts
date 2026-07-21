import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerSkillCast } from "./skill-cast";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";
import type { SkillDef } from "@pact/content-schema";
import type { Position, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC, CastingC } from "../components";

// Authored skill defs matching the contract tables exactly.
const EMBER_BOLT: SkillDef = {
  id: "skill.ember_bolt.v1",
  name: "Ember Bolt",
  manaCostFixed: fp(8),   // 8000
  cooldownTicks: 6,
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
  effects: [{ type: "teleport", distanceFixed: fp(5) }],
};

const ALL_SKILLS = new Map<string, SkillDef>([
  [EMBER_BOLT.id, EMBER_BOLT],
  [CINDER_GROUND.id, CINDER_GROUND],
  [BLINK.id, BLINK],
]);

function makeCaster(sim: Simulation, mana = fp(60)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: 0, y: 0 });
  sim.world.set<Mana>(e, "mana", { mana, maxMana: fp(60), regen: 0 });
  sim.world.set<Faction>(e, "faction", { team: 0 });
  sim.world.set<Cooldowns>(e, "cooldowns", {});
  return e;
}

describe("registerSkillCast", () => {
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
});
