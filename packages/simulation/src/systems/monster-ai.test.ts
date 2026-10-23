import { describe, it, expect } from "vitest";
import { Simulation } from "../loop";
import { fp, fpDist2 } from "@exiled/fixed-point";
import type { Position, MonsterC, Faction, PlayerC, BossC, Health, ProjectileC, DefensesC, TelegraphC, SessionC } from "../components";
import { registerMonsterAI, AGGRO_RADIUS } from "./monster-ai";
import { registerDamageResolve } from "./damage-resolve";
import { registerTelegraphResolve } from "./telegraph-resolve";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";
import { MONSTERS } from "@exiled/content-runtime";
import { spawnMonster, PACK_SPREAD } from "../areas";
import type { MonsterDef } from "@exiled/content-schema";
import { resBlock } from "@exiled/content-schema";

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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
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

  /** The death screen is a decision, not a fight the pack keeps having with a body. */
  it("a dead player is not a target — the pack goes idle over the corpse", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(0), y: fp(0) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set<Health>(player, "health", { life: fp(100), maxLife: fp(100) });

    const m = world.create();
    world.set<Position>(m, "position", { x: fp(1), y: fp(0) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    sim.step();
    expect(sim.damageQueue).toHaveLength(1);   // alive: it swings

    world.set<Health>(player, "health", { life: 0, maxLife: fp(100) });
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.damageQueue).toHaveLength(0);
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("idle");
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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "chase", rare: 0 as const, summoned: 0 as const,
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
      // Starts pulled. This wall is solid top to bottom, so an idle monster
      // behind it can no longer see the player to wake at all — which is its
      // own test below. The subject here is movement, not noticing.
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "chase", rare: 0 as const, summoned: 0 as const,
    });

    for (let i = 0; i < 5; i++) sim.step();
    // Never crosses the wall to reach the player's side.
    expect(world.get<Position>(m, "position")!.x).toBeLessThan(fp(3));
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("chase");
  });

  it("does not wake a monster on the far side of a wall", () => {
    // Solid column between the two, well inside AGGRO_RADIUS. Distance alone used
    // to wake it, so a pack woke through the rock it was standing behind and came
    // round before the player had seen any of it.
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
    const start = { x: fp(1), y: fp(2) };
    world.set<Position>(m, "position", start);
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: 0,
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });
    // Premise: close enough that only the wall can be keeping it asleep.
    expect(fpDist2(start.x, start.y, fp(5), fp(2))).toBeLessThan(AGGRO_RADIUS * AGGRO_RADIUS);

    for (let i = 0; i < 60; i++) sim.step();
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("idle");
    expect(world.get<Position>(m, "position")).toEqual(start);
  });

  it("wakes a monster with a clear line to the player at the same distance", () => {
    // Same geometry and the same 4-unit gap, wall removed: proves the test above
    // is measuring the wall and not the distance.
    const collision = gridCollision(
      makeGrid([
        ".......",
        ".......",
        ".......",
        ".......",
        ".......",
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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    sim.step();
    expect(world.get<MonsterC>(m, "monster")!.state).not.toBe("idle");
  });

  it("a chasing monster walks around a wall that has a way past it", () => {
    // Same wall as above, open along the bottom row. Greedy chase grinds on it
    // forever; the nav field routes down, across and back up.
    const collision = gridCollision(
      makeGrid([
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        ".......",
      ]),
    );
    const sim = new Simulation();
    registerMonsterAI(sim, { active: collision });
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: fp(5), y: fp(1) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    world.set<Position>(m, "position", { x: fp(1), y: fp(1) });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(0.2), bodyRadius: 0,
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      // Pulled, for the same reason as the test above: the way past this wall is
      // the bottom row, and the sight line to the player runs through the wall.
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "chase", rare: 0 as const, summoned: 0 as const,
    });

    for (let i = 0; i < 150; i++) sim.step();
    const mpos = world.get<Position>(m, "position")!;
    expect(mpos.x).toBeGreaterThan(fp(3));
    expect(fpDist2(mpos.x, mpos.y, fp(5), fp(1))).toBeLessThan(fp(1.5) * fp(1.5));
    // In range and swinging, not merely nearby.
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("attack");
  });
});

/**
 * A pack all walking at the same point converges on it, so without a push they
 * arrive as one silhouette with one health bar's worth of readable geometry.
 */
