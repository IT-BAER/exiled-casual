/**
 * The furniture the hideout is lived in with, and the floor it takes up.
 *
 * Content rather than art, and it lives here rather than in the renderer because
 * two of them need it: `apps/web/src/render/hideout.ts` stands the props up, and
 * `simulation/areas.ts` turns the same list into collision so the player walks
 * around a table instead of through it. A second copy on the client would drift
 * the day one of these numbers moves, and the drift would be invisible — the
 * table would simply stop being where it stops you.
 *
 * Every piece is capped near a metre. The camera sits about 49 degrees above the
 * horizon, so a prop of height h hides roughly 0.87h of world behind it, and a
 * hideout you cannot see yourself in is worse than a bare one. The bookshelf is
 * the one exception at two metres: it stands BEHIND Maren, so what it hides is
 * wall, never her.
 *
 * Every piece has a stable `id`: Edit Hideout (PoE's decoration mode) saves a
 * moved piece under it, so the list may be reordered but an id never reused.
 */

/** The `props.glb` kinds the hideout stands on its floor. */
export type DecorKind =
  | "rug" | "table" | "bench" | "crate" | "barrel" | "pillar" | "brazier"
  | "bookshelf" | "cauldron" | "grainSack" | "pot";

/**
 * What rides on top of a piece and moves with it: wares on Varkis's counter, the
 * atlas on Maren's table. `atlasModel` is the one built in code (render/atlas-model.ts),
 * every other kind is a `props.glb` root.
 */
export type DecorExtraKind =
  | "candles" | "scrollWisdom" | "scrollPortal" | "orbTransmutation" | "orbAugmentation"
  | "orbAlchemy" | "orbElevation" | "goldPile" | "ringEmber" | "amuletIronsworn" | "waystone"
  | "atlasModel";

export interface DecorExtra {
  kind: DecorExtraKind;
  /** Along the piece's own length (local +X) and depth (local +Z, its back), metres. */
  dx: number;
  dz: number;
  /** Radians about Y, relative to the piece. */
  yaw?: number;
  /** Uniform scale; 1 if absent. */
  s?: number;
}

export interface Decor {
  /** Stable key Edit Hideout saves a moved piece under. */
  id: string;
  kind: DecorKind;
  /** World x and z. Sim (x, y) is Babylon (x, z), same as every actor. */
  x: number;
  z: number;
  /** Radians about Y. See SCREEN_SQUARE for what to measure it against. */
  yaw: number;
  /** Stretch along the piece's own length and depth. Footprint and art follow it; extras do not. */
  scale?: { x: number; z: number };
  /** Height the extras stand at: the top of this piece. */
  top?: number;
  extras?: readonly DecorExtra[];
}

/**
 * A prop turned this far reads square to the SCREEN rather than to the world grid.
 *
 * The camera looks along the diagonal, so a table built along +X runs off toward
 * the corner of the frame. Furniture composed for a fixed camera wants its long
 * edge across that camera's view, which is this angle and not zero. It is
 * `CAMERA_ALPHA` from render/engine.ts; hideout.test.ts pins the two together.
 *
 * The SIGN is the whole thing, and it was wrong once: a yaw of +PI/4 takes a prop's
 * local +X to world (0.707, -0.707), which is straight DOWN the frame, so every
 * long piece stood at ninety degrees to the composition it was written for.
 */
export const SCREEN_SQUARE = -Math.PI / 4;

/**
 * A placement written where the composition actually happens: on the screen.
 *
 * The camera's 45-degree lean means world coordinates say nothing about where a
 * prop lands in the frame. So these are screen units: `sx` runs right along the
 * frame, `sy` runs up it, the origin is the player's arrival point, and the visible
 * box is about 19 by 9.5. `areas.ts` turns its own literals by the same angle.
 */
function at(sx: number, sy: number): { x: number; z: number } {
  const r = Math.SQRT1_2;
  return { x: (sx - sy) * r, z: (sx + sy) * r };
}

/** A yaw in whole degrees. Pieces with off-centre discs stand on a ROT_STEP (see defaultTrig). */
function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/** The table's top, from `build_table` in tools/build_props.py. */
const TABLE_TOP = 0.83;

/** Edit Hideout turns a piece in steps of this many degrees, the wheel's notch. */
export const ROT_STEP = 15;

