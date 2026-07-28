import { Color4, ParticleSystem, Texture, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera, Scene } from "@babylonjs/core";

/** Looked up by name from `applyBiomeTint`, the same way the lights are. */
export const HAZE_NAME = "haze";

/**
 * Capacity, not a target: at this size the sprites overlap heavily, so the
 * number that reads as "a room with air in it" is small. Every one of them is a
 * full-screen-ish transparent quad and the camera already runs SSAO2, ACES and
 * two shadow generators, so this is the term that decides whether the frame
 * cost of atmosphere is noticed.
 */
const CAPACITY = 60;
/** Half-extent of the emit box around the player, world units. The camera sees
 *  about 19 across, so 14 keeps the spawn line off screen — haze that pops into
 *  existence in view reads as a bug, not as air. */
const AREA = 14;
/**
 * The sprites are camera-facing quads, so each one stands `size` tall centred on
 * this. Anything that dips below the floor is CUT by it: the ground plane is
 * opaque and wins the depth test, so the quad ends in a dead-straight horizontal
 * line and the frame gets banded with them. `HEIGHT > MAX_SIZE / 2` is what
 * keeps every quad clear of the floor, and `haze.test.ts` pins exactly that.
 *
 * The cost is that this is not literally ground-hugging mist any more. At a 45°
 * camera it is indistinguishable, and a visible straight cut is not.
 */
export const HAZE_HEIGHT = 4.6;
/** Grows with the size gradient below (x1.25 at end of life), so the height has
 *  to clear half of `MAX_SIZE * 1.25`, not half of this. */
export const HAZE_MAX_SIZE = 7;
/** Additive, so this is intensity and not opacity. The torch pool is the thing
 *  the frame is built around; haze thick enough to be noticed on its own has
 *  already washed the pool out. */
const ALPHA = 0.15;

/**
 * Slow-drifting ground haze centred on the player.
 *
 * Camera-facing billboards and not floor-aligned quads: Babylon has no plane
 * lock on a particle system, and at beta=π/4 a billboard standing at ankle
 * height is within 45° of the floor anyway, so it reads as low mist. A quad
 * actually laid on the floor would also z-fight the ground plane.
 *
 * The emitter follows the player but the particles do NOT: only new ones spawn
 * at the new place, so the existing haze stays put in world space and the
 * player walks through it. Parent the particles to the camera instead and the
 * whole field slides with the view, which reads as a dirty lens.
 */
export function createHaze(scene: Scene, camera: ArcRotateCamera): ParticleSystem {
  const ps = new ParticleSystem(HAZE_NAME, CAPACITY, scene);
  ps.particleTexture = new Texture("/textures/fx/haze.png", scene);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;

  ps.emitter = new Vector3(0, HAZE_HEIGHT, 0);
  ps.minEmitBox = new Vector3(-AREA, -0.2, -AREA);
  ps.maxEmitBox = new Vector3(AREA, 0.3, AREA);

  setHazeColor(ps, 1, 1, 1);

  ps.minSize = 3.8;
  ps.maxSize = HAZE_MAX_SIZE;
  // Grow across the life. A sprite that appears at its final size announces the
  // moment it appeared even when its alpha ramps; drifting outward as it fades
  // in is what makes the arrival read as movement instead of as a spawn.
  ps.addSizeGradient(0, 0.7);
  ps.addSizeGradient(1, 1.25);
  // Long, because the fade in and out IS the effect: a short life makes the
  // field visibly repopulate, which the eye catches as blinking.
  ps.minLifeTime = 14;
  ps.maxLifeTime = 26;
  ps.emitRate = CAPACITY / 18;

  // A draught, not a wind. Anything faster and the tendrils read as smoke off a
  // fire, which puts a source in the room that is not there.
  ps.direction1 = new Vector3(-0.07, 0, -0.05);
  ps.direction2 = new Vector3(0.07, 0, 0.05);
  ps.gravity = Vector3.Zero();
  ps.minAngularSpeed = -0.04;
  ps.maxAngularSpeed = 0.04;
  ps.minEmitPower = 0.2;
  ps.maxEmitPower = 0.5;

  // Start full. Without this the first twenty seconds in a new area have no air
  // in them, which is exactly when the player is looking hardest at the place.
  ps.preWarmCycles = 240;
  ps.preWarmStepOffset = 4;

  ps.start();

  scene.onBeforeRenderObservable.add(() => {
    (ps.emitter as Vector3).set(camera.target.x, HAZE_HEIGHT, camera.target.z);
  });

  return ps;
}

