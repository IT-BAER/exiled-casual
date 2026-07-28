import { describe, it, expect } from "vitest";
import {
  generateArea,
  fallbackLayout,
  ALGORITHM_VERSION,
  CELL_SIZE,
  MIN_ROUTE_WIDTH,
  type AreaLayout,
} from "./mapgen";

const V = "content.test.v1";

function allChecksPass(layout: AreaLayout): boolean {
  return layout.validationChecks.length > 0 && layout.validationChecks.every((c) => c.passed);
}

/** Independent reachability check: BFS over walkable cells from the start anchor,
 *  confirming every anchor + spawn socket lands on a reached walkable cell. */
function allSocketsReachable(layout: AreaLayout): boolean {
  const { grid } = layout;
  const idx = (cx: number, cy: number) => cy * grid.cols + cx;
  const cellOf = (x: number, y: number) => ({
    cx: Math.round((x - grid.originX) / grid.cellSize),
    cy: Math.round((y - grid.originY) / grid.cellSize),
  });
  const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
  const s = cellOf(start.x, start.y);
  const seen = new Uint8Array(grid.cols * grid.rows);
  const queue = [s];
  if (grid.cells[idx(s.cx, s.cy)] !== 1) return false;
  seen[idx(s.cx, s.cy)] = 1;
  while (queue.length) {
    const { cx, cy } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      const i = idx(nx, ny);
      if (seen[i] || grid.cells[i] !== 1) continue;
      seen[i] = 1;
      queue.push({ cx: nx, cy: ny });
    }
  }
  const targets = [...layout.objectiveAnchors, ...layout.spawnSockets];
  return targets.every((t) => {
    const c = cellOf(t.x, t.y);
    if (c.cx < 0 || c.cy < 0 || c.cx >= grid.cols || c.cy >= grid.rows) return false;
    return seen[idx(c.cx, c.cy)] === 1;
  });
}