/**
 * The four things the sim spawns as interactables, where they stand until the
 * player moves them. `yaw` is the sim's own (`InteractableC.yaw`, authored for a
 * camera due south; the renderer turns it by the lens's lean). `block` is the
 * floor its body takes up, about two thirds of the prop for FOOTPRINT's reason.
 *
 * The device is a literal, not `at(0, 4)`: its position is in every hideout
 * replay, and `at` would move it by four tenths of a millimetre.
 */
export type HideoutServiceId = "mapDevice" | "stash" | "vendor" | "cartographer";
export const HIDEOUT_SERVICES: Readonly<Record<HideoutServiceId, { x: number; z: number; yaw: number; block: number }>> = {
  // DEVICE_SPAN 1.61 across in build_props.py.
  mapDevice: { x: -2.828, z: 2.828, yaw: 0, block: 0.55 },
  // Up-left of the arrival spot, between Maren's corner and the device: on the
  // walk to both and 2 below the nearest portal slot. STASH_CHEST_W 1.20.
  stash: { ...at(-3.6, 2.1), yaw: 0.25, block: 0.4 },
  // Straight behind the middle of his counter on the right flank, facing the
  // camera (PI) square on like the counter: his legs are behind timber and his
  // hands are over the wares. The room around the two stalls stays organic.
  vendor: { ...at(5.7, 0.45), yaw: 3.14159, block: 0.28 },
  // Straight behind the middle of her atlas table on the left flank.
  cartographer: { ...at(-5.6, 0.45), yaw: 3.14159, block: 0.28 },
};

export const HIDEOUT_SERVICE_IDS = Object.keys(HIDEOUT_SERVICES) as HideoutServiceId[];

/**
 * Where everything stands.
 *
 * Composed against the device top-centre with its portal arc across the top and
 * the player arriving dead centre: the lane between those two stays clear, Varkis
 * keeps a stall on the right flank and Maren a map room on the left, and the
 * hearth sits at the foot of the frame. The bottom corners are behind the life and
 * mana globes, so nothing that matters stands there.
 */
