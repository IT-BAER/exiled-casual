import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { registerTelegraphResolve } from "./telegraph-resolve";
import { registerDamageResolve } from "./damage-resolve";
import type { Position, Health, MonsterC, PlayerC, Faction, TelegraphC, DefensesC, GroundAreaC } from "../components";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTelegraph(
  sim: Simulation,
  opts: {
    x?: number; y?: number;
    impactTick?: number;
    radius?: number;
    damage?: number;
    damageType?: 0 | 1;
    team?: number;
    ownerId?: number;
    leavesGroundTicks?: number;
    ground?: TelegraphC["ground"];
  } = {},
) {
  const {
    x = 0, y = 0,
    impactTick = 1,
    radius = fp(2),
    damage = fp(10),
    damageType = 1,
    team = 1,
    ownerId = 99,
    leavesGroundTicks = 0,
    ground,
  } = opts;
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<TelegraphC>(e, "telegraph", {
    ownerId,
    team,
    radius,
    startTick: 0,
    impactTick,
    damage,
    damageType,
    leavesGroundTicks,
    ground,
  });
  return e;
}

const BURN: NonNullable<TelegraphC["ground"]> = {
  ailmentKind: "burning",
  stacksPerApply: 1,
  dps: fp(12),
  ailmentDuration: 60,
  maxStacks: 5,
};

function makeMonster(sim: Simulation, x = fp(1), y = 0, team = 0, bodyRadius = fp(0.5)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<Health>(e, "health", { life: fp(40), maxLife: fp(40) });
  sim.world.set<MonsterC>(e, "monster", {
    defId: "monster.cinder_imp.v1",
    moveSpeed: 0, bodyRadius,
    attackRange: fp(1.2), attackCooldownTicks: 45,
    attackDamage: fp(6), attackType: 1,
    attackReadyTick: 0, state: "idle", rare: 0, summoned: 0,
  });
  sim.world.set<Faction>(e, "faction", { team });
  return e;
}

