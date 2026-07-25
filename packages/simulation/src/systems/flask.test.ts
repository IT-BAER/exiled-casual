import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerFlaskSystem } from "./flask";
import type { FlasksC, Health, Mana } from "../components";

function makeWorld() {
  const sim = new Simulation();
  registerFlaskSystem(sim);
  const { world } = sim;

  const p = world.create();
  world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
  world.set<Health>(p, "health", { life: fp(80), maxLife: fp(100) });
  world.set<Mana>(p, "mana", { mana: fp(40), maxMana: fp(60), regen: 0 });
  world.set<FlasksC>(p, "flasks", {
    lifeCharges: 5, lifeMax: 7,
    manaCharges: 5, manaMax: 7,
  });

  return { sim, world, p };
}

describe("flask system", () => {
  it("life flask heals and spends one charge", () => {
    const { sim, world, p } = makeWorld();
    sim.step([{ tick: 0, entity: p, type: "useFlask", flask: "life" }]);
    const h = world.get<Health>(p, "health")!;
    expect(h.life).toBeGreaterThan(fp(80));
    expect(world.get<FlasksC>(p, "flasks")!.lifeCharges).toBe(4);
  });

  it("at full life nothing happens and the charge is kept", () => {
    const { sim, world, p } = makeWorld();
    world.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
    sim.step([{ tick: 0, entity: p, type: "useFlask", flask: "life" }]);
    expect(world.get<FlasksC>(p, "flasks")!.lifeCharges).toBe(5);
  });

  it("at zero charges nothing happens", () => {
    const { sim, world, p } = makeWorld();
    world.set<FlasksC>(p, "flasks", { lifeCharges: 0, lifeMax: 7, manaCharges: 0, manaMax: 7 });
    sim.step([{ tick: 0, entity: p, type: "useFlask", flask: "life" }]);
    const h = world.get<Health>(p, "health")!;
    expect(h.life).toBe(fp(80));
  });

  it("dead player cannot drink", () => {
    const { sim, world, p } = makeWorld();
    world.set<Health>(p, "health", { life: 0, maxLife: fp(100) });
    sim.step([{ tick: 0, entity: p, type: "useFlask", flask: "life" }]);
    expect(world.get<FlasksC>(p, "flasks")!.lifeCharges).toBe(5);
  });

  it("mana flask restores mana and spends one charge", () => {
    const { sim, world, p } = makeWorld();
    sim.step([{ tick: 0, entity: p, type: "useFlask", flask: "mana" }]);
    const m = world.get<Mana>(p, "mana")!;
    expect(m.mana).toBeGreaterThan(fp(40));
    expect(world.get<FlasksC>(p, "flasks")!.manaCharges).toBe(4);
  });

  it("recovery clamps at max", () => {
    const { sim, world, p } = makeWorld();
    // life at 90 out of 100; 30% of 100 = 30 → would go to 120, clamped to 100
    world.set<Health>(p, "health", { life: fp(90), maxLife: fp(100) });
    sim.step([{ tick: 0, entity: p, type: "useFlask", flask: "life" }]);
    expect(world.get<Health>(p, "health")!.life).toBe(fp(100));
  });
});
