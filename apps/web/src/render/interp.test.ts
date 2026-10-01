import { describe, it, expect } from "vitest";
import { lerp, springAngle } from "./interp";

describe("lerp", () => {
  it("midpoint", () => expect(lerp(0, 10, 0.5)).toBe(5));
  it("alpha 0 returns a", () => expect(lerp(3, 7, 0)).toBe(3));
  it("alpha 1 returns b", () => expect(lerp(3, 7, 1)).toBe(7));
  it("clamps below 0", () => expect(lerp(0, 10, -0.5)).toBe(0));
  it("clamps above 1", () => expect(lerp(0, 10, 1.5)).toBe(10));
});

describe("springAngle", () => {
  const run = (hz: number, seconds: number, from: number, to: number) => {
    let s = { angle: from, vel: 0 };
    for (let i = 0; i < Math.round(hz * seconds); i++) s = springAngle(s.angle, s.vel, to, 25, 1 / hz);
    return s;
  };
  it("turns the same at 60 Hz and 165 Hz", () => {
    expect(run(60, 0.2, 0, 2).angle).toBeCloseTo(run(165, 0.2, 0, 2).angle, 6);
  });
  it("eases in: the first frame moves less than a plain 25% step", () => {
    expect(run(60, 1 / 60, 0, 2).angle).toBeLessThan(0.5);
  });
  it("settles on the target without overshoot", () => {
    const path = Array.from({ length: 60 }, (_, i) => run(60, (i + 1) / 60, 0, 2).angle);
    expect(Math.max(...path)).toBeLessThanOrEqual(2);
    expect(path.at(-1)).toBeCloseTo(2, 3);
  });
  it("never turns faster than its rate cap, at any frame rate", () => {
    for (const hz of [60, 165]) {
      let s = { angle: 0, vel: 0 };
      for (let i = 0; i < hz; i++) {
        const was = s.angle;
        s = springAngle(s.angle, s.vel, Math.PI - 0.01, 25, 1 / hz, 12);
        expect(Math.abs(s.angle - was)).toBeLessThanOrEqual(12 / hz + 1e-9);
      }
      expect(s.angle).toBeCloseTo(Math.PI - 0.01, 2);
    }
  });
  it("takes the short way across the +-PI seam", () => {
    expect(run(60, 0.05, 3, -3).angle).toBeGreaterThan(3);
  });
});
