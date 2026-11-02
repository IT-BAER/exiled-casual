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
 * PoE2's single-instance rule and durations (2s, 5s), but above its 20% and 15%: the casual passes shrank monster
 * hits to fractions of a point. Longer durations kept one on the player for most of a fight (`balance.test.ts`).
 */
export const SINGLE_AILMENTS = {
  poison: { dpsPct: 50, durationTicks: 60, from: ["physical", "chaos"] },
  // Flat: PoE2's bleed hurts more while moving; this one does not.
  bleeding: { dpsPct: 40, durationTicks: 150, from: ["physical"] },
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

/**
 * PoE2's freeze: cold hit damage builds toward a threshold, and a full meter freezes.
 * PoE2 does not publish how buildup scales, so this is a casual choice: cold damage
 * worth FREEZE_LIFE_PCT of the monster's max life freezes it, over any number of hits.
 */
export const FREEZE_LIFE_PCT = 30;
/** Frozen for 4 s (PoE2): cannot move or act. */
export const FREEZE_TICKS = 120;
/** A buildup with no cold hit for 2 s starts over (PoE2's meter drains). */
export const FREEZE_DECAY_TICKS = 60;

/** Buildup percent (0..100) after a cold hit of `coldFixed` on a body of `maxLifeFixed`. */
export function freezeBuildup(prevPct: number, coldFixed: Fixed, maxLifeFixed: Fixed): number {
  if (maxLifeFixed <= 0) return prevPct;
  // Rounded up, so three hits of exactly a third fill the meter.
  return Math.min(100, prevPct + Math.ceil((coldFixed * 100 * 100) / (maxLifeFixed * FREEZE_LIFE_PCT)));
}

/** `freezeBuildup` with the drain: a buildup last hit more than FREEZE_DECAY_TICKS ago counts from 0. */
export function freezeBuildupAt(prev: { pct: number; tick: number } | undefined, coldFixed: Fixed, maxLifeFixed: Fixed, tick: number): number {
  const live = prev && tick - prev.tick <= FREEZE_DECAY_TICKS ? prev.pct : 0;
  return freezeBuildup(live, coldFixed, maxLifeFixed);
}

/**
 * PoE2's shock chance is 25% per 100% of the ailment threshold a lightning hit deals;
 * casual: certain at SHOCK_LIFE_PCT of max life, proportional below.
 */
export const SHOCK_LIFE_PCT = 40;
/** 20% increased damage taken (PoE2), for 8 s on a monster. */
export const SHOCK_DAMAGE_TAKEN_PCT = 20;
export const SHOCK_TICKS = 240;

export function shockChancePct(lightningFixed: Fixed, maxLifeFixed: Fixed): number {
  if (maxLifeFixed <= 0 || lightningFixed <= 0) return 0;
  return Math.min(100, Math.trunc((lightningFixed * 100 * 100) / (maxLifeFixed * SHOCK_LIFE_PCT)));
}
