// Stages 2-5 of area generation: stamp chunks onto the skeleton, read the
// anchors and spawns out of the stamped markers, rotate the whole area.
//
// Each stage draws from its own named RNG sub-stream, so adding a chunk to the
// library cannot shift the boss position chosen by a different stage.
import { fallbackLayout } from "./fallback";
import { createStream, type RandomStream } from "./rng";
import {
  bfsReachable,
  buildLayout,
  cellCentre,
  worldToCell,
  type AreaLayout,
  type Socket,
} from "./grid";
import { DIR_VEC, TILE_CELLS, isWall, orientations, type Dir, type Oriented } from "./chunks";
import { maskClass, type Grammar } from "./loop-grammar";
import { AREA_TILES, UNREACHED, generateSkeleton } from "./skeleton";

export const ASSEMBLED_CELLS = AREA_TILES * TILE_CELLS; // 144

/** World units of breathing room the player gets around the start. */
export const SPAWN_SAFE_RADIUS = 10;

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

/** Every cell of the 3x3 block centred here is floor. A body of the player's
 *  radius (0.5 units = one cell) only fits where that holds: collision refuses
 *  a step whose footprint touches a wall, so a start cell with a pillar against
 *  it is a player who portals in and cannot move in ANY direction. */
function bodyFits(cells: Uint8Array, cx: number, cy: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= ASSEMBLED_CELLS || y >= ASSEMBLED_CELLS) return false;
      if (cells[y * ASSEMBLED_CELLS + x] !== 1) return false;
    }
  }
  return true;
}

/** The floor cell nearest a tile's centre that a body fits in — a chunk may
 *  have a pillar there, and the cell beside a pillar is floor but unusable.
 *  Falls back to bare floor only if the tile has no room at all. */
function tileCentreCell(cells: Uint8Array, tx: number, ty: number): { cx: number; cy: number } | null {
  const ox = tx * TILE_CELLS, oy = ty * TILE_CELLS;
  const mid = (TILE_CELLS - 1) / 2;
  let best: { cx: number; cy: number } | null = null;
  let bestD = Infinity;
  let anyFloor: { cx: number; cy: number } | null = null;
  let anyD = Infinity;
  for (let y = 0; y < TILE_CELLS; y++) {
    for (let x = 0; x < TILE_CELLS; x++) {
      const cx = ox + x, cy = oy + y;
      if (cells[cy * ASSEMBLED_CELLS + cx] !== 1) continue;
      const d = (x - mid) * (x - mid) + (y - mid) * (y - mid);
      if (d < anyD) { anyD = d; anyFloor = { cx, cy }; }
      if (!bodyFits(cells, cx, cy)) continue;
      if (d < bestD) { bestD = d; best = { cx, cy }; }
    }
  }
  return best ?? anyFloor;
}

/**
 * Carve the tiles the route does not use with an irregular disc, so the area's
 * outer boundary is organic instead of the edge of a 9x9 lattice. Only mask-0
 * tiles are touched — carving a routed tile would sever the route it carries.
 *
 * The disc is the same sinusoidal wobble the old open-field generator used; it
 * was the one part of that generator worth keeping.
 */
function carveOrganicRim(
  cells: Uint8Array, masks: Uint8Array, bossTile: { tx: number; ty: number }, rng: RandomStream,
): Uint8Array {
  const carved = new Uint8Array(cells.length);
  const mid = (ASSEMBLED_CELLS - 1) / 2;
  // 0.32 of the grid, plus at most 10 cells of wobble, keeps the carve inside
  // the 71.5-cell half-width with room to spare: the outer ring must stay wall.
  // It was 0.38 on the 7x7 lattice; the same fraction of a 9x9 one carved the
  // open-field median past 70% walkable, which is a bigger map bought with more
  // undifferentiated ground — the opposite of what enlarging it was for.
  const radius = ASSEMBLED_CELLS * 0.32;
  const a1 = rng.nextInt(3, 6), a2 = rng.nextInt(2, 4);
  const p1 = (rng.nextU32() / 0x1_0000_0000) * Math.PI * 2;
  const p2 = (rng.nextU32() / 0x1_0000_0000) * Math.PI * 2;
  for (let y = 0; y < ASSEMBLED_CELLS; y++) {
    for (let x = 0; x < ASSEMBLED_CELLS; x++) {
      const tile = Math.floor(y / TILE_CELLS) * AREA_TILES + Math.floor(x / TILE_CELLS);
      if (masks[tile] !== 0) continue; // a stamped chunk owns this cell
      const bx = Math.floor(x / TILE_CELLS) - bossTile.tx, by = Math.floor(y / TILE_CELLS) - bossTile.ty;
      if (bx >= 0 && bx <= 1 && by >= 0 && by <= 1) continue; // so does the boss arena
      const dx = x - mid, dy = y - mid;
      const ang = Math.atan2(dy, dx);
      const r = radius + a1 * Math.sin(3 * ang + p1) + a2 * Math.sin(5 * ang + p2);
      const i = y * ASSEMBLED_CELLS + x;
      if (Math.hypot(dx, dy) <= r && cells[i] === 0) { cells[i] = 1; carved[i] = 1; }
    }
  }
  return carved;
}

/** Deepest a rim door digs into either tile looking for floor. */
const RIM_DOOR_DEPTH = 7;

/**
 * Doors from route tiles into the carved ground beside them. A chunk is walled
 * on every edge it was not routed through, so without these the carved ground
 * meets the route only where a seam happens to be open, and a ruin loop meets
 * its fen nowhere. A door is 4 cells wide at the edge's centre and is kept only
 * if it reaches floor on both sides.
 */
