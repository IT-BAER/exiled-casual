export const FLASK_MAX_CHARGES = 7;
export const FLASK_CHARGES_PER_KILL = 1;
export const FLASK_RECOVERY_PCT = 30;

/** Recovery per use, floored so the result stays an integer Fixed. */
export function flaskRecovery(max: number): number {
  return Math.floor((max * FLASK_RECOVERY_PCT) / 100);
}
