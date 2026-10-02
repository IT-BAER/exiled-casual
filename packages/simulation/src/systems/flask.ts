import { flaskRecovery } from "@exiled/rules";
import type { Simulation } from "../loop";
import type { EnergyShieldC, FlasksC, Health, Mana, SessionC } from "../components";

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

    // PoE refills you in town and hideout: the hideout keeps every pool and
    // flask full, so coming home from a map is never a wait.
    const sessionE = world.query("session")[0];
    if (sessionE === undefined || world.get<SessionC>(sessionE, "session")!.area !== "hideout") return;
    for (const e of world.query("player")) {
      const h = world.get<Health>(e, "health");
      if (!h || h.life <= 0) continue;
      if (h.life < h.maxLife) world.set<Health>(e, "health", { ...h, life: h.maxLife });
      const m = world.get<Mana>(e, "mana");
      if (m && m.mana < m.maxMana) world.set<Mana>(e, "mana", { ...m, mana: m.maxMana });
      const s = world.get<EnergyShieldC>(e, "energyShield");
      if (s && s.es < s.maxEs) world.set<EnergyShieldC>(e, "energyShield", { ...s, es: s.maxEs });
      const f = world.get<FlasksC>(e, "flasks");
      if (f && (f.lifeCharges < f.lifeMax || f.manaCharges < f.manaMax)) {
        world.set<FlasksC>(e, "flasks", { ...f, lifeCharges: f.lifeMax, manaCharges: f.manaMax });
      }
    }
  });
}
