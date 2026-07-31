// The safety net: a hand-built three-room dungeon that always passes every
// gate. Used when a seeded generation fails validation, so generateArea never
// returns a bad map.
//
// It lives apart from the generators because every one of them needs it, and a
// generator that owned it could not be imported by its siblings.
import {
  CORRIDOR_WIDTH_CELLS,
  SPAWN_TARGET,
  buildLayout,
  cellCentre as cellCentreAt,
  type AreaLayout,
  type Socket,
} from "./grid";

/** Fallback grid extent in cells (square, centred on the world origin). */
export const GRID_CELLS = 80; // 80 * 0.5 = 40 world units across

interface Room {
  x0: number;
  y0: number;
  x1: number;
  y1: number; // inclusive cell bounds
}

function cellCentre(cx: number, cy: number): { x: number; y: number } {
  return cellCentreAt(GRID_CELLS, cx, cy);
}

function roomCentre(r: Room): { cx: number; cy: number } {
  return { cx: Math.floor((r.x0 + r.x1) / 2), cy: Math.floor((r.y0 + r.y1) / 2) };
}

function carveRoom(cells: Uint8Array, r: Room): void {
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) cells[y * GRID_CELLS + x] = 1;
  }
}

function setCell(cells: Uint8Array, cx: number, cy: number): void {
  if (cx < 0 || cy < 0 || cx >= GRID_CELLS || cy >= GRID_CELLS) return;
  cells[cy * GRID_CELLS + cx] = 1;
}

// Carve an L-shaped corridor CORRIDOR_WIDTH_CELLS wide between two cell centres.
function carveCorridor(cells: Uint8Array, ax: number, ay: number, bx: number, by: number): void {
  const half = Math.floor(CORRIDOR_WIDTH_CELLS / 2);
  const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
  for (let x = lo; x <= hi; x++) {
    for (let d = -half; d <= half; d++) setCell(cells, x, ay + d);
  }
  const loY = Math.min(ay, by), hiY = Math.max(ay, by);
  for (let y = loY; y <= hiY; y++) {
    for (let d = -half; d <= half; d++) setCell(cells, bx + d, y);
  }
}

// Deterministic spawn placement: the profile's target spread over the given rooms,
// each offset from the room centre so they don't stack on an anchor.
function spawnPointsFor(rooms: Room[], count: number): Socket[] {
  const out: Socket[] = [];
  const offsets: readonly [number, number][] = [
    [2, 2], [-2, -2], [3, -3], [-3, 3], [0, 4], [4, 0], [-4, 0], [0, -4],
  ];
  let k = 0;
  for (const r of rooms) {
    const c = roomCentre(r);
    for (const [dx, dy] of offsets) {
      if (out.length >= count) return out;
      const cx = Math.min(r.x1, Math.max(r.x0, c.cx + dx));
      const cy = Math.min(r.y1, Math.max(r.y0, c.cy + dy));
      out.push({ id: `spawn.${k++}`, ...cellCentre(cx, cy) });
    }
  }
  return out;
}

export function fallbackLayout(
  seed: number,
  contentVersion: string,
  spawnTarget = SPAWN_TARGET,
): AreaLayout {
  const cells = new Uint8Array(GRID_CELLS * GRID_CELLS);
  // start (left), boss (centre, larger), exit (right), on a horizontal spine.
  const cy = Math.floor(GRID_CELLS / 2);
  const startRoom: Room = { x0: 8, y0: cy - 6, x1: 20, y1: cy + 6 };
  const bossRoom: Room = { x0: 30, y0: cy - 10, x1: 50, y1: cy + 10 };
  const exitRoom: Room = { x0: 60, y0: cy - 6, x1: 72, y1: cy + 6 };
  for (const r of [startRoom, bossRoom, exitRoom]) carveRoom(cells, r);
  const sc = roomCentre(startRoom), bc = roomCentre(bossRoom), ec = roomCentre(exitRoom);
  carveCorridor(cells, sc.cx, sc.cy, bc.cx, bc.cy);
  carveCorridor(cells, bc.cx, bc.cy, ec.cx, ec.cy);

  const anchors: Socket[] = [
    { id: "start", ...cellCentre(sc.cx, sc.cy) },
    { id: "boss", ...cellCentre(bc.cx, bc.cy) },
    { id: "exit", ...cellCentre(ec.cx, ec.cy) },
  ];
  return buildLayout({
    size: GRID_CELLS,
    seed,
    contentVersion,
    usedFallback: true,
    cells,
    objectiveAnchors: anchors,
    spawnSockets: spawnPointsFor([bossRoom, exitRoom], spawnTarget),
    chosenVariantIds: ["fallback"],
    spawnTarget,
  });
}
