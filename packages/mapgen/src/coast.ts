// The coast: a real beach, not a corridor with sand on it.
//
// Every other area here is assembled from 16x16 chunks on a 9x9 lattice, and
// that is the right shape for a dungeon: the route is a line, and the line has
// wall on both sides. A strand is the opposite shape. PoE's own overlay
// (`reference-screenshots/map-layout-1.jpeg`) shows what its areas actually are
// — broad open ground with scattered obstacle blobs, not lanes — and a beach
// adds the one thing that makes it a beach: the sea is on ONE side the whole
// way, the cliff is on the other, and the walk runs the length between them.
//
// So this is a generator and not a chunk library, the second exception the
// mapgen entry point allows (the first being loop vs ribbon). Nothing here
// stamps a chunk: the shoreline is a curve, the cliff line is that curve minus a
// wandering width, and everything between them is sand.
import { createStream, type RandomStream } from "./rng";
import {
  CELL_SIZE,
  bfsReachable,
  buildLayout,
  cellCentre,
  gridOrigin,
  type AreaLayout,
  type Shoreline,
  type Socket,
} from "./grid";

/** A coast is LONGER than an assembled area: 224 cells is 112 world units, and
 *  the camera shows about nineteen across, so the walk is six screens instead of
 *  the three and a half a 144-cell grid gave. A beach that ends before the
 *  player has settled into walking it is a corridor with a nicer floor.
 *
 *  The grid stays square because everything downstream (`buildLayout`, the
 *  minimap, the nav flood) is written against one `size`. The extra rows cost
 *  nothing but sea. */
export const COAST_CELLS = 224;

/** Solid cells at each END of the shore, so the map closes rather than running
 *  off the grid. The sea itself is NOT capped: it continues past both ends. */
const END_MARGIN = 8;

/** Canonical shoreline row before the wobble: everything at or above it is sea.
 *  Set from the top so the water band is a constant depth however long the beach
 *  gets — 44 cells of it, 22 world units, well past the ~10 the camera shows
 *  beyond the rim. */
const SHORE_BASE = COAST_CELLS - 44;

/** Wobble of the shoreline, in cells, as four harmonics.
 *
 *  Two was not enough: `reference-screenshots/strand-map-layout.jpg` has a coast
 *  that wiggles at every scale — long bays, headlands a few paces across, and a
 *  ragged edge inside those. A pair of low sines draws a smooth arc, which reads
 *  as a curve someone drew rather than as a coastline. */
const SHORE_LONG = 9;
const SHORE_SHORT = 4;
// Kept small on purpose. At 2.6/1.3 the fine harmonics put a wiggle every five
// metres, and because the surf band follows the curve exactly, the shoreline
// read as a jagged ribbon rather than as water — real surf smooths detail out
// at that scale. The long bays do the shaping; these two only stop the curve
// looking drawn.
const SHORE_FINE = 1.6;
const SHORE_RAG = 0.5;

/** Beach width between cliff and waterline, in cells. 32..52 is 16..26 world
 *  units, and the camera shows about 19 across — so the player can never see
 *  both edges of the beach at once, which is what stops it reading as a lane. */
const WIDTH_MIN = 32;
const WIDTH_MAX = 52;

/** The boss bay: the last stretch of shore opens out. 28 cells long, up to 26
 *  cells wider, because a boss needs ground the camera cannot frame in one shot
 *  (the same reason the chunk grammars reserve a 2x2 tile block for one). */
const BOWL_LEN = 34;
const BOWL_EXTRA = 26;

/** Rocks and dune scrub standing in the open sand. Blobs, never walls: this is
 *  the shape PoE's overlay actually shows, and it is what gives an open beach
 *  something to walk around without ever telling the player where to go. */
const BLOB_TRIES = 34;
const BLOB_MIN_R = 2;
const BLOB_MAX_R = 4;
/** How far apart two blobs must stand, in cells. Without it they merge into one
 *  central ridge and the beach is a lane again — which is exactly what the first
 *  pass produced. */
const BLOB_SPACING = 13;

/** How far past the waterline the player may still walk, in cells. Three is a
 *  metre and a half of ankle-deep water: a beach you cannot set foot in is a
 *  beach with an invisible fence down it, and the sea's own alpha ramp is short
 *  enough that a body standing there is not underneath opaque water. The
 *  waterline the renderer draws does NOT move — only how far the floor runs
 *  under it. */
const WADE_CELLS = 3;

/** World units of quiet around the portal, matching the assembler's. */
const SPAWN_SAFE_RADIUS = 10;

/** Caches for one generated area. The shore and the width are pure functions of
 *  x, sampled per column and never recomputed. */
interface Profile {
  /** Row the water starts at, per column. */
  shore: Float64Array;
  /** Row the cliff ends at, per column: floor is strictly between the two. */
  cliff: Float64Array;
}

