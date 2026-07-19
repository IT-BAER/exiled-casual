import { Simulation } from "../loop";
import type { ProjectileC, GroundAreaC } from "../components";

export function registerExpiry(sim: Simulation): void {
  sim.register("expiry", (world, tick) => {
    for (const e of world.query("projectile")) {
      if ((world.get<ProjectileC>(e, "projectile")?.remainingRange ?? 1) <= 0) {
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