/**
 * Alpha over the particle's life, as a gradient and NOT as color1/colorDead.
 *
 * Babylon starts a particle AT `color1` and only interpolates toward `colorDead`
 * from there, so a system built that way fades every sprite out and pops every
 * sprite in at full intensity — which is what the field visibly did. A gradient
 * is the only way to get the ramp on both ends. The plateau is deliberately
 * short at each end (0.18 / 0.82) so most of the life is spent at full value and
 * the fade is never slow enough to look like a dimmer being turned.
 *
 * Colour gradients OVERRIDE color1/color2/colorDead entirely; setting both is
 * how you get a system that ignores half its own configuration.
 */
const STOPS: readonly [number, number][] = [
  [0, 0],
  [0.18, ALPHA],
  [0.82, ALPHA],
  [1, 0],
];

function setHazeColor(ps: ParticleSystem, nr: number, ng: number, nb: number): void {
  for (const [at] of STOPS) ps.removeColorGradient(at);
  for (const [at, a] of STOPS) {
    ps.addColorGradient(at, new Color4(0.68 * nr, 0.71 * ng, 0.79 * nb, a));
  }
}

/** Motes are looked up by name too, but only by the tests: they take no tint. */
export const MOTES_NAME = "motes";

/** Small enough to read as a speck and no smaller. The camera shows about 19
 *  world units across a ~2000px canvas, so one world unit is ~100px and this
 *  range lands at 5 to 12 pixels. Below about 0.04 they alias into a flicker. */
const MOTE_SIZE = { min: 0.05, max: 0.12 };
/** Warm, because the only light down here that could catch a speck of dust is
 *  the torch. Deliberately NOT biome-tinted for the same reason: the haze is the
 *  room's air and takes the room's colour, a mote is lit by the lamp. */
const MOTE_COLOR: [number, number, number] = [1.0, 0.78, 0.5];

/**
 * Ambient motes: dust caught in the torchlight, rising slowly.
 *
 * Emitted in a column around the player rather than across the floor, because
 * the ones that read are the ones crossing a dark background at head height. On
 * the floor they land on lit stone and disappear into its texture.
 */
export function createMotes(scene: Scene, camera: ArcRotateCamera): ParticleSystem {
  const ps = new ParticleSystem(MOTES_NAME, 90, scene);
  ps.particleTexture = new Texture("/textures/fx/haze.png", scene);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;

  // Inside the visible box, unlike the haze: a mote that spawns off screen has
  // spent most of its short life before anyone could see it.
  ps.emitter = new Vector3(0, 0, 0);
  ps.minEmitBox = new Vector3(-7, 0.2, -7);
  ps.maxEmitBox = new Vector3(7, 3, 7);

  // Same alpha-on-both-ends rule as the haze, and for the same reason: a
  // particle starts AT color1, so without a gradient every speck pops on.
  const [r, g, b] = MOTE_COLOR;
  for (const [at, a] of [
    [0, 0],
    [0.25, 0.9],
    [0.7, 0.9],
    [1, 0],
  ] as const) {
    ps.addColorGradient(at, new Color4(r, g, b, a));
  }

  ps.minSize = MOTE_SIZE.min;
  ps.maxSize = MOTE_SIZE.max;
  ps.minLifeTime = 5;
  ps.maxLifeTime = 11;
  ps.emitRate = 11;

  // Rising, barely. Convection off a torch, not sparks off a fire: anything
  // faster puts a burning thing in the room that the player cannot find.
  ps.gravity = new Vector3(0, 0.035, 0);
  ps.direction1 = new Vector3(-0.04, 0.02, -0.04);
  ps.direction2 = new Vector3(0.04, 0.08, 0.04);
  ps.minEmitPower = 0.1;
  ps.maxEmitPower = 0.35;

  ps.preWarmCycles = 120;
  ps.preWarmStepOffset = 3;
  ps.start();

  scene.onBeforeRenderObservable.add(() => {
    (ps.emitter as Vector3).set(camera.target.x, 0, camera.target.z);
  });

  return ps;
}

/**
 * Recolour the haze for a biome. Takes the same already-normalised tint the
 * lights take, so a swamp's air goes green without the room going darker.
 */
export function tintHaze(scene: Scene, nr: number, ng: number, nb: number): void {
  const ps = scene.particleSystems.find((p) => p.name === HAZE_NAME) as ParticleSystem | undefined;
  if (ps) setHazeColor(ps, nr, ng, nb);
}
