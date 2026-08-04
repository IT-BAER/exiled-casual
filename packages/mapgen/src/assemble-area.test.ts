import { describe, it, expect } from "vitest";
import { ASSEMBLED_CELLS, assembleArea } from "./assemble-area";
import { LOOP_GRAMMAR } from "./loop-grammar";
import { STRAND_GRAMMAR } from "./strand-grammar";
import { SPAWN_TARGET } from "./grid";
import { AREA_TILES } from "./skeleton";

const V = "content.test.v1";
const gen = (seed: number) => assembleArea(seed, V, LOOP_GRAMMAR);

describe("assembleArea", () => {
  it("is deterministic: same seed produces an identical grid and hash", () => {
    const a = gen(1234), b = gen(1234);
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.grid.cells)).toEqual(Array.from(b.grid.cells));
    expect(a.objectiveAnchors).toEqual(b.objectiveAnchors);
    expect(a.spawnSockets).toEqual(b.spawnSockets);
    expect(a.chosenVariantIds).toEqual(b.chosenVariantIds);
  });

  it("produces a 144x144 grid, 72 world units across", () => {
    const { grid } = gen(7);
    expect(ASSEMBLED_CELLS).toBe(144);
    expect(grid.cols).toBe(144);
    expect(grid.rows).toBe(144);
    expect(grid.cols * grid.cellSize).toBe(72);
  });

  it("never returns an invalid layout: 200 seeds all pass every gate", () => {
    for (let seed = 0; seed < 200; seed++) {
      const layout = gen(seed);
      expect(layout.validationChecks.every((c) => c.passed), `seed ${seed}`).toBe(true);
    }
  });

  it("assembles rather than falling back for the overwhelming majority of seeds", () => {
    let assembled = 0;
    for (let seed = 0; seed < 200; seed++) if (!gen(seed).usedFallback) assembled++;
    expect(assembled).toBeGreaterThan(190);
  });

  it("has no wall facing floor across any tile seam", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { grid, usedFallback } = gen(seed);
      if (usedFallback) continue;
      const at = (x: number, y: number) => grid.cells[y * grid.cols + x]!;
      for (let tx = 1; tx < AREA_TILES; tx++) {
        const x = tx * 16;
        for (let y = 0; y < grid.rows; y++) {
          expect(at(x - 1, y), `seed ${seed}: vertical seam at ${x},${y}`).toBe(at(x, y));
        }
      }
      for (let ty = 1; ty < AREA_TILES; ty++) {
        const y = ty * 16;
        for (let x = 0; x < grid.cols; x++) {
          expect(at(x, y - 1), `seed ${seed}: horizontal seam at ${x},${y}`).toBe(at(x, y));
        }
      }
    }
  });

  it("walls the whole outer boundary", () => {
    for (const seed of [0, 5, 42, 99, 777]) {
      const { grid } = gen(seed);
      const { cols, rows, cells } = grid;
      for (let x = 0; x < cols; x++) {
        expect(cells[x], `seed ${seed} top ${x}`).toBe(0);
        expect(cells[(rows - 1) * cols + x], `seed ${seed} bottom ${x}`).toBe(0);
      }
      for (let y = 0; y < rows; y++) {
        expect(cells[y * cols], `seed ${seed} left ${y}`).toBe(0);
        expect(cells[y * cols + cols - 1], `seed ${seed} right ${y}`).toBe(0);
      }
    }
  });

  it("stands the player somewhere a body fits, not against a pillar", () => {
    // The start is the one anchor the generator DERIVES rather than reads off an
    // authored marker, and the cell nearest a tile's centre is regularly the one
    // beside its centre block. A player who portals in with a wall inside their
    // own radius cannot move in any direction: collision refuses every step.
    for (let seed = 0; seed < 60; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const { grid } = layout;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      const cx = Math.round((start.x - grid.originX) / grid.cellSize);
      const cy = Math.round((start.y - grid.originY) / grid.cellSize);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(
            grid.cells[(cy + dy) * grid.cols + (cx + dx)],
            `seed ${seed}: wall at ${dx},${dy} of the start cell`,
          ).toBe(1);
        }
      }
    }
  });

  it("always has start, boss and exit anchors", () => {
    for (const seed of [0, 5, 42, 99, 777]) {
      const ids = gen(seed).objectiveAnchors.map((a) => a.id);
      expect(ids).toContain("start");
      expect(ids).toContain("boss");
      expect(ids).toContain("exit");
    }
  });

  it("keeps spawns clear of the start so the player gets a safe entry beat", () => {
    const SAFE = 10;
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      for (const sp of layout.spawnSockets) {
        const d = Math.hypot(sp.x - start.x, sp.y - start.y);
        expect(d, `seed ${seed} spawn ${sp.id} at ${d.toFixed(1)}`).toBeGreaterThanOrEqual(SAFE);
      }
    }
  });

  it("spends the spawn budget", () => {
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      expect(layout.spawnSockets.length, `seed ${seed}`).toBe(SPAWN_TARGET);
    }
  });

  it("puts a reward at the end of every dead-end spur", () => {
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const rewards = layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."));
      // Every spur pays; a chunk with a walled pocket pays on top of that.
      expect(rewards.length, `seed ${seed}`).toBeGreaterThanOrEqual(LOOP_GRAMMAR.branchCount);
    }
  });

  it("keeps every reward out of the safe wedge around the entrance", () => {
    const SAFE = 10;
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      for (const r of layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."))) {
        const d = Math.hypot(r.x - start.x, r.y - start.y);
        expect(d, `seed ${seed} ${r.id} at ${d.toFixed(1)}`).toBeGreaterThanOrEqual(SAFE);
      }
    }
  });

  it("pays out the walled pockets along the route, not only the dead ends", () => {
    // A reward marker off a spur is a pocket the player had to leave the route
    // to find. If chunk authoring ever loses them the count collapses to exactly
    // branchCount on every seed, which is what this catches.
    let withSecrets = 0;
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const rewards = layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."));
      if (rewards.length > LOOP_GRAMMAR.branchCount) withSecrets++;
    }
    expect(withSecrets, "no seed in 50 hid a reward off the route").toBeGreaterThan(10);
  });

  it("records the chunk and orientation of every stamped tile", () => {
    const layout = gen(3);
    expect(layout.usedFallback).toBe(false);
    expect(layout.chosenVariantIds.length).toBeGreaterThan(8);
    for (const id of layout.chosenVariantIds) {
      expect(id, `malformed proof id ${id}`).toMatch(/^\d,\d:[a-z.]+@[0-3]m?$/);
    }
    expect(layout.chosenVariantIds.some((id) => id.includes("loop.boss.hall"))).toBe(true);
  });

  it("re-arranges the same vocabulary: different seeds, different assemblies", () => {
    const proofs = new Set<string>();
    for (let seed = 0; seed < 20; seed++) proofs.add(gen(seed).chosenVariantIds.join("|"));
    expect(proofs.size).toBeGreaterThan(15);
  });
});

