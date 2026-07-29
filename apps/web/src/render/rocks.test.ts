import { describe, expect, it } from "vitest";
import {
  ROCK_SPACING, scatterDebris, scatterRampart, scatterRocks, type RockCell,
} from "./rocks";

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

describe("boulders line up with the face the sim collides against", () => {
  /** A wall run along z=0 with the room to the south (+z), so out is -z. */
  const wall = (count: number, normals: boolean): RockCell[] =>
    Array.from({ length: count }, (_, i) => ({
      x: i * 0.5, z: 0, ...(normals ? { nx: 0, nz: -1 } : {}),
    }));

  /** Deepest reach of any rock into the room, measured at its own half-width. */
  const deepest = (cells: RockCell[]): number =>
    Math.max(...scatterRocks(cells, 0.5).map((r) => r.z + r.width / 2));

  it("a rock on a cell with a known outward normal stops at the cell face", () => {
    // The cell's inner face is at z = +0.25 and that is exactly where collision
    // stops a body. Jitter is the only thing allowed past it (±0.096 — see JITTER).
    expect(deepest(wall(200, true))).toBeLessThan(0.25 + 0.1);
  });

  it("without a normal it still bulges — the pillar case, documented not fixed", () => {
    // Centred on a 0.5-unit cell, a 1.35-1.95 rock reaches 0.42-0.72 past the face.
    expect(deepest(wall(200, false))).toBeGreaterThan(0.6);
  });

  it("the offset does not open the band up: gaps along the run are unchanged", () => {
    const rocks = scatterRocks(wall(400, true), 0.5).sort((a, b) => a.x - b.x);
    for (let i = 1; i < rocks.length; i++) {
      expect(rocks[i]!.x - rocks[i - 1]!.x, `gap after rock ${i - 1}`).toBeLessThan(1.35);
    }
  });
});

describe("scatterDebris", () => {
  /** A patch of open floor, `n` x `n` cells at the mapgen cell size. */
  function field(n: number): RockCell[] {
    const out: RockCell[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push({ x: x * 0.5, z: y * 0.5 });
    return out;
  }

  it("stays sparse: debris dresses the floor, it does not pave it", () => {
    // 40x40 cells is 20x20 units. At 2.1 spacing that is room for on the order of
    // a hundred pebbles, not sixteen hundred — dense debris is a gravel pit, and
    // it would also cost more matrices than the boulders do.
    const bits = scatterDebris(field(40));
    expect(bits.length).toBeGreaterThan(30);
    expect(bits.length).toBeLessThan(140);
  });

  it("keeps every piece small enough to walk over", () => {
    // The floor is walkable and debris is decoration with no collision, so a
    // piece the player visibly wades through is a bug the sim cannot see.
    for (const b of scatterDebris(field(30))) {
      expect(b.width).toBeLessThanOrEqual(0.42);
      expect(b.height).toBeLessThan(0.3);
    }
  });

  it("sinks each piece into the ground rather than resting it on top", () => {
    for (const b of scatterDebris(field(20))) expect(b.y).toBeLessThan(0);
  });

  it("is deterministic, like the boulders", () => {
    expect(scatterDebris(field(20))).toEqual(scatterDebris(field(20)));
  });
});

describe("scatterRampart", () => {
  it("clears the boulder height cap, which is the whole reason it exists", () => {
    // Boulders are capped at the character's head (MAX_WIDTH * MAX_ASPECT = 1.52)
    // because he walks behind them. Nothing is behind the map's outer ring, and a
    // rock no taller than a boulder cannot hide the void the ground plate ends in.
    const edge = Array.from({ length: 60 }, (_, i) => ({ x: i * 0.5, z: 0 }));
    const heights = scatterRampart(edge).map((p) => p.height);
    expect(heights.length).toBeGreaterThan(10);
    expect(Math.min(...heights)).toBeGreaterThan(1.52);
  });

  it("is deterministic, like the boulders", () => {
    const edge = Array.from({ length: 40 }, (_, i) => ({ x: i * 0.5, z: 0 }));
    expect(scatterRampart(edge)).toEqual(scatterRampart(edge));
  });
});
