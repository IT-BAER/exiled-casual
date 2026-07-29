import { fp, fpStepToward, type Fixed } from "@exiled/fixed-point";
import type { WalkableGrid } from "@exiled/mapgen";

/**
 * Static level collision. `isWalkable` answers whether the body disc of the
 * given radius, centred at world (x, y) in fixed-point, sits fully on walkable
 * ground. The returned boolean is the only value derived from the grid, and it
 * is a pure deterministic function of its Fixed inputs, so the sim stays
 * reproducible even though positions never leave integer fixed-point.
 */
export interface Collision {
  isWalkable(x: Fixed, y: Fixed, bodyRadius: Fixed): boolean;
  /** Grid-backed collision only; a hand-written test Collision has no grid. */
  nav?: Nav;
}

/**
 * A BFS distance field flooded from the chase target, read as a gradient. One
 * flood serves every monster hunting that target, so it beats A* per monster.
 */
export interface Nav {
  /** Centre of the next cell downhill, or null when there is no route. */
  waypoint(
    fromX: Fixed,
    fromY: Fixed,
    toX: Fixed,
    toY: Fixed,
    bodyRadius: Fixed,
  ): { x: Fixed; y: Fixed } | null;
}

/**
 * A mutable holder for the active level collision, read fresh by every movement
 * system each tick. Collision is captured in a system's register-time closure,
 * so an area transition (hideout → map) can only turn walls on/off by mutating
 * this shared holder — `active` is `null` wherever there is no level to collide
 * against (the hideout lab, legacy sims).
 */
export interface CollisionRef {
  active: Collision | null;
}

/**
 * Axis-separated slide against `collision`: move along X and Y independently,
 * cancelling only the axis that would push the body into a wall. This is what
 * makes an actor slide along a wall it walks into instead of sticking.
 */
export function slide(
  collision: Collision,
  x: Fixed,
  y: Fixed,
  dx: Fixed,
  dy: Fixed,
  bodyRadius: Fixed,
): { x: Fixed; y: Fixed } {
  let nx = x;
  let ny = y;
  if (dx !== 0 && collision.isWalkable(x + dx, y, bodyRadius)) nx = x + dx;
  if (dy !== 0 && collision.isWalkable(nx, y + dy, bodyRadius)) ny = y + dy;
  return { x: nx, y: ny };
}

/**
 * One step of a chase: toward the target, around whatever stands in the way.
 * The nav field is consulted only for a step a wall actually cancelled, so open
 * ground stays byte-identical to the bare `slide` this replaces (golden replays).
 */
export function chaseStep(
  collision: Collision | undefined,
  x: Fixed,
  y: Fixed,
  targetX: Fixed,
  targetY: Fixed,
  speedFixed: Fixed,
  bodyRadius: Fixed,
): { x: Fixed; y: Fixed } {
  const direct = fpStepToward(x, y, targetX, targetY, speedFixed);
  if (!collision) return { x: x + direct.dx, y: y + direct.dy };

  const slid = slide(collision, x, y, direct.dx, direct.dy, bodyRadius);
  if (slid.x === x + direct.dx && slid.y === y + direct.dy) return slid;

  const wp = collision.nav?.waypoint(x, y, targetX, targetY, bodyRadius);
  if (wp === null || wp === undefined) return slid;

  const leg = fpStepToward(x, y, wp.x, wp.y, speedFixed);
  return slide(collision, x, y, leg.dx, leg.dy, bodyRadius);
}

