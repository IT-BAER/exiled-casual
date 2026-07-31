import {
  Color3,
  PointLight,
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

/** Height above the prop's origin the flame sits at: `BRAZIER_RIM_Z` plus a hand. */
export const BRAZIER_FLAME_Y = 1.12;

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
const FIRE_INTENSITY = 120;
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
  castFrom(scene, pool[0]);
  // ...and the fire the light is coming out of. Built here rather than beside
  // the haze in engine.ts so the two halves of a brazier cannot be set up
  // separately: a pool of light with nothing burning in it is the bug this
  // whole file used to have.
  createFireFlames(scene);
  return pool;
}

/**
 * Give the nearest bowl real shadows.
 *
 * One light of the four, and always the same one, because `updateFireLights`
 * hands the pool out nearest-first: `pool[0]` is by construction the fire the
 * player is standing next to, which is the only one whose shadows can be read
 * at this camera. A point light means a CUBE map — six faces every frame — so
 * four of these is four times a cost that buys nothing at the edge of the
 * frame.
 *
 * ponytail: one caster of four. If a room ever wants two fires throwing at
 * once, give pool[1] its own generator at half the resolution; the pool order
 * already guarantees which two they would be.
 */
function castFrom(scene: Scene, light: PointLight | undefined): void {
  if (!light || light.getShadowGenerator()) return;
  try {
    light.shadowMinZ = 0.35;
    light.shadowMaxZ = FIRE_RANGE;
    const gen = new ShadowGenerator(512, light);
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality = ShadowGenerator.QUALITY_LOW; // x6 faces
    // Lighter than the sun's: a fire is one source in a room the sun and the
    // torch are also in, and a black shadow from it reads as a hole.
    gen.darkness = 0.45;
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
    gen.getShadowMap()!.renderListPredicate = (mesh) =>
      mesh.name !== "ground"
      && mesh.name !== FLAME_MESH
      && !mesh.name.startsWith("telegraph-");
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
    light.position.set(s.x, BRAZIER_FLAME_Y, s.z);
    const t = clock + s.phase;
    const wobble = Math.sin(t * 3.1) * 0.66 + Math.sin(t * 1.27 + 1.7) * 0.34;
    light.intensity = FIRE_INTENSITY * (1 + FLICKER_INTENSITY * wobble);
    light.range = FIRE_RANGE * zoom * (1 + FLICKER_RANGE * wobble);
    light.setEnabled(true);
  }
}
