import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock, type MonsterDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { registerDamageResolve, SPAWN_GRACE_TICKS } from "./damage-resolve";
import { ES_RECHARGE_DELAY_TICKS } from "@exiled/rules";
import { ROLL_AVOID_TICKS, ROLL_TICKS } from "./player-movement";
import type { Health, DefensesC, FlasksC, EnergyShieldC, SessionC, RollC, DamageEvent, AilmentC } from "../components";

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

it("armour stops part of a physical hit but none of a bleeding tick", () => {
  const sim = new Simulation();
  const { world } = sim;
  const t = world.create();
  world.set<Health>(t, "health", { life: fp(40), maxLife: fp(40) });
  world.set<DefensesC>(t, "defenses", { res: resBlock(), armour: fp(89) });
  sim.register("testProducer", () => {
    sim.enqueueDamage({ target: t, source: t, amountFixed: fp(0.5), type: 1, ailment: "bleeding" });
  });
  registerDamageResolve(sim);
  sim.step();
  expect(world.get<Health>(t, "health")!.life).toBe(fp(40) - fp(0.5));

  const hit = new Simulation();
  const h = hit.world.create();
  hit.world.set<Health>(h, "health", { life: fp(40), maxLife: fp(40) });
  hit.world.set<DefensesC>(h, "defenses", { res: resBlock(), armour: fp(89) });
  hit.register("testProducer", () => {
    hit.enqueueDamage({ target: h, source: 99, amountFixed: fp(0.5), type: 1 });
  });
  registerDamageResolve(hit);
  hit.step();
  expect(hit.world.get<Health>(h, "health")!.life).toBeGreaterThan(fp(40) - fp(0.5));
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
  function hitPlayer(opts: { es: number; maxEs: number; hit: number; type: number; tick?: number; ailment?: "poison" | "bleeding" }) {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
    w.set<EnergyShieldC>(p, "energyShield", { es: opts.es, maxEs: opts.maxEs, rechargeAtTick: 0 });
    sim.register("testProducer", () => {
      sim.enqueueDamage(opts.ailment
        ? { target: p, source: p, amountFixed: opts.hit, type: opts.type, ailment: opts.ailment }
        : { target: p, source: 99, amountFixed: opts.hit, type: opts.type });
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

  it("poison and bleeding go past it to life, and still push the recharge back", () => {
    for (const [ailment, type] of [["poison", 4], ["bleeding", 1]] as const) {
      const r = hitPlayer({ es: fp(50), maxEs: fp(50), hit: fp(2), type, ailment });
      expect(r.shield.es, ailment).toBe(fp(50));
      expect(r.life, ailment).toBe(fp(98));
      expect(r.shield.rechargeAtTick, ailment).toBe(ES_RECHARGE_DELAY_TICKS);
    }
  });
});

describe("a dodge roll's opening ticks", () => {
  const T = 5;

  /** Life after one hit tagged `via` lands on roll tick `k` (sim tick T + k - 1). */
  function lifeAfter(k: number, via: DamageEvent["via"]): number {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
    w.set<RollC>(p, "roll", { startTick: T, untilTick: T + ROLL_TICKS, dirX: fp(1), dirY: 0 });
    sim.register("testProducer", (_w, tick) => {
      if (tick === T + k - 1) sim.enqueueDamage({ target: p, source: 99, amountFixed: fp(10), type: 1, via });
    });
    registerDamageResolve(sim);
    while (sim.tick < T + k) sim.step();
    return w.get<Health>(p, "health")!.life;
  }

  it("let projectiles, melee and slams pass through the first 80% of the roll", () => {
    expect(ROLL_AVOID_TICKS).toBe(Math.round((ROLL_TICKS * 4) / 5));
    for (const via of ["projectile", "melee", "slam"] as const) {
      expect(lifeAfter(1, via)).toBe(fp(100));
      expect(lifeAfter(ROLL_AVOID_TICKS, via)).toBe(fp(100));
    }
  });

  it("stop letting them pass on the tick after", () => {
    for (const via of ["projectile", "melee", "slam"] as const) {
      expect(lifeAfter(ROLL_AVOID_TICKS + 1, via)).toBeLessThan(fp(100));
    }
  });

  it("never skip a ground or ailment tick, which outlasts any roll", () => {
    expect(lifeAfter(1, undefined)).toBeLessThan(fp(100));
  });
});

describe("a monster's hit leaves its ailment on the player", () => {
  const def = (id: string, onHit?: MonsterDef["onHit"]): MonsterDef => ({
    id, name: id, maxLifeFixed: fp(10), moveSpeedFixed: 0, attackRangeFixed: 0, attackCooldownTicks: 30,
    attackDamage: { type: "physical", amountFixed: fp(10) }, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock(), armourFixed: 0 }, archetype: "swarm", ...(onHit ? { onHit } : {}),
  });
  const DEFS = new Map<string, MonsterDef>([
    ["m.poisoner", def("m.poisoner", { ailment: "poison", chancePct: 100 })],
    ["m.bleeder", def("m.bleeder", { ailment: "bleeding", chancePct: 100 })],
    ["m.coin", def("m.coin", { ailment: "poison", chancePct: 50 })],
    ["m.plain", def("m.plain")],
  ]);

  /** One hit per entry, each at its tick, from a monster of `defId`. */
  function hits(
    defId: string,
    list: { tick?: number; amount: number; type: number; via?: DamageEvent["via"] }[],
    setup?: (w: Simulation["world"], p: number) => void,
    seed = 0,
  ) {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set<Health>(p, "health", { life: fp(1000), maxLife: fp(1000) });
    w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
    const m = w.create();
    w.set(m, "monster", { defId, state: "chase", moveSpeed: 0, bodyRadius: 0, attackRange: 0,
      attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    setup?.(w, p);
    sim.register("testProducer", (_w, tick) => {
      for (const h of list) {
        if ((h.tick ?? 0) === tick) sim.enqueueDamage({ target: p, source: m, amountFixed: h.amount, type: h.type, via: h.via ?? "melee" });
      }
    });
    registerDamageResolve(sim, seed, DEFS);
    const last = Math.max(0, ...list.map((h) => h.tick ?? 0));
    while (sim.tick <= last) sim.step();
    return { poison: w.get<AilmentC>(p, "poison"), bleeding: w.get<AilmentC>(p, "bleeding"), sim };
  }

  it("a certain chance poisons for 5 s at 50% of the hit before mitigation", () => {
    const r = hits("m.poisoner", [{ amount: fp(10), type: 4 }], (w, p) =>
      w.set<DefensesC>(p, "defenses", { res: resBlock({ chaos: 75 }), armour: 0 }));
    expect(r.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(5), expiryTick: 150 });
    expect(r.bleeding).toBeUndefined();
  });

  it("a certain chance bleeds for 7 s at 60% of a physical hit", () => {
    const r = hits("m.bleeder", [{ amount: fp(10), type: 1 }]);
    expect(r.bleeding).toEqual({ kind: "bleeding", stacks: 1, dps: fp(6), expiryTick: 210 });
  });

  it("a species without onHit leaves nothing", () => {
    const r = hits("m.plain", [{ amount: fp(10), type: 1 }]);
    expect(r.poison).toBeUndefined();
    expect(r.bleeding).toBeUndefined();
  });

  it("a partial chance is a seeded roll: some seeds land it, some do not, each the same every time", () => {
    const landed = Array.from({ length: 40 }, (_, seed) =>
      hits("m.coin", [{ amount: fp(10), type: 4 }], undefined, seed).poison !== undefined);
    expect(landed.some(Boolean)).toBe(true);
    expect(landed.some((x) => !x)).toBe(true);
    expect(Array.from({ length: 40 }, (_, seed) =>
      hits("m.coin", [{ amount: fp(10), type: 4 }], undefined, seed).poison !== undefined)).toEqual(landed);
  });

  it("a hit whose type cannot carry the ailment leaves nothing", () => {
    expect(hits("m.bleeder", [{ amount: fp(10), type: 4 }]).bleeding).toBeUndefined();
    expect(hits("m.poisoner", [{ amount: fp(10), type: 0 }]).poison).toBeUndefined();
  });

  it("spawn grace swallows the ailment with the hit", () => {
    const r = hits("m.poisoner", [{ amount: fp(10), type: 4 }], (w, p) => {
      w.set(p, "position", { x: 0, y: 0 });
      const s = w.create();
      w.set(s, "session", {
        area: "map", mapSeed: 1, waystoneSeed: 1, areaTier: 1, activeNodeId: "",
        completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
        graceUntilTick: SPAWN_GRACE_TICKS, graceX: 0, graceY: 0,
      });
    });
    expect(r.poison).toBeUndefined();
  });

  it("the roll's avoid window swallows the ailment with the hit", () => {
    const r = hits("m.bleeder", [{ amount: fp(10), type: 1 }], (w, p) =>
      w.set<RollC>(p, "roll", { startTick: 0, untilTick: ROLL_TICKS, dirX: fp(1), dirY: 0 }));
    expect(r.bleeding).toBeUndefined();
  });

  it("a hit on a corpse leaves nothing", () => {
    const r = hits("m.poisoner", [{ amount: fp(10), type: 4 }], (w, p) =>
      w.set<Health>(p, "health", { life: 0, maxLife: fp(1000) }));
    expect(r.poison).toBeUndefined();
  });

  it("a weaker hit never replaces a stronger poison; an equal or stronger one refreshes it", () => {
    const weaker = hits("m.poisoner", [{ tick: 0, amount: fp(20), type: 4 }, { tick: 10, amount: fp(10), type: 4 }]);
    expect(weaker.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(10), expiryTick: 150 });
    const equal = hits("m.poisoner", [{ tick: 0, amount: fp(20), type: 4 }, { tick: 10, amount: fp(20), type: 4 }]);
    expect(equal.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(10), expiryTick: 160 });
    const stronger = hits("m.poisoner", [{ tick: 0, amount: fp(10), type: 4 }, { tick: 10, amount: fp(30), type: 4 }]);
    expect(stronger.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(15), expiryTick: 160 });
  });

  it("the death recap names each DoT tick by its own ailment", () => {
    const sim = new Simulation();
    const w = sim.world;
    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
    sim.register("testProducer", () => {
      sim.enqueueDamage({ target: p, source: p, amountFixed: fp(1), type: 0 });
      sim.enqueueDamage({ target: p, source: p, amountFixed: fp(1), type: 4, ailment: "poison" });
      sim.enqueueDamage({ target: p, source: p, amountFixed: fp(1), type: 1, ailment: "bleeding" });
    });
    registerDamageResolve(sim);
    sim.step();
    expect(sim.recentHits.map((h) => h.species)).toEqual(["ailment.burning", "ailment.bleeding", "ailment.poison"]);
  });
});
