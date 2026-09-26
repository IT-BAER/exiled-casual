import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerExpiry } from "./expiry";
import { registerProjectileMove } from "./projectile";
import type { Position, ProjectileC } from "../components";

describe("registerExpiry", () => {
  it("destroys a projectile with remainingRange <= 0", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    world.set(e, "projectile", {
      dirx: fp(1), diry: 0, remainingRange: 0,
      radius: fp(0.4), damageType: 0, damageAmount: fp(10),
      ownerId: 1, team: 0,
    });
    world.set(e, "position", { x: fp(3), y: fp(0) });

    sim.step();
    expect(world.alive.has(e)).toBe(false);
  });

  // The client draws the impact where it last saw the bolt. Destroyed on the
  // tick it hit, that was a step short of the body: a burst ~1 unit off the target.
  it("a bolt spent on a body stays one tick at the hit point, then goes", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    registerExpiry(sim);
    const { world } = sim;
    const target = world.create();
    world.set(target, "position", { x: fp(5), y: 0 });
    world.set(target, "health", { life: fp(40), maxLife: fp(40) });
    world.set(target, "faction", { team: 1 });
    const e = world.create();
    world.set(e, "projectile", {
      dirx: fp(0.4), diry: 0, remainingRange: fp(20),
      radius: fp(0.4), damageType: 0, damageAmount: fp(10),
      ownerId: 1, team: 0,
    });
    world.set(e, "position", { x: 0, y: 0 });

    let t = 0;
    while (world.get<ProjectileC>(e, "projectile")!.remainingRange > 0 && t++ < 30) sim.step();
    expect(world.alive.has(e)).toBe(true);
    expect(fp(5) - world.get<Position>(e, "position")!.x).toBeLessThanOrEqual(fp(0.4));
    sim.step();
    expect(world.alive.has(e)).toBe(false);
  });

  it("does not destroy a projectile with remainingRange > 0", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    world.set(e, "projectile", {
      dirx: fp(1), diry: 0, remainingRange: fp(5),
      radius: fp(0.4), damageType: 0, damageAmount: fp(10),
      ownerId: 1, team: 0,
    });
    world.set(e, "position", { x: fp(0), y: fp(0) });

    sim.step();
    expect(world.alive.has(e)).toBe(true);
  });

  it("destroys a groundArea whose expiryTick <= tick", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    world.set(e, "groundArea", {
      radius: fp(2.5), expiryTick: 0, nextTick: 0,
      ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(8), ailmentDuration: 60, maxStacks: 5, team: 0,
    });
    world.set(e, "position", { x: fp(0), y: fp(0) });

    sim.step();
    expect(world.alive.has(e)).toBe(false);
  });

  it("keeps a groundArea with expiryTick in the future", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    world.set(e, "groundArea", {
      radius: fp(2.5), expiryTick: 90, nextTick: 0,
      ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(8), ailmentDuration: 60, maxStacks: 5, team: 0,
    });
    world.set(e, "position", { x: fp(0), y: fp(0) });

    sim.step();
    expect(world.alive.has(e)).toBe(true);
  });
});
