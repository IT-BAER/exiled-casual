import { describe, it, expect } from "vitest";
import { FpsGuard, GUARD_SAMPLES } from "./fps-guard";

describe("FpsGuard", () => {
  it("fires once when a full window of samples sits under the floor", () => {
    const guard = new FpsGuard();
    const fired = Array.from({ length: GUARD_SAMPLES + 5 }, () => guard.sample(40));
    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired.indexOf(true)).toBe(GUARD_SAMPLES - 1);
  });

  it("ignores a few slow seconds inside a fast window", () => {
    const guard = new FpsGuard();
    const fired = Array.from({ length: GUARD_SAMPLES * 2 }, (_, i) => guard.sample(i % 4 === 0 ? 20 : 60));
    expect(fired.some(Boolean)).toBe(false);
  });

  it("ignores 60 Hz vsync jitter between 48 and 60", () => {
    const jitter = [51, 59, 54, 48, 57, 53, 60, 52, 55, 49];
    const guard = new FpsGuard();
    const fired = [...jitter, ...jitter, ...jitter].map((fps) => guard.sample(fps));
    expect(fired.some(Boolean)).toBe(false);

    const worst = new FpsGuard();
    const worstFired = Array.from({ length: GUARD_SAMPLES * 2 }, () => worst.sample(48));
    expect(worstFired.some(Boolean)).toBe(false);
  });

  it("fires once on a window between 10 and 37", () => {
    const cycle = [10, 37, 22, 15, 30, 18, 25, 12, 35, 20];
    const guard = new FpsGuard();
    const fired = Array.from({ length: GUARD_SAMPLES + 5 }, (_, i) => guard.sample(cycle[i % cycle.length]!));
    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired.indexOf(true)).toBe(GUARD_SAMPLES - 1);
  });
});
