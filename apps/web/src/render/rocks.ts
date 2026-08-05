import {
  Color3,
  LoadAssetContainerAsync,
  Matrix,
  PBRMaterial,
  Quaternion,
  Vector3,
  type AbstractMesh,
  type AssetContainer,
  type Material,
  type Mesh,
  type Scene,
} from "@babylonjs/core";

/**
 * The blocker rocks — six boulder variants as one authored glTF, scattered along
 * the wall band so a map's edges read as rock instead of as a row of cubes.
 *
 * `tools/build_rocks.py` makes the shapes; this module places them. It carries no
 * material of its own: a rock is dressed in its biome's `wall_color` plate, the
 * same material the merged band already uses, so one glb serves every tileset.
 *
 * Failure is not fatal, exactly as with the character rig and the hideout props:
 * a failed fetch (and every headless test) leaves `loaded` null, `buildLevel`
 * sees that and puts the full-height box band back, and the map still plays.
 */
const ROCKS_URL = "/models/rocks.glb";

/** glTF's own wrapper node, carrying the handedness flip. */
const GLTF_ROOT = "__root__";

/**
 * Rocks share the `wallrun-` prefix so the merge and disposal paths treat them as
 * level geometry, but engine.ts shadow-casts THIS prefix back in. The 4-unit smear
 * that got the box walls excluded is the whole look in `inside-map-battle.webp`:
 * what made a room unplayable was a 3.5-unit run casting one CONTINUOUS band, and
 * discrete boulders throw discrete smears with lit floor between them.
 */
export const ROCK_MESH_PREFIX = "wallrun-rock-";

/** Floor debris. Same exclusion, same reason, and a pebble lying on the ground
 *  has nothing to cast a useful shadow onto anyway. */
const DEBRIS_MESH_PREFIX = "wallrun-debris-";

/** Smallest gap between two rock centres, in world units.
 *
 *  Not a density knob on its own: it sets the WIDEST gap too, and that is the
 *  number the band's opacity depends on. Dart-throwing rejects a candidate that
 *  lands inside `spacing` of an accepted rock, so the worst case is a candidate
 *  rejected by a hair, and the next cell along accepted — `spacing + cellSize +
 *  spacing*JITTER`. At the mapgen's 0.5-unit cell that is 1.29, which MIN_WIDTH
 *  has to cover or the boulders stop overlapping and the void shows between
 *  them. 0.85 put the worst gap at 1.62 and wanted 1.7-wide rocks to close it. */
export const ROCK_SPACING = 0.6;

export { DEBRIS_MESH_PREFIX };

/** Positional jitter as a fraction of the spacing. Capped by MIN_WIDTH — see
 *  where it is used; this is not a free taste knob. */
const JITTER = 0.32;

/** Rock footprint in world units. The floor is NOT free: MIN_WIDTH has to cover
 *  the widest gap the scatter can leave (1.29 — see ROCK_SPACING) or the band
 *  opens notches. Boulders this size are also simply closer to the reference than
 *  the pebbles a smaller number gives. */
const MIN_WIDTH = 1.35;
const MAX_WIDTH = 1.95;
/** Height as a multiple of width, for the boulders the CAMERA LOOKS OVER.
 *
 *  Capped at the character's head, and this is the cap that may never be lifted:
 *  under a camera ~49 degrees up a rock of height h hides h/tan(49) ≈ 0.87h of
 *  world behind it, so a boulder taller than 1.8 hides the man walking behind it.
 *  0.78 puts the tallest at ~1.52 and his head clears every one.
 *
 *  Cave height comes from CLIFFS instead (see `CLIFF`), which are the same stone
 *  on the wall runs the camera looks AT rather than over. Splitting the two is
 *  what buys a tall cave wall without owing the frame an occlusion fade — raising
 *  THIS number is the thing that owes one. Under ~0.6 they read as flat slabs. */
const MIN_ASPECT = 0.62;
const MAX_ASPECT = 0.78;
/** Off-vertical lean. Small on purpose — a rock is heavy, and a whole boundary
 *  of visibly tipped boulders reads as debris rather than as bedrock. */
const MAX_TILT = 0.16;

/** Everything the scatter needs to know about one kind of stone. Boulders and
 *  floor debris are the same six meshes at different sizes, so the difference
 *  between them is data, not a second code path. */
