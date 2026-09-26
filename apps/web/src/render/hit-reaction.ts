/**
 * The flinch every struck body gets: a lean away from the blow and a small
 * squash, a fast snap and an eased return, on the sim clock in ticks. It is a
 * pose on the root, so every species gets it and none needs a `hit` clip.
 */

/** ~170 ms at 30 Hz: over before the next swing, long enough to see. */
export const FLINCH_TICKS = 5;
/** Radians of lean at full strength, ~8 degrees. */
export const MAX_LEAN = 0.14;
/** Share of height lost at full strength (width grows by half of it). */
export const MAX_SQUASH = 0.08;
/** Where in the window the snap tops out; the rest is the return. */
const PEAK = 0.2;
/** Share of max life at which a hit flinches at full strength. */
const FULL_AT = 0.25;
/** Weakest flinch, so a chip hit still reads. */
const MIN_STRENGTH = 0.3;
/** A heavier body gives less: a boss that wobbles on every bolt reads as weightless. */
const TIER_DAMPING = { monster: 1, rare: 0.6, boss: 0.35 } as const;

export interface Flinch {
  start: number;
  /** The pose the hit interrupted, eased out over the window. */
  from: Pose;
  /** This hit's own peak lean (world x/z, radians) and squash. */
  kick: Pose;
}

/** Lean as a world-space vector (sim x -> world x, sim y -> world z), radians. */
export interface Pose {
  x: number;
  z: number;
  squash: number;
}

const smooth = (u: number) => u * u * (3 - 2 * u);

function shape(u: number): number {
  if (u >= 1) return 0;
  if (u < PEAK) return 1 - (1 - u / PEAK) ** 2;
  return 1 - smooth((u - PEAK) / (1 - PEAK));
}

export function flinchStrength(lost: number, maxLife: number, tier: keyof typeof TIER_DAMPING): number {
  const share = maxLife > 0 ? lost / maxLife : 0;
  return Math.min(1, Math.max(MIN_STRENGTH, share / FULL_AT)) * TIER_DAMPING[tier];
}

/** Start a flinch away along (awayX, awayZ), picking up whatever pose `prev` is in now. */
export function kick(prev: Flinch | undefined, now: number, awayX: number, awayZ: number, strength: number): Flinch {
  const len = Math.hypot(awayX, awayZ) || 1;
  const lean = MAX_LEAN * strength;
  return {
    start: now,
    from: prev ? flinchPose(prev, now) : { x: 0, z: 0, squash: 0 },
    kick: { x: (awayX / len) * lean, z: (awayZ / len) * lean, squash: MAX_SQUASH * strength },
  };
}

export function flinchPose(f: Flinch, now: number): Pose {
  const u = Math.max(0, (now - f.start) / FLINCH_TICKS);
  const s = shape(u);
  const d = u >= 1 ? 0 : 1 - smooth(u);
  let x = f.from.x * d + f.kick.x * s;
  let z = f.from.z * d + f.kick.z * s;
  // Hits stacked faster than the window cannot fold the body over.
  const len = Math.hypot(x, z);
  if (len > MAX_LEAN) {
    x *= MAX_LEAN / len;
    z *= MAX_LEAN / len;
  }
  return { x, z, squash: Math.min(MAX_SQUASH, f.from.squash * d + f.kick.squash * s) };
}

/** A world-space lean as the root's local pitch and roll, for a body facing `yaw`. */
export function leanToTilt(yaw: number, x: number, z: number): { pitch: number; roll: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { pitch: x * sin + z * cos, roll: -(x * cos - z * sin) };
}
