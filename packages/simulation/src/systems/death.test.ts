import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerDeath } from "./death";
import type { SessionC } from "../components";

describe("registerDeath", () => {
  it("destroys a monster with life <= 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const m = world.create();
    world.set(m, "monster", { defId: "test", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    world.set(m, "health", { life: 0, maxLife: fp(40) });

    sim.step();
    expect(world.alive.has(m)).toBe(false);
  });

  it("respawns a player at origin with full life/mana when life <= 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set(p, "health", { life: 0, maxLife: fp(100) });
    world.set(p, "mana", { mana: fp(10), maxMana: fp(60), regen: 0 });
    world.set(p, "position", { x: fp(5), y: fp(5) });

    sim.step();

    expect(world.alive.has(p)).toBe(true);
    expect(world.get<{ life: number; maxLife: number }>(p, "health")!.life).toBe(fp(100));
    expect(world.get<{ mana: number; maxMana: number }>(p, "mana")!.mana).toBe(fp(60));
    expect(world.get<{ x: number; y: number }>(p, "position")).toEqual({ x: 0, y: 0 });
  });

  it("respawn clears stale moveTarget, moveDir, and ailment", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;
    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set(p, "health", { life: 0, maxLife: fp(100) });
    world.set(p, "mana", { mana: fp(10), maxMana: fp(60), regen: 0 });
    world.set(p, "position", { x: fp(5), y: fp(5) });
    world.set(p, "moveTarget", { x: fp(9), y: fp(9), active: 1 });
    world.set(p, "moveDir", { dx: 1, dy: 0 });
    world.set(p, "ailment", { kind: "burning", stacks: 3, dps: fp(8), expiryTick: 999 });
    sim.step();
    expect(world.get<{ active: number }>(p, "moveTarget")!.active).toBe(0);
    expect(world.get<{ dx: number; dy: number }>(p, "moveDir")).toEqual({ dx: 0, dy: 0 });
    expect(world.get(p, "ailment")).toBeUndefined();
    // existing respawn guarantees still hold:
    expect(world.get<{ life: number }>(p, "health")!.life).toBe(fp(100));
    expect(world.get<{ x: number; y: number }>(p, "position")).toEqual({ x: 0, y: 0 });
  });

  // ── Session-aware death tests ────────────────────────────────────────────

  function makePlayerWithSession(area: "hideout" | "map", portalsLeft: number) {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set(p, "health", { life: 0, maxLife: fp(100) });
    world.set(p, "mana", { mana: fp(0), maxMana: fp(60), regen: 0 });
    world.set(p, "position", { x: fp(3), y: fp(3) });

    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area, atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 0, portalsLeft, mapOpen: 1, pendingArea: "",
    });

    return { sim, world, p, sessionE };
  }

  it("map death decrements portalsLeft and sets pendingArea='hideout'", () => {
    const { sim, world, sessionE } = makePlayerWithSession("map", 6);
    sim.step();
    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.portalsLeft).toBe(5);
    expect(session.pendingArea).toBe("hideout");
  });

  it("6th map death drives portalsLeft to 0 and sets mapOpen=0", () => {
    const { sim, world, sessionE } = makePlayerWithSession("map", 1);
    sim.step();
    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.portalsLeft).toBe(0);
    expect(session.mapOpen).toBe(0);
    expect(session.pendingArea).toBe("hideout");
  });

  it("hideout death does NOT decrement portalsLeft", () => {
    const { sim, world, sessionE } = makePlayerWithSession("hideout", 6);
    sim.step();
    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.portalsLeft).toBe(6);
    expect(session.pendingArea).toBe("");
  });

  it("does not touch a monster with life > 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const m = world.create();
    world.set(m, "monster", { defId: "test", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    world.set(m, "health", { life: fp(1), maxLife: fp(40) });

    sim.step();
    expect(world.alive.has(m)).toBe(true);
  });
});
