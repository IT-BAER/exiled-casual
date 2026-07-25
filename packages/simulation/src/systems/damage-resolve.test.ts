import { it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { registerDamageResolve } from "./damage-resolve";
import type { Health, DefensesC } from "../components";

it("applies two enqueued events, floored at 0", () => {
  const sim = new Simulation();
  const { world } = sim;
  const t1 = world.create();
  world.set<Health>(t1, "health", { life: fp(40), maxLife: fp(40) });
  world.set<DefensesC>(t1, "defenses", { res: resBlock(), armour: fp(0) });
  const t2 = world.create();
  world.set<Health>(t2, "health", { life: fp(30), maxLife: fp(30) });
  world.set<DefensesC>(t2, "defenses", { res: resBlock({ fire: 50 }), armour: fp(0) });
  // producer runs first in the step (step clears the queue at its start)
  sim.register("testProducer", () => {
    sim.enqueueDamage({ target: t2, source: 99, amountFixed: fp(20), type: 0 }); // fire, 50% res -> fp(10)
    sim.enqueueDamage({ target: t1, source: 99, amountFixed: fp(10), type: 1 }); // physical, armour 0 -> fp(10)
  });
  registerDamageResolve(sim);
  sim.step();
  expect(world.get<Health>(t1, "health")!.life).toBe(fp(40) - fp(10));
  expect(world.get<Health>(t2, "health")!.life).toBe(fp(30) - fp(10));
});

it("life floors at 0, never negative", () => {
  const sim = new Simulation();
  const { world } = sim;
  const t = world.create();
  world.set<Health>(t, "health", { life: fp(1), maxLife: fp(40) });
  world.set<DefensesC>(t, "defenses", { res: resBlock(), armour: fp(0) });
  sim.register("testProducer", () => {
    sim.enqueueDamage({ target: t, source: 99, amountFixed: fp(100), type: 1 });
  });
  registerDamageResolve(sim);
  sim.step();
  expect(world.get<Health>(t, "health")!.life).toBe(0);
});
