import {
  Color3,
  PointLight,
  RenderTargetTexture,
  ShadowGenerator,
  Vector3,
  type AbstractMesh,
  type Scene,
} from "@babylonjs/core";
import {
  createFireFlames,
  FLAME_MESH,
  FLAME_RANGE,
  resetFireFlames,
  updateFireFlames,
} from "./flames";
import { LEDGE_MESH_PREFIX, isScatterDressing } from "./rocks";
import { cullShadowCasters } from "./shadow-cull";

/**
 * The fires the world is lit by, as opposed to the one the player carries.
 *
 * A hideout and a map lit only by the torch on the character's belt look like a
 * torchlit character on a dark plate: every room is the same brightness, every
 * shadow points at the player, and nothing in the place has a reason to be seen.
 * A brazier standing in a corner is what makes a corner a corner.
 *
 * ## Why a pool
 *
 * Every light a material can see is a branch in its shader, and Babylon caps a
 * material at four by default. A map with twenty braziers on it does not want
 * twenty lights: it wants the FOUR NEAREST to be lit, because the camera only
 * shows nineteen units across and a fire past that edge contributes nothing but
 * a shader recompile.
 *
 * So this owns a fixed pool of point lights, created once with the scene (adding
 * a light later forces every PBR material to recompile, which is a visible hitch
 * mid-run), and every frame it hands the pool to whichever bowls are closest to
 * the camera. A light that has nothing to do is switched off rather than
 * disposed, which costs nothing and keeps the shader permutations stable.
 *
 * ## Flicker
 *
 * Two detuned sines per light, on both intensity and range, each seeded off the
 * bowl's own position: fires near each other must not breathe together, and a
 * single sine is a pulse rather than a flame. The same argument as the menu's
 * painted braziers (`menu/atmos.tsx`), which is where the numbers came from.
 */

/** How many bowls may be lit at once. Babylon's default per-material cap. */
export const LIGHT_POOL = 4;

/** Name every pooled light takes, so a rebuild can find them again. */
const POOL_PREFIX = "firelight-";

/** How tall the bowl's rim stands. Authored in `tools/build_props.py`. */
export const BRAZIER_RIM_Y = 1.02;

/** ...and how wide it is there. Same source. It is the widest thing on the prop. */
export const BRAZIER_RIM_R = 0.4;

/**
 * The disc the bowl throws on the floor from the fire burning in it.
 *
 * A point light `h` above a rim of radius `r` at height `y` casts that rim as a
 * circle of `r * h / (h - y)`, and at this scale that number is the whole look
 * of a brazier: at 1.45 it was 1.35 units, a stain three times the width of the
 * prop standing in it. It is why the lamp hangs where it does.
 */
export const rimShadowRadius = (h: number): number =>
  BRAZIER_RIM_R * h / (h - BRAZIER_RIM_Y);

/**
 * Height the point light hangs at, and it must stand WELL clear of the rim.
 *
 * At 1.12 it sat level with the bowl's lip, so the disc blocked its own light
 * going outward and threw a shadow across the entire floor. A point light is a
 * CUBE map, and its four side faces meet on the diagonals: that floor-wide
 * shadow edge landed at a slightly different radius on each face, which read as
 * four dark quadrants with bright bands between them — a cross stamped into the
 * pool around every brazier.
 *
 * Clearing the rim killed the quadrants but left the bowl's own shadow far too
 * wide (see `rimShadowRadius`): the disc shrinks as the lamp rises, so this sits
 * at the TOP of the flame column the fire mesh draws (`BASE_Y + FLAME_H` = 1.77
 * in flames.ts) rather than in the middle of it. Above the tip the pool goes
 * flat and stops reading as a fire in a bowl; below it the stain comes back.
 *
 * Do not lower this to make the pool brighter: irradiance goes as 1/h², so
 * `FIRE_INTENSITY` is what pays for the height.
 */
export const BRAZIER_FLAME_Y = 1.8;

/**
 * Colour of a coal fire. Warmer and redder than the torch, which is a flame.
 *
 * Built on demand rather than at import: GameView's test partially mocks
 * `@babylonjs/core`, and a module-level `new Color3` makes importing this file
 * at all depend on the mock carrying that export.
 */
const fireColour = (): Color3 => new Color3(1.0, 0.52, 0.22);

/**
 * Intensity and reach of one bowl. Both are flickered around these.
 *
 * The reach is what a brazier is FOR. At 7.4 the pool stopped about two body
 * lengths from the stand, so a fire lit its own feet and the room around it was
 * still the torch's; a standing brazier has to own the corner it is in.
 */
// 310 and not the 120 this was tuned to at 1.12: the lamp moved up to clear the
// rim (see BRAZIER_FLAME_Y) and irradiance on the floor goes as 1/h², so holding
// the same pool costs (1.8/1.12)² = 2.58 of the old number.
const FIRE_INTENSITY = 310;
const FIRE_RANGE = 11;

