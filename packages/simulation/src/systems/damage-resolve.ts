import { applyDamage } from "@pact/rules";
import { Simulation } from "../loop";
import type { Health, DefensesC } from "../components";

export function registerDamageResolve(sim: Simulation): void {
  sim.register("damageResolve", (world) => {
    const q = sim.damageQueue
      .slice()
      .sort((a, b) =>
        a.target !== b.target ? a.target - b.target :
        a.source !== b.source ? a.source - b.source :
        a.type - b.type,
      );
    sim.damageQueue = [];

    for (const ev of q) {
      const health = world.get<Health>(ev.target, "health");
      const def = world.get<DefensesC>(ev.target, "defenses");
      if (!health || !def) continue;

      const final = applyDamage(
        { type: ev.type === 0 ? "fire" : "physical", amountFixed: ev.amountFixed },
        { fireResPct: def.fireResPct, armourFixed: def.armour },
      );
      world.set<Health>(ev.target, "health", {
        ...health,
        life: Math.max(0, health.life - final),
      });
    }
  });
}
