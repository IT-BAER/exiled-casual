import { fp } from "@exiled/fixed-point";
import { esRechargePerTick, esRegenPerTick } from "@exiled/rules";
import { Simulation } from "../loop";
import type { Mana, EnergyShieldC, Health } from "../components";
import { buffSum, expireEffects, reservedMana } from "../status";

/** A per-second Fixed rate's share of tick `tick`, differenced so the truncations cancel over a second. */
function perTick(perSec: number, tick: number): number {
  return Math.trunc((perSec * (tick + 1)) / 30) - Math.trunc((perSec * tick) / 30);
}

export function registerResourceRegen(sim: Simulation): void {
  sim.register("resourceRegen", (world, tick) => {
    expireEffects(world, tick);

    // Auras hold mana back: the pool regenerates only up to what they leave free.
    for (const e of world.entitiesWith("mana")) {
      const m = world.get<Mana>(e, "mana")!;
      const cap = m.maxMana - reservedMana(world, e, m.maxMana);
      const next = Math.min(m.mana + m.regen, cap);
      world.set<Mana>(e, "mana", { mana: next, maxMana: m.maxMana, regen: m.regen });
    }

    // Buffed life: regeneration up to the maximum, drain down to 1 and never past it.
    for (const e of world.entitiesWith("buffs")) {
      const h = world.get<Health>(e, "health");
      if (!h || h.life <= 0) continue;
      const gain = perTick(buffSum(world, e, tick, "regen"), tick);
      const loss = perTick(buffSum(world, e, tick, "drain"), tick);
      if (gain === 0 && loss === 0) continue;
      let life = Math.min(h.maxLife, h.life + gain - loss);
      if (loss > 0) life = Math.max(life, Math.min(h.life, fp(1)));
      if (life !== h.life) world.set<Health>(e, "health", { ...h, life });
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
