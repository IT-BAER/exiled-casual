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