function buildProfile(rng: RandomStream): Profile {
  const frac = (): number => rng.nextU32() / 0x1_0000_0000;
  const p1 = frac() * Math.PI * 2;
  const p2 = frac() * Math.PI * 2;
  const p3 = frac() * Math.PI * 2;
  const p4 = frac() * Math.PI * 2;
  const p5 = frac() * Math.PI * 2;
  const w1 = 1 + rng.nextInt(0, 1);
  const w2 = 3 + rng.nextInt(0, 1);
  const w3 = 1 + rng.nextInt(0, 2);
  const w4 = 7 + rng.nextInt(0, 2);
  const w5 = 13 + rng.nextInt(0, 4);
  const shore = new Float64Array(COAST_CELLS);
  const cliff = new Float64Array(COAST_CELLS);
  for (let x = 0; x < COAST_CELLS; x++) {
    const u = (x / COAST_CELLS) * Math.PI * 2;
    // The bay flattens the waterline as it opens: an arena with a wandering
    // shore is an arena with corners the player cannot see the boss from.
    const inBowl = Math.max(0, (x - (COAST_CELLS - END_MARGIN - BOWL_LEN)) / BOWL_LEN);
    const calm = 1 - Math.min(1, inBowl);
    shore[x] = SHORE_BASE +
      calm * (
        SHORE_LONG * Math.sin(w1 * u + p1) +
        SHORE_SHORT * Math.sin(w2 * u + p2) +
        SHORE_FINE * Math.sin(w4 * u + p4) +
        SHORE_RAG * Math.sin(w5 * u + p5)
      );
    const wobble = (1 + Math.sin(w3 * u + p3)) / 2;
    const width = WIDTH_MIN + (WIDTH_MAX - WIDTH_MIN) * wobble +
      BOWL_EXTRA * Math.min(1, inBowl);
    cliff[x] = shore[x]! - width;
  }
  return { shore, cliff };
}

/**
 * One generated coast, in the CANONICAL frame: the sea lies at high y, the
 * player starts at low x. Both are mirrored on the way out, which is the whole
 * of the variety — a post-hoc rotation would have to carry the water mask and
 * every anchor with it for no more result.
 */
interface Frame {
  /** Mirror x, so the walk runs the other way down the shore. */
  flipX: boolean;
  /** Mirror y, so the sea is on the other side of the screen. */
  flipY: boolean;
}

function mapCell(f: Frame, x: number, y: number): { cx: number; cy: number } {
  return {
    cx: f.flipX ? COAST_CELLS - 1 - x : x,
    cy: f.flipY ? COAST_CELLS - 1 - y : y,
  };
}

/** Every cell of the 3x3 block here is floor — the same body test the chunk
 *  assembler uses, and for the same reason: a start cell with a rock against it
 *  is a player who cannot move in any direction. */
function bodyFits(cells: Uint8Array, cx: number, cy: number): boolean {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= COAST_CELLS || y >= COAST_CELLS) return false;
      if (cells[y * COAST_CELLS + x] !== 1) return false;
    }
  return true;
}

/** The floor cell nearest (cx,cy) that a body fits in, searched outward. */
function nearestStandable(cells: Uint8Array, cx: number, cy: number): { cx: number; cy: number } | null {
  for (let r = 0; r < 24; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= COAST_CELLS || y >= COAST_CELLS) continue;
        if (bodyFits(cells, x, y)) return { cx: x, cy: y };
      }
  return null;
}