interface ScatterConfig {
  spacing: number;
  minWidth: number;
  maxWidth: number;
  minAspect: number;
  maxAspect: number;
  maxTilt: number;
  /** How far below the floor the shape sits, as a fraction of its height. A
   *  pebble resting exactly on y=0 reads as placed on the ground; sunk a little
   *  it reads as part of it. */
  sink: number;
  /**
   * Half the depth of the wall cell a rock is centred on, when the rock is meant
   * to line up with that cell's inner FACE. Boulders are 1.35-1.95 wide on a
   * 0.5-unit cell, so centred they bulge up to 0.72 units into floor the sim
   * happily walks on — and since collision stops a body at the cell face, what
   * you see is monsters standing inside rock, worst of all now that they route
   * along walls. Set here, each rock is pushed out along its cell's outward
   * normal by exactly its own overhang, putting the face he sees on the face the
   * sim collides against.
   *
   * ponytail: needs a normal, so a wall cell with floor on opposite sides (a
   * one-cell partition) and an isolated pillar both get no offset — no direction
   * is out. Fixing those means geometry per cell, not a nudge.
   */
  outwardHalfCell?: number;
  /**
   * World units to move the shape the OTHER way, onto the floor the cell
   * borders. The opposite of `outwardHalfCell` and for the opposite reason: a
   * thing that grows at the foot of a boundary rather than being part of it.
   *
   * Without this the coast's scrub was placed on the boundary cells and then
   * buried by the dune scattered over the same cells — several hundred clumps
   * drawn inside a metre of opaque sand, which reads on screen as a bald berm
   * with six stray tufts where the mounds happen not to meet.
   */
  inset?: number;
  /**
   * World units to raise the shape off the ground, before `sink`.
   *
   * For the one case where a scatter is dressing something ELSE the scatter put
   * there: the coast's scrub grows on top of its ledge, and the ledge is a metre
   * of opaque rock built from the same cells. Placed at y=0 the clumps were
   * inside it.
   */
  lift?: number;
}

const BOULDERS: ScatterConfig = {
  spacing: ROCK_SPACING,
  minWidth: MIN_WIDTH,
  maxWidth: MAX_WIDTH,
  minAspect: MIN_ASPECT,
  maxAspect: MAX_ASPECT,
  maxTilt: MAX_TILT,
  sink: 0,
};

/**
 * Floor debris: the same boulders at a tenth the size, thrown across the open
 * floor. The tiling plate is the largest thing on screen and its repeat is the
 * loudest artifact left in a frame — a plate cannot hide that on its own, but
 * scattered stone breaking the grid line does, and it costs no new asset.
 *
 * Free to tilt hard, unlike the boulders: a pebble lying on its side is a
 * pebble, while a tipped boulder reads as debris rather than as bedrock.
 */
const DEBRIS: ScatterConfig = {
  spacing: 2.1,
  minWidth: 0.12,
  maxWidth: 0.42,
  minAspect: 0.3,
  maxAspect: 0.6,
  maxTilt: 0.9,
  sink: 0.35,
};

/**
 * The map's outer rim, and the ONLY stone allowed to be tall.
 *
 * This is where the cave comes from, because it is the one place height is free:
 * nothing is ever behind this ring — it IS the edge of the world — so it cannot
 * hide anything the player needs. That is exactly how the reference is built.
 * The huge dark masses in `map boundary(right side).webp` and the sloping walls
 * framing `inside-map-battle.webp` are all boundary, standing two to three times
 * the player's height and running up out of the shot, while the floor they
 * enclose stays open.
 *
 * It also has to be tall because the ground plate stops exactly here and past it
 * is the void. A single row of boulder-height rock left a lip of bare dirt ending
 * in black, which is the one thing the reference frames never show: in PoE the
 * floor runs to every edge and the world never visibly stops.
 *
 * Wider spacing than the boulders on purpose. These are big enough to close the
 * ring on their own, and packing them as tightly turns a rampart into gravel.
 */
const RAMPART: ScatterConfig = {
  spacing: 1,
  minWidth: 1.9,
  maxWidth: 2.6,
  // 3.6 to 6.2 units: two to three times the player, which is the reference's
  // proportion at the boundary. Free to go here and nowhere else.
  minAspect: 1.9,
  maxAspect: 2.4,
  maxTilt: 0.12,
  /** Bedrock, not scree: the rim should look like it comes out of the ground. */
  sink: 0.08,
};

/**
 * The rim on the camera's own side, which may NOT be tall.
 *
 * Height on this side buys nothing and costs the player. What the tall rim is
 * for is hiding the void where the ground plate ends — but the void beyond the
 * near rim lies behind the camera and is never in frame, so there is nothing
 * there to hide. Meanwhile the player can walk right up to it, and a 5.7-unit
 * rock 1.6 units toward the camera from him hides him completely. Measured in
 * the running game, which is the only reason this config exists.
 *
 * Still taller and wider than a boulder, so the map still visibly ENDS: it reads
 * as the far lip of a bowl seen from outside rather than as more scatter. At
 * this height a player standing hard against it loses his boots and nothing else.
 */
const RAMPART_NEAR: ScatterConfig = {
  spacing: 1,
  minWidth: 1.9,
  maxWidth: 2.6,
  minAspect: 0.55,
  maxAspect: 0.72,
  maxTilt: 0.12,
  sink: 0.08,
};

