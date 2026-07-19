import type { Fixed } from "@pact/fixed-point";

export interface AilmentState {
  kind: "burning";
  stacks: number;
  dpsFixed: Fixed;
  expiryTick: number;
}

/** Ticks between DoT applications (5 applications per second at 30 Hz). */
export const AILMENT_TICK_INTERVAL = 6;

/**
 * Add one burning application. Stacks are capped at maxStacks and expiry
 * is always refreshed to nowTick + durationTicks. Returns a NEW object.
 */
export function refreshBurning(
  prev: AilmentState | undefined,
  addStacks: number,
  dpsFixed: Fixed,
  nowTick: number,
  durationTicks: number,
  maxStacks: number,
): AilmentState {
  const stacks = Math.min((prev?.stacks ?? 0) + addStacks, maxStacks);
  return { kind: "burning", stacks, dpsFixed, expiryTick: nowTick + durationTicks };
}

/**
 * Damage dealt by one DoT tick (every AILMENT_TICK_INTERVAL ticks).
 * = trunc(stacks * dpsFixed * AILMENT_TICK_INTERVAL / 30)
 */
export function burningTickDamage(a: AilmentState): Fixed {
  return Math.trunc(a.stacks * a.dpsFixed * AILMENT_TICK_INTERVAL / 30);
}
