import { describe, it, expect } from "vitest";
import { Simulation } from "../loop";
import { fp, fpDist2 } from "@exiled/fixed-point";
import type { Position, MonsterC, Faction, PlayerC, BossC } from "../components";
import { registerMonsterAI } from "./monster-ai";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";

describe("registerMonsterAI", () => {
  it("monster far from player chases — squared distance strictly decreases", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(0), y: fp(0) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    world.set<Position>(m, "position", { x: fp(8), y: fp(0) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    const before = fpDist2(fp(8), fp(0), fp(0), fp(0));
    sim.step();
    const mpos = world.get<Position>(m, "position")!;
    expect(fpDist2(mpos.x, mpos.y, fp(0), fp(0))).toBeLessThan(before);
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("chase");
  });

  /**
   * Without this, opening a map is one fight against everything in it: every
   * monster walks at the entrance from the tick the area is built, and the pack
   * that meets you is the whole population rather than one room of it.
   */
  it("a monster outside the aggro radius stays asleep", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(0), y: fp(0) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    world.set<Position>(m, "position", { x: fp(20), y: fp(0) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    for (let i = 0; i < 30; i++) sim.step();
    expect(world.get<Position>(m, "position")).toEqual({ x: fp(20), y: fp(0) });
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("idle");
  });

  it("waking is one-way — a pulled monster follows past the radius", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(0), y: fp(0) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    world.set<Position>(m, "position", { x: fp(5), y: fp(0) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    sim.step(); // woken: inside the radius
    // The player runs well past the radius; the monster must still be coming.
    world.set<Position>(player, "position", { x: fp(-40), y: fp(0) });
    const before = world.get<Position>(m, "position")!.x;
    sim.step();
    expect(world.get<Position>(m, "position")!.x).toBeLessThan(before);
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("chase");
  });

  it("within attackRange → attack state; damage enqueued once per cooldown window", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(0), y: fp(0) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    // fp(1) = 1000 < attackRange fp(1.2) = 1200 → in range
    world.set<Position>(m, "position", { x: fp(1), y: fp(0) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    // tick=0, attackReadyTick=0 → enqueue
    sim.step();
    expect(sim.damageQueue).toHaveLength(1);
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("attack");
    // attackReadyTick is now 0+45=45; tick 1 < 45 → no re-enqueue
    sim.step();
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("boss entity is skipped — registerMonsterAI does not move it", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(0), y: fp(0) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const boss = world.create();
    world.set<Position>(boss, "position", { x: fp(10), y: fp(0) });
    world.set<Faction>(boss, "faction", { team: 1 });
    world.set<MonsterC>(boss, "monster", {
      defId: "boss.test", moveSpeed: fp(2), bodyRadius: fp(1),
      attackRange: fp(1.5), attackCooldownTicks: 60,
      attackDamage: fp(10), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });
    // Give it a boss component so the guard fires.
    world.set<BossC>(boss, "boss", {
      phase: 1, nextAbilityTick: 0, spawnX: fp(10), spawnY: fp(0), rootedUntilTick: 0,
    });

    sim.step();
    // Position must be unchanged — monster-ai skipped this entity.
    expect(world.get<Position>(boss, "position")).toEqual({ x: fp(10), y: fp(0) });
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("no players → idle, position unchanged", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;

    const m = world.create();
    world.set<Position>(m, "position", { x: fp(5), y: fp(3) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "chase", rare: 0 as const, summoned: 0 as const,
    });

    sim.step();
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("idle");
    expect(world.get<Position>(m, "position")).toEqual({ x: fp(5), y: fp(3) });
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("a chasing monster is blocked by a wall in collision", () => {
    // Wall column at cx=3; monster on the left, player on the right.
    const collision = gridCollision(
      makeGrid([
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
      ]),
    );
    const sim = new Simulation();
    registerMonsterAI(sim, { active: collision });
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(5), y: fp(2) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    world.set<Position>(m, "position", { x: fp(1), y: fp(2) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: 0,
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    for (let i = 0; i < 5; i++) sim.step();
    // Never crosses the wall to reach the player's side.
    expect(world.get<Position>(m, "position")!.x).toBeLessThan(fp(3));
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("chase");
  });
});
