// Authored map chunks: square blocks of ASCII whose edge mask is DERIVED from
// the border, never declared, so the art and the mask cannot disagree.
//
// Alphabet: '#' wall, '.' floor, 's' spawn, 'r' reward, 'b' boss, 'e' exit.
// Everything that is not '#' is walkable.
//
// Opening invariant: an open tile edge is a single contiguous window centred
// on the tile, either OPENING_LO..OPENING_HI (width 4) or 2..13 (width 12), and
// every other border cell is wall. Both widths are symmetric about the tile
// centre, which is what makes rotation and mirroring closed operations on the
// mask — an off-centre opening would stop matching the moment a chunk is
// mirrored. Corners (cells 0, 1, 14, 15) stay wall on every edge under both
// widths, which is why the wide window stops at 12 rather than going to 16.

export const TILE_CELLS = 16;
export const OPENING_LO = 6;
export const OPENING_HI = 9;
const OPEN_WIDTHS = [4, 12] as const;

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

  // Border: wall everywhere except inside a single contiguous, centred window
  // of an allowed width. Every allowed window contains 6..9, so checking which
  // width (if any) matches the open cells is enough to validate the edge.
  const tiles = n / TILE_CELLS;
  for (let side = 0 as Dir; side < 4; side = (side + 1) as Dir) {
    for (let t = 0; t < tiles; t++) {
      const base = t * TILE_CELLS;
      const openAt: number[] = [];
      for (let k = 0; k < TILE_CELLS; k++) {
        if (!isWall(borderChar(rows, side, base + k))) openAt.push(k);
      }
      if (openAt.length === 0) continue;
      const width = OPEN_WIDTHS.find((w) => w === openAt.length);
      const lo = (TILE_CELLS - (width ?? 0)) / 2;
      const hi = lo + (width ?? 0) - 1;
      const centred = width !== undefined && openAt[0] === lo && openAt[openAt.length - 1] === hi;
      if (!centred) {
        problems.push(
          `${chunk.id}: side ${side} tile ${t} opening is not a centred 4- or 12-wide window (open at ${openAt.join(",")})`,
        );
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

/**
 * Import-time guard for an authored library: every chunk must be structurally
 * valid AND derive the mask it was authored for. It reports every problem at
 * once, because fixing 16x16 ASCII one thrown error per run is miserable.
 */
export function assertAuthored(
  canonical: readonly (readonly [Chunk, number])[],
  boss: Chunk,
): void {
  const problems: string[] = [];
  for (const [chunk, mask] of canonical) {
    problems.push(...validateChunk(chunk));
    const got = deriveMask(chunk.rows);
    if (got !== mask) problems.push(`${chunk.id}: derived mask ${got}, authored for ${mask}`);
  }
  problems.push(...validateChunk(boss));
  const bossPorts = derivePorts(boss.rows);
  if (bossPorts.length !== 1) {
    problems.push(`${boss.id}: ${bossPorts.length} ports, want exactly 1`);
  }
  if (problems.length > 0) throw new Error(`chunk library:\n  ${problems.join("\n  ")}`);
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
