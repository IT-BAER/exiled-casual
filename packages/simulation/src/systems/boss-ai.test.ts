import { describe, it, expect } from "vitest";
import { fp, fpDist2, fpMul } from "@exiled/fixed-point";
import { MONSTERS, CONTENT_VERSION } from "@exiled/content-runtime";
import { resBlock, type MonsterDef, type BossAbility } from "@exiled/content-schema";
import { monsterTierScale, waystoneScaleFor } from "@exiled/rules";
import { Simulation } from "../loop";
import { World } from "../ecs";
import type { Position, MonsterC, Faction, PlayerC, BossC, TelegraphC, Health, SessionC, DefensesC } from "../components";
import { registerBossAI, BOSS_AGGRO_RADIUS, BOSS_LEASH_RADIUS } from "./boss-ai";
import { registerTelegraphResolve } from "./telegraph-resolve";
import { createCombatSim } from "../combat-sim";
import { gridCollision, hasLineOfSight } from "../collision";
import { generateArea } from "@exiled/mapgen";
import { grammarForNode } from "./area-transition";
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
      archetype: "brute",
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

/** The fixture boss with a third phase at 25% (cadence 85%) and `abilities` as its kit. */
function kitMonsters(abilities: BossAbility[]): ReadonlyMap<string, MonsterDef> {
  const def = testMonsters.get("boss.test")!;
  return new Map<string, MonsterDef>([
    ["boss.test", { ...def, boss: { ...def.boss!, phase3AtLifePct: 25, phase3CadenceMulPct: 85, abilities } }],
    ["monster.cinder_imp.v1", impDef],
  ]);
}

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
    slamReadyTick: 0,
    rootedUntilTick: 0,
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