function openRimDoors(cells: Uint8Array, masks: Uint8Array, carved: Uint8Array): void {
  const N = ASSEMBLED_CELLS;
  for (let ty = 0; ty < AREA_TILES; ty++) {
    for (let tx = 0; tx < AREA_TILES; tx++) {
      if (masks[ty * AREA_TILES + tx] === 0) continue;
      for (let d = 0; d < 4; d++) {
        const nx = tx + DIR_VEC[d]![0], ny = ty + DIR_VEC[d]![1];
        if (nx < 0 || ny < 0 || nx >= AREA_TILES || ny >= AREA_TILES) continue;
        if (masks[ny * AREA_TILES + nx] !== 0) continue;
        // Cell index at `depth` from the shared seam into tile (ox,oy), lateral 6..9.
        const at = (ox: number, oy: number, side: number, depth: number, lat: number): number => {
          const far = TILE_CELLS - 1 - depth;
          const [x, y] = side === 0 ? [lat, depth] : side === 2 ? [lat, far] : side === 3 ? [depth, lat] : [far, lat];
          return (oy * TILE_CELLS + y) * N + ox * TILE_CELLS + x;
        };
        const dig = (ox: number, oy: number, side: number, needCarved: boolean): number[] | null => {
          const dug: number[] = [];
          for (let depth = 0; depth <= RIM_DOOR_DEPTH; depth++) {
            const row = [6, 7, 8, 9].map((lat) => at(ox, oy, side, depth, lat));
            if (row.every((i) => cells[i] === 1 && (!needCarved || carved[i] === 1))) return dug;
            for (const i of row) if (cells[i] === 0) dug.push(i);
          }
          return null;
        };
        const near = dig(tx, ty, d, false);
        const far = near && dig(nx, ny, (d + 2) % 4, true);
        if (!near || !far) continue;
        for (const i of [...near, ...far]) cells[i] = 1;
      }
    }
  }
}

/** Blob candidates drawn per tile; the moat rule turns most down in rooms. */
const BLOBS_PER_TILE = 10;
/** Floor a blob keeps between itself and any wall, a body's width: so no blob
 *  narrows a corridor below one, closes a door, or seals off any ground. */
const BLOB_MOAT = 3;
/** Floor between a blob's edge and any marker: a pack stands round its socket. */
const MARKER_GAP = 2;

/**
 * Dot wide open ground with obstacle blobs of mixed size, a few units apart:
 * PoE's open ground is never bare (reference-screenshots/map-layout-1.jpeg). A
 * blob only goes where it keeps BLOB_MOAT clear of every wall, so it lands in
 * carved fields and merged flats and never in a corridor, a room or the arena.
 */
function dressOpenGround(
  cells: Uint8Array, markers: Marker[], bossTile: { tx: number; ty: number }, rng: RandomStream,
): Uint8Array {
  const N = ASSEMBLED_CELLS;
  const stamped = new Uint8Array(N * N);
  for (let ty = 0; ty < AREA_TILES; ty++) {
    for (let tx = 0; tx < AREA_TILES; tx++) {
      const bx = tx - bossTile.tx, by = ty - bossTile.ty;
      const inBoss = bx >= 0 && bx <= 1 && by >= 0 && by <= 1;
      for (let k = 0; k < BLOBS_PER_TILE; k++) {
        const size = rng.nextInt(0, 9);
        const phase = (rng.nextU32() / 0x1_0000_0000) * Math.PI * 2;
        // Mostly stones a body wide, some boulders, the odd outcrop. Two cells is
        // the least radius that never stamps a 3x3 square.
        const r = size < 6 ? 2 + (size % 3) * 0.5 : size < 9 ? 3 : 4;
        const cx = tx * TILE_CELLS + rng.nextInt(0, TILE_CELLS - 1);
        const cy = ty * TILE_CELLS + rng.nextInt(0, TILE_CELLS - 1);
        // A boulder or an outcrop gathers smaller stones against it, so the
        // ground reads as formations rather than as one stone per tile.
        const discs = [{ cx, cy, r, phase }];
        const satellites = size < 6 ? 0 : rng.nextInt(1, 2);
        for (let s = 0; s < satellites; s++) {
          const a = (rng.nextU32() / 0x1_0000_0000) * Math.PI * 2;
          const sr = r * (0.45 + (rng.nextInt(0, 3) * 0.05));
          discs.push({
            cx: cx + Math.round(Math.cos(a) * r * 1.1), cy: cy + Math.round(Math.sin(a) * r * 1.1), r: sr, phase: a,
          });
        }
        if (inBoss) continue;
        const fits = discs.every((d) => {
          const dr = Math.ceil(d.r * 1.25);
          // Off the boss block, which keeps its own cover; seams are open ground
          // by now (openSeams), so a blob may sit across one.
          const btx = Math.floor(d.cx / TILE_CELLS) - bossTile.tx, bty = Math.floor(d.cy / TILE_CELLS) - bossTile.ty;
          if (btx >= -1 && btx <= 2 && bty >= -1 && bty <= 2) return false;
          // Round, from the blob's own edge: a box round every spawn covered most
          // of the tile it stood in, and those tiles stayed bare.
          if (markers.some((m) => Math.hypot(m.cx - d.cx, m.cy - d.cy) < d.r * 1.25 + MARKER_GAP)) return false;
          const clear = dr + BLOB_MOAT;
          for (let dy = -clear; dy <= clear; dy++) {
            for (let dx = -clear; dx <= clear; dx++) {
              const x = d.cx + dx, y = d.cy + dy;
              if (x < 0 || y < 0 || x >= N || y >= N || cells[y * N + x] === 0) return false;
            }
          }
          return true;
        });
        if (!fits) continue;
        for (const d of discs) {
          const dr = Math.ceil(d.r * 1.25);
          for (let dy = -dr; dy <= dr; dy++) {
            for (let dx = -dr; dx <= dr; dx++) {
              const wobble = 1 + 0.25 * Math.sin(3 * Math.atan2(dy, dx) + d.phase);
              if (Math.hypot(dx, dy) <= d.r * wobble) {
                cells[(d.cy + dy) * N + d.cx + dx] = 0;
                stamped[(d.cy + dy) * N + d.cx + dx] = 1;
              }
            }
          }
        }
      }
    }
  }
  return stamped;
}

