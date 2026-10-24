// Where an area's braziers stand. Pure in the grid, so the renderer that draws
// them and the sim that collides against them read the same list.
import type { AreaLayout, WalkableGrid } from "./grid";

export interface BrazierSpot {
  x: number;
  z: number;
  /** Seconds of offset, so two fires never breathe together. */
  phase: number;
}

/** The bowl's footprint radius, in world units: what a body cannot walk through. */
export const BRAZIER_RADIUS = 0.4;

/**
 * How far apart two fires must stand, in world units, and how many an area gets.
 *
 * The camera shows about nineteen units across, so this spacing puts at most a
 * couple in frame at once — which is the point. A corridor lit end to end is a
 * corridor with no dark in it, and dark is what makes the lit part worth walking
 * toward (docs/09: anticipation is the mechanism).
 */
const FIRE_SPACING = 11;
const FIRE_MAX = 10;

/** World units a reward container keeps free around its centre: the widest, a
 *  0.82 chest, is half that across, plus a margin. */
export const CONTAINER_CLEAR = 0.6;

/** World units between a bowl's centre and the nearest rock: its radius plus a margin. */
export const FIRE_CLEARANCE = 0.5;
/** A player body's width: what must still fit between a bowl and a container, or a
 *  strongroom whose door holds both is shut, and between a bowl and any rock in front of it. */
const BODY_GAP = 1;
/** Bodies a bowl may never shut out of a room: the player and the widest trash (Rotting Behemoth). */
const BODY_RADII = [0.5, 0.8];
/** Cells either side of a bowl that the door check floods: room for the way round it. */
const DOOR_WINDOW = 8;
/** World units a bowl keeps from a spawn socket: its radius, the widest body, a margin.
 *  A pack placed around a socket inside a bowl has nowhere in sight to stand. */
const SPAWN_CLEAR = 1.5;
/** Floor cells a brazier needs in front of it, and to either side along its wall, so it never plugs a lane. */
const FIRE_LANE_CELLS = 3;

/**
 * Where the braziers stand: against one flat wall side, half a cell out from it
 * (a boulder's face is ON the cell edge, and a bowl pushed into it sits in the
 * rock), with open floor in front so it never stands in a walking lane, and
 * clear of every reward container in `keepClear` and every spawn socket.
 *
 * Deterministic and RNG-free: the candidates are taken in grid order and kept
 * whenever they clear the spacing, so the same map always lights the same way.
 */
export function brazierSpots(
  grid: WalkableGrid,
  keepClear: readonly { x: number; y: number; id?: string }[] = [],
  spawns: readonly { x: number; y: number }[] = [],
): BrazierSpot[] {
  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const isFloor = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === 1;
  const isSea = (x: number, y: number): boolean =>
    grid.water !== undefined && x >= 0 && y >= 0 && x < cols && y < rows && grid.water[y * cols + x] === 1;
  const half = cellSize / 2;
  const clear = (px: number, pz: number, cx: number, cy: number): boolean => {
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (isFloor(x, y)) continue;
        const dx = Math.max(0, Math.abs(px - (originX + x * cellSize)) - half);
        const dz = Math.max(0, Math.abs(pz - (originY + y * cellSize)) - half);
        if (Math.hypot(dx, dz) < FIRE_CLEARANCE) return false;
      }
    }
    return true;
  };
  const spots: BrazierSpot[] = [];
  for (let y = 1; y < rows - 1 && spots.length < FIRE_MAX; y++) {
    for (let x = 1; x < cols - 1 && spots.length < FIRE_MAX; x++) {
      if (!isFloor(x, y)) continue;
      // Against a wall, and only where the wall is one flat side: a cell in a
      // corner takes a bowl that reads as jammed into the masonry.
      const wallN = !isFloor(x, y - 1);
      const wallS = !isFloor(x, y + 1);
      const wallW = !isFloor(x - 1, y);
      const wallE = !isFloor(x + 1, y);
      const sides = Number(wallN) + Number(wallS) + Number(wallW) + Number(wallE);
      if (sides !== 1) continue;
      // Never against the sea. Water is "wall" to this test, so on a beach every
      // candidate lined the tide line and the whole map was lit from the water —
      // a row of standing fires in the surf, which is the one place a fire cannot
      // be. A brazier belongs against the cliff.
      if (isSea(x, y - 1) || isSea(x, y + 1) || isSea(x - 1, y) || isSea(x + 1, y)) continue;
      // Unit step INTO the wall.
      const dx = wallE ? 1 : wallW ? -1 : 0;
      const dy = wallS ? 1 : wallN ? -1 : 0;
      let lane = true;
      for (let k = 1; k <= FIRE_LANE_CELLS && lane; k++) {
        lane = isFloor(x - dx * k, y - dy * k) && isFloor(x + dy * k, y + dx * k) && isFloor(x - dy * k, y - dx * k);
      }
      if (!lane) continue;
      const wx = originX + (x - dx / 2) * cellSize;
      const wz = originY + (y - dy / 2) * cellSize;
      if (!clear(wx, wz, x, y)) continue;
      // The lane only checks straight lines; a rock off its diagonal still pinched
      // the way past the bowl to less than a body. 4 cells reach past that gap.
      let passable = true;
      for (let j = y - 4; j <= y + 4 && passable; j++) {
        for (let i = x - 4; i <= x + 4 && passable; i++) {
          if (isFloor(i, j) || (i - x) * dx + (j - y) * dy >= 1) continue; // the wall it backs onto
          const gx = Math.max(0, Math.abs(wx - (originX + i * cellSize)) - half);
          const gz = Math.max(0, Math.abs(wz - (originY + j * cellSize)) - half);
          passable = Math.hypot(gx, gz) >= BRAZIER_RADIUS + BODY_GAP;
        }
      }
      if (!passable) continue;
      // Only a reward container is solid; the other anchors keep the old margin.
      if (keepClear.some((c) => Math.hypot(wx - c.x, wz - c.y) < CONTAINER_CLEAR
        + (c.id?.startsWith("reward.") ? BODY_GAP + BRAZIER_RADIUS : FIRE_CLEARANCE))) continue;
      if (spawns.some((c) => Math.hypot(wx - c.x, wz - c.y) < SPAWN_CLEAR)) continue;
      if (spots.some((s) => Math.hypot(s.x - wx, s.z - wz) < FIRE_SPACING)) continue;
      if (shutsFloor(grid, x, y, wx, wz, BRAZIER_RADIUS)) continue;
      spots.push({ x: wx, z: wz, phase: spots.length * 1.7 });
    }
  }
  return spots;
}

