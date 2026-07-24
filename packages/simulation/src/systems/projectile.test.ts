import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerProjectileMove } from "./projectile";
import type { Position, ProjectileC, MonsterC, Faction, DamageEvent } from "../components";

function makeProjectile(sim: Simulation, px: number, py: number, dirx: number, diry: number, range = fp(20)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: px, y: py });
  sim.world.set<ProjectileC>(e, "projectile", {
    dirx, diry,
    remainingRange: range,
    radius: fp(0.4),
    damageType: 0,
    damageAmount: fp(25),
    ownerId: e,
    team: 0,
  });
  return e;
}

function makeMonster(sim: Simulation, mx: number, my: number) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: mx, y: my });
  sim.world.set<MonsterC>(e, "monster", {
    defId: "monster.cinder_imp.v1",
    moveSpeed: 0, bodyRadius: fp(0.5),
    attackRange: fp(1.2), attackCooldownTicks: 45,
    attackDamage: fp(6), attackType: 1,
    attackReadyTick: 0, state: "idle", rare: 0, summoned: 0,
  });
  sim.world.set<Faction>(e, "faction", { team: 1 });
  return e;
}

describe("registerProjectileMove", () => {
  it("projectile advances by (dirx, diry) each tick", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    const proj = makeProjectile(sim, 0, 0, fp(1), 0);
    sim.step();
    const pos = sim.world.get<Position>(proj, "position")!;
    expect(pos.x).toBe(fp(1));
    expect(pos.y).toBe(0);
  });

  it("remainingRange decreases by isqrt(dirx^2 + diry^2) per tick", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    const dirx = fp(1); // 1000
    const proj = makeProjectile(sim, 0, 0, dirx, 0, fp(20));
    sim.step();
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    // isqrt(1000^2 + 0) = 1000
    expect(p.remainingRange).toBe(fp(20) - 1000);
  });

  it("monster within (radius + bodyRadius) gets damage enqueued and remainingRange set to 0", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    // projectile at (0,0) moving right by fp(1)=1000 per tick; radius fp(0.4)=400
    const proj = makeProjectile(sim, 0, 0, fp(1), 0, fp(20));
    // monster at fp(1)=1000, y=0; bodyRadius fp(0.5)=500
    // after step: proj at (1000,0), dist2 to monster = 0; (400+500)^2 = 810000 >= 0 -> HIT
    const monster = makeMonster(sim, fp(1), 0);
    sim.step();
    // damage enqueued
    expect(sim.damageQueue).toHaveLength(1);
    const evt: DamageEvent = sim.damageQueue[0]!;
    expect(evt.target).toBe(monster);
    expect(evt.amountFixed).toBe(fp(25));
    expect(evt.type).toBe(0);
    // remainingRange set to 0 (spent)
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    expect(p.remainingRange).toBeLessThanOrEqual(0);
  });

  it("miss: no damage when monster is out of range", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    const proj = makeProjectile(sim, 0, 0, fp(1), 0, fp(20));
    // monster far away at fp(50)
    makeMonster(sim, fp(50), 0);
    sim.step();
    expect(sim.damageQueue).toHaveLength(0);
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    expect(p.remainingRange).toBeGreaterThan(0);
  });

  it("range depletes to 0 after enough ticks with no hit", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    // dirx = fp(1) = 1000; each tick remainingRange -= 1000; starts at fp(3) = 3000
    const proj = makeProjectile(sim, 0, 0, fp(1), 0, fp(3));
    sim.step(); // range 2000
    sim.step(); // range 1000
    sim.step(); // range 0
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    expect(p.remainingRange).toBeLessThanOrEqual(0);
  });

  it("a spent projectile does not move or deal damage again on later ticks", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    const proj = makeProjectile(sim, 0, 0, fp(1), 0, fp(20));
    const monster1 = makeMonster(sim, fp(1), 0);
    sim.step(); // hit monster1: 1 damage, remainingRange set to 0, proj now at (fp(1),0)
    expect(sim.damageQueue).toHaveLength(1);
    const afterHit = sim.world.get<Position>(proj, "position")!;
    // place a SECOND monster right where the projectile would advance to next tick
    makeMonster(sim, fp(2), 0);
    sim.step(); // spent projectile must be inert: no new damage, no movement
    expect(sim.damageQueue).toHaveLength(0);
    const afterSecond = sim.world.get<Position>(proj, "position")!;
    expect(afterSecond.x).toBe(afterHit.x);
    expect(afterSecond.y).toBe(afterHit.y);
  });
});
