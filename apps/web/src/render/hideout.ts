import { Color3, Mesh, StandardMaterial, VertexData, type Scene } from "@babylonjs/core";
import { HIDEOUT_DECOR, HIDEOUT_FLOOR, type DecorKind } from "@exiled/content-runtime";
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

/** The dark band around the walkable floor. Named apart from the decor, which a
 *  scene without props does not get; the edge needs no asset. */
export const HIDEOUT_EDGE_NAME = "hideout-edge";

/** Screen units past HIDEOUT_FLOOR over which the floor fades to black, and how
 *  far the black runs on (past the camera's ~10 unit half-width either way). */
const EDGE_FADE = 2.5;
const EDGE_RINGS = [0, 0.5, 1, 1.5, 2, EDGE_FADE, 40];

/** Drop the last set. Safe on a scene that never had one. */
export function clearHideoutDecor(scene: Scene): void {
  for (const node of [...scene.transformNodes, ...scene.meshes]) {
    if (node.name.startsWith(DECOR_PREFIX)) node.dispose(false, false);
  }
  scene.getMeshByName(HIDEOUT_EDGE_NAME)?.dispose();
}

/**
 * Close the floor the way a map closes its edge: the ground plane runs on into
 * the dark, so without this a walk away lost the room while the sim had already
 * stopped the player at HIDEOUT_FLOOR. A frame of rings in screen units (the
 * rect is screen-aligned, so 45 degrees off the world grid), clear at the bound
 * and black by EDGE_FADE past it; nothing inside the bound is touched.
 */
function buildHideoutEdge(scene: Scene): void {
  const F = HIDEOUT_FLOOR;
  const r = Math.SQRT1_2;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const o of EDGE_RINGS) {
    const t = Math.min(1, o / EDGE_FADE);
    const a = t * t * (3 - 2 * t);
    for (const [sx, sy] of [[F.left - o, F.bottom - o], [F.right + o, F.bottom - o], [F.right + o, F.top + o], [F.left - o, F.top + o]] as const) {
      // Screen (sx, sy) back to world: x = (sx - sy) / sqrt2, z = (sx + sy) / sqrt2.
      positions.push((sx - sy) * r, 0.012, (sx + sy) * r);
      colors.push(0, 0, 0, a);
    }
  }
  for (let k = 0; k + 1 < EDGE_RINGS.length; k++)
    for (let c = 0; c < 4; c++) {
      const a0 = k * 4 + c, a1 = k * 4 + ((c + 1) % 4);
      indices.push(a0, a1, a1 + 4, a0, a1 + 4, a0 + 4);
    }
  const mesh = new Mesh(HIDEOUT_EDGE_NAME, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.colors = colors;
  data.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  let mat = scene.getMaterialByName(`${HIDEOUT_EDGE_NAME}-mat`) as StandardMaterial | null;
  if (!mat) {
    mat = new StandardMaterial(`${HIDEOUT_EDGE_NAME}-mat`, scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.emissiveColor = Color3.Black();
    // Winding is not worth reasoning about for a flat frame seen from one side.
    mat.backFaceCulling = false;
  }
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.freezeWorldMatrix();
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
  buildHideoutEdge(scene);
  setFireSpots(HIDEOUT_FIRES);
  for (let i = 0; i < HIDEOUT_DECOR.length; i++) {
    const d = HIDEOUT_DECOR[i]!;
    const root = new Mesh(`${DECOR_PREFIX}${i}`, scene);
    root.position.set(d.x, 0, d.z);
    root.rotation.y = d.yaw;
    root.isPickable = false;
    // Shared: furniture has no hover state, and the room stands a dozen of these
    // inside two point lights' cube maps.
    if (attachProp(scene, root, d.kind, true) === null) {
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
