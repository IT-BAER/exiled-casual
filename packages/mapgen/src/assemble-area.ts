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
import { TILE_CELLS, isWall, orientations, type Oriented } from "./chunks";
import { maskClass, type Grammar } from "./loop-grammar";
import { AREA_TILES, UNREACHED, generateSkeleton } from "./skeleton";

export const ASSEMBLED_CELLS = AREA_TILES * TILE_CELLS; // 144

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
function carveOrganicRim(cells: Uint8Array, masks: Uint8Array, rng: RandomStream): void {
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
      const dx = x - mid, dy = y - mid;
      const ang = Math.atan2(dy, dx);
      const r = radius + a1 * Math.sin(3 * ang + p1) + a2 * Math.sin(5 * ang + p2);
      if (Math.hypot(dx, dy) <= r) cells[y * ASSEMBLED_CELLS + x] = 1;
    }
  }
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
  if (grammar.organicRim) {
    carveOrganicRim(cells, skeleton.masks, createStream(seed, `${contentVersion}.layout.rim`));
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

  const farthestFirst = [...markersByTile.keys()].sort((a, b) => {
    const d = (skeleton.routeDist[b] ?? UNREACHED) - (skeleton.routeDist[a] ?? UNREACHED);
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

  const turns = createStream(seed, `${contentVersion}.layout.dressing`).nextInt(0, 3);
  for (let t = 0; t < turns; t++) cells = rotateCells(cells, ASSEMBLED_CELLS);
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
  });
  if (!layout.validationChecks.every((c) => c.passed)) {
    return fallbackLayout(seed, contentVersion, grammar.spawnTarget);
  }
  return layout;
}
