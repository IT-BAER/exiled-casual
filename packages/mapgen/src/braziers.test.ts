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
