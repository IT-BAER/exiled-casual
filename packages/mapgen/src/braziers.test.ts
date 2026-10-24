import { describe, it, expect } from "vitest";
import { generateArea, type GrammarId } from "./mapgen";
import { brazierSpotsFor, BRAZIER_RADIUS } from "./braziers";

describe("brazierSpotsFor", () => {
  it("never stands a bowl where it would pin the arriving player", () => {
    // Body 0.5 + bowl: a start inside that reach cannot take a single step.
    for (const g of ["loop", "open-field", "sunken-ruins", "coast"] as GrammarId[]) {
      for (let seed = 0; seed < 60; seed++) {
        const layout = generateArea(seed, "v", g);
        const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
        for (const s of brazierSpotsFor(layout)) {
          expect(Math.hypot(s.x - start.x, s.z - start.y), `${g} seed ${seed}`).toBeGreaterThan(0.5 + BRAZIER_RADIUS);
        }
      }
    }
  }, 30_000);

  it("leaves a body's width between a bowl and every rock in front of its wall", () => {
    // A 0.5 body is 1 wide; a rock a cell off the lane's diagonal shut the way past the bowl.
    for (const g of ["loop", "open-field", "sunken-ruins", "coast"] as GrammarId[]) {
      for (let seed = 0; seed < 60; seed++) {
        const { cols, rows, cellSize, originX, originY, cells } = generateArea(seed, "v", g).grid;
        const wall = (x: number, y: number) => x < 0 || y < 0 || x >= cols || y >= rows || cells[y * cols + x] !== 1;
        for (const s of brazierSpotsFor(generateArea(seed, "v", g))) {
          const fx = (s.x - originX) / cellSize, fy = (s.z - originY) / cellSize;
          const [nx, ny] = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([dx, dy]) => Number.isInteger(fx + dx * 1.5) && Number.isInteger(fy + dy * 1.5) && wall(fx + dx * 1.5, fy + dy * 1.5))!;
          for (let y = Math.floor(fy) - 6; y <= Math.ceil(fy) + 6; y++) {
            for (let x = Math.floor(fx) - 6; x <= Math.ceil(fx) + 6; x++) {
              // The wall the bowl backs onto starts 1.5 cells along its normal.
              if (!wall(x, y) || (x - fx) * nx + (y - fy) * ny >= 1.5) continue;
              const gx = Math.max(0, Math.abs(x - fx) - 0.5), gy = Math.max(0, Math.abs(y - fy) - 0.5);
              expect(Math.hypot(gx, gy) * cellSize - BRAZIER_RADIUS, `${g} seed ${seed} bowl ${s.x},${s.z} rock ${x},${y}`).toBeGreaterThanOrEqual(1);
            }
          }
        }
      }
    }
  }, 30_000);

  it("never stands a bowl against a fen pool", () => {
    let wet = 0;
    for (let seed = 0; seed < 20; seed++) {
      const layout = generateArea(seed, "v", "sunken-ruins");
      const { water, cols, cellSize, originX, originY } = layout.grid;
      if (!water) continue;
      wet++;
      for (const s of brazierSpotsFor(layout)) {
        // The bowl sits half a cell off the wall it backs onto; that cell is never water.
        for (const [dx, dz] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]] as const) {
          const cx = Math.round((s.x + dx - originX) / cellSize), cy = Math.round((s.z + dz - originY) / cellSize);
          expect(water[cy * cols + cx], `seed ${seed} at ${s.x},${s.z}`).not.toBe(1);
        }
      }
    }
    expect(wet).toBeGreaterThan(0);
  });
});