export function generateCoast(
  seed: number,
  contentVersion: string,
  spawnTarget: number,
): AreaLayout {
  const shapeRng = createStream(seed, `${contentVersion}.coast.shape`);
  const profile = buildProfile(shapeRng);
  const frame: Frame = { flipX: shapeRng.nextInt(0, 1) === 1, flipY: shapeRng.nextInt(0, 1) === 1 };

  const cells = new Uint8Array(COAST_CELLS * COAST_CELLS);
  const water = new Uint8Array(COAST_CELLS * COAST_CELLS);
  const at = (x: number, y: number): number => {
    const c = mapCell(frame, x, y);
    return c.cy * COAST_CELLS + c.cx;
  };

  for (let x = 0; x < COAST_CELLS; x++) {
    const shore = profile.shore[x]!;
    const cliff = profile.cliff[x]!;
    const open = x >= END_MARGIN && x <= COAST_CELLS - 1 - END_MARGIN;
    for (let y = 0; y < COAST_CELLS; y++) {
      const i = at(x, y);
      // The sea runs the full length of the grid, past both ends of the walk:
      // capping it would put a wall of rock across the water where the map
      // happens to stop, and the one thing the camera always sees out there is
      // that there is more of it.
      if (y >= shore) water[i] = 1;
      // Floor runs a little PAST the waterline, so the shallows are walkable.
      if (open && y > cliff && y < shore + WADE_CELLS) cells[i] = 1;
    }
  }

  // Rocks and scrub in the open sand. Added one at a time, each kept only if the
  // walk still connects: a blob that pinches the beach shut is the one failure
  // this shape can have, and it costs one flood to rule out.
  const blobRng = createStream(seed, `${contentVersion}.coast.blobs`);
  const startX = END_MARGIN + 6;
  const bossX = COAST_CELLS - 1 - END_MARGIN - Math.floor(BOWL_LEN / 2);
  const midY = (x: number): number => Math.round((profile.shore[x]! + profile.cliff[x]!) / 2);
  const startCanon = { x: startX, y: midY(startX) };
  const bossCanon = { x: bossX, y: midY(bossX) };
  const canonCell = (p: { x: number; y: number }): { cx: number; cy: number } =>
    mapCell(frame, p.x, p.y);

  const reaches = (): boolean => {
    const from = nearestStandable(cells, canonCell(startCanon).cx, canonCell(startCanon).cy);
    if (!from) return false;
    const seen = bfsReachable(cells, COAST_CELLS, from);
    const b = canonCell(bossCanon);
    return seen[b.cy * COAST_CELLS + b.cx] === 1;
  };

  const placed: { x: number; y: number }[] = [];
  for (let n = 0; n < BLOB_TRIES; n++) {
    const bx = blobRng.nextInt(END_MARGIN + 12, COAST_CELLS - 1 - END_MARGIN - 12);
    const lo = Math.ceil(profile.cliff[bx]!) + 3;
    const hi = Math.floor(profile.shore[bx]!) - 3;
    if (hi - lo < 6) continue;
    const by = blobRng.nextInt(lo, hi);
    // Never in the bay and never on the doorstep: the boss needs its ground
    // clear, and a rock inside the safe wedge is a rock the player spawns in.
    if (Math.abs(bx - startCanon.x) < 12 || bx > COAST_CELLS - 1 - END_MARGIN - BOWL_LEN) continue;
    if (placed.some((q) => Math.hypot(q.x - bx, q.y - by) < BLOB_SPACING)) continue;
    placed.push({ x: bx, y: by });
    const rx = blobRng.nextInt(BLOB_MIN_R, BLOB_MAX_R);
    const ry = blobRng.nextInt(BLOB_MIN_R, BLOB_MAX_R);
    const touched: number[] = [];
    for (let y = by - ry; y <= by + ry; y++)
      for (let x = bx - rx; x <= bx + rx; x++) {
        if (x < 0 || y < 0 || x >= COAST_CELLS || y >= COAST_CELLS) continue;
        const dx = (x - bx) / rx, dy = (y - by) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const i = at(x, y);
        if (cells[i] !== 1) continue;
        cells[i] = 0;
        touched.push(i);
      }
    if (touched.length > 0 && !reaches()) for (const i of touched) cells[i] = 1;
  }

  const startCell = nearestStandable(cells, canonCell(startCanon).cx, canonCell(startCanon).cy);
  // Floor the walk cannot reach is floor that reads as a bug. Erased BEFORE the
  // anchors are chosen, not after: a spawn placed on a pocket this pass then
  // deletes is an unreachable spawn, and the reachability gate fails the whole
  // layout for it.
  if (startCell) {
    const reached = bfsReachable(cells, COAST_CELLS, startCell);
    for (let i = 0; i < cells.length; i++) if (cells[i] === 1 && reached[i] !== 1) cells[i] = 0;
  }
  const bossCell = nearestStandable(cells, canonCell(bossCanon).cx, canonCell(bossCanon).cy);
  if (!startCell || !bossCell) {
    // Unreachable in practice (the band is open by construction), but the
    // contract is a valid layout or none.
    return buildLayout({
      size: COAST_CELLS, seed, contentVersion, usedFallback: true, cells,
      objectiveAnchors: [], spawnSockets: [], chosenVariantIds: [], spawnTarget,
    });
  }

  // The return portal stands a few paces down the beach from the arrival point,
  // not on top of it: two portals in one spot is one portal the player misses.
  // BEHIND him, away from the boss: put it the other way and the way home sits in
  // the middle of the first view of the map, which is the one thing the arrival
  // shot should be showing.
  const exitCanon = { x: startX - 5, y: midY(startX - 5) };
  const exitCell = nearestStandable(cells, canonCell(exitCanon).cx, canonCell(exitCanon).cy) ?? startCell;

  const objectiveAnchors: Socket[] = [
    { id: "start", ...cellCentre(COAST_CELLS, startCell.cx, startCell.cy) },
    { id: "boss", ...cellCentre(COAST_CELLS, bossCell.cx, bossCell.cy) },
    { id: "exit", ...cellCentre(COAST_CELLS, exitCell.cx, exitCell.cy) },
  ];
  const start = objectiveAnchors[0]!;
  const farEnough = (p: { x: number; y: number }): boolean =>
    Math.hypot(p.x - start.x, p.y - start.y) >= SPAWN_SAFE_RADIUS;

  // Spawns walk the shore. Evenly spaced ALONG it and jittered across it, which
  // is the same rule the assembler follows for the same reason: packs bunched at
  // the far end leave the first half of the map empty.
  const spawnRng = createStream(seed, `${contentVersion}.coast.spawns`);
  const spawnSockets: Socket[] = [];
  const firstX = startX + 12;
  const lastX = bossX - 4;
  for (let i = 0; i < spawnTarget; i++) {
    const x = Math.round(firstX + ((lastX - firstX) * i) / (spawnTarget - 1));
    const lo = Math.ceil(profile.cliff[x]!) + 2;
    const hi = Math.floor(profile.shore[x]!) - 2;
    if (hi <= lo) continue;
    const y = spawnRng.nextInt(lo, hi);
    const c = canonCell({ x, y });
    const spot = nearestStandable(cells, c.cx, c.cy);
    if (!spot) continue;
    const p = cellCentre(COAST_CELLS, spot.cx, spot.cy);
    if (!farEnough(p)) continue;
    if (spawnSockets.some((s) => s.x === p.x && s.y === p.y)) continue;
    spawnSockets.push({ id: `spawn.${spawnSockets.length}`, ...p });
  }

  // Rewards hug the cliff, off the walking line. A cache on the route is a cache
  // the player cannot fail to see, and a find that costs nothing is not one.
  const rewardRng = createStream(seed, `${contentVersion}.coast.rewards`);
  let rewards = 0;
  for (let i = 0; i < 6; i++) {
    const x = Math.round(startX + 16 + ((bossX - startX - 20) * i) / 5) + rewardRng.nextInt(-3, 3);
    if (x < END_MARGIN + 2 || x > COAST_CELLS - 1 - END_MARGIN - 2) continue;
    const y = Math.ceil(profile.cliff[x]!) + rewardRng.nextInt(2, 5);
    const c = canonCell({ x, y });
    const spot = nearestStandable(cells, c.cx, c.cy);
    if (!spot) continue;
    const p = cellCentre(COAST_CELLS, spot.cx, spot.cy);
    if (!farEnough(p)) continue;
    objectiveAnchors.push({ id: `reward.${rewards++}`, ...p });
  }

  const layout = buildLayout({
    size: COAST_CELLS,
    seed,
    contentVersion,
    usedFallback: false,
    cells,
    objectiveAnchors,
    spawnSockets,
    chosenVariantIds: [`coast:${frame.flipX ? "x" : "-"}${frame.flipY ? "y" : "-"}`],
    spawnTarget,
  });
  // The water mask rides on the grid rather than through a second channel: the
  // renderer already receives the grid, and which cells are SEA cannot be
  // derived from walkability alone — the cliff side is wall too.
  layout.grid.water = water;
  // And the waterline itself, as the curve, because the mask is cells and cells
  // are a staircase. The renderer draws the sea off this and never off the mask.
  layout.grid.shore = shoreline(profile, frame);
  return layout;
}

