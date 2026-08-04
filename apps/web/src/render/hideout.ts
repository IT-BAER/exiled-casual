import { Mesh, type Scene } from "@babylonjs/core";
import { HIDEOUT_DECOR, type DecorKind } from "@exiled/content-runtime";
import { attachProp, type PropKind } from "./props";
import { standGroundBlob } from "./meshes";
import { setFireSpots, type FireSpot } from "./lights";

/**
 * Standing the hideout's furniture up.
 *
 * WHERE it stands is content (`@exiled/content-runtime/hideout.ts`), because the
 * sim collides against the same list — the player walks around the table, not
 * through it. This file is only the meshes, the shadows and the contact blobs.
 */

/** Every decor kind has to be a prop `props.glb` actually carries. */
type DecorIsProp = DecorKind extends PropKind ? true : never;

/** Prefix every decor root takes, so a rebuild can find and drop the last set. */
const DECOR_PREFIX = "hideout-decor-";

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
