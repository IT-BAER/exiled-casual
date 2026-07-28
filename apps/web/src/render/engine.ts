import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  GlowLayer,
  HemisphericLight,
  ImageProcessingConfiguration,
  MeshBuilder,
  PBRMaterial,
  SSAO2RenderingPipeline,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  type Engine,
} from "@babylonjs/core";
import { ROCK_MESH_PREFIX } from "./rocks";

/**
 * Light intensities for a PBR scene. Roughly PI times the values the old
 * StandardMaterial rig used, because PBR's diffuse term is energy-conserving
 * (it divides by PI) while Standard's is not — port the old numbers straight
 * across and the whole map lands about three times too dark.
 *
 * The RATIO is the shadow contrast, and it is the whole reason shadows read as
 * absent at 3.0/1.55. `ShadowGenerator.darkness` only attenuates the SUN's
 * occluded term; a hemispheric light is ambient and relights every shadowed
 * pixel at full strength, shadow map or not. The sun rakes in at y=-0.38, so a
 * flat lit floor takes fill + sun*0.38 = 2.69 and a shadowed one takes
 * fill + sun*0.38*darkness = 1.69 — a shadow that removes 37% of the light and
 * duly reads as "pretty hard to see".
 *
 * 0.45/6.0 holds that lit floor at ~2.7 and drops the shadowed one to ~0.72, so
 * a shadow is a quarter of its surroundings instead of two thirds. That is the
 * floor in `inside-map-battle.webp`, where the long hard shadows carry most of
 * the depth. Verified in the running app, not computed: at fill 0 the boulders
 * threw big correct shadows the whole time, which is what proved the casters
 * were never the problem and the ambient was.
 */
const SUN_INTENSITY = 6.0;
const FILL_INTENSITY = 0.45;

/** Name of the single merged wall mesh `buildLevel` produces.
 *
 *  Lives in engine.ts rather than level.ts because the shadow filter below has
 *  to know it and level.ts already imports from here — the other direction is a
 *  cycle. */
export const WALL_MESH_NAME = "level-walls";

/** Dirt and flagstone are rough; anything under ~0.7 puts a wet sheen on them. */
const GROUND_ROUGHNESS = 0.92;

/**
 * Half-height of the orthographic view in world units (smaller = more zoomed in).
 * This is both where the wheel starts and as far out as it goes: the widest shot
 * is the authored one, and the wheel only ever brings the player closer.
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
 * The wheel does not answer this — it only zooms in, so the widest view the
 * player can reach during the slam is still this one. Revisit against the boss,
 * not against the hideout, if it reads badly.
 */
const ORTHO_HALF_HEIGHT = 4.75;

/**
 * The near stop, and the step one wheel notch takes.
 *
 * Multiplicative, because a fixed number of units per notch is coarse at the
 * near end and imperceptible at the far one — the eye reads zoom as a ratio.
 * 1.12 puts ~3.5 notches between the default and the stop, which is about PoE's
 * travel: its zoom is a nudge, not a strategy camera.
 *
 * There is no far stop of its own. Zooming out past the authored framing would
 * mean shipping a second widest shot that nothing was composed for — the ortho
 * height is calibrated against a screenshot, the shadow frustum is sized from
 * it, and the boss telegraph is already large in the frame at this distance.
 */
const ZOOM_STEP = 1.12;
const MIN_HALF_HEIGHT = 3.2;
const MAX_HALF_HEIGHT = ORTHO_HALF_HEIGHT;

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
 * Anchored on the default half-height, which is also the far stop, so the
 * framing at rest is exactly the one that shipped and the pitch only ever
 * shallows from there as a consequence of the player's own scrolling.
 *
 * The direction is a trap worth stating: shallower shows *more* ground
 * front-to-back at a fixed box height (the floor is stretched by 1/cos(beta)),
 * which is the "now I can see further up the map" that this must not do. The
 * box shrinking is what pays for it, and the two cancel at a computable place:
 * the visible depth stops falling once `|BETA_PER_UNIT| >= 1 / (half·tan(beta))`,
 * which at the wide end is about 0.24. That is the real ceiling on this number
 * and it is roughly 3x the value set here — the first pass ran at 0.03, an
 * eighth of it, and the arc was too timid to see. A full zoom in now tilts
 * ~7 degrees and still cuts the visible depth ~24%.
 *
 * `render.test.ts` pins the *ratio* rather than either number, so this can be
 * pushed further by eye without anyone having to remember the algebra above —
 * the test fails the moment the tilt starts outrunning the box.
 */