/** Same shadow-caster exclusion as the rest — and doubly so here, since a 3-unit
 *  rock under this sun throws a shadow longer than a room is wide. */
const RAMPART_MESH_PREFIX = "wallrun-rampart-";
export { RAMPART_MESH_PREFIX };

/**
 * THE COAST'S WALL IS AN OVERGROWN LEDGE. Read all four references before
 * touching these — they took three passes to read correctly.
 *
 * `strand-map-layout2.png` (the revealed overview) is the one that settles the
 * shape: the Strand's whole boundary is a NARROW ribbon, two or three player
 * widths across, meandering in long sweeps with sharp corners, and it is a solid
 * mat of khaki-olive scrub with barely any bare ground showing through.
 * `strand-map1.jpg.png` is the same thing at gameplay zoom and says what is
 * under the scrub: a smooth ROUNDED rock mass, dark and pebbled, with ferns and
 * broad leaf spilling over its lip. Not a cliff face, not a boulder chain, and
 * nothing with a facet on it.
 *
 * So the ledge is the same machinery as everything else here at a shape no
 * boulder config would take — wide, low, smooth-shaded, packed close enough to
 * fuse into one continuous mass — and the scrub over it is what the eye actually
 * reads from a camera nine metres up.
 *
 * Spacing is well under the width on purpose. A boulder scatter wants gaps
 * between stones; a ledge wants none, and the overlap is what turns eight
 * discrete lumps into one run.
 */
const DUNE: ScatterConfig = {
  /** Barely a fifth of the narrowest mound, where a boulder's spacing is a third
   *  of its own width. Measured on screen, not chosen: at 0.95 the mounds stood
   *  clear of each other and the boundary read as a row of eggs on the sand. The
   *  berm is a CONTINUOUS swell, so the overlap has to be most of the shape. */
  spacing: 0.5,
  /** Smaller than a boulder, not bigger. Three-unit mounds each read as one
   *  object the size of a hut; at half that they lose their individual identity
   *  and the eye takes the run instead. */
  minWidth: 1.8,
  maxWidth: 2.8,
  /** 0.47-1.0 tall: knee to waist. High enough to read as a barrier you follow
   *  rather than a rise you would step over, low enough that it can never hide
   *  the character the way the rejected cliff did. */
  minAspect: 0.26,
  maxAspect: 0.36,
  /** Sand does not tip. A visibly leaning dune reads as a boulder again. */
  maxTilt: 0.05,
  /** Well sunk: a dune GROWS out of the beach, and the buried quarter is what
   *  removes the last of the "object placed on the ground" read. */
  sink: 0.24,
};

/**
 * The coast's outer rim, where the ground plate stops and the void begins.
 *
 * Same job as RAMPART and the same near/far split for the same reason, but a
 * beach cannot close its edge with a rock ring — the reference's boundary rises
 * as dune and scrub, so this is simply a bigger dune. Tall enough on the far
 * side to hide where the sand ends, and the near side stays under his head.
 */
const DUNE_RIM: ScatterConfig = {
  ...DUNE,
  spacing: 0.9,
  minWidth: 3.4,
  maxWidth: 5.0,
  /** 1.9-2.8 units on the far side: the same two-to-three-times-the-player
   *  proportion the rock rampart uses, since it is hiding the same void. */
  minAspect: 0.55,
  maxAspect: 0.55,
  sink: 0.12,
};

const DUNE_RIM_NEAR: ScatterConfig = {
  ...DUNE_RIM,
  minAspect: 0.2,
  maxAspect: 0.26,
};

/**
 * The weed on the dune's crest, and the single detail that makes the boundary
 * read as a beach rather than as sand-coloured rock.
 *
 * `strand-map-layout.jpg`'s whole coastline is a khaki-olive fuzz sitting on a
 * pale ribbon: the ribbon is the shape and the fuzz is what names it. So the
 * clumps are scattered over the SAME cells as the dune, tightly enough to form a
 * band rather than dotting it.
 *
 * Knee-high and no taller. A clump is a silhouette breaker, not a screen, and
 * anything that hides a monster standing behind the boundary is a bug.
 */
const WEED: ScatterConfig = {
  /** Half the narrowest clump, so the clumps OVERLAP. In
   *  `strand-map-layout2.png` the boundary is a solid mat with no ground showing
   *  between the rosettes; a scatter that merely dots the ledge reads as a bald
   *  ridge with some grass on it, which is what the first pass looked like. */
  spacing: 0.36,
  minWidth: 1.0,
  maxWidth: 1.8,
  /** 0.55-1.35 tall. Knee to hip, never higher: a clump that hides a monster
   *  standing behind the boundary is a bug, not dressing. */
  minAspect: 0.55,
  maxAspect: 0.75,
  /** Free to lean hard. Scrub is the one thing here that SHOULD look blown. */
  maxTilt: 0.28,
  /** Rooted a little under, so the blades come out of the ground rather than
   *  standing on it — a clump resting on the surface reads as a potted bush. */
  sink: 0.16,
};

