import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  GlowLayer,
  HemisphericLight,
  Light,
  PointLight,
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
import { DEFAULT_SETTINGS, type GraphicsSettings } from "../settings";
import { DUNE_MESH_PREFIX, ROCK_MESH_PREFIX } from "./rocks";
import { SEA_MESH_NAME } from "./sea";
import { createHaze, createMotes } from "./haze";
import { FLAME_MESH } from "./flames";
import { createFireLights, LIGHT_POOL, setFireLightZoom, updateFireLights } from "./lights";

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
export const SUN_INTENSITY = 6.0;
export const FILL_INTENSITY = 0.45;
// Maps drop the sky fill further than the hideout: a place you pass through
// should read as lit by what's actually placed in it (torches, braziers),
// not by ambient light that relights every shadowed pixel regardless of
// where the fires are. The hideout keeps FILL_INTENSITY — it is a lived-in,
// permanently-lit home base, not a dungeon.
export const MAP_FILL_INTENSITY = 0.18;

/**
 * The player's own light: PoE1's "light radius" made literal, a warm pool that
 * travels with the character and picks detail out of the ground around them.
 *
 * It only ever ADDS. The sun and fill above are untouched by it, deliberately —
 * a torch raises the contrast between inside and outside the pool, so trimming
 * ambient to "balance" it lands straight back on the black-rooms regression.
 *
 * Intensity is large because a PBR point light falls off with the square of the
 * distance: at 2.5 up and 5 out the floor is already 31 units² away, so a value
 * near 1 does nothing visible. Tuned by looking at the frame, not computed.
 */
// Lamp height and intensity move together: irradiance on the floor goes as
// 1/h², so raising the lamp only holds the pool if intensity goes as h². It was
// 2.5/260, which put the light 0.8 units off the skull and blew the character
// white — inverse square hammers whatever is nearest, and the hair read as a
// bulb. At 3.8 the head sits 2.1 away, so its share drops ~2.5x while the floor
// is unchanged. Do not raise it further: 5.5 flattens the floor and the pool
// stops being a pool.
//
// 175 (walked down from 300 -> 265 -> 210 on the owner's repeated "smaller
// lantern" calls) and not the 420 it was tuned to alone. The place
// lights itself now — the
// braziers in render/lights.ts stand in the room and throw their own pools — so
// the lamp on the belt no longer has to be the only reason anything is visible.
// It is a pool the player carries between other people's fires, which is what it
// reads as in PoE, and turning it down is what lets a brazier be seen at all.
const TORCH_INTENSITY = 175;
/** Every light that can stand in a room at once: the fill, the sun, the torch,
 *  and the whole brazier pool. Materials are capped to exactly this, see
 *  `createScene` — Babylon's own default of four drops the rest without a word. */
const SCENE_LIGHTS = 3 + LIGHT_POOL;
/** Where the pool stops. GLTF falloff windows the inverse square to this, so the
 *  edge is defined instead of trailing off across the whole map.
 *
 *  Small because the camera only shows 9.5 world units of height: near 11 the
 *  pool covered the entire frame, which is a global brightness change, not a
 *  light the player carries. At 7.8 (down from 9.3 on the owner's lantern call)
 *  it reaches about two thirds of the way out and there is cold stone outside
 *  it to read the warm edge against. */
const TORCH_RANGE = 6.5;
/** Above the floor, not at the feet: at 0 the pool is a hot spot under the
 *  character, and the falloff eats the whole radius within a step. Kept above
 *  head height for the reason in TORCH_INTENSITY. */
const TORCH_HEIGHT = 3.8;
/**
 * Firelight, not a flashlight — and how far either way the player may push it.
 *
 * The two ends are a pale flame and a deep ember, and the default sits nearer
 * the ember than the middle. It used to be a fixed (1, 0.72, 0.42), which is a
 * yellow: raising the blue with the red takes the sulphur out of it and leaves
 * something closer to a real fire, which is warmer while being less yellow.
 */
const TORCH_COOL = new Color3(1.0, 0.86, 0.74);
const TORCH_WARM = new Color3(1.0, 0.55, 0.30);