const BETA_AT_DEFAULT = 0.72;
const BETA_PER_UNIT = -0.08;
const BETA_LIMIT = { min: BETA_AT_DEFAULT, max: 0.88 };

/** Seconds-ish smoothing on the zoom, so a notch glides instead of snapping. */
const ZOOM_EASE = 0.18;

/** Flagstone texture repeats across the 200u floor (25 → ~8u per tile). */
/** Ground-plane texture repeats. Exported because level.ts re-plates the same
 *  mesh per biome and must not change the scale of the stone underfoot. */
export const FLOOR_TILES = 25;

/** Side of the ground plane, in world units. `buildLevel` shrinks it to the
 *  area's own rect so the world ENDS at the outer wall, as PoE's does: past the
 *  last wall there is nothing to light, so the frame falls to black instead of
 *  running out into lit ground the player can never reach. */
export const GROUND_SIZE = 200;

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
  // Reaching the scene from the devtools console is the only way to inspect what
  // the renderer actually built; Babylon is bundled, so there is no other handle.
  if (import.meta.env.DEV) (globalThis as { __scene?: Scene }).__scene = scene;
  // Dark background so the greybox arena reads against the page (default is white,
  // which made a white ground plane invisible on a white page).
  scene.clearColor = new Color4(0.09, 0.1, 0.12, 1);

  // Top-down-ish camera: positioned above the origin, looking down at the
  // ground plane (xz). Alpha=0, beta=π/4 gives a comfortable isometric feel.
  // alpha=-π/4 yaws the view 45° off the grid, the diagonal PoE reads at: world
  // +x goes down-right and world +z (sim +y) up-right, so a room's walls run as
  // two receding diagonals instead of a flat box. WASD is rotated to match in
  // `intents.ts`, and the minimap by the same angle in `Minimap.tsx`.
  // beta ~0.72 (≈49° elevation) is the isometric tilt.
  const camera = new ArcRotateCamera(
    "cam",
    -Math.PI / 4,
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
  fill.intensity = FILL_INTENSITY;
  // ...and a low key light raking across the arena. The long shadows it throws
  // are what sell the ground plane, so it is deliberately closer to the horizon
  // than to overhead. Declared before the zoom below, which resizes its frustum.
  const sun = new DirectionalLight("sun", new Vector3(-0.62, -0.38, -0.45), scene);
  sun.intensity = SUN_INTENSITY;

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
    // tracks the zoom. Since the wheel only zooms in this never has to grow —
    // it just stops spending 2048 texels on floor that is no longer on screen,
    // and the shadows sharpen as the character gets closer.
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
    { width: GROUND_SIZE, height: GROUND_SIZE },
    scene,
  );
  const groundMat = new PBRMaterial("groundMat", scene);
  // PBR and not StandardMaterial: a diffuse-only material lights dirt and stone
  // identically, and that flat uniform response is most of why the frame reads
  // as a toy. Roughness gives the sun a real grazing sheen off the floor and
  // lets the normal map actually shape it.
  groundMat.metallic = 0;
  groundMat.roughness = GROUND_ROUGHNESS;
  try {
    // Real flagstone floor, tiled across the plane. Texture load is async and
    // non-fatal under NullEngine (no canvas), so tests keep the unloaded texture.
    const floor = new Texture("/textures/floor.png", scene);
    floor.uScale = FLOOR_TILES;
    floor.vScale = FLOOR_TILES;
    groundMat.albedoTexture = floor;
    groundMat.albedoColor = new Color3(1, 1, 1);
  } catch {
    groundMat.albedoColor = new Color3(0.2, 0.22, 0.27); // headless fallback
  }
  ground.material = groundMat;
  ground.receiveShadows = true;

  // The dungeon walls are no longer a fixed arena ring — they come from the
  // generated area's walkable grid, built by buildLevel() when the worker sends
  // the "area" message. The ground plane above stays as the floor + pick target.

  try {
    // Filmic tone map, not a straight clamp. PBR outputs real radiance and the
    // sun's lit faces run well past 1.0; clipped, they flatten into flat white
    // patches on exactly the rock facets the shading pass exists to show. ACES
    // rolls those off instead, and the contrast lift puts back the punch the
    // roll-off costs.
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.15;
    ip.contrast = 1.2;
  } catch {
    /* no image processing under NullEngine */
  }

  try {
    // Ambient occlusion. Contact is the cue the frame was missing most: without
    // it a rock and the floor it sits on meet at a hard seam with no darkening,
    // which is why the boulders read as stickers laid on the ground rather than
    // as stone resting on it. The sun's shadow map cannot do this — it is one
    // direction, and a rock's own underside never faces it.
    const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.75, blurRatio: 1 }, [
      camera,
    ]);
    ssao.radius = 0.9; // world units: about half a rock, so it reads at the base
    ssao.totalStrength = 1.1;
    ssao.expensiveBlur = true;
    ssao.samples = 16;
  } catch {
    /* SSAO2 needs WebGL2 + a depth renderer; skipped headless and on WebGL1 */
  }

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
    //
    // Neither may level walls ("wallrun-*", and the merged mesh Babylon names
    // "<first source>_merged"). Two reasons, both found by running an assembled
    // map rather than the old disc:
    //  - A 3.5-unit wall under this low sun throws a ~9-unit shadow, longer than
    //    a room is wide, so at darkness 0.12 every room went to unplayable black.
    //    The disc had almost no walls, which is why it never showed before.
    //  - buildLevel makes one box per wall run and merges them, disposing the
    //    sources; the render list kept every disposed box, 817 of them after one
    //    map, and grew again on each area change.
    // The boulders are the exception, cast back in: what made a room unplayable
    // was a 3.5-unit run throwing ONE CONTINUOUS 9-unit band, and the boulders
    // that replaced those runs are capped at 1.52 and stand apart, so they throw
    // separated ~4-unit smears with lit floor between them. That is exactly the
    // floor in `inside-map-battle.webp`, where the long hard shadows carry most
    // of the depth. The rampart stays out — 3.2 units in an unbroken ring is the
    // continuous band again, and it rings the map where nothing needs to read.
    // This sees a mesh's name ONCE, when it is added, so a mesh renamed later is
    // already registered under whatever it was called first. That is how the
    // merged wall mesh has been casting all along: it used to be renamed to
    // WALL_MESH_NAME after the merge, so this filter only ever saw Babylon's
    // default. `buildLevel` now merges INTO a mesh already called that, which is
    // the only reason matching on it here works.
    const isLevelGeometry = (name: string): boolean =>
      (name.startsWith("wallrun-") && !name.startsWith(ROCK_MESH_PREFIX)) ||
      name === WALL_MESH_NAME;
    scene.onNewMeshAddedObservable.add((mesh) => {
      if (mesh.name.startsWith("telegraph-") || mesh === ground || isLevelGeometry(mesh.name)) {
        return;
      }
      shadows.addShadowCaster(mesh);
    });
    // And the floor itself, belt and braces: it is registered by the time the
    // first frame runs even though it is created above this block, so the filter
    // alone does not clear it. A flat plane with nothing under it can only ever
    // cast onto ITSELF, and at this sun angle that self-shadow landed as a faint
    // diagonal stripe across every lit surface in the frame — shadow acne at the
    // shadow map's texel pitch, which no bias tuning fixes as cheaply as simply
    // not casting. It still receives.
    shadows.removeShadowCaster(ground);

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