describe("generateArea", () => {
  it("is deterministic: same seed+version → identical hash and grid", () => {
    const a = generateArea(1234, V);
    const b = generateArea(1234, V);
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.grid.cells)).toEqual(Array.from(b.grid.cells));
    expect(a.objectiveAnchors).toEqual(b.objectiveAnchors);
    expect(a.spawnSockets).toEqual(b.spawnSockets);
  });

  it("different seeds generally produce different layouts", () => {
    const hashes = new Set<number>();
    for (let s = 0; s < 20; s++) hashes.add(generateArea(s, V).hash);
    // Not all identical — the generator actually varies with the seed.
    expect(hashes.size).toBeGreaterThan(10);
  });

  it("records the requested version and algorithm version", () => {
    const a = generateArea(7, V);
    expect(a.contentVersion).toBe(V);
    expect(a.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(a.seed).toBe(7);
  });

  it("never returns an invalid layout: 200 seeds all pass every gate", () => {
    for (let s = 0; s < 200; s++) {
      const layout = generateArea(s, V);
      expect(allChecksPass(layout), `seed ${s} failed a validation gate`).toBe(true);
      // Cross-check the gates with an independent implementation.
      expect(allSocketsReachable(layout), `seed ${s} has an unreachable socket`).toBe(true);
    }
  });

  it("always has start, boss and exit anchors that are mutually distinct", () => {
    for (const s of [0, 5, 42, 99, 777]) {
      const layout = generateArea(s, V);
      const ids = layout.objectiveAnchors.map((a) => a.id);
      expect(ids).toContain("start");
      expect(ids).toContain("boss");
      expect(ids).toContain("exit");
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      const boss = layout.objectiveAnchors.find((a) => a.id === "boss")!;
      expect(start.x !== boss.x || start.y !== boss.y).toBe(true);
    }
  });

  it("corridors are at least the minimum route width", () => {
    // Construction guarantee, surfaced as a recorded gate.
    const layout = generateArea(3, V);
    const width = layout.validationChecks.find((c) => c.name === "minCorridorWidth");
    expect(width?.passed).toBe(true);
    expect(3 * CELL_SIZE).toBeGreaterThanOrEqual(MIN_ROUTE_WIDTH);
  });

  // The generator assembles authored chunks on a 7x7 tile lattice, so an area is
  // a route through rooms, not a disc. Map SIZE is meant to vary — a short loop
  // is a fast map — so this pins the middle of the distribution rather than every
  // seed. Measured over 200 seeds: loop runs 0.13-0.39 (median 0.32), open-field
  // 0.13-0.71 (median 0.56). A per-seed floor would only pin the thinnest loop.
  it("is a routed area: the typical map is a healthy fraction walkable", () => {
    for (const [grammar, lo, hi] of [["loop", 0.22, 0.45], ["open-field", 0.40, 0.70]] as const) {
      const fracs: number[] = [];
      for (let s = 0; s < 60; s++) {
        const { grid } = generateArea(s, V, grammar);
        let walk = 0;
        for (const c of grid.cells) if (c === 1) walk++;
        fracs.push(walk / (grid.cols * grid.rows));
      }
      fracs.sort((a, b) => a - b);
      const median = fracs[Math.floor(fracs.length / 2)]!;
      expect(median, `${grammar} median walkable ${median.toFixed(3)}`).toBeGreaterThan(lo);
      expect(median, `${grammar} median walkable ${median.toFixed(3)}`).toBeLessThan(hi);
      // No seed may produce a degenerate area, whatever its size.
      expect(fracs[0]!, `${grammar} thinnest ${fracs[0]!.toFixed(3)}`).toBeGreaterThan(0.08);
    }
  });

  it("falls back only rarely, and the fallback is still a valid area", () => {
    let fallbacks = 0;
    for (let s = 0; s < 200; s++) if (generateArea(s, V).usedFallback) fallbacks++;
    expect(fallbacks, `${fallbacks}/200 seeds fell back`).toBeLessThan(12);
  });

  it("builds the open-field grammar as readily as the loop", () => {
    for (let s = 0; s < 50; s++) {
      const layout = generateArea(s, V, "open-field");
      expect(layout.validationChecks.every((c) => c.passed), `seed ${s}`).toBe(true);
    }
  });

  it("gives the two grammars genuinely different areas from one seed", () => {
    const loop = generateArea(9, V, "loop");
    const field = generateArea(9, V, "open-field");
    expect(loop.hash).not.toBe(field.hash);
    expect(loop.chosenVariantIds.some((id) => id.includes("loop."))).toBe(true);
    expect(field.chosenVariantIds.some((id) => id.includes("field."))).toBe(true);
  });

  it("walls the whole outer boundary so the player can't leave the field", () => {
    const { grid } = generateArea(11, V);
    const { cols, rows, cells } = grid;
    for (let x = 0; x < cols; x++) {
      expect(cells[x], `top row cell ${x}`).toBe(0);
      expect(cells[(rows - 1) * cols + x], `bottom row cell ${x}`).toBe(0);
    }
    for (let y = 0; y < rows; y++) {
      expect(cells[y * cols], `left col cell ${y}`).toBe(0);
      expect(cells[y * cols + cols - 1], `right col cell ${y}`).toBe(0);
    }
  });

  it("keeps spawns off the start so the player gets a safe entry beat", () => {
    // Regression: the open-field rewrite once ringed spawns evenly, dropping two
    // monsters ~6 units from the start anchor → instant death on entry.
    const SAFE = 10; // world units of breathing room around the start
    for (const s of [0, 5, 42, 99, 777, 1234]) {
      const layout = generateArea(s, V);
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      for (const sp of layout.spawnSockets) {
        const d = Math.hypot(sp.x - start.x, sp.y - start.y);
        expect(d, `seed ${s} spawn ${sp.id} only ${d.toFixed(1)} from start`).toBeGreaterThanOrEqual(SAFE);
      }
    }
  });

  it("has cover: wall inside the area, not only around it", () => {
    // A field with nothing to stand behind is not a place. Count wall cells
    // that have a walkable neighbour — the boundary ring alone would not.
    for (const s of [0, 5, 42, 99, 777]) {
      const { grid } = generateArea(s, V);
      const { cols, rows, cells } = grid;
      let interiorWall = 0;
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          if (cells[y * cols + x] !== 0) continue;
          const touchesFloor =
            cells[y * cols + x + 1] === 1 || cells[y * cols + x - 1] === 1 ||
            cells[(y + 1) * cols + x] === 1 || cells[(y - 1) * cols + x] === 1;
          if (touchesFloor) interiorWall++;
        }
      }
      expect(interiorWall, `seed ${s} wall cells touching floor`).toBeGreaterThan(200);
    }
  });
});

describe("fallbackLayout", () => {
  it("is deterministic and always valid", () => {
    const a = fallbackLayout(50, V);
    const b = fallbackLayout(50, V);
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.grid.cells)).toEqual(Array.from(b.grid.cells));
    expect(a.usedFallback).toBe(true);
    expect(allChecksPass(a)).toBe(true);
    expect(allSocketsReachable(a)).toBe(true);
  });
});