/** Least cells a pool needs to read as water rather than a wet stone. */
const POOL_MIN_CELLS = 6;
/** An interior wall mass this big floods as a lake whatever made it; under it
 *  only the open ground's blobs do, since a chunk's pillars would read as tanks. */
const LAKE_MIN_CELLS = 48;

/**
 * Flood a `share` of the interior wall components into standing water the
 * player wades: each flooded cell turns floor in `cells` and is set in the
 * returned mask, which only the renderer reads. A candidate never touches
 * the grid border (the rim), the boss block, or a spawn or reward marker's 3x3,
 * and is either a blob of at least POOL_MIN_CELLS or a mass of LAKE_MIN_CELLS.
 */
function pickPools(
  cells: Uint8Array, stamped: Uint8Array, markers: readonly Marker[],
  bossTile: { tx: number; ty: number }, share: number, rng: RandomStream,
): Uint8Array | null {
  const N = ASSEMBLED_CELLS;
  const water = new Uint8Array(N * N);
  const seen = new Uint8Array(N * N);
  const sockets = markers.filter((m) => m.ch === "s" || m.ch === "r");
  let any = false;
  for (let s = 0; s < N * N; s++) {
    if (seen[s] || cells[s] !== 0) continue;
    const comp = [s];
    seen[s] = 1;
    let ok = true, blob = true;
    for (let h = 0; h < comp.length; h++) {
      const i = comp[h]!, x = i % N, y = (i - x) / N;
      if (!stamped[i]) blob = false;
      const tx = Math.floor(x / TILE_CELLS) - bossTile.tx, ty = Math.floor(y / TILE_CELLS) - bossTile.ty;
      if (tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1) ok = false;
      if (ok && sockets.some((m) => Math.abs(m.cx - x) <= 2 && Math.abs(m.cy - y) <= 2)) ok = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) { ok = false; continue; }
        const j = ny * N + nx;
        if (cells[j] !== 0 || seen[j]) continue;
        seen[j] = 1;
        comp.push(j);
      }
    }
    if (!ok || comp.length < (blob ? POOL_MIN_CELLS : LAKE_MIN_CELLS)) continue;
    if (rng.nextU32() / 0x1_0000_0000 >= share) continue;
    for (const i of comp) water[i] = cells[i] = 1;
    any = true;
  }
  return any ? water : null;
}

/** Smooth value noise in [0,1) over the cell grid, one lattice point per `scale` cells. */
function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const hash = (a: number, b: number): number => {
    let h = Math.imul(a ^ seed, 0x85ebca6b) ^ Math.imul(b + 0x9e3779b9, 0xc2b2ae35);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4eb2f);
    return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
  };
  const fx = x / scale, fy = y / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * sx;
  const bot = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * sx;
  return top + (bot - top) * sy;
}

/** Deepest the frayed edge eats into a wall, and grows off the grid's border, in cells. */
const FRAY_DEPTH = 6;
/** How hard the fray's noise is pushed toward its extremes. */
const FRAY_CONTRAST = 2.4;
/** Cycles of the fray's noise: a bay or a spit every few units, not every cell. */
const FRAY_SCALE = 5;
/** A free-standing wall this big is rock with a face, and frays like the rim. */
const MASS_CELLS = 60;
/** An obstacle under this many cells is a stub, not a blob. */
const STUB_CELLS = 12;
/** Floor kept around every marker while the border grows, so no spawn, reward or
 *  arena mouth is ever walled over. */
const MARKER_CLEAR = 2;

/**
 * Open ground must not show the chunks it was stamped from. The field chunks wall
 * every unrouted edge with a ruler-straight 16-cell line, and their islands are
 * squares: rock does not come in either shape (map-layout-1.jpeg is ragged
 * ground with blobs in it). Two steps, the boss block untouched by both:
 *  1. eat into every wall mass by a noisy 0..FRAY_DEPTH;
 *  2. grow the grid's own border inward by the same, clear of every marker, since
 *     a route tile on the lattice's edge has nothing past its wall to eat into.
 * Step 2 is the only one that adds wall, and it gives back whatever cuts a marker
 * off. `clearStubs` then removes the small and square obstacles.
 */
