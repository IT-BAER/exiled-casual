// Layout types and size-parameterized cell geometry, shared by every generator.
// Split out of mapgen.ts so the 80-cell disc generator and the 112-cell tile
// assembler can use one implementation without importing each other.
import { fnv1a32 } from "./rng";

/** 4 = profile-specific encounter budgets and the hybrid sunken-ruins layout. */
export const ALGORITHM_VERSION = 5;

/** Cell edge length in world units. Player body radius is 0.5, so a 3-cell
 *  corridor is 1.5 world units wide — player diameter (1.0) plus margin. */
export const CELL_SIZE = 0.5;
export const CORRIDOR_WIDTH_CELLS = 3;
/** Required clear width for any mandatory route: player diameter + safety margin. */
export const MIN_ROUTE_WIDTH = 1.0 + 0.25;
/** Monster spawn points every generator aims for. Raised with the lattice
 *  (7x7 -> 9x9 tiles): a map 65% larger on the same budget is a sparser map,
 *  and empty ground between fights is the one thing a bigger area must not buy. */
export const SPAWN_TARGET = 22;

export interface WalkableGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** World coordinate of the (0,0) cell's centre. */
  originX: number;
  originY: number;
  /** rows*cols, row-major; 1 = walkable, 0 = wall. */
  cells: Uint8Array;
  /** rows*cols, 1 = open sea. Only the coast generator sets it, and only it
   *  can: a wall cell is a cliff on one side of a beach and water on the other,
   *  and nothing about `cells` tells the two apart. Absent everywhere else. */
  water?: Uint8Array;
  /** The waterline as the CURVE it actually is, in world units.
   *
   *  The cell grid cannot carry it: a shoreline quantised to half-unit cells is
   *  a staircase, and no amount of shading hides a staircase. The generator has
   *  the exact fractional position per column, so it hands that over and the
   *  renderer builds the water off the curve instead of off the cells. */
  shore?: Shoreline;
}

export interface Shoreline {
  /** World axis the shore RUNS along; `cross` is the other one. */
  along: "x" | "y";
  /** World coordinate of sample i along that axis: `start + i * step`. */
  start: number;
  step: number;
  /** Cross-axis world coordinate of the waterline at each sample. */
  cross: Float32Array;
  /** +1 when the sea lies at greater cross coordinate, -1 when at less. */
  seaSide: 1 | -1;
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
  /** Expected encounter sockets for this layout profile. */
  spawnTarget?: number;
  /** How far, in cells, a reward may move to stand clear of the walls. */
  rewardSearch?: number;
}

/**
 * How far a reward container stands from the nearest wall cell, in cells. The
 * coast's ledge rock reaches 1.4 units onto the sand (render/rocks.ts), and a
 * chest inside it reads as spawned in a rock. Weed and plants that reach further
 * are cleared round the chest by the renderer instead, so the cache can still
 * hug the cliff, off the walking line.
 */
export const REWARD_CLEARANCE_CELLS = 4;
/** How far a reward may move to find that clearance, in cells: short enough that
 *  a chunk pocket's cache stays in its pocket. Open ground passes its own. */
const REWARD_SEARCH_CELLS = 8;
/** No cache inside the arrival's safe radius, the rule both generators place by. */
const REWARD_SAFE_RADIUS = 10;
/** A moved cache keeps out of a pack's spread (3.2 units round its socket, plus a body). */
const REWARD_PACK_CLEAR = 4;

/** Chamfer distance (5 per step, 7 per diagonal) from every cell to the nearest wall. */
function wallDistance(cells: Uint8Array, size: number): Int32Array {
  const d = new Int32Array(size * size);
  const far = 1 << 29;
  for (let i = 0; i < d.length; i++) d[i] = cells[i] === 1 ? far : 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (d[i] === 0) continue;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 5);
      if (y > 0) {
        v = Math.min(v, d[i - size]! + 5);
        if (x > 0) v = Math.min(v, d[i - size - 1]! + 7);
        if (x < size - 1) v = Math.min(v, d[i - size + 1]! + 7);
      }
      if (x === 0 || y === 0) v = Math.min(v, 5);
      else if (x === size - 1) v = Math.min(v, 7);
      d[i] = v;
    }
  for (let y = size - 1; y >= 0; y--)
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (d[i] === 0) continue;
      let v = d[i]!;
      if (x < size - 1) v = Math.min(v, d[i + 1]! + 5);
      if (y < size - 1) {
        v = Math.min(v, d[i + size]! + 5);
        if (x < size - 1) v = Math.min(v, d[i + size + 1]! + 7);
        if (x > 0) v = Math.min(v, d[i + size - 1]! + 7);
      }
      if (x === size - 1 || y === size - 1) v = Math.min(v, 5);
      else if (x === 0) v = Math.min(v, 7);
      d[i] = v;
    }
  return d;
}

