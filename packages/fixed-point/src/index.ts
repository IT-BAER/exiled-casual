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

// Deterministic integer square root via Newton's method (pure integer ops).
// Returns floor(sqrt(n)). NOT Math.sqrt — guaranteed identical across JS engines.
// Uses Math.floor(_/2), NOT >>1: `>>` truncates to 32 bits, and arena squared
// distances reach ~8e10 (dx,dy up to 200000 → dx²+dy² well above 2^31), which
// >>1 would corrupt. Math.floor keeps full 2^53 integer precision.
export function isqrt(n: number): number {
  if (n < 2) return n;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

// Squared distance between two Fixed points (in fixed² units, not Fixed).
// Safe to compare against radiusFixed² while coords stay within the arena.
export function fpDist2(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

// Integer step vector: moves speedFixed (Fixed) per tick from (ax,ay) toward (bx,by).
// Snaps exactly when remaining distance ≤ speed (no overshoot). Deterministic via isqrt.
export function fpStepToward(
  ax: Fixed,
  ay: Fixed,
  bx: Fixed,
  by: Fixed,
  speedFixed: Fixed,
): { dx: Fixed; dy: Fixed } {
  const dx = bx - ax;
  const dy = by - ay;
  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return { dx: 0, dy: 0 };
  const len = isqrt(d2);
  if (len <= speedFixed) return { dx, dy };
  return {
    dx: Math.trunc((dx * speedFixed) / len),
    dy: Math.trunc((dy * speedFixed) / len),
  };
}
