# Tile Assembler & Loop Chunk Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, headless tile assembler that stamps authored 16x16 ASCII chunks onto a 7x7 tile lattice to produce an `AreaLayout`, plus the `loop` grammar's chunk library.

**Architecture:** Five staged passes, each drawing from its own named RNG sub-stream. Stage 1 builds a route skeleton on the tile lattice and yields a 4-bit open-edge mask per tile. Stage 2 looks up a chunk whose *derived* border mask matches, under one of 8 rotate/mirror orientations. Because masks are decided before chunks are chosen, selection is a lookup and can never fail to edge-match. Nothing in this slice is wired into `generateArea`.

**Tech Stack:** TypeScript, npm workspaces, Vitest. Package `packages/mapgen` (no runtime dependencies; `rng.ts` is a local Mulberry32 copy).

## Global Constraints

- **`generateArea` is NOT modified in this slice.** `ALGORITHM_VERSION` stays `2`. No replay golden is regenerated. The switch happens in a later slice.
- Spec: `docs/specs/2026-07-28-biome-mapgen-design.md`.
- Sim math is deterministic; every function added here is pure — no `Date`, no `Math.random`, no entity ids.
- `@exiled/rules` is a pure leaf and is not touched in this slice.
- Tile size is **16 cells**. Area is **7x7 tiles = 112x112 cells**. `CELL_SIZE` is `0.5`, so the area is 56x56 world units.
- **Opening invariant:** an open tile edge is exactly cells **6..9** of that edge (4 cells, 2 world units), and every other cell on that border is wall. This range is symmetric about the tile centre, which is what makes rotation and mirroring closed operations on the edge mask.
- Direction encoding is fixed everywhere: `N=0 (bit 1), E=1 (bit 2), S=2 (bit 4), W=3 (bit 8)`. Grid is row-major with `y` increasing southward, so N is `y-1`.
- ASCII alphabet: `#` wall, `.` floor, `s` spawn point, `r` reward point, `b` boss anchor, `e` exit anchor. Every non-`#` character is walkable.
- Test command: `npx vitest run packages/mapgen` from the repo root. Typecheck: `npm run typecheck`.
- Commit messages: lowercase conventional style (`feat(mapgen): ...`), no attribution trailers, no emdashes.

## File Structure

| File | Responsibility |
|---|---|
| `packages/mapgen/src/grid.ts` | **New.** Layout types, shared constants, and size-parameterized cell geometry (`gridOrigin`, `cellCentre`, `worldToCell`, `bfsReachable`, `buildLayout`). Extracted from `mapgen.ts` so both the legacy 80-cell disc and the new 112-cell assembler can share it without a circular import. |
| `packages/mapgen/src/mapgen.ts` | **Modify.** Keeps `GRID_CELLS`, the disc generator, and `fallbackLayout`. Imports geometry from `grid.ts`, re-exports the moved types/constants so existing importers are untouched. |
| `packages/mapgen/src/chunks.ts` | **New.** `Chunk`/`Grammar` types, `rotateRows`/`mirrorRows`, `derivePorts`/`deriveMask`, `validateChunk`, `orientations`. |
| `packages/mapgen/src/chunks.test.ts` | **New.** Transform algebra + library invariants. |
| `packages/mapgen/src/loop-grammar.ts` | **New.** The authored `loop` chunk library and boss arena. |
| `packages/mapgen/src/skeleton.ts` | **New.** Stage 1: the 7x7 route graph (loop, spurs, boss block, route distances). |
| `packages/mapgen/src/skeleton.test.ts` | **New.** |
| `packages/mapgen/src/assemble-area.ts` | **New.** Stages 2-5: stamp, anchors, spawns, rewards, whole-area rotation. |
| `packages/mapgen/src/assemble-area.test.ts` | **New.** |
| `packages/mapgen/src/index.ts` | **Modify.** Export the new surface. |

---

### Task 1: Extract size-parameterized grid geometry

`mapgen.ts` hardcodes `GRID_CELLS` (80) inside `gridOrigin`, `cellCentre`, `worldToCell`, `bfsReachable`, and `assemble`. The assembler needs the same code at 112. This task moves that code to `grid.ts` with an explicit `size` parameter. **It is a pure refactor: no behaviour changes and no test changes.** The existing `mapgen.test.ts` is the guard.

**Files:**
- Create: `packages/mapgen/src/grid.ts`
- Modify: `packages/mapgen/src/mapgen.ts`
- Test: `packages/mapgen/src/mapgen.test.ts` (unchanged — it must keep passing)

**Interfaces:**
- Consumes: nothing.
- Produces: `CELL_SIZE`, `CORRIDOR_WIDTH_CELLS`, `MIN_ROUTE_WIDTH`, `ALGORITHM_VERSION`, `SPAWN_TARGET`, types `WalkableGrid`/`Socket`/`ValidationCheck`/`AreaLayout`, and functions `gridOrigin(size)`, `cellCentre(size, cx, cy)`, `worldToCell(size, x, y)`, `bfsReachable(cells, size, start)`, `buildLayout(params)`.

- [ ] **Step 1: Run the existing suite and record the baseline**

Run: `npx vitest run packages/mapgen`
Expected: PASS. Note the test count — it must be identical at the end of this task.

- [ ] **Step 2: Create `packages/mapgen/src/grid.ts`**

```ts
// Layout types and size-parameterized cell geometry, shared by every generator.
// Split out of mapgen.ts so the 80-cell disc generator and the 112-cell tile
// assembler can use one implementation without importing each other.
import { fnv1a32 } from "./rng";

export const ALGORITHM_VERSION = 2;

/** Cell edge length in world units. Player body radius is 0.5, so a 3-cell
 *  corridor is 1.5 world units wide — player diameter (1.0) plus margin. */
export const CELL_SIZE = 0.5;
export const CORRIDOR_WIDTH_CELLS = 3;
/** Required clear width for any mandatory route: player diameter + safety margin. */
export const MIN_ROUTE_WIDTH = 1.0 + 0.25;
/** Monster spawn points every generator aims for. */
export const SPAWN_TARGET = 6;

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
```

- [ ] **Step 3: Rewrite the top of `packages/mapgen/src/mapgen.ts`**

Replace lines 1-57 (the imports, the constants `ALGORITHM_VERSION` / `CELL_SIZE` / `CORRIDOR_WIDTH_CELLS` / `MIN_ROUTE_WIDTH`, and the `WalkableGrid` / `Socket` / `ValidationCheck` / `AreaLayout` interfaces) with:

```ts
// Indoor room-graph map generation. Pure and deterministic: the same
// (seed, contentVersion) always yields an identical AreaLayout (same hash).
// World coordinates are plain numbers in sim world units; the caller converts
// to fixed-point at the sim boundary. The walkable grid is integer cells.
import { createStream, type RandomStream } from "./rng";
import {
  ALGORITHM_VERSION,
  CELL_SIZE,
  CORRIDOR_WIDTH_CELLS,
  MIN_ROUTE_WIDTH,
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
```

Then delete the now-unused `SPAWN_TARGET` local const (line 59) and the local `gridOrigin`, `cellCentre`, `bfsReachable`, `worldToCell`, `hashLayout`, and `assemble` function bodies (lines 82-89, 119-142, 144-225), and add a local 80-cell shim next to the remaining helpers:

```ts
function cellCentre(cx: number, cy: number): { x: number; y: number } {
  return cellCentreAt(GRID_CELLS, cx, cy);
}
```

- [ ] **Step 4: Point the two `assemble(...)` call sites at `buildLayout`**

In `fallbackLayout`, replace `return assemble(seed, contentVersion, true, cells, anchors, spawns, ["fallback"]);` with:

```ts
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
```

In `generateArea`, replace `const layout = assemble(seed, contentVersion, false, cells, anchors, spawns, ["open.field"]);` with:

```ts
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
```

- [ ] **Step 5: Verify the refactor changed nothing**

