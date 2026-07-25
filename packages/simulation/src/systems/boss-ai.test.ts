import { describe, it, expect } from "vitest";
import { fp, fpDist2 } from "@exiled/fixed-point";
import { MONSTERS } from "@exiled/content-runtime";
import { resBlock, type MonsterDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { World } from "../ecs";
import type { Position, MonsterC, Faction, PlayerC, BossC, TelegraphC, Health, SessionC } from "../components";
import { registerBossAI } from "./boss-ai";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";

// Minimal boss fixture — does NOT import real content (except the integration test below).
const SLAM_RANGE = fp(9);
const SLAM_WINDUP = 30;
const SLAM_COOLDOWN = 150;
const ATTACK_RANGE = fp(1.5);

const testMonsters: ReadonlyMap<string, MonsterDef> = new Map([
  [
    "boss.test",
    {
      id: "boss.test",
      name: "Test Boss",
      maxLifeFixed: fp(1000),
      moveSpeedFixed: fp(3) * 30,
      attackRangeFixed: ATTACK_RANGE,
      attackDamage: { amountFixed: fp(10), type: "physical" as const },
      attackCooldownTicks: 60,
      radiusFixed: fp(1),
      defenses: { resPct: resBlock(), armourFixed: 0 },
      boss: {
        phase2AtLifePct: 50,
        slam: {
          windupTicks: SLAM_WINDUP,
          radiusFixed: fp(3.5),
          damageFixed: fp(28),
          cooldownTicks: SLAM_COOLDOWN,
          rangeFixed: SLAM_RANGE,
        },
        phase2: {
          fireGroundDurationTicks: 120,
          addCount: 2,
          addDefId: "monster.cinder_imp.v1",
          cadenceMulPct: 80,
          fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(9), durationTicks: 45, maxStacks: 4 },
        },
      },
    },
  ],
]);

// The fixture's addDefId points at the real imp; add it so summons can resolve it.
const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
const summonMonsters: ReadonlyMap<string, MonsterDef> = new Map<string, MonsterDef>([
  ...testMonsters,
  ["monster.cinder_imp.v1", impDef],
]);

const summonedAdds = (world: World) =>
  world.query("monster").filter((m) => world.get<MonsterC>(m, "monster")!.summoned === 1);

function makeBossEntity(world: World, x: number, y: number) {
  const e = world.create();
  world.set<Position>(e, "position", { x, y });
  world.set<Faction>(e, "faction", { team: 1 });
  world.set<MonsterC>(e, "monster", {
    defId: "boss.test",
    moveSpeed: fp(2),
    bodyRadius: fp(1),
    attackRange: ATTACK_RANGE,
    attackCooldownTicks: 60,
    attackDamage: fp(10),
    attackType: 1 as const,
    attackReadyTick: 0,
    state: "idle",
    rare: 0 as const,
    summoned: 0 as const,
  });
  world.set<BossC>(e, "boss", {
    phase: 1,
    nextAbilityTick: 0,
    spawnX: x,
    spawnY: y,
    rootedUntilTick: 0,
  });
  return e;
}

