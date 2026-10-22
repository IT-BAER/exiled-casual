import { describe, expect, it } from "vitest";
import { EMBER_LIFE, EMBER_TOP, SPARKS, emberHeight, emberLife, flameParticleCount } from "./flames";

describe("flame embers", () => {
  it("rise monotonically and stay inside the envelope", () => {
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const y = emberHeight(i / 100);
      expect(y).toBeGreaterThanOrEqual(last);
      expect(y).toBeLessThanOrEqual(EMBER_TOP + 1e-9);
      last = y;
    }
  });

  it("are sparse at the coals, fullest in the flame body, gone above it", () => {
    const bands = [0, 0, 0, 0, 0, 0]; // 0.25-tall bands up to 1.5 flame heights
    for (const t of [0.3, 1.1, 2.9, 5.7, 8.3]) {
      for (let k = 0; k < SPARKS; k++) {
        const u = emberLife((k / SPARKS) * EMBER_LIFE, EMBER_LIFE, t);
        bands[Math.min(5, Math.floor(emberHeight(u) / 0.25))]!++;
      }
    }
    const peak = Math.max(...bands);
    const at = bands.indexOf(peak);
    expect(at).toBeGreaterThanOrEqual(1);
    expect(at).toBeLessThanOrEqual(3);
    expect(bands[1]!).toBeGreaterThan(bands[0]!);
    expect(bands[5]!).toBeLessThan(bands[3]!);
    expect(bands[5]!).toBeLessThan(peak * 0.5);
  });

  it("holds a small fixed pool per bowl, far under the old 300", () => {
    expect(SPARKS).toBeLessThanOrEqual(60);
    expect(flameParticleCount()).toBe(0);
  });
});
