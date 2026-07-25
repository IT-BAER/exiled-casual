import type { Fixed } from "@exiled/fixed-point";
import type { DamageSpec, Defenses } from "@exiled/content-schema";
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

/**
 * The share of a physical hit that armour actually stops, as an integer percent:
 * the complement of applyDamage's physical branch. PoE2's character sheet shows
 * armour this way (poe2-screenshots/character-stats.png reads "Armour 7%"), not
 * as the raw rating, so the sheet reads it from here rather than re-deriving a
 * curve that could drift from the one damage resolution uses.
 */
export function physicalMitigationPct(armourFixed: Fixed): number {
  if (armourFixed <= 0) return 0;
  return Math.round((100 * armourFixed) / (armourFixed + ARMOUR_K));
}
