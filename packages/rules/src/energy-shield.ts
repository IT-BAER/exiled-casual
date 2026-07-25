import type { Fixed } from "@exiled/fixed-point";

/**
 * Energy shield, on PoE2's numbers (poe2wiki.net/wiki/Energy_Shield): a second
 * pool in front of life that takes a hit first, stops recharging for four
 * seconds every time it is hit, and then refills at 12.5% of its maximum a
 * second — eight seconds from empty to full.
 *
 * That shape is the whole point of the stat and the reason it is not just more
 * life: life is permanent until a flask pays for it, energy shield is free but
 * only if you can stop being hit for four seconds. PoE1's is the same mechanic
 * with different constants; the PoE2 pair is the one taken here.
 */
export const ES_RECHARGE_DELAY_TICKS = 120; // 4s at 30 Hz
export const ES_RECHARGE_PCT_PER_SEC = 125; // per-mille, i.e. 12.5%

/**
 * Chaos removes twice as much energy shield as it does life — PoE2's rule, and
 * the one thing that stops a big shield from answering every element at once.
 * (PoE1 instead lets chaos bypass the shield entirely; PoE2's double drain is
 * the softer version and the one that fits a single damage packet per hit.)
 */
export const ES_CHAOS_MULT = 2;

/** Per-tick recharge, truncated to an integer Fixed so it stays replay-safe. */
export function esRechargePerTick(maxEsFixed: Fixed): Fixed {
  return Math.trunc((maxEsFixed * ES_RECHARGE_PCT_PER_SEC) / 1000 / 30);
}

/**
 * Split one incoming hit across the shield and the life behind it. `esCost` is
 * what the shield actually loses, which is twice `absorbed` for chaos: the
 * shield pays double but only stops the single amount.
 */
export function absorbWithEnergyShield(
  amountFixed: Fixed,
  esFixed: Fixed,
  isChaos: boolean,
): { toLife: Fixed; esCost: Fixed } {
  if (esFixed <= 0 || amountFixed <= 0) return { toLife: Math.max(0, amountFixed), esCost: 0 };
  const mult = isChaos ? ES_CHAOS_MULT : 1;
  // How much of the hit this shield can actually stop, given what each point costs.
  const stoppable = Math.trunc(esFixed / mult);
  const absorbed = Math.min(amountFixed, stoppable);
  return { toLife: amountFixed - absorbed, esCost: Math.min(esFixed, absorbed * mult) };
}
