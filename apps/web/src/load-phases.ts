/**
 * Where a game load's seconds go, measured once per game entry.
 *
 * Each phase is a User Timing measure named `ec:load:<phase>`, so a driven
 * browser reads the same numbers the DevTools performance panel shows, and the
 * owner's report callback receives them as whole milliseconds:
 *
 * - `chunk`: the click that entered the game -> GameView mounted. Its JS arriving and running.
 * - `models`: mount -> the rig, props, rocks and monsters loaded (download and parse).
 * - `worker`: mount -> the sim worker's first area (its script, its boot, the save restore).
 * - `shaders`: models and area both in -> frames at a playable pace (`settle.ts`). Nothing is
 *   downloading for the first frame any more; this is materials becoming ready (shader
 *   compiles, textures) and the GPU's first-draw compiles settling.
 * - `frame`: the click -> the plate lifts. The whole wait the player sees.
 *
 * `models` and `worker` run side by side, so the phases do not add up to `frame`.
 * The names are telemetry's (`loadPhase` events), so the two cannot drift.
 */
import type { LoadPhase } from "@exiled/telemetry";

export type { LoadPhase };

let enteredAt: number | null = null;

/** The game screen was chosen. App calls this; without it the clock starts at mount. */
export function markGameEntry(at: number = performance.now()): void {
  enteredAt = at;
}

export interface LoadClock {
  models(now: number): void;
  worker(now: number): void;
  settled(now: number): void;
}

/** One per GameView mount. Each phase reports once; later calls are ignored. */
export function createLoadClock(mountedAt: number, report: (phase: LoadPhase, ms: number) => void = () => {}): LoadClock {
  const entry = enteredAt !== null && enteredAt <= mountedAt ? enteredAt : mountedAt;
  const at: Partial<Record<LoadPhase, number>> = {};
  const measure = (phase: LoadPhase, start: number, end: number): void => {
    if (at[phase] !== undefined) return;
    at[phase] = end;
    try {
      performance.measure(`ec:load:${phase}`, { start, end });
    } catch {
      /* a browser without User Timing L3 still reports */
    }
    report(phase, Math.max(0, Math.round(end - start)));
  };
  measure("chunk", entry, mountedAt);
  return {
    models: (now) => measure("models", mountedAt, now),
    worker: (now) => measure("worker", mountedAt, now),
    settled: (now) => {
      measure("shaders", Math.min(now, Math.max(at.models ?? mountedAt, at.worker ?? mountedAt)), now);
      measure("frame", entry, now);
    },
  };
}
