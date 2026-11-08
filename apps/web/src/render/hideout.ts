import { Color3, Mesh, StandardMaterial, TransformNode, VertexData, type Scene } from "@babylonjs/core";
import {
  HIDEOUT_DECOR, HIDEOUT_FLOOR, type Decor, type DecorExtraKind, type DecorKind, type PiecePlacement,
} from "@exiled/content-runtime";
import { attachProp, type PropKind } from "./props";
import { standGroundBlob } from "./meshes";
import { setFireSpots, type FireSpot } from "./lights";
import { buildAtlasModel } from "./atlas-model";

/**
 * Standing the hideout's furniture up.
 *
 * WHERE it stands is content (`@exiled/content-runtime/hideout.ts`), because the
 * sim collides against the same list — the player walks around the table, not
 * through it — laid over with the pieces the player moved in Edit Hideout. This
 * file is only the meshes, the shadows and the contact blobs.
 */

/** Every decor kind, and every extra but the atlas, has to be a prop `props.glb` actually carries. */
type DecorIsProp = DecorKind extends PropKind ? true : never;
type ExtraIsProp = Exclude<DecorExtraKind, "atlasModel"> extends PropKind ? true : never;
export const KINDS_ARE_PROPS: DecorIsProp & ExtraIsProp = true;

/** Prefix every decor root takes, so a rebuild can find and drop the last set. */
const DECOR_PREFIX = "hideout-decor-";

/** The root a piece is drawn under; Edit Hideout moves this node. */
export function decorRootName(id: string): string {
  return `${DECOR_PREFIX}${id}`;
}

/** Wares and candles on a stall are furniture, not loot: this share of the drop glow, on their own material copies. */
const EXTRA_GLOW = 0.4;

/** Contact-blob half-extents per furniture kind, before `scale`; a rug lies flat and has none. */
const DECOR_BLOBS: Partial<Record<PropKind, [number, number]>> = {
  table: [1.25, 0.7], bench: [0.7, 0.35], crate: [0.5, 0.5],
  barrel: [0.42, 0.42], pillar: [0.55, 0.55], brazier: [0.5, 0.5],
  bookshelf: [0.55, 0.35], cauldron: [0.45, 0.45], grainSack: [0.55, 0.4], pot: [0.35, 0.35],
};

/** The dark band around the walkable floor. Named apart from the decor, which a
 *  scene without props does not get; the edge needs no asset. */
export const HIDEOUT_EDGE_NAME = "hideout-edge";

/** Screen units past HIDEOUT_FLOOR over which the floor fades to black, and how
 *  far the black runs on (past the camera's ~10 unit half-width either way). */
const EDGE_FADE = 2.5;
const EDGE_RINGS = [0, 0.5, 1, 1.5, 2, EDGE_FADE, 40];

/** Where a piece stands and faces: moved, or content's spot. Yaw in radians. */
export function decorPlacement(d: Decor, moved?: Readonly<Record<string, PiecePlacement>>): { x: number; z: number; yaw: number } {
  const m = moved?.[d.id];
  return m ? { x: m.x, z: m.z, yaw: (m.rot * Math.PI) / 180 } : { x: d.x, z: d.z, yaw: d.yaw };
}

/**
 * One FireSpot per brazier, kept for the life of the decor set. Edit Hideout moves
 * a bowl by moving its spot, so the light already pointed at it follows and
 * re-arms its shadow instead of being handed to another bowl.
 */
const fires = new Map<string, FireSpot>();

function syncFires(moved?: Readonly<Record<string, PiecePlacement>>): void {
  const braziers = HIDEOUT_DECOR.filter((d) => d.kind === "brazier");
  braziers.forEach((d, i) => {
    const at = decorPlacement(d, moved);
    const spot = fires.get(d.id);
    if (spot) { spot.x = at.x; spot.z = at.z; } else fires.set(d.id, { x: at.x, z: at.z, phase: i * 2.3 });
  });
}

/** Where the hideout's fires stand, for the light pool. */
export function hideoutFires(): readonly FireSpot[] {
  return [...fires.values()];
}

/** Drop the last set. Safe on a scene that never had one. */
export function clearHideoutDecor(scene: Scene): void {
  for (const node of [...scene.transformNodes, ...scene.meshes]) {
    if (node.name.startsWith(DECOR_PREFIX) && !node.isDisposed()) node.dispose(false, false);
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
export function buildHideoutDecor(scene: Scene, moved?: Readonly<Record<string, PiecePlacement>>): void {
  clearHideoutDecor(scene);
  buildHideoutEdge(scene);
  fires.clear();
  syncFires(moved);
  setFireSpots(hideoutFires());
  for (const d of HIDEOUT_DECOR) {
    const at = decorPlacement(d, moved);
    const root = new Mesh(decorRootName(d.id), scene);
    root.position.set(at.x, 0, at.z);
    root.rotation.y = at.yaw;
    root.isPickable = false;
    root.metadata = { hideoutPiece: d.id };
    // A stretched piece draws its body under a scaled child, so what stands on it
    // (wares, candles, the atlas) keeps its own proportions.
    let body: TransformNode = root;
    if (d.scale) {
      body = new TransformNode(`${DECOR_PREFIX}${d.id}-body`, scene);
      body.parent = root;
      body.scaling.set(d.scale.x, 1, d.scale.z);
    }
    // Shared: furniture has no hover state, and the room stands a dozen of these
    // inside two point lights' cube maps.
    if (attachProp(scene, body, d.kind, true) === null) {
      root.dispose(false, false);
      return;
    }
    for (const [i, x] of (d.extras ?? []).entries()) {
      const node = new TransformNode(`${DECOR_PREFIX}${d.id}-extra-${i}`, scene);
      node.parent = root;
      node.position.set(x.dx, d.top ?? 0, x.dz);
      node.rotation.y = x.yaw ?? 0;
      if (x.s !== undefined) node.scaling.setAll(x.s);
      if (x.kind === "atlasModel") buildAtlasModel(scene, node);
      else {
        for (const m of Object.values(attachProp(scene, node, x.kind) ?? {}))
          (m as { emissiveColor?: Color3 }).emissiveColor?.scaleInPlace(EXTRA_GLOW);
      }
    }
    const blob = DECOR_BLOBS[d.kind];
    if (blob) standGroundBlob(scene, root, blob[0] * (d.scale?.x ?? 1), blob[1] * (d.scale?.z ?? 1));
    // These DO cast, and should: engine.ts registers every new mesh that is not
    // level geometry. At this sun a shadow runs about 2.6 times the caster's
    // height, and the tallest thing here lays down under three.
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
    }
  }
}

/** Stand one piece at (x, z) facing `yaw`, live: Edit Hideout's cursor and the snapshot both call this. */
export function moveDecorRoot(scene: Scene, id: string, x: number, z: number, yaw: number): void {
  const root = scene.getMeshByName(decorRootName(id));
  if (!root) return;
  root.position.x = x;
  root.position.z = z;
  root.rotation.y = yaw;
  const spot = fires.get(id);
  if (spot) { spot.x = x; spot.z = z; }
}

/** Lay the player's arrangement over the standing set, every piece at once. */
export function applyHideoutLayout(scene: Scene, moved: Readonly<Record<string, PiecePlacement>>): void {
  for (const d of HIDEOUT_DECOR) {
    const at = decorPlacement(d, moved);
    moveDecorRoot(scene, d.id, at.x, at.z, at.yaw);
  }
}
