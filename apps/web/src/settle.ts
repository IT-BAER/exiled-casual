/**
 * When the loading plate may come down: once frames arrive fast enough to play on.
 * A GPU compiles a shader it has never seen on its FIRST draw, after
 * `executeWhenReady`, so one painted frame is not ready: on a cold Intel Arc
 * cache the frames after it took 1-4 s each for fifteen seconds.
 */
export const SETTLE_FRAMES = 10;
/** Slower than 15 fps is a stall, not a frame rate. */
export const SETTLE_FRAME_MS = 66;
/** A GPU that never settles still gets its world after this long. */
export const SETTLE_CAP_MS = 15_000;

/** Call once per painted frame with its timestamp; true once settled. */
export function settleGate(start: number): (now: number) => boolean {
  let last = start;
  let fast = 0;
  return (now) => {
    fast = now - last < SETTLE_FRAME_MS ? fast + 1 : 0;
    last = now;
    return fast >= SETTLE_FRAMES || now - start >= SETTLE_CAP_MS;
  };
}

/**
 * When the warm-up copies may go: two readiness polls in a row that find every mesh
 * ready, so the frames between drew each of them. Held to the settle instead, the
 * copies kept plate frames slow until `SETTLE_CAP_MS`.
 */
export function warmDoneGate(): (ready: number, all: number) => boolean {
  let streak = 0;
  return (ready, all) => {
    streak = all > 0 && ready === all ? streak + 1 : 0;
    return streak >= 2;
  };
}