/** How deep the flicker cuts, as a fraction of each. */
const FLICKER_INTENSITY = 0.18;
const FLICKER_RANGE = 0.06;

/** A bowl that could be lit: where it is, and the phase its flame is at. */
export interface FireSpot {
  x: number;
  z: number;
  /** Seconds of offset, so two fires never breathe together. */
  phase: number;
}

/**
 * Where the fires are, in world units. Rebuilt per area by `setFireSpots`.
 *
 * Kept here rather than read off the scene every frame: the props are meshes
 * under an instantiated glTF root and finding them by name is a walk of the
 * whole node list, which is not a per-frame question when the answer only
 * changes when an area does.
 */
let spots: FireSpot[] = [];
let pool: PointLight[] = [];
let clock = 0;
/** Rebuilt whenever the scene's mesh count moves. See `excludeBowls`. */
let lastMeshCount = -1;
/**
 * The camera's framing, as a fraction of the authored one.
 *
 * A pool of fixed WORLD size covers more of a frame that shows less floor, so
 * zooming in turns every light in the room up without touching one of them.
 * `engine.ts` hands the framing here for the same reason it scales the torch's
 * reach with it: the fires are composed for the shot, not for the metre.
 */
let zoom = 1;
/** Which lit bowl re-renders its shadow cube this frame. See `castFrom`. */
/**
 * Build the pool. Call once per scene, with the other lights.
 *
 * Idempotent per scene: a second call finds the lights it made the first time.
 */
export function createFireLights(scene: Scene): PointLight[] {
  pool = [];
  for (let i = 0; i < LIGHT_POOL; i++) {
    const existing = scene.getLightByName(`${POOL_PREFIX}${i}`);
    const light = (existing as PointLight | null) ?? new PointLight(
      `${POOL_PREFIX}${i}`, new Vector3(0, BRAZIER_FLAME_Y, 0), scene);
    light.diffuse = fireColour();
    light.specular = new Color3(0, 0, 0);
    light.range = FIRE_RANGE;
    light.intensity = 0;
    light.setEnabled(false);
    pool.push(light);
  }
  for (const light of pool) castFrom(scene, light);
  // ...and the fire the light is coming out of. Built here rather than beside
  // the haze in engine.ts so the two halves of a brazier cannot be set up
  // separately: a pool of light with nothing burning in it is the bug this
  // whole file used to have.
  createFireFlames(scene);
  return pool;
}

/** A caster beyond the light's reach cannot change a lit pixel. The extra two
 * units cover animated limbs whose skinned vertices can leave their bind-pose
 * sphere, matching the torch's proven safety margin. */
