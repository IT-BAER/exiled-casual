/** Pure linear interpolation, clamped to [0,1]. */
export function lerp(a: number, b: number, alpha: number): number {
  const t = Math.max(0, Math.min(1, alpha));
  return a + (b - a) * t;
}

/** Shortest-path angular interpolation in radians (handles wrap at ±π). */
export function lerpAngle(a: number, b: number, alpha: number): number {
  const t = Math.max(0, Math.min(1, alpha));
  const twoPi = Math.PI * 2;
  let d = (b - a) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return a + d * t;
}
