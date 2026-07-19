import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { AILMENT_TICK_INTERVAL } from "@pact/rules";
import { Simulation } from "../loop";
import { registerGroundAreaTick } from "./ground-area";
import type { Position, MonsterC, Faction, GroundAreaC, AilmentC } from "../components";

function makeArea(sim: Simulation, tick = 0) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: 0, y: 0 });
  sim.world.set<GroundAreaC>(e, "groundArea", {
    radius: fp(2.5),
    expiryTick: tick + 90,
    nextTick: tick,
    ailmentKind: "burning",
    stacksPerApply: 1,
    dps: fp(8),
    ailmentDuration: 60,
    maxStacks: 5,
  });
  return e;
}

function makeMonster(sim: Simulation, x = fp(1), y = 0) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<MonsterC>(e, "monster", {
    defId: "monster.cinder_imp.v1",
    moveSpeed: 0, bodyRadius: fp(0.5),
    attackRange: fp(1.2), attackCooldownTicks: 45,
    attackDamage: fp(6), attackType: 1,
    attackReadyTick: 0, state: "idle", rare: 0,
  });
  sim.world.set<Faction>(e, "faction", { team: 1 });
  return e;
}

describe("registerGroundAreaTick", () => {
  it("monster inside area gains ailment on first tick", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    makeArea(sim, 0);   // nextTick = 0, area at (0,0), radius fp(2.5)
    const monster = makeMonster(sim, fp(1), 0);
    // monster at fp(1)=1000, dist2 = 1000^2 = 1e6; (fp(2.5)+fp(0.5))^2 = 3000^2 = 9e6; 1e6 <= 9e6 -> IN RANGE
    sim.step();
    const ailment = sim.world.get<AilmentC>(monster, "ailment")!;
    expect(ailment).toBeDefined();
    expect(ailment.stacks).toBe(1);
    expect(ailment.kind).toBe("burning");
    expect(ailment.expiryTick).toBe(60); // tick 0 + durationTicks 60
  });

  it("nextTick advances by AILMENT_TICK_INTERVAL after application", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    const area = makeArea(sim, 0);
    makeMonster(sim, fp(1), 0);
    sim.step();
    const ga = sim.world.get<GroundAreaC>(area, "groundArea")!;
    expect(ga.nextTick).toBe(AILMENT_TICK_INTERVAL);
  });

  it("repeated applications refresh and cap stacks at maxStacks", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    const area = makeArea(sim, 0);
    const monster = makeMonster(sim, fp(1), 0);
    // each step at tick%6===0 applies one stack; step through 6 intervals
    for (let i = 0; i < 6; i++) {
      // advance sim.tick to nextTick manually by stepping AILMENT_TICK_INTERVAL times
      for (let j = 0; j < AILMENT_TICK_INTERVAL; j++) {
        sim.step();
      }
    }
    const ailment = sim.world.get<AilmentC>(monster, "ailment")!;
    // maxStacks is 5; applied 6 times but capped
    expect(ailment.stacks).toBe(5);
  });

  it("monster outside area does not gain ailment", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    makeArea(sim, 0);
    // monster at fp(10), far outside radius fp(2.5)+fp(0.5)=fp(3)
    const monster = makeMonster(sim, fp(10), 0);
    sim.step();
    expect(sim.world.get(monster, "ailment")).toBeUndefined();
  });
});