export const HIDEOUT_DECOR: readonly Decor[] = [
  // Maren's map room. A big table, half again a trestle's length, with her
  // Atlas standing on it in relief; a rug under the lot and her books behind her.
  // Turned off the screen square, like everything here: a room somebody lives in
  // is not laid out on a grid.
  {
    id: "carto-table", kind: "table", ...at(-5.6, -0.55), yaw: SCREEN_SQUARE,
    scale: { x: 1.45, z: 1.4 }, top: TABLE_TOP,
    extras: [
      { kind: "atlasModel", dx: 0, dz: 0.02 },
      { kind: "candles", dx: -1.38, dz: 0.42, yaw: 0.4 },
      { kind: "candles", dx: 1.4, dz: 0.4, yaw: -0.7 },
      { kind: "waystone", dx: -1.3, dz: -0.4, yaw: 0.5 },
      { kind: "scrollWisdom", dx: 1.3, dz: -0.42, yaw: 0.6 },
    ],
  },
  { id: "rug-carto", kind: "rug", ...at(-5.75, -0.25), yaw: deg(306), scale: { x: 1.5, z: 1.75 } },
  { id: "bookshelf-maps", kind: "bookshelf", ...at(-6.95, 1.7), yaw: deg(300) },
  { id: "crate-carto", kind: "crate", ...at(-8.25, 0.35), yaw: SCREEN_SQUARE + 0.5 },
  { id: "barrel-carto", kind: "barrel", ...at(-8.0, -0.95), yaw: 0 },
  { id: "sack-nw", kind: "grainSack", ...at(-8.15, 2.25), yaw: SCREEN_SQUARE + 0.3 },

  // Varkis's stall: a counter with his wares laid out on it, a rug to stand
  // the stall on and his stock stacked behind him.
  {
    id: "vendor-counter", kind: "table", ...at(5.7, -0.5), yaw: SCREEN_SQUARE, top: TABLE_TOP,
    extras: [
      { kind: "orbTransmutation", dx: -0.82, dz: -0.12 },
      { kind: "orbAugmentation", dx: -0.62, dz: 0.12 },
      { kind: "orbAlchemy", dx: -0.42, dz: -0.18 },
      { kind: "orbElevation", dx: -0.25, dz: 0.16 },
      { kind: "ringEmber", dx: -0.02, dz: -0.15, yaw: 0.8 },
      { kind: "amuletIronsworn", dx: 0.18, dz: 0.12, yaw: -0.4 },
      { kind: "scrollPortal", dx: 0.42, dz: -0.18, yaw: 0.3 },
      { kind: "goldPile", dx: 0.7, dz: 0.08, s: 0.55 },
      { kind: "candles", dx: 0.98, dz: 0.28, yaw: 0.9 },
    ],
  },
  { id: "rug-stall", kind: "rug", ...at(5.8, -0.15), yaw: deg(322), scale: { x: 1.15, z: 1.6 } },
  { id: "crate-stall", kind: "crate", ...at(7.3, 1.65), yaw: SCREEN_SQUARE + 0.9 },
  { id: "barrel-stall", kind: "barrel", ...at(4.25, 1.25), yaw: 0 },
  { id: "crate-stall-2", kind: "crate", ...at(8.05, 0.05), yaw: SCREEN_SQUARE - 0.6 },
  { id: "sack-stall", kind: "grainSack", ...at(8.1, -1.15), yaw: SCREEN_SQUARE + 0.8 },
  { id: "pot-stall", kind: "pot", ...at(4.2, -1.3), yaw: 0.4 },

  // Broken columns at the edges of the frame: the ruin somebody moved into.
  { id: "pillar-nw", kind: "pillar", ...at(-8.8, 3.4), yaw: 0.4 },
  { id: "pillar-ne", kind: "pillar", ...at(8.6, 3.55), yaw: -0.9 },
  { id: "pillar-w", kind: "pillar", ...at(-9.1, -1.7), yaw: 2.6 },
  { id: "pillar-e", kind: "pillar", ...at(9.0, -1.35), yaw: 1.7 },
  // Fire: a bowl up at each top corner and the hearth at the foot of the frame,
  // so the room is lit from its own corners (render/lights.ts lights them).
  { id: "brazier-nw", kind: "brazier", ...at(-7.3, 3.45), yaw: 0 },
  { id: "brazier-ne", kind: "brazier", ...at(7.5, 3.1), yaw: 0 },
  { id: "brazier-hearth", kind: "brazier", ...at(0.3, -4.0), yaw: 0 },
  // The hearth corner: a bench angled at the fire, a pot on the boil, a sack.
  { id: "bench-hearth", kind: "bench", ...at(-1.6, -3.75), yaw: deg(345) },
  { id: "cauldron-hearth", kind: "cauldron", ...at(1.95, -3.8), yaw: 0.6 },
  { id: "sack-hearth", kind: "grainSack", ...at(-3.2, -3.15), yaw: SCREEN_SQUARE - 0.4 },
  // Under the player on arrival, just below him: a rug he stands on is a rug
  // nobody sees.
  { id: "rug-arrival", kind: "rug", ...at(0.15, -2.1), yaw: deg(309) },
];

/**
 * What a piece stands on, as discs in its OWN frame: `[along its length, along
 * its depth, radius]`, metres, before `scale`.
 *
 * Deliberately UNDER the prop's real half-width, roughly two thirds of it. The
 * player's own body is a 0.5 disc, so a footprint drawn to the silhouette stops
 * him half a metre short of the timber and reads as an invisible wall around the
 * furniture. Shoulders clipping a tabletop is what every ARPG does and nobody
 * sees; a gap is what everybody sees. A table takes three discs so a stretched one
 * leaves no gap a body fits through. A rug is floor.
 */
const FOOTPRINT: Record<DecorKind, readonly (readonly [number, number, number])[]> = {
  rug: [],
  table: [[-0.65, 0, 0.3], [0, 0, 0.3], [0.65, 0, 0.3]],
  bench: [[-0.32, 0, 0.18], [0.32, 0, 0.18]],
  crate: [[0, 0, 0.28]],
  barrel: [[0, 0, 0.2]],
  pillar: [[0, 0, 0.3]],
  brazier: [[0, 0, 0.2]],
  bookshelf: [[-0.15, 0, 0.2], [0.15, 0, 0.2]],
  cauldron: [[0, 0, 0.22]],
  grainSack: [[0, 0, 0.25]],
  pot: [[0, 0, 0.18]],
};

/**
 * The floor the player can walk, in the same screen units as `at`: a step past the
 * columns on both flanks, the hearth below and the portal arc above. The ground
 * plane runs on into the dark, so without an edge a walk away lost the room.
 */
