/** Pure linear interpolation, clamped to [0,1]. */
export function lerp(a: number, b: number, alpha: number): number {
  const t = Math.max(0, Math.min(1, alpha));
  return a + (b - a) * t;
}
