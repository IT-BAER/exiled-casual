import type { Fixed } from "@pact/fixed-point";
import type { DamageSpec, Defenses } from "@pact/content-schema";
import { RES_CAP, ARMOUR_K } from "./stats.js";

/**
 * Final damage after one resistance/mitigation channel. Deterministic integer
 * math. Never returns a negative value.
 *   fire:     trunc(raw * (100 - min(res, RES_CAP)) / 100)
 *   physical: trunc(raw * ARMOUR_K / (armourFixed + ARMOUR_K))
 */
export function applyDamage(pkt: DamageSpec, def: Defenses): Fixed {
  let result: number;
  if (pkt.type === "fire") {
    const res = Math.min(def.fireResPct, RES_CAP);
    result = Math.trunc(pkt.amountFixed * (100 - res) / 100);
  } else {
    result = Math.trunc(pkt.amountFixed * ARMOUR_K / (def.armourFixed + ARMOUR_K));
  }
  return result < 0 ? 0 : result;
}
