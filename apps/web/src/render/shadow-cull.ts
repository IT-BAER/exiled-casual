import { Frustum, Matrix, type AbstractMesh, type Plane, type ShadowGenerator } from "@babylonjs/core";

/**
 * Per-face culling for shadow maps, which Babylon does not do for you.
 *
 * A shadow map's render list is prepared ONCE and then submitted to every face:
 * `ObjectRenderer.render` guards the preparation behind `_defaultRenderListPrepared`
 * and `_prepareRenderingManager` never touches the frustum planes. For a point
 * light that is six passes over the same list, so a caster standing behind the
 * lamp is drawn into all six faces to write depth into none of them. For the sun
 * it is one pass over every caster in the level while its ortho box only brackets
 * the 32 units the camera can see.
 *
 * Measured in `the_wrackline` before this existed: shadows high cost 20.2 ms of
 * CPU scene time against 8.6 ms with them off, and 733 of the frame's 1054 draw
 * calls were the torch and fire cubes. Emptying those render lists while leaving
 * the lights sampling their maps recovered the whole gap, which is what proved
 * the cost is submission and not filtering or resolution — resolution (512 vs
 * 2048) and refresh rate had already been measured and moved neither.
 *
 * Nothing here can change a pixel: a caster outside a face's frustum cannot write
 * depth into that face, so dropping it is the same image for less work.
 */

/**
 * The casters in `list` that the frustum of `transform` can actually see.
 *
 * Writes into `out` and returns it: this runs six times per cube per frame, so a
 * fresh array per face would be the allocation this whole file exists to avoid.
 */
export function cullCasters(
  transform: Matrix,
  list: readonly AbstractMesh[],
  count: number,
  out: AbstractMesh[],
): AbstractMesh[] {
  const planes = (PLANES ??= Frustum.GetPlanes(Matrix.Identity()));
  Frustum.GetPlanesToRef(transform, planes);
  out.length = 0;
  for (let i = 0; i < count; i++) {
    const mesh = list[i];
    // A mesh with no bounding info yet (never rendered, never positioned) is kept
    // rather than guessed at: this may only ever remove work, never a shadow.
    if (mesh && (!mesh.subMeshes || mesh.isInFrustum(planes))) out.push(mesh);
  }
  return out;
}

/**
 * Scratch, because `GetPlanesToRef` still wants six Plane objects to fill.
 *
 * Built on first use and not at import: GameView's test partially mocks
 * `@babylonjs/core`, and a module-level `Frustum.GetPlanes` makes importing this
 * file at all depend on the mock carrying that export. Same argument as
 * `fireColour` in lights.ts.
 */
let PLANES: Plane[] | null = null;

/**
 * Hang the cull on a generator's shadow map. Call once, after creating it.
 *
 * `getCustomRenderList` is handed the pass index, which for a cube map IS the
 * face index (`RenderTargetTexture._renderToTarget`), and the generator has
 * already pointed the scene at that face by then — its own `onBeforeRenderObservable`
 * runs first and calls `getTransformMatrix`, which caches per face index. So
 * asking the generator for its transform here always gets the face about to be
 * drawn.
 */
export function cullShadowCasters(gen: ShadowGenerator): void {
  const map = gen.getShadowMap();
  if (!map) return;
  const out: AbstractMesh[] = [];
  // A null list means "render the scene's active meshes", which is Babylon's own
  // default and not ours to second-guess.
  map.getCustomRenderList = (_face, list, count) =>
    list && cullCasters(gen.getTransformMatrix(), list, count, out);
}
