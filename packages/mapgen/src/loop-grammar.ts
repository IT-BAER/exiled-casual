// The "loop" grammar: the chunk vocabulary for Vaal Stone and Swamp maps.
// Chunks are authored in a canonical orientation (a cap opens north, a corner
// opens north and east); the assembler rotates and mirrors them onto whatever
// mask the skeleton asked for.
//
// Every open edge is cells 6..9 of that border — see the opening invariant in
// chunks.ts. Caps are the dead ends, so they carry the reward markers.
import { deriveMask, type Chunk } from "./chunks";

export interface Grammar {
  id: string;
  /** 1x1 chunks, at least one per non-solid mask class. */
  chunks: Chunk[];
  /** The 2x2 boss arena, authored with a single north port in its west tile. */
  bossChunk: Chunk;
  /** Dead-end spurs hung off the loop. */
  branchCount: number;
}

export type MaskClass = "solid" | "cap" | "straight" | "corner" | "tee" | "cross";

export function maskClass(mask: number): MaskClass {
  const bits = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (bits === 0) return "solid";
  if (bits === 1) return "cap";
  if (bits === 3) return "tee";
  if (bits === 4) return "cross";
  // Two bits: opposite (N|S = 5, E|W = 10) is a straight, adjacent is a corner.
  return mask === 0b0101 || mask === 0b1010 ? "straight" : "corner";
}

/** cap, north-open: a round alcove at the end of a spur. */
const CAP_ALCOVE: Chunk = {
  id: "loop.cap.alcove",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "##............##",
    "##............##",
    "##......r.....##",
    "##............##",
    "##............##",
    "###..........###",
    "####........####",
    "######....######",
    "################",
    "################",
  ],
};

/** straight, north/south-open: a long gallery, the loop's main run. */
const STRAIGHT_GALLERY: Chunk = {
  id: "loop.straight.gallery",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "###..........###",
    "###..........###",
    "###...s..s...###",
    "###..........###",
    "###..........###",
    "###...s..s...###",
    "###..........###",
    "###..........###",
    "###..........###",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/** corner, north/east-open: the loop turns. */
const CORNER_BEND: Chunk = {
  id: "loop.corner.bend",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "####......######",
    "###.......######",
    "###..........###",
    "###...s.........",
    "###.............",
    "###.............",
    "###...s.........",
    "###..........###",
    "###.........####",
    "####.......#####",
    "######..########",
    "################",
    "################",
  ],
};

/** tee, north/east/south-open: where a spur leaves the loop. */
const TEE_CROSSING: Chunk = {
  id: "loop.tee.crossing",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "###..........###",
    "###..........###",
    "###....##.......",
    "###....##.......",
    "###.............",
    "###.............",
    "###..........###",
    "###...s......###",
    "###..........###",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/** cross, all four sides open: an open plaza where routes meet. */
const CROSS_PLAZA: Chunk = {
  id: "loop.cross.plaza",
  rows: [
    "######....######",
    "######....######",
    "###.........####",
    "##............##",
    "##............##",
    "##............##",
    "................",
    "................",
    "................",
    "................",
    "##............##",
    "##.....s......##",
    "##............##",
    "###.........####",
    "######....######",
    "######....######",
  ],
};

/** The boss arena: 2x2 tiles (32x32 cells = 16x16 world units), one port, on
 *  the north side of its west tile. A single 8x8-unit tile cannot hold a boss —
 *  the camera alone sees 19x9.5 units. */
const BOSS_HALL: Chunk = {
  id: "loop.boss.hall",
  rows: [
    "######....######################",
    "######....######################",
    "######....######################",
    "######....######################",
    "######....######################",
    "######....######################",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##......##............##......##",
    "##......##............##......##",
    "##............................##",
    "##.............b..............##",
    "##............................##",
    "##............................##",
    "##......##............##......##",
    "##......##............##......##",
    "##............................##",
    "##.............e..............##",
    "##............................##",
    "##............................##",
    "##............................##",
    "##............................##",
    "################################",
    "################################",
    "################################",
    "################################",
    "################################",
    "################################",
  ],
};

export const LOOP_GRAMMAR: Grammar = {
  id: "loop",
  chunks: [CAP_ALCOVE, STRAIGHT_GALLERY, CORNER_BEND, TEE_CROSSING, CROSS_PLAZA],
  bossChunk: BOSS_HALL,
  branchCount: 3,
};

// Authoring guard: the canonical masks must be what the borders actually say.
// A typo in a row would otherwise surface much later as an unmatchable tile.
const CANONICAL: readonly [Chunk, number][] = [
  [CAP_ALCOVE, 0b0001],
  [STRAIGHT_GALLERY, 0b0101],
  [CORNER_BEND, 0b0011],
  [TEE_CROSSING, 0b0111],
  [CROSS_PLAZA, 0b1111],
];
for (const [chunk, mask] of CANONICAL) {
  if (deriveMask(chunk.rows) !== mask) {
    throw new Error(`${chunk.id}: derived mask ${deriveMask(chunk.rows)}, authored for ${mask}`);
  }
}
