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
 * Where the wheel starts, and where it stays until the wheel is touched.
 *
 * Calibrated against `poe2-screenshots/article-1280x720`, where the player fills
 * ~12% of the frame height. Measure at 16:9, never ultrawide: an ortho camera
 * keeps the vertical span fixed, so a wider window only adds world sideways and
 * makes the character read smaller than this number suggests.
 *
 * The old tension here — the Warden's slam telegraph is 7 units across against
 * the 9.5 units this shows, so it covers ~74% of the field — is now the player's
 * to resolve. An earlier pass held this at 6 for exactly that reason and lost to
 * two requests for a larger character; the wheel gives the boss its room back
 * without costing the hideout its framing.
 */
const ORTHO_HALF_HEIGHT = 4.75;

/**
 * Zoom limits, and the step one wheel notch takes.
 *
 * Multiplicative, because a fixed number of units per notch is coarse at the
 * near end and imperceptible at the far one — the eye reads zoom as a ratio.
 * 1.12 puts ~3 notches between the default and either stop, which is about
 * PoE's travel: its zoom is a nudge, not a strategy camera.
 */
const ZOOM_STEP = 1.12;
const MIN_HALF_HEIGHT = 3.2;
const MAX_HALF_HEIGHT = 6.8;

/**
 * Camera pitch, as Babylon's beta: the angle down from straight overhead, so
 * larger is shallower. 0.72 (~49 degrees of elevation) is the isometric tilt the
 * whole look was built around.
 *
 * Zoom is not a straight dolly. Scaling the ortho box alone is a flat
 * magnification with no arc to it at all — nothing in an orthographic
 * projection changes shape with distance, because there is no distance. The arc
 * has to come from the only thing that still bends the view, which is the pitch,
 * and the reference says which way it bends: in `closeup-hideout-zoom.jpg` the
 * huntress reads as a near-upright portrait, while the NPCs in the wider
 * `hideout.jpg` are seen from further above. Close in is *shallower*.
 *
 * Anchored on the default half-height rather than on the range, so the framing
 * at rest is exactly the one that shipped and the pitch only ever moves as a
 * consequence of the player's own scrolling.
 *
 * The direction is a trap worth stating: shallower shows *more* ground
 * front-to-back at a fixed box height (the floor is stretched by 1/cos(beta)),
 * which is the "now I can see further up the map" that this must not do. It
 * does not, because the box shrinks about seven times faster than the stretch
 * grows — a full zoom in cuts the visible depth by ~30% even while tilting. The
 * ratio is the load-bearing part and `render.test.ts` pins it rather than the
 * two numbers, so retuning the pitch cannot quietly reintroduce it.
 */
const BETA_AT_DEFAULT = 0.72;
const BETA_PER_UNIT = -0.03;
const BETA_LIMIT = { min: 0.64, max: 0.8 };

/** Seconds-ish smoothing on the zoom, so a notch glides instead of snapping. */
const ZOOM_EASE = 0.18;

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
  /** Zoom by `notches` wheel clicks; negative is toward the character. */
  setZoom: (notches: number) => void;
  /** Drop the wheel listener. The canvas outlives the engine under StrictMode. */
  detachZoom: () => void;
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

  // Dim sky fill so shadowed sides stay readable instead of going black...
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;
  // ...and a low key light raking across the arena. The long shadows it throws
  // are what sell the ground plane, so it is deliberately closer to the horizon
  // than to overhead. Declared before the zoom below, which resizes its frustum.
  const sun = new DirectionalLight("sun", new Vector3(-0.62, -0.38, -0.45), scene);
  sun.intensity = 0.95;

  // Where the wheel has asked to be, and where the camera has eased to so far.
  let targetHalf = ORTHO_HALF_HEIGHT;
  let half = ORTHO_HALF_HEIGHT;

  const applyOrtho = () => {
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    camera.orthoTop = half;
    camera.orthoBottom = -half;
    camera.orthoLeft = -half * aspect;
    camera.orthoRight = half * aspect;
    camera.beta = Math.min(
      BETA_LIMIT.max,
      Math.max(BETA_LIMIT.min, BETA_AT_DEFAULT + BETA_PER_UNIT * (half - ORTHO_HALF_HEIGHT)),
    );
    // The shadow frustum is sized to the visible floor, not to the world, so it
    // has to grow with the zoom or the corners of a zoomed-out view fall outside
    // it and read as unlit. Scaled rather than pinned at the widest, which would
    // spend the same 2048 texels on 2x the floor at every zoom level.
    const extent = SHADOW_EXTENT * (half / ORTHO_HALF_HEIGHT);
    sun.orthoLeft = -extent;
    sun.orthoRight = extent;
    sun.orthoBottom = -extent;
    sun.orthoTop = extent;
  };
  applyOrtho();
  engine.onResizeObservable.add(applyOrtho);

  const setZoom = (notches: number): void => {
    targetHalf = Math.min(
      MAX_HALF_HEIGHT,
      Math.max(MIN_HALF_HEIGHT, targetHalf * ZOOM_STEP ** notches),
    );
    // Tests and the first notch want the effect without waiting for a frame;
    // the easing below only has to cover the distance that is left.
    half += (targetHalf - half) * ZOOM_EASE;
    applyOrtho();
  };

  const onWheel = (ev: WheelEvent) => {
    // The wheel still scrolls the inventory and stash: this is on the canvas,
    // and an event over a HUD panel never reaches it.
    ev.preventDefault();
    setZoom(Math.sign(ev.deltaY));
  };
  const canvas = engine.getRenderingCanvas();
  // passive:false or the browser ignores the preventDefault and scrolls the page.
  canvas?.addEventListener("wheel", onWheel, { passive: false });
  const detachZoom = () => canvas?.removeEventListener("wheel", onWheel);

  scene.onBeforeRenderObservable.add(() => {
    if (Math.abs(targetHalf - half) < 1e-4) return;
    half += (targetHalf - half) * ZOOM_EASE;
    applyOrtho();
  });

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

  return { scene, camera, setZoom, detachZoom };
}