export function naturalizeEdges(
  cells: Uint8Array, markers: readonly Marker[], bossTile: { tx: number; ty: number }, rng: RandomStream,
): void {
  const N = ASSEMBLED_CELLS;
  const seedA = rng.nextU32(), seedB = rng.nextU32();
  const inBoss = (x: number, y: number): boolean => {
    const bx = Math.floor(x / TILE_CELLS) - bossTile.tx, by = Math.floor(y / TILE_CELLS) - bossTile.ty;
    return bx >= 0 && bx <= 1 && by >= 0 && by <= 1;
  };
  const edge = (x: number, y: number): number => Math.min(x, y, N - 1 - x, N - 1 - y);
  // A fine octave over the coarse one, or a plateau of the noise draws a
  // straight run as long as the plateau.
  // Contrast-stretched, because the sum of two noises sits near its middle and a
  // middle value everywhere is a straight line one level in.
  const fray = (x: number, y: number, seed: number, scale = FRAY_SCALE): number => {
    const n = 0.65 * valueNoise(x, y, scale, seed) + 0.35 * valueNoise(x, y, 2, seed ^ 0x5bd1e995);
    const k = Math.min(1, Math.max(0, (n - 0.5) * FRAY_CONTRAST + 0.5));
    return Math.min(FRAY_DEPTH, Math.floor(k * (FRAY_DEPTH + 1)));
  };
  const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  // Which wall is a MASS — the outer region, or a block of rock big enough to
  // have a face — as opposed to a thin feature such as a compound wall, which
  // fraying would only shred into stubs.
  const outer = new Uint8Array(N * N);
  const seenMass = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (cells[i] !== 0 || seenMass[i]) continue;
    const comp = [i];
    seenMass[i] = 1;
    let border = false;
    for (let h = 0; h < comp.length; h++) {
      const c = comp[h]!, x = c % N, y = (c - x) / N;
      if (edge(x, y) === 0) border = true;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (cells[j] === 0 && !seenMass[j]) { seenMass[j] = 1; comp.push(j); }
      }
    }
    if (border || comp.length >= MASS_CELLS) for (const c of comp) outer[c] = 1;
  }

  // 1. Steps from the nearest floor through outer wall, then open the near ones.
  const depth = new Uint8Array(N * N).fill(255);
  const queue: number[] = [];
  for (let i = 0; i < N * N; i++) if (cells[i] === 1) { depth[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % N, y = (i - x) / N;
    if (depth[i]! >= FRAY_DEPTH) continue;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (!outer[j] || depth[j] !== 255) continue;
      depth[j] = depth[i]! + 1;
      queue.push(j);
    }
  }
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      if (outer[i] && depth[i]! <= fray(x, y, seedA) && !inBoss(x, y)) cells[i] = 1;
    }
  }

  // 2. The border grows in where the noise says, never near a marker.
  const grown: number[] = [];
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      // Finer than the erosion's: the border is one long line, and a low patch
      // of coarse noise along it is a straight run as long as the patch.
      if (edge(x, y) > fray(x, y, seedB, 3) || inBoss(x, y)) continue;
      if (markers.some((m) => Math.abs(m.cx - x) <= MARKER_CLEAR && Math.abs(m.cy - y) <= MARKER_CLEAR)) continue;
      if (cells[y * N + x] === 1) grown.push(y * N + x);
      cells[y * N + x] = 0;
    }
  }
  // Growth spares a marker's own cells but can still ring them off from the
  // route; give back the grown wall round any marker the arena can no longer reach.
  const boss = markers.find((m) => m.ch === "b");
  for (let pass = 0; boss && pass < 4; pass++) {
    const reached = bfsReachable(cells, N, boss);
    const lost = markers.filter((m) => reached[m.cy * N + m.cx] !== 1);
    if (lost.length === 0) break;
    const reach = pass < 3 ? 6 * (pass + 1) : N;
    for (const i of grown) {
      const x = i % N, y = (i - x) / N;
      if (lost.some((m) => Math.abs(m.cx - x) <= reach && Math.abs(m.cy - y) <= reach)) cells[i] = 1;
    }
  }

  // Smooth what the noise leaves one cell wide: a notch with wall on three sides
  // fills, a spike with floor on three sides goes.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        if (inBoss(x, y)) continue;
        const i = y * N + x;
        let walls = 0;
        for (const [dx, dy] of NB4) walls += cells[(y + dy) * N + x + dx] === 0 ? 1 : 0;
        if (cells[i] === 0 && walls <= 1) cells[i] = 1;
        else if (cells[i] === 1 && walls >= 3 &&
          !markers.some((m) => Math.abs(m.cx - x) <= MARKER_CLEAR && Math.abs(m.cy - y) <= MARKER_CLEAR)) cells[i] = 0;
      }
    }
  }

}

/**
 * Erase every free-standing wall under STUB_CELLS or shaped as a rectangle: the
 * stubs openSeams and the fray leave, and the chunks' square islands.
 * `dressOpenGround` puts shaped blobs back. The border region never goes.
 */
