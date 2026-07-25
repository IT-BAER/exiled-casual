import type { Fixed } from "@exiled/fixed-point";
import type { DamageSpec, Defenses } from "@exiled/content-schema";
import { RES_CAP, ARMOUR_DMG_MULT, PDR_CAP } from "./stats.js";

/**
 * Final damage after one resistance/mitigation channel. Deterministic integer
 * math. Never returns a negative value. Both channels reduce by an integer
 * percent: trunc(raw * (100 - pct) / 100).
 */
export function applyDamage(pkt: DamageSpec, def: Defenses): Fixed {
  const pct = pkt.type === "fire"
    ? Math.min(def.fireResPct, RES_CAP)
    : physicalMitigationPct(def.armourFixed, pkt.amountFixed);
  const result = Math.trunc(pkt.amountFixed * (100 - pct) / 100);
  return result < 0 ? 0 : result;
}

/**
 * The share of a physical hit that armour stops, as an integer percent. PoE2's
 * curve, DR = armour / (armour + 10 * hit), capped at PDR_CAP. The hit size is
 * an argument rather than a constant because armour has no single mitigation
 * value: the same rating stops ~60% of a Cinder Imp's swipe and ~24% of the
 * Warden's slam.
 *
 * PoE2's character sheet shows armour as one such percent
 * (poe2-screenshots/character-stats.png reads "Armour 7%", quoted against a
 * level-appropriate hit) rather than as the raw rating, so display reads it
 * from here and applyDamage resolves through it — one curve, no drift.
 */
export function physicalMitigationPct(armourFixed: Fixed, hitFixed: Fixed): number {
  if (armourFixed <= 0 || hitFixed <= 0) return 0;
  const pct = Math.round((100 * armourFixed) / (armourFixed + ARMOUR_DMG_MULT * hitFixed));
  return pct > PDR_CAP ? PDR_CAP : pct;
}
