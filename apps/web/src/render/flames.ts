import {
  Color3,
  Color4,
  MeshBuilder,
  SolidParticleSystem,
  StandardMaterial,
  type Mesh,
  type Scene,
  type SolidParticle,
} from "@babylonjs/core";
import type { FireSpot } from "./lights";

/**
 * The fire itself, standing in the bowls that `lights.ts` lights the room from.
 *
 * A brazier used to be a glowing lump of coals under a flickering point light,
 * and that reads as a lamp someone left on the floor: the light says fire and
 * nothing in the bowl agrees with it. The eye takes the glow on trust for about
 * a second and then goes looking for the thing making it.
 *
 * This is the menu's fire (`menu/atmos.tsx`) carried into the world — the same
 * trajectory, the same heat ramp, the same white-hot lip cooling to soot at the
 * tip, the same few sparks that leave the top altogether. What changes is what a
 * particle IS. In the menu it is a pre-rendered dot blitted onto a canvas over a
 * painting, which is legitimate there because the whole screen is 2D. In the
 * world it has to be geometry: a real octahedron in real world units, standing
 * in the room, occluded by whatever is in front of it, seen at whatever angle
 * the camera happens to be at. Nothing here is a billboard, a sprite sheet or a
 * flipbook.
 *
 * ## Why a SolidParticleSystem and not thin instances
 *
 * Thin instances were the obvious build — one mesh, one draw, a matrix and a
 * colour per ember — and the colour half of it silently does not work in this
 * scene. The `instanceColor` buffer is attached, the attribute is bound and
 * `INSTANCESCOLOR` is in the effect's defines, and every ember still shades as
 * if `vColor` were `vec4(1.0)`: heat and alpha both gone, so six hundred embers
 * of white at full opacity summed to a white egg that ignored every knob on it.
 * An SPS writes per-particle colour into the mesh's OWN vertex buffer instead,
 * which is the ordinary `VERTEXCOLOR` path every other material in the engine
 * uses, and it costs one draw call the same way.
 *
 * ## Why only the near bowls burn
 *
 * An area stands up to ten braziers and the camera shows nineteen units across,
 * so most of them are off screen. Only the `BOWLS` nearest within `FLAME_RANGE`
 * are given particles; the rest of the pool is parked at zero scale. The cut is
 * well outside the frame, so a bowl swapping in never happens where it shows.
 */

/** The one mesh, by name, so a rebuild finds it instead of making a second. */
export const FLAME_MESH = "fire-flames";

/**
 * Embers per bowl, and how many bowls may burn at once.
 *
 * The menu runs 560 per brazier because a canvas particle is nearly free. Here
 * every particle is six vertices rewritten and re-uploaded per frame, and the
 * upload is the whole buffer whether or not a particle moved — so the CAPACITY
 * is the cost, not the number alight. Six bowls of 392 cost fourteen frames a
 * second; four of 312 cost two, and the fire is the same fire.
 *
 * Four is also exactly `LIGHT_POOL`, which is not a coincidence worth breaking:
 * the bowls that burn are then the bowls that light the room, so a brazier can
 * never be lit with nothing in it or alight with no pool under it.
 */
const EMBERS = 300;
const SPARKS = 12;
const PER_BOWL = EMBERS + SPARKS;
const BOWLS = 4;
/** Past this, in world units, a bowl is off screen. The frame's half-diagonal
 *  is about 10.6, so the swap always happens out of sight. */
export const FLAME_RANGE = 14;

/**
 * The flame, in world units, against the brazier `tools/build_props.py` builds:
 * its rim is at 1.02 and the coals mound just under it, so the fire starts at
 * the coal face and stands about knee-high on the player.
 */
const BASE_Y = 0.95;
const FLAME_H = 1.2;
/** Radius of the lip the embers are born across: the bowl's inner floor. */
const LIP_R = 0.3;

/**
 * Width of one ember against the flame's height, and how much taller than wide
 * it is drawn at the lip, where the gas is moving fastest.
 *
 * Narrower than the menu's 0.045, because a particle here is a SOLID and not a
 * soft dot: at eight pixels the octahedron's own silhouette is legible and the
 * fire reads as confetti. Half the width and twice the count is the same light
 * through a mass the eye cannot pick individual pieces out of, which is the only
 * softness geometry gets for free.
 */
const EMBER_WIDTH = 0.026;
const EMBER_STRETCH = 2.6;

