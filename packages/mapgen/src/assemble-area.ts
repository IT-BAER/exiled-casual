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

  // The boss arena covers its reserved 2x2 block. Orient it by re-deriving the
  // port of each transform rather than reasoning about how a port maps.
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
  // and land far from the entrance. Later passes take extra points from the
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
    if (maskClass(skeleton.masks[tile]!) !== "cap") continue;
    const m = (markersByTile.get(tile) ?? []).find((k) => k.ch === "r");
    if (!m) continue;
    objectiveAnchors.push({ id: `reward.${rewardCount++}`, ...cellCentre(ASSEMBLED_CELLS, m.cx, m.cy) });
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
  });
  if (!layout.validationChecks.every((c) => c.passed)) return fallbackLayout(seed, contentVersion);
  return layout;
}
