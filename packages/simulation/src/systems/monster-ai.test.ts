import { describe, it, expect } from "vitest";
import { Simulation } from "../loop";
import { fp, fpDist2 } from "@exiled/fixed-point";
import type { Position, MonsterC, Faction, PlayerC, BossC, Health, ProjectileC, DefensesC, TelegraphC, SessionC } from "../components";
import { registerMonsterAI } from "./monster-ai";
import { registerDamageResolve } from "./damage-resolve";
import { registerTelegraphResolve } from "./telegraph-resolve";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";
import { MONSTERS } from "@exiled/content-runtime";
import { spawnMonster } from "../areas";
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
      attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0 as const, summoned: 0 as const,
    });

    for (let i = 0; i < 5; i++) sim.step();
    // Never crosses the wall to reach the player's side.
    expect(world.get<Position>(m, "position")!.x).toBeLessThan(fp(3));
    expect(world.get<MonsterC>(m, "monster")!.state).toBe("chase");
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
      playerAt: { x: fp(5), y: fp(0) },   // inside range 7.5
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
      playerAt: { x: fp(5), y: fp(0) },
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
      playerAt: { x: fp(8.5), y: fp(0) },  // awake (< AGGRO_RADIUS 9), out of range (> 7.5)
    });
    sim.step();
    expect(world.query("projectile").length).toBe(0);
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