/** The mat ON the ledge, which is most of what the top-down camera sees of the
 *  boundary at all. Lifted onto the rock: at y=0 several hundred clumps were
 *  drawn inside a metre of opaque stone, and the ridge came back bald. */
const WEED_CREST: ScatterConfig = { ...WEED, lift: 0.62 };

/** The fringe at the ledge's foot, spilling onto the open sand. Both gameplay
 *  references have it — `beach-map-walls.png`'s undergrowth runs out over the
 *  beach and `strand-map1.jpg.png`'s leaf hangs off the lip — and it is what
 *  stops the boundary having a hard line where it meets the floor. */
const WEED_FOOT: ScatterConfig = { ...WEED, spacing: 0.7, inset: 0.85 };

/**
 * The LEDGE: the coast's landward edge, and the one part of a boundary that is
 * allowed to be a wall.
 *
 * "Those are not high walls, those are just a stack of stones side by side" —
 * and that was right. A one-cell line of knee-high mounds is a kerb however
 * nicely it is textured. `strand-map1.jpg.png` has the boundary standing well
 * over the player's head as a single rounded rock MASS, and
 * `strand-map-layout2.png` has it two or three player-widths deep.
 *
 * Height is free here for exactly the reason it is free on the rampart, and for
 * no other: this run is one-sided. It is the map's edge, nothing the player
 * needs is ever behind it, so a face turned AWAY from the camera may tower while
 * the face turned toward it stays under his head. That is why `scatterLedge`
 * takes the same near/far split `scatterRampart` does, and why the blobs
 * standing in the open sand may NOT use it — a blob has floor on every side, so
 * "away from the camera" is also somebody's near side, and a 3-unit tower on one
 * is the bug the rejected cliff pass shipped.
 */
const LEDGE_FAR: ScatterConfig = {
  /** Tight. The mass has to FUSE — every unit of visible gap between two lumps
   *  is another stone in the stack he called out. */
  spacing: 0.5,
  /** Narrow and tall, not wide and tall. At 3.0-4.4 wide the run came off the
   *  screen as a range of hills that ate two thirds of the frame; the reference
   *  wall is about a player and a half across and stands twice that. */
  minWidth: 2.0,
  maxWidth: 2.8,
  /** 1.7-2.7 units: over the player's head, the reference's own proportion. */
  minAspect: 0.85,
  maxAspect: 0.97,
  maxTilt: 0.06,
  sink: 0.14,
};

/** The same mass where it stands between the camera and the player. 0.9-1.7,
 *  so a player walking hard against it loses his boots and nothing else. */
const LEDGE_NEAR: ScatterConfig = { ...LEDGE_FAR, minAspect: 0.42, maxAspect: 0.55 };

/** The row the player can walk up to. 0.85-1.4: under WALL_HEIGHT's 1.8 by the
 *  same margin the boulders keep, so his head clears it wherever he stands. */
const LEDGE_FRONT: ScatterConfig = { ...LEDGE_FAR, minAspect: 0.4, maxAspect: 0.5, sink: 0.2 };

/** The low mounds standing IN the sand — see DUNE. Never tall: floor on every
 *  side means no direction is safely "away". */
export function scatterDune(cells: readonly RockCell[], cellSize = 0.5): RockPlacement[] {
  return scatter(cells, { ...DUNE, outwardHalfCell: cellSize / 2 });
}

/**
 * The coast's landward wall: a low front and a tall back — see LEDGE_FAR.
 *
 * `front` is the row standing ON the boundary cells, and it may NEVER be tall,
 * whichever way it faces. The near/far test says which way a face turns, not
 * where the player is, and a run classed "far" can still be the thing he is
 * walking along — the wall came back at 2.7 units on his own cell and swallowed
 * him whole. So height goes strictly BEHIND the line he can reach: the rows
 * `level.ts` pushes outward take the tall config on the side the camera looks
 * at, and stay low on the side it looks over.
 */
export function scatterLedge(
  cells: readonly RockCell[],
  front: readonly RockCell[],
): RockPlacement[] {
  const far = cells.filter((c) => facing(c) < 0);
  const near = cells.filter((c) => facing(c) >= 0);
  return [
    ...scatter(far, LEDGE_FAR),
    ...scatter(near, LEDGE_NEAR),
    ...scatter(front, LEDGE_FRONT),
  ];
}

/** The coast's own version of the rampart — see DUNE_RIM. */
export function scatterDuneRim(cells: readonly RockCell[]): RockPlacement[] {
  const far = cells.filter((c) => facing(c) < 0);
  const near = cells.filter((c) => facing(c) >= 0);
  return [...scatter(far, DUNE_RIM), ...scatter(near, DUNE_RIM_NEAR)];
}

