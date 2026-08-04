import { fp, fpStepToward, isqrt, type Fixed } from "@exiled/fixed-point";
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
 * Longest gap `sweep` leaves between two samples. Half a mapgen cell: sample any
 * coarser and a segment steps clean over a one-cell wall, which is exactly what
 * picking the farthest walkable fraction used to do.
 */
const SWEEP_QUANTUM: Fixed = fp(0.25);

/**
 * The farthest point along (dx, dy) a body of `bodyRadius` can reach from (x, y)
 * without ever passing through a wall. Returns a delta, zero when even the first
 * sample is blocked.
 *
 * This is the difference between "does the landing spot happen to be clear" and
 * "is there a way there": the first admits a teleport — or an area effect — across
 * a wall as long as the far side is floor. Sample count comes off the length, so
 * a 5-unit blink and a 20-unit aim are checked at the same resolution.
 */
export function sweep(
  collision: Collision,
  x: Fixed,
  y: Fixed,
  dx: Fixed,
  dy: Fixed,
  bodyRadius: Fixed,
): { dx: Fixed; dy: Fixed } {
  const steps = Math.max(1, Math.ceil(isqrt(dx * dx + dy * dy) / SWEEP_QUANTUM));
  let okx = 0;
  let oky = 0;
  for (let i = 1; i <= steps; i++) {
    const sx = Math.trunc((dx * i) / steps);
    const sy = Math.trunc((dy * i) / steps);
    if (!collision.isWalkable(x + sx, y + sy, bodyRadius)) break;
    okx = sx;
    oky = sy;
  }
  return { dx: okx, dy: oky };
}

/**
 * One step of a chase: toward the target, around whatever stands in the way.
 *
 * ONE controller per tick, chosen by the layout rather than by the moment.
 * Consulting the field only for a step a wall had already cancelled is what made
 * a monster grind on a wall's rim: greedy is unblocked a body-width off the wall,
 * so it pushed in until the rim cancelled it, the field pointed back at the cell
 * it came from, greedy freed up again, and the two alternated — 397 direction
 * reversals in 400 ticks, which is the shake seen in game.
 *
 * Anything that flips per tick reproduces that, including "did the step lower the
 * route cost" — that one flips as the body crosses a cell boundary, and measured
 * 12 reversals. The question has to be geometric and it has to be about the whole
 * journey: is the line to the target clear for this body? That answer changes once,
 * when the body rounds the corner, so the two controllers never trade ticks. Open
 * ground answers yes and stays byte-identical, because yes is the same old slide.
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
  const nav = collision.nav;
  if (!nav) return slid;

  if (hasLineOfSight(collision, x, y, targetX, targetY, bodyRadius)) return slid;

  const wp = nav.waypoint(x, y, targetX, targetY, bodyRadius);
  if (wp === null) return slid;

  const leg = fpStepToward(x, y, wp.x, wp.y, speedFixed);
  return slide(collision, x, y, leg.dx, leg.dy, bodyRadius);
}

/**
 * Whether a body of `bodyRadius` can travel the straight line from (x, y) to
 * (tx, ty) without meeting a wall.
 *
 * Two callers want two radii and both are right. `chaseStep` passes the body's
 * own, because it is asking whether it can walk there. Aggro passes 0, because
 * it is asking whether it can SEE there, and an eye has no width — a monster
 * that only woke when its shoulders fit through would sleep behind every pillar
 * it could plainly see past.
 */
export function hasLineOfSight(
  collision: Collision | undefined,
  x: Fixed,
  y: Fixed,
  tx: Fixed,
  ty: Fixed,
  bodyRadius: Fixed = 0,
): boolean {
  if (!collision) return true;
  const dx = tx - x;
  const dy = ty - y;
  const reach = sweep(collision, x, y, dx, dy, bodyRadius);
  return reach.dx === dx && reach.dy === dy;
}

/**
 * A standing object: furniture, a container, the map device. Round because a
 * barrel is round and a table is close enough at this camera, and because a disc
 * is the one shape the body disc can be tested against without an axis test.
 *
 * Kept apart from the wall grid rather than punched into it. The client builds
 * its `wallrun-*` boxes from those same cells, so a blocked cell under a crate
 * would grow a slab of biome masonry around it; and a 0.5-unit cell rounds a
 * 0.4 barrel up to a metre of blocked floor or down to nothing.
 */
export interface Blocker {
  x: Fixed;
  y: Fixed;
  /** Footprint radius, not the interact radius: what the body bumps into. */
  r: Fixed;
}

/** True when the body disc at (x, y) overlaps any blocker. */
function hitsBlocker(blockers: readonly Blocker[], x: Fixed, y: Fixed, bodyRadius: Fixed): boolean {
  for (const b of blockers) {
    const dx = x - b.x;
    const dy = y - b.y;
    const reach = b.r + bodyRadius;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  return false;
}

/**
 * Collision for an area that has furniture but no walls — the hideout, which is
 * an open plate. No nav: nothing hunts there, and a BFS wants a bounded grid.
 */
export function blockerCollision(blockers: readonly Blocker[]): Collision {
  return {
    isWalkable: (x, y, bodyRadius) => !hitsBlocker(blockers, x, y, bodyRadius),
  };
}

/** Adapt a mapgen walkable grid into a Collision (fixed-point → cell lookup). */
export function gridCollision(grid: WalkableGrid, blockers: readonly Blocker[] = []): Collision {
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

  const half = Math.trunc(cs / 2);

  /**
   * True when no wall cell overlaps the body disc. Every cell the disc can reach
   * is tested, not five sample points: at 0.5-unit cells a rim point sits almost
   * two cells out, so sampling skipped the cells in between and let 0.6 of a
   * 0.85 brute sit inside a wall. Out-of-grid counts as wall.
   */
  const isWalkable = (x: Fixed, y: Fixed, bodyRadius: Fixed): boolean => {
    if (!walkableAt(x, y)) return false;
    // Inside the same function the nav flood is built from, so a monster routes
    // around a crate rather than grinding on one it can see straight through.
    if (blockers.length > 0 && hitsBlocker(blockers, x, y, bodyRadius)) return false;
    const r = bodyRadius;
    if (r <= 0) return true;
    const loX = Math.floor((x - r - ox) / cs);
    const hiX = Math.ceil((x + r - ox) / cs);
    const loY = Math.floor((y - r - oy) / cs);
    const hiY = Math.ceil((y + r - oy) / cs);
    const r2 = r * r;
    for (let cy = loY; cy <= hiY; cy++) {
      for (let cx = loX; cx <= hiX; cx++) {
        const solid =
          cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows ||
          grid.cells[cy * grid.cols + cx] !== 1;
        if (!solid) continue;
        // Squared distance from the disc centre to that cell's box.
        const gx = Math.max(0, Math.abs(x - (ox + cx * cs)) - half);
        const gy = Math.max(0, Math.abs(y - (oy + cy * cs)) - half);
        if (gx * gx + gy * gy < r2) return false;
      }
    }
    return true;
  };

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
