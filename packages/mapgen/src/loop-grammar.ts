// The "loop" grammar: the chunk vocabulary for Vaal Stone and Swamp maps.
// Chunks are authored in a canonical orientation (a cap opens north, a corner
// opens north and east); the assembler rotates and mirrors them onto whatever
// mask the skeleton asked for.
//
// Every open edge is cells 6..9 of that border — see the opening invariant in
// chunks.ts. Caps are the dead ends, so they carry the reward markers.
import { assertAuthored, type Chunk } from "./chunks";

export interface Grammar {
  id: string;
  /** 1x1 chunks, at least one per non-solid mask class. */
  chunks: Chunk[];
  /** The 2x2 boss arena, authored with a single north port in its west tile. */
  bossChunk: Chunk;
  /** Dead-end spurs hung off the loop. */
  branchCount: number;
  /**
   * Carve the tiles the route does not use with a wobbly disc, so the area's
   * boundary is organic instead of a 7x7 square. A lattice of open ground reads
   * as a grid far more readily than a lattice of rooms does, which is why the
   * field grammar asks for this and the loop grammar does not.
   */
  organicRim?: boolean;
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

/** cap, north-open: a rectangular strongroom, reward against the back wall. */
const CAP_VAULT: Chunk = {
  id: "loop.cap.vault",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "##..........####",
    "##..........####",
    "##..........####",
    "##....##....####",
    "##....##....####",
    "##..........####",
    "##..........####",
    "##.......r..####",
    "##..........####",
    "################",
    "################",
    "################",
    "################",
  ],
};