/**
 * How hard the fire burns into the frame.
 *
 * Lower than the menu's 0.50 because this camera looks DOWN the plume rather
 * than across it, so a pixel near the core takes a dozen embers stacked front to
 * back instead of two or three, and the shape only exists in the range where
 * that sum is still under 1.
 */
const BRIGHT = 0.7;

/**
 * How fast an ember fades as it climbs.
 *
 * The menu's 1.5 is a side-on view, where the plume gets the full height of the
 * screen to itself. This camera looks down it, so height is foreshortened into
 * the bowl and a fast fade leaves a glowing dish with nothing standing out of
 * it. Slower here, so the tongue survives the projection.
 */
const FADE = 0.8;

/**
 * Where on the heat ramp an ember is born.
 *
 * Not at 0. Twenty additive embers of white-hot gas sum to white paint, and a
 * white fire is a lamp — so no single ember here is ever white, and the white
 * core is what the PILE-UP makes, which is where a real fire's core comes from
 * too.
 */
const RAMP_FLOOR = 0.22;

/** Turbulence, closed form. Two sines whose periods share no small multiple,
 *  one folded through the other, so a particle advects through a field that
 *  never repeats on a count. Same field the menu's embers ride. */
function swirl(x: number, y: number): number {
  return Math.sin(x * 2.7 + Math.sin(y * 1.9) * 1.3) * 0.62
    + Math.sin(x * 5.3 - y * 3.1) * 0.38;
}

/** Colour of an ember at `u` of its life, white-hot at the coals to soot at the
 *  tip. The menu's ramp, in Babylon's 0..1 rather than in bytes. */
function emberColour(u: number, out: Color4): void {
  if (u < 0.22) {
    const k = u / 0.22;
    out.r = 1; out.g = (246 - 60 * k) / 255; out.b = (214 - 96 * k) / 255;
  } else if (u < 0.6) {
    const k = (u - 0.22) / 0.38;
    out.r = 1; out.g = (186 - 70 * k) / 255; out.b = (118 - 90 * k) / 255;
  } else {
    const k = (u - 0.6) / 0.4;
    out.r = (255 - 80 * k) / 255; out.g = (116 - 76 * k) / 255; out.b = (28 - 20 * k) / 255;
  }
}

interface Ember {
  born: number;
  life: number;
  laneX: number;
  laneZ: number;
  sway: number;
  size: number;
  leanX: number;
  leanZ: number;
  curl: number;
  reach: number;
}

interface Spark {
  born: number;
  life: number;
  laneX: number;
  laneZ: number;
  sway: number;
  driftX: number;
  driftZ: number;
  size: number;
  twinkle: number;
}

let sps: SolidParticleSystem | null = null;
let embers: Ember[] = [];
let sparks: Spark[] = [];

/** What `updateParticle` needs and cannot be handed: the bowls burning this
 *  frame, and the clock they burn on. */
let burning: readonly FireSpot[] = [];
let clock = 0;

/**
 * Build the system and the particle table. Call once per scene, with the lights.
 *
 * Idempotent per scene, for the same reason the light pool is: this is cheap to
 * find and expensive to duplicate.
 */