function makePlayerEntity(world: World, x: number, y: number) {
  const p = world.create();
  world.set<Position>(p, "position", { x, y });
  world.set<Faction>(p, "faction", { team: 0 });
  world.set<PlayerC>(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
  return p;
}

describe("registerBossAI", () => {
  it("boss chases a distant player — position moves closer, state = chase", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(10), fp(0));

    const before = fpDist2(fp(10), fp(0), fp(0), fp(0));
    sim.step();
    const pos = world.get<Position>(boss, "position")!;
    expect(fpDist2(pos.x, pos.y, fp(0), fp(0))).toBeLessThan(before);
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("chase");
  });

  it("boss within attackRange melees — damage enqueued, state = attack", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    const player = makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(1), fp(0)); // fp(1) < ATTACK_RANGE fp(1.5)

    // nextAbilityTick=0 and player at fp(1) is within SLAM_RANGE but we need
    // it NOT to slam (fp(1) is within SLAM_RANGE). Actually it will slam on tick 0.
    // Put the boss next to player so slam fires first — but we want melee test.
    // Override nextAbilityTick to a future tick so slam won't fire.
    world.set<BossC>(boss, "boss", {
      phase: 1,
      nextAbilityTick: 9999,
      spawnX: fp(1),
      spawnY: fp(0),
      rootedUntilTick: 0,
    });

    sim.step();
    // Should melee (not slam), damage enqueued
    expect(sim.damageQueue).toHaveLength(1);
    expect(sim.damageQueue[0]!.target).toBe(player);
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("attack");

    // tick 1: attackReadyTick = 60, so no re-enqueue
    sim.step();
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("slam fires when player in range at nextAbilityTick — one telegraph at player pos", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    const playerX = fp(5);
    const playerY = fp(0);
    const player = makePlayerEntity(world, playerX, playerY);
    void player;
    const boss = makeBossEntity(world, fp(0), fp(0)); // nextAbilityTick=0

    // tick 0: player at fp(5) is within SLAM_RANGE fp(9)
    sim.step();

    const telegraphs = world.entitiesWith("telegraph");
    expect(telegraphs).toHaveLength(1);
    const tele = world.get<TelegraphC>(telegraphs[0]!, "telegraph")!;
    // impactTick = tick(0) + windupTicks(30) = 30
    expect(tele.impactTick).toBe(30);
    // position locked at player's position at cast time
    const telePos = world.get<Position>(telegraphs[0]!, "position")!;
    expect(telePos.x).toBe(playerX);
    expect(telePos.y).toBe(playerY);
    // boss is rooted now
    const bc = world.get<BossC>(boss, "boss")!;
    expect(bc.rootedUntilTick).toBe(30);
    expect(bc.nextAbilityTick).toBe(SLAM_COOLDOWN);
  });

  it("rooted boss does not move while rootedUntilTick > tick", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(5), fp(0));
    // Root the boss through tick 10
    world.set<BossC>(boss, "boss", {
      phase: 1,
      nextAbilityTick: 9999,
      spawnX: fp(5),
      spawnY: fp(0),
      rootedUntilTick: 10,
    });

    sim.step(); // tick 0 < 10 → rooted
    const pos = world.get<Position>(boss, "position")!;
    expect(pos.x).toBe(fp(5));
    expect(pos.y).toBe(fp(0));
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("attack");
  });

  it("no telegraph when player is beyond slam.rangeFixed", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    // Player at fp(12), well beyond slam range fp(9)
    makePlayerEntity(world, fp(12), fp(0));
    makeBossEntity(world, fp(0), fp(0)); // nextAbilityTick=0

    sim.step();

    // No telegraph spawned
    expect(world.entitiesWith("telegraph")).toHaveLength(0);
    // Boss should be chasing instead
    // (player is fp(12) away, attack range fp(1.5), so state = chase)
  });

  it("chasing boss is blocked by a wall in collision", () => {
    // Wall column at cx=3 (world x=3); boss on the left, player on the right.
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
    registerBossAI(sim, testMonsters, { active: collision });
    const { world } = sim;

    makePlayerEntity(world, fp(5), fp(2));
    const boss = makeBossEntity(world, fp(1), fp(2));
    // Prevent slam so the boss takes the chase branch.
    world.set<BossC>(boss, "boss", {
      phase: 1,
      nextAbilityTick: 9999,
      spawnX: fp(1),
      spawnY: fp(2),
      rootedUntilTick: 0,
    });

    for (let i = 0; i < 5; i++) sim.step();

    // The boss can never cross the wall to reach the player's side.
    const pos = world.get<Position>(boss, "position")!;
    expect(pos.x).toBeLessThan(fp(3));
  });

  it("real cinder_warden content drives the system end to end", () => {
    const def = MONSTERS.get("monster.cinder_warden.v1");
    expect(def).toBeDefined();
    expect(def?.boss).toBeDefined();

    const sim = new Simulation();
    registerBossAI(sim, MONSTERS);
    const { world } = sim;

    // Player at origin
    makePlayerEntity(world, fp(0), fp(0));

    // Boss entity using real def values
    const boss = world.create();
    world.set<Position>(boss, "position", { x: fp(5), y: fp(0) });
    world.set<Faction>(boss, "faction", { team: 1 });
    world.set<MonsterC>(boss, "monster", {
      defId: "monster.cinder_warden.v1",
      moveSpeed: Math.trunc(def!.moveSpeedFixed / 30),
      bodyRadius: def!.radiusFixed,
      attackRange: def!.attackRangeFixed,
      attackCooldownTicks: def!.attackCooldownTicks,
      attackDamage: def!.attackDamage.amountFixed,
      attackType: 1 as const,
      attackReadyTick: 0,
      state: "idle",
      rare: 0 as const,
      summoned: 0 as const,
    });
    world.set<BossC>(boss, "boss", {
      phase: 1,
      nextAbilityTick: 9999, // disable slam so we can test chase
      spawnX: fp(5),
      spawnY: fp(0),
      rootedUntilTick: 0,
    });

    const before = fpDist2(fp(5), fp(0), fp(0), fp(0));
    sim.step();
    const pos = world.get<Position>(boss, "position")!;
    // Boss should have moved toward origin
    expect(fpDist2(pos.x, pos.y, fp(0), fp(0))).toBeLessThan(before);
  });

  it("transitions to phase 2 at ≤50% life, summoning adds on the boss's team", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<Health>(boss, "health", { life: fp(500), maxLife: fp(1000) }); // exactly 50%

    sim.step();

    expect(world.get<BossC>(boss, "boss")!.phase).toBe(2);
    const adds = summonedAdds(world);
    expect(adds).toHaveLength(2); // fixture addCount
    for (const a of adds) {
      expect(world.get<Faction>(a, "faction")!.team).toBe(1); // boss's team
    }
  });

  it("does not transition above 50% life — stays phase 1, no adds", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<Health>(boss, "health", { life: fp(600), maxLife: fp(1000) }); // 60%

    sim.step();

    expect(world.get<BossC>(boss, "boss")!.phase).toBe(1);
    expect(summonedAdds(world)).toHaveLength(0);
  });

  it("transitions only once — a second tick summons no further adds", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<Health>(boss, "health", { life: fp(400), maxLife: fp(1000) }); // 40%

    sim.step();
    expect(summonedAdds(world)).toHaveLength(2);
    sim.step();
    expect(world.get<BossC>(boss, "boss")!.phase).toBe(2);
    expect(summonedAdds(world)).toHaveLength(2); // no new summon
  });

  it("phase-2 slam leaves burning ground for fireGroundDurationTicks", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(5), fp(0)); // within slam range fp(9)
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<BossC>(boss, "boss", {
      phase: 2, // already phase 2 → transition guard skips, slam fires
      nextAbilityTick: 0,
      spawnX: fp(0),
      spawnY: fp(0),
      rootedUntilTick: 0,
    });

    sim.step();

    const teles = world.entitiesWith("telegraph");
    expect(teles).toHaveLength(1);
    const tg = world.get<TelegraphC>(teles[0]!, "telegraph")!;
    expect(tg.leavesGroundTicks).toBe(120);
    // The telegraph carries the phase-2 fireGround profile, mapped to GroundAreaC field names.
    expect(tg.ground).toEqual({
      ailmentKind: "burning",
      stacksPerApply: 1,
      dps: fp(9),
      ailmentDuration: 45,
      maxStacks: 4,
    });
  });

  it("phase-1 slam leaves no ground (no patch, no profile)", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(5), fp(0));
    makeBossEntity(world, fp(0), fp(0)); // phase 1, nextAbilityTick 0

    sim.step();

    const tg = world.get<TelegraphC>(world.entitiesWith("telegraph")[0]!, "telegraph")!;
    expect(tg.leavesGroundTicks).toBe(0);
    expect(tg.ground).toBeUndefined();
  });

  it("phase-2 slam uses the faster phase-2 cadence", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(5), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<BossC>(boss, "boss", {
      phase: 2,
      nextAbilityTick: 0,
      spawnX: fp(0),
      spawnY: fp(0),
      rootedUntilTick: 0,
    });

    sim.step();

    // cooldown 150 × cadenceMulPct 80 / 100 = 120 (vs 150 in phase 1)
    expect(world.get<BossC>(boss, "boss")!.nextAbilityTick).toBe(120);
  });
});

