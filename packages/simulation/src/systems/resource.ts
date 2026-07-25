import { esRechargePerTick } from "@exiled/rules";
import { Simulation } from "../loop";
import type { Mana, EnergyShieldC } from "../components";

export function registerResourceRegen(sim: Simulation): void {
  sim.register("resourceRegen", (world, tick) => {
    for (const e of world.entitiesWith("mana")) {
      const m = world.get<Mana>(e, "mana")!;
      const next = Math.min(m.mana + m.regen, m.maxMana);
      world.set<Mana>(e, "mana", { mana: next, maxMana: m.maxMana, regen: m.regen });
    }

    // Energy shield refills only once nothing has hit it for the delay, and then
    // fast — the reward for four seconds of not being in the way. The rate is
    // recomputed from maxEs rather than stored, so a swapped focus takes effect
    // on the next tick without anything having to invalidate a cached number.
    for (const e of world.entitiesWith("energyShield")) {
      const s = world.get<EnergyShieldC>(e, "energyShield")!;
      if (tick < s.rechargeAtTick || s.es >= s.maxEs) continue;
      world.set<EnergyShieldC>(e, "energyShield", {
        ...s,
        es: Math.min(s.maxEs, s.es + esRechargePerTick(s.maxEs)),
      });
    }
  });
}