function makePlayer(sim: Simulation, x = fp(1), y = 0, team = 0, bodyRadius = fp(0.5)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<Health>(e, "health", { life: fp(100), maxLife: fp(100) });
  sim.world.set<PlayerC>(e, "player", { moveSpeed: 0, bodyRadius });
  sim.world.set<Faction>(e, "faction", { team });
  return e;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("registerTelegraphResolve", () => {
  it("enqueues damage for an enemy inside the radius at impactTick", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    // telegraph owned by team 1; impactTick = 1, so fires when sim.tick === 1
    makeTelegraph(sim, { impactTick: 1, radius: fp(3), damage: fp(20), team: 1 });
    // monster is team 0 (enemy), 1 unit away — well inside radius 3
    const target = makeMonster(sim, fp(1), 0, 0);

    sim.step(); // tick 0 → tick < impactTick (0 < 1), nothing should fire
    expect(sim.damageQueue).toHaveLength(0);

    sim.step(); // tick 1 → impactTick met
    expect(sim.damageQueue).toHaveLength(1);
    expect(sim.damageQueue[0]!.target).toBe(target);
    expect(sim.damageQueue[0]!.amountFixed).toBe(fp(20));
  });

  it("does NOT enqueue for a target outside radius + bodyRadius", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    // radius fp(2), target bodyRadius fp(0.5) → threshold fp(2.5) = 2500
    // target at fp(3) = 3000 away → dist2 = 9_000_000 > threshold^2 6_250_000 → MISS
    makeTelegraph(sim, { impactTick: 0, radius: fp(2), team: 1 });
    makeMonster(sim, fp(3), 0, 0, fp(0.5));

    sim.step();
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("does NOT enqueue for a same-team target (no friendly fire)", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    // telegraph team 1; target also team 1
    makeTelegraph(sim, { impactTick: 0, radius: fp(3), team: 1 });
    makeMonster(sim, fp(1), 0, 1); // same team

    sim.step();
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("does NOT enqueue before impactTick and telegraph still exists", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    const tele = makeTelegraph(sim, { impactTick: 5, radius: fp(3), team: 1 });
    makeMonster(sim, fp(1), 0, 0);

    // step 4 times (ticks 0..3), all before impactTick 5
    for (let i = 0; i < 4; i++) {
      sim.step();
      expect(sim.damageQueue).toHaveLength(0);
    }
    // telegraph entity still alive
    expect(sim.world.alive.has(tele)).toBe(true);
  });

  it("destroys the telegraph after resolving so a second step enqueues nothing", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    const tele = makeTelegraph(sim, { impactTick: 0, radius: fp(3), team: 1 });
    makeMonster(sim, fp(1), 0, 0);

    sim.step(); // tick 0 — resolves
    expect(sim.damageQueue).toHaveLength(1);
    expect(sim.world.alive.has(tele)).toBe(false);

    sim.step(); // tick 1 — telegraph gone, nothing enqueued
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("hits a target whose CENTRE is outside radius but whose body overlaps", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    // telegraph radius fp(2) = 2000; target bodyRadius fp(1) = 1000
    // threshold = 3000; target at fp(2.5) = 2500
    // dist2 = 2500^2 = 6_250_000 ≤ threshold^2 = 9_000_000 → HIT
    makeTelegraph(sim, { impactTick: 0, radius: fp(2), team: 1 });
    const target = makeMonster(sim, fp(2.5), 0, 0, fp(1));

    sim.step();
    expect(sim.damageQueue).toHaveLength(1);
    expect(sim.damageQueue[0]!.target).toBe(target);
  });

  it("leaves a burning ground patch at the impact point when leavesGroundTicks > 0", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    makeTelegraph(sim, {
      x: fp(2), y: fp(3),
      impactTick: 0,
      radius: fp(3.5),
      team: 1,
      leavesGroundTicks: 120,
      ground: BURN,
    });

    sim.step(); // tick 0 — resolves and drops the patch

    const areas = sim.world.entitiesWith("groundArea");
    expect(areas).toHaveLength(1);
    const ga = sim.world.get<GroundAreaC>(areas[0]!, "groundArea")!;
    const pos = sim.world.get<Position>(areas[0]!, "position")!;
    expect(pos).toEqual({ x: fp(2), y: fp(3) }); // at impact point
    expect(ga.radius).toBe(fp(3.5));             // same footprint as the slam
    expect(ga.expiryTick).toBe(120);             // tick 0 + leavesGroundTicks
    expect(ga.nextTick).toBe(0);                 // first DoT tick is immediate
    expect(ga.team).toBe(1);                     // owner team → only hits others
    expect(ga.ailmentKind).toBe("burning");
    expect(ga.dps).toBe(fp(12));
    expect(ga.ailmentDuration).toBe(60);
    expect(ga.maxStacks).toBe(5);
    expect(ga.stacksPerApply).toBe(1);
  });

  it("leaves NO ground patch when leavesGroundTicks is 0", () => {
    const sim = new Simulation();
    registerTelegraphResolve(sim);

    makeTelegraph(sim, { impactTick: 0, radius: fp(3), team: 1 }); // leavesGroundTicks defaults to 0
    makeMonster(sim, fp(1), 0, 0);

    sim.step();

    expect(sim.world.entitiesWith("groundArea")).toHaveLength(0);
  });

  it("end-to-end: health drops through damage pipeline, less with fire resistance", () => {
    // telegraph damageType 0 (fire); target with 50% fireRes takes half
    const sim = new Simulation();
    registerTelegraphResolve(sim);
    registerDamageResolve(sim);

    makeTelegraph(sim, { impactTick: 0, radius: fp(3), damage: fp(20), damageType: 0, team: 1 });

    // target A: no defenses
    const tA = makePlayer(sim, fp(1), 0, 0);
    sim.world.set<DefensesC>(tA, "defenses", { res: resBlock(), armour: fp(0) });

    // target B: 50% fire resistance
    const tB = makePlayer(sim, fp(0), fp(1), 0);
    sim.world.set<DefensesC>(tB, "defenses", { res: resBlock({ fire: 50 }), armour: fp(0) });

    sim.step();

    const lifeA = sim.world.get<Health>(tA, "health")!.life;
    const lifeB = sim.world.get<Health>(tB, "health")!.life;

    // A: 100 - 20 = 80
    expect(lifeA).toBe(fp(100) - fp(20));
    // B: 100 - 10 = 90 (half fire damage)
    expect(lifeB).toBe(fp(100) - fp(10));
    // B took less than A
    expect(lifeB).toBeGreaterThan(lifeA);
  });
});