Run: `npx vitest run packages/mapgen`
Expected: PASS, with the same test count as Step 1. The determinism and 200-seed validity tests passing is the proof that the geometry moved intact.

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/mapgen/src/grid.ts packages/mapgen/src/mapgen.ts
git commit -m "refactor(mapgen): size-parameterized grid geometry in its own module"
```

---

### Task 2: Chunk transform algebra

A chunk is a square block of ASCII rows. Its edge mask is **derived** from its border, never declared, so art and mask cannot disagree. This task builds the transforms and the derivation, and proves they commute.

**Files:**
- Create: `packages/mapgen/src/chunks.ts`
- Test: `packages/mapgen/src/chunks.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `TILE_CELLS = 16`, `OPENING_LO = 6`, `OPENING_HI = 9`
  - `type Dir = 0 | 1 | 2 | 3`, `DIR_VEC: readonly (readonly [number, number])[]`
  - `interface Chunk { id: string; rows: string[] }`
  - `interface Port { side: Dir; index: number }`
  - `interface Oriented { id: string; rows: string[]; mask: number; ports: Port[] }`
  - `rotateRows(rows: string[]): string[]` (90 degrees clockwise)
  - `mirrorRows(rows: string[]): string[]` (horizontal flip)
  - `rotateMask(mask: number, turns: number): number`
  - `mirrorMask(mask: number): number`
  - `derivePorts(rows: string[]): Port[]`
  - `deriveMask(rows: string[]): number`
  - `validateChunk(chunk: Chunk): string[]` (returns problems; empty means valid)
  - `orientations(chunk: Chunk): Oriented[]` (up to 8, deduped)

- [ ] **Step 1: Write the failing test**

Create `packages/mapgen/src/chunks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TILE_CELLS,
  rotateRows,
  mirrorRows,
  rotateMask,
  mirrorMask,
  deriveMask,
  derivePorts,
  validateChunk,
  orientations,
  type Chunk,
} from "./chunks";

/** A minimal north-open tile: the 6..9 stub down to a small room. */
const CAP_N: Chunk = {
  id: "test.cap",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "##............##",
    "##............##",
    "##............##",
    "##............##",
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
  ],
};

describe("chunk transforms", () => {
  it("rotates rows 90 degrees clockwise", () => {
    const src = ["ab", "cd"];
    // top-left goes to top-right: [[a,b],[c,d]] -> [[c,a],[d,b]]
    expect(rotateRows(src)).toEqual(["ca", "db"]);
  });

  it("mirrors rows horizontally", () => {
    expect(mirrorRows(["ab", "cd"])).toEqual(["ba", "dc"]);
  });

  it("derives a north-only mask from the border", () => {
    expect(deriveMask(CAP_N.rows)).toBe(1);
    expect(derivePorts(CAP_N.rows)).toEqual([{ side: 0, index: 0 }]);
  });

  it("rotation of the rows equals rotation of the mask", () => {
    let rows = CAP_N.rows;
    for (let turns = 1; turns <= 4; turns++) {
      rows = rotateRows(rows);
      expect(deriveMask(rows), `after ${turns} turns`).toBe(
        rotateMask(deriveMask(CAP_N.rows), turns % 4),
      );
    }
  });

  it("mirroring the rows equals mirroring the mask", () => {
    expect(deriveMask(mirrorRows(CAP_N.rows))).toBe(mirrorMask(deriveMask(CAP_N.rows)));
  });

  it("four rotations return the original rows", () => {
    expect(rotateRows(rotateRows(rotateRows(rotateRows(CAP_N.rows))))).toEqual(CAP_N.rows);
  });

  it("accepts a well-formed chunk", () => {
    expect(validateChunk(CAP_N)).toEqual([]);
    expect(TILE_CELLS).toBe(16);
  });

  it("rejects an opening that is not the centred 6..9 window", () => {
    const offset = { ...CAP_N, rows: ["#####....#######", ...CAP_N.rows.slice(1)] };
    expect(validateChunk(offset).length).toBeGreaterThan(0);
  });

  it("rejects a chunk with a sealed floor pocket", () => {
    const sealed = CAP_N.rows.slice();
    // Carve an isolated 1-cell room in the solid southern half.
    sealed[13] = "#######..#######";
    expect(validateChunk({ id: "test.sealed", rows: sealed }).length).toBeGreaterThan(0);
  });

  it("enumerates deduped orientations, each matching its own derived mask", () => {
    const os = orientations(CAP_N);
    expect(os.length).toBe(4); // a cap is mirror-symmetric, so 8 transforms collapse to 4
    const masks = os.map((o) => o.mask).sort((a, b) => a - b);
    expect(masks).toEqual([1, 2, 4, 8]);
    for (const o of os) expect(deriveMask(o.rows)).toBe(o.mask);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/mapgen/src/chunks.test.ts`
Expected: FAIL — cannot resolve `./chunks`.

- [ ] **Step 3: Write the implementation**

Create `packages/mapgen/src/chunks.ts`:

```ts
// Authored map chunks: square blocks of ASCII whose edge mask is DERIVED from
// the border, never declared, so the art and the mask cannot disagree.
//
// Alphabet: '#' wall, '.' floor, 's' spawn, 'r' reward, 'b' boss, 'e' exit.
// Everything that is not '#' is walkable.
//
// Opening invariant: an open tile edge is exactly cells OPENING_LO..OPENING_HI
// of that edge and every other border cell is wall. That window is symmetric
// about the tile centre, which is what makes rotation and mirroring closed
// operations on the mask — an off-centre opening would stop matching the
// moment a chunk is mirrored.

export const TILE_CELLS = 16;
export const OPENING_LO = 6;
export const OPENING_HI = 9;

/** N, E, S, W. The grid is row-major with y increasing southward, so N is y-1. */
export type Dir = 0 | 1 | 2 | 3;
export const DIR_VEC: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

export interface Chunk {
  id: string;
  /** Square, side a multiple of TILE_CELLS. rows[y][x], y = 0 is north. */
  rows: string[];
}

/** An open edge on side `side`, on the `index`-th tile along that side. */
export interface Port {
  side: Dir;
  index: number;
}

export interface Oriented {
  /** `${chunk.id}@${turns}` with a trailing "m" when mirrored. */
  id: string;
  rows: string[];
  mask: number;
  ports: Port[];
}

export function isWall(ch: string): boolean {
  return ch === "#";
}

/** 90 degrees clockwise: out[y][x] = rows[n-1-x][y]. */
export function rotateRows(rows: string[]): string[] {
  const n = rows.length;
  const out: string[] = [];
  for (let y = 0; y < n; y++) {
    let line = "";
    for (let x = 0; x < n; x++) line += rows[n - 1 - x]![y]!;
    out.push(line);
  }
  return out;
}

/** Horizontal flip: x -> n-1-x. Swaps E and W, keeps N and S. */
export function mirrorRows(rows: string[]): string[] {
  return rows.map((r) => r.split("").reverse().join(""));
}

/** Clockwise rotation maps N->E->S->W->N, which is a left shift of the bits. */
export function rotateMask(mask: number, turns: number): number {
  const t = ((turns % 4) + 4) % 4;
  return ((mask << t) | (mask >> (4 - t))) & 0b1111;
}

/** Horizontal flip keeps N (1) and S (4), swaps E (2) and W (8). */
export function mirrorMask(mask: number): number {
  return (mask & 0b0101) | ((mask & 0b0010) << 2) | ((mask & 0b1000) >> 2);
}

/** Read the character at position `i` along `side`'s border, walking the side
 *  in the direction that keeps rotation consistent: N and S left-to-right,
 *  E and W top-to-bottom. */
function borderChar(rows: string[], side: Dir, i: number): string {
  const n = rows.length;
  switch (side) {
    case 0: return rows[0]![i]!;
    case 1: return rows[i]![n - 1]!;
    case 2: return rows[n - 1]![i]!;
    default: return rows[i]![0]!;
  }
}

/** Every open tile-edge on the border. A 1x1 chunk has at most 4; the 2x2 boss
 *  block has 8 candidate positions (2 per side). */
export function derivePorts(rows: string[]): Port[] {
  const n = rows.length;
  const tiles = n / TILE_CELLS;
  const out: Port[] = [];
  for (let side = 0 as Dir; side < 4; side = (side + 1) as Dir) {
    for (let t = 0; t < tiles; t++) {
      const base = t * TILE_CELLS;
      let open = true;
      for (let k = OPENING_LO; k <= OPENING_HI; k++) {
        if (isWall(borderChar(rows, side, base + k))) { open = false; break; }
      }
      if (open) out.push({ side, index: t });
    }
  }
  return out;
}

/** The 4-bit edge mask. Only meaningful for a 1x1 chunk. */
export function deriveMask(rows: string[]): number {
  return derivePorts(rows).reduce((m, p) => m | (1 << p.side), 0);
}

/** Structural problems with an authored chunk. Empty array means valid. */
export function validateChunk(chunk: Chunk): string[] {
  const problems: string[] = [];
  const rows = chunk.rows;
  const n = rows.length;
  if (n === 0 || n % TILE_CELLS !== 0) {
    problems.push(`${chunk.id}: side ${n} is not a multiple of ${TILE_CELLS}`);
    return problems;
  }
  for (let y = 0; y < n; y++) {
    if (rows[y]!.length !== n) problems.push(`${chunk.id}: row ${y} is ${rows[y]!.length} wide, want ${n}`);
  }
  if (problems.length) return problems;

  // Border: wall everywhere except inside a fully-open 6..9 window.
  const tiles = n / TILE_CELLS;
  for (let side = 0 as Dir; side < 4; side = (side + 1) as Dir) {
    for (let t = 0; t < tiles; t++) {
      const base = t * TILE_CELLS;
      let open = 0;
      for (let k = OPENING_LO; k <= OPENING_HI; k++) {
        if (!isWall(borderChar(rows, side, base + k))) open++;
      }
      if (open !== 0 && open !== OPENING_HI - OPENING_LO + 1) {
        problems.push(`${chunk.id}: side ${side} tile ${t} has a partial opening (${open}/4)`);
      }
      for (let k = 0; k < TILE_CELLS; k++) {
        if (k >= OPENING_LO && k <= OPENING_HI) continue;
        if (!isWall(borderChar(rows, side, base + k))) {
          problems.push(`${chunk.id}: side ${side} tile ${t} has floor outside the 6..9 window at ${k}`);
        }
      }
    }
  }

  // Every floor cell must be 4-connected to every other one. A sealed chamber
  // strands whatever is in it and fails the layout's reachability gate.
  const total = n * n;
  const walk = new Uint8Array(total);
  let first = -1, floors = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (isWall(rows[y]![x]!)) continue;
      walk[y * n + x] = 1;
      floors++;
      if (first < 0) first = y * n + x;
    }
  }
  if (floors === 0) {
    problems.push(`${chunk.id}: no floor cells`);
    return problems;
  }
  const seen = new Uint8Array(total);
  seen[first] = 1;
  const stack = [first];
  let reached = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const cx = i % n, cy = (i - (i % n)) / n;
    for (const [dx, dy] of DIR_VEC) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (seen[j] || !walk[j]) continue;
      seen[j] = 1;
      reached++;
      stack.push(j);
    }
  }
  if (reached !== floors) {
    problems.push(`${chunk.id}: ${floors - reached} floor cells are sealed off`);
  }
  return problems;
}

/** Every distinct rotate/mirror of a chunk. Symmetric chunks collapse, so a
 *  symmetric piece does not get extra weight when one is picked at random. */
export function orientations(chunk: Chunk): Oriented[] {
  const out: Oriented[] = [];
  const seen = new Set<string>();
  for (const mirror of [false, true]) {
    let rows = mirror ? mirrorRows(chunk.rows) : chunk.rows;
    for (let turns = 0; turns < 4; turns++) {
      if (turns > 0) rows = rotateRows(rows);
      const key = rows.join("\n");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `${chunk.id}@${turns}${mirror ? "m" : ""}`,
        rows,
        mask: deriveMask(rows),
        ports: derivePorts(rows),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/mapgen/src/chunks.test.ts`
