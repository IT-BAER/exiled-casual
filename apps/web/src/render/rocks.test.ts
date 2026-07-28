import { describe, expect, it } from "vitest";
import { ROCK_SPACING, scatterRocks, type RockCell } from "./rocks";

/** A straight run of wall cells, at the mapgen cell size of 0.5 world units. */
function line(count: number, z = 0): RockCell[] {
  return Array.from({ length: count }, (_, i) => ({ x: i * 0.5, z }));
}

describe("scatterRocks", () => {
  it("never puts two rocks closer than the spacing", () => {
    const rocks = scatterRocks(line(200));
    expect(rocks.length).toBeGreaterThan(10);
    for (let i = 0; i < rocks.length; i++) {
      for (let j = i + 1; j < rocks.length; j++) {
        const dx = rocks[i]!.x - rocks[j]!.x;
        const dz = rocks[i]!.z - rocks[j]!.z;
        expect(Math.hypot(dx, dz), `${i} vs ${j}`).toBeGreaterThanOrEqual(ROCK_SPACING - 1e-9);
      }
    }
  });

  it("leaves no gap a rock cannot bridge, so the band never shows daylight", () => {
    // Consecutive centres along a straight wall must stay inside the narrowest
    // rock's own width, or the boulders stop overlapping and the void behind the
    // wall shows between them. This is what pins MIN_WIDTH to the spacing.
    const rocks = scatterRocks(line(400)).sort((a, b) => a.x - b.x);
    for (let i = 1; i < rocks.length; i++) {
      expect(rocks[i]!.x - rocks[i - 1]!.x, `gap after rock ${i - 1}`).toBeLessThan(1.35);
    }
  });

  it("is deterministic: the same wall scatters the same way on every reload", () => {
    expect(scatterRocks(line(120))).toEqual(scatterRocks(line(120)));
  });

  it("mixes the variants rather than tiling one boulder down the wall", () => {
    const rocks = scatterRocks(line(400));
    const used = new Set(rocks.map((r) => r.variant % 6));
    expect(used.size).toBe(6);
  });

  it("thins a dense cell band down to believable stone sizes", () => {
    // 400 cells is 200 units of wall and comes out ~212 rocks. Not 400, and not
    // the 333 that 200/0.6 suggests either: the cells are only 0.5 apart, so a
    // candidate one cell past an accepted rock is inside the spacing and gets
    // rejected, and the scatter settles at roughly one rock per two cells.
    const rocks = scatterRocks(line(400));
    expect(rocks.length).toBeLessThan(260);
    expect(rocks.length).toBeGreaterThan(170);
  });
});
