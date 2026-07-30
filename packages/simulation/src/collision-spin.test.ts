import { describe, it, expect } from "vitest";
import { fp, type Fixed } from "@exiled/fixed-point";
import type { WalkableGrid } from "@exiled/mapgen";
import { gridCollision, chaseStep } from "./collision";

/**
 * The shake, measured.
 *
 * `collision-nav.test.ts` asks whether a chase ARRIVES. It can arrive while
 * juddering the whole way, and it did: the renderer faces a monster along its
 * movement delta, so a delta that flips every tick is a monster spinning on the
 * spot. These pin the flip count, which is the thing actually seen.
 *
 * Both fixtures run at the REAL cell size (0.5, `mapgen/grid.ts`) rather than the
 * 1.0 the other collision tests use, because the bug is a body oscillating across
 * a cell boundary and cell size is half of that geometry.
 */

function realGrid(rows: string[]): WalkableGrid {
  const h = rows.length;
  const w = rows[0]!.length;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = rows[y]![x] === "." ? 1 : 0;
  }
  return { cols: w, rows: h, cellSize: 0.5, originX: 0, originY: 0, cells };
}

/** Ticks whose movement points more than 90 degrees off the previous tick's. */
function chase(
  grid: WalkableGrid,
  from: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  ticks: number,
) {
  const c = gridCollision(grid);
  let x = from.x;
  let y = from.y;
  let px = 0;
  let py = 0;
  let reversals = 0;
  for (let t = 0; t < ticks; t++) {
    const n = chaseStep(c, x, y, target.x, target.y, SPEED, RADIUS);
    const dx = n.x - x;
    const dy = n.y - y;
    if (dx !== 0 || dy !== 0) {
      if ((px !== 0 || py !== 0) && dx * px + dy * py < 0) reversals++;
      px = dx;
      py = dy;
    }
    x = n.x;
    y = n.y;
  }
  return { reversals, dist: Math.hypot(x - target.x, y - target.y) / fp(1) };
}

// A swarm monster: 3.5 units/s at 30 Hz, at the radius its def ships.
const SPEED: Fixed = Math.trunc(fp(3.5) / 30);
const RADIUS: Fixed = fp(0.35);

describe("a chase does not shake", () => {
  it("rounds a free-standing rock without reversing", () => {
    const r = chase(
      realGrid([
        "..............",
        "..............",
        "..............",
        "......##......",
        "......##......",
        "..............",
        "..............",
        "..............",
      ]),
      { x: fp(0.5), y: fp(1.75) },
      { x: fp(6.0), y: fp(1.75) },
      400,
    );
    expect(r.reversals).toBe(0);
    expect(r.dist).toBeLessThan(1);
  });

  it("rounds a wall's end instead of grinding on its rim", () => {
    // The reported case. Greedy is unblocked a body-width off the wall, so it
    // pushed into the rim, the nav field pointed back at the cell it came from,
    // and the two alternated: 397 reversals in 400 ticks, four units short of a
    // player it never reached.
    const r = chase(
      realGrid([
        "..............",
        "..............",
        "..............",
        "....######....",
        "..............",
        "..............",
        "..............",
        "..............",
      ]),
      { x: fp(1), y: fp(1) },
      { x: fp(5), y: fp(2.5) },
      400,
    );
    expect(r.reversals).toBe(0);
    expect(r.dist).toBeLessThan(1);
  });
});