/** The colour a warmth of `w` (0..1) asks for. */
export function torchColor(w: number): Color3 {
  const t = Math.min(1, Math.max(0, w));
  return Color3.Lerp(TORCH_COOL, TORCH_WARM, t);
}
/** Flicker depth. Two detuned sines, because a single one reads as a pulse. */
const TORCH_FLICKER = 0.035;
/** A part of a dressed character, from `wardrobe.glb`'s `slot.look.part` naming.
 *
 *  Matched on the part name and NOT on having an `entity-` root: the hideout
 *  props are entities too, so a root test takes the map device and the stash out
 *  along with the characters.
 *
 *  Held gear is a wardrobe slot like any other and belongs here for the same
 *  reason the body does: the torch rides the player, so a shield in his own hand
 *  is a slab an arm's length from the lamp, and it threw a shadow across half the
 *  room that swung with the walk cycle. Listing the armour slots by hand is what
 *  left the two weapon slots out. */
export const isWardrobePart = (name: string): boolean =>
  /^(base|body|belt|boots|gloves|helmet|weapon1|weapon2)\./.test(name);

/** The colour past the last wall. Fog is tinted TO this, so distance dissolves
 *  into the void instead of meeting it at a hard cliff at the map edge. */
export const VOID_COLOR = new Color3(0.02, 0.022, 0.026);

/**
 * How far the edge darkening goes. Two presets and not one number because the
 * rooms have already gone to unplayable black once (see `applyBiomeTint`), and
 * the only honest way to pick is to look at both in the same room.
 *
 * `soft` ships. `heavy` is reachable from the devtools console in a dev build:
 * `__atmos("heavy")`.
 */
export type AtmospherePreset = "soft" | "heavy";

/**
 * Fog start and end, in units from the CAMERA, plus the vignette weight.
 *
 * Distances and not an EXP2 density, and that is the whole point. The visible
 * floor lies in a MEASURED band from the camera — 15.8 at the bottom of the
 * screen to 24.4 at the top — and exponential fog across a band that narrow is
 * nearly constant. Under the old 40-unit orthographic camera it was worse still:
 * 36.3..44.2, where density 0.012 left the near edge at 0.827 of its light and
 * the far edge at 0.755. A 7% gradient across the whole frame is not depth, it
 * is a flat 20% dimmer, which is exactly how it read.
 *
 * Linear fog lets the band be placed instead of derived. `start` sits just
 * behind the near edge so the floor at the player's feet is untouched, and `end`
 * is close enough that the top of the screen visibly drinks the void colour
 * (~44% of it at `soft`). Re-measure both if `CAMERA_FOV` moves: the radius is
 * derived from it, so the whole band travels with the lens.
 */
const ATMOSPHERE: Record<AtmospherePreset, { start: number; end: number; vignette: number }> = {
  soft: { start: 17, end: 34, vignette: 1.6 },
  heavy: { start: 16, end: 28, vignette: 3.2 },
};

/** Fog + vignette. Both are frame-edge effects: they push the eye to the middle
 *  of the screen, which is where the player and the torch pool already are. */
export function applyAtmosphere(scene: Scene, preset: AtmospherePreset): void {
  const { start, end, vignette } = ATMOSPHERE[preset];
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = start;
  scene.fogEnd = end;
  // Colour is NOT set here: `applyBiomeTint` owns it, and Babylon ships a
  // non-null default, so a "only if unset" guard here never fires and toggling
  // the preset would silently throw the biome's hue away.
  const ip = scene.imageProcessingConfiguration;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = vignette;
  // Multiply and not the default opaque blend: opaque paints a flat black ring
  // over the corners, multiply darkens what is already drawn there, so a lit
  // wall in the corner stays a lit wall and only loses some of its light.
  ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  ip.vignetteColor = new Color4(0, 0, 0, 0);
  ip.vignetteStretch = 0.4; // the frame is 16:9; a round vignette on it crops the sides
}

/**
 * Push the player's graphics settings onto a scene that is already running.
 *
 * Every row here is a property flip, never a rebuild, which is what makes the
 * Options panel's "applies live, no SAVE button" an honest promise rather than a
 * reload in disguise.
 *
 * Targets are looked up BY NAME rather than handed in, because `createScene`
 * builds each of them inside its own try/catch: under `NullEngine` and on WebGL1
 * there is legitimately no SSAO pipeline, no glow layer and no shadow generator,
 * and a missing piece must be a no-op rather than a crash. That is also what
 * makes this testable headless.
 *
 * `engine` is nullable so a caller that has settings before it has a renderer
 * can still apply the rest.
 */
