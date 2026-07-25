import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerResourceRegen } from "./resource";
import { ES_RECHARGE_DELAY_TICKS, esRechargePerTick } from "@exiled/rules";
import type { Mana, EnergyShieldC } from "../components";

describe("registerResourceRegen", () => {
  function makeSimWithMana(mana: number, maxMana: number, regen: number): {
    sim: Simulation; entity: number;
  } {
    const sim = new Simulation();
    registerResourceRegen(sim);
    const e = sim.world.create();
    sim.world.set<Mana>(e, "mana", { mana, maxMana, regen });
    return { sim, entity: e };
  }

  it("adds regen to mana each tick", () => {
    const { sim, entity } = makeSimWithMana(fp(50), fp(60), fp(1));
    sim.step();
    const m = sim.world.get<Mana>(entity, "mana")!;
    expect(m.mana).toBe(fp(51));
  });

  it("clamps mana to maxMana", () => {
    const { sim, entity } = makeSimWithMana(fp(59), fp(60), fp(5));
    sim.step();
    const m = sim.world.get<Mana>(entity, "mana")!;
    expect(m.mana).toBe(fp(60));
  });

  it("does not affect entities without mana", () => {
    const sim = new Simulation();
    registerResourceRegen(sim);
    const e = sim.world.create();
    // no mana component
    sim.step();
    expect(sim.world.get(e, "mana")).toBeUndefined();
  });

  it("processes multiple mana entities in ascending id order", () => {
    const sim = new Simulation();
    registerResourceRegen(sim);
    const e1 = sim.world.create();
    const e2 = sim.world.create();
    sim.world.set<Mana>(e1, "mana", { mana: fp(10), maxMana: fp(20), regen: fp(2) });
    sim.world.set<Mana>(e2, "mana", { mana: fp(5), maxMana: fp(10), regen: fp(3) });
    sim.step();
    expect(sim.world.get<Mana>(e1, "mana")!.mana).toBe(fp(12));
    expect(sim.world.get<Mana>(e2, "mana")!.mana).toBe(fp(8));
  });
});

describe("energy shield recharge", () => {
  function shieldAfter(ticks: number, rechargeAtTick: number) {
    const sim = new Simulation();
    registerResourceRegen(sim);
    const w = sim.world;
    const p = w.create();
    w.set<EnergyShieldC>(p, "energyShield", { es: 0, maxEs: fp(300), rechargeAtTick });
    for (let i = 0; i < ticks; i++) sim.step();
    return w.get<EnergyShieldC>(p, "energyShield")!.es;
  }

  it("stays empty until the delay has passed", () => {
    expect(shieldAfter(60, ES_RECHARGE_DELAY_TICKS)).toBe(0);
  });

  it("refills the whole pool in eight seconds once it starts", () => {
    expect(shieldAfter(30, 0)).toBe(esRechargePerTick(fp(300)) * 30);
    expect(shieldAfter(8 * 30 + 2, 0)).toBe(fp(300));
  });

  it("never overfills", () => {
    expect(shieldAfter(600, 0)).toBe(fp(300));
  });
});
