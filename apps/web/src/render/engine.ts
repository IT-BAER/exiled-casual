import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  type Engine,
} from "@babylonjs/core";

/**
 * Half-height of the orthographic view in world units (smaller = more zoomed in).
 *
 * Calibrated against `poe2-screenshots/article-1280x720`, where the player fills
 * ~12% of the frame height. Measure at 16:9, never ultrawide: an ortho camera
 * keeps the vertical span fixed, so a wider window only adds world sideways and
 * makes the character read smaller than this number suggests.
 *
 * KNOWN TENSION: the Warden's slam telegraph is 7 units across, and this value
 * shows only 9.5 units vertically, so the telegraph covers ~74% of the field
 * during that fight. An earlier pass held this at 6 for exactly that reason and
 * the user has since asked twice for a larger character, so framing parity won.
 * Revisit against the boss, not against the hideout, if the slam reads badly.
 */
const ORTHO_HALF_HEIGHT = 4.75;

/** Flagstone texture repeats across the 200u floor (25 → ~8u per tile). */
const FLOOR_TILES = 25;

/**
 * Half-size of the shadow frustum, in world units. Needs to cover the visible
 * area (ORTHO_HALF_HEIGHT by that times the aspect ratio) plus enough margin for
 * shadows thrown in from just off screen.
 */
const SHADOW_EXTENT = 16;

export interface SceneHandle {
  scene: Scene;
  camera: ArcRotateCamera;
}

export function createScene(engine: Engine): SceneHandle {
  const scene = new Scene(engine);
  // Dark background so the greybox arena reads against the page (default is white,
  // which made a white ground plane invisible on a white page).
  scene.clearColor = new Color4(0.09, 0.1, 0.12, 1);

  // Top-down-ish camera: positioned above the origin, looking down at the
  // ground plane (xz). Alpha=0, beta=π/4 gives a comfortable isometric feel.
  // alpha=-π/2 puts the camera on the -Z side looking toward +Z, so world +x =
  // screen-right and world +z (sim +y) = screen-up — WASD then matches the view.
  // beta ~0.72 (≈49° elevation) is the isometric tilt.
  const camera = new ArcRotateCamera(
    "cam",
    -Math.PI / 2,
    0.72,
    40,
    Vector3.Zero(),
    scene,
  );
  // Orthographic projection: no perspective vanishing point, so grid lines stay
  // parallel — a flat high-isometric ARPG look, not a wide receding "CCTV" plane.
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  const applyOrtho = () => {
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    camera.orthoTop = ORTHO_HALF_HEIGHT;
    camera.orthoBottom = -ORTHO_HALF_HEIGHT;
    camera.orthoLeft = -ORTHO_HALF_HEIGHT * aspect;
    camera.orthoRight = ORTHO_HALF_HEIGHT * aspect;
  };
  applyOrtho();
  engine.onResizeObservable.add(applyOrtho);

  // Dim sky fill so shadowed sides stay readable instead of going black...
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;
  // ...and a low key light raking across the arena. The long shadows it throws
  // are what sell the ground plane, so it is deliberately closer to the horizon
  // than to overhead.
  const sun = new DirectionalLight("sun", new Vector3(-0.62, -0.38, -0.45), scene);
  sun.intensity = 0.95;

  // Pickable greybox floor. bindings.ts resolves click-to-move and pointer aim
  // via scene.pick().hit; without a ground mesh, picks on empty space miss and
  // those inputs only fire when the cursor is over an entity mesh. 200 = 2×
  // WORLD_MAX (movement.ts fp(±100)) so every reachable position is pickable;
  // bump this if WORLD bounds grow.
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 200, height: 200 },
    scene,
  );
  const groundMat = new StandardMaterial("groundMat", scene);
  try {
    // Real flagstone floor, tiled across the plane. Texture load is async and
    // non-fatal under NullEngine (no canvas), so tests keep the unloaded texture.
    const floor = new Texture("/textures/floor.png", scene);
    floor.uScale = FLOOR_TILES;
    floor.vScale = FLOOR_TILES;
    groundMat.diffuseTexture = floor;
    // Lift the flagstones above 1.0: the actors are near-black, and they only
    // read as silhouettes if the floor is clearly brighter than they are.
    groundMat.diffuseColor = new Color3(1.45, 1.45, 1.45);
  } catch {
    groundMat.diffuseColor = new Color3(0.2, 0.22, 0.27); // headless fallback
  }
  groundMat.specularColor = new Color3(0, 0, 0); // matte, no hotspot
  ground.material = groundMat;
  ground.receiveShadows = true;

  // The dungeon walls are no longer a fixed arena ring — they come from the
  // generated area's walkable grid, built by buildLevel() when the worker sends
  // the "area" message. The ground plane above stays as the floor + pick target.

  try {
    // Glow bloom: emissive materials above a threshold bloom outward, which is how
    // the portal rim and fire-eyes read as actual light sources rather than flat paint.
    // ponytail: a single global GlowLayer; per-layer exclusion lists if non-emissive
    // meshes blooming becomes a problem.
    const gl = new GlowLayer("glow", scene);
    gl.intensity = 0.85;
  } catch {
    /* GlowLayer needs a render target; silently skipped under NullEngine in tests */
  }

  try {
    // Cast shadows, the single biggest cue that the actors stand ON the floor.
    //
    // A directional light has no position, only a frustum, and ours has to cover
    // just the sliver of a 200u floor that is on screen — fit it to the whole
    // floor and every actor's shadow blurs into a few texels. So the frustum is
    // pinned to a fixed on-screen-sized box (autoUpdateExtends off, or Babylon
    // shrink-wraps it to the casters and everything outside reads as shadowed)
    // and dragged along behind the follow camera every frame.
    sun.autoUpdateExtends = false;
    sun.orthoLeft = -SHADOW_EXTENT;
    sun.orthoRight = SHADOW_EXTENT;
    sun.orthoBottom = -SHADOW_EXTENT;
    sun.orthoTop = SHADOW_EXTENT;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 140;

    const shadows = new ShadowGenerator(2048, sun);
    shadows.usePercentageCloserFiltering = true; // soft, and lit outside the frustum
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.darkness = 0.12; // deep, but the flagstones still read through them
    // Every actor part the renderer spawns later becomes a caster on its own, so
    // the renderer never has to know a shadow generator exists. The ground is the
    // only mesh alive at this point, and it only receives.
    // Telegraph meshes (fill disc + rim torus, named "telegraph-*") must not cast
    // shadows — they are unlit VFX decals and a shadow from them would look wrong.
    scene.onNewMeshAddedObservable.add((mesh) => {
      if (!mesh.name.startsWith("telegraph-")) shadows.addShadowCaster(mesh);
    });

    // Walk the light along with the camera so the frustum always brackets what
    // the player can see. Backwards along the light direction, and high enough
    // that nothing on screen falls behind shadowMinZ.
    const back = sun.direction.negate().scaleInPlace(70);
    scene.onBeforeRenderObservable.add(() => {
      sun.position.copyFrom(camera.target).addInPlace(back);
    });
  } catch {
    /* no render targets under NullEngine — lit but unshadowed is fine in tests */
  }

  return { scene, camera };
}