export function applyGraphics(scene: Scene, engine: Engine | null, g: GraphicsSettings): void {
  applyAtmosphere(scene, g.atmosphere);

  // Shadows. `shadowEnabled` and NOT disposing the generator: disposing is a
  // one-way door, and the whole point of a live setting is that it comes back.
  const sun = scene.getLightByName("sun");
  if (sun) sun.shadowEnabled = g.shadows !== "off";
  // The torch and fires are POINT lights, so each shadow map is a six-face cube.
  // Low keeps only the directional sun; High restores every local shadow.
  const torch = scene.getLightByName("torch");
  if (torch) {
    torch.shadowEnabled = g.shadows === "high";
    torch.diffuse = torchColor(g.torchWarmth);
  }
  // Every local point-light shadow is a six-face cube map. Low keeps the one
  // directional sun map; only High pays for the torch and fire cubes. Looking
  // the fires up by prefix also covers a pool whose size changes later.
  for (const light of scene.lights) {
    if (light.name.startsWith("firelight-")) {
      light.shadowEnabled = g.shadows === "high";
    }
  }

  const pipelines = scene.postProcessRenderPipelineManager?.supportedPipelines;
  const ssao = pipelines?.find((p) => p.name === "ssao");
  if (ssao && scene.activeCamera) {
    // Detach unconditionally first, so this ends in exactly ONE attachment however
    // often it runs. Attaching an already-attached pipeline appends its post
    // processes to the camera a second time, which Babylon reports as "trying to
    // reuse a post process not defined as reusable" and then renders twice; and this
    // runs on every graphics change, on mount, and again on StrictMode's remount.
    scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("ssao", scene.activeCamera);
    if (g.ambientOcclusion) {
      scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("ssao", scene.activeCamera);
    }
  }

  const glow = scene.effectLayers?.find((l) => l.name === "glow");
  if (glow) glow.isEnabled = g.bloom;

  // Babylon's number is the INVERSE: 2 renders at half width and height.
  if (engine) engine.setHardwareScalingLevel(1 / g.resolutionScale);
}

/** Name of the single merged wall mesh `buildLevel` produces.
 *
 *  Lives in engine.ts rather than level.ts because the shadow filter below has
 *  to know it and level.ts already imports from here — the other direction is a
 *  cycle. */
export const WALL_MESH_NAME = "level-walls";

/** Dirt and flagstone are rough; anything under ~0.7 puts a wet sheen on them. */
const GROUND_ROUGHNESS = 0.92;

/**
 * Vertical field of view, radians. The one number that decides how much depth
 * the projection has, and it is a trade rather than a maximum: wider gives more
 * parallax and more of a look down the sides of things, but also leans the
 * verticals out from the screen centre and pulls the camera in close enough that
 * scenery starts crossing in front of the player.
 *
 * 0.50 rad (~28.6°) is a long lens. It puts the camera ~18 units back for the
 * authored framing instead of 40, which is where the parallax comes from, while
 * a wall at the frame edge still leans only a few degrees.
 */
const CAMERA_FOV = 0.5;

/**
 * Half-height of the orthographic view in world units (smaller = more zoomed in).
 * This is both where the wheel starts and as far out as it goes: the widest shot
 * is the authored one, and the wheel only ever brings the player closer.
 *
 * Calibrated against `reference-screenshots/article-1280x720`, where the player fills
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
 * 1.07 puts ~6 notches between the default and the stop, which is about PoE's
 * travel: its zoom is a nudge, not a strategy camera. It was 1.12, which crossed
 * the whole range in three clicks and read as a jump rather than a move.
 *
 * There is no far stop of its own. Zooming out past the authored framing would
 * mean shipping a second widest shot that nothing was composed for — the ortho
 * height is calibrated against a screenshot, the shadow frustum is sized from
 * it, and the boss telegraph is already large in the frame at this distance.
 */
const ZOOM_STEP = 1.07;
const MIN_HALF_HEIGHT = 3.2;
const MAX_HALF_HEIGHT = ORTHO_HALF_HEIGHT;

/**
 * Camera pitch, as Babylon's beta: the angle down from straight overhead, so
 * larger is shallower. 0.65 is ~53 degrees of elevation, landed by eye against
 * `inside-map.jpg` from both sides: 0.52 (the textbook isometric 60 degrees)
 * read as a plan view of a floor rather than a camera standing behind the
 * player, and 0.78 overshot into a side-on view. PoE sits between them.
 *
 * Perspective is what makes that affordable. Under the old orthographic
 * projection pitch was the *only* thing giving the frame a third dimension, so
 * the number was a compromise between depth and legibility; parallax does that
 * job now, and the pitch is free to go where the reference actually puts it.
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
 * which at the wide end is about 0.28. That is the real ceiling on this number
 * and it is roughly 3x the value set here — the first pass ran at 0.03, an
 * eighth of it, and the arc was too timid to see. A full zoom in now tilts
 * ~7 degrees and still cuts the visible depth ~24%.
 *
 * `render.test.ts` pins the *ratio* rather than either number, so this can be
 * pushed further by eye without anyone having to remember the algebra above —
 * the test fails the moment the tilt starts outrunning the box.
 */
