import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock, type MonsterDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { registerDamageResolve, SPAWN_GRACE_TICKS } from "./damage-resolve";
import { ES_RECHARGE_DELAY_TICKS, ELECTROCUTE_TICKS, FREEZE_TICKS, SHOCK_TICKS } from "@exiled/rules";
import { damageCode } from "../damage-types";
import { activeStatuses, isStunned } from "../status";
import { ROLL_AVOID_TICKS, ROLL_TICKS } from "./player-movement";
import type { Health, DefensesC, FlasksC, EnergyShieldC, SessionC, RollC, DamageEvent, AilmentC, MonsterC, GearModsC } from "../components";

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

it("culling strike kills a monster a hit leaves at or under the threshold, a boss too", () => {
  const lifeAfter = (hit: number, culls: boolean, boss = false): number => {
    const sim = new Simulation();
    const { world } = sim;
    const striker = world.create();
    if (culls) world.set<GearModsC>(striker, "gearMods", { cullingStrikePct: 10 });
    const t = world.create();
    world.set<Health>(t, "health", { life: fp(20), maxLife: fp(100) });
    world.set<DefensesC>(t, "defenses", { res: resBlock(), armour: fp(0) });
    world.set(t, "monster", { defId: "d", state: "chase" } as unknown as MonsterC);
    if (boss) world.set(t, "boss", {});
    sim.register("testProducer", () => {
      sim.enqueueDamage({ target: t, source: striker, amountFixed: fp(hit), type: 1 });
    });
    registerDamageResolve(sim);
    sim.step();
    return world.get<Health>(t, "health")!.life;
  };
  expect(lifeAfter(10, true)).toBe(0); // 10 of 100 left: culled
  expect(lifeAfter(9, true)).toBe(fp(11)); // 11 left: above the threshold
  expect(lifeAfter(10, false)).toBe(fp(10));
  expect(lifeAfter(10, true, true)).toBe(0);
});

it("a raised lightning cap lets overcapped resistance stop more of a lightning hit, and nothing else", () => {
  const lifeAfter = (type: number, maxResAdd?: { lightning: number }): number => {
    const sim = new Simulation();
    const { world } = sim;
    const t = world.create();
    world.set<Health>(t, "health", { life: fp(100), maxLife: fp(100) });
    world.set<DefensesC>(t, "defenses", { res: resBlock({ fire: 90, lightning: 90 }), armour: fp(0), ...(maxResAdd ? { maxResAdd } : {}) });
    sim.register("testProducer", () => {
      sim.enqueueDamage({ target: t, source: 99, amountFixed: fp(100), type });
    });
    registerDamageResolve(sim);
    sim.step();
    return world.get<Health>(t, "health")!.life;
  };
  const lightning = damageCode("lightning");
  expect(lifeAfter(lightning)).toBe(fp(75)); // capped at 75: 25 taken
  expect(lifeAfter(lightning, { lightning: 3 })).toBe(fp(78)); // capped at 78: 22 taken
  expect(lifeAfter(damageCode("fire"), { lightning: 3 })).toBe(fp(75));
});

it("less physical damage from hits cuts a physical hit after armour, not a bleed or a fire hit", () => {
  const taken = (ev: Omit<DamageEvent, "target">, worn: boolean): number => {
    const sim = new Simulation();
    const { world } = sim;
    const t = world.create();
    world.set<Health>(t, "health", { life: fp(200), maxLife: fp(200) });
    world.set<DefensesC>(t, "defenses", { res: resBlock(), armour: fp(0) });
    if (worn) world.set<GearModsC>(t, "gearMods", { physHitTakenLessPct: 10 });
    sim.register("testProducer", () => sim.enqueueDamage({ ...ev, target: t, source: ev.source === -1 ? t : ev.source }));
    registerDamageResolve(sim);
    sim.step();
    return fp(200) - world.get<Health>(t, "health")!.life;
  };
  expect(taken({ source: 99, amountFixed: fp(100), type: damageCode("physical") }, true)).toBe(fp(90));
  expect(taken({ source: 99, amountFixed: fp(100), type: damageCode("physical") }, false)).toBe(fp(100));
  expect(taken({ source: -1, amountFixed: fp(100), type: damageCode("physical"), ailment: "bleeding" }, true)).toBe(fp(100));
  expect(taken({ source: 99, amountFixed: fp(100), type: damageCode("fire") }, true)).toBe(fp(100));
});

