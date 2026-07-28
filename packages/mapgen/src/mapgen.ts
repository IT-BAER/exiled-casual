// Indoor room-graph map generation. Pure and deterministic: the same
// (seed, contentVersion) always yields an identical AreaLayout (same hash).
// World coordinates are plain numbers in sim world units; the caller converts
// to fixed-point at the sim boundary. The walkable grid is integer cells.
import { createStream, type RandomStream } from "./rng";
import {
  CELL_SIZE,
  CORRIDOR_WIDTH_CELLS,
  SPAWN_TARGET,
  buildLayout,
  cellCentre as cellCentreAt,
  type AreaLayout,
  type Socket,
} from "./grid";

// Re-exported so existing importers of "./mapgen" keep working unchanged.
export {
  ALGORITHM_VERSION,
  CELL_SIZE,
  CORRIDOR_WIDTH_CELLS,
  MIN_ROUTE_WIDTH,
  SPAWN_TARGET,
} from "./grid";
export type { AreaLayout, WalkableGrid, Socket, ValidationCheck } from "./grid";

/** Dungeon grid extent in cells (square, centred on the world origin). */
export const GRID_CELLS = 80; // 80 * 0.5 = 40 world units across

const TAU = Math.PI * 2;
/** Open-field radius in cells before per-seed wobble. Leaves a wall margin to
 *  the grid edge (34 + max wobble < 39.5 half-grid) so the whole boundary is wall. */
const OPEN_RADIUS_CELLS = 34;
/** Half-extent of the central ruin (a plus of two bars ~13 cells across). */
const RUIN_HALF_CELLS = 6;
const RUIN_ARM_CELLS = 2;
/** Anchors sit at 0.55·R, spawns at 0.7·R — inside the field, clear of the ruin. */
const ANCHOR_RADIUS_CELLS = Math.round(OPEN_RADIUS_CELLS * 0.55);
const SPAWN_RADIUS_CELLS = Math.round(OPEN_RADIUS_CELLS * 0.7);
/** Spawns spread over this arc centred on the boss side, leaving a safe wedge
 *  around the start (216° arc → nearest spawn ~72° off the start direction). */
const SPAWN_ARC = Math.PI * 1.2;

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

/** A hand-built three-room dungeon that always passes every gate. Used when a
 *  seeded generation fails validation, so generateArea never returns a bad map. */
export function fallbackLayout(seed: number, contentVersion: string): AreaLayout {
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
  const spawns: Socket[] = spawnPointsFor([bossRoom, exitRoom], SPAWN_TARGET);
  return buildLayout({
    size: GRID_CELLS,
    seed,
    contentVersion,
    usedFallback: true,
    cells,
    objectiveAnchors: anchors,
    spawnSockets: spawns,
    chosenVariantIds: ["fallback"],
  });
}

// Deterministic spawn placement: SPAWN_TARGET points spread over the given rooms,
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

function fieldCentre(): { cx: number; cy: number } {
  const m = (GRID_CELLS - 1) / 2;
  return { cx: m, cy: m };
}

/** Carve an irregular open disc as walkable; everything outside stays wall, so
 *  walls only ring the outer boundary. Per-seed sinusoidal wobble makes the
 *  edge organic instead of a clean circle. */
function carveOpenField(cells: Uint8Array, rng: RandomStream): void {
  const { cx: mx, cy: my } = fieldCentre();
  const a1 = rng.nextInt(2, 4), a2 = rng.nextInt(1, 3);
  const p1 = (rng.nextU32() / 0x1_0000_0000) * TAU;
  const p2 = (rng.nextU32() / 0x1_0000_0000) * TAU;
  for (let y = 0; y < GRID_CELLS; y++) {
    for (let x = 0; x < GRID_CELLS; x++) {
      const dx = x - mx, dy = y - my;
      const ang = Math.atan2(dy, dx);
      const r = OPEN_RADIUS_CELLS + a1 * Math.sin(3 * ang + p1) + a2 * Math.sin(5 * ang + p2);
      if (Math.hypot(dx, dy) <= r) cells[y * GRID_CELLS + x] = 1;
    }
  }
}

/** Stamp a single central ruin: a plus-shaped wall block, offset a little by
 *  seed, as a landmark and cover. A convex-enough solid that the field stays
 *  fully walkable around it. Returns its cell centre. */
