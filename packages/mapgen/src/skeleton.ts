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

  // 2. Start: any loop tile on the outermost occupied ring. The player arrives
  //    by portal, so this is a marker inside a tile, not a door in the outer wall.
  const best = Math.max(...loop.map(rimScore));
  const rim = loop.filter((t) => rimScore(t) === best);
  const startTile = rim[rng.nextInt(0, rim.length - 1)]!;

  // 3. Boss: a free 2x2 block hung off the loop tile farthest by route. This
  //    runs BEFORE the spurs, because the block is mandatory and needs the most
  //    free space — spurs first left it nowhere to go on ~9% of seeds.
  const loopDist = bfs(masks, startTile);
  const byDistance = [...loop].sort((a, b) => {
    const d = loopDist[idx(b.tx, b.ty)]! - loopDist[idx(a.tx, a.ty)]!;
    return d !== 0 ? d : idx(a.tx, a.ty) - idx(b.tx, b.ty); // stable, seed-independent
  });
  let placed: { anchor: TileXY; dir: Dir; bx: number; by: number; port: Port } | null = null;
  for (const anchor of byDistance) {
    if (placed) break;
    if (loopDist[idx(anchor.tx, anchor.ty)] === UNREACHED) continue;
    for (let d = 0 as Dir; d < 4 && !placed; d = (d + 1) as Dir) {
      const nx = anchor.tx + DIR_VEC[d]![0], ny = anchor.ty + DIR_VEC[d]![1];
      if (!inBounds(nx, ny) || onRoute.has(idx(nx, ny))) continue;
      // The neighbour must be a corner of a free, in-bounds 2x2 block.
      for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
        const bx = nx + ox, by = ny + oy;
        if (!inBounds(bx, by) || !inBounds(bx + 1, by + 1)) continue;
        let free = true;
        for (let k = 0; k < 4 && free; k++) {
          if (onRoute.has(idx(bx + (k % 2), by + (k < 2 ? 0 : 1)))) free = false;
        }
        if (!free) continue;
        // The port is on the block side facing the anchor, at the tile the
        // anchor touches. Sides run N/S west-to-east and E/W north-to-south.
        const side = ((d + 2) % 4) as Dir;
        placed = {
          anchor,
          dir: d,
          bx,
          by,
          port: { side, index: side === 0 || side === 2 ? nx - bx : ny - by },
        };
        break;
      }
    }
  }
  if (!placed) return null; // no legal boss block; the caller falls back
  masks[idx(placed.anchor.tx, placed.anchor.ty)] |= 1 << placed.dir;
  const bossBlock: number[] = [];
  for (let k = 0; k < 4; k++) {
    const i = idx(placed.bx + (k % 2), placed.by + (k < 2 ? 0 : 1));
    bossBlock.push(i);
    onRoute.add(i);
  }

  // 4. Dead-end spurs off the loop. Never off a spur or the boss block: a spur
  //    that leads somewhere is no longer a rewarded dead end.
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
  }

  // The block's four tiles keep mask 0 — the 2x2 chunk covers them — so BFS
  // cannot reach them. Their route distance is the anchor's plus one.
  const routeDist = bfs(masks, startTile);
  const bossDist = routeDist[idx(placed.anchor.tx, placed.anchor.ty)]! + 1;
  for (const i of bossBlock) routeDist[i] = bossDist;

  return {
    masks,
    startTile,
    bossTile: { tx: placed.bx, ty: placed.by },
    bossPort: placed.port,
    routeDist,
  };
}
