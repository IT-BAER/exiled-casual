import type { SnapshotEntity } from "@exiled/protocol";

/** A brood mark's ability id (Mother Vhal's kit): it hurts nobody, so it never wears the danger palette. */
export const BROOD_ABILITY = "brood";

/** A mark this close to its impact when last seen landed; the sim drops it on the impact tick. */
const LANDED_WITHIN = 0.1;

/**
 * Whether a telegraph that left the snapshot landed. The sim drops one at its
 * impact tick, or earlier when its owner dies mid-wind-up, and only the first is
 * a hit worth an impact. No `impactIn` (an older snapshot) counts as landed.
 */
export function landed(e: SnapshotEntity): boolean {
  return (e.impactIn ?? 0) <= LANDED_WITHIN;
}

/** The danger glow's pulse rate far from the blow and on it (Hz), and the seconds it quickens over. */
const PULSE_FAR_HZ = 2;
const PULSE_NEAR_HZ = 6;
const PULSE_RAMP_S = 1;
/** A pulse's trough as a share of its crest: a beat, never a blink. */
const PULSE_TROUGH = 0.55;
/** Share of the wind-up the glow fades in over, so it never pops on. */
const GLOW_FADE_IN = 0.15;

/**
 * How red a boss glows through a heavy wind-up (PoE2's tell for a hit that must be
 * dodged), 0..1, from its telegraph's progress and the seconds `left` until it lands.
 * The pulse quickens toward the blow and crests on it.
 */
export function dangerGlow(progress: number, left: number): number {
  const near = Math.min(Math.max(0, left), PULSE_RAMP_S);
  const quicken = (PULSE_NEAR_HZ - PULSE_FAR_HZ) / PULSE_RAMP_S;
  // Pulses still to come: the rate climbs linearly over the ramp, steady before it.
  const cycles = PULSE_NEAR_HZ * near - (quicken * near * near) / 2 + PULSE_FAR_HZ * Math.max(0, left - PULSE_RAMP_S);
  const pulse = PULSE_TROUGH + (1 - PULSE_TROUGH) * (0.5 + 0.5 * Math.cos(2 * Math.PI * cycles));
  return Math.min(1, progress / GLOW_FADE_IN) * pulse;
}