/**
 * The waterline as a world-space curve, one sample per grid column.
 *
 * The cell mask says which squares are wet; this says where the water's EDGE
 * is, to a fraction of a cell. They come from the same numbers, so they can
 * never disagree — but only this one can be drawn without stairs.
 */
function shoreline(profile: Profile, frame: Frame): Shoreline {
  const origin = gridOrigin(COAST_CELLS);
  const cross = new Float32Array(COAST_CELLS);
  for (let x = 0; x < COAST_CELLS; x++) {
    // Water starts AT row `shore`, so the edge is the boundary half a cell short
    // of that row's centre.
    const canonRow = profile.shore[x]! - 0.5;
    const row = frame.flipY ? COAST_CELLS - 1 - canonRow : canonRow;
    const col = frame.flipX ? COAST_CELLS - 1 - x : x;
    cross[col] = origin + row * CELL_SIZE;
  }
  return {
    along: "x",
    start: origin,
    step: CELL_SIZE,
    cross,
    // Canonically the sea is at greater y; the mirror is the only thing that
    // can turn that around.
    seaSide: frame.flipY ? -1 : 1,
  };
}

/** Where the anchors sit, for tests that want the shape rather than the layout. */
export function coastProfileForTest(seed: number, contentVersion: string): Profile {
  return buildProfile(createStream(seed, `${contentVersion}.coast.shape`));
}