describe("pack separation", () => {
  const trash = (world: Simulation["world"], x: number, y: number, r = fp(0.5)) => {
    const m = world.create();
    world.set<Position>(m, "position", { x, y });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: r,
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0,
      state: "chase", rare: 0 as const, summoned: 0 as const,
    });
    return m;
  };
  const playerAt = (world: Simulation["world"], x: number, y: number) => {
    const p = world.create();
    world.set<Position>(p, "position", { x, y });
    world.set<Faction>(p, "faction", { team: 0 });
    world.set<PlayerC>(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    return p;
  };

  it("two bodies on exactly the same point split apart", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    playerAt(world, fp(0), fp(0));
    const a = trash(world, fp(6), fp(0));
    const b = trash(world, fp(6), fp(0));

    sim.step();
    const pa = world.get<Position>(a, "position")!;
    const pb = world.get<Position>(b, "position")!;
    expect(fpDist2(pa.x, pa.y, pb.x, pb.y)).toBeGreaterThan(0);
  });

  it("a chasing pack stops overlapping within a few ticks", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    playerAt(world, fp(0), fp(0));
    const ids = [
      trash(world, fp(6), fp(0)),
      trash(world, fp(6.1), fp(0)),
      trash(world, fp(6.2), fp(0.05)),
    ];

    for (let i = 0; i < 60; i++) sim.step();
    // 80% of contact distance: the push only fires below contact, so the pack
    // settles just inside it rather than exactly on it.
    const floor = Math.trunc((fp(1) * 8) / 10);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = world.get<Position>(ids[i]!, "position")!;
        const q = world.get<Position>(ids[j]!, "position")!;
        expect(fpDist2(p.x, p.y, q.x, q.y)).toBeGreaterThanOrEqual(floor * floor);
      }
    }
  });

  /**
   * The player walks through monsters (his movement ignores their bodies), so the
   * separation has to come from their side, or a pack stands inside him.
   */
  it("a monster the player walked onto is shouldered off him, and still hits", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    playerAt(world, fp(0), fp(0));
    const m = trash(world, fp(0.2), fp(0));
    for (let i = 0; i < 30; i++) sim.step();
    const p = world.get<Position>(m, "position")!;
    // Contact is 0.5 + 0.5; the push fires only below it, so it settles just inside.
    const floor = Math.trunc((fp(1) * 8) / 10);
    expect(fpDist2(p.x, p.y, 0, 0)).toBeGreaterThanOrEqual(floor * floor);
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("attack");
  });

  it("a lone monster's chase is untouched by the pass", () => {
    const run = () => {
      const sim = new Simulation();
      registerMonsterAI(sim);
      const { world } = sim;
      playerAt(world, fp(0), fp(0));
      const m = trash(world, fp(6), fp(0));
      for (let i = 0; i < 10; i++) sim.step();
      return world.get<Position>(m, "position")!;
    };
    // Straight line in, snapped to attack range: no neighbour, so no push.
    const p = run();
    expect(p.y).toBe(fp(0));
    expect(p).toEqual(run());
  });

  /**
   * More bodies than fit round him: the ones that cannot reach queue behind the
   * ring instead of pressing into it. Without this the back rows walked into the
   * front at full step while the push gave back half, and the pack piled up
   * inside the player and inside each other.
   */
  it("a pack bigger than the ring round the player stands neither in him nor in each other", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    playerAt(world, fp(0), fp(0));
    const def = MONSTERS.get("monster.sand_skitterer.v1")!;
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) {
      const e = spawnMonster(world, def, fp(6 + (i % 4) * 0.4), fp(Math.floor(i / 4) * 0.4 - 0.4), false);
      world.set<MonsterC>(e, "monster", { ...world.get<MonsterC>(e, "monster")!, state: "chase" });
      ids.push(e);
    }
    for (let i = 0; i < 240; i++) sim.step();

    const r = def.radiusFixed;
    // 90% of contact: the push fires only below contact, so a pair settles just inside it.
    const near = (a: number) => Math.trunc((a * 9) / 10);
    for (let i = 0; i < ids.length; i++) {
      const p = world.get<Position>(ids[i]!, "position")!;
      expect(fpDist2(p.x, p.y, 0, 0)).toBeGreaterThanOrEqual(near(r + fp(0.5)) ** 2);
      for (let j = i + 1; j < ids.length; j++) {
        const q = world.get<Position>(ids[j]!, "position")!;
        expect(fpDist2(p.x, p.y, q.x, q.y)).toBeGreaterThanOrEqual(near(2 * r) ** 2);
      }
    }
    // The front rank still reaches him.
    expect(ids.filter((e) => world.get<MonsterC>(e, "monster")!.state === "attack").length).toBeGreaterThan(3);
  });

  /**
   * A swarm closing on a stationary player, laid out as areas.ts lays a pack. What
   * reads wrong on screen: a body turning back on itself (a visible step, >90
   * degrees off its last visible one), stopping and starting again inside a third
   * of a second, and standing deep inside a neighbour.
   */
  const swarmRun = (defId: string, n: number) => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    playerAt(world, fp(0), fp(0));
    const def = MONSTERS.get(defId)!;
    const ids = PACK_SPREAD.slice(0, n).map((o) => {
      const e = spawnMonster(world, def, fp(8) + o.dx, o.dy, false);
      world.set<MonsterC>(e, "monster", { ...world.get<MonsterC>(e, "monster")!, state: "chase" });
      return e;
    });
    const visible = Math.trunc(def.moveSpeedFixed / 30 / 10);
    const last = ids.map(() => ({ dx: 0, dy: 0 }));
    const still = ids.map(() => -1);
    let reversals = 0;
    let restarts = 0;
    let minSep = Infinity;
    const ticks = 240;
    for (let t = 0; t < ticks; t++) {
      const before = ids.map((e) => ({ ...world.get<Position>(e, "position")! }));
      sim.step();
      ids.forEach((e, i) => {
        const a = world.get<Position>(e, "position")!;
        const dx = a.x - before[i]!.x;
        const dy = a.y - before[i]!.y;
        if (dx * dx + dy * dy < visible * visible) { if (still[i]! >= 0) still[i]!++; return; }
        if (dx * last[i]!.dx + dy * last[i]!.dy < 0) reversals++;
        if (still[i]! > 0 && still[i]! < 10) restarts++;
        still[i] = 0;
        last[i] = { dx, dy };
      });
      if (t < 30) continue;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const p = world.get<Position>(ids[i]!, "position")!;
          const q = world.get<Position>(ids[j]!, "position")!;
          minSep = Math.min(minSep, Math.sqrt(fpDist2(p.x, p.y, q.x, q.y)) / (2 * def.radiusFixed));
        }
      }
    }
    const attackers = ids.filter((e) => world.get<MonsterC>(e, "monster")!.state === "attack").length;
    return { reversalsPerSec: reversals / n / (ticks / 30), restartsEach: restarts / n, minSep, attackers };
  };

  it.each([
    ["monster.bramble_whelp.v1", 8], ["monster.bramble_whelp.v1", 16],
    ["monster.sand_skitterer.v1", 8], ["monster.sand_skitterer.v1", 16],
  ] as const)("a swarm of %s x%i flows in without jitter or overlap", (defId, n) => {
    const m = swarmRun(defId, n);
    // A turn-back more than once every four seconds per body reads as shuffling.
    expect(m.reversalsPerSec).toBeLessThanOrEqual(0.25);
    // Stop-and-go: at most one restart per body over the whole approach.
    expect(m.restartsEach).toBeLessThanOrEqual(1);
    // 90% of contact: the push fires only below contact, so a pair settles just inside it.
    expect(m.minSep).toBeGreaterThanOrEqual(0.9);
    // The front rank still fills: five skitterer shells span most of the ring.
    expect(m.attackers).toBeGreaterThanOrEqual(5);
  });

  it("the push never shoves a body into a wall", () => {
    // One-cell corridor along row 2; two bodies crammed into it.
    const collision = gridCollision(
      makeGrid([
        "#######",
        "#######",
        ".......",
        "#######",
        "#######",
      ]),
    );
    const sim = new Simulation();
    registerMonsterAI(sim, { active: collision });
    const { world } = sim;
    playerAt(world, fp(0), fp(2));
    const a = trash(world, fp(4), fp(2), fp(0.2));
    const b = trash(world, fp(4.1), fp(2), fp(0.2));

    for (let i = 0; i < 40; i++) sim.step();
    for (const m of [a, b]) {
      const p = world.get<Position>(m, "position")!;
      expect(collision.isWalkable(p.x, p.y, fp(0.2))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Shared fixture for shooter tests
// ---------------------------------------------------------------------------
function aiFixture(opts: {
  def: MonsterDef;
  monsterAt: { x: number; y: number };
  playerAt: { x: number; y: number };
  withTelegraphResolve?: boolean;
}) {
  const sim = new Simulation();
  registerMonsterAI(sim);
  if (opts.withTelegraphResolve) registerTelegraphResolve(sim);
  registerDamageResolve(sim);
  const { world } = sim;

  const player = world.create();
  world.set<Position>(player, "position", opts.playerAt);
  world.set<Faction>(player, "faction", { team: 0 });
  world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
  world.set<Health>(player, "health", { life: fp(100), maxLife: fp(100) });
  // damageResolve skips targets without defenses; 0 armour / 0 res passes full damage.
  world.set<DefensesC>(player, "defenses", { res: resBlock(), armour: fp(0) });

  const monster = spawnMonster(world, opts.def, opts.monsterAt.x, opts.monsterAt.y, false);
  // Force awake so we test firing logic, not aggro.
  const mon = world.get<MonsterC>(monster, "monster")!;
  world.set<MonsterC>(monster, "monster", { ...mon, state: "chase" });

  return { sim, world, monster, player };
}

describe("shooters", () => {
  it("fires a bolt instead of hitting, and the bolt is on its team", () => {
    const { sim, world, monster, player } = aiFixture({
      def: MONSTERS.get("monster.dune_spitter.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },   // inside range 5
    });
    const before = world.get<Health>(player, "health")!.life;

    sim.step();

    const bolts = world.query("projectile");
    expect(bolts.length).toBe(1);
    expect(world.get<ProjectileC>(bolts[0]!, "projectile")!.team).toBe(1);
    expect(world.get<ProjectileC>(bolts[0]!, "projectile")!.ownerId).toBe(monster);
    // The bolt has to travel; the shot itself does no damage.
    expect(world.get<Health>(player, "health")!.life).toBe(before);
  });

  it("respects its attack cooldown", () => {
    const { sim, world } = aiFixture({
      def: MONSTERS.get("monster.dune_spitter.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
    });
    for (let i = 0; i < 10; i++) sim.step();
    // 70-tick cooldown: ten ticks is exactly one bolt. Zero would mean it never
    // fired; more than one would mean the cooldown is not being applied.
    expect(world.query("projectile").length).toBe(1);
  });

  it("does not fire while the player is out of range", () => {
    const { sim, world } = aiFixture({
      def: MONSTERS.get("monster.dune_spitter.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(8.5), y: fp(0) },  // awake (< AGGRO_RADIUS 9), out of range (> 5)
    });
    sim.step();
    expect(world.query("projectile").length).toBe(0);
  });

  it("in range behind a wall, it walks round for a line instead of shooting the rock", () => {
    const sim = new Simulation();
    registerMonsterAI(sim, { active: gridCollision(makeGrid(["...#...", "...#...", "...#...", "...#...", ".......", "......."])) });
    const { world } = sim;
    const player = world.create();
    world.set<Position>(player, "position", { x: fp(5), y: fp(1) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    const m = spawnMonster(world, MONSTERS.get("monster.fen_wisp.v1")!, fp(1), fp(1), false);
    world.set<MonsterC>(m, "monster", { ...world.get<MonsterC>(m, "monster")!, state: "chase" });

    sim.step();
    expect(world.query("projectile").length).toBe(0);
    expect(world.get<Position>(m, "position")).not.toEqual({ x: fp(1), y: fp(1) });
    for (let i = 0; i < 300; i++) sim.step();
    expect(world.query("projectile").length).toBeGreaterThan(0);
  });

  it("a melee monster still enqueues damage and spawns no bolt", () => {
    const { sim, world, player } = aiFixture({
      def: MONSTERS.get("monster.vaal_husk.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(1), y: fp(0) },
    });
    const before = world.get<Health>(player, "health")!.life;
    sim.step();
    expect(world.query("projectile").length).toBe(0);
    expect(world.get<Health>(player, "health")!.life).toBeLessThan(before);
  });
});

describe("heavies", () => {
  const sentinel = () => MONSTERS.get("monster.blood_sentinel.v1")!;

  it("telegraphs on the player's position instead of hitting", () => {
    const { sim, world, monster, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },   // inside slam range 6.5, outside melee 1.8
    });
    const before = world.get<Health>(player, "health")!.life;

    sim.step();

    const teles = world.query("telegraph");
    expect(teles.length).toBe(1);
    const tg = world.get<TelegraphC>(teles[0]!, "telegraph")!;
    expect(tg.ownerId).toBe(monster);
    expect(tg.team).toBe(1);
    expect(tg.leavesGroundTicks).toBe(0);  // a burning patch stays a boss privilege
    expect(world.get<Position>(teles[0]!, "position")!.x).toBe(fp(4));
    expect(world.get<Health>(player, "health")!.life).toBe(before);
  });

  it("does not move or melee while rooted in the wind-up", () => {
    const { sim, world, monster, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
    });
    sim.step();                                   // starts the wind-up
    const at = { ...world.get<Position>(monster, "position")! };
    const life = world.get<Health>(player, "health")!.life;
    for (let i = 0; i < 10; i++) sim.step();      // still inside 30 ticks
    expect(world.get<Position>(monster, "position")).toEqual(at);
    expect(world.get<Health>(player, "health")!.life).toBe(life);
  });

  it("the slam lands where it was telegraphed, on the wind-up tick", () => {
    const { sim, world, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
      withTelegraphResolve: true,
    });
    const before = world.get<Health>(player, "health")!.life;
    for (let i = 0; i < 32; i++) sim.step();      // windupTicks 30, plus slack
    expect(world.get<Health>(player, "health")!.life).toBeLessThan(before);
    expect(world.query("telegraph").length).toBe(0);   // resolved and destroyed
  });

  it("auto-attacks fire in the gap between slams (slamReadyTick independent of attackReadyTick)", () => {
    // Player at fp(1): inside melee range (1.8) AND slam range (6.5).
    // Tick 0 -> slam, slamReadyTick=150, attackReadyTick stays 0.
    // Ticks 1..30 -> rooted (windupTicks=30).
    // Tick 31 -> first auto fires (attackReadyTick=0 < 31); if timers were shared
    //            this would never fire because attackReadyTick would be 150.
    // Ticks 32..149 -> more autos; life keeps dropping before the second slam.
    const { sim, world, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(1), y: fp(0) },
      withTelegraphResolve: true,
    });
    for (let i = 0; i < 32; i++) sim.step(); // slam lands at tick 30, first auto at tick 31
    const lifeAfterSlamAndFirstAuto = world.get<Health>(player, "health")!.life;
    // Between ticks 32..149 no second slam (slamReadyTick=150), only melee autos.
    for (let i = 32; i < 149; i++) sim.step();
    expect(world.get<Health>(player, "health")!.life).toBeLessThan(lifeAfterSlamAndFirstAuto);
  });

  it("slam damage scales with the map's tier (dmgMilli applied)", () => {
    // Sessionless world: dmgMilli defaults to 1000, damage = heavy.damageFixed * 1 = base.
    const noSession = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
    });
    noSession.sim.step();
    const baseDmg = noSession.world.get<TelegraphC>(
      noSession.world.query("telegraph")[0]!, "telegraph",
    )!.damage;

    // High-tier session: monsterTierScale(15).dmgMilli >> 1000.
    const withSession = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
    });
    const sessionE = withSession.world.create();
    withSession.world.set<SessionC>(sessionE, "session", {
      area: "map", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0,
      areaTier: 15, activeNodeId: "", completedNodes: [], portalsLeft: 6,
      mapOpen: 1, pendingArea: "",
    });
    withSession.sim.step();
    const scaledDmg = withSession.world.get<TelegraphC>(
      withSession.world.query("telegraph")[0]!, "telegraph",
    )!.damage;

    expect(scaledDmg).toBeGreaterThan(baseDmg);
  });

  it("a player who steps out of the ring takes nothing", () => {
    const { sim, world, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
      withTelegraphResolve: true,
    });
    const before = world.get<Health>(player, "health")!.life;
    sim.step();                                    // telegraph placed at (4,0)
    // Radius 2.6 plus the player's body: 9 units away is unambiguously clear.
    world.set<Position>(player, "position", { x: fp(13), y: fp(0) });
    for (let i = 0; i < 32; i++) sim.step();
    expect(world.get<Health>(player, "health")!.life).toBe(before);
  });
});

