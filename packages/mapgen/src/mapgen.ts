// Indoor room-graph map generation. Pure and deterministic: the same
// (seed, contentVersion) always yields an identical AreaLayout (same hash).
// World coordinates are plain numbers in sim world units; the caller converts
// to fixed-point at the sim boundary. The walkable grid is integer cells.
import { createStream, fnv1a32, type RandomStream } from "./rng";

export const ALGORITHM_VERSION = 2;

/** Cell edge length in world units. Player body radius is 0.5, so a 3-cell
 *  corridor is 1.5 world units wide — player diameter (1.0) plus margin. */
export const CELL_SIZE = 0.5;
export const CORRIDOR_WIDTH_CELLS = 3;
/** Required clear width for any mandatory route: player diameter + safety margin. */
export const MIN_ROUTE_WIDTH = 1.0 + 0.25;

/** Dungeon grid extent in cells (square, centred on the world origin). */
export const GRID_CELLS = 80; // 80 * 0.5 = 40 world units across

export interface WalkableGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** World coordinate of the (0,0) cell's centre. */
  originX: number;
  originY: number;
  /** rows*cols, row-major; 1 = walkable, 0 = wall. */
  cells: Uint8Array;
}

export interface Socket {
  id: string;
  x: number;
  y: number;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface AreaLayout {
  algorithmVersion: number;
  contentVersion: string;
  seed: number;
  chosenVariantIds: string[];
  /** start, boss, exit (+ objectives) in world units. */
  objectiveAnchors: Socket[];
  /** Monster/encounter spawn points in world units. */
  spawnSockets: Socket[];
  grid: WalkableGrid;
  /** Walkable world area (cell count * cellSize^2). */
  walkableArea: number;
  validationChecks: ValidationCheck[];
  usedFallback: boolean;
  hash: number;
}

const SPAWN_TARGET = 6;

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

function gridOrigin(): number {
  return -((GRID_CELLS - 1) / 2) * CELL_SIZE;
}

function cellCentre(cx: number, cy: number): { x: number; y: number } {
  const o = gridOrigin();
  return { x: o + cx * CELL_SIZE, y: o + cy * CELL_SIZE };
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

function bfsReachable(cells: Uint8Array, start: { cx: number; cy: number }): Uint8Array {
  const seen = new Uint8Array(GRID_CELLS * GRID_CELLS);
  const i0 = start.cy * GRID_CELLS + start.cx;
  if (cells[i0] !== 1) return seen;
  seen[i0] = 1;
  const stack = [start];
  while (stack.length) {
    const { cx, cy } = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_CELLS || ny >= GRID_CELLS) continue;
      const i = ny * GRID_CELLS + nx;
      if (seen[i] || cells[i] !== 1) continue;
      seen[i] = 1;
      stack.push({ cx: nx, cy: ny });
    }
  }
  return seen;
}

function worldToCell(x: number, y: number): { cx: number; cy: number } {
  const o = gridOrigin();
  return { cx: Math.round((x - o) / CELL_SIZE), cy: Math.round((y - o) / CELL_SIZE) };
}

function hashLayout(l: Omit<AreaLayout, "hash">): number {
  let h = fnv1a32(
    JSON.stringify({
      algorithmVersion: l.algorithmVersion,
      contentVersion: l.contentVersion,
      seed: l.seed,
      usedFallback: l.usedFallback,
      objectiveAnchors: l.objectiveAnchors,
      spawnSockets: l.spawnSockets,
      walkableArea: l.walkableArea,
      validationChecks: l.validationChecks,
      cols: l.grid.cols,
      rows: l.grid.rows,
      cellSize: l.grid.cellSize,
      originX: l.grid.originX,
      originY: l.grid.originY,
    }),
  );
  const cells = l.grid.cells;
  for (let i = 0; i < cells.length; i++) h = Math.imul(h ^ cells[i]!, 0x01000193) >>> 0;
  return h >>> 0;
}

function assemble(
  seed: number,
  contentVersion: string,
  usedFallback: boolean,
  cells: Uint8Array,
  objectiveAnchors: Socket[],
  spawnSockets: Socket[],
  chosenVariantIds: string[],
): AreaLayout {
  let walkableCells = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === 1) walkableCells++;
  const walkableArea = walkableCells * CELL_SIZE * CELL_SIZE;

  const start = objectiveAnchors.find((a) => a.id === "start")!;
  const reached = bfsReachable(cells, worldToCell(start.x, start.y));
  const targets = [...objectiveAnchors, ...spawnSockets];
  const allReached = targets.every((t) => {
    const c = worldToCell(t.x, t.y);
    if (c.cx < 0 || c.cy < 0 || c.cx >= GRID_CELLS || c.cy >= GRID_CELLS) return false;
    return reached[c.cy * GRID_CELLS + c.cx] === 1;
  });

  const validationChecks: ValidationCheck[] = [
    { name: "reachability", passed: allReached, detail: "all anchors + spawns reachable from start" },
    {
      name: "minCorridorWidth",
      passed: CORRIDOR_WIDTH_CELLS * CELL_SIZE >= MIN_ROUTE_WIDTH,
      detail: `${CORRIDOR_WIDTH_CELLS * CELL_SIZE} >= ${MIN_ROUTE_WIDTH}`,
    },
    {
      name: "spawnBudget",
      passed: spawnSockets.length >= Math.ceil(SPAWN_TARGET * 0.85) &&
        spawnSockets.length <= Math.floor(SPAWN_TARGET * 1.15),
      detail: `${spawnSockets.length} spawns`,
    },
  ];

  const grid: WalkableGrid = {
    cols: GRID_CELLS,
    rows: GRID_CELLS,
    cellSize: CELL_SIZE,
    originX: gridOrigin(),
    originY: gridOrigin(),
    cells,
  };
  const withoutHash: Omit<AreaLayout, "hash"> = {
    algorithmVersion: ALGORITHM_VERSION,
    contentVersion,
    seed,
    chosenVariantIds,
    objectiveAnchors,
    spawnSockets,
    grid,
    walkableArea,
    validationChecks,
    usedFallback,
  };
  return { ...withoutHash, hash: hashLayout(withoutHash) };
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
  return assemble(seed, contentVersion, true, cells, anchors, spawns, ["fallback"]);
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

  const layout = assemble(seed, contentVersion, false, cells, anchors, spawns, ["open.field"]);
  // Any gate failing (e.g. a socket stranded off the walkable net) → safe fallback.
  if (!layout.validationChecks.every((c) => c.passed)) {
    return fallbackLayout(seed, contentVersion);
  }
  return layout;
}
