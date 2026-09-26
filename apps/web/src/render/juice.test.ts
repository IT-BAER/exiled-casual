import { describe, it, expect } from "vitest";
import { HIT_STOP_MAX_MS, SHAKE_UNITS, addTrauma, decayTrauma, hitStopMs, shakeOffset } from "./juice";

describe("melee juice", () => {
  it("holds the world only for a swing that connected, longer for more bodies, never past the cap", () => {
    expect(hitStopMs(0)).toBe(0);
    expect(hitStopMs(1)).toBeGreaterThan(0);
    expect(hitStopMs(3)).toBeGreaterThan(hitStopMs(1));
    expect(hitStopMs(40)).toBe(HIT_STOP_MAX_MS);
    // Three frames at 60 Hz is the whole point: long enough to see, never a stall.
    expect(HIT_STOP_MAX_MS).toBeLessThanOrEqual(120);
  });

  it("adds trauma per swing and caps it, and a whiff adds none", () => {
    expect(addTrauma(0, 0)).toBe(0);
    const one = addTrauma(0, 1);
    expect(one).toBeGreaterThan(0);
    expect(addTrauma(0, 4)).toBeGreaterThan(one);
    expect(addTrauma(0.9, 10)).toBe(1);
  });

  it("decays trauma to rest and never below it", () => {
    expect(decayTrauma(0.5, 0.1)).toBeLessThan(0.5);
    expect(decayTrauma(0.1, 10)).toBe(0);
  });

  it("shakes nothing at rest, stays inside its amplitude, and moves when hurt", () => {
    expect(shakeOffset(0, 1234)).toEqual({ x: 0, z: 0 });
    let moved = 0;
    for (let ms = 0; ms < 500; ms += 7) {
      const o = shakeOffset(0.6, ms);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(SHAKE_UNITS * 0.36 + 1e-9);
      expect(Math.abs(o.z)).toBeLessThanOrEqual(SHAKE_UNITS * 0.36 + 1e-9);
      moved = Math.max(moved, Math.hypot(o.x, o.z));
    }
    expect(moved).toBeGreaterThan(0.01);
  });
});