describe("pack wake", () => {
  const sleeper = (world: Simulation["world"], x: number) =>
    spawnMonster(world, MONSTERS.get("monster.vaal_husk.v1")!, x, fp(0), false);
  const target = (world: Simulation["world"]) => {
    const p = world.create();
    world.set<Position>(p, "position", { x: fp(0), y: fp(0) });
    world.set<Faction>(p, "faction", { team: 0 });
    world.set<PlayerC>(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    return p;
  };
  const state = (world: Simulation["world"], m: number) => world.get<MonsterC>(m, "monster")!.state;

  it("a monster that notices the player wakes its pack, chained, without their own sight", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    target(world);
    const a = sleeper(world, fp(8));       // inside AGGRO_RADIUS: wakes on its own
    const b = sleeper(world, fp(12));      // 4 from a, outside AGGRO_RADIUS
    const c = sleeper(world, fp(16));      // 4 from b only: a chained wake
    const far = sleeper(world, fp(30));    // in nobody's pack
    expect(fp(12)).toBeGreaterThan(AGGRO_RADIUS);

    sim.step();
    expect(state(world, a)).not.toBe("idle");
    expect(state(world, b)).not.toBe("idle");
    expect(state(world, c)).not.toBe("idle");
    expect(state(world, far)).toBe("idle");
  });

  it("a monster woken by a hit wakes its pack", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    const p = target(world);
    const a = sleeper(world, fp(30));
    const b = sleeper(world, fp(33));
    // step() clears the queue first, so the hit is enqueued from inside the tick.
    sim.register("hit", () => sim.enqueueDamage({ target: a, source: p, amountFixed: fp(1), type: 0 }));
    registerDamageResolve(sim);
    sim.step();
    expect(state(world, a)).not.toBe("idle");
    expect(state(world, b)).not.toBe("idle");
  });

  it("never wakes a boss", () => {
    const sim = new Simulation();
    registerMonsterAI(sim);
    const { world } = sim;
    target(world);
    sleeper(world, fp(8));
    const boss = sleeper(world, fp(11));
    world.set<BossC>(boss, "boss", { phase: 1, nextAbilityTick: 0, spawnX: fp(11), spawnY: 0, rootedUntilTick: 0 });
    sim.step();
    expect(state(world, boss)).toBe("idle");
  });
});

