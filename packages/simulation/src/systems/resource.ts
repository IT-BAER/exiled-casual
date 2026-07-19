import { Simulation } from "../loop";
import type { Mana } from "../components";

export function registerResourceRegen(sim: Simulation): void {
  sim.register("resourceRegen", (world) => {
    for (const e of world.entitiesWith("mana")) {
      const m = world.get<Mana>(e, "mana")!;
      const next = Math.min(m.mana + m.regen, m.maxMana);
      world.set<Mana>(e, "mana", { mana: next, maxMana: m.maxMana, regen: m.regen });
    }
  });
}
