import { Simulation } from "../loop";
import type { ProjectileC, GroundAreaC, SkillAreaC } from "../components";

export function registerExpiry(sim: Simulation): void {
  sim.register("expiry", (world, tick) => {
    for (const e of world.query("projectile")) {
      const p = world.get<ProjectileC>(e, "projectile");
      if (p && p.remainingRange <= 0 && (p.spentTick ?? -1) < tick) {
        world.destroy(e);
      }
    }
    for (const e of world.query("groundArea")) {
      if (tick >= (world.get<GroundAreaC>(e, "groundArea")?.expiryTick ?? Infinity)) {
        world.destroy(e);
      }
    }
    // A landed impact lives one snapshot past its landing, as a spent bolt does.
    for (const e of world.query("skillArea")) {
      const spent = world.get<SkillAreaC>(e, "skillArea")?.spentTick;
      if (spent !== undefined && spent < tick) world.destroy(e);
    }
  });
}
