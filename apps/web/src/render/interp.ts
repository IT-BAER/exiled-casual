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
 * (shortest way round): eases in and settles without overshoot, at any frame rate,
 * never faster than `maxRate` rad/s.
 */
export function springAngle(angle: number, vel: number, target: number, omega: number, dt: number, maxRate = Infinity): { angle: number; vel: number } {
  const twoPi = Math.PI * 2;
  let x = (angle - target) % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  const decay = Math.exp(-omega * dt);
  const t = (vel + omega * x) * dt;
  const step = Math.max(-maxRate * dt, Math.min(maxRate * dt, (x + t) * decay - x));
  const v = Math.max(-maxRate, Math.min(maxRate, (vel - omega * t) * decay));
  return { angle: angle + step, vel: v };
}