describe("boss abilities scale with the map's tier", () => {
  /** A boss standing on the player, in a session at `areaTier`, on the tick it slams. */
  function slamAt(areaTier: number): TelegraphC {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    const s = world.create();
    world.set<SessionC>(s, "session", {
      area: "map", atlasSeed: 0, mapSeed: 0, areaTier,
      activeNodeId: "", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });

    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(5), fp(0));
    world.set<Health>(boss, "health", { life: fp(1000), maxLife: fp(1000) });

    sim.step();
    return world.get<TelegraphC>(world.query("telegraph")[0]!, "telegraph")!;
  }

  it("a Tier 10 slam hits twice as hard as a Tier 0 one", () => {
    // monsterTierScale(10).dmgMilli = 2000, i.e. 2x.
    expect(slamAt(0).damage).toBe(fp(28));
    expect(slamAt(10).damage).toBe(fp(56));
  });

  it("the phase-2 burning patch scales with the same knob", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;
    const s = world.create();
    world.set<SessionC>(s, "session", {
      area: "map", atlasSeed: 0, mapSeed: 0, areaTier: 10,
      activeNodeId: "", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });
    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(5), fp(0));
    // Below the 50% threshold, so the first step spends itself transitioning.
    world.set<Health>(boss, "health", { life: fp(400), maxLife: fp(1000) });
    sim.step();
    expect(world.get<BossC>(boss, "boss")!.phase).toBe(2);
    sim.step();
    const tele = world.get<TelegraphC>(world.query("telegraph")[0]!, "telegraph")!;
    expect(tele.ground!.dps).toBe(fp(18)); // fp(9) at 2x
  });

  it("a boss with no session (the legacy replay path) is unscaled", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;
    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(5), fp(0));
    world.set<Health>(boss, "health", { life: fp(1000), maxLife: fp(1000) });
    sim.step();
    expect(world.get<TelegraphC>(world.query("telegraph")[0]!, "telegraph")!.damage).toBe(fp(28));
  });
});
