import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { AILMENT_TICK_INTERVAL, burningTickDamage } from "@pact/rules";
import { Simulation } from "../loop";
import { registerAilmentTick } from "./ailment";
import type { AilmentC, DamageEvent } from "../components";

function makeEntityWithAilment(sim: Simulation, stacks: number, expiryTick: number) {
  const e = sim.world.create();
  sim.world.set<AilmentC>(e, "ailment", {
    kind: "burning",
    stacks,
    dps: fp(8),
    expiryTick,
  });
  return e;
}

describe("registerAilmentTick", () => {
  it("enqueues fire damage equal to burningTickDamage on interval ticks", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    const stacks = 2;
    const dps = fp(8);
    const expiryTick = 120;
    const e = makeEntityWithAilment(sim, stacks, expiryTick);
    // sim.tick is 0; AILMENT_TICK_INTERVAL = 6; 0 % 6 === 0 -> should enqueue
    sim.step(); // tick 0 runs, then tick increments to 1
    expect(sim.damageQueue).toHaveLength(1);
    const evt: DamageEvent = sim.damageQueue[0]!;
    expect(evt.target).toBe(e);
    expect(evt.type).toBe(0); // fire
    const expected = burningTickDamage({ kind: "burning", stacks, dpsFixed: dps, expiryTick });
    expect(evt.amountFixed).toBe(expected);
  });

  it("does not enqueue on non-interval ticks", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    makeEntityWithAilment(sim, 1, 120);
    sim.step(); // tick 0 -> enqueues (0 % 6 === 0)
    sim.step(); // tick 1 -> no enqueue (1 % 6 !== 0)
    // damage queue cleared at start of each step; after step() at tick=1, queue should be empty
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("removes ailment when tick >= expiryTick", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    const e = makeEntityWithAilment(sim, 1, 3); // expires at tick 3
    // advance to tick 3
    sim.step(); // tick 0
    sim.step(); // tick 1
    sim.step(); // tick 2
    // ailment still present
    expect(sim.world.get(e, "ailment")).toBeDefined();
    sim.step(); // tick 3 -> tick >= expiryTick (3 >= 3) -> remove
    expect(sim.world.get(e, "ailment")).toBeUndefined();
  });

  it("enqueues again every AILMENT_TICK_INTERVAL ticks", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    makeEntityWithAilment(sim, 1, 300);
    // step through two full intervals; damage should be enqueued at tick 0 and tick 6
    let enqueuedCount = 0;
    for (let i = 0; i < AILMENT_TICK_INTERVAL * 2; i++) {
      sim.step();
      // damageQueue is cleared at start of each step, then systems run
      if (sim.damageQueue.length > 0) enqueuedCount++;
    }
    expect(enqueuedCount).toBe(2); // ticks 0 and 6
  });
});