export const BETA_AT_DEFAULT = 0.65;

/**
 * Camera yaw, as Babylon's alpha. Exported because the hideout props carry fixed
 * yaws that only mean anything relative to where the lens is: `renderer.ts` turns
 * them by whatever this differs from the -PI/2 (camera on -z) they were written
 * against.
 */
export const CAMERA_ALPHA = -Math.PI / 4;
const BETA_PER_UNIT = -0.08;
const BETA_LIMIT = { min: BETA_AT_DEFAULT, max: 0.88 };

/**
 * The fastest the view may travel, in half-height units per second.
 *
 * A SPEED LIMIT, not a brake: every notch of the wheel still counts and still
 * moves the target, and a flick of a trackpad simply takes longer to arrive
 * rather than being thrown away. Dropping notches was the first attempt and it
 * is the thing that feels like the wheel is sticking — the input disappears.
 * The whole range is 1.55 units, so at this rate a full sweep takes about a
 * second however fast it was asked for.
 */
const MAX_ZOOM_SPEED = 1.6;
/** The nudge a single notch is allowed before the limiter takes over: one frame's
 *  worth, so the first click of the wheel is felt immediately. */
const ZOOM_KICK = MAX_ZOOM_SPEED / 60;

/** Flagstone texture repeats across the 200u floor (25 → ~8u per tile). */
/** Ground-plane texture repeats. Exported because level.ts re-plates the same
 *  mesh per biome and must not change the scale of the stone underfoot. */
export const FLOOR_TILES = 25;

/** `d`, but no further than `limit` in either direction. */
function clampStep(d: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, d));
}

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

/**
 * How far back along its own direction the sun is parked, world units. A
 * directional light has no position of its own, but its shadow map does, and the
 * near/far planes below are written as this plus or minus a margin — so the
 * distance has to be a number both places share rather than a literal in one.
 */
const SUN_DISTANCE = 60;

/** Switches the sky fill between the hideout's level and the dimmer one maps
 *  use, so a place is lit by what's placed in it rather than flat ambient.
 *  Looked up by name rather than threaded through `SceneHandle`: the light is
 *  created once in `createScene` and this is called on every area change. */
