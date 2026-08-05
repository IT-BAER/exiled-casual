import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { registerDamageResolve, SPAWN_GRACE_TICKS } from "./damage-resolve";
import { ES_RECHARGE_DELAY_TICKS } from "@exiled/rules";
import type { Health, DefensesC, FlasksC, EnergyShieldC, SessionC } from "../components";

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

describe("spawn grace", () => {
  /** Player under grace, one queued hit, then whatever `mutate` does before the step. */
  function gracedSim(mutate?: (w: Simulation["world"], p: number) => void) {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
    w.set(p, "position", { x: fp(3), y: fp(4) });
    const s = w.create();
    w.set(s, "session", {
      area: "map", mapSeed: 1, waystoneSeed: 1, areaTier: 1, activeNodeId: "",
      completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
      graceUntilTick: SPAWN_GRACE_TICKS, graceX: fp(3), graceY: fp(4),
    });
    mutate?.(w, p);
    sim.register("testProducer", () => {
      sim.enqueueDamage({ target: p, source: 99, amountFixed: fp(30), type: 1 });
    });
    registerDamageResolve(sim);
    sim.step();
    return { life: w.get<Health>(p, "health")!.life, session: w.get<SessionC>(s, "session")! };
  }

  it("swallows a hit while he stands where he spawned", () => {
    const r = gracedSim();
    expect(r.life).toBe(fp(100));
    expect(r.session.graceUntilTick).toBe(SPAWN_GRACE_TICKS);
  });

  it("breaks the moment he has moved, and the hit lands", () => {
    const r = gracedSim((w, p) => w.set(p, "position", { x: fp(3.5), y: fp(4) }));
    expect(r.life).toBe(fp(70));
    expect(r.session.graceUntilTick).toBeUndefined();
  });

  it("breaks on an active cast", () => {
    const r = gracedSim((w, p) => w.set(p, "casting", { untilTick: 10, skillId: "s" }));
    expect(r.life).toBe(fp(70));
  });

  it("expires on its own tick even standing still", () => {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
    w.set(p, "position", { x: fp(3), y: fp(4) });
    const s = w.create();
    w.set(s, "session", {
      area: "map", mapSeed: 1, waystoneSeed: 1, areaTier: 1, activeNodeId: "",
      completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
      graceUntilTick: 1, graceX: fp(3), graceY: fp(4),
    });
    registerDamageResolve(sim);
    sim.step(); // tick 0: still graced
    expect(w.get<SessionC>(s, "session")!.graceUntilTick).toBe(1);
    sim.step(); // tick 1: expired, cleared
    expect(w.get<SessionC>(s, "session")!.graceUntilTick).toBeUndefined();
  });
});

describe("energy shield stands in front of life", () => {
  function hitPlayer(opts: { es: number; maxEs: number; hit: number; type: number; tick?: number }) {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
    w.set<EnergyShieldC>(p, "energyShield", { es: opts.es, maxEs: opts.maxEs, rechargeAtTick: 0 });
    sim.register("testProducer", () => {
      sim.enqueueDamage({ target: p, source: 99, amountFixed: opts.hit, type: opts.type });
    });
    registerDamageResolve(sim);
    sim.step();
    return {
      life: w.get<Health>(p, "health")!.life,
      shield: w.get<EnergyShieldC>(p, "energyShield")!,
    };
  }

  it("a hit the shield can absorb never reaches life", () => {
    const r = hitPlayer({ es: fp(50), maxEs: fp(50), hit: fp(30), type: 1 });
    expect(r.life).toBe(fp(100));
    expect(r.shield.es).toBe(fp(20));
  });

  it("the overflow lands on life", () => {
    const r = hitPlayer({ es: fp(10), maxEs: fp(50), hit: fp(30), type: 1 });
    expect(r.shield.es).toBe(0);
    expect(r.life).toBe(fp(80));
  });

  it("chaos drains the shield twice as fast", () => {
    // DAMAGE_TYPES index 4 is chaos.
    const r = hitPlayer({ es: fp(50), maxEs: fp(50), hit: fp(10), type: 4 });
    expect(r.shield.es).toBe(fp(30));
    expect(r.life).toBe(fp(100));
  });

  it("any hit pushes the recharge back by the full delay", () => {
    const r = hitPlayer({ es: fp(50), maxEs: fp(50), hit: fp(1), type: 1 });
    expect(r.shield.rechargeAtTick).toBe(ES_RECHARGE_DELAY_TICKS);
  });
});
