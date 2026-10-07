import { esRechargePerTick, esRegenPerTick } from "@exiled/rules";
import { Simulation } from "../loop";
import type { Mana, EnergyShieldC } from "../components";

export function registerResourceRegen(sim: Simulation): void {
  sim.register("resourceRegen", (world, tick) => {
    for (const e of world.entitiesWith("mana")) {
      const m = world.get<Mana>(e, "mana")!;
      const next = Math.min(m.mana + m.regen, m.maxMana);
      world.set<Mana>(e, "mana", { mana: next, maxMana: m.maxMana, regen: m.regen });
    }

    // Energy shield always regenerates slowly, and refills fast on top once
    // nothing has hit it for the delay: the reward for four seconds of not
    // being in the way. Rates are recomputed from maxEs rather than stored, so
    // a swapped focus takes effect on the next tick.
    for (const e of world.entitiesWith("energyShield")) {
      const s = world.get<EnergyShieldC>(e, "energyShield")!;
      if (s.es >= s.maxEs) continue;
      const gain = esRegenPerTick(s.maxEs) + (tick < s.rechargeAtTick ? 0 : esRechargePerTick(s.maxEs));
      if (gain <= 0) continue;
      world.set<EnergyShieldC>(e, "energyShield", { ...s, es: Math.min(s.maxEs, s.es + gain) });
    }
  });
}
