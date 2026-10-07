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
});