Expected: PASS (9 tests).

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/mapgen/src/chunks.ts packages/mapgen/src/chunks.test.ts
git commit -m "feat(mapgen): chunk transforms with masks derived from the border"
```

---

### Task 3: The loop grammar's chunk library

Five canonical chunks, one per edge-mask class, plus the 2x2 boss arena. Rotation supplies every other orientation, so the cap is authored north-open, the corner north-and-east-open, and so on. Mask class 0 is not a chunk — it is solid wall filler the assembler stamps directly.

**Files:**
- Create: `packages/mapgen/src/loop-grammar.ts`
- Modify: `packages/mapgen/src/chunks.test.ts` (add the library invariant suite)

**Interfaces:**
- Consumes: `Chunk`, `validateChunk`, `deriveMask`, `derivePorts`, `orientations` from Task 2.
- Produces:
  - `interface Grammar { id: string; chunks: Chunk[]; bossChunk: Chunk; branchCount: number }`
  - `maskClass(mask: number): "solid" | "cap" | "straight" | "corner" | "tee" | "cross"`
  - `LOOP_GRAMMAR: Grammar`

- [ ] **Step 1: Write the failing test**

Append to `packages/mapgen/src/chunks.test.ts`:

```ts
import { LOOP_GRAMMAR, maskClass } from "./loop-grammar";

