export const FLASK_MAX_CHARGES = 7;
export const FLASK_CHARGES_PER_KILL = 1;
export const FLASK_RECOVERY_PCT = 30;

/**
 * A boss is worth this many kills' worth of flask charges, paid out as its life
 * falls rather than when it dies.
 *
 * Charges come from kills, which makes a boss room the one place in the game
 * where flasks are dead weight: one kill, at the end, long after you needed the
 * mana. PoE's own answer is that you kill the boss's adds, and ours does summon
 * two — but only in phase 2, so the first half of every Warden fight is spent
 * dry. Treating a boss as ten monsters' worth of health, one charge per tenth it
 * loses, pays the flask for the same work a pack would have.
 */
export const FLASK_BOSS_CHARGE_STEPS = 10;

/**
 * How many charge steps a hit that took a boss from `before` to `after` crossed.
 * Pure integer arithmetic on Fixed life values, and stateless by construction —
 * the caller knows both sides of the hit, so nothing has to be accumulated on
 * the boss (and the golden replays' serialized state stays untouched).
 */
export function bossChargeSteps(before: number, after: number, maxLife: number): number {
  if (maxLife <= 0) return 0;
  // Clamped one below the count: at exactly full life the raw floor lands on a
  // band of its own, so the first scratch would pay a charge for nothing. Nine
  // payouts cross the bar, and death.ts pays the tenth for the kill itself.
  const step = (life: number) => Math.min(
    FLASK_BOSS_CHARGE_STEPS - 1,
    Math.floor((Math.max(0, life) * FLASK_BOSS_CHARGE_STEPS) / maxLife),
  );
  return Math.max(0, step(before) - step(after));
}

/** Recovery per use, floored so the result stays an integer Fixed. */
export function flaskRecovery(max: number): number {
  return Math.floor((max * FLASK_RECOVERY_PCT) / 100);
}