/**
 * Scrub over a low mound: a mat on its crest and a fringe at its foot — see
 * WEED_CREST and WEED_FOOT.
 *
 * One call rather than two so the two passes cannot drift apart, and so the
 * caller never has to know that "the vegetation" is two placements deep.
 */
export function scatterWeed(cells: readonly RockCell[]): RockPlacement[] {
  return [...scatter(cells, WEED_CREST), ...scatter(cells, WEED_FOOT)];
}

/**
 * Scrub at the foot of the LEDGE, and only at its foot.
 *
 * The mass is two to three metres of rock and a crest mat would be placed inside
 * it. Both gameplay references put the green here anyway: `beach-map-walls.png`
 * runs its undergrowth out of the wall onto the open sand, and
 * `strand-map1.jpg.png` hangs its leaf off the lip. What this is really for is
 * that the wall must not meet the beach along a hard line.
 */
export function scatterLedgeWeed(cells: readonly RockCell[]): RockPlacement[] {
  return scatter(cells, { ...WEED_FOOT, spacing: 0.5, inset: 1.35 });
}

/**
 * The scanned plant set: fern and four bushes, thrown along the boundary among
 * the blade clumps.
 *
 * Sparser than the weed on purpose. The weed is the MAT — the khaki fuzz that
 * `strand-map-layout2.png` runs the whole coastline in — and this is what breaks
 * it up, the way `beach-map-walls.png` has fern and broad leaf standing out of
 * its undergrowth rather than instead of it. One every couple of metres is what
 * reads as a coastline; one every half metre is a garden centre.
 *
 * Aspect near 1 because these keep their authored proportions: the meshes are
 * normalised by FOOTPRINT, not into a unit box (`_fit_unit_footprint` in
 * tools/build_rocks.py), so width and height must move together or a fern comes
 * out as a different plant.
 */
const FLORA: ScatterConfig = {
  spacing: 1.4,
  minWidth: 1.3,
  maxWidth: 2.4,
  minAspect: 0.9,
  maxAspect: 1.1,
  maxTilt: 0.12,
  sink: 0.08,
  inset: 1.1,
};

export function scatterFlora(cells: readonly RockCell[]): RockPlacement[] {
  return scatter(cells, FLORA);
}

/** The low mounds in the sand. Cast, like the boulders they replace: a metre of
 *  rock under this sun throws the shadow that stops it looking pasted on. */
export const DUNE_MESH_PREFIX = "wallrun-dune-";
/** The landward wall. Never casts, for the rampart's reason: two to three units
 *  of continuous run under this sun is one unbroken band across the beach. */
export const LEDGE_MESH_PREFIX = "wallrun-ledge-";
/** The outer ridge. Never casts — same reason as `RAMPART_MESH_PREFIX`. */
export const DUNE_RIM_MESH_PREFIX = "wallrun-dunerim-";
/** The scrub. Never casts: a few hundred clumps each throwing a shadow map
 *  update is the one thing on this boundary that is not worth a frame. */
export const WEED_MESH_PREFIX = "wallrun-weed-";
/** The scanned plant set. Same exclusion, and alpha-cut geometry in a shadow map
 *  is a whole extra depth pass for a fern. */
export const FLORA_MESH_PREFIX = "wallrun-flora-";

/**
 * NO CAVE WALLS INLAND. This was tried and measured, and the reference is what
 * settled it.
 *
 * The attempt: make the wall runs the camera looks AT much taller, since nothing
 * the player needs is behind them, and leave the runs he looks OVER short. It
 * cannot work here. `WALL_THICK_CELLS` is 1, so a wall is ONE cell thick and the
 * same cell is the far wall of one room and the near wall of the next — it
 * cannot be tall and short at once. Measured in the running game: a 5.6-unit
 * cliff stood 1.02 units toward the camera from the player and hid him
 * completely.
 *
 * The reference says not to want it anyway. In `map boundary(right side).webp`
 * and `inside-map-battle.webp` the tall rock is the map's BOUNDARY, sloping away
 * at the frame edge with nothing behind it, and `map-layout-1.jpeg`'s walkable
 * overlay shows the interior as one broad open polygon holding only LOW rubble
 * and THIN trunks. PoE gets the cave read from layout and from value — its rock
 * is near-black — never from tall walls standing in the play space.
 *
 * So height lives in `RAMPART` (the outer rim, where nothing can stand behind
 * it) and darkness lives in level.ts's wall albedo. Inland stone stays under the
 * player's head.
 */

/**
 * Which way the camera lies, in xz, normalised.
 *
 * `CAMERA_ALPHA` is -PI/4 and NOTHING rotates it — the wheel moves the zoom and
 * the pitch, never the yaw — so which side of a thing the camera is on is a
 * constant of the build rather than a per-frame question. An ArcRotateCamera at
 * alpha sits at (cos a, _, sin a) from its target, so at -PI/4 it stands off
 * toward +x and -z. Confirmed against the running camera, not just derived:
 * `position - target` normalises to exactly (0.7071, -0.7071) in xz.
 *
 * Re-derive if CAMERA_ALPHA moves, or the rim goes tall on the wrong side.
 */
