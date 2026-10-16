/** One sample a second, so this is the window in seconds. */
export const GUARD_SAMPLES = 10;

/**
 * Below this median the preset steps down. 45, because a 60 Hz panel's
 * per-second readings jitter down to about 48, and a window at the bottom of
 * that band keeps its median above the floor.
 */
export const GUARD_FLOOR_FPS = 45;

/**
 * Says when Auto graphics should step down: once per instance (one per area),
 * after a full window whose median is under the floor. A median, so a few slow
 * seconds (a boss spawn, a big pull) do not cost the player a preset.
 */
export class FpsGuard {
  private samples: number[] = [];
  private fired = false;

  /** Feed one fps reading; true exactly once when the window is slow. */
  sample(fps: number): boolean {
    if (this.fired) return false;
    this.samples.push(fps);
    if (this.samples.length > GUARD_SAMPLES) this.samples.shift();
    if (this.samples.length < GUARD_SAMPLES) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    if (sorted[Math.floor(GUARD_SAMPLES / 2)]! >= GUARD_FLOOR_FPS) return false;
    this.fired = true;
    return true;
  }
}
