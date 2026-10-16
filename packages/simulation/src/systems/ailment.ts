import { burningTickDamage, dotTickDamage, AILMENT_TICK_INTERVAL } from "@exiled/rules";
import { Simulation } from "../loop";
import type { AilmentC } from "../components";
import { damageCode } from "../damage-types";

/** Single-instance DoTs, in tick order, and the damage type each deals. */
const SINGLE_DOTS = [
  { kind: "poison", type: damageCode("chaos") },
  { kind: "bleeding", type: damageCode("physical") },
] as const;

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
    for (const { kind, type } of SINGLE_DOTS) {
      for (const e of world.entitiesWith(kind)) {
        const a = world.get<AilmentC>(e, kind)!;
        if (tick >= a.expiryTick) {
          world.remove(e, kind);
          continue;
        }
        if (tick % AILMENT_TICK_INTERVAL === 0) {
          sim.enqueueDamage({ target: e, source: e, amountFixed: dotTickDamage(a.dps), type, ailment: kind });
        }
      }
    }
  });
}
