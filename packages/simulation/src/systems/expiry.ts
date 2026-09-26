import { Simulation } from "../loop";
import type { ProjectileC, GroundAreaC } from "../components";

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
  });
}
