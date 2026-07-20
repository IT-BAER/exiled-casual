import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerExpiry } from "./expiry";

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