function clearStubs(cells: Uint8Array, bossTile: { tx: number; ty: number }): void {
  const N = ASSEMBLED_CELLS;
  const inBoss = (x: number, y: number): boolean => {
    const bx = Math.floor(x / TILE_CELLS) - bossTile.tx, by = Math.floor(y / TILE_CELLS) - bossTile.ty;
    return bx >= 0 && bx <= 1 && by >= 0 && by <= 1;
  };
  const edge = (x: number, y: number): number => Math.min(x, y, N - 1 - x, N - 1 - y);
  const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const seen = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (cells[i] !== 0 || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    let border = false, x0 = N, y0 = N, x1 = 0, y1 = 0;
    for (let h = 0; h < comp.length; h++) {
      const c = comp[h]!, x = c % N, y = (c - x) / N;
      if (edge(x, y) === 0 || inBoss(x, y)) border = true;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (cells[j] === 0 && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    const square = comp.length === (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!border && (comp.length < STUB_CELLS || square)) for (const c of comp) cells[c] = 1;
  }
}

/** Radius a concave corner of wall is rounded by, in cells: picked by noise per
 *  place, then shrunk until the floor around the corner holds it. */
const ROUND_MIN = 2;
const ROUND_MAX = 6;
/** Floor a fillet leaves round a marker: the marker's own 3x3, in cells. */
const FILLET_CLEAR = 1;
/** Radius of a rock outcrop standing off a long face, in cells: a random pick,
 *  shrunk until the floor in front holds it. */
const OUTCROP_MIN = 2;
const OUTCROP_MAX = 4;
/** Floor an outcrop must leave past its tip, in cells. */
const OUTCROP_ROOM = 4;
/** Face length per outcrop slot. Every slot with room gets one: one slot skipped
 *  is one long face left. */
const OUTCROP_SPACING = 8;

/**
 * Walled maps must not show the ruler their chunks were drawn with. Their walls
 * are too thin to bite into (a room wall is 4-7 cells, and the partition IS the
 * route), so rock is added instead: every concave corner filled outside a
 * quarter disc, and outcrops standing off long faces. Each corner is its own
 * feature: a fillet that rides along with a sealed passage is a corner left
 * square. Nothing goes near a marker or into the boss block, and a feature that
 * leaves a body fewer markers to reach, or splits the floor, is found and taken
 * back.
 */
export function softenWalls(
  cells: Uint8Array, markers: readonly Marker[], bossTile: { tx: number; ty: number }, rng: RandomStream,
): void {
  const N = ASSEMBLED_CELLS;
  const seed = rng.nextU32();
  const before = cells.slice();
  const floor = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && before[y * N + x] === 1;
  const nearBoss = (x: number, y: number): boolean => {
    const bx = x - bossTile.tx * TILE_CELLS, by = y - bossTile.ty * TILE_CELLS;
    return bx >= -2 && bx < 2 * TILE_CELLS + 2 && by >= -2 && by < 2 * TILE_CELLS + 2;
  };
  const nearMarker = (i: number, clear: number): boolean => {
    const x = i % N, y = (i - x) / N;
    return markers.some((m) => Math.abs(m.cx - x) <= clear && Math.abs(m.cy - y) <= clear);
  };
  // What is planned so far: a feature checks its room against this, so two never
  // meet across one corridor.
  const plan = cells.slice();
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && plan[y * N + x] === 1;
  const features: number[][] = [];
  const add = (cut: number[], clear = MARKER_CLEAR): void => {
    const kept = cut.filter((i) => plan[i] === 1 && !nearMarker(i, clear));
    if (kept.length === 0) return;
    for (const i of kept) plan[i] = 0;
    features.push(kept);
  };

  // Corners: each concave corner of `shape` filled outside a quarter disc, the
  // largest the floor around it holds.
  const roundCorners = (shape: Uint8Array): void => {
    const wall = (x: number, y: number): boolean => !(x >= 0 && y >= 0 && x < N && y < N && shape[y * N + x] === 1);
    const holds = (x: number, y: number, sx: number, sy: number, r: number): boolean => {
      for (let k = 0; k <= r; k++) if (!wall(x - sx, y + sy * k) || !wall(x + sx * k, y - sy)) return false;
      for (let j = 0; j <= r; j++) for (let i = 0; i <= r; i++) if (!open(x + sx * i, y + sy * j)) return false;
      return true;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (shape[y * N + x] !== 1 || nearBoss(x, y)) continue;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        if (!wall(x - sx, y) || !wall(x, y - sy)) continue;
        const n = valueNoise(x, y, FRAY_SCALE, seed);
        let r = Math.min(ROUND_MAX, ROUND_MIN + Math.floor(n * (ROUND_MAX - ROUND_MIN + 1)));
        while (r >= ROUND_MIN && !holds(x, y, sx, sy, r)) r--;
        if (r < ROUND_MIN) continue;
        const cut: number[] = [];
        for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) {
          if ((r - i - 0.5) ** 2 + (r - j - 0.5) ** 2 > r * r) cut.push((y + sy * j) * N + x + sx * i);
        }
        // A fillet hugs the wall: a body still stands on every marker's own 3x3.
        add(cut, FILLET_CLEAR);
      }
    }
  };
  // Before the outcrops, which would take the floor a fillet needs, and again
  // after, for their feet.
  roundCorners(before);

  // Outcrops: a half disc off a straight run of face, centred well inside it.
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    const alongX = dx === 0;
    for (let a = 1; a < N - 1; a++) {
      const at = (t: number): [number, number] => (alongX ? [t, a] : [a, t]);
      const face = (t: number): boolean => {
        const [x, y] = at(t);
        return !floor(x, y) && floor(x + dx, y + dy);
      };
      let b = 0;
      while (b < N) {
        if (!face(b)) { b++; continue; }
        const start = b;
        while (b < N && face(b)) b++;
        for (let slot = start; slot + OUTCROP_SPACING <= b; slot += OUTCROP_SPACING) {
          const fits = (c: number, r: number): boolean => {
            for (let u = -r; u <= r; u++) for (let v = 1; v <= r + OUTCROP_ROOM; v++) {
              const [x, y] = at(c + u);
              if (!open(x + dx * v, y + dy * v)) return false;
            }
            return true;
          };
          let placed = false;
          for (let r = rng.nextInt(OUTCROP_MIN, OUTCROP_MAX); r >= OUTCROP_MIN && !placed; r--) {
            // Off the run's ends, which are door jambs and corners.
            const lo = Math.max(slot, start + r + 2), hi = Math.min(slot + OUTCROP_SPACING - 1, b - r - 3);
            if (lo > hi) continue;
            // Every place in the slot, from a random one round: one pillar in
            // front must not leave the whole face straight.
            const first = rng.nextInt(lo, hi);
            for (let k = 0; k <= hi - lo && !placed; k++) {
              const c = lo + ((first - lo + k) % (hi - lo + 1));
              const [cx, cy] = at(c);
              if (nearBoss(cx, cy) || !fits(c, r)) continue;
              const cut: number[] = [];
              for (let u = -r; u <= r; u++) for (let v = 1; v <= r; v++) {
                if (u * u + (v - 0.5) * (v - 0.5) > r * r) continue;
                const [x, y] = at(c + u);
                cut.push((y + dy * v) * N + x + dx * v);
              }
              add(cut);
              placed = true;
            }
          }
        }
      }
    }
  }

  roundCorners(plan.slice());

  // Keep every feature that leaves the body's reach and the floor whole: all at
  // once when they do, else halves until the ones that do not are isolated.
  const score = (): number => bodyReach(cells, markers) * 4096 - floorComponents(cells);
  const want = score();
  const attempt = (group: readonly number[][]): void => {
    for (const f of group) for (const i of f) cells[i] = 0;
    if (score() === want) return;
    for (const f of group) for (const i of f) cells[i] = 1;
    if (group.length === 1) return;
    attempt(group.slice(0, group.length >> 1));
    attempt(group.slice(group.length >> 1));
  };
  attempt(features);
}