const CAM_X = Math.SQRT1_2;
const CAM_Z = -Math.SQRT1_2;

/**
 * How much a cell's outward face turns toward the camera: +1 dead on, -1 away.
 *
 * This is the test that failed for inner walls and works for the rim, and the
 * difference is worth stating because it looks like the same idea. An inner wall
 * has FLOOR on both sides, so "outward" is one room's away-side and the next
 * room's toward-side and the cell cannot honour both. The rim has floor on one
 * side and the void on the other. It is genuinely one-sided, so there is exactly
 * one right answer per cell.
 */
const facing = (cell: RockCell): number => (cell.nx ?? 0) * CAM_X + (cell.nz ?? 0) * CAM_Z;

interface LoadedRocks {
  scene: Scene;
  container: AssetContainer;
}

let loaded: LoadedRocks | null = null;
let pending: Promise<void> | null = null;
/**
 * Which load is the current one. A fetch that was started for a scene that has
 * since gone away must not be allowed to land: React's StrictMode mounts the
 * effect, tears it down and mounts it again, so in dev there are routinely two
 * loads in flight and the FIRST one resolves last about half the time. When it
 * did, it wrote its dead scene into `loaded`, `isRocksReady` went false against
 * the live scene, and the map silently fell back to the box walls — which is
 * exactly the "the rocks were there yesterday" bug.
 */
let generation = 0;
const placed = new Map<string, Mesh[]>();

export function loadRocks(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();

  // No "return the in-flight promise" shortcut: that promise may belong to a
  // scene that is already gone, and handing it back would report the NEW scene
  // ready when nothing was ever loaded into it.
  const gen = ++generation;
  pending = LoadAssetContainerAsync(ROCKS_URL, scene)
    .then((container) => {
      if (gen !== generation) {
        container.dispose();
        return;
      }
      loaded = { scene, container };
    })
    .catch(() => {
      if (gen === generation) loaded = null;
    })
    .finally(() => {
      if (gen === generation) pending = null;
    });

  return pending;
}

export function isRocksReady(scene: Scene): boolean {
  return loaded !== null && loaded.scene === scene;
}

/** Drop the cached container — the scene that owns it is going away. */
export function resetRocks(): void {
  loaded = null;
  pending = null;
  // Retire any load still in flight for the scene being torn down, or it lands
  // after the next scene has already started its own and wins the race.
  generation++;
  placed.clear();
}

export interface RockCell {
  x: number;
  z: number;
  /**
   * Unit vector pointing away from the floor this cell borders, or absent/zero
   * where there is no such direction. Only read when the config sets
   * `outwardHalfCell` — see there.
   */
  nx?: number;
  nz?: number;
}

export interface RockPlacement {
  x: number;
  /** Below the floor by `sink` of the height; see ScatterConfig. */
  y: number;
  z: number;
  /** Footprint in world units; the rock mesh is authored inside a unit box. */
  width: number;
  height: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  variant: number;
}

/**
 * Deterministic unit float from an integer. The scatter has to come out the same
 * on every client and every reload — the walls are part of the map, not weather —
 * and it is keyed off the cell's own index so re-entering an area rebuilds the
 * identical boundary. (finalizer of murmur3, which is cheap and mixes well.)
 */
