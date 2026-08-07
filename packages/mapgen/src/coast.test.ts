import { describe, it, expect } from "vitest";
import { generateCoast, COAST_CELLS } from "./coast";
import { CELL_SIZE } from "./grid";

const V = "test.v1";
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7);

function crossRuns(cells: Uint8Array, x: number): number[] {
  const runs: number[] = [];
  let run = 0;
  for (let y = 0; y < COAST_CELLS; y++) {
    if (cells[y * COAST_CELLS + x] === 1) run++;
    else if (run > 0) { runs.push(run); run = 0; }
  }
  if (run > 0) runs.push(run);
  return runs;
}

describe("generateCoast", () => {
  it("passes every layout gate on every seed", () => {
    for (const seed of SEEDS) {
      const l = generateCoast(seed, V, 16);
      const failed = l.validationChecks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
      expect(`${seed} ${failed.join("; ")}`).toBe(`${seed} `);
      expect(l.usedFallback).toBe(false);
    }
  });

  it("is a beach and not a lane: the sand is wide open across", () => {
    // The whole reason this generator exists. A chunk-assembled route is ~8
    // units of floor between two walls; PoE's own overlay is open ground with
    // obstacles in it. 20 cells is 10 world units, and the camera shows 19
    // across — so at this width the player can never see both edges at once.
    for (const seed of SEEDS.slice(0, 8)) {
      const { grid } = generateCoast(seed, V, 16);
      const widths: number[] = [];
      for (let x = 0; x < COAST_CELLS; x++) {
        const runs = crossRuns(grid.cells, x);
        if (runs.length > 0) widths.push(runs.reduce((a, b) => a + b, 0));
      }
      widths.sort((a, b) => a - b);
      expect(widths[Math.floor(widths.length / 2)]).toBeGreaterThanOrEqual(28);
    }
  });

  it("puts the sea on ONE side, never around the map", () => {
    for (const seed of SEEDS) {
      const { grid } = generateCoast(seed, V, 16);
      const water = grid.water!;
      const n = COAST_CELLS;
      const share = [
        // top row, bottom row, left column, right column
        Array.from({ length: n }, (_, x) => water[x]!).filter(Boolean).length / n,
        Array.from({ length: n }, (_, x) => water[(n - 1) * n + x]!).filter(Boolean).length / n,
        Array.from({ length: n }, (_, y) => water[y * n]!).filter(Boolean).length / n,
        Array.from({ length: n }, (_, y) => water[y * n + n - 1]!).filter(Boolean).length / n,
      ];
      // One border is the open sea; the one facing it is the cliff, and must be
      // bone dry — a ring of water is the failure this whole mask exists to stop.
      const seaSide = share[0]! > share[1]! ? 0 : 1;
      expect(share[seaSide]).toBe(1);
      expect(share[1 - seaSide]).toBe(0);
    }
  });

  it("only lets the walkable floor into the water at the tide line", () => {
    // The player wades: floor runs a few cells past the waterline so a beach is
    // not fenced off from its own sea. What must never happen is floor out in
    // DEEP water, so the overlap is bounded per column rather than forbidden.
    for (const seed of SEEDS) {
      const { grid } = generateCoast(seed, V, 16);
      for (let x = 0; x < COAST_CELLS; x++) {
        let wet = 0;
        for (let y = 0; y < COAST_CELLS; y++) {
          const i = y * COAST_CELLS + x;
          if (grid.cells[i] === 1 && grid.water![i] === 1) wet++;
        }
        expect(wet, `seed ${seed} column ${x}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("runs the length of the shore: the boss is a walk away, not next door", () => {
    for (const seed of SEEDS) {
      const l = generateCoast(seed, V, 16);
      const start = l.objectiveAnchors.find((a) => a.id === "start")!;
      const boss = l.objectiveAnchors.find((a) => a.id === "boss")!;
      expect(Math.hypot(boss.x - start.x, boss.y - start.y)).toBeGreaterThan(
        COAST_CELLS * CELL_SIZE * 0.6,
      );
    }
  });

  it("puts the way out at the player's back, not between him and the map", () => {
    for (const seed of SEEDS) {
      const l = generateCoast(seed, V, 16);
      const start = l.objectiveAnchors.find((a) => a.id === "start")!;
      const boss = l.objectiveAnchors.find((a) => a.id === "boss")!;
      const exit = l.objectiveAnchors.find((a) => a.id === "exit")!;
      // Projection of the exit onto the walk the player is about to make. Negative
      // is behind him; the portal standing in the middle of the view he arrived
      // looking at is the thing this fixes.
      const bx = boss.x - start.x, by = boss.y - start.y;
      const len = Math.hypot(bx, by);
      const along = ((exit.x - start.x) * bx + (exit.y - start.y) * by) / len;
      expect(along, `seed ${seed}`).toBeLessThan(0);
    }
  });

  it("stands the way out in open sand, not against the end of the beach", () => {
    // A cell a body fits in is not a cell a PORTAL fits in. The first attempt at
    // "behind him" landed one cell inside the end margin, which is floor and
    // passes every walk gate, and the edge ledge leans over it: the doorway came
    // out half buried in rock. Clearance is what the eye reads, so pin clearance.
    const R = 4; // cells, so two world units of sand on every side
    for (const seed of SEEDS) {
      const l = generateCoast(seed, V, 16);
      const exit = l.objectiveAnchors.find((a) => a.id === "exit")!;
      const cx = Math.round((exit.x - l.grid.originX) / CELL_SIZE);
      const cy = Math.round((exit.y - l.grid.originY) / CELL_SIZE);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const i = (cy + dy) * COAST_CELLS + (cx + dx);
          expect(l.grid.cells[i], `seed ${seed} at ${dx},${dy}`).toBe(1);
        }
      }
    }
  });

  it("pays out along the way", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const l = generateCoast(seed, V, 16);
      expect(l.objectiveAnchors.filter((a) => a.id.startsWith("reward.")).length)
        .toBeGreaterThanOrEqual(4);
    }
  });

  it("is deterministic", () => {
    for (const seed of SEEDS.slice(0, 5))
      expect(generateCoast(seed, V, 16).hash).toBe(generateCoast(seed, V, 16).hash);
  });

  it("faces all four ways across seeds", () => {
    const seen = new Set(SEEDS.map((s) => generateCoast(s, V, 16).chosenVariantIds[0]));
    expect(seen.size).toBe(4);
  });
});
