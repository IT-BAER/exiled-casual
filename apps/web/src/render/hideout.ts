import { Mesh, type Scene } from "@babylonjs/core";
import { attachProp, type PropKind } from "./props";
import { standGroundBlob } from "./meshes";
import { setFireSpots, type FireSpot } from "./lights";
import { CAMERA_ALPHA } from "./engine";

/**
 * The furniture the hideout is lived in with.
 *
 * Client-side and nothing else: none of it is interactable, the hideout carries no
 * collision, and the sim has never heard of any of it. That is the whole reason it
 * can be a list of numbers here rather than entities in `areas.ts` — a rug is not
 * a game object, it is the reason the floor is not empty.
 *
 * Every piece is capped near a metre. The wall pass paid for that lesson already:
 * the camera sits about 49 degrees above the horizon, so a prop of height h hides
 * roughly 0.87h of world behind it, and a hideout you cannot see yourself in is
 * worse than a bare one. The tallest thing here is a broken column at 1.12.
 */

/** Kinds `props.glb` carries beyond the two interactables. */
export type DecorKind = Extract<PropKind, "rug" | "table" | "bench" | "crate" | "barrel" | "pillar" | "brazier">;

/** Prefix every decor root takes, so a rebuild can find and drop the last set. */
const DECOR_PREFIX = "hideout-decor-";

export interface Decor {
  kind: DecorKind;
  /** World x and z. Sim (x, y) is Babylon (x, z), same as every actor. */
  x: number;
  z: number;
  /** Radians about Y. See SCREEN_SQUARE for what to measure it against. */
  yaw: number;
}

/**
 * A prop turned this far reads square to the SCREEN rather than to the world grid.
 *
 * The camera looks along the diagonal (CAMERA_ALPHA), so a table built along +X
 * runs off toward the corner of the frame. Furniture composed for a fixed camera
 * wants its long edge across that camera's view, which is this angle and not zero.
 */
const SCREEN_SQUARE = -CAMERA_ALPHA;

/**
 * A placement written where the composition actually happens: on the screen.
 *
 * The camera's 45-degree lean means world coordinates say nothing about where a
 * prop lands in the frame — (-8.6, 6.2) reads as "the far corner" and is in fact
 * ten units off the top edge, which is exactly the mistake the first pass made
 * with all four columns. So these are screen units: `sx` runs right along the
 * frame, `sy` runs up it, the origin is the player's arrival point, and the visible
 * box is about 19 by 9.5. `areas.ts` turns its own literals by the same angle for
 * the same reason.
 */
function at(sx: number, sy: number): { x: number; z: number } {
  const r = Math.SQRT1_2;
  return { x: (sx - sy) * r, z: (sx + sy) * r };
}

/**
 * Where everything stands.
 *
 * Composed against what is already there, none of which moves: on screen the map
 * device sits top-centre with its portal arc across the top, the stash is
 * left-of-centre, the disenchanter mirrors it on the right, and the player arrives
 * dead centre. What is left is the whole bottom half and the two flanks, and the
 * lane from the player to the device stays clear because that is the walk every
 * session starts with.
 *
 * The corners are kept inside the frame and clear of the HUD: the bottom two are
 * behind the life and mana globes, so the columns take the top corners and the
 * mid-flanks instead.
 */