function hash01(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Thin a run of wall cells down to rock positions.
 *
 * The band is one cell deep and a cell is half a unit, so one rock per cell would
 * be six hundred boulders in a wall's thickness — the thinning is what turns a
 * dense line of cells into a scatter with a believable stone size. Greedy
 * dart-throwing against a spatial hash rather than a stride along each run,
 * because a vertical wall is a stack of one-cell runs and a stride cannot see it.
 *
 * O(n) in the cell count: the bucket is exactly `spacing` wide, so a rejection
 * test only ever looks at the nine buckets around the candidate.
 */
export function scatterRocks(
  cells: readonly RockCell[],
  cellSize = 0.5,
): RockPlacement[] {
  return scatter(cells, { ...BOULDERS, outwardHalfCell: cellSize / 2 });
}

/** Sparse stone across the open floor — see DEBRIS for why it exists. */
export function scatterDebris(cells: readonly RockCell[]): RockPlacement[] {
  return scatter(cells, DEBRIS);
}

/**
 * The ring that closes the map's edge — see RAMPART.
 *
 * Tall where the camera looks AT it and low where it stands between the camera
 * and the player. Cells arrive with an outward normal pointing away from the map
 * centre (level.ts), so a cell with no normal falls to `facing` 0 and takes the
 * LOW config: the safe answer, since a rim rock that is too short shows a little
 * void and one that is too tall hides the character.
 */
export function scatterRampart(cells: readonly RockCell[]): RockPlacement[] {
  const far = cells.filter((c) => facing(c) < 0);
  const near = cells.filter((c) => facing(c) >= 0);
  return [...scatter(far, RAMPART), ...scatter(near, RAMPART_NEAR)];
}

function scatter(cells: readonly RockCell[], cfg: ScatterConfig): RockPlacement[] {
  const spacing = cfg.spacing;
  const out: RockPlacement[] = [];
  const buckets = new Map<string, RockPlacement[]>();
  const key = (cx: number, cz: number): string => `${cx},${cz}`;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const r0 = hash01(i * 4 + 1);
    const r1 = hash01(i * 4 + 2);
    const r2 = hash01(i * 4 + 3);
    const r3 = hash01(i * 4 + 4);
    // Jitter widens the worst-case gap one for one, so it is bounded by what the
    // narrowest rock can bridge (see ROCK_SPACING), not by how much scatter looks
    // good. 0.19 units of play on a 0.5-unit cell grid already hides the lattice.
    let x = cell.x + (r0 - 0.5) * spacing * JITTER;
    let z = cell.z + (r1 - 0.5) * spacing * JITTER;

    const width = cfg.minWidth + r2 * (cfg.maxWidth - cfg.minWidth);
    const height = width * (cfg.minAspect + r3 * (cfg.maxAspect - cfg.minAspect));

    // Applied before the rejection test, so spacing is enforced where the rocks
    // actually end up rather than where their cells were.
    if (cfg.outwardHalfCell !== undefined) {
      const out = Math.max(0, width / 2 - cfg.outwardHalfCell);
      x += (cell.nx ?? 0) * out;
      z += (cell.nz ?? 0) * out;
    }
    if (cfg.inset !== undefined) {
      x -= (cell.nx ?? 0) * cfg.inset;
      z -= (cell.nz ?? 0) * cfg.inset;
    }

    const cx = Math.floor(x / spacing);
    const cz = Math.floor(z / spacing);
    let blocked = false;
    for (let dx = -1; dx <= 1 && !blocked; dx++) {
      for (let dz = -1; dz <= 1 && !blocked; dz++) {
        for (const other of buckets.get(key(cx + dx, cz + dz)) ?? []) {
          const ddx = other.x - x;
          const ddz = other.z - z;
          if (ddx * ddx + ddz * ddz < spacing * spacing) blocked = true;
        }
      }
    }
    if (blocked) continue;

    const rock: RockPlacement = {
      x,
      y: (cfg.lift ?? 0) - height * cfg.sink,
      z,
      width,
      height,
      yaw: hash01(i * 4 + 5) * Math.PI * 2,
      tiltX: (hash01(i * 4 + 6) - 0.5) * 2 * cfg.maxTilt,
      tiltZ: (hash01(i * 4 + 7) - 0.5) * 2 * cfg.maxTilt,
      variant: Math.floor(hash01(i * 4 + 8) * 64),
    };
    out.push(rock);
    const bk = key(cx, cz);
    const list = buckets.get(bk);
    if (list) list.push(rock);
    else buckets.set(bk, [rock]);
  }
  return out;
}

/**
 * The source meshes one prefix draws from.
 *
 * `rocks.glb` carries three families — `rock_*` boulders, `dune_*` swells and
 * `weed_*` blade clumps — because the scatter, the thin-instancing and the
 * per-area disposal are identical for all three and a second glb would be a
 * second load path for no gain. Which family a build takes is read off the
 * prefix it was asked for, so a caller can never pair a coast's dune scatter
 * with a boulder mesh.
 *
 * A glb that predates the dunes has no `dune_*` at all, and a name filter that
 * matched nothing would silently draw no boundary. Falling back to everything
 * that is not one of the other families keeps that case rendering — and the
 * geometry test's single `rock-a` source, which is neither.
 */
/**
 * Put a scanned plant into the same exposure as everything else in the frame.
 *
 * A glTF material arrives at baseColorFactor 1, and the coast runs its sun at
 * `light` 2.4 — six times the dungeon rig — so every leaf came off the screen
 * white. The rock next to it is trimmed for exactly the same reason
 * (SEA_ROCK_ALBEDO in level.ts); this is that trim for the flora, applied here
 * because here is the only place a material the runtime did not build is
 * touched. Idempotent: `buildRocks` runs on every area change and the material
 * is shared, so it must not compound.
 */
const FLORA_ALBEDO = 0.34;

function dressFlora(mat: PBRMaterial): void {
  if (!mat || mat.metadata?.["floraDressed"] === true) return;
  mat.metadata = { ...(mat.metadata ?? {}), floraDressed: true };
  mat.albedoColor = new Color3(FLORA_ALBEDO, FLORA_ALBEDO, FLORA_ALBEDO);
  // The 6% self-lighting the plant was authored with is 6% of a texture that is
  // now being read three times darker; left alone it becomes the brightest part
  // of the leaf.
  mat.emissiveColor = mat.emissiveColor.scale(FLORA_ALBEDO);
}

