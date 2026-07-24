import { fp, type Fixed } from "@exiled/fixed-point";
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

  return {
    isWalkable(x, y, bodyRadius) {
      // Sample the disc centre plus its four cardinal rim points: cheap and
      // enough to keep a body out of a wall on the greybox cell grid.
      return (
        walkableAt(x, y) &&
        walkableAt(x + bodyRadius, y) &&
        walkableAt(x - bodyRadius, y) &&
        walkableAt(x, y + bodyRadius) &&
        walkableAt(x, y - bodyRadius)
      );
    },
  };
}