/** Adapt a mapgen walkable grid into a Collision (fixed-point → cell lookup). */
export function gridCollision(grid: WalkableGrid): Collision {
  // Grid geometry in fixed-point so the cell index is computed with integer
  // math on the sim's own Fixed coordinates (no per-call float drift).
  const ox = fp(grid.originX);
  const oy = fp(grid.originY);
  const cs = fp(grid.cellSize);

  const walkableAt = (xf: Fixed, yf: Fixed): boolean => {
    const cx = Math.round((xf - ox) / cs);
    const cy = Math.round((yf - oy) / cs);
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return false;
    return grid.cells[cy * grid.cols + cx] === 1;
  };

  const isWalkable = (x: Fixed, y: Fixed, bodyRadius: Fixed): boolean =>
    // Sample the disc centre plus its four cardinal rim points: cheap and
    // enough to keep a body out of a wall on the greybox cell grid.
    walkableAt(x, y) &&
    walkableAt(x + bodyRadius, y) &&
    walkableAt(x - bodyRadius, y) &&
    walkableAt(x, y + bodyRadius) &&
    walkableAt(x, y - bodyRadius);

  return { isWalkable, nav: gridNav(grid, ox, oy, cs, isWalkable) };
}

/** Larger than any route across a 112x112 lattice, so it doubles as "no route". */
const UNREACHABLE = 0xffff;
/** Fixed expansion order — the flood must not depend on iteration luck. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function gridNav(
  grid: WalkableGrid,
  ox: Fixed,
  oy: Fixed,
  cs: Fixed,
  isWalkable: (x: Fixed, y: Fixed, r: Fixed) => boolean,
): Nav {
  const { cols, rows } = grid;
  const n = cols * rows;
  const centreX = (cx: number): Fixed => ox + cx * cs;
  const centreY = (cy: number): Fixed => oy + cy * cs;
  const toCol = (xf: Fixed): number => Math.round((xf - ox) / cs);
  const toRow = (yf: Fixed): number => Math.round((yf - oy) / cs);

  // A property of the layout, not of the chase, so it survives every target move.
  const standable = new Map<Fixed, Uint8Array>();
  const standableFor = (r: Fixed): Uint8Array => {
    let s = standable.get(r);
    if (s !== undefined) return s;
    s = new Uint8Array(n);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        s[cy * cols + cx] = isWalkable(centreX(cx), centreY(cy), r) ? 1 : 0;
      }
    }
    standable.set(r, s);
    return s;
  };

  // One field per body radius, replaced when that radius' target leaves its cell,
  // so the map is bounded by the roster's distinct radii and never accumulates.
  const fields = new Map<Fixed, { cx: number; cy: number; dist: Uint16Array }>();
  const queue = new Int32Array(n);

  const fieldFor = (r: Fixed, tcx: number, tcy: number): Uint16Array => {
    const cached = fields.get(r);
    if (cached !== undefined && cached.cx === tcx && cached.cy === tcy) return cached.dist;

    const dist = new Uint16Array(n).fill(UNREACHABLE);
    const stand = standableFor(r);
    let head = 0;
    let tail = 0;
    if (tcx >= 0 && tcy >= 0 && tcx < cols && tcy < rows) {
      // Seeded even if the target's own cell is too tight for this body, so a
      // brute still walks to the mouth of a nook the player ducked into.
      const t = tcy * cols + tcx;
      dist[t] = 0;
      queue[tail++] = t;
    }
    while (head < tail) {
      const i = queue[head++]!;
      const cx = i % cols;
      const cy = (i - cx) / cols;
      const d = dist[i]! + 1;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (dist[j] !== UNREACHABLE || stand[j] !== 1) continue;
        dist[j] = d;
        queue[tail++] = j;
      }
    }
    fields.set(r, { cx: tcx, cy: tcy, dist });
    return dist;
  };

  return {
    waypoint(fromX, fromY, toX, toY, bodyRadius) {
      const cx = toCol(fromX);
      const cy = toRow(fromY);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null;
      const dist = fieldFor(bodyRadius, toCol(toX), toRow(toY));

      // Strictly downhill: equal-or-worse means arrived or cut off, and a null
      // there hands the caller back to its straight step instead of a shuffle.
      let best = dist[cy * cols + cx]!;
      let bx = -1;
      let by = -1;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const d = dist[ny * cols + nx]!;
        if (d < best) { best = d; bx = nx; by = ny; }
      }
      if (bx < 0) return null;
      return { x: centreX(bx), y: centreY(by) };
    },
  };
}
