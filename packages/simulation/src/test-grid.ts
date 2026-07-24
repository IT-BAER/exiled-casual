import type { WalkableGrid } from "@exiled/mapgen";

/**
 * Test-only helper: build a WalkableGrid from an ASCII map. '.' = walkable,
 * anything else = wall. cellSize 1 and origin 0 put cell (cx,cy) at world
 * (cx,cy) so collision tests read like the map they draw.
 */
export function makeGrid(rows: string[]): WalkableGrid {
  const h = rows.length;
  const w = rows[0]!.length;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = rows[y]![x] === "." ? 1 : 0;
  }
  return { cols: w, rows: h, cellSize: 1, originX: 0, originY: 0, cells };
}
