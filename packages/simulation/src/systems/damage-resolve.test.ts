import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { registerDamageResolve } from "./damage-resolve";
import type { Health, DefensesC, FlasksC } from "../components";

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

describe("a boss pays flask charges as it bleeds", () => {
  /** Player with flasks, boss at `life` of fp(1000), and one queued hit for `hit`. */
  function hitBoss(life: number, hit: number, charges = 0) {
    const sim = new Simulation();
    const w = sim.world;

    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set<FlasksC>(p, "flasks", { lifeCharges: charges, lifeMax: 7, manaCharges: charges, manaMax: 7 });

    const b = w.create();
    w.set<Health>(b, "health", { life, maxLife: fp(1000) });
    w.set<DefensesC>(b, "defenses", { res: resBlock(), armour: 0 });
    w.set(b, "boss", { phase: 1, nextAbilityTick: 0, spawnX: 0, spawnY: 0, rootedUntilTick: 0 });

    // The queue is cleared at the start of a step, so the hit has to come from
    // a system that runs before damageResolve — as it does in the real sim.
    sim.register("testProducer", () => {
      sim.enqueueDamage({ target: b, source: p, amountFixed: hit, type: 1 });
    });
    registerDamageResolve(sim);
    sim.step();
    return w.get<FlasksC>(p, "flasks")!;
  }

  it("grants nothing while the hit stays inside one tenth", () => {
    expect(hitBoss(fp(1000), fp(50)).manaCharges).toBe(0);
  });

  it("grants a charge for the tenth it crosses", () => {
    expect(hitBoss(fp(910), fp(20)).manaCharges).toBe(1);
  });

  it("clamps at the flask maximum", () => {
    expect(hitBoss(fp(1000), fp(999), 6).lifeCharges).toBe(7);
  });

  it("leaves an ordinary monster paying only on death", () => {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set<FlasksC>(p, "flasks", { lifeCharges: 0, lifeMax: 7, manaCharges: 0, manaMax: 7 });
    const m = w.create();
    w.set<Health>(m, "health", { life: fp(1000), maxLife: fp(1000) });
    w.set<DefensesC>(m, "defenses", { res: resBlock(), armour: 0 });
    sim.register("testProducer", () => {
      sim.enqueueDamage({ target: m, source: p, amountFixed: fp(500), type: 1 });
    });
    registerDamageResolve(sim);
    sim.step();
    expect(w.get<FlasksC>(p, "flasks")!.manaCharges).toBe(0);
  });
});