/** How many markers a 3x3 body standing next to them can reach from the boss's. */
function bodyReach(cells: Uint8Array, markers: readonly Marker[]): number {
  const N = ASSEMBLED_CELLS;
  // fits[i]: a 3x3 body centred on cell i stands on floor only.
  const rows = new Uint8Array(N * N), fit = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x;
    rows[i] = cells[i - 1]! & cells[i]! & cells[i + 1]! & 1;
  }
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x;
    fit[i] = rows[i - N]! & rows[i]! & rows[i + N]!;
  }
  const boss = markers.find((m) => m.ch === "b");
  if (!boss) return 0;
  const seen = new Uint8Array(N * N);
  const stack = new Int32Array(N * N);
  let top = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = boss.cx + dx, y = boss.cy + dy, i = y * N + x;
    if (x >= 0 && y >= 0 && x < N && y < N && fit[i]) { seen[i] = 1; stack[top++] = i; }
  }
  // A fitting cell is never on the border, so its 4 neighbours are on the grid.
  while (top) {
    const i = stack[--top]!;
    if (fit[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
    if (fit[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
    if (fit[i + N] && !seen[i + N]) { seen[i + N] = 1; stack[top++] = i + N; }
    if (fit[i - N] && !seen[i - N]) { seen[i - N] = 1; stack[top++] = i - N; }
  }
  return markers.filter((m) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = m.cx + dx, ny = m.cy + dy;
      if (nx >= 0 && ny >= 0 && nx < N && ny < N && seen[ny * N + nx]) return true;
    }
    return false;
  }).length;
}

/** Number of 4-connected floor regions. */
function floorComponents(cells: Uint8Array): number {
  const N = ASSEMBLED_CELLS;
  const seen = new Uint8Array(N * N);
  const stack = new Int32Array(N * N);
  let n = 0;
  for (let s = 0; s < N * N; s++) {
    if (cells[s] !== 1 || seen[s]) continue;
    n++;
    seen[s] = 1;
    let top = 0;
    stack[top++] = s;
    while (top) {
      const i = stack[--top]!, x = i % N;
      if (x > 0 && cells[i - 1] === 1 && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < N - 1 && cells[i + 1] === 1 && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (i >= N && cells[i - N] === 1 && !seen[i - N]) { seen[i - N] = 1; stack[top++] = i - N; }
      if (i < N * N - N && cells[i + N] === 1 && !seen[i + N]) { seen[i + N] = 1; stack[top++] = i + N; }
    }
  }
  return n;
}

/** A routed doorway is widened to cells DOOR_LO..DOOR_HI of its edge: 8 cells,
 *  4 units, still centred, so a rotated or mirrored map widens the same way. */
const DOOR_LO = 4;
const DOOR_HI = 11;

/**
 * Widen the neck behind one door of tile (tx,ty) on side `side`, from the seam
 * inward until the neck opens into its room. A depth with anything but wall
 * beside the neck stops the carve, so no pocket or strongroom is ever opened.
 */
function widenDoor(cells: Uint8Array, tx: number, ty: number, side: Dir): void {
  const at = (depth: number, lat: number): number => {
    const x0 = tx * TILE_CELLS, y0 = ty * TILE_CELLS, far = TILE_CELLS - 1 - depth;
    const [x, y] = side === 0 ? [lat, depth] : side === 2 ? [lat, far] : side === 3 ? [depth, lat] : [far, lat];
    return (y0 + y) * ASSEMBLED_CELLS + x0 + x;
  };
  for (let depth = 0; depth < TILE_CELLS / 2; depth++) {
    for (let lat = DOOR_LO - 1; lat <= DOOR_HI + 1; lat++) {
      const inNeck = lat >= 6 && lat <= 9;
      if ((cells[at(depth, lat)] === 1) !== inNeck) return;
    }
    for (let lat = DOOR_LO; lat <= DOOR_HI; lat++) cells[at(depth, lat)] = 1;
  }
}

/** Widen both halves of every routed door, the boss block's included. */
function widenDoors(cells: Uint8Array, masks: Uint8Array): void {
  for (let ty = 0; ty < AREA_TILES; ty++) {
    for (let tx = 0; tx < AREA_TILES; tx++) {
      const mask = masks[ty * AREA_TILES + tx]!;
      for (let d = 0; d < 4; d++) {
        if ((mask & (1 << d)) === 0) continue;
        widenDoor(cells, tx, ty, d as Dir);
        const nx = tx + DIR_VEC[d]![0], ny = ty + DIR_VEC[d]![1];
        // A routed edge into a mask-0 tile is the boss block's port.
        if (masks[ny * AREA_TILES + nx] === 0) widenDoor(cells, nx, ny, ((d + 2) % 4) as Dir);
      }
    }
  }
}

/**
 * Open ground must not show the lattice it was stamped on. Two tiles that both
 * reach a seam leave a wall line one cell thick on each side of it, and four
 * tiles leave a 4x4 post at their shared corner: together a grid of lanes. Knock
 * out every seam wall with floor directly beyond it on both sides, then every
 * corner post left standing alone. The boss block keeps its walls.
 */
function openSeams(cells: Uint8Array, bossTile: { tx: number; ty: number }): void {
  const N = ASSEMBLED_CELLS;
  const inBoss = (x: number, y: number): boolean => {
    const tx = Math.floor(x / TILE_CELLS) - bossTile.tx, ty = Math.floor(y / TILE_CELLS) - bossTile.ty;
    return tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1;
  };
  const floor = (x: number, y: number): boolean => cells[y * N + x] === 1;
  const knock = (a: number, b: number): boolean => {
    if (cells[a] === 1 && cells[b] === 1) return false;
    cells[a] = 1; cells[b] = 1;
    return true;
  };
  // One opened seam can put floor beyond another, so repeat until none changes.
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 1; k < AREA_TILES; k++) {
      const s = k * TILE_CELLS;
      for (let i = 0; i < N; i++) {
        if (!inBoss(s - 1, i) && !inBoss(s, i) && floor(s - 2, i) && floor(s + 1, i)) {
          changed = knock(i * N + s - 1, i * N + s) || changed;
        }
        if (!inBoss(i, s - 1) && !inBoss(i, s) && floor(i, s - 2) && floor(i, s + 1)) {
          changed = knock((s - 1) * N + i, s * N + i) || changed;
        }
      }
    }
  }
  for (let ky = 1; ky < AREA_TILES; ky++) {
    for (let kx = 1; kx < AREA_TILES; kx++) {
      const x0 = kx * TILE_CELLS - 2, y0 = ky * TILE_CELLS - 2;
      if (inBoss(x0, y0) || inBoss(x0 + 3, y0 + 3) || inBoss(x0, y0 + 3) || inBoss(x0 + 3, y0)) continue;
      let ring = true;
      for (let i = 0; i < 4; i++) {
        ring &&= floor(x0 + i, y0 - 1) && floor(x0 + i, y0 + 4) && floor(x0 - 1, y0 + i) && floor(x0 + 4, y0 + i);
      }
      if (!ring) continue;
      for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) cells[y * N + x] = 1;
    }
  }
}