export const HIDEOUT_DECOR: readonly Decor[] = [
  // A table with a bench either side, down on the left where nothing else is.
  { kind: "table", ...at(-6.0, -1.2), yaw: SCREEN_SQUARE },
  { kind: "bench", ...at(-6.0, -2.1), yaw: SCREEN_SQUARE },
  { kind: "bench", ...at(-6.0, -0.3), yaw: SCREEN_SQUARE },
  // Under the player on arrival, so the first thing the floor does is stop being
  // flagstone. Just below him, not under his feet: a rug he is standing on is a rug
  // nobody sees.
  { kind: "rug", ...at(0, -2.1), yaw: SCREEN_SQUARE },
  // Stores on the stash side. Spread in plan and never stacked in height: two
  // crates on top of each other is the one shape here that would occlude.
  { kind: "crate", ...at(-7.1, 0.6), yaw: SCREEN_SQUARE + 0.5 },
  { kind: "crate", ...at(-7.9, -0.4), yaw: SCREEN_SQUARE - 0.3 },
  { kind: "barrel", ...at(-7.6, 1.6), yaw: 0 },
  { kind: "barrel", ...at(-8.6, 0.9), yaw: 0 },
  // And a few past the disenchanter, so the right flank is not bare stone.
  { kind: "barrel", ...at(6.4, -1.1), yaw: 0 },
  { kind: "crate", ...at(7.2, -2.0), yaw: SCREEN_SQUARE + 0.9 },
  { kind: "crate", ...at(5.9, -2.7), yaw: SCREEN_SQUARE - 0.6 },
  // Broken columns at the edges of the frame. They are the only thing here that
  // says the hideout is a ruin somebody moved into.
  { kind: "pillar", ...at(-8.8, 3.4), yaw: 0.4 },
  { kind: "pillar", ...at(8.8, 3.4), yaw: -0.9 },
  { kind: "pillar", ...at(-9.0, -1.5), yaw: 2.6 },
  { kind: "pillar", ...at(9.0, -1.5), yaw: 1.7 },
  // Fire. Two bowls out at the flanks and one down at the foot of the frame, so
  // the room is lit from its own corners instead of only from the lamp the
  // player carries — see render/lights.ts for what actually lights them. The
  // left one stands out by the broken column at (-8.8, 3.4) rather than in the
  // middle of the flank: from there its pool reaches the dead stone in the
  // corner, which nothing else was lighting.
  { kind: "brazier", ...at(-7.4, 3.4), yaw: 0 },
  { kind: "brazier", ...at(7.4, 3.2), yaw: 0 },
  { kind: "brazier", ...at(0, -4.0), yaw: 0 },
];

/** Where the hideout's fires stand, for the light pool. */
export const HIDEOUT_FIRES: readonly FireSpot[] = HIDEOUT_DECOR
  .filter((d) => d.kind === "brazier")
  .map((d, i) => ({ x: d.x, z: d.z, phase: i * 2.3 }));

/** Contact-blob half-extents per furniture kind; the rug lies flat and has none. */
const DECOR_BLOBS: Partial<Record<PropKind, [number, number]>> = {
  table: [1.25, 0.7], bench: [0.7, 0.35], crate: [0.5, 0.5],
  barrel: [0.42, 0.42], pillar: [0.55, 0.55], brazier: [0.5, 0.5],
};

/** Drop the last set. Safe on a scene that never had one. */
export function clearHideoutDecor(scene: Scene): void {
  for (const node of [...scene.transformNodes, ...scene.meshes]) {
    if (node.name.startsWith(DECOR_PREFIX)) node.dispose(false, false);
  }
}

/**
 * Stand the furniture up. Idempotent: the previous set goes first, so an area
 * message arriving twice does not double it.
 *
 * A scene whose props have not loaded gets nothing at all rather than a set of
 * greybox boxes. Every other prop in this game falls back to primitives because it
 * has to stay CLICKABLE without its art; a rug does not have to be anything.
 */
export function buildHideoutDecor(scene: Scene): void {
  clearHideoutDecor(scene);
  setFireSpots(HIDEOUT_FIRES);
  for (let i = 0; i < HIDEOUT_DECOR.length; i++) {
    const d = HIDEOUT_DECOR[i]!;
    const root = new Mesh(`${DECOR_PREFIX}${i}`, scene);
    root.position.set(d.x, 0, d.z);
    root.rotation.y = d.yaw;
    root.isPickable = false;
    if (attachProp(scene, root, d.kind) === null) {
      root.dispose(false, false);
      return;
    }
    const blob = DECOR_BLOBS[d.kind];
    if (blob) standGroundBlob(scene, root, blob[0], blob[1]);
    // These DO cast, and should: engine.ts registers every new mesh that is not
    // level geometry, and the stash already grounds itself the same way. The wall
    // lesson was about SIZE, not about props — at this sun a shadow runs about 2.6
    // times the caster's height, so the 3.5-unit box wall smeared a nine-unit band
    // across a room while the tallest thing here lays down under three.
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
    }
  }
}