export function setMapFill(scene: Scene, isMap: boolean): void {
  const fill = scene.getLightByName("fill");
  if (fill) fill.intensity = isMap ? MAP_FILL_INTENSITY : FILL_INTENSITY;
}

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
  if (import.meta.env.DEV) {
    const g = globalThis as { __scene?: Scene; __atmos?: (p: AtmospherePreset) => void };
    g.__scene = scene;
    // A/B the edge darkening in the room you are standing in: __atmos("heavy").
    g.__atmos = (p) => applyAtmosphere(scene, p);
  }
  // Every material must be able to see every light in the room.
  //
  // Babylon caps a material at FOUR lights and silently drops the rest: with the
  // fill, the sun, the torch and a pool of four fires standing in the scene, a
  // floor tile was lit by the fill, the sun, the torch and ONE brazier. Which one
  // is the first the sort lands on, and `updateFireLights` hands the pool out
  // NEAREST FIRST — so the fires past the closest lit nothing at all, and a
  // brazier's pool appeared on the floor only once the player walked up to it.
  // (`LIGHT_POOL` being four is unrelated: that is the cap on how many bowls may
  // be lit at once, not on how many lights a surface may take.)
  //
  // Swept on the scene rather than set at every material site: props, the
  // wardrobe and the monsters all arrive as glTF materials nothing here
  // constructs. A sweep and not `onNewMaterialAddedObservable`, which fires from
  // inside `Material`'s constructor — the subclass field initialiser assigns its
  // own 4 straight over whatever the handler just wrote. Guarded on the material
  // count, the way the torch's exclusion list is guarded on the mesh count.
  let lastMaterialCount = -1;
  scene.onBeforeRenderObservable.add(() => {
    if (scene.materials.length === lastMaterialCount) return;
    lastMaterialCount = scene.materials.length;
    for (const m of scene.materials) {
      if ("maxSimultaneousLights" in m) {
        (m as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = SCENE_LIGHTS;
      }
    }
  });
  // Dark background so the greybox arena reads against the page (default is white,
  // which made a white ground plane invisible on a white page).
  scene.clearColor = new Color4(VOID_COLOR.r, VOID_COLOR.g, VOID_COLOR.b, 1);
  scene.fogColor = VOID_COLOR.clone();
  scene.skipPointerMovePicking = true;
  applyAtmosphere(scene, "soft");

  // Top-down-ish camera: positioned above the origin, looking down at the
  // ground plane (xz). Alpha=0, beta=π/4 gives a comfortable isometric feel.
  // alpha=-π/4 yaws the view 45° off the grid, the diagonal PoE reads at: world
  // +x goes down-right and world +z (sim +y) up-right, so a room's walls run as
  // two receding diagonals instead of a flat box. WASD is rotated to match in
  // `intents.ts`, and the minimap by the same angle in `Minimap.tsx`.
  // `BETA_AT_DEFAULT` is the isometric tilt; it is also the steep end of the
  // zoom arc, so the camera starts exactly where the arc's clamp holds it.
  const camera = new ArcRotateCamera(
    "cam",
    CAMERA_ALPHA,
    BETA_AT_DEFAULT,
    40,
    Vector3.Zero(),
    scene,
  );
  // PERSPECTIVE, and this was orthographic until it was played rather than
  // screenshotted. Ortho keeps grid lines parallel, which flatters a still frame
  // and is why it was chosen — but it also has literally zero parallax: near
  // ground and far ground move at the same screen rate, every box shows the same
  // faces wherever it sits, and running around reads as sliding a 2D map. PoE 1
  // and 2 are both perspective. No amount of fog, haze or shadow work can put
  // depth back into a projection that has none, which is what three passes of
  // atmosphere tuning proved the expensive way.
  //
  // A LONG lens, not a wide one: `CAMERA_FOV` is narrow enough that verticals
  // stay near-parallel and the look is still high-isometric rather than the wide
  // receding "CCTV" plane the old comment rightly warned about.
  camera.mode = Camera.PERSPECTIVE_CAMERA;
  camera.fov = CAMERA_FOV;
  // Tight clip planes, since the whole scene lives in a shallow band: the depth
  // buffer is precious once SSAO and two shadow maps are reading it.
  camera.minZ = 2;
  camera.maxZ = 90;

  // Dim sky fill so shadowed sides stay readable instead of going black...
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = FILL_INTENSITY;
  // ...and a low key light raking across the arena. The long shadows it throws
  // are what sell the ground plane, so it is deliberately closer to the horizon
  // than to overhead. Declared before the zoom below, which resizes its frustum.
  const sun = new DirectionalLight("sun", new Vector3(-0.62, -0.38, -0.45), scene);
  sun.intensity = SUN_INTENSITY;
  // ...and the light the player carries. Declared here with the others, not when
  // a map loads: adding a light forces every PBR material to recompile, and doing
  // that on an area change is a hitch exactly where the frame budget is tightest.
  // It never casts a shadow — a second generator doubles the shadow cost and
  // gives every object two shadows pointing different ways. PoE's light radius
  // does not cast either.
  const torch = new PointLight("torch", new Vector3(0, TORCH_HEIGHT, 0), scene);
  torch.diffuse = torchColor(DEFAULT_SETTINGS.graphics.torchWarmth);
  // No specular. The lamp rides ~0.8 units off the skull, and a point light that
  // close puts its highlight lobe on the shiniest thing on the rig — the hair,
  // which then reads as a lit bulb sitting on the character's head. The sun
  // still gives every actor its specular; only this one may not.
  torch.specular = Color3.Black();
  torch.intensity = TORCH_INTENSITY;
  torch.range = TORCH_RANGE;
  torch.falloffType = Light.FALLOFF_GLTF;

  // Where the wheel has asked to be, and where the camera has eased to so far.
  let targetHalf = ORTHO_HALF_HEIGHT;
  let half = ORTHO_HALF_HEIGHT;

  const applyFraming = () => {
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    // Still written even though the projection no longer reads them: `half` is
    // the authored framing (half the visible height AT THE PLAYER'S PLANE) and
    // these are the record of it, which the zoom tests and the shadow extent
    // below both work from. The radius is DERIVED from it, so the same wheel
    // notch frames the same amount of floor it always did.
    camera.orthoTop = half;
    camera.orthoBottom = -half;
    camera.orthoLeft = -half * aspect;
    camera.orthoRight = half * aspect;
    camera.radius = half / Math.tan(CAMERA_FOV / 2);
    camera.beta = Math.min(
      BETA_LIMIT.max,
      Math.max(BETA_LIMIT.min, BETA_AT_DEFAULT + BETA_PER_UNIT * (half - ORTHO_HALF_HEIGHT)),
    );
    // The shadow frustum is sized to the visible floor, not to the world, so it
    // tracks the zoom. Since the wheel only zooms in this never has to grow —
    // it just stops spending 2048 texels on floor that is no longer on screen,
    // and the shadows sharpen as the character gets closer.
    const zoom = half / ORTHO_HALF_HEIGHT;
    const extent = SHADOW_EXTENT * zoom;
    sun.orthoLeft = -extent;
    sun.orthoRight = extent;
    sun.orthoBottom = -extent;
    sun.orthoTop = extent;
    // The pool travels with the framing, or zooming in turns the lights up.
    //
    // Nothing about the torch changes on a wheel notch and the screen still
    // gets brighter: a pool of fixed WORLD size covers more of a frame that
    // shows less floor. Measured at the middle of the image, zooming all the
    // way in took it from 93 luma to 125.
    //
    // Only the reach scales. Scaling the lamp's HEIGHT and its intensity with
    // it as well is the geometrically pure version — similar triangles at every
    // zoom — and it measured WORSE (121 against 111), because dropping the lamp
    // concentrates the pool into a tighter, hotter core exactly where the frame
    // is now looking. Reach alone removes about half the rise. The rest is not
    // the torch at all: with every light in the room switched off the same zoom
    // still lifts the frame from 29 to 37, which is the floor texture coming off
    // its minified mip levels and the fog letting go of the near ground.
    torch.range = TORCH_RANGE * zoom;
    // ...and the fires in the room, which are the same argument.
    setFireLightZoom(zoom);
  };
  applyFraming();
  engine.onResizeObservable.add(applyFraming);

  const setZoom = (notches: number): void => {
    targetHalf = Math.min(
      MAX_HALF_HEIGHT,
      Math.max(MIN_HALF_HEIGHT, targetHalf * ZOOM_STEP ** notches),
    );
    // Tests and the first notch want the effect without waiting for a frame;
    // the limiter below only has to cover the distance that is left.
    half += clampStep(targetHalf - half, ZOOM_KICK);
    applyFraming();
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
    // Real seconds, so the travel is the same on a 60Hz panel and a 165Hz one.
    const dt = Math.min(0.1, (engine.getDeltaTime?.() || 16) / 1000);
    half += clampStep(targetHalf - half, MAX_ZOOM_SPEED * dt);
    applyFraming();
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
  ground.freezeWorldMatrix();
  ground.doNotSyncBoundingInfo = true;

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
    // Bracketed TIGHTLY around the scene, and that is what makes the softening
    // below work at all. The light sits `SUN_DISTANCE` back along its own
    // direction, the visible box reaches about 20 units either side of that
    // along the ray and 3.5 up, so everything that can cast lives in roughly
    // 40..80. Spanning 1..140 instead spreads that band across a quarter of the
    // depth range, and PCSS measures the blocker-to-receiver gap in NORMALISED
    // depth — at that scale a boulder and the floor under it differ by ~0.01 and
    // every shadow comes out uniformly hard. Tightening the range is the fix,
    // not a larger light.
    sun.shadowMinZ = SUN_DISTANCE - 35;
    sun.shadowMaxZ = SUN_DISTANCE + 35;

    const shadows = new ShadowGenerator(2048, sun);
    // No forceBackFacesOnly here: it halves the shadow-map draw but stores the
    // FAR side of a closed boulder, so the floor at its own base sits behind
    // that depth and self-shadows into hard black squares that fight per frame.
    // Contact hardening (PCSS): sharp where an object meets the floor, widening
    // with the gap to its caster. A single blur radius is the thing that reads
    // as CG — a boulder's shadow is crisp at its base and diffuse at the far end
    // of the smear, and at this raking sun that difference runs the length of
    // every shadow in the frame. Supersedes PCF; setting both is last-one-wins.
    shadows.useContactHardeningShadow = true;
    // Light size in shadow-map UV, and this number is sharper than it looks.
    // The frustum is 2*SHADOW_EXTENT across, so 0.07 is a sun about 2.2 units
    // wide — physically absurd, and the point: a real sun's penumbra is under a
    // degree and invisible here, while a readable "softens with distance" needs
    // a source with size.
    //
    // It also sets the BLOCKER SEARCH radius, which is why it cannot simply be
    // turned up. At 0.2 the search swept ~3 world units, wider than the props
    // themselves, so most samples found no blocker, every penumbra estimate came
    // out enormous and the frame lost its shadows entirely — verified against a
    // PCF frame of the same hideout, chest and map device both bare. 0.07 is the
    // largest value where the shadows are still there.
    shadows.contactHardeningLightSizeUVRatio = 0.07;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.darkness = 0.12; // deep, but the flagstones still read through them
    // Offset the shadow lookup along the receiving surface's own normal, which is
    // what stops a lit face shadowing ITSELF. A prop is both caster and receiver,
    // and where this sun rakes a flat top the depth it stored and the depth it
    // tests differ by less than a texel: the tabletop came out ringed with
    // concentric moire that swam across the wood as the player moved, because the
    // frustum is dragged along behind the camera every frame. Proved by turning
    // reception off on that one mesh, which cleared it while SSAO and the torch's
    // own shadows were already ruled out. Along the normal and not a flat depth
    // bias: a plain bias big enough for this detaches every contact shadow from
    // the thing casting it.
    shadows.normalBias = 0.02;
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
    // The coast's berm is cast back in for the same reason as the boulders: it
    // is the same height, it is discrete, and without a shadow a metre of sand
    // reads as painted onto the beach rather than standing on it. Its outer
    // ridge and its scrub stay out — the ridge is the rampart's unbroken band
    // again, and a few hundred grass clumps are the one thing on this boundary
    // not worth a shadow map update.
    const isLevelGeometry = (name: string): boolean =>
      (name.startsWith("wallrun-") &&
        !name.startsWith(ROCK_MESH_PREFIX) &&
        !name.startsWith(DUNE_MESH_PREFIX)) ||
      name === WALL_MESH_NAME ||
      // The sea is a sheet covering everything outside the rim: casting from it
      // would put the whole void in shadow, and it is born with this name for
      // the same reason the wall mesh is.
      name === SEA_MESH_NAME;
    // The torch throws its own shadows, and it is the only light that may throw
    // them off a wall: the sun's problem was a 3.5-unit run smearing one 9-unit
    // band across a whole room, but the torch stands INSIDE the room at the
    // player's height, so a wall's shadow is short, radial, and moves with the
    // player. That is the light-radius read in PoE — the pool ends where a wall
    // or a boulder eats it. A point light means a cube map, so it stays at 1024
    // (six faces) and covers only the pool.
    torch.shadowMinZ = 0.4;
    torch.shadowMaxZ = TORCH_RANGE;
    const torchShadows = new ShadowGenerator(1024, torch);
    // See the sun generator: back-faces-only turns every boulder base black.
    torchShadows.usePercentageCloserFiltering = true;
    torchShadows.filteringQuality = ShadowGenerator.QUALITY_LOW; // x6 faces
    torchShadows.darkness = 0.35; // softer than the sun's: fill still reaches in
    // Depth bias, and the reason the floor used to ripple.
    //
    // The torch is a POINT light, so its shadow map is a cube, and the floor it
    // stands over is sampled at a grazing angle across six faces at 1024. At the
    // stock bias that surface shadows ITSELF in rings — concentric, centred on
    // the lamp, and therefore travelling with the player, which is what made it
    // look like a texture stuck to the character rather than an artefact of the
    // light. The tiled floor art hid it; a plain surface (the DEV debug plates
    // in hideout.ts) shows it immediately.
    //
    // `normalBias` is the one that fixes it: it offsets the lookup ALONG THE
    // SURFACE NORMAL, which is exactly the axis the error grows on as the light
    // flattens out. `bias` alone cannot — raise it far enough to clear the rings
    // and every contact shadow in the room detaches from its object.
    torchShadows.bias = 0.0002;
    torchShadows.normalBias = 0.03;
    // An actor may not cast from the torch. The lamp rides the player, so the
    // player's own shadow lands directly under the player as a blob that follows
    // the feet and reads as a stain on the floor, not as light. Actor parts share
    // their names across entities (every rig is the same 40 `slot.look.part`
    // meshes under an `entity-N` root), so there is no way to tell the carrier's
    // rig from a monster's here — the whole class stays out. The sun still gives
    // every actor the shadow that matters.
    //
    // A predicate and not the add-time filter the sun uses: that one sees a name
    // ONCE, when the mesh is added, so anything renamed afterwards is already
    // registered under whatever it was called first — 40 actor parts got in that
    // way. `renderListPredicate` is re-evaluated every frame against the current
    // name, so a rename cannot smuggle a caster past it.
    torchShadows.getShadowMap()!.renderListPredicate = (mesh) => {
      if (mesh === ground || mesh.name.startsWith("telegraph-") || mesh.name === FLAME_MESH
        || mesh.name.startsWith("groundblob-") || isWardrobePart(mesh.name)) return false;
      // Range cull: nothing past the torch's own reach can receive its light, so
      // nothing there can cast a visible shadow from it either. This is a third
      // of the cube map's draw calls, measured live in the hideout.
      const bs = mesh.getBoundingInfo().boundingSphere;
      const dx = bs.centerWorld.x - torch.position.x;
      const dy = bs.centerWorld.y - torch.position.y;
      const dz = bs.centerWorld.z - torch.position.z;
      const reach = torch.range + bs.radiusWorld + 2;
      return dx * dx + dy * dy + dz * dz <= reach * reach;
    };
    scene.onNewMeshAddedObservable.add((mesh) => {
      if (mesh.name.startsWith("telegraph-") || mesh.name.startsWith("groundblob-")
        || mesh === ground || isLevelGeometry(mesh.name)) {
        return;
      }
      // The fire is light, not a thing standing in light: an ember that cast
      // would put a flicker of shadow under every brazier in the room, and
      // there are a thousand of them in a frame.
      if (mesh.name === FLAME_MESH) return;
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
    torchShadows.removeShadowCaster(ground);

    // Walk the light along with the camera so the frustum always brackets what
    // the player can see. Backwards along the light direction, and high enough
    // that nothing on screen falls behind shadowMinZ.
    // Normalised first: the authored direction is 0.855 long, so scaling it raw
    // put the light 60 units back only by accident and any re-aim would move it.
    const back = sun.direction.normalizeToNew().negateInPlace().scaleInPlace(SUN_DISTANCE);
    scene.onBeforeRenderObservable.add(() => {
      sun.position.copyFrom(camera.target).addInPlace(back);
    });
  } catch {
    /* no render targets under NullEngine — lit but unshadowed is fine in tests */
  }

  // Ride the torch on the camera target. That target IS the player, interpolated:
  // App.tsx sets it from the snapshot every frame, so this needs no handle on the
  // entity system and cannot drift out of step with the character mesh.
  //
  // Outside the shadow block above on purpose — that one is inside a try that
  // NullEngine throws out of, and a light that follows needs no render target.
  //
  // The torch lights the FLOOR, never a character. A point light riding the
  // player is always nearest to the top of that player's head, and inverse
  // square then blows the head white whatever the height and intensity — the
  // hair read as a lit bulb. Turn the torch off and the sun alone renders the
  // character correctly, so the carrier loses nothing by being excluded. This
  // costs the monsters their brightening inside the radius; the pool on the
  // floor is what reads as a light radius at this camera, and a blown-out
  // player is a worse trade.
  //
  // Rebuilt only when the mesh count moves, and matched on the CURRENT name: an
  // add-time filter sees a name once and loses to anything renamed afterwards,
  // which is how 40 actor parts got into the shadow list.
  let lastMeshCount = -1;
  scene.onBeforeRenderObservable.add(() => {
    torch.position.set(camera.target.x, TORCH_HEIGHT, camera.target.z);
    if (scene.meshes.length !== lastMeshCount) {
      lastMeshCount = scene.meshes.length;
      torch.excludedMeshes = scene.meshes.filter((m) => isWardrobePart(m.name));
    }
    // Render-side only. Never read the sim clock here: the flicker must not be
    // able to reach a replay checksum.
    const t = performance.now() / 1000;
    const wobble = Math.sin(t * 6.3) * 0.6 + Math.sin(t * 11.7) * 0.4;
    torch.intensity = TORCH_INTENSITY * (1 + wobble * TORCH_FLICKER);
    // ...and the fires that belong to the PLACE, pointed at whichever bowls are
    // nearest the camera. Same clock argument: render-side only.
    updateFireLights(scene, camera.target, engine.getDeltaTime?.() ?? 16);
  });

  createFireLights(scene);
  // The fire, into the bloom on its own terms.
  //
  // GlowLayer re-renders every emissive mesh through a shader of its OWN that
  // reads the material's emissive colour and nothing else — not the blend mode,
  // not the alpha, not the per-instance colour. An ember is white emissive at
  // an alpha of a few percent, so the glow pass drew six hundred opaque white
  // solids and the fire came back as a clipped white egg that ignored every
  // knob on it. Referencing the mesh makes the glow map render it with the
  // material it actually has, which is the only way an additive particle can be
  // in a bloom at all.
  const flame = scene.getMeshByName(FLAME_MESH);
  const bloom = scene.effectLayers?.find((l) => l.name === "glow") as GlowLayer | undefined;
  if (flame && bloom) bloom.referenceMeshToUseItsOwnMaterial(flame);
  createHaze(scene, camera);
  createMotes(scene, camera);

  return { scene, camera, setZoom, detachZoom };
}