/**
 * Move each `reward.*` anchor to the nearest reachable cell with the full
 * clearance, or, where none is in reach (a narrow strongroom), to the most open
 * one. Two caches never share a spot.
 */
function clearRewards(
  anchors: Socket[], cells: Uint8Array, size: number, reached: Uint8Array, start: { x: number; y: number },
  search: number, spawns: readonly Socket[],
): Socket[] {
  if (!anchors.some((a) => a.id.startsWith("reward."))) return anchors;
  const dist = wallDistance(cells, size);
  const want = REWARD_CLEARANCE_CELLS * 5;
  const taken: { cx: number; cy: number }[] = [];
  const occupied = [...spawns, ...anchors.filter((a) => a.id === "boss" || a.id === "exit")];
  return anchors.map((a) => {
    if (!a.id.startsWith("reward.")) return a;
    const o = worldToCell(size, a.x, a.y);
    // A cache already clear of the walls stays where the generator put it.
    if (reached[o.cy * size + o.cx] === 1 && dist[o.cy * size + o.cx]! >= want) {
      taken.push(o);
      return a;
    }
    let best: { cx: number; cy: number; d: number; r2: number } | null = null;
    for (let dy = -search; dy <= search; dy++)
      for (let dx = -search; dx <= search; dx++) {
        const cx = o.cx + dx, cy = o.cy + dy;
        const r2 = dx * dx + dy * dy;
        if (cx < 0 || cy < 0 || cx >= size || cy >= size || r2 > search ** 2) continue;
        const i = cy * size + cx;
        if (reached[i] !== 1) continue;
        if (taken.some((t) => (t.cx - cx) ** 2 + (t.cy - cy) ** 2 < 16)) continue;
        const d = Math.min(dist[i]!, want);
        if (best && (d < best.d || (d === best.d && r2 >= best.r2))) continue;
        const w = cellCentre(size, cx, cy);
        if ((w.x - start.x) ** 2 + (w.y - start.y) ** 2 < REWARD_SAFE_RADIUS ** 2) continue;
        if (occupied.some((o) => (w.x - o.x) ** 2 + (w.y - o.y) ** 2 < REWARD_PACK_CLEAR ** 2)) continue;
        best = { cx, cy, d, r2 };
      }
    if (!best) return a;
    taken.push(best);
    return { id: a.id, ...cellCentre(size, best.cx, best.cy) };
  });
}

/** Run the shared validation gates over a finished cell grid and hash it. */
export function buildLayout(p: BuildLayoutParams): AreaLayout {
  const { size, cells } = p;
  const spawnTarget = p.spawnTarget ?? SPAWN_TARGET;
  let walkableCells = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === 1) walkableCells++;
  const walkableArea = walkableCells * CELL_SIZE * CELL_SIZE;

  const start = p.objectiveAnchors.find((a) => a.id === "start")!;
  const reached = bfsReachable(cells, size, worldToCell(size, start.x, start.y));
  const objectiveAnchors = clearRewards(
    p.objectiveAnchors, cells, size, reached, start, p.rewardSearch ?? REWARD_SEARCH_CELLS, p.spawnSockets,
  );
  const targets = [...objectiveAnchors, ...p.spawnSockets];
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
      passed: p.spawnSockets.length >= Math.ceil(spawnTarget * 0.85) &&
        p.spawnSockets.length <= Math.floor(spawnTarget * 1.15),
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
    objectiveAnchors,
    spawnSockets: p.spawnSockets,
    grid,
    walkableArea,
    validationChecks,
    usedFallback: p.usedFallback,
  };
  return { ...withoutHash, hash: hashLayout(withoutHash) };
}