function sourceMeshes(container: AssetContainer, prefix: string): AbstractMesh[] {
  const all = container.meshes
    .filter((m) => m.name !== GLTF_ROOT && m.getTotalVertices() > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const family = prefix.startsWith(FLORA_MESH_PREFIX)
    ? "flora_"
    : prefix.startsWith(WEED_MESH_PREFIX)
      ? "weed_"
      : prefix.startsWith(LEDGE_MESH_PREFIX)
        ? "ledge_"
        : prefix.startsWith(DUNE_MESH_PREFIX) || prefix.startsWith(DUNE_RIM_MESH_PREFIX)
          ? "dune_"
          : null;
  if (family === null) return all.filter((m) => !/^(dune|ledge|weed|flora)_/.test(m.name));
  const picked = all.filter((m) => m.name.startsWith(family));
  return picked.length > 0 ? picked : all;
}

/** Drop the previous area's rocks. Safe to call when there were none. */
export function clearRocks(): void {
  for (const meshes of placed.values()) for (const mesh of meshes) mesh.dispose();
  placed.clear();
}

/**
 * Put `placements` on the ground as thin instances, one draw call per variant.
 *
 * Thin instances and not clones: a map's boundary is several hundred rocks, and
 * as real meshes that is several hundred draw calls for scenery nobody looks at
 * directly. They inherit the source's material, so every rock in an area is the
 * same stone as the band it hides.
 *
 * Returns null when the glb has not loaded, which is the caller's signal to keep
 * the full-height box band instead.
 */
export function buildRocks(
  scene: Scene,
  placements: readonly RockPlacement[],
  material: Material | null,
  prefix: string = ROCK_MESH_PREFIX,
): Mesh[] | null {
  for (const mesh of placed.get(prefix) ?? []) mesh.dispose();
  placed.delete(prefix);
  if (!loaded || loaded.scene !== scene) return null;
  const sources = sourceMeshes(loaded.container, prefix);
  if (sources.length === 0) return null;

  const matrices: number[][] = sources.map(() => []);
  const scale = new Vector3();
  const translation = new Vector3();
  const rotation = new Quaternion();
  const matrix = Matrix.Identity();
  for (const p of placements) {
    scale.set(p.width, p.height, p.width);
    translation.set(p.x, p.y, p.z);
    Quaternion.RotationYawPitchRollToRef(p.yaw, p.tiltX, p.tiltZ, rotation);
    Matrix.ComposeToRef(scale, rotation, translation, matrix);
    const bucket = matrices[p.variant % sources.length]!;
    for (const v of matrix.m) bucket.push(v);
  }

  const meshes: Mesh[] = [];
  for (let i = 0; i < sources.length; i++) {
    const data = matrices[i]!;
    if (data.length === 0) continue;
    const mesh = (sources[i] as Mesh).clone(`${prefix}${i}`, null);
    if (!mesh) continue;
    // Out of the glTF root and back to identity: the vertices are already in the
    // pose the exporter baked, and staying parented would hand the whole band the
    // root's handedness flip a second time.
    // A clone SHARES its source's Geometry, and thinInstanceSetBuffer writes the
    // instanced attributes onto the geometry while the matrices it reports back
    // stay on the mesh. Boulders and debris clone the same six sources, so the
    // debris build silently overwrote what every boulder drew: the boundary
    // rendered as pebbles on open floor while every probe -- instance count,
    // bounding box, matrix buffer -- still read as correct boulders.
    mesh.makeGeometryUnique();
    mesh.setParent(null);
    mesh.position.setAll(0);
    mesh.rotationQuaternion = null;
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    // `null` keeps whatever the glb authored, which is the whole point for the
    // plant set: a boulder wears its biome's plate, a fern wears a photograph of
    // a fern and each species has its own.
    if (material !== null) mesh.material = material;
    else if (mesh.material) {
      // MASK, not BLEND. Blender 5.2's exporter writes alphaMode BLEND whatever
      // `blend_method` says, and a few hundred sorted transparent instances a
      // frame is real cost for leaves that only ever needed a cutout.
      mesh.material.transparencyMode = 1; // Material.MATERIAL_ALPHATEST
      mesh.material.backFaceCulling = false;
      dressFlora(mesh.material as PBRMaterial);
    }
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(data), 16, true);
    mesh.thinInstanceRefreshBoundingInfo(true);
    // The host sits at identity and the instances never move; the bounding info
    // was just refreshed from the final buffer, so neither needs a per-frame sync.
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    meshes.push(mesh);
  }
  placed.set(prefix, meshes);
  return meshes.length > 0 ? meshes : null;
}