describe("loop grammar library", () => {
  it("classifies masks by their open-edge shape", () => {
    expect(maskClass(0b0000)).toBe("solid");
    expect(maskClass(0b0001)).toBe("cap");     // N
    expect(maskClass(0b0101)).toBe("straight");// N|S
    expect(maskClass(0b1010)).toBe("straight");// E|W
    expect(maskClass(0b0011)).toBe("corner");  // N|E
    expect(maskClass(0b0111)).toBe("tee");     // N|E|S
    expect(maskClass(0b1111)).toBe("cross");
  });

  it("every authored chunk is structurally valid", () => {
    for (const c of [...LOOP_GRAMMAR.chunks, LOOP_GRAMMAR.bossChunk]) {
      expect(validateChunk(c), c.id).toEqual([]);
    }
  });

  it("covers every non-solid mask class", () => {
    const covered = new Set(LOOP_GRAMMAR.chunks.map((c) => maskClass(deriveMask(c.rows))));
    expect([...covered].sort()).toEqual(["cap", "corner", "cross", "straight", "tee"]);
  });

  it("can orient a chunk onto every one of the 15 non-solid masks", () => {
    for (let mask = 1; mask <= 15; mask++) {
      const fits = LOOP_GRAMMAR.chunks.flatMap(orientations).filter((o) => o.mask === mask);
      expect(fits.length, `mask ${mask} has no chunk`).toBeGreaterThan(0);
    }
  });

  it("the boss arena is 2x2 tiles with exactly one port", () => {
    const { rows } = LOOP_GRAMMAR.bossChunk;
    expect(rows.length).toBe(TILE_CELLS * 2);
    expect(derivePorts(rows)).toEqual([{ side: 0, index: 0 }]);
  });

  it("the boss arena's 8 orientations cover all 8 possible ports", () => {
    const ports = orientations(LOOP_GRAMMAR.bossChunk).map((o) => `${o.ports[0]!.side}.${o.ports[0]!.index}`);
    expect(new Set(ports).size).toBe(8);
    expect(ports.length).toBe(8);
  });

  it("the boss arena carries exactly one boss and one exit marker", () => {
    const flat = LOOP_GRAMMAR.bossChunk.rows.join("");
    expect(flat.split("b").length - 1).toBe(1);
    expect(flat.split("e").length - 1).toBe(1);
  });

  it("every chunk that is not a cap carries at least one spawn point", () => {
    for (const c of LOOP_GRAMMAR.chunks) {
      if (maskClass(deriveMask(c.rows)) === "cap") continue;
      expect(c.rows.join("").includes("s"), `${c.id} has no spawn point`).toBe(true);
    }
  });

  it("every cap carries a reward point, because caps are the dead ends", () => {
    for (const c of LOOP_GRAMMAR.chunks) {
      if (maskClass(deriveMask(c.rows)) !== "cap") continue;
      expect(c.rows.join("").includes("r"), `${c.id} has no reward point`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/mapgen/src/chunks.test.ts`
Expected: FAIL — cannot resolve `./loop-grammar`.

- [ ] **Step 3: Write the implementation**

Create `packages/mapgen/src/loop-grammar.ts`:

```ts
// The "loop" grammar: the chunk vocabulary for Vaal Stone and Swamp maps.
// Chunks are authored in a canonical orientation (a cap opens north, a corner
// opens north and east); the assembler rotates and mirrors them onto whatever
// mask the skeleton asked for.
//
// Every open edge is cells 6..9 of that border — see the opening invariant in
// chunks.ts. Caps are the dead ends, so they carry the reward markers.
import { deriveMask, type Chunk } from "./chunks";

export interface Grammar {
  id: string;
  /** 1x1 chunks, at least one per non-solid mask class. */
  chunks: Chunk[];
  /** The 2x2 boss arena, authored with a single north port in its west tile. */
  bossChunk: Chunk;
  /** Dead-end spurs hung off the loop. */
  branchCount: number;
}

export type MaskClass = "solid" | "cap" | "straight" | "corner" | "tee" | "cross";

export function maskClass(mask: number): MaskClass {
  const bits = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (bits === 0) return "solid";
  if (bits === 1) return "cap";
  if (bits === 3) return "tee";
  if (bits === 4) return "cross";
  // Two bits: opposite (N|S = 5, E|W = 10) is a straight, adjacent is a corner.
  return mask === 0b0101 || mask === 0b1010 ? "straight" : "corner";
}

/** cap, north-open: a round alcove at the end of a spur. */
const CAP_ALCOVE: Chunk = {
  id: "loop.cap.alcove",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "##............##",
    "##............##",
    "##......r.....##",
    "##............##",
    "##............##",
    "###..........###",
    "####........####",
    "######....######",
    "################",
    "################",
  ],
};

/** straight, north/south-open: a long gallery, the loop's main run. */
const STRAIGHT_GALLERY: Chunk = {
  id: "loop.straight.gallery",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "###..........###",
    "###..........###",
    "###...s..s...###",
    "###..........###",
    "###..........###",
    "###...s..s...###",
    "###..........###",
    "###..........###",
    "###..........###",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/** corner, north/east-open: the loop turns. */
const CORNER_BEND: Chunk = {
  id: "loop.corner.bend",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "####......######",
    "###.......######",
    "###..........###",
    "###...s.........",
    "###.............",
    "###.............",
    "###...s.........",
    "###..........###",
    "###.........####",
    "####.......#####",
    "######..########",
    "################",
    "################",
  ],
};

/** tee, north/east/south-open: where a spur leaves the loop. */
const TEE_CROSSING: Chunk = {
  id: "loop.tee.crossing",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "###..........###",
    "###..........###",
    "###....##.......",
    "###....##.......",
    "###.............",
    "###.............",
    "###..........###",
    "###...s......###",
    "###..........###",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/** cross, all four sides open: an open plaza where routes meet. */
const CROSS_PLAZA: Chunk = {
  id: "loop.cross.plaza",
  rows: [
    "######....######",
    "######....######",
    "###.........####",
    "##............##",
    "##............##",
    "##............##",
    "................",
    "................",
    "................",
    "................",
    "##............##",
    "##.....s......##",
    "##............##",
    "###.........####",
    "######....######",
    "######....######",
  ],
};

/** The boss arena: 2x2 tiles (32x32 cells = 16x16 world units), one port, on
 *  the north side of its west tile. A single 8x8-unit tile cannot hold a boss —
 *  the camera alone sees 19x9.5 units. */
const BOSS_HALL: Chunk = {
  id: "loop.boss.hall",
  rows: [
    "######....######################",
    "######....######################",
    "######....######################",
    "######....######################",
    "######....######################",
    "######....######################",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##......##............##......##",
    "##......##............##......##",
    "##............................##",
    "##.............b..............##",
    "##............................##",
    "##............................##",
    "##......##............##......##",
    "##......##............##......##",
    "##............................##",
    "##.............e..............##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "################################",
    "################################",
    "################################",
    "################################",
    "################################",
    "################################",
  ],
};

export const LOOP_GRAMMAR: Grammar = {
  id: "loop",
  chunks: [CAP_ALCOVE, STRAIGHT_GALLERY, CORNER_BEND, TEE_CROSSING, CROSS_PLAZA],
  bossChunk: BOSS_HALL,
  branchCount: 3,
};

// Authoring guard: the canonical masks must be what the borders actually say.
// A typo in a row would otherwise surface much later as an unmatchable tile.
const CANONICAL: readonly [Chunk, number][] = [
  [CAP_ALCOVE, 0b0001],
  [STRAIGHT_GALLERY, 0b0101],
  [CORNER_BEND, 0b0011],
  [TEE_CROSSING, 0b0111],
  [CROSS_PLAZA, 0b1111],
];
for (const [chunk, mask] of CANONICAL) {
  if (deriveMask(chunk.rows) !== mask) {
    throw new Error(`${chunk.id}: derived mask ${deriveMask(chunk.rows)}, authored for ${mask}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/mapgen/src/chunks.test.ts`
Expected: PASS (18 tests).

If "can orient a chunk onto every one of the 15 non-solid masks" fails, the missing mask names the class whose canonical chunk is mis-authored — re-check that chunk's border against the 6..9 window.

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/mapgen/src/loop-grammar.ts packages/mapgen/src/chunks.test.ts
git commit -m "feat(mapgen): authored chunk library for the loop grammar"
```

---

### Task 4: The route skeleton

Stage 1. Builds a closed cycle on the 7x7 tile lattice, hangs dead-end spurs off it, reserves a 2x2 block for the boss at the greatest route distance from the start, and reports each tile's edge mask. Chunk selection later is a lookup against these masks, so edge matching cannot fail.

The cycle starts as a rectangle ring and is deformed by *bulges*: an edge `a->b` of the cycle is replaced by `a->c->d->b` where `c` and `d` are the perpendicular neighbours of `a` and `b`. A bulge preserves the cycle property by construction, so no repair pass is needed.

**Files:**
- Create: `packages/mapgen/src/skeleton.ts`
- Test: `packages/mapgen/src/skeleton.test.ts`

**Interfaces:**
- Consumes: `Dir`, `DIR_VEC` from Task 2; `RandomStream` from `./rng`.
- Produces:
  - `AREA_TILES = 7`
  - `interface Skeleton { masks: Uint8Array; startTile: TileXY; bossTile: TileXY; bossPort: Port; routeDist: Uint8Array }`
  - `interface TileXY { tx: number; ty: number }`
  - `generateSkeleton(rng: RandomStream, branchCount: number): Skeleton | null`
  - `UNREACHED = 255`

- [ ] **Step 1: Write the failing test**

Create `packages/mapgen/src/skeleton.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createStream } from "./rng";
import { AREA_TILES, UNREACHED, generateSkeleton, type Skeleton } from "./skeleton";
import { DIR_VEC } from "./chunks";

function build(seed: number, branches = 3): Skeleton | null {
  return generateSkeleton(createStream(seed, "test.skeleton"), branches);
}

/** Tiles covered by the 2x2 boss block. */
function bossTiles(s: Skeleton): number[] {
  const out: number[] = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) out.push((s.bossTile.ty + dy) * AREA_TILES + (s.bossTile.tx + dx));
  }
  return out;
}

describe("generateSkeleton", () => {
  it("succeeds for the overwhelming majority of seeds", () => {
    let ok = 0;
    for (let seed = 0; seed < 200; seed++) if (build(seed)) ok++;
    expect(ok).toBeGreaterThan(190);
  });

  it("is deterministic for a given stream", () => {
    const a = build(42)!, b = build(42)!;
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    expect(a.startTile).toEqual(b.startTile);
    expect(a.bossTile).toEqual(b.bossTile);
    expect(a.bossPort).toEqual(b.bossPort);
  });

  it("produces masks that agree across every shared edge", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = build(seed);
      if (!s) continue;
      for (let ty = 0; ty < AREA_TILES; ty++) {
        for (let tx = 0; tx < AREA_TILES; tx++) {
          const m = s.masks[ty * AREA_TILES + tx]!;
          for (let d = 0; d < 4; d++) {
            if (!(m & (1 << d))) continue;
            const nx = tx + DIR_VEC[d]![0], ny = ty + DIR_VEC[d]![1];
            expect(nx >= 0 && ny >= 0 && nx < AREA_TILES && ny < AREA_TILES,
              `seed ${seed}: tile ${tx},${ty} opens off-grid on side ${d}`).toBe(true);
            const back = (d + 2) % 4;
            const nm = s.masks[ny * AREA_TILES + nx]!;
            const isBoss = bossTiles(s).includes(ny * AREA_TILES + nx);
            if (!isBoss) {
              expect(nm & (1 << back),
                `seed ${seed}: ${tx},${ty} opens to ${nx},${ny} but not back`).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it("never opens an edge into the reserved boss block from the wrong side", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = build(seed);
      if (!s) continue;
      // The boss block's own tiles carry no mask: the 2x2 chunk covers them.
      for (const i of bossTiles(s)) expect(s.masks[i]).toBe(0);
    }
  });

  it("puts the start on the outermost occupied ring", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = build(seed);
      if (!s) continue;
      const rim = (t: { tx: number; ty: number }) => Math.max(Math.abs(t.tx - 3), Math.abs(t.ty - 3));
      let best = 0;
      for (let ty = 0; ty < AREA_TILES; ty++) {
        for (let tx = 0; tx < AREA_TILES; tx++) {
          if (s.masks[ty * AREA_TILES + tx]) best = Math.max(best, rim({ tx, ty }));
        }
      }
      expect(rim(s.startTile), `seed ${seed}`).toBe(best);
    }
  });

  it("reaches every routed tile from the start", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = build(seed);
      if (!s) continue;
      for (let i = 0; i < s.masks.length; i++) {
        if (s.masks[i] === 0) continue;
        expect(s.routeDist[i], `seed ${seed}: tile ${i} is stranded`).not.toBe(UNREACHED);
      }
    }
  });

  it("hangs the requested number of dead-end spurs off the loop", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = build(seed, 3);
      if (!s) continue;
      let caps = 0;
      for (const m of s.masks) {
        const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
        if (bits === 1) caps++;
      }
      // Each spur is a cap. The tile anchoring the boss block is not a cap
      // because it keeps its loop edges, so caps count spurs exactly.
      expect(caps, `seed ${seed}`).toBe(3);
    }
  });

  it("places the boss farther by route than the start", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = build(seed);
      if (!s) continue;
      const bossDist = s.routeDist[s.bossTile.ty * AREA_TILES + s.bossTile.tx];
      expect(bossDist, `seed ${seed}`).toBeGreaterThan(2);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/mapgen/src/skeleton.test.ts`
Expected: FAIL — cannot resolve `./skeleton`.

- [ ] **Step 3: Write the implementation**

Create `packages/mapgen/src/skeleton.ts`:

```ts
// Stage 1 of area generation: the route graph on the tile lattice.
//
// A closed cycle (the loop) with dead-end spurs and a reserved 2x2 boss block.
// The output is a 4-bit open-edge mask per tile, and because the masks are
// decided here — before any chunk is picked — chunk selection downstream is a
// lookup that cannot fail to edge-match.
import { DIR_VEC, type Dir, type Port } from "./chunks";
import type { RandomStream } from "./rng";

export const AREA_TILES = 7;
/** routeDist value for a tile that is not on the route. */
export const UNREACHED = 255;

export interface TileXY {
  tx: number;
  ty: number;
}

export interface Skeleton {
  /** AREA_TILES*AREA_TILES, row-major. 4-bit open-edge mask; 0 = solid filler. */
  masks: Uint8Array;
  startTile: TileXY;
  /** North-west tile of the 2x2 boss block. Its four tiles have mask 0. */
  bossTile: TileXY;
  /** Which edge of the boss block the route enters by. */
  bossPort: Port;
  /** Route distance in tiles from startTile; UNREACHED off the route. */
  routeDist: Uint8Array;
}

const N = AREA_TILES;
const idx = (tx: number, ty: number): number => ty * N + tx;
const inBounds = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < N && ty < N;

/** The perimeter of a rectangle, as a cycle of 4-adjacent tiles. */
function ringCycle(x0: number, y0: number, x1: number, y1: number): TileXY[] {
  const out: TileXY[] = [];
  for (let x = x0; x <= x1; x++) out.push({ tx: x, ty: y0 });
  for (let y = y0 + 1; y <= y1; y++) out.push({ tx: x1, ty: y });
  for (let x = x1 - 1; x >= x0; x--) out.push({ tx: x, ty: y1 });
  for (let y = y1 - 1; y > y0; y--) out.push({ tx: x0, ty: y });
  return out;
}

/** Replace one cycle edge a->b with a->c->d->b, where c and d are the
 *  perpendicular neighbours. Preserves the cycle, so no repair pass is needed. */
function bulge(loop: TileXY[], rng: RandomStream): void {
  const i = rng.nextInt(0, loop.length - 1);
  const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
  const dx = b.tx - a.tx, dy = b.ty - a.ty;
  // The two perpendiculars of the edge direction.
  const perps: [number, number][] = [[-dy, dx], [dy, -dx]];
  const firstIsLeft = rng.nextInt(0, 1) === 0;
  const ordered = firstIsLeft ? perps : [perps[1]!, perps[0]!];
  const occupied = new Set(loop.map((t) => idx(t.tx, t.ty)));
  for (const [px, py] of ordered) {
    const c = { tx: a.tx + px, ty: a.ty + py };
    const d = { tx: b.tx + px, ty: b.ty + py };
    if (!inBounds(c.tx, c.ty) || !inBounds(d.tx, d.ty)) continue;
    if (occupied.has(idx(c.tx, c.ty)) || occupied.has(idx(d.tx, d.ty))) continue;
    loop.splice(i + 1, 0, c, d);
    return;
  }
}

function connect(masks: Uint8Array, a: TileXY, b: TileXY): void {
  const dx = b.tx - a.tx, dy = b.ty - a.ty;
  const d = DIR_VEC.findIndex(([vx, vy]) => vx === dx && vy === dy);
  if (d < 0) return;
  masks[idx(a.tx, a.ty)] |= 1 << d;
  masks[idx(b.tx, b.ty)] |= 1 << ((d + 2) % 4);
}

function bfs(masks: Uint8Array, start: TileXY): Uint8Array {
  const dist = new Uint8Array(N * N).fill(UNREACHED);
  dist[idx(start.tx, start.ty)] = 0;
  const queue: TileXY[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head]!;
    const m = masks[idx(t.tx, t.ty)]!;
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const nx = t.tx + DIR_VEC[d]![0], ny = t.ty + DIR_VEC[d]![1];
      if (!inBounds(nx, ny) || dist[idx(nx, ny)] !== UNREACHED) continue;
      dist[idx(nx, ny)] = dist[idx(t.tx, t.ty)]! + 1;
      queue.push({ tx: nx, ty: ny });
    }
  }
  return dist;
}

/** How far a tile sits from the lattice centre; the outermost ring is the rim. */
const rimScore = (t: TileXY): number =>
  Math.max(Math.abs(t.tx - (N - 1) / 2), Math.abs(t.ty - (N - 1) / 2));

export function generateSkeleton(rng: RandomStream, branchCount: number): Skeleton | null {
  // 1. A rectangle ring, deformed by bulges into an irregular closed loop.
  const x0 = rng.nextInt(0, 1), x1 = rng.nextInt(N - 2, N - 1);
  const y0 = rng.nextInt(0, 1), y1 = rng.nextInt(N - 2, N - 1);
  const loop = ringCycle(x0, y0, x1, y1);
  const bulges = rng.nextInt(3, 6);
  for (let k = 0; k < bulges; k++) bulge(loop, rng);

  const masks = new Uint8Array(N * N);
  for (let i = 0; i < loop.length; i++) connect(masks, loop[i]!, loop[(i + 1) % loop.length]!);

  const onRoute = new Set(loop.map((t) => idx(t.tx, t.ty)));

  // 2. Dead-end spurs off the loop.
  const spurs: TileXY[] = [];
  for (let b = 0; b < branchCount; b++) {
    const candidates: [TileXY, TileXY][] = [];
    for (const t of loop) {
      for (const [dx, dy] of DIR_VEC) {
        const n = { tx: t.tx + dx, ty: t.ty + dy };
        if (!inBounds(n.tx, n.ty) || onRoute.has(idx(n.tx, n.ty))) continue;
        candidates.push([t, n]);
      }
    }
    if (candidates.length === 0) return null;
    const [anchor, spur] = candidates[rng.nextInt(0, candidates.length - 1)]!;
    connect(masks, anchor, spur);
    onRoute.add(idx(spur.tx, spur.ty));
    spurs.push(spur);
  }

  // 3. Start: any routed tile on the outermost occupied ring.
  const routed = [...onRoute].map((i) => ({ tx: i % N, ty: (i - (i % N)) / N }));
  const best = Math.max(...routed.map(rimScore));
  const rim = routed.filter((t) => rimScore(t) === best);
  const startTile = rim[rng.nextInt(0, rim.length - 1)]!;

  // 4. Boss: a free 2x2 block hung off the routed tile farthest by route.
  const dist = bfs(masks, startTile);
  const byDistance = [...routed].sort((a, b) => {
    const d = (dist[idx(b.tx, b.ty)]! % UNREACHED) - (dist[idx(a.tx, a.ty)]! % UNREACHED);
    return d !== 0 ? d : idx(a.tx, a.ty) - idx(b.tx, b.ty); // stable, seed-independent
  });
  for (const anchor of byDistance) {
    if (dist[idx(anchor.tx, anchor.ty)] === UNREACHED) continue;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const nx = anchor.tx + DIR_VEC[d]![0], ny = anchor.ty + DIR_VEC[d]![1];
      if (!inBounds(nx, ny) || onRoute.has(idx(nx, ny))) continue;
      // The neighbour must be a corner of a free, in-bounds 2x2 block.
      for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
        const bx = nx + ox, by = ny + oy;
        if (!inBounds(bx, by) || !inBounds(bx + 1, by + 1)) continue;
        let free = true;
        for (let k = 0; k < 4 && free; k++) {
          const cx = bx + (k % 2), cy = by + (k < 2 ? 0 : 1);
          if (onRoute.has(idx(cx, cy))) free = false;
        }
        if (!free) continue;
        // The port is on the block side facing the anchor, at the tile the
        // anchor touches. Sides run N/S west-to-east and E/W north-to-south.
        const side = ((d + 2) % 4) as Dir;
        const index = side === 0 || side === 2 ? nx - bx : ny - by;
        masks[idx(anchor.tx, anchor.ty)] |= 1 << d;
        return {
          masks,
          startTile,
          bossTile: { tx: bx, ty: by },
          bossPort: { side, index },
          routeDist: bfs(masks, startTile),
        };
      }
    }
  }
  return null; // no legal boss block; the caller falls back
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/mapgen/src/skeleton.test.ts`
Expected: PASS (8 tests).

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/mapgen/src/skeleton.ts packages/mapgen/src/skeleton.test.ts
git commit -m "feat(mapgen): route skeleton with loop, spurs and a reserved boss block"
```

---

### Task 5: The area assembler

Stages 2 through 5: stamp a chunk into every routed tile, stamp the boss arena over its reserved block, read the anchors and spawn points out of the stamped markers, then rotate the whole area. Returns a validated `AreaLayout` at 112x112 cells, or the existing 80-cell fallback if a gate fails.

**Files:**
- Create: `packages/mapgen/src/assemble-area.ts`
- Test: `packages/mapgen/src/assemble-area.test.ts`
- Modify: `packages/mapgen/src/index.ts`

**Interfaces:**
- Consumes: `buildLayout`, `cellCentre`, `worldToCell`, `SPAWN_TARGET`, `AreaLayout`, `Socket` (Task 1); `TILE_CELLS`, `orientations`, `isWall`, `type Oriented` (Task 2); `Grammar`, `maskClass`, `LOOP_GRAMMAR` (Task 3); `AREA_TILES`, `generateSkeleton`, `UNREACHED` (Task 4); `fallbackLayout` from `./mapgen`.
- Produces: `ASSEMBLED_CELLS = 112`, `assembleArea(seed: string extends never ? never : number, contentVersion: string, grammar: Grammar): AreaLayout`.

- [ ] **Step 1: Write the failing test**

Create `packages/mapgen/src/assemble-area.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ASSEMBLED_CELLS, assembleArea } from "./assemble-area";
import { LOOP_GRAMMAR } from "./loop-grammar";
import { SPAWN_TARGET } from "./grid";

const V = "content.test.v1";
const gen = (seed: number) => assembleArea(seed, V, LOOP_GRAMMAR);

describe("assembleArea", () => {
  it("is deterministic: same seed produces an identical grid and hash", () => {
    const a = gen(1234), b = gen(1234);
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.grid.cells)).toEqual(Array.from(b.grid.cells));
    expect(a.objectiveAnchors).toEqual(b.objectiveAnchors);
    expect(a.spawnSockets).toEqual(b.spawnSockets);
    expect(a.chosenVariantIds).toEqual(b.chosenVariantIds);
  });

  it("produces a 112x112 grid, 56 world units across", () => {
    const { grid } = gen(7);
    expect(ASSEMBLED_CELLS).toBe(112);
    expect(grid.cols).toBe(112);
    expect(grid.rows).toBe(112);
    expect(grid.cols * grid.cellSize).toBe(56);
  });

  it("never returns an invalid layout: 200 seeds all pass every gate", () => {
    for (let seed = 0; seed < 200; seed++) {
      const layout = gen(seed);
      expect(layout.validationChecks.every((c) => c.passed), `seed ${seed}`).toBe(true);
    }
  });

  it("assembles rather than falling back for the overwhelming majority of seeds", () => {
    let assembled = 0;
    for (let seed = 0; seed < 200; seed++) if (!gen(seed).usedFallback) assembled++;
    expect(assembled).toBeGreaterThan(190);
  });

  it("has no wall facing floor across any tile seam", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { grid, usedFallback } = gen(seed);
      if (usedFallback) continue;
      const at = (x: number, y: number) => grid.cells[y * grid.cols + x]!;
      // Vertical seams: every 16 cells, compare the cell either side.
      for (let tx = 1; tx < 7; tx++) {
        const x = tx * 16;
        for (let y = 0; y < grid.rows; y++) {
          expect(at(x - 1, y) === at(x, y) || at(x - 1, y) === 0 || at(x, y) === 0,
            `seed ${seed}: vertical seam at ${x},${y}`).toBe(true);
        }
      }
      // A seam is legal only where both sides are floor or both are wall.
      for (let tx = 1; tx < 7; tx++) {
        const x = tx * 16;
        for (let y = 0; y < grid.rows; y++) {
          expect(at(x - 1, y), `seed ${seed}: seam mismatch at ${x},${y}`).toBe(at(x, y));
        }
      }
      for (let ty = 1; ty < 7; ty++) {
        const y = ty * 16;
        for (let x = 0; x < grid.cols; x++) {
          expect(at(x, y - 1), `seed ${seed}: seam mismatch at ${x},${y}`).toBe(at(x, y));
        }
      }
    }
  });

  it("walls the whole outer boundary", () => {
    for (const seed of [0, 5, 42, 99, 777]) {
      const { grid } = gen(seed);
      const { cols, rows, cells } = grid;
      for (let x = 0; x < cols; x++) {
        expect(cells[x], `seed ${seed} top ${x}`).toBe(0);
        expect(cells[(rows - 1) * cols + x], `seed ${seed} bottom ${x}`).toBe(0);
      }
      for (let y = 0; y < rows; y++) {
        expect(cells[y * cols], `seed ${seed} left ${y}`).toBe(0);
        expect(cells[y * cols + cols - 1], `seed ${seed} right ${y}`).toBe(0);
      }
    }
  });

  it("always has start, boss and exit anchors", () => {
    for (const seed of [0, 5, 42, 99, 777]) {
      const ids = gen(seed).objectiveAnchors.map((a) => a.id);
      expect(ids).toContain("start");
      expect(ids).toContain("boss");
      expect(ids).toContain("exit");
    }
  });

  it("keeps spawns clear of the start so the player gets a safe entry beat", () => {
    const SAFE = 10;
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      for (const sp of layout.spawnSockets) {
        const d = Math.hypot(sp.x - start.x, sp.y - start.y);
        expect(d, `seed ${seed} spawn ${sp.id} at ${d.toFixed(1)}`).toBeGreaterThanOrEqual(SAFE);
      }
    }
  });

  it("spends the spawn budget", () => {
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      expect(layout.spawnSockets.length, `seed ${seed}`).toBe(SPAWN_TARGET);
    }
  });

  it("puts a reward at the end of every dead-end spur", () => {
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const rewards = layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."));
      expect(rewards.length, `seed ${seed}`).toBe(LOOP_GRAMMAR.branchCount);
    }
  });

  it("records the chunk and orientation of every stamped tile", () => {
    const layout = gen(3);
    if (layout.usedFallback) return;
    expect(layout.chosenVariantIds.length).toBeGreaterThan(8);
    for (const id of layout.chosenVariantIds) {
      expect(id, `malformed proof id ${id}`).toMatch(/^\d,\d:[a-z.]+@[0-3]m?$/);
    }
    expect(layout.chosenVariantIds.some((id) => id.includes("loop.boss.hall"))).toBe(true);
  });

  it("re-arranges the same vocabulary: different seeds, different assemblies", () => {
    const proofs = new Set<string>();
    for (let seed = 0; seed < 20; seed++) proofs.add(gen(seed).chosenVariantIds.join("|"));
    expect(proofs.size).toBeGreaterThan(15);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/mapgen/src/assemble-area.test.ts`
Expected: FAIL — cannot resolve `./assemble-area`.

- [ ] **Step 3: Write the implementation**

Create `packages/mapgen/src/assemble-area.ts`:

```ts
// Stages 2-5 of area generation: stamp chunks onto the skeleton, read the
// anchors and spawns out of the stamped markers, rotate the whole area.
//
// Each stage draws from its own named RNG sub-stream, so adding a chunk to the
// library cannot shift the boss position chosen by a different stage.
import { fallbackLayout } from "./mapgen";
import { createStream } from "./rng";
import {
  SPAWN_TARGET,
  buildLayout,
  cellCentre,
  worldToCell,
  type AreaLayout,
  type Socket,
} from "./grid";
import { TILE_CELLS, isWall, orientations, type Oriented } from "./chunks";
import { maskClass, type Grammar } from "./loop-grammar";
import { AREA_TILES, UNREACHED, generateSkeleton } from "./skeleton";

export const ASSEMBLED_CELLS = AREA_TILES * TILE_CELLS; // 112

/** World units of breathing room the player gets around the start. */
const SPAWN_SAFE_RADIUS = 10;

interface Marker {
  ch: string;
  cx: number;
  cy: number;
}

/** Copy an oriented chunk into the cell grid at a tile origin, collecting its
 *  markers in absolute cell coordinates. */
function stamp(cells: Uint8Array, rows: string[], ox: number, oy: number): Marker[] {
  const markers: Marker[] = [];
  for (let y = 0; y < rows.length; y++) {
    const line = rows[y]!;
    for (let x = 0; x < line.length; x++) {
      const ch = line[x]!;
      const cx = ox + x, cy = oy + y;
      cells[cy * ASSEMBLED_CELLS + cx] = isWall(ch) ? 0 : 1;
      if (ch !== "#" && ch !== ".") markers.push({ ch, cx, cy });
    }
  }
  return markers;
}

/** The floor cell nearest a tile's centre — a chunk may have a pillar there. */
function tileCentreCell(cells: Uint8Array, tx: number, ty: number): { cx: number; cy: number } | null {
  const ox = tx * TILE_CELLS, oy = ty * TILE_CELLS;
  const mid = (TILE_CELLS - 1) / 2;
  let best: { cx: number; cy: number } | null = null;
  let bestD = Infinity;
  for (let y = 0; y < TILE_CELLS; y++) {
    for (let x = 0; x < TILE_CELLS; x++) {
      const cx = ox + x, cy = oy + y;
      if (cells[cy * ASSEMBLED_CELLS + cx] !== 1) continue;
      const d = (x - mid) * (x - mid) + (y - mid) * (y - mid);
      if (d < bestD) { bestD = d; best = { cx, cy }; }
    }
  }
  return best;
}

/** Rotate the grid 90 degrees clockwise: (cx,cy) -> (size-1-cy, cx). */
function rotateCells(cells: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[x * size + (size - 1 - y)] = cells[y * size + x]!;
  }
  return out;
}

function rotateSocket(s: Socket, size: number, turns: number): Socket {
  let { cx, cy } = worldToCell(size, s.x, s.y);
  for (let t = 0; t < turns; t++) {
    const nx = size - 1 - cy, ny = cx;
    cx = nx; cy = ny;
  }
  return { id: s.id, ...cellCentre(size, cx, cy) };
}

export function assembleArea(seed: number, contentVersion: string, grammar: Grammar): AreaLayout {
  const skeleton = generateSkeleton(
    createStream(seed, `${contentVersion}.layout.skeleton`),
    grammar.branchCount,
  );
  if (!skeleton) return fallbackLayout(seed, contentVersion);

  // Stage 2: one chunk per routed tile, oriented onto the mask the skeleton set.
  const chunkRng = createStream(seed, `${contentVersion}.layout.chunks`);
  const byClass = new Map<string, Oriented[][]>();
  for (const chunk of grammar.chunks) {
    const os = orientations(chunk);
    const cls = maskClass(os[0]!.mask);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(os);
  }

  let cells = new Uint8Array(ASSEMBLED_CELLS * ASSEMBLED_CELLS);
  const markers: Marker[] = [];
  const markersByTile = new Map<number, Marker[]>();
  const chosenVariantIds: string[] = [];

  for (let ty = 0; ty < AREA_TILES; ty++) {
    for (let tx = 0; tx < AREA_TILES; tx++) {
      const mask = skeleton.masks[ty * AREA_TILES + tx]!;
      if (mask === 0) continue; // solid filler, or a tile the boss block covers
      const variants = byClass.get(maskClass(mask));
      if (!variants || variants.length === 0) return fallbackLayout(seed, contentVersion);
      const variant = variants[chunkRng.nextInt(0, variants.length - 1)]!;
      const fits = variant.filter((o) => o.mask === mask);
      if (fits.length === 0) return fallbackLayout(seed, contentVersion);
      const pick = fits[chunkRng.nextInt(0, fits.length - 1)]!;
      const got = stamp(cells, pick.rows, tx * TILE_CELLS, ty * TILE_CELLS);
      markers.push(...got);
      markersByTile.set(ty * AREA_TILES + tx, got);
      chosenVariantIds.push(`${tx},${ty}:${pick.id}`);
    }
  }

  // Stage 3 (part): the boss arena covers its reserved 2x2 block. Orient it by
  // re-deriving the port of each transform rather than reasoning about how a
  // port maps under rotation.
  const bossFit = orientations(grammar.bossChunk).find(
    (o) => o.ports.length === 1 &&
      o.ports[0]!.side === skeleton.bossPort.side &&
      o.ports[0]!.index === skeleton.bossPort.index,
  );
  if (!bossFit) return fallbackLayout(seed, contentVersion);
  const bossMarkers = stamp(
    cells,
    bossFit.rows,
    skeleton.bossTile.tx * TILE_CELLS,
    skeleton.bossTile.ty * TILE_CELLS,
  );
  markers.push(...bossMarkers);
  chosenVariantIds.push(`${skeleton.bossTile.tx},${skeleton.bossTile.ty}:${bossFit.id}`);

  // Stage 3: anchors. The player arrives by portal, so the start is a point
  // inside a rim tile, not a door in the outer wall.
  const startCell = tileCentreCell(cells, skeleton.startTile.tx, skeleton.startTile.ty);
  const bossMarker = markers.find((m) => m.ch === "b");
  const exitMarker = markers.find((m) => m.ch === "e");
  if (!startCell || !bossMarker || !exitMarker) return fallbackLayout(seed, contentVersion);

  let objectiveAnchors: Socket[] = [
    { id: "start", ...cellCentre(ASSEMBLED_CELLS, startCell.cx, startCell.cy) },
    { id: "boss", ...cellCentre(ASSEMBLED_CELLS, bossMarker.cx, bossMarker.cy) },
    { id: "exit", ...cellCentre(ASSEMBLED_CELLS, exitMarker.cx, exitMarker.cy) },
  ];
  const start = objectiveAnchors[0]!;

  // Stage 4: spawns, one per tile in descending route order so they spread out
  // and land far from the entrance. A second pass takes extra points from the
  // same tiles if the first pass came up short.
  const farthestFirst = [...markersByTile.keys()].sort((a, b) => {
    const d = (skeleton.routeDist[b] ?? UNREACHED) - (skeleton.routeDist[a] ?? UNREACHED);
    return d !== 0 ? d : a - b;
  });
  const spawnSockets: Socket[] = [];
  const farEnough = (m: Marker): boolean => {
    const p = cellCentre(ASSEMBLED_CELLS, m.cx, m.cy);
    return Math.hypot(p.x - start.x, p.y - start.y) >= SPAWN_SAFE_RADIUS;
  };
  for (let perTile = 1; perTile <= 4 && spawnSockets.length < SPAWN_TARGET; perTile++) {
    for (const tile of farthestFirst) {
      if (spawnSockets.length >= SPAWN_TARGET) break;
      const candidates = (markersByTile.get(tile) ?? []).filter((m) => m.ch === "s" && farEnough(m));
      const m = candidates[perTile - 1];
      if (!m) continue;
      spawnSockets.push({ id: `spawn.${spawnSockets.length}`, ...cellCentre(ASSEMBLED_CELLS, m.cx, m.cy) });
    }
  }

  // Stage 5: rewards at the dead ends, then one rotation of the whole area.
  // Per-tile rotation cannot turn the skeleton; only this can.
  let rewardCount = 0;
  for (const tile of farthestFirst) {
    const mask = skeleton.masks[tile]!;
    if (maskClass(mask) !== "cap") continue;
    const m = (markersByTile.get(tile) ?? []).find((k) => k.ch === "r");
    if (!m) continue;
    objectiveAnchors.push({ id: `reward.${rewardCount++}`, ...cellCentre(ASSEMBLED_CELLS, m.cx, m.cy) });
  }

  const turns = createStream(seed, `${contentVersion}.layout.dressing`).nextInt(0, 3);
  for (let t = 0; t < turns; t++) cells = rotateCells(cells, ASSEMBLED_CELLS);
  const spun = (s: Socket) => rotateSocket(s, ASSEMBLED_CELLS, turns);
  objectiveAnchors = objectiveAnchors.map(spun);

  const layout = buildLayout({
    size: ASSEMBLED_CELLS,
    seed,
    contentVersion,
    usedFallback: false,
    cells,
    objectiveAnchors,
    spawnSockets: spawnSockets.map(spun),
    chosenVariantIds,
  });
  if (!layout.validationChecks.every((c) => c.passed)) return fallbackLayout(seed, contentVersion);
  return layout;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/mapgen/src/assemble-area.test.ts`
Expected: PASS (12 tests).

If "assembles rather than falling back" comes in under 190, log which stage returned early (skeleton null, no fitting chunk, or a failed gate) before changing any numbers — the fallback is meant to be rare, and a common fallback means a real bug upstream, not a threshold to lower.

- [ ] **Step 5: Export the new surface**

Replace `packages/mapgen/src/index.ts` with:

```ts
export {
  generateArea,
  fallbackLayout,
  ALGORITHM_VERSION,
  CELL_SIZE,
  GRID_CELLS,
  MIN_ROUTE_WIDTH,
} from "./mapgen";
export type { AreaLayout, WalkableGrid, Socket, ValidationCheck } from "./mapgen";
export { assembleArea, ASSEMBLED_CELLS } from "./assemble-area";
export { LOOP_GRAMMAR, maskClass, type Grammar } from "./loop-grammar";
export { AREA_TILES } from "./skeleton";
export { TILE_CELLS, type Chunk } from "./chunks";
```

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — 932 existing tests plus the new ones. `packages/replay` must be green without regenerating a golden, which is the proof that this slice left `generateArea` alone.

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add packages/mapgen/src/assemble-area.ts packages/mapgen/src/assemble-area.test.ts packages/mapgen/src/index.ts
git commit -m "feat(mapgen): assemble areas from authored chunks on a 7x7 tile lattice"
```

---

### Task 6: Fill the library to three variants per class

The assembler works with one chunk per class, but one chunk per class means every corner in every map is the same corner. This task raises the library to the spec's 3 variants per class (15 chunks). No production code changes — the tests from Tasks 2 and 3 already gate every invariant, and the assembler already picks a variant at random per tile.

**Files:**
- Modify: `packages/mapgen/src/loop-grammar.ts`
- Modify: `packages/mapgen/src/chunks.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5. Adds no new exports.

- [ ] **Step 1: Write the failing test**

Add to the `loop grammar library` describe block in `packages/mapgen/src/chunks.test.ts`:

```ts
  it("carries three variants of every mask class", () => {
    const counts = new Map<string, number>();
    for (const c of LOOP_GRAMMAR.chunks) {
      const cls = maskClass(deriveMask(c.rows));
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
    for (const cls of ["cap", "straight", "corner", "tee", "cross"]) {
      expect(counts.get(cls), `${cls} variants`).toBe(3);
    }
    expect(LOOP_GRAMMAR.chunks.length).toBe(15);
  });

  it("gives every chunk a distinct id and distinct geometry", () => {
    const ids = LOOP_GRAMMAR.chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const shapes = LOOP_GRAMMAR.chunks.map((c) => c.rows.join("\n"));
    expect(new Set(shapes).size).toBe(shapes.length);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/mapgen/src/chunks.test.ts`
Expected: FAIL — `cap variants: expected 1 to be 3`.

- [ ] **Step 3: Author ten more chunks**

Add two more variants for each of the five classes to `loop-grammar.ts`, following the canonical orientations already established: cap opens **N**, straight opens **N|S**, corner opens **N|E**, tee opens **N|E|S**, cross opens on all four sides.

Every new chunk must satisfy, and is machine-checked against, the rules already in `validateChunk`:
- 16 rows of 16 characters.
- Each open border is exactly `......` at columns/rows 6..9 of that edge; every other border cell is `#`.
- All floor cells are 4-connected — no sealed chambers.
- Non-cap chunks carry at least one `s`; caps carry at least one `r`.

Aim each variant at a different tactical read rather than a different doodle, because the point is that the player learns the piece:

| Class | Variant 2 | Variant 3 |
|---|---|---|
| cap | `loop.cap.vault` — a rectangular strongroom, reward against the back wall | `loop.cap.shrine` — a walled inner chamber open only to the south, reward inside |
| straight | `loop.straight.colonnade` — two rows of pillars, cover down the whole run | `loop.straight.narrows` — the gallery pinched to 4 cells at its middle, a choke |
| corner | `loop.corner.sweep` — a wide rounded turn with no cover | `loop.corner.buttress` — a wall block on the inside of the turn, blind approach |
| tee | `loop.tee.landing` — the junction opens into a room on the branch side | `loop.tee.gate` — the branch leaves through a 4-cell gap in a spine wall |
| cross | `loop.cross.court` — a square court with four corner blocks | `loop.cross.island` — a solid block dead centre, the plaza becomes a ring |

Add each to the `chunks` array of `LOOP_GRAMMAR`, and add each to the `CANONICAL` authoring guard at the foot of the file with its intended mask so a typo fails at import rather than at assembly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/mapgen`
Expected: PASS. `validateChunk` reports the exact chunk id and the exact border position of any authoring mistake.

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 5: Confirm the variation actually landed**

Run: `npx vitest run packages/mapgen/src/assemble-area.test.ts`
Expected: PASS, and "re-arranges the same vocabulary" should now clear its threshold by a wide margin — with 3 variants per class, 20 seeds should give 20 distinct assemblies.

- [ ] **Step 6: Commit**

```bash
git add packages/mapgen/src/loop-grammar.ts packages/mapgen/src/chunks.test.ts
git commit -m "feat(mapgen): three variants per mask class in the loop library"
```

---

## What this slice does not do

Named here so the next slice does not have to rediscover it:

- `generateArea` still returns the old 80-cell disc. Nothing in `apps/web` or `packages/simulation` sees an assembled area yet.
- Rewards ride in `objectiveAnchors` as `reward.N` rather than a new `AreaLayout` field, because a new field changes the layout hash and would force a golden regeneration this slice deliberately avoids.
- No minimap, no biomes, no tilesets, no `MapBase` — slices 2 through 4.
- The `open-field` grammar and its organic outer mask are slice 5. The lattice will be more visible there than in `loop`, and the spec's mitigation (reusing the wobbly disc as a rim mask) has not been prototyped.
