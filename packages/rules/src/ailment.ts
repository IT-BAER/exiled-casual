import type { Fixed } from "@exiled/fixed-point";

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

/**
 * One-instance damaging ailments a monster's hit leaves on the player: dps is a share of the hit before mitigation.
 * PoE2's single-instance rule, but far above its 20%/2s and 15%/5s: the casual passes shrank monster hits to
 * fractions of a point, and at PoE2's numbers both dealt 3-7% of what kills a pack's target (`balance.test.ts`).
 */
export const SINGLE_AILMENTS = {
  poison: { dpsPct: 50, durationTicks: 150, from: ["physical", "chaos"] },
  // Flat: PoE2's bleed hurts more while moving; this one does not.
  bleeding: { dpsPct: 60, durationTicks: 210, from: ["physical"] },
} as const;
export type SingleAilmentKind = keyof typeof SINGLE_AILMENTS;

export interface SingleAilment {
  dpsFixed: Fixed;
  expiryTick: number;
}

/**
 * The instance after a hit of `hitType` lands. A type that cannot carry the
 * ailment, or a weaker hit, returns `prev` itself; stronger or equal replaces and refreshes.
 */
export function applySingleAilment(
  kind: SingleAilmentKind,
  prev: SingleAilment | undefined,
  hitAmountFixed: Fixed,
  hitType: string,
  nowTick: number,
): SingleAilment | undefined {
  const spec = SINGLE_AILMENTS[kind];
  if (!(spec.from as readonly string[]).includes(hitType)) return prev;
  const dpsFixed = Math.trunc(hitAmountFixed * spec.dpsPct / 100);
  if (prev && dpsFixed < prev.dpsFixed) return prev;
  return { dpsFixed, expiryTick: nowTick + spec.durationTicks };
}

/** Damage of one tick of a single-instance DoT: trunc(dpsFixed * AILMENT_TICK_INTERVAL / 30). */
export function dotTickDamage(dpsFixed: Fixed): Fixed {
  return Math.trunc(dpsFixed * AILMENT_TICK_INTERVAL / 30);
}
