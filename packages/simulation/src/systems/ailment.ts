import { burningTickDamage, AILMENT_TICK_INTERVAL } from "@exiled/rules";
import { Simulation } from "../loop";
import type { AilmentC } from "../components";

export function registerAilmentTick(sim: Simulation): void {
  sim.register("ailmentTick", (world, tick) => {
    for (const e of world.entitiesWith("ailment")) {
      const a = world.get<AilmentC>(e, "ailment")!;
      if (tick >= a.expiryTick) {
        world.remove(e, "ailment");
        continue;
      }
      if (tick % AILMENT_TICK_INTERVAL === 0) {
        sim.enqueueDamage({
          target: e,
          source: e,
          amountFixed: burningTickDamage({ kind: "burning", stacks: a.stacks, dpsFixed: a.dps, expiryTick: a.expiryTick }),
          type: 0,
        });
      }
    }
  });
}
