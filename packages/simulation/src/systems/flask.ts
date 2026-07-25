import { flaskRecovery } from "@exiled/rules";
import type { Simulation } from "../loop";
import type { FlasksC, Health, Mana } from "../components";

export function registerFlaskSystem(sim: Simulation): void {
  sim.register("flask", (world, _tick, commands) => {
    for (const cmd of commands) {
      if (cmd.type !== "useFlask" || cmd.entity === undefined) continue;
      const e = cmd.entity;

      const f = world.get<FlasksC>(e, "flasks");
      if (!f) continue;

      const h = world.get<Health>(e, "health");
      if (!h || h.life <= 0) continue;

      if (cmd.flask === "life") {
        if (f.lifeCharges <= 0 || h.life >= h.maxLife) continue;
        world.set<Health>(e, "health", { ...h, life: Math.min(h.maxLife, h.life + flaskRecovery(h.maxLife)) });
        world.set<FlasksC>(e, "flasks", { ...f, lifeCharges: f.lifeCharges - 1 });
      } else if (cmd.flask === "mana") {
        const m = world.get<Mana>(e, "mana");
        if (!m) continue;
        if (f.manaCharges <= 0 || m.mana >= m.maxMana) continue;
        world.set<Mana>(e, "mana", { ...m, mana: Math.min(m.maxMana, m.mana + flaskRecovery(m.maxMana)) });
        world.set<FlasksC>(e, "flasks", { ...f, manaCharges: f.manaCharges - 1 });
      }
    }
  });
}