/** 4-connected steps from `start` to every floor cell; 0xffff where unreached. */
function walkDistances(cells: Uint8Array, start: { cx: number; cy: number }): Uint16Array {
  const N = ASSEMBLED_CELLS;
  const dist = new Uint16Array(cells.length).fill(0xffff);
  const queue = [start.cy * N + start.cx];
  dist[queue[0]!] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % N;
    for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i - N, i + N]) {
      if (j < 0 || j >= cells.length || cells[j] !== 1 || dist[j] !== 0xffff) continue;
      dist[j] = dist[i]! + 1;
      queue.push(j);
    }
  }
  return dist;
}

/**
 * Erase floor the player can never stand on. The rim carve can leave a pocket
 * cut off from the route, which would read as open ground behind a wall.
 */
function pruneUnreachable(cells: Uint8Array, start: { cx: number; cy: number }): void {
  const reached = bfsReachable(cells, ASSEMBLED_CELLS, start);
  for (let i = 0; i < cells.length; i++) if (cells[i] === 1 && reached[i] !== 1) cells[i] = 0;
}

/** Rotate the grid 90 degrees clockwise: (cx,cy) -> (size-1-cy, cx). */
function rotateCells(cells: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
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
    grammar.routeShape,
  );
  if (!skeleton) return fallbackLayout(seed, contentVersion, grammar.spawnTarget);

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
      if (!variants || variants.length === 0) {
        return fallbackLayout(seed, contentVersion, grammar.spawnTarget);
      }
      const variant = variants[chunkRng.nextInt(0, variants.length - 1)]!;
      const fits = variant.filter((o) => o.mask === mask);
      if (fits.length === 0) return fallbackLayout(seed, contentVersion, grammar.spawnTarget);
      const pick = fits[chunkRng.nextInt(0, fits.length - 1)]!;
      const got = stamp(cells, pick.rows, tx * TILE_CELLS, ty * TILE_CELLS);
      markers.push(...got);
      markersByTile.set(ty * AREA_TILES + tx, got);
      chosenVariantIds.push(`${tx},${ty}:${pick.id}`);
    }
  }

  // The boss arena covers its reserved 2x2 block. Orient it by re-deriving the
  // port of each transform rather than reasoning about how a port maps.
  const bossFit = orientations(grammar.bossChunk).find(
    (o) => o.ports.length === 1 &&
      o.ports[0]!.side === skeleton.bossPort.side &&
      o.ports[0]!.index === skeleton.bossPort.index,
  );
  if (!bossFit) return fallbackLayout(seed, contentVersion, grammar.spawnTarget);
  const bossMarkers = stamp(
    cells,
    bossFit.rows,
    skeleton.bossTile.tx * TILE_CELLS,
    skeleton.bossTile.ty * TILE_CELLS,
  );
  markers.push(...bossMarkers);
  chosenVariantIds.push(`${skeleton.bossTile.tx},${skeleton.bossTile.ty}:${bossFit.id}`);

  // Break up the lattice: carve the unused tiles with a wobbly disc so the
  // boundary is not the edge of a 9x9 square. Route tiles are never touched.
  let carved: Uint8Array | null = null;
  if (grammar.organicRim) {
    carved = carveOrganicRim(cells, skeleton.masks, skeleton.bossTile, createStream(seed, `${contentVersion}.layout.rim`));
    openRimDoors(cells, skeleton.masks, carved);
  }

  widenDoors(cells, skeleton.masks);
  if (grammar.openSeams) openSeams(cells, skeleton.bossTile);
  if (grammar.naturalEdges) {
    naturalizeEdges(cells, markers, skeleton.bossTile, createStream(seed, `${contentVersion}.layout.edges`));
    // Fraying can put floor behind a seam wall the first pass had to leave.
    if (grammar.openSeams) openSeams(cells, skeleton.bossTile);
    clearStubs(cells, skeleton.bossTile);
  }
  if (grammar.softEdges) softenWalls(cells, markers, skeleton.bossTile, createStream(seed, `${contentVersion}.layout.soften`));
  let stamped: Uint8Array | null = null;
  if (grammar.organicRim) {
    stamped = dressOpenGround(cells, markers, skeleton.bossTile, createStream(seed, `${contentVersion}.layout.blobs`));
  }

  // Stage 3: anchors. The player arrives by portal, so the start is a point
  // inside a rim tile, not a door in the outer wall.
  const startCell = tileCentreCell(cells, skeleton.startTile.tx, skeleton.startTile.ty);
  const bossMarker = markers.find((m) => m.ch === "b");
  const exitMarker = markers.find((m) => m.ch === "e");
  if (!startCell || !bossMarker || !exitMarker) {
    return fallbackLayout(seed, contentVersion, grammar.spawnTarget);
  }

  // The rim carve can strand a pocket of floor behind the route. Open ground
  // the player can never reach reads as a bug, so erase it.
  if (grammar.organicRim) pruneUnreachable(cells, startCell);

  let objectiveAnchors: Socket[] = [
    { id: "start", ...cellCentre(ASSEMBLED_CELLS, startCell.cx, startCell.cy) },
    { id: "boss", ...cellCentre(ASSEMBLED_CELLS, bossMarker.cx, bossMarker.cy) },
    { id: "exit", ...cellCentre(ASSEMBLED_CELLS, exitMarker.cx, exitMarker.cy) },
  ];
  const start = objectiveAnchors[0]!;

  // Carved ground holds monsters too, or it is a free walk past the fight: one
  // spawn point per carved tile with room for a pack, ordered by walking
  // distance the way route tiles are ordered by route distance.
  const routeDist = skeleton.routeDist.slice();
  if (carved) {
    const walk = walkDistances(cells, startCell);
    for (let tile = 0; tile < routeDist.length; tile++) {
      const tx = tile % AREA_TILES, ty = (tile - tx) / AREA_TILES;
      if (skeleton.masks[tile] !== 0) continue;
      if (tx - skeleton.bossTile.tx >= 0 && tx - skeleton.bossTile.tx <= 1 &&
        ty - skeleton.bossTile.ty >= 0 && ty - skeleton.bossTile.ty <= 1) continue;
      let open = 0;
      for (let y = 0; y < TILE_CELLS; y++) for (let x = 0; x < TILE_CELLS; x++) {
        open += cells[(ty * TILE_CELLS + y) * ASSEMBLED_CELLS + tx * TILE_CELLS + x]!;
      }
      if (open < (TILE_CELLS * TILE_CELLS) / 3) continue;
      const c = tileCentreCell(cells, tx, ty);
      if (!c || !bodyFits(cells, c.cx, c.cy)) continue;
      markersByTile.set(tile, [{ ch: "s", cx: c.cx, cy: c.cy }]);
      routeDist[tile] = Math.min(UNREACHED - 1, Math.round(walk[c.cy * ASSEMBLED_CELLS + c.cx]! / TILE_CELLS));
    }
  }

  const farthestFirst = [...markersByTile.keys()].sort((a, b) => {
    const d = (routeDist[b] ?? UNREACHED) - (routeDist[a] ?? UNREACHED);
    return d !== 0 ? d : a - b;
  });

  // Stage 4: spawns spread ALONG the route, not piled at the end of it. Taking
  // the N farthest tiles put every monster 40+ units away in a 56-unit map and
  // left the first half of the route empty: nothing to pull, nothing to fight
  // until the boss. Walk the route in order instead and take evenly spaced
  // tiles, so the pack density is even from just outside the safe wedge to the
  // far end.
  const farEnough = (m: Marker): boolean => {
    const p = cellCentre(ASSEMBLED_CELLS, m.cx, m.cy);
    return Math.hypot(p.x - start.x, p.y - start.y) >= SPAWN_SAFE_RADIUS;
  };
  const nearestFirst = [...farthestFirst].reverse().filter((tile) =>
    (markersByTile.get(tile) ?? []).some((m) => m.ch === "s" && farEnough(m)),
  );
  const spawnSockets: Socket[] = [];
  const taken = new Set<number>();
  const push = (tile: number): void => {
    const m = (markersByTile.get(tile) ?? []).find((k) => k.ch === "s" && farEnough(k));
    if (!m || taken.has(tile)) return;
    taken.add(tile);
    spawnSockets.push({ id: `spawn.${spawnSockets.length}`, ...cellCentre(ASSEMBLED_CELLS, m.cx, m.cy) });
  };
  if (nearestFirst.length > 0) {
    for (let i = 0; i < grammar.spawnTarget; i++) {
      // spawnTarget > 1, so this spans 0..length-1 inclusive.
      const at = Math.round((i * (nearestFirst.length - 1)) / (grammar.spawnTarget - 1));
      push(nearestFirst[at]!);
    }
    // Evenly spaced indices collide when there are fewer eligible tiles than
    // spawns; top up from whatever is left, still in route order.
    for (const tile of nearestFirst) {
      if (spawnSockets.length >= grammar.spawnTarget) break;
      push(tile);
    }
    // Still short: a tile may hold several spawn points, so take its spares.
    for (const tile of nearestFirst) {
      if (spawnSockets.length >= grammar.spawnTarget) break;
      for (const m of (markersByTile.get(tile) ?? [])) {
        if (spawnSockets.length >= grammar.spawnTarget) break;
        if (m.ch !== "s" || !farEnough(m)) continue;
        const p = cellCentre(ASSEMBLED_CELLS, m.cx, m.cy);
        if (spawnSockets.some((s) => s.x === p.x && s.y === p.y)) continue;
        spawnSockets.push({ id: `spawn.${spawnSockets.length}`, ...p });
      }
    }
  }

  // Stage 5: rewards, then one rotation of the whole area. Per-tile rotation
  // cannot turn the skeleton; only this can.
  //
  // EVERY 'r' marker pays, not only the ones in the dead-end caps: a chunk may
  // wall a pocket off its own run, and that pocket is worth more than the spur
  // it is not on precisely because nothing about the route says it is there.
  // Route order still, so the ids walk the map outward.
  let rewardCount = 0;
  for (const tile of farthestFirst) {
    for (const m of markersByTile.get(tile) ?? []) {
      if (m.ch !== "r") continue;
      const p = cellCentre(ASSEMBLED_CELLS, m.cx, m.cy);
      // Nothing pays inside the safe wedge, the same radius the spawns respect.
      // A cache the player can see while still standing on the portal is loot
      // that cost nothing to find, and a find that costs nothing is not one.
      if (Math.hypot(p.x - start.x, p.y - start.y) < SPAWN_SAFE_RADIUS) continue;
      objectiveAnchors.push({ id: `reward.${rewardCount++}`, ...p });
    }
  }

  let water = stamped && grammar.fenPools
    ? pickPools(
      cells, stamped, [...markers, ...[...markersByTile.values()].flat()], skeleton.bossTile,
      grammar.fenPools, createStream(seed, `${contentVersion}.layout.pools`),
    )
    : null;

  const turns = createStream(seed, `${contentVersion}.layout.dressing`).nextInt(0, 3);
  for (let t = 0; t < turns; t++) {
    cells = rotateCells(cells, ASSEMBLED_CELLS);
    if (water) water = rotateCells(water, ASSEMBLED_CELLS);
  }
  const spun = (s: Socket): Socket => rotateSocket(s, ASSEMBLED_CELLS, turns);
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
    spawnTarget: grammar.spawnTarget,
    ...(water ? { water } : {}),
  });
  if (!layout.validationChecks.every((c) => c.passed)) {
    return fallbackLayout(seed, contentVersion, grammar.spawnTarget);
  }
  // Rides on the grid like the coast's sea; never hashed: the sim walks the pools' floor cells.
  if (water) layout.grid.water = water;
  return layout;
}
