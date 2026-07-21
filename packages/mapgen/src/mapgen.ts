// Indoor room-graph map generation. Pure and deterministic: the same
// (seed, contentVersion) always yields an identical AreaLayout (same hash).
// World coordinates are plain numbers in sim world units; the caller converts
// to fixed-point at the sim boundary. The walkable grid is integer cells.
import { createStream, fnv1a32, type RandomStream } from "./rng";

export const ALGORITHM_VERSION = 1;

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

const GAP = 2; // min empty cells between rooms
const MIN_ROOMS = 3; // start, boss, exit
const SPAWN_TARGET = 6;

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

function roomArea(r: Room): number {
  return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
}

function overlaps(a: Room, b: Room): boolean {
  return (
    a.x0 - GAP <= b.x1 && a.x1 + GAP >= b.x0 && a.y0 - GAP <= b.y1 && a.y1 + GAP >= b.y0
  );
}

function placeRooms(rng: RandomStream): Room[] {
  const target = rng.nextInt(5, 7);
  const rooms: Room[] = [];
  for (let attempt = 0; attempt < 60 && rooms.length < target; attempt++) {
    const w = rng.nextInt(8, 16);
    const h = rng.nextInt(8, 16);
    const x0 = rng.nextInt(1, GRID_CELLS - w - 2);
    const y0 = rng.nextInt(1, GRID_CELLS - h - 2);
    const cand: Room = { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
    if (rooms.some((r) => overlaps(r, cand))) continue;
    rooms.push(cand);
  }
  return rooms;
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

export function generateArea(seed: number, contentVersion: string): AreaLayout {
  const rng = createStream(seed, `mapgen.${contentVersion}`);
  const rooms = placeRooms(rng);
  if (rooms.length < MIN_ROOMS) return fallbackLayout(seed, contentVersion);

  const cells = new Uint8Array(GRID_CELLS * GRID_CELLS);
  for (const r of rooms) carveRoom(cells, r);
  // Chain every room to the previous one → a spanning tree → fully connected.
  for (let i = 1; i < rooms.length; i++) {
    const a = roomCentre(rooms[i - 1]!), b = roomCentre(rooms[i]!);
    carveCorridor(cells, a.cx, a.cy, b.cx, b.cy);
  }

  // start = first placed; boss = largest; exit = farthest from start.
  const startIdx = 0;
  let bossIdx = 0, bossA = -1;
  for (let i = 0; i < rooms.length; i++) {
    const a = roomArea(rooms[i]!);
    if (i !== startIdx && a > bossA) { bossA = a; bossIdx = i; }
  }
  const sc = roomCentre(rooms[startIdx]!);
  let exitIdx = -1, exitD = -1;
  for (let i = 0; i < rooms.length; i++) {
    if (i === startIdx || i === bossIdx) continue;
    const c = roomCentre(rooms[i]!);
    const d = (c.cx - sc.cx) ** 2 + (c.cy - sc.cy) ** 2;
    if (d > exitD) { exitD = d; exitIdx = i; }
  }
  if (exitIdx < 0) return fallbackLayout(seed, contentVersion);

  const bc = roomCentre(rooms[bossIdx]!), ec = roomCentre(rooms[exitIdx]!);
  const anchors: Socket[] = [
    { id: "start", ...cellCentre(sc.cx, sc.cy) },
    { id: "boss", ...cellCentre(bc.cx, bc.cy) },
    { id: "exit", ...cellCentre(ec.cx, ec.cy) },
  ];
  const spawnRooms = rooms.filter((_, i) => i !== startIdx);
  const spawns = spawnPointsFor(spawnRooms, SPAWN_TARGET);

  const layout = assemble(seed, contentVersion, false, cells, anchors, spawns, [
    `rooms.${rooms.length}`,
  ]);
  // Any gate failing (e.g. a spawn stranded off the walkable net) → safe fallback.
  if (!layout.validationChecks.every((c) => c.passed)) {
    return fallbackLayout(seed, contentVersion);
  }
  return layout;
}
