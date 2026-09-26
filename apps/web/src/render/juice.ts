/**
 * Hit-stop and camera shake for a melee swing that connects. Render-side only:
 * the sim never pauses and never moves, the pose freezes and the camera jolts.
 *
 * Kept small (docs/09 rule 3, intensity beats density): Strike connects several
 * times a second all fight, so anything that reads as an earthquake from one
 * swing is a seasick camera by the second pack.
 */

/** Real ms the world holds still on one body connecting: three frames at 60 Hz. */
export const HIT_STOP_MS = 50;
/** Each extra body in the same swing holds it a little longer. */
const HIT_STOP_PER_HIT_MS = 12;
export const HIT_STOP_MAX_MS = 95;
/** Animation speed while held. Not zero: a dead-still frame reads as a hitch. */
export const HIT_STOP_SCALE = 0.04;

/** Trauma one connecting swing adds, and the extra per additional body. */
const TRAUMA_HIT = 0.32;
const TRAUMA_PER_EXTRA = 0.1;
/** Trauma lost per second: one pack's jolt is over in about a fifth of a second. */
const TRAUMA_DECAY = 3;
/** World units the camera target moves at full trauma. */
export const SHAKE_UNITS = 0.25;

export function hitStopMs(hits: number): number {
  if (hits <= 0) return 0;
  return Math.min(HIT_STOP_MAX_MS, HIT_STOP_MS + HIT_STOP_PER_HIT_MS * (hits - 1));
}

export function addTrauma(trauma: number, hits: number): number {
  if (hits <= 0) return trauma;
  return Math.min(1, trauma + TRAUMA_HIT + TRAUMA_PER_EXTRA * (hits - 1));
}

export function decayTrauma(trauma: number, seconds: number): number {
  return Math.max(0, trauma - TRAUMA_DECAY * seconds);
}

/**
 * Camera target offset at `ms`. Squared trauma, so one body barely nudges and a
 * pack thumps; summed sines, not a random step per frame, which buzzes.
 */
export function shakeOffset(trauma: number, ms: number): { x: number; z: number } {
  if (trauma <= 0) return { x: 0, z: 0 };
  const a = SHAKE_UNITS * trauma * trauma;
  const t = ms / 1000;
  return { x: a * Math.sin(t * 53), z: a * Math.sin(t * 41 + 1.3) };
}