function carveRuin(cells: Uint8Array, rng: RandomStream): { cx: number; cy: number } {
  const { cx: mx, cy: my } = fieldCentre();
  const rx = Math.round(mx) + rng.nextInt(-4, 4);
  const ry = Math.round(my) + rng.nextInt(-4, 4);
  const H = RUIN_HALF_CELLS, arm = RUIN_ARM_CELLS;
  for (let y = -H; y <= H; y++) {
    for (let x = -H; x <= H; x++) {
      if (Math.abs(y) > arm && Math.abs(x) > arm) continue; // plus footprint
      const gx = rx + x, gy = ry + y;
      if (gx < 0 || gy < 0 || gx >= GRID_CELLS || gy >= GRID_CELLS) continue;
      cells[gy * GRID_CELLS + gx] = 0;
    }
  }
  return { cx: rx, cy: ry };
}

function ringCell(mx: number, my: number, radius: number, angle: number): { cx: number; cy: number } {
  return { cx: Math.round(mx + radius * Math.cos(angle)), cy: Math.round(my + radius * Math.sin(angle)) };
}

/** Pull a point toward the field centre until it lands on a walkable cell.
 *  Ring points at 0.55–0.7·R are already clear; this is a determinism-safe guard. */
function snapToWalkable(cells: Uint8Array, mx: number, my: number, cx: number, cy: number): { cx: number; cy: number } {
  let x = cx, y = cy;
  for (let i = 0; i <= GRID_CELLS; i++) {
    if (x >= 0 && y >= 0 && x < GRID_CELLS && y < GRID_CELLS && cells[y * GRID_CELLS + x] === 1) {
      return { cx: x, cy: y };
    }
    x += Math.sign(mx - x);
    y += Math.sign(my - y);
  }
  return { cx: Math.round(mx), cy: Math.round(my) };
}

export function generateArea(seed: number, contentVersion: string): AreaLayout {
  const rng = createStream(seed, `mapgen.${contentVersion}`);
  const cells = new Uint8Array(GRID_CELLS * GRID_CELLS);
  carveOpenField(cells, rng);
  carveRuin(cells, rng);

  const { cx: mx, cy: my } = fieldCentre();
  // start / boss opposite (180°) / exit at +90°, on a mid-radius ring.
  const theta = (rng.nextU32() / 0x1_0000_0000) * TAU;
  const anchorAt = (angle: number): { cx: number; cy: number } => {
    const p = ringCell(mx, my, ANCHOR_RADIUS_CELLS, angle);
    return snapToWalkable(cells, mx, my, p.cx, p.cy);
  };
  const sc = anchorAt(theta);
  const bc = anchorAt(theta + Math.PI);
  const ec = anchorAt(theta + Math.PI / 2);
  const anchors: Socket[] = [
    { id: "start", ...cellCentre(sc.cx, sc.cy) },
    { id: "boss", ...cellCentre(bc.cx, bc.cy) },
    { id: "exit", ...cellCentre(ec.cx, ec.cy) },
  ];

  // Spawns spread across the far arc, centred on the boss side (theta + PI) and
  // spanning SPAWN_ARC, so none land next to the start — the player needs a safe
  // beat on entry, not two monsters in their face.
  const spawns: Socket[] = [];
  for (let k = 0; k < SPAWN_TARGET; k++) {
    const frac = k / (SPAWN_TARGET - 1); // 0..1 across the arc (SPAWN_TARGET > 1)
    const angle = theta + Math.PI - SPAWN_ARC / 2 + frac * SPAWN_ARC;
    const p = ringCell(mx, my, SPAWN_RADIUS_CELLS, angle);
    const c = snapToWalkable(cells, mx, my, p.cx, p.cy);
    spawns.push({ id: `spawn.${k}`, ...cellCentre(c.cx, c.cy) });
  }

  const layout = buildLayout({
    size: GRID_CELLS,
    seed,
    contentVersion,
    usedFallback: false,
    cells,
    objectiveAnchors: anchors,
    spawnSockets: spawns,
    chosenVariantIds: ["open.field"],
  });
  // Any gate failing (e.g. a socket stranded off the walkable net) → safe fallback.
  if (!layout.validationChecks.every((c) => c.passed)) {
    return fallbackLayout(seed, contentVersion);
  }
  return layout;
}
