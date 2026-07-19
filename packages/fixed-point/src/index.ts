// Fixed-point scaled-integer math for deterministic simulation.
// A Fixed value is an integer equal to (real * FP_SCALE).
// ponytail: FP_SCALE=1000 gives 3 decimal places; product magnitude must stay
// under 2^53, so keep any single operand's real value under ~9e6. Widen SCALE
// or move hot math to BigInt only if a real range demands it.
export const FP_SCALE = 1000;

export type Fixed = number;

export const fp = (n: number): Fixed => Math.round(n * FP_SCALE);
export const toNumber = (a: Fixed): number => a / FP_SCALE;

export const fpAdd = (a: Fixed, b: Fixed): Fixed => a + b;
export const fpSub = (a: Fixed, b: Fixed): Fixed => a - b;
export const fpMul = (a: Fixed, b: Fixed): Fixed => Math.trunc((a * b) / FP_SCALE);
export const fpDiv = (a: Fixed, b: Fixed): Fixed => Math.trunc((a * FP_SCALE) / b);

export const fpClamp = (v: Fixed, lo: Fixed, hi: Fixed): Fixed =>
  v < lo ? lo : v > hi ? hi : v;

export const fpAbs = (a: Fixed): Fixed => (a < 0 ? -a : a);

export const fpSign = (a: Fixed): -1 | 0 | 1 => (a < 0 ? -1 : a > 0 ? 1 : 0);
