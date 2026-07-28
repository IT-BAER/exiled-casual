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
export const HAZE_HEIGHT = 3.4;
/** Kept small for the reason above, not for fill rate: bigger sprites are what
 *  forced the height up in the first place. */
export const HAZE_MAX_SIZE = 6;
/** Additive, so this is intensity and not opacity. The torch pool is the thing
 *  the frame is built around; haze thick enough to be noticed on its own has
 *  already washed the pool out. */
const ALPHA = 0.22;

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

  ps.color1 = new Color4(0.62, 0.68, 0.78, ALPHA);
  ps.color2 = new Color4(0.75, 0.76, 0.8, ALPHA);
  ps.colorDead = new Color4(0.6, 0.66, 0.76, 0);

  ps.minSize = 3;
  ps.maxSize = HAZE_MAX_SIZE;
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
 * Recolour the haze for a biome. Takes the same already-normalised tint the
 * lights take, so a swamp's air goes green without the room going darker.
 */
export function tintHaze(scene: Scene, nr: number, ng: number, nb: number): void {
  const ps = scene.particleSystems.find((p) => p.name === HAZE_NAME) as ParticleSystem | undefined;
  if (!ps) return;
  ps.color1 = new Color4(0.62 * nr, 0.68 * ng, 0.78 * nb, ALPHA);
  ps.color2 = new Color4(0.75 * nr, 0.76 * ng, 0.8 * nb, ALPHA);
  ps.colorDead = new Color4(0.6 * nr, 0.66 * ng, 0.76 * nb, 0);
}