/**
 * The strand draws the field's chunks on a ribbon instead of a loop, so the only
 * thing that can break is the seam between the two: every gate the loop passes
 * has to pass on a route that never closes.
 */
describe("assembleArea, strand", () => {
  const strand = (seed: number) => assembleArea(seed, V, STRAND_GRAMMAR);

  it("never returns an invalid layout: 200 seeds all pass every gate", () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(strand(seed).validationChecks.every((c) => c.passed), `seed ${seed}`).toBe(true);
    }
  });

  it("assembles rather than falling back for the overwhelming majority of seeds", () => {
    let assembled = 0;
    for (let seed = 0; seed < 200; seed++) if (!strand(seed).usedFallback) assembled++;
    expect(assembled).toBeGreaterThan(190);
  });

  // No seam test here, unlike the loop's: `organicRim` carves the boundary after
  // the chunks are stamped, so a wall facing floor across a tile seam is what an
  // eroded edge IS. open-field breaks that same rule 5406 times in 50 seeds.

  it("stands the player somewhere a body fits", () => {
    for (let seed = 0; seed < 60; seed++) {
      const layout = strand(seed);
      if (layout.usedFallback) continue;
      const { grid } = layout;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      const cx = Math.round((start.x - grid.originX) / grid.cellSize);
      const cy = Math.round((start.y - grid.originY) / grid.cellSize);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(grid.cells[(cy + dy) * grid.cols + (cx + dx)],
            `seed ${seed}: wall at ${dx},${dy} of the start cell`).toBe(1);
        }
      }
    }
  });

  it("walks the player the length of the shore to reach the boss", () => {
    // The point of the ribbon. On the loop the boss sits across a ring the
    // player can reach either way around; here it is at the far end, so the
    // straight-line distance from the door is most of the map's own width.
    let worst = Infinity;
    for (let seed = 0; seed < 50; seed++) {
      const layout = strand(seed);
      if (layout.usedFallback) continue;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      const boss = layout.objectiveAnchors.find((a) => a.id === "boss")!;
      worst = Math.min(worst, Math.hypot(boss.x - start.x, boss.y - start.y));
    }
    // The area is 72 units across; half of that as the crow flies is a walk.
    expect(worst).toBeGreaterThan(36);
  });
});