/** Pull the boss, so a test exercises a gate other than the aggro one. */
function wake(world: World, boss: number) {
  world.set<MonsterC>(boss, "monster", { ...world.get<MonsterC>(boss, "monster")!, state: "chase" });
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
    wake(world, boss); // fp(10) sits exactly on BOSS_AGGRO_RADIUS — don't lean on the boundary

    const before = fpDist2(fp(10), fp(0), fp(0), fp(0));
    sim.step();
    const pos = world.get<Position>(boss, "position")!;
    expect(fpDist2(pos.x, pos.y, fp(0), fp(0))).toBeLessThan(before);
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("chase");
  });

  it("an idle boss beyond BOSS_AGGRO_RADIUS holds its ground", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(12), fp(0)); // outside BOSS_AGGRO_RADIUS fp(10)
    const boss = makeBossEntity(world, fp(0), fp(0));

    sim.step();

    expect(world.get<Position>(boss, "position")).toEqual({ x: fp(0), y: fp(0) });
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("idle");
  });

  it("a woken boss keeps chasing past BOSS_AGGRO_RADIUS", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    makePlayerEntity(world, fp(12), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    wake(world, boss); // waking is one-way, so distance no longer gates it

    sim.step();

    expect(world.get<Position>(boss, "position")!.x).toBeGreaterThan(fp(0));
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("chase");
  });

  it("a woken boss walks home and sleeps once the player is past BOSS_LEASH_RADIUS of its spawn", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;

    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<Position>(boss, "position", { x: fp(8), y: fp(0) }); // pulled off its spawn
    makePlayerEntity(world, BOSS_LEASH_RADIUS + fp(4), fp(0));
    wake(world, boss);

    sim.step();
    expect(world.get<Position>(boss, "position")!.x).toBeLessThan(fp(8)); // away from the player

    for (let i = 0; i < 300; i++) sim.step();
    expect(world.get<Position>(boss, "position")).toEqual({ x: fp(0), y: fp(0) });
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("idle");
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
    const boss = makeBossEntity(world, fp(0), fp(0)); // nextAbilityTick=0
    wake(world, boss); // isolate the slam gate from the aggro gate

    sim.step();

    // No telegraph spawned
    expect(world.entitiesWith("telegraph")).toHaveLength(0);
    // Boss chases instead (player fp(12) away, attack range fp(1.5))
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("chase");
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
      slamReadyTick: 0,
      rootedUntilTick: 0,
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

describe("the boss's swing and its third phase", () => {
  it("stamps lastAttackTick on a melee hit, so the client plays the attack clip", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;
    makePlayerEntity(world, fp(1), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<BossC>(boss, "boss", { ...world.get<BossC>(boss, "boss")!, nextAbilityTick: 9999 });
    wake(world, boss);

    sim.step();
    expect(sim.damageQueue).toHaveLength(1);
    expect(world.get<MonsterC>(boss, "monster")!.lastAttackTick).toBe(0);
  });

  it("stamps lastAttackTick when a slam's wind-up starts", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;
    makePlayerEntity(world, fp(5), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    sim.step();
    expect(world.query("telegraph")).toHaveLength(1);
    expect(world.get<MonsterC>(boss, "monster")!.lastAttackTick).toBe(0);
  });

  it("marks the slam heavy, so the client glows its owner", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;
    makePlayerEntity(world, fp(5), fp(0));
    makeBossEntity(world, fp(0), fp(0));
    sim.step();
    const tg = world.get<TelegraphC>(world.query("telegraph")[0]!, "telegraph")!;
    expect(tg.heavy).toBe(1);
    expect(tg.ability).toBeUndefined();
  });

  it("enters phase 3 once below phase3AtLifePct: rooted a second, next cast as the root ends", () => {
    const sim = new Simulation();
    registerBossAI(sim, kitMonsters([]));
    const { world } = sim;
    makePlayerEntity(world, fp(5), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<BossC>(boss, "boss", { ...world.get<BossC>(boss, "boss")!, phase: 2, nextAbilityTick: 500 });
    world.set<Health>(boss, "health", { life: fp(250), maxLife: fp(1000) });

    sim.step();
    expect(world.get<BossC>(boss, "boss")).toMatchObject({ phase: 3, rootedUntilTick: 30, nextAbilityTick: 30 });
    expect(world.query("telegraph")).toHaveLength(0);
    sim.step();
    expect(world.get<BossC>(boss, "boss")).toMatchObject({ phase: 3, rootedUntilTick: 30 });
  });

  it("a boss with no phase3AtLifePct stays in phase 2 at any life", () => {
    const sim = new Simulation();
    registerBossAI(sim, testMonsters);
    const { world } = sim;
    makePlayerEntity(world, fp(5), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<BossC>(boss, "boss", { ...world.get<BossC>(boss, "boss")!, phase: 2 });
    world.set<Health>(boss, "health", { life: fp(10), maxLife: fp(1000) });
    sim.step();
    expect(world.get<BossC>(boss, "boss")!.phase).toBe(2);
  });

  it("phase 3 casts at phase 2's cadence times phase3CadenceMulPct", () => {
    const sim = new Simulation();
    registerBossAI(sim, kitMonsters([]));
    const { world } = sim;
    makePlayerEntity(world, fp(5), fp(0));
    const boss = makeBossEntity(world, fp(0), fp(0));
    world.set<BossC>(boss, "boss", { ...world.get<BossC>(boss, "boss")!, phase: 3 });
    sim.step();
    // 150 x 80% x 85% = 102
    expect(world.get<BossC>(boss, "boss")!.nextAbilityTick).toBe(102);
  });
});

const FIRE = { type: "fire", amountFixed: fp(9) } as const;
const RIFT: BossAbility = {
  id: "rift", kind: "line", fromPhase: 1, cooldownTicks: 200, windupTicks: 30, rangeFixed: fp(9), damage: FIRE,
  lengthFixed: fp(9), halfWidthFixed: fp(0.9),
};
const RING: BossAbility = {
  id: "ring", kind: "ring", fromPhase: 1, cooldownTicks: 210, windupTicks: 36, rangeFixed: fp(7), damage: FIRE,
  innerFixed: fp(2.4), radiusFixed: fp(7),
};
const NOVA: BossAbility = {
  id: "nova", kind: "nova", fromPhase: 1, cooldownTicks: 120, windupTicks: 15, rangeFixed: fp(3.5), damage: FIRE,
  radiusFixed: fp(3),
};
const CHARGE: BossAbility = {
  id: "charge", kind: "line", fromPhase: 1, cooldownTicks: 150, windupTicks: 18, rangeFixed: fp(7), damage: FIRE,
  lengthFixed: fp(9), halfWidthFixed: fp(0.8), overshootFixed: fp(2), minLengthFixed: fp(4), dashSpeedFixed: fp(14),
};

/** A kitted boss at the origin, the player at (px, py), one step taken: the world and its telegraphs. */
function castAt(kit: BossAbility[], px: number, py: number, boss: Partial<BossC> = {}) {
  const sim = new Simulation();
  registerBossAI(sim, kitMonsters(kit));
  const { world } = sim;
  const player = makePlayerEntity(world, px, py);
  const e = makeBossEntity(world, 0, 0);
  world.set<BossC>(e, "boss", { ...world.get<BossC>(e, "boss")!, ...boss });
  sim.step();
  const teles = () => world.query("telegraph").map((t) => ({
    tg: world.get<TelegraphC>(t, "telegraph")!, at: world.get<Position>(t, "position")!,
  }));
  return { sim, world, boss: e, player, teles };
}

describe("a boss's heavy abilities", () => {
  it("a line casts a lane from the boss through the player: rooted, heavy, on its own cooldown", () => {
    const { world, boss, teles } = castAt([RIFT], fp(4), fp(3));
    expect(teles()).toHaveLength(1);
    expect(teles()[0]!.at).toEqual({ x: 0, y: 0 });
    expect(teles()[0]!.tg).toMatchObject({
      shape: "line", dirX: 800, dirY: 600, length: fp(9), radius: fp(0.9),
      impactTick: 30, damage: fp(9), damageType: 0, ability: "rift", heavy: 1,
    });
    expect(world.get<BossC>(boss, "boss")).toMatchObject({ rootedUntilTick: 30, nextAbilityTick: 150, abilityReadyTicks: [200] });
    expect(world.get<MonsterC>(boss, "monster")!.lastAttackTick).toBe(0);
  });

  it("while the ability cools down, the gap goes to the slam", () => {
    const { teles } = castAt([RIFT], fp(4), fp(3), { abilityReadyTicks: [500] });
    expect(teles()).toHaveLength(1);
    expect(teles()[0]!.tg.ability).toBeUndefined();
    expect(teles()[0]!.at).toEqual({ x: fp(4), y: fp(3) });
  });

  it("an ability waits for its phase", () => {
    expect(castAt([{ ...RIFT, fromPhase: 2 }], fp(4), fp(3)).teles()[0]!.tg.ability).toBeUndefined();
    expect(castAt([{ ...RIFT, fromPhase: 2 }], fp(4), fp(3), { phase: 2 }).teles()[0]!.tg.ability).toBe("rift");
  });

  it("out of an ability's range, the slam goes instead", () => {
    expect(castAt([{ ...RIFT, rangeFixed: fp(3) }], fp(4), fp(3)).teles()[0]!.tg.ability).toBeUndefined();
  });

  it("a ring is cast on a player in its band, never on one in its hole", () => {
    const band = castAt([RING], fp(4), 0).teles();
    expect(band[0]!.at).toEqual({ x: 0, y: 0 });
    expect(band[0]!.tg).toMatchObject({ shape: "ring", inner: fp(2.4), radius: fp(7), impactTick: 36, ability: "ring", heavy: 1 });
    expect(castAt([RING], fp(2), 0).teles()[0]!.tg.ability).toBeUndefined();
  });

  it("a nova is a disc on the boss itself", () => {
    const { world, boss, teles } = castAt([NOVA], fp(3), 0);
    expect(teles()[0]!.at).toEqual({ x: 0, y: 0 });
    expect(teles()[0]!.tg).toMatchObject({ radius: fp(3), impactTick: 15, ability: "nova", heavy: 1 });
    expect(teles()[0]!.tg.shape).toBeUndefined();
    expect(world.get<BossC>(boss, "boss")!.rootedUntilTick).toBe(15);
  });

  it("a charge's lane runs past the player by its overshoot, clamped, and the boss runs it after the hit", () => {
    expect(castAt([CHARGE], fp(1), 0).teles()[0]!.tg.length).toBe(fp(4));
    const { sim, world, boss, teles } = castAt([CHARGE], fp(3), 0);
    expect(teles()[0]!.tg.length).toBe(fp(5));
    for (let i = 0; i < 17; i++) sim.step();
    expect(world.get<Position>(boss, "position")).toEqual({ x: 0, y: 0 });
    for (let i = 0; i < 11; i++) sim.step();
    expect(world.get<Position>(boss, "position")).toEqual({ x: fp(5), y: 0 });
  });

  it("an ability hits harder on a higher tier, like the slam", () => {
    const sim = new Simulation();
    registerBossAI(sim, kitMonsters([RIFT]));
    const { world } = sim;
    const s = world.create();
    world.set<SessionC>(s, "session", {
      area: "map", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, areaTier: 10,
      activeNodeId: "", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });
    makePlayerEntity(world, fp(4), fp(3));
    makeBossEntity(world, 0, 0);
    sim.step();
    expect(world.get<TelegraphC>(world.query("telegraph")[0]!, "telegraph")!.damage).toBe(fp(40.5));
  });
});

const RAIN: BossAbility = {
  id: "rain", kind: "volley", fromPhase: 1, cooldownTicks: 240, windupTicks: 36, rangeFixed: fp(9), damage: FIRE,
  count: 5, everyTicks: 5, radiusFixed: fp(1.3),
};
const GEYSERS: BossAbility = {
  id: "geysers", kind: "volley", fromPhase: 1, cooldownTicks: 240, windupTicks: 30, rangeFixed: fp(9), damage: FIRE,
  count: 3, everyTicks: 12, radiusFixed: fp(1.6), follow: true,
};
const LANCES: BossAbility = {
  id: "lances", kind: "volley", fromPhase: 1, cooldownTicks: 240, windupTicks: 27, rangeFixed: fp(12), damage: FIRE,
  count: 3, everyTicks: 9, lengthFixed: fp(12), halfWidthFixed: fp(0.6),
};
const BROOD: BossAbility = {
  id: "brood", kind: "brood", fromPhase: 1, cooldownTicks: 300, windupTicks: 24, addDefId: "monster.cinder_imp.v1",
  count: 2, maxAlive: 3, phase3CooldownTicks: 210,
};

describe("a boss's volleys and brood", () => {
  it("a volley of discs shows every mark at once round the player, landing everyTicks apart, unrooted", () => {
    const { world, boss, teles } = castAt([RAIN], fp(5), 0);
    const marks = teles();
    expect(marks.map((m) => m.tg.impactTick)).toEqual([36, 41, 46, 51, 56]);
    expect(marks[0]!.at).toEqual({ x: fp(5), y: 0 });
    for (const m of marks) {
      expect(m.tg).toMatchObject({ radius: fp(1.3), ability: "rain", startTick: 0 });
      expect(m.tg.heavy).toBeUndefined();
      expect(fpDist2(m.at.x, m.at.y, fp(5), 0)).toBeLessThanOrEqual(fp(3) * fp(3));
    }
    expect(world.get<BossC>(boss, "boss")!.rootedUntilTick).toBe(0);
  });

  it("a follow volley drops one mark at a time where the player stands, then stops", () => {
    const { sim, world, boss, player, teles } = castAt([GEYSERS], fp(5), 0);
    expect(teles().map((m) => m.at)).toEqual([{ x: fp(5), y: 0 }]);
    world.set<Position>(player, "position", { x: fp(6), y: fp(2) });
    for (let i = 0; i < 12; i++) sim.step();
    expect(teles().map((m) => m.at)).toEqual([{ x: fp(5), y: 0 }, { x: fp(6), y: fp(2) }]);
    expect(teles()[1]!.tg).toMatchObject({ startTick: 12, impactTick: 42 });
    for (let i = 0; i < 30; i++) sim.step();
    expect(teles()).toHaveLength(3);
    expect(world.get<BossC>(boss, "boss")!.volleyLeft).toBeUndefined();
  });

  it("a volley of lanes re-aims each lane from the boss at the player", () => {
    const { sim, world, boss, player, teles } = castAt([LANCES], fp(5), 0);
    world.set<MonsterC>(boss, "monster", { ...world.get<MonsterC>(boss, "monster")!, moveSpeed: 0 });
    expect(teles()[0]!.tg).toMatchObject({ shape: "line", dirX: 1000, dirY: 0, length: fp(12), radius: fp(0.6), impactTick: 27 });
    world.set<Position>(player, "position", { x: 0, y: fp(5) });
    for (let i = 0; i < 9; i++) sim.step();
    expect(teles()[1]!.at).toEqual({ x: 0, y: 0 });
    expect(teles()[1]!.tg).toMatchObject({ dirX: 0, dirY: 1000, startTick: 9, impactTick: 36 });
  });

  it("a brood raises count adds from harmless marks every cooldownTicks, never past maxAlive", () => {
    const sim = new Simulation();
    const mons = kitMonsters([BROOD]);
    registerBossAI(sim, mons);
    registerTelegraphResolve(sim, mons);
    const { world } = sim;
    makePlayerEntity(world, fp(5), 0);
    const boss = makeBossEntity(world, 0, 0);
    world.set<BossC>(boss, "boss", { ...world.get<BossC>(boss, "boss")!, nextAbilityTick: 99999, broodAtTick: 0 });

    sim.step();
    const marks = world.query("telegraph").map((t) => world.get<TelegraphC>(t, "telegraph")!);
    expect(marks).toHaveLength(2);
    for (const m of marks) {
      expect(m).toMatchObject({ damage: 0, ability: "brood", spawnDefId: "monster.cinder_imp.v1", impactTick: 24 });
    }
    expect(world.get<BossC>(boss, "boss")!.broodAtTick).toBe(300);

    for (let i = 0; i < 24; i++) sim.step();
    expect(summonedAdds(world)).toHaveLength(2);

    world.set<BossC>(boss, "boss", { ...world.get<BossC>(boss, "boss")!, broodAtTick: sim.tick });
    sim.step();
    expect(world.query("telegraph")).toHaveLength(1);
  });

  it("a brood starts its timer when unlocked, and waits for its phase", () => {
    const quiet = { nextAbilityTick: 99999 };
    const fresh = castAt([BROOD], fp(5), 0, quiet);
    expect(fresh.teles()).toHaveLength(0);
    expect(fresh.world.get<BossC>(fresh.boss, "boss")!.broodAtTick).toBe(300);
    expect(castAt([{ ...BROOD, fromPhase: 2 }], fp(5), 0, { ...quiet, broodAtTick: 0 }).teles()).toHaveLength(0);
    const late = castAt([BROOD], fp(5), 0, { ...quiet, phase: 3, broodAtTick: 0 });
    expect(late.world.get<BossC>(late.boss, "boss")!.broodAtTick).toBe(210);
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
      area: "map", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, areaTier,
      activeNodeId: "", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });

    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(5), fp(0));
    world.set<Health>(boss, "health", { life: fp(1000), maxLife: fp(1000) });

    sim.step();
    return world.get<TelegraphC>(world.query("telegraph")[0]!, "telegraph")!;
  }

  it("a Tier 10 slam hits 4.5x as hard as a Tier 0 one", () => {
    // monsterTierScale(10).dmgMilli = 1000 + 150*10 + 20*100 = 4500, i.e. 4.5x.
    expect(slamAt(0).damage).toBe(fp(28));
    expect(slamAt(10).damage).toBe(fp(126));
  });

  it("the phase-2 burning patch scales with the same knob", () => {
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;
    const s = world.create();
    world.set<SessionC>(s, "session", {
      area: "map", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, areaTier: 10,
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
    expect(tele.ground!.dps).toBe(fp(40.5)); // fp(9) at 4.5x
  });

  it("its phase-2 adds take the stone's resistances but keep their base life", () => {
    // A stone that adds monster resistances and monster life.
    const seed = Array.from({ length: 5000 }, (_, i) => i + 1).find((s) => {
      const ws = waystoneScaleFor(s);
      return ws.monsterResAdd > 0 && ws.lifeMilli > 1000;
    })!;
    const sim = new Simulation();
    registerBossAI(sim, summonMonsters);
    const { world } = sim;
    world.set<SessionC>(world.create(), "session", {
      area: "map", atlasSeed: 0, mapSeed: 0, waystoneSeed: seed, areaTier: 10,
      activeNodeId: "", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });
    makePlayerEntity(world, fp(0), fp(0));
    const boss = makeBossEntity(world, fp(5), fp(0));
    world.set<Health>(boss, "health", { life: fp(400), maxLife: fp(1000) });
    sim.step();

    const add = summonedAdds(world)[0]!;
    const imp = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(world.get<Health>(add, "health")!.maxLife).toBe(imp.maxLifeFixed);
    expect(world.get<DefensesC>(add, "defenses")!.res.fire).toBe(imp.defenses.resPct.fire + waystoneScaleFor(seed).monsterResAdd);
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

// The unit tests above run on a hand-built world. This block runs the real one:
// generated layout, real collision, the warden spawned by buildArea at the "boss"
// anchor, and the player at the "start" anchor the client actually spawns you on.
// It is the check the browser was standing in for.
describe("on a generated map", () => {
  /** The warden buildArea placed, plus the distance the player starts at. */
  function realMap() {
    const { sim, world, playerEntity, layout } = createCombatSim(7, {
      area: "map", boss: true, monsters: true,
    });
    const boss = world.query("boss")[0]!;
    return { sim, world, playerEntity, layout, boss };
  }

  it("spawns the player far enough out that the gate is load-bearing", () => {
    const { world, playerEntity, boss } = realMap();
    const p = world.get<Position>(playerEntity, "position")!;
    const b = world.get<Position>(boss, "position")!;
    // If the anchors ever drift within aggro range this whole block goes green
    // for the wrong reason, so assert the premise rather than trust the layout.
    expect(fpDist2(p.x, p.y, b.x, b.y)).toBeGreaterThan(BOSS_AGGRO_RADIUS * BOSS_AGGRO_RADIUS);
  });

  it("leaves the boss in its room while the player stands at the entrance", () => {
    const { sim, world, boss } = realMap();
    const spawn = world.get<Position>(boss, "position")!;
    for (let i = 0; i < 300; i++) sim.step(); // 10s at 30 Hz
    expect(world.get<Position>(boss, "position")).toEqual(spawn);
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("idle");
  });

  it("wakes the boss once the player crosses into the room", () => {
    const { sim, world, playerEntity, layout, boss } = realMap();
    const b = world.get<Position>(boss, "position")!;
    // Walk-in is what the client does; place the player inside the arena instead
    // so the assertion is about the gate, not about pathing round the geometry.
    // It has to be a spot the player could actually stand, and a FIXED offset is
    // not one: a full BOSS_AGGRO_RADIUS north is inside the arena wall on some
    // layouts (the boss woke through it — that bug is the test below), and six
    // units east is inside one of the hall's pillars on others. So search the
    // real grid for the farthest standable spot still inside aggro range.
    const col = gridCollision(layout!.grid);
    let spot: Position | undefined;
    for (let d = BOSS_AGGRO_RADIUS - fp(0.5); d >= fp(2) && !spot; d -= fp(0.5)) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const p = { x: b.x + dx * d, y: b.y + dy * d };
        if (col.isWalkable(p.x, p.y, fp(0.5))) { spot = p; break; }
      }
    }
    expect(spot, "no standable spot inside the arena").toBeDefined();
    expect(fpDist2(spot!.x, spot!.y, b.x, b.y))
      .toBeLessThanOrEqual(BOSS_AGGRO_RADIUS * BOSS_AGGRO_RADIUS);

    world.set<Position>(playerEntity, "position", spot!);
    sim.step();
    expect(world.get<MonsterC>(boss, "monster")!.state).not.toBe("idle");
  });

  it("does not wake the boss through the arena wall", () => {
    const { sim, world, playerEntity, layout, boss } = realMap();
    const b = world.get<Position>(boss, "position")!;
    const spot = { x: b.x, y: b.y - BOSS_AGGRO_RADIUS };
    // The premise, asserted rather than trusted: this spot is inside aggro range
    // AND is the arena wall itself. Without both, the test passes for the wrong
    // reason the moment the layout shifts.
    expect(fpDist2(spot.x, spot.y, b.x, b.y))
      .toBeLessThanOrEqual(BOSS_AGGRO_RADIUS * BOSS_AGGRO_RADIUS);
    expect(gridCollision(layout!.grid).isWalkable(spot.x, spot.y, fp(0.5))).toBe(false);

    world.set<Position>(playerEntity, "position", spot);
    for (let i = 0; i < 30; i++) sim.step();
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("idle");
  });
  // A playtest froze the Warden here for 900+ ticks: it had slid between pillars
  // to a spot no cell centre around holds a 1.4 body, so the nav had no route home.
  it("a warden pulled off the lattice among pillars still walks home and sleeps", () => {
    const layout = generateArea(18342063, CONTENT_VERSION, grammarForNode("node.cinder_vault"));
    const { sim, world, playerEntity } = createCombatSim(1, { area: "map", boss: true, monsters: false, layout });
    const boss = world.query("boss")[0]!;
    const b = world.get<BossC>(boss, "boss")!;
    const wedged = { x: fp(-1.359), y: fp(-1.657) };
    const r = world.get<MonsterC>(boss, "monster")!.bodyRadius;
    // The premise: the layout still puts the spawn where the freeze was seen, and
    // the straight line home is blocked, so only the nav can get it there.
    expect({ x: b.spawnX, y: b.spawnY }).toEqual({ x: fp(4.25), y: fp(-3.75) });
    expect(hasLineOfSight(gridCollision(layout.grid), wedged.x, wedged.y, b.spawnX, b.spawnY, r)).toBe(false);

    world.set<Position>(boss, "position", wedged);
    wake(world, boss);
    world.set<Position>(playerEntity, "position", { x: fp(-14.578), y: fp(-0.208) });
    for (let i = 0; i < 900; i++) sim.step();
    expect(world.get<MonsterC>(boss, "monster")!.state).toBe("idle");
    expect(world.get<Position>(boss, "position")).toEqual({ x: b.spawnX, y: b.spawnY });
  });
});