export function createFireFlames(scene: Scene): Mesh | null {
  const found = scene.getMeshByName(FLAME_MESH) as Mesh | null;
  if (found && sps) return found;
  // A mesh this module has forgotten is a fire that cannot be driven. That is a
  // scene rebuilt after a reset, and the old mesh goes.
  found?.dispose();

  const system = new SolidParticleSystem(FLAME_MESH, scene, { updatable: true });
  // Eight triangles. At this camera an ember covers three to six pixels, so the
  // solid's own facets are below what can be resolved — what matters is that it
  // HAS a shape in the room, and therefore a silhouette, an occlusion and a
  // parallax that a camera-facing quad would not have.
  const proto = MeshBuilder.CreatePolyhedron("fire-ember-proto", { type: 1, size: 0.5 }, scene);
  system.addShape(proto, BOWLS * PER_BOWL);
  proto.dispose();
  const m = system.buildMesh();

  const mat = new StandardMaterial("fire-flame-mat", scene);
  // White, because the per-particle vertex colour carries the hue: with the
  // lights off the composition resolves to `emissiveColor * vColor.rgb`.
  mat.emissiveColor = Color3.White();
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.alphaMode = 1; // ALPHA_ADD
  mat.backFaceCulling = false;
  // Additive and overlapping: an ember that wrote depth would reject every ember
  // behind it, and the pile-up IS the flame. Depth TESTING stays on, so a pillar
  // in front of the bowl still hides the fire behind it.
  mat.disableDepthWrite = true;
  m.material = mat;
  // Puts the mesh in the transparent pass AND turns on the shader's
  // `alpha *= vColor.a`. Without it the fire renders opaque, in the wrong pass.
  m.hasVertexAlpha = true;
  m.isPickable = false;
  m.receiveShadows = false;

  // Nothing here rotates, carries a UV or moves its own vertices, and the
  // particles are spread across the room rather than around the mesh's origin.
  system.computeParticleRotation = false;
  system.computeParticleTexture = false;
  system.computeParticleVertex = false;
  system.isAlwaysVisible = true;
  system.updateParticle = updateParticle;

  // Seeded, and with the menu fire's seed: a decorative fire that is
  // nonetheless deterministic renders the same in a captured frame twice
  // running, which is the difference between a devlog shot you can retake and
  // one you cannot.
  let seed = 0x6d2b79f5;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  /** -1..1, densest at 0. Two samples averaged is a triangle distribution: a
   *  flat lane fills the bowl edge to edge and burns as a wall. */
  const lane = () => rnd() + rnd() - 1;

  embers = [];
  sparks = [];
  for (let b = 0; b < BOWLS; b++) {
    for (let k = 0; k < EMBERS; k++) {
      embers.push({
        // Births spread over one lifetime, or the whole cohort dies together
        // and the flame pulses.
        born: (k / EMBERS) * 0.8 + b * 0.13,
        life: 0.95 + rnd() * 0.8,
        laneX: lane(),
        laneZ: lane(),
        sway: rnd() * Math.PI * 2,
        size: 0.7 + rnd() * 0.6,
        leanX: (rnd() * 2 - 1) * 0.35,
        leanZ: (rnd() * 2 - 1) * 0.35,
        curl: rnd() * 6.28,
        // A third burn out low. One uniform lifetime draws a plume with a flat
        // top; real fire is short tongues with a few that carry.
        reach: rnd() < 0.34 ? 0.45 + rnd() * 0.25 : 0.8 + rnd() * 0.35,
      });
    }
    for (let k = 0; k < SPARKS; k++) {
      sparks.push({
        born: (k / SPARKS) * 1.6 + b * 0.21,
        life: 1.7 + rnd() * 1.6,
        laneX: rnd() * 2 - 1,
        laneZ: rnd() * 2 - 1,
        sway: rnd() * Math.PI * 2,
        driftX: (rnd() * 2 - 1) * 0.5,
        driftZ: (rnd() * 2 - 1) * 0.5,
        size: 0.5 + rnd() * 0.7,
        twinkle: 6 + rnd() * 7,
      });
    }
  }

  sps = system;
  // One pass so nothing is left at the origin on the first frame.
  system.setParticles();
  return m;
}

/** Forget the system. The scene that owned it is going away with it. */
export function resetFireFlames(): void {
  sps = null;
  embers = [];
  sparks = [];
  burning = [];
  clock = 0;
}

/** How many embers are alight, for tests. */
export function flameParticleCount(): number {
  return Math.min(burning.length, BOWLS) * PER_BOWL;
}

/**
 * Burn the bowls nearest the camera. Called once a frame by `updateFireLights`,
 * on that module's clock so the flame and the light it throws breathe together.
 */
export function updateFireFlames(near: readonly FireSpot[], now: number): void {
  if (!sps) return;
  burning = near;
  clock = now;
  // Once per bowl rather than once per ember: the flicker is the same two
  // detuned sines for all four hundred of them, and it is the one term in the
  // loop that does not depend on which particle is being drawn.
  for (let b = 0; b < BOWLS; b++) {
    const s = near[b];
    if (!s) break;
    const ph = now + s.phase;
    flicker[b] = 0.72 + 0.2 * Math.sin(ph * 3.1) + 0.1 * Math.sin(ph * 1.27 + 1.7);
  }
  sps.setParticles();
}

/** The flicker each burning bowl is at this frame. See `updateFireFlames`. */
const flicker: number[] = [];

/**
 * One ember, or one spark, wherever it is in its life.
 *
 * A pure function of the clock, like the menu's: no particle carries state
 * between frames, so a frame can be reproduced from its timestamp alone.
 */
