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

/**
 * One exact step of a critically damped spring pulling `angle` toward `target`
 * (shortest way round): eases in and settles without overshoot, at any frame rate.
 */
export function springAngle(angle: number, vel: number, target: number, omega: number, dt: number): { angle: number; vel: number } {
  const twoPi = Math.PI * 2;
  let x = (angle - target) % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  const decay = Math.exp(-omega * dt);
  const t = (vel + omega * x) * dt;
  return { angle: angle - x + (x + t) * decay, vel: (vel - omega * t) * decay };
}