describe("shooter kiting", () => {
  const spitter = () => MONSTERS.get("monster.dune_spitter.v1")!;
  const dist2 = (world: Simulation["world"], a: number, b: number) => {
    const p = world.get<Position>(a, "position")!;
    const q = world.get<Position>(b, "position")!;
    return fpDist2(p.x, p.y, q.x, q.y);
  };

  it("backs away from a player inside its comfort range, no faster than it walks", () => {
    const { sim, world, monster, player } = aiFixture({
      def: spitter(), monsterAt: { x: fp(0), y: fp(0) }, playerAt: { x: fp(2), y: fp(0) },
    });
    const speed = world.get<MonsterC>(monster, "monster")!.moveSpeed;
    const before = dist2(world, monster, player);
    sim.step();
    expect(dist2(world, monster, player)).toBeGreaterThan(before);
    const x = world.get<Position>(monster, "position")!.x;
    expect(x).toBeLessThan(0);
    expect(-x).toBeLessThanOrEqual(speed);
    expect(speed).toBeLessThan(Math.trunc(fp(4.2) / 30));
  });

  it("cornered against a wall it stands and shoots", () => {
    const sim = new Simulation();
    const collision = gridCollision(makeGrid(["#.....", "#.....", "#....."]));
    registerMonsterAI(sim, { active: collision });
    const { world } = sim;
    const player = world.create();
    world.set<Position>(player, "position", { x: fp(3.5), y: fp(1.5) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    const m = spawnMonster(world, spitter(), fp(1.5), fp(1.5), false);
    world.set<MonsterC>(m, "monster", { ...world.get<MonsterC>(m, "monster")!, state: "chase" });
    for (let i = 0; i < 20; i++) {
      sim.step();
      const p = world.get<Position>(m, "position")!;
      expect(collision.isWalkable(p.x, p.y, fp(0.5))).toBe(true);
    }
    expect(world.query("projectile").length).toBeGreaterThan(0);
  });

  it("strafes sideways between shots, flipping side on a fixed cadence", () => {
    const run = () => {
      const { sim, world, monster } = aiFixture({
        def: spitter(), monsterAt: { x: fp(0), y: fp(0) }, playerAt: { x: fp(5), y: fp(0) },
      });
      const ys: number[] = [];
      for (let i = 0; i < 120; i++) { sim.step(); ys.push(world.get<Position>(monster, "position")!.y); }
      return { ys, bolts: world.query("projectile").length };
    };
    const { ys, bolts } = run();
    expect(bolts).toBeGreaterThanOrEqual(2);   // 70-tick cooldown: still fires on time
    const steps = ys.slice(1).map((y, i) => Math.sign(y - ys[i]!));
    expect(steps).toContain(1);
    expect(steps).toContain(-1);
    expect(run().ys).toEqual(ys);
  });
});

describe("brute charge", () => {
  const construct = () => MONSTERS.get("monster.vaal_construct.v1")!;

  it("every non-boss brute carries a charge", () => {
    for (const id of ["monster.vaal_construct.v1", "monster.bog_drowned.v1", "monster.thornhide_boar.v1"]) {
      expect(MONSTERS.get(id)!.charge).toBeDefined();
    }
  });

  it("winds up rooted under a telegraph on the player, then dashes to it", () => {
    const { sim, world, monster } = aiFixture({
      def: construct(), monsterAt: { x: fp(0), y: fp(0) }, playerAt: { x: fp(5), y: fp(0) },
    });
    const charge = construct().charge!;
    sim.step();
    const teles = world.query("telegraph");
    expect(teles.length).toBe(1);
    const tg = world.get<TelegraphC>(teles[0]!, "telegraph")!;
    expect(world.get<Position>(teles[0]!, "position")).toEqual({ x: fp(5), y: fp(0) });
    expect(tg.radius).toBe(charge.radiusFixed);
    expect(tg.leavesGroundTicks).toBe(0);
    expect(tg.impactTick).toBeGreaterThan(charge.windupTicks);
    expect(world.get<MonsterC>(monster, "monster")!.lastAttackTick).toBe(0);

    for (let i = 1; i < charge.windupTicks; i++) sim.step();
    expect(world.get<Position>(monster, "position")).toEqual({ x: fp(0), y: fp(0) });
    sim.step();
    sim.step();
    // Faster than a walk: two dash ticks cover more than three walking ones.
    expect(world.get<Position>(monster, "position")!.x)
      .toBeGreaterThan(3 * world.get<MonsterC>(monster, "monster")!.moveSpeed);
    for (let i = 0; i < 60; i++) sim.step();
    expect(world.get<Position>(monster, "position")!.x).toBeGreaterThan(fp(3));
  });

  it("the telegraph carries the hit: standing in it hurts, leaving it does not", () => {
    const hit = (dodge: boolean) => {
      const { sim, world, player } = aiFixture({
        def: construct(), monsterAt: { x: fp(0), y: fp(0) }, playerAt: { x: fp(5), y: fp(0) },
        withTelegraphResolve: true,
      });
      sim.step();
      const tg = world.get<TelegraphC>(world.query("telegraph")[0]!, "telegraph")!;
      if (dodge) world.set<Position>(player, "position", { x: fp(5), y: fp(20) });
      for (let t = 1; t <= tg.impactTick; t++) sim.step();
      return world.get<Health>(player, "health")!.life;
    };
    expect(hit(false)).toBeLessThan(fp(100));
    expect(hit(true)).toBe(fp(100));
  });

  it("does not charge inside its minimum or past its maximum range", () => {
    for (const x of [fp(2), fp(8.5)]) {
      const { sim, world } = aiFixture({
        def: construct(), monsterAt: { x: fp(0), y: fp(0) }, playerAt: { x, y: fp(0) },
      });
      sim.step();
      expect(world.query("telegraph").length).toBe(0);
    }
  });

  it("does not charge without a line to the player", () => {
    const sim = new Simulation();
    registerMonsterAI(sim, { active: gridCollision(makeGrid(["...#....", "...#....", "...#...."])) });
    const { world } = sim;
    const player = world.create();
    world.set<Position>(player, "position", { x: fp(6.5), y: fp(1.5) });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    const m = spawnMonster(world, construct(), fp(1), fp(1.5), false);
    world.set<MonsterC>(m, "monster", { ...world.get<MonsterC>(m, "monster")!, state: "chase" });
    sim.step();
    expect(world.query("telegraph").length).toBe(0);
  });
});

/**
 * A pack that stands frozen until it is pulled reads as furniture: idle trash
 * strolls a few metres round where it spawned while a player is near enough to
 * see it, and wakes exactly as before.
 */
describe("idle wander", () => {
  const SPEED = Math.trunc(fp(3) / 30);
  const R = fp(0.5);

  function wanderFixture(playerX: number, rows?: string[], at = { x: fp(0), y: fp(0) }) {
    const sim = new Simulation();
    const collision = rows ? gridCollision(makeGrid(rows)) : null;
    registerMonsterAI(sim, { active: collision });
    const { world } = sim;
    const player = world.create();
    world.set<Position>(player, "position", { x: at.x + fp(playerX), y: at.y });
    world.set<Faction>(player, "faction", { team: 0 });
    world.set<PlayerC>(player, "player", { moveSpeed: 0, bodyRadius: R });
    const m = world.create();
    world.set<Position>(m, "position", { ...at });
    world.set<Faction>(m, "faction", { team: 1 });
    world.set<MonsterC>(m, "monster", {
      defId: "test", moveSpeed: SPEED, bodyRadius: R,
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });
    return { sim, world, player, m, collision };
  }

  function track(sim: Simulation, m: number, ticks: number): Position[] {
    const out: Position[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step();
      out.push({ ...sim.world.get<Position>(m, "position")! });
    }
    return out;
  }

  it("strolls round its spawn at a walk, pausing, and stays asleep", () => {
    const { sim, world, m } = wanderFixture(15);
    const path = track(sim, m, 600);
    const far = Math.max(...path.map((p) => Math.sqrt(fpDist2(p.x, p.y, 0, 0)) / fp(1)));
    expect(far).toBeGreaterThan(0.5);
    expect(far).toBeLessThanOrEqual(3);
    let still = 0;
    for (let i = 1; i < path.length; i++) {
      const step = Math.sqrt(fpDist2(path[i]!.x, path[i]!.y, path[i - 1]!.x, path[i - 1]!.y));
      expect(step).toBeLessThanOrEqual(Math.trunc((SPEED * 40) / 100) + 1);
      if (step === 0) still++;
    }
    expect(still).toBeGreaterThan(path.length / 3);
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("idle");
  });

  it("wakes as before when the player comes close", () => {
    const { sim, world, player, m } = wanderFixture(15);
    track(sim, m, 200);
    const p = world.get<Position>(m, "position")!;
    world.set<Position>(player, "position", { x: p.x + fp(4), y: p.y });
    sim.step();
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("chase");
  });

  it("a room no player is near stays untouched", () => {
    const { sim, world, m } = wanderFixture(20);
    const before = structuredClone(world.get<MonsterC>(m, "monster"));
    track(sim, m, 300);
    expect(world.get<Position>(m, "position")).toEqual({ x: fp(0), y: fp(0) });
    expect(world.get<MonsterC>(m, "monster")).toEqual(before);
  });

  it("is deterministic", () => {
    const a = wanderFixture(15);
    const b = wanderFixture(15);
    const pa = track(a.sim, a.m, 400);
    expect(pa.some((p) => p.x !== 0 || p.y !== 0)).toBe(true);
    expect(track(b.sim, b.m, 400)).toEqual(pa);
  });

  it("gives up a stroll it can only creep along", () => {
    const { sim, world, m } = wanderFixture(15);
    // A body that never moves stands on the target: the stroll must end, not
    // inch toward it a millimetre a tick.
    const rock = world.create();
    world.set<Position>(rock, "position", { x: fp(2), y: fp(0) });
    world.set<Faction>(rock, "faction", { team: 1 });
    world.set(rock, "boss", {});
    world.set<MonsterC>(rock, "monster", { ...world.get<MonsterC>(m, "monster")! });
    world.set<MonsterC>(m, "monster", {
      ...world.get<MonsterC>(m, "monster")!, homeX: 0, homeY: 0, strollAtTick: 0, strollX: fp(2), strollY: 0,
    });
    track(sim, m, 60);
    expect(world.get<MonsterC>(m, "monster")!.strollX).toBeUndefined();
  });

  it("gives up a stroll that has stalled against a wall, even while it still moves", () => {
    // Past a corner, slide runs it along the wall a millimetre a tick: never still,
    // barely nearer. Only a deflected stroll meets one, since a pick needs sight.
    const rows = [
      ".......",
      ".......",
      "...#...",
      ".......",
      ".......",
      ".......",
    ];
    const { sim, world, m } = wanderFixture(15, rows, { x: fp(3.4), y: fp(4) });
    world.set<MonsterC>(m, "monster", {
      ...world.get<MonsterC>(m, "monster")!, homeX: fp(3.4), homeY: fp(4), strollAtTick: 0, strollX: fp(2.6), strollY: fp(0),
    });
    let ended = false;
    for (let i = 0; i < 60 && !ended; i++) {
      sim.step();
      ended = world.get<MonsterC>(m, "monster")!.strollX === undefined;
    }
    expect(ended).toBe(true);
  });

  it("forgets where it stood once it falls back to idle, so the next player sets a new home", () => {
    const { sim, world, player, m } = wanderFixture(15);
    world.set<MonsterC>(m, "monster", {
      ...world.get<MonsterC>(m, "monster")!, state: "chase", homeX: fp(-40), homeY: fp(-40), strollAtTick: 0,
    });
    world.set<Health>(player, "health", { life: 0, maxLife: fp(100) });
    sim.step();
    const mon = world.get<MonsterC>(m, "monster")!;
    expect(mon.homeX).toBeUndefined();
    expect(mon.homeY).toBeUndefined();
  });

  it("forgets its stroll when it falls back to idle", () => {
    const { sim, world, player, m } = wanderFixture(15);
    world.set<MonsterC>(m, "monster", {
      ...world.get<MonsterC>(m, "monster")!, state: "chase", homeX: 0, homeY: 0, strollAtTick: 0, strollX: fp(2), strollY: 0,
    });
    world.set<Health>(player, "health", { life: 0, maxLife: fp(100) });
    sim.step();
    const mon = world.get<MonsterC>(m, "monster")!;
    expect(mon.state).toBe("idle");
    expect(mon.strollX).toBeUndefined();
  });

  it("never walks into a wall round its spawn", () => {
    // Rock on three sides inside the stroll radius.
    const rows = [
      "###########",
      "#.........#",
      "#.........#",
      "#..##.....#",
      "#..##..#..#",
      "#......#..#",
      "#.........#",
      "#.........#",
      "###########",
    ];
    const { sim, m, collision } = wanderFixture(15, rows, { x: fp(5), y: fp(6) });
    expect(collision!.isWalkable(fp(5), fp(6), R)).toBe(true);
    const path = track(sim, m, 900);
    for (const p of path) expect(collision!.isWalkable(p.x, p.y, R)).toBe(true);
    expect(path.some((p) => p.x !== fp(5) || p.y !== fp(6))).toBe(true);
  });
});