/**
 * Whether an obstacle of `radius` at (wx, wz) cuts the floor near cell (cx, cy) into
 * more pieces for any of `bodies` (default BODY_RADII): a bowl or a container in a door only a
 * body wide. Floods exactly as the sim's nav does (`gridNav`: cell centres, four
 * ways, a cell standable when its own cell is floor, no wall box inside the disc,
 * every blocker's radius plus the body's kept), so a gap a body squeezes through
 * between centres, which no monster and no route can use, counts as shut.
 */
export function shutsFloor(
  grid: WalkableGrid, cx: number, cy: number, wx: number, wz: number, radius: number,
  blockers: readonly { x: number; y: number; r: number }[] = [],
  bodies: readonly number[] = BODY_RADII,
): boolean {
  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const half = cellSize / 2;
  const side = 2 * DOOR_WINDOW + 1;
  const stands = (x: number, y: number, r: number, bowl: boolean): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows || cells[y * cols + x] !== 1) return false;
    const px = originX + x * cellSize, pz = originY + y * cellSize;
    if (bowl && Math.hypot(px - wx, pz - wz) < radius + r) return false;
    if (blockers.some((b) => Math.hypot(px - b.x, pz - b.y) < b.r + r)) return false;
    const reach = Math.ceil(r / cellSize) + 1;
    for (let j = y - reach; j <= y + reach; j++) {
      for (let i = x - reach; i <= x + reach; i++) {
        if (i >= 0 && j >= 0 && i < cols && j < rows && cells[j * cols + i] === 1) continue;
        const gx = Math.max(0, Math.abs(px - (originX + i * cellSize)) - half);
        const gz = Math.max(0, Math.abs(pz - (originY + j * cellSize)) - half);
        if (gx * gx + gz * gz < r * r) return false;
      }
    }
    return true;
  };
  const pieces = (r: number, bowl: boolean): number => {
    const seen = new Uint8Array(side * side);
    let count = 0;
    for (let k = 0; k < seen.length; k++) {
      if (seen[k] || !stands(cx - DOOR_WINDOW + (k % side), cy - DOOR_WINDOW + Math.floor(k / side), r, bowl)) continue;
      count++;
      seen[k] = 1;
      const stack = [k];
      while (stack.length > 0) {
        const m = stack.pop()!;
        const i = m % side, j = Math.floor(m / side);
        for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
          const nk = nj * side + ni;
          if (ni < 0 || nj < 0 || ni >= side || nj >= side || seen[nk]) continue;
          if (!stands(cx - DOOR_WINDOW + ni, cy - DOOR_WINDOW + nj, r, bowl)) continue;
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    return count;
  };
  return bodies.some((r) => pieces(r, true) > pieces(r, false));
}

/**
 * The spots for a whole layout: clear of every objective anchor (start, boss,
 * exit, rewards) and every spawn socket. The one call both the renderer and the
 * sim make, so the bowl drawn and the bowl collided against never drift apart.
 */
export function brazierSpotsFor(layout: Pick<AreaLayout, "grid" | "objectiveAnchors" | "spawnSockets">): BrazierSpot[] {
  return brazierSpots(layout.grid, layout.objectiveAnchors, layout.spawnSockets);
}
