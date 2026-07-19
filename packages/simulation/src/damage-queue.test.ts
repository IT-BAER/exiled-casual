import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "./loop";
import type { DamageEvent } from "./components";

describe("damage queue", () => {
  it("enqueueDamage pushes to damageQueue", () => {
    const sim = new Simulation();
    const evt: DamageEvent = { target: 1, source: 2, amountFixed: fp(10), type: 0 };
    sim.enqueueDamage(evt);
    expect(sim.damageQueue).toHaveLength(1);
    expect(sim.damageQueue[0]).toEqual(evt);
  });

  it("queue is cleared at the start of each step", () => {
    const sim = new Simulation();
    sim.enqueueDamage({ target: 1, source: 2, amountFixed: fp(5), type: 1 });
    expect(sim.damageQueue).toHaveLength(1);
    sim.step();
    // no system re-enqueued, so queue is empty after step
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("a system enqueuing during its tick survives until the next step clears it", () => {
    const sim = new Simulation();
    const e = sim.world.create();
    sim.register("enqueuer", () => {
      sim.enqueueDamage({ target: e, source: e, amountFixed: fp(3), type: 0 });
    });
    sim.step(); // clears (empty), then system pushes one event
    expect(sim.damageQueue).toHaveLength(1);
    sim.step(); // clears that one, system pushes again
    expect(sim.damageQueue).toHaveLength(1);
  });

  it("DamageEvent stores exact fields", () => {
    const sim = new Simulation();
    const evt: DamageEvent = { target: 42, source: 7, amountFixed: fp(100), type: 1 };
    sim.enqueueDamage(evt);
    const stored = sim.damageQueue[0]!;
    expect(stored.target).toBe(42);
    expect(stored.source).toBe(7);
    expect(stored.amountFixed).toBe(fp(100));
    expect(stored.type).toBe(1);
  });
});