it("a hit on a player who chills attackers chills the monster that landed it", () => {
  const chilledAfter = (worn: boolean): boolean => {
    const sim = new Simulation();
    const { world } = sim;
    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    world.set<DefensesC>(p, "defenses", { res: resBlock(), armour: fp(0) });
    if (worn) world.set<GearModsC>(p, "gearMods", { chillAttackersSec: 1 });
    const m = world.create();
    world.set(m, "monster", { defId: "d", state: "chase" } as unknown as MonsterC);
    world.set<Health>(m, "health", { life: fp(50), maxLife: fp(50) });
    sim.register("testProducer", () => sim.enqueueDamage({ target: p, source: m, amountFixed: fp(5), type: damageCode("physical") }));
    registerDamageResolve(sim);
    sim.step();
    return activeStatuses(world, m, 29).some((s) => s.id === "chilled" && s.slowPct === 30)
      && !activeStatuses(world, m, 31).some((s) => s.id === "chilled");
  };
  expect(chilledAfter(true)).toBe(true);
  expect(chilledAfter(false)).toBe(false);
});

it("culling strike never takes a damage-over-time tick's victim", () => {
  const sim = new Simulation();
  const { world } = sim;
  const t = world.create();
  world.set<GearModsC>(t, "gearMods", { cullingStrikePct: 10 });
  world.set<Health>(t, "health", { life: fp(20), maxLife: fp(100) });
  world.set<DefensesC>(t, "defenses", { res: resBlock(), armour: fp(0) });
  world.set(t, "monster", { defId: "d", state: "chase" } as unknown as MonsterC);
  sim.register("testProducer", () => {
    sim.enqueueDamage({ target: t, source: t, amountFixed: fp(10), type: 0 });
  });
  registerDamageResolve(sim);
  sim.step();
  expect(world.get<Health>(t, "health")!.life).toBe(fp(10));
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

  it("a certain chance poisons for 2 s at 50% of the hit before mitigation", () => {
    const r = hits("m.poisoner", [{ amount: fp(10), type: 4 }], (w, p) =>
      w.set<DefensesC>(p, "defenses", { res: resBlock({ chaos: 75 }), armour: 0 }));
    expect(r.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(5), expiryTick: 60 });
    expect(r.bleeding).toBeUndefined();
  });

  it("a certain chance bleeds for 5 s at 40% of a physical hit", () => {
    const r = hits("m.bleeder", [{ amount: fp(10), type: 1 }]);
    expect(r.bleeding).toEqual({ kind: "bleeding", stacks: 1, dps: fp(4), expiryTick: 150 });
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
    expect(weaker.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(10), expiryTick: 60 });
    const equal = hits("m.poisoner", [{ tick: 0, amount: fp(20), type: 4 }, { tick: 10, amount: fp(20), type: 4 }]);
    expect(equal.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(10), expiryTick: 70 });
    const stronger = hits("m.poisoner", [{ tick: 0, amount: fp(10), type: 4 }, { tick: 10, amount: fp(30), type: 4 }]);
    expect(stronger.poison).toEqual({ kind: "poison", stacks: 1, dps: fp(15), expiryTick: 70 });
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

describe("cold and lightning hits on a monster", () => {
  const monster = (sim: Simulation, life = 100, boss = false) => {
    const m = sim.world.create();
    sim.world.set<Health>(m, "health", { life: fp(life), maxLife: fp(life) });
    sim.world.set<DefensesC>(m, "defenses", { res: resBlock(), armour: fp(0) });
    sim.world.set<MonsterC>(m, "monster", {
      defId: "monster.probe", moveSpeed: fp(1), bodyRadius: fp(0.5), attackRange: fp(1), attackCooldownTicks: 30,
      attackDamage: fp(1), attackType: damageCode("physical"), attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0,
      state: "chase", rare: 0, summoned: 0,
    });
    if (boss) sim.world.set(m, "boss", { phase: 1 });
    return m;
  };
  const hitEvery = (sim: Simulation, m: number, type: Parameters<typeof damageCode>[0], amount: number) =>
    sim.register("testProducer", () => sim.enqueueDamage({ target: m, source: 999, amountFixed: fp(amount), type: damageCode(type) }));
  const statuses = (sim: Simulation, m: number) => activeStatuses(sim.world, m, sim.tick).map((s) => s.id);

  it("freeze once cold worth 30% of max life has landed: frozen 4 s, stunned, the meter emptied", () => {
    const sim = new Simulation();
    const m = monster(sim);
    hitEvery(sim, m, "cold", 10);
    registerDamageResolve(sim);
    sim.step();
    sim.step();
    expect(statuses(sim, m)).not.toContain("frozen");
    expect(sim.world.get<MonsterC>(m, "monster")!.freeze?.pct).toBe(68);
    sim.step();
    expect(statuses(sim, m)).toContain("frozen");
    const mon = sim.world.get<MonsterC>(m, "monster")!;
    expect(isStunned(mon, sim.tick)).toBe(true);
    expect(mon.stunnedUntilTick).toBe(sim.tick - 1 + FREEZE_TICKS);
    expect(mon.freeze).toBeUndefined();
  });

  it("builds nothing on a body already frozen, so cold hits cannot chain one freeze into the next", () => {
    const sim = new Simulation();
    const m = monster(sim);
    hitEvery(sim, m, "cold", 10);
    registerDamageResolve(sim);
    for (let i = 0; i < 3; i++) sim.step();
    expect(statuses(sim, m)).toContain("frozen");
    const until = sim.world.get<MonsterC>(m, "monster")!.stunnedUntilTick;
    for (let i = 0; i < 6; i++) sim.step();
    expect(sim.world.get<MonsterC>(m, "monster")!.freeze).toBeUndefined();
    expect(sim.world.get<MonsterC>(m, "monster")!.stunnedUntilTick).toBe(until);
  });

  it("never freezes a boss, which a stun cannot hold either", () => {
    const sim = new Simulation();
    const m = monster(sim, 100, true);
    hitEvery(sim, m, "cold", 40);
    registerDamageResolve(sim);
    sim.step();
    expect(statuses(sim, m)).not.toContain("frozen");
  });

  it("a lightning hit worth 40% of max life always shocks: 20% more damage taken for 8 s", () => {
    const sim = new Simulation();
    const m = monster(sim, 1000);
    hitEvery(sim, m, "lightning", 400);
    registerDamageResolve(sim);
    sim.step();
    const shock = activeStatuses(sim.world, m, sim.tick).find((s) => s.id === "shocked");
    expect(shock).toMatchObject({ damageTakenPct: 20 });
    expect(shock!.untilTick).toBe(sim.tick - 1 + SHOCK_TICKS);
  });

  it("a small lightning hit shocks by a seeded roll, the same every run", () => {
    const runs = [1, 2].map(() => {
      const sim = new Simulation();
      const m = monster(sim, 1000);
      hitEvery(sim, m, "lightning", 20);
      registerDamageResolve(sim, 7);
      const at: number[] = [];
      for (let i = 0; i < 60; i++) { sim.step(); if (statuses(sim, m).includes("shocked") && at.length === 0) at.push(sim.tick); }
      return at;
    });
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]!.length).toBe(1);
  });

  const electrocuteEvery = (sim: Simulation, m: number, amount: number) =>
    sim.register("testProducer", () => sim.enqueueDamage({ target: m, source: 999, amountFixed: fp(amount), type: damageCode("lightning"), electrocutes: true }));

  it("electrocutes once an electrocuting skill's lightning worth 50% of max life has landed: 3 s, stunned, the meter emptied", () => {
    const sim = new Simulation();
    const m = monster(sim);
    electrocuteEvery(sim, m, 20);
    registerDamageResolve(sim);
    sim.step();
    sim.step();
    expect(statuses(sim, m)).not.toContain("electrocuted");
    expect(sim.world.get<MonsterC>(m, "monster")!.electrocute?.pct).toBeGreaterThanOrEqual(80);
    sim.step();
    expect(statuses(sim, m)).toContain("electrocuted");
    const mon = sim.world.get<MonsterC>(m, "monster")!;
    expect(isStunned(mon, sim.tick)).toBe(true);
    expect(mon.stunnedUntilTick).toBe(sim.tick - 1 + ELECTROCUTE_TICKS);
    expect(ELECTROCUTE_TICKS).toBe(90);
    expect(mon.electrocute).toBeUndefined();
  });

  it("plain lightning builds no electrocute, however hard it hits", () => {
    const sim = new Simulation();
    const m = monster(sim, 1000);
    hitEvery(sim, m, "lightning", 400);
    registerDamageResolve(sim);
    sim.step();
    sim.step();
    expect(statuses(sim, m)).not.toContain("electrocuted");
    expect(sim.world.get<MonsterC>(m, "monster")!.electrocute).toBeUndefined();
  });

  it("never electrocutes a boss", () => {
    const sim = new Simulation();
    const m = monster(sim, 100, true);
    electrocuteEvery(sim, m, 60);
    registerDamageResolve(sim);
    sim.step();
    expect(statuses(sim, m)).not.toContain("electrocuted");
  });

  it("a burning or poison tick builds nothing and shocks nothing", () => {
    const sim = new Simulation();
    const m = monster(sim);
    sim.register("testProducer", () => sim.enqueueDamage({ target: m, source: m, amountFixed: fp(50), type: damageCode("cold") }));
    registerDamageResolve(sim);
    sim.step();
    expect(sim.world.get<MonsterC>(m, "monster")!.freeze).toBeUndefined();
  });
});