function updateParticle(p: SolidParticle): SolidParticle {
  const b = (p.idx / PER_BOWL) | 0;
  const s = burning[b];
  if (!s || b >= BOWLS) {
    // Parked, not merely invisible: a zero-scale particle still has a position,
    // and one left at the world origin stretches the mesh's bounds from the
    // brazier to the middle of the map. Stack them on a bowl that IS burning.
    p.scaling.setAll(0);
    const anchor = burning[0];
    if (anchor) p.position.set(anchor.x, BASE_Y, anchor.z);
    return p;
  }
  const k = p.idx - b * PER_BOWL;
  const t = clock;
  const ph = t + s.phase;
  const flick = flicker[b] ?? 1;

  if (k < EMBERS) {
    const e = embers[b * EMBERS + k]!;
    const u = (((t - e.born) / e.life) % 1 + 1) % 1;
    // Fast off the coals, slowing as it cools and spreads.
    const rise = u * (1.55 - 0.55 * u) * e.reach;
    // Three terms, and their order is the flame's shape. The lane converges on
    // the centre line as it climbs, which is the silhouette; the turbulence is
    // scaled by height, so the base stays laminar and only the top tears; the
    // lean is the whole fire's drift.
    const conv = LIP_R * (1 - u * 0.66);
    const wander = FLAME_H * 0.20 * rise;
    p.position.x = s.x
      + e.laneX * conv
      + swirl(e.laneX * 2.4 + e.curl, rise * 3.6 - ph * 1.15) * wander
      + Math.sin(u * 5.5 + e.sway) * FLAME_H * 0.04
      + e.leanX * FLAME_H * u * 0.25;
    p.position.z = s.z
      + e.laneZ * conv
      + swirl(e.laneZ * 2.4 + e.curl + 2.1, rise * 3.6 - ph * 1.15) * wander
      + Math.cos(u * 5.5 + e.sway) * FLAME_H * 0.04
      + e.leanZ * FLAME_H * u * 0.25;
    p.position.y = BASE_Y + FLAME_H * rise;
    // Widening, not narrowing: a parcel of burning gas diffuses as it cools.
    // The silhouette still comes to a point because the alpha falls faster than
    // the radius grows, so the tips go to filigree rather than to a solid cone
    // with a rounded cap.
    const rad = FLAME_H * EMBER_WIDTH * e.size * (1 + 0.9 * u);
    const stretch = 1.25 + (EMBER_STRETCH - 1.25) * (1 - u);
    p.scaling.set(rad, rad * stretch, rad);
    // Hot at the lip, hot in the middle: an ember two thirds out across the
    // bowl is at the edge of the burn and never was white.
    emberColour(
      Math.min(1, RAMP_FLOOR + u ** 0.8 + Math.hypot(e.laneX, e.laneZ) * 0.24),
      p.color!,
    );
    p.color!.a = (1 - u) ** FADE * BRIGHT * flick;
    return p;
  }

  // ...and the few that leave the flame altogether. A fire is two populations:
  // the body of it, and the specks that break off the top and travel until they
  // cool. The body alone reads as a lamp with a shape.
  const q = sparks[b * SPARKS + (k - EMBERS)]!;
  const u = (((t - q.born) / q.life) % 1 + 1) % 1;
  const rise = u * (1.35 - 0.35 * u) * 2.4;
  p.position.x = s.x + q.laneX * LIP_R * 0.9 + q.driftX * FLAME_H * u
    + Math.sin(u * 3.1 + q.sway) * FLAME_H * 0.05;
  p.position.z = s.z + q.laneZ * LIP_R * 0.9 + q.driftZ * FLAME_H * u
    + Math.cos(u * 3.1 + q.sway) * FLAME_H * 0.05;
  p.position.y = BASE_Y + FLAME_H * rise;
  const rad = FLAME_H * 0.014 * q.size * (1 - 0.35 * u);
  p.scaling.setAll(rad);
  emberColour(Math.min(1, 0.35 + u * 0.65), p.color!);
  // A spark is a point of light that gutters, not a parcel that fades: the
  // twinkle is the whole reason it reads as a spark and not as dust.
  p.color!.a = (1 - u) ** 2 * BRIGHT * 1.6 * (0.55 + 0.45 * Math.sin(t * q.twinkle + q.sway));
  return p;
}