function reachesCaster(light: PointLight, mesh: AbstractMesh): boolean {
  const sphere = mesh.getBoundingInfo().boundingSphere;
  const dx = sphere.centerWorld.x - light.position.x;
  const dy = sphere.centerWorld.y - light.position.y;
  const dz = sphere.centerWorld.z - light.position.z;
  const reach = light.range + sphere.radiusWorld + 2;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/**
 * Give a bowl real shadows.
 *
 * Every pooled light casts: one caster popped its shadow to whichever fire was
 * nearest, so a lit brazier at the frame's edge threw nothing. A point light
 * means a CUBE map, six faces every frame, so this is the expensive choice made
 * knowingly; a disabled light's map is not rendered, so only bowls actually lit
 * pay it.
 */
function castFrom(scene: Scene, light: PointLight | undefined): void {
  if (!light || light.getShadowGenerator()) return;
  try {
    light.shadowMinZ = 0.35;
    light.shadowMaxZ = FIRE_RANGE;
    const gen = new ShadowGenerator(512, light);
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality = ShadowGenerator.QUALITY_LOW; // x6 faces
    // `darkness` only attenuates this ONE light's occluded term; the fill and
    // the other fires relight the rest, and near a bowl the fire term dominates,
    // so even 0.5 reads clearly. (When these shadows seemed immune to darkness
    // entirely, the cause was the empty renderList — see cullShadowCasters.)
    gen.darkness = 0.5;
    // The same pair the torch needs, for the same reason: a point light over a
    // floor samples that floor at a grazing angle across six faces, and at the
    // stock bias the surface shadows ITSELF in rings centred on the lamp.
    gen.bias = 0.0002;
    gen.normalBias = 0.03;
    // Evaluated per frame against the CURRENT name, so a mesh renamed after it
    // was created cannot smuggle itself in. The floor only receives; the fire
    // is light rather than a thing standing in light; a telegraph decal is
    // paint on the floor. Everything else in the room casts, actors included —
    // that is the whole difference between this and the torch, which rides the
    // player and would only ever draw a blob under his own feet.
    const casts = (mesh: AbstractMesh): boolean =>
      mesh.name !== "ground"
      && mesh.name !== FLAME_MESH
      && !mesh.name.startsWith("telegraph-")
      && !isScatterDressing(mesh.name)
      // The coast's ledge is 900+ thin instances behind one map-wide bounding
      // sphere, re-drawn on every face of every armed cube (~5M indices a
      // frame, measured live). It keeps casting from the TORCH — the pool the
      // player reads — and gives up the decorative fire shadows.
      && !mesh.name.startsWith(LEDGE_MESH_PREFIX)
      && reachesCaster(light, mesh);
    // Rendered on demand only: `updateFireLights` re-arms ONE map per frame,
    // round-robin. Four cube maps every frame were half the whole frame budget
    // (54 -> 110 fps in the hideout, measured live); staggered at a third of the
    // frame rate each, firelight shadows are soft and flickering anyway and the
    // lag is not readable.
    gen.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    // ...and only the casters each face can see. A bowl's reach is 11 units in a
    // room the whole level is a caster in, so this is where the cube stops being
    // six passes over everything standing near the fire.
    cullShadowCasters(gen, casts);
  } catch {
    /* no render targets under NullEngine — lit but unshadowed is fine in tests */
  }
}

/** Forget the pool. The scene that owned it is going away. */
export function resetFireLights(): void {
  pool = [];
  spots = [];
  clock = 0;
  lastMeshCount = -1;
  zoom = 1;
  resetFireFlames();
}

/**
 * Keep the fire out of its own bowl.
 *
 * The light sits a hand above the coals, so at inverse square the coals get an
 * order more of it than anything else in the room and come back off the screen
 * as a white saucer — the fire looked like a lamp with the shade off. Their own
 * emissive texture is what they are lit by; this is what stops the pool adding
 * to it. Same mechanism the player torch uses to stay out of the character's
 * hair (`excludedMeshes` in engine.ts), and re-run on the same signal: a change
 * in the scene's mesh count, which is an area being built.
 */
function excludeBowls(scene: Scene): void {
  if (scene.meshes.length === lastMeshCount) return;
  lastMeshCount = scene.meshes.length;
  const bowls: AbstractMesh[] = scene.meshes.filter((m) => m.name.includes("brazier"));
  for (const light of pool) light.excludedMeshes = bowls;
}

/** How much of the authored framing the camera is showing. See `zoom`. */
export function setFireLightZoom(k: number): void {
  zoom = k;
}

/** The fires in the area that has just been built. Replaces the last set. */
export function setFireSpots(next: readonly FireSpot[]): void {
  spots = [...next];
}

/** What the lights are doing, for tests: name, whether lit, and where. */
export function fireLightState(): { on: boolean; x: number; z: number; intensity: number }[] {
  return pool.map((l) => ({
    on: l.isEnabled(),
    x: l.position.x,
    z: l.position.z,
    intensity: l.intensity,
  }));
}

/**
 * Point the pool at the nearest bowls and flicker them. Call once per frame.
 *
 * `at` is the point to measure from — the camera's target, which is the player,
 * because that is what the frame is composed around.
 */
export function updateFireLights(scene: Scene, at: Vector3, deltaMs: number): void {
  if (pool.length === 0) return;
  excludeBowls(scene);
  clock += deltaMs / 1000;

  // Nearest first. A plain sort: this list is per area and a dozen long, and a
  // partial selection would cost more to read than it saves to run.
  const near = [...spots]
    .map((s) => ({ s, d: (s.x - at.x) ** 2 + (s.z - at.z) ** 2 }))
    .sort((a, b) => a.d - b.d);

  // The same list the pool is about to be pointed at, cut at the distance a
  // bowl leaves the frame. The flame's own cap is `LIGHT_POOL` too, so a bowl
  // is never lit with nothing burning in it or alight with no pool under it.
  updateFireFlames(
    near.filter((n) => n.d <= FLAME_RANGE * FLAME_RANGE).map((n) => n.s),
    clock,
  );

  for (let i = 0; i < pool.length; i++) {
    const light = pool[i]!;
    const found = near[i];
    if (!found) {
      light.setEnabled(false);
      continue;
    }
    const { s } = found;
    const moved = light.position.x !== s.x || light.position.z !== s.z;
    light.position.set(s.x, BRAZIER_FLAME_Y, s.z);
    const t = clock + s.phase;
    const wobble = Math.sin(t * 3.1) * 0.66 + Math.sin(t * 1.27 + 1.7) * 0.34;
    light.intensity = FIRE_INTENSITY * (1 + FLICKER_INTENSITY * wobble);
    light.range = FIRE_RANGE * zoom * (1 + FLICKER_RANGE * wobble);
    light.setEnabled(true);
    if (moved) light.getShadowGenerator()?.getShadowMap()?.resetRefreshCounter();
  }

  // Every lit bowl's cube re-armed every frame. The maps are RENDER_ONCE; this
  // is the only thing that re-arms them. The old one-cube-per-frame round-robin
  // predates per-face caster culling and read as low-framerate shadows; if this
  // is what keeps high under 100 fps, drop back to re-arming two per frame.
  for (const light of pool) {
    if (light.isEnabled()) light.getShadowGenerator()?.getShadowMap()?.resetRefreshCounter();
  }
}
