// Layout types and size-parameterized cell geometry, shared by every generator.
// Split out of mapgen.ts so the 80-cell disc generator and the 112-cell tile
// assembler can use one implementation without importing each other.
import { fnv1a32 } from "./rng";

/** 2 = the wobbly-disc open field. 3 = chunks assembled on a 7x7 tile lattice. */
export const ALGORITHM_VERSION = 3;

/** Cell edge length in world units. Player body radius is 0.5, so a 3-cell
 *  corridor is 1.5 world units wide — player diameter (1.0) plus margin. */
export const CELL_SIZE = 0.5;
export const CORRIDOR_WIDTH_CELLS = 3;
/** Required clear width for any mandatory route: player diameter + safety margin. */
export const MIN_ROUTE_WIDTH = 1.0 + 0.25;
/** Monster spawn points every generator aims for. Raised with the lattice
 *  (7x7 -> 9x9 tiles): a map 65% larger on the same budget is a sparser map,
 *  and empty ground between fights is the one thing a bigger area must not buy. */
export const SPAWN_TARGET = 10;

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

/** World coordinate of the (0,0) cell centre for a square grid of `size` cells. */
export function gridOrigin(size: number): number {
  return -((size - 1) / 2) * CELL_SIZE;
}

export function cellCentre(size: number, cx: number, cy: number): { x: number; y: number } {
  const o = gridOrigin(size);
  return { x: o + cx * CELL_SIZE, y: o + cy * CELL_SIZE };
}

export function worldToCell(size: number, x: number, y: number): { cx: number; cy: number } {
  const o = gridOrigin(size);
  return { cx: Math.round((x - o) / CELL_SIZE), cy: Math.round((y - o) / CELL_SIZE) };
}

export function bfsReachable(
  cells: Uint8Array,
  size: number,
  start: { cx: number; cy: number },
): Uint8Array {
  const seen = new Uint8Array(size * size);
  if (start.cx < 0 || start.cy < 0 || start.cx >= size || start.cy >= size) return seen;
  const i0 = start.cy * size + start.cx;
  if (cells[i0] !== 1) return seen;
  seen[i0] = 1;
  const stack = [start];
  while (stack.length) {
    const { cx, cy } = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const i = ny * size + nx;
      if (seen[i] || cells[i] !== 1) continue;
      seen[i] = 1;
      stack.push({ cx: nx, cy: ny });
    }
  }
  return seen;
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

export interface BuildLayoutParams {
  size: number;
  seed: number;
  contentVersion: string;
  usedFallback: boolean;
  cells: Uint8Array;
  objectiveAnchors: Socket[];
  spawnSockets: Socket[];
  chosenVariantIds: string[];
}

/** Run the shared validation gates over a finished cell grid and hash it. */
export function buildLayout(p: BuildLayoutParams): AreaLayout {
  const { size, cells } = p;
  let walkableCells = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === 1) walkableCells++;
  const walkableArea = walkableCells * CELL_SIZE * CELL_SIZE;

  const start = p.objectiveAnchors.find((a) => a.id === "start")!;
  const reached = bfsReachable(cells, size, worldToCell(size, start.x, start.y));
  const targets = [...p.objectiveAnchors, ...p.spawnSockets];
  const allReached = targets.every((t) => {
    const c = worldToCell(size, t.x, t.y);
    if (c.cx < 0 || c.cy < 0 || c.cx >= size || c.cy >= size) return false;
    return reached[c.cy * size + c.cx] === 1;
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
      passed: p.spawnSockets.length >= Math.ceil(SPAWN_TARGET * 0.85) &&
        p.spawnSockets.length <= Math.floor(SPAWN_TARGET * 1.15),
      detail: `${p.spawnSockets.length} spawns`,
    },
  ];

  const grid: WalkableGrid = {
    cols: size,
    rows: size,
    cellSize: CELL_SIZE,
    originX: gridOrigin(size),
    originY: gridOrigin(size),
    cells,
  };
  const withoutHash: Omit<AreaLayout, "hash"> = {
    algorithmVersion: ALGORITHM_VERSION,
    contentVersion: p.contentVersion,
    seed: p.seed,
    chosenVariantIds: p.chosenVariantIds,
    objectiveAnchors: p.objectiveAnchors,
    spawnSockets: p.spawnSockets,
    grid,
    walkableArea,
    validationChecks,
    usedFallback: p.usedFallback,
  };
  return { ...withoutHash, hash: hashLayout(withoutHash) };
}
