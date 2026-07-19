import { Simulation } from "../loop";
import type { Health, Mana } from "../components";

export function registerDeath(sim: Simulation): void {
  sim.register("death", (world) => {
    for (const e of world.query("monster", "health")) {
      if ((world.get<Health>(e, "health")?.life ?? 1) <= 0) {
        world.destroy(e);
      }
    }

    for (const e of world.query("player", "health")) {
      const h = world.get<Health>(e, "health")!;
      if (h.life > 0) continue;
      world.set(e, "position", { x: 0, y: 0 });
      world.set<Health>(e, "health", { ...h, life: h.maxLife });
      const mn = world.get<Mana>(e, "mana");
      if (mn) world.set<Mana>(e, "mana", { ...mn, mana: mn.maxMana });
    }
  });
}