/** cap, north-open: a walled inner chamber open only to the south. */
const CAP_SHRINE: Chunk = {
  id: "loop.cap.shrine",
  rows: [
    "######....######",
    "#####......#####",
    "####........####",
    "###..........###",
    "##............##",
    "##...######...##",
    "##...#....#...##",
    "##...#.rr.#...##",
    "##...#....#...##",
    "##...#....#...##",
    "##............##",
    "###..........###",
    "####........####",
    "#####......#####",
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

/** straight, north/south-open: two rows of pillars, cover the whole run. */
const STRAIGHT_COLONNADE: Chunk = {
  id: "loop.straight.colonnade",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "###..........###",
    "###.##....##.###",
    "###.##.s..##.###",
    "###.##....##.###",
    "###.##....##.###",
    "###.##.s..##.###",
    "###.##....##.###",
    "###..........###",
    "###..........###",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/** straight, north/south-open: pinched to the bare corridor at its middle. */
const STRAIGHT_NARROWS: Chunk = {
  id: "loop.straight.narrows",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###..........###",
    "###...s......###",
    "####........####",
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "####........####",
    "###......s...###",
    "###..........###",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/**
 * straight, north/south-open: a walled side room off the run, its mouth at the
 * far end, its reward at the near one — so the player has to walk PAST it, turn
 * back and come up the length of the room to take it. The camera is close
 * enough (19x9.5 units at beta 0.65) that a chamber one wall away is genuinely
 * out of sight until the mouth is reached; a "secret" here is a rewarded detour,
 * not an invisible door.
 */
const STRAIGHT_CACHE: Chunk = {
  id: "loop.straight.cache",
  rows: [
    "######....######",
    "######....######",
    "##....#.......##",
    "##....#.......##",
    "##....#.......##",
    "##..r.#...s...##",
    "##....#.......##",
    "##....#.......##",
    "##....#.......##",
    "##....#.......##",
    "##....#.......##",
    "##............##",
    "##............##",
    "##....s.......##",
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

/** corner, north/east-open: a wide rounded turn with no cover at all. */
const CORNER_SWEEP: Chunk = {
  id: "loop.corner.sweep",
  rows: [
    "######....######",
    "######....######",
    "#####.....######",
    "####.......#####",
    "###.........####",
    "##...........###",
    "##..............",
    "##..............",
    "##..............",
    "##..............",
    "##...........###",
    "###.....s...####",
    "####.......#####",
    "#####.....######",
    "################",
    "################",
  ],
};

/** corner, north/east-open: a wall block on the inside of the turn, so the
 *  approach is blind until you are committed to it. */
const CORNER_BUTTRESS: Chunk = {
  id: "loop.corner.buttress",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "###.......######",
    "###.......######",
    "###..........###",
    "###....##.......",
    "###....##.......",
    "###....##.......",
    "###.......s.....",
    "###..........###",
    "###..........###",
    "####........####",
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

/** tee, north/east/south-open: the junction opens into a room on the branch side. */
const TEE_LANDING: Chunk = {
  id: "loop.tee.landing",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###.........####",
    "###.........####",
    "###.........####",
    "###.............",
    "###....s........",
    "###.............",
    "###.............",
    "###.........####",
    "###.........####",
    "###.........####",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/** tee, north/east/south-open: the branch leaves through a gap in a spine wall. */
const TEE_GATE: Chunk = {
  id: "loop.tee.gate",
  rows: [
    "######....######",
    "######....######",
    "####........####",
    "###.......#..###",
    "###.......#..###",
    "###.......#..###",
    "###..s..........",
    "###.............",
    "###.............",
    "###....s........",
    "###.......#..###",
    "###.......#..###",
    "###.......#..###",
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

/** cross, all four sides open: a square court with four corner blocks. */
const CROSS_COURT: Chunk = {
  id: "loop.cross.court",
  rows: [
    "######....######",
    "######....######",
    "###.........####",
    "##..##....##..##",
    "##..##....##..##",
    "##............##",
    "................",
    ".....s..........",
    "..........s.....",
    "................",
    "##............##",
    "##..##....##..##",
    "##..##....##..##",
    "###.........####",
    "######....######",
    "######....######",
  ],
};

/** tee, north/east/south-open: a strongroom walled into the junction's west
 *  side, its mouth turned away from all three ways through. */
const TEE_STRONGROOM: Chunk = {
  id: "loop.tee.strongroom",
  rows: [
    "######....######",
    "######....######",
    "######......####",
    "##...#....######",
    "##...#....######",
    "##...#....######",
    "##...#..........",
    "##.r.#....s.....",
    "##...#..........",
    "##...#..........",
    "##........######",
    "##........######",
    "##........######",
    "####........####",
    "######....######",
    "######....######",
  ],
};

/** cross, all four sides open: a solid block dead centre, so the plaza is a ring. */
const CROSS_ISLAND: Chunk = {
  id: "loop.cross.island",
  rows: [
    "######....######",
    "######....######",
    "###.........####",
    "##............##",
    "##............##",
    "##............##",
    "......s.........",
    "......####......",
    "......####......",
    ".........s......",
    "##............##",
    "##............##",
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
  chunks: [
    CAP_ALCOVE, CAP_VAULT, CAP_SHRINE,
    STRAIGHT_GALLERY, STRAIGHT_COLONNADE, STRAIGHT_NARROWS, STRAIGHT_CACHE,
    CORNER_BEND, CORNER_SWEEP, CORNER_BUTTRESS,
    TEE_CROSSING, TEE_LANDING, TEE_GATE, TEE_STRONGROOM,
    CROSS_PLAZA, CROSS_COURT, CROSS_ISLAND,
  ],
  bossChunk: BOSS_HALL,
  branchCount: 5,
};

// Authoring guard: the canonical masks must be what the borders actually say.
// A typo in a row would otherwise surface much later as an unmatchable tile.
const CANONICAL: readonly [Chunk, number][] = [
  [CAP_ALCOVE, 0b0001],
  [CAP_VAULT, 0b0001],
  [CAP_SHRINE, 0b0001],
  [STRAIGHT_GALLERY, 0b0101],
  [STRAIGHT_COLONNADE, 0b0101],
  [STRAIGHT_NARROWS, 0b0101],
  [STRAIGHT_CACHE, 0b0101],
  [CORNER_BEND, 0b0011],
  [CORNER_SWEEP, 0b0011],
  [CORNER_BUTTRESS, 0b0011],
  [TEE_CROSSING, 0b0111],
  [TEE_LANDING, 0b0111],
  [TEE_GATE, 0b0111],
  [TEE_STRONGROOM, 0b0111],
  [CROSS_PLAZA, 0b1111],
  [CROSS_COURT, 0b1111],
  [CROSS_ISLAND, 0b1111],
];
assertAuthored(CANONICAL, BOSS_HALL);