export const HIDEOUT_FLOOR = { left: -10, right: 10, bottom: -5.5, top: 8.5 } as const;

/** True when world (x, z) lies on the walkable floor. */
export function onHideoutFloorWorld(x: number, z: number): boolean {
  const r = Math.SQRT1_2;
  const sx = (x + z) * r, sy = (z - x) * r;
  return sx >= HIDEOUT_FLOOR.left && sx <= HIDEOUT_FLOOR.right && sy >= HIDEOUT_FLOOR.bottom && sy <= HIDEOUT_FLOOR.top;
}

/**
 * cos and sin of every ROT_STEP, as literals. A moved piece's discs are turned by
 * these rather than by Math.cos: the sim collides against them, and a
 * transcendental is the one float result that may differ between engines.
 */
const COS_STEPS: readonly number[] = [
  1, 0.9659258262890683, 0.8660254037844387, 0.7071067811865476, 0.5, 0.25881904510252074,
  0, -0.25881904510252074, -0.5, -0.7071067811865476, -0.8660254037844387, -0.9659258262890683,
  -1, -0.9659258262890683, -0.8660254037844387, -0.7071067811865476, -0.5, -0.25881904510252074,
  0, 0.25881904510252074, 0.5, 0.7071067811865476, 0.8660254037844387, 0.9659258262890683,
];

/** `[cos, sin]` of a whole number of degrees that is a multiple of ROT_STEP. */
export function rotTrig(deg: number): readonly [number, number] {
  const k = (((Math.round(deg / ROT_STEP)) % 24) + 24) % 24;
  return [COS_STEPS[k]!, COS_STEPS[(k + 18) % 24]!];
}

/** Degrees, snapped to ROT_STEP and kept in 0..359: how a yaw is saved once moved. */
export function yawToRot(yaw: number): number {
  const deg = Math.round((yaw * 180) / Math.PI / ROT_STEP) * ROT_STEP;
  return ((deg % 360) + 360) % 360;
}

/** A moved piece: world floats and whole degrees, a multiple of ROT_STEP. */
export interface PiecePlacement { x: number; z: number; rot: number }

/** The discs `kind` stands on at (x, z), turned by `[c, s]` = cos/sin of its yaw. */
export function decorDiscs(
  d: Pick<Decor, "kind" | "scale">, x: number, z: number, trig: readonly [number, number],
): { x: number; z: number; r: number }[] {
  const [c, s] = trig;
  const sx = d.scale?.x ?? 1, sz = d.scale?.z ?? 1;
  const rs = Math.min(sx, sz);
  return FOOTPRINT[d.kind].map(([lx0, lz0, r]) => {
    const lx = lx0 * sx, lz = lz0 * sz;
    // Babylon's yaw takes local (lx, lz) to world (lx c + lz s, -lx s + lz c).
    return { x: x + lx * c + lz * s, z: z - lx * s + lz * c, r: r * rs };
  });
}

/**
 * A piece's own yaw as cos/sin. Only pieces with off-centre discs care, and those
 * all stand on a whole ROT_STEP (hideout.test.ts pins it), so the literal table
 * answers and no transcendental reaches the collision.
 */
function defaultTrig(d: Decor): readonly [number, number] {
  const degrees = (d.yaw * 180) / Math.PI;
  return Math.abs(degrees - Math.round(degrees)) < 1e-6 && Math.round(degrees) % ROT_STEP === 0
    ? rotTrig(Math.round(degrees))
    : [Math.cos(d.yaw), Math.sin(d.yaw)];
}

/**
 * Every disc the hideout's furniture stands on, in world (x, z) metres, with the
 * player's own arrangement (`moved`, by piece id) laid over the defaults.
 */
export function hideoutFootprints(moved?: Readonly<Record<string, PiecePlacement>>): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const d of HIDEOUT_DECOR) {
    const m = moved?.[d.id];
    out.push(...(m ? decorDiscs(d, m.x, m.z, rotTrig(m.rot)) : decorDiscs(d, d.x, d.z, defaultTrig(d))));
  }
  return out;
}

/** The decor piece with this id, if there is one. */
export function decorById(id: string): Decor | undefined {
  return HIDEOUT_DECOR.find((d) => d.id === id);
}
