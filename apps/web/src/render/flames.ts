import {
  Color3,
  Color4,
  Constants,
  Effect,
  Matrix,
  Mesh,
  MeshBuilder,
  ShaderMaterial,
  SolidParticleSystem,
  StandardMaterial,
  Vector3,
  type Scene,
  type SolidParticle,
} from "@babylonjs/core";
import type { FireSpot } from "./lights";

/**
 * The fire itself, standing in the bowls that `lights.ts` lights the room from.
 *
 * Two populations, as in a real fire: the body of the flame, and the few specks
 * that break off the top and travel until they cool.
 *
 * ## The body is one ray-marched box per bowl
 *
 * It was three hundred solid embers a bowl, each living about a second and a
 * half over a flame under a metre tall. Every one was a bright point the eye
 * could follow, so the fire read as a fountain streaming upward, and too fast,
 * however the lifetimes were tuned. A real flame has no points in it: the base
 * is a continuous sheet that hardly moves, and only the top half tears into
 * tongues that rise and break off a couple of times a second.
 *
 * So the fire is a density field: a teardrop most of the coals' width at the
 * base, torn at the top by two layers of rising noise, coloured by the same
 * white-hot-to-soot ramp the embers used. It is marched through a box standing
 * in the bowl, not painted on an upright quad: the camera looks 53 degrees down
 * into the bowl, so a sheet showed as a flat triangle whose foot was one straight
 * line across the coals. In the box the root is a disc over the coal bed, the
 * core glows brighter than the edges because the eye looks through more of it,
 * and the flame keeps its shape from every side of the room. Depth testing still
 * lets a pillar in front of the bowl hide it.
 *
 * ## The sparks stay solid
 *
 * Forty a bowl on a SolidParticleSystem, not thin instances: the thin-instance
 * `instanceColor` buffer is bound and still shades as `vec4(1.0)` in this scene,
 * which loses heat and alpha both. An SPS writes colour into the mesh's own
 * vertex buffer, the ordinary `VERTEXCOLOR` path.
 *
 * ## Why only the near bowls burn
 *
 * An area stands up to ten braziers and the camera shows nineteen units across,
 * so most of them are off screen. Only the `BOWLS` nearest within `FLAME_RANGE`
 * burn; the rest of the pool is parked. The cut is well outside the frame, so a
 * bowl swapping in never happens where it shows.
 */

/** The sparks' mesh, by name, so a rebuild finds it instead of making a second.
 *  Every flame mesh's name starts with it, which is how filters find them all. */
export const FLAME_MESH = "fire-flames";
/** The flame bodies' names: this, then the bowl's slot. */
export const FLAME_TONGUE = `${FLAME_MESH}-tongue-`;

/**
 * Sparks per bowl, and how many bowls may burn at once.
 *
 * Four is exactly `LIGHT_POOL`, which is not a coincidence worth breaking: the
 * bowls that burn are then the bowls that light the room, so a brazier can never
 * be lit with nothing in it or alight with no pool under it.
 */
export const SPARKS = 40;
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
const FLAME_H = 0.82;
/** Radius of the lip the sparks are born across: the bowl's inner floor. */
const LIP_R = 0.3;

/**
 * The box the body is marched through. Wider than the bowl's lip and taller than
 * the flame, because the shader tears the edges and tips in from it and a box
 * cut at the flame's own size clips a tongue into a straight edge. Its floor sits
 * a little under the coal face, so the coals, not the box, are where it starts.
 */
const TONGUE_W = 0.9;
const TONGUE_H = FLAME_H * 1.3;
const TONGUE_Y = BASE_Y - 0.03;
/** March steps through the box. The flame is a few dozen pixels across, so the
 *  steps are cheap; under about 16 the noise's layers show as bands. */
const MARCH_STEPS = 24;

/**
 * How hard the fire burns into the frame. Shared by the body and the sparks: the
 * camera looks DOWN the plume, so the flame only has a shape in the range where
 * what it adds to the floor behind it is still under white.
 */
const BRIGHT = 0.52;
/** The body's share of it. One layer of flame, where the embers stacked a dozen
 *  deep at the core, and under what a sheet took: looking down into the bowl,
 *  every ray finds the root's white core somewhere along it. */
const TONGUE_BRIGHT = 0.85;

/** Colour of a spark at `u` of the heat ramp, white-hot at the coals to soot at
 *  the tip. The menu's ramp (`menu/atmos.tsx`), in Babylon's 0..1. */
function emberColour(u: number, out: Color4): void {
  if (u < 0.22) {
    const k = u / 0.22;
    out.r = 1; out.g = (246 - 60 * k) / 255; out.b = (214 - 96 * k) / 255;
  } else if (u < 0.6) {
    const k = (u - 0.22) / 0.38;
    out.r = 1; out.g = (205 - 58 * k) / 255; out.b = (112 - 74 * k) / 255;
  } else {
    const k = (u - 0.6) / 0.4;
    out.r = (255 - 42 * k) / 255; out.g = (147 - 54 * k) / 255; out.b = (44 - 28 * k) / 255;
  }
}

const FLAME_SHADER = "brazierFlame";

/** A ray that crosses this much flame, in metres, shows it at full strength;
 *  one that grazes an edge loses up to `THICK_GAIN` of it. A ray through the
 *  root's core crosses about 0.7 m, one through a tip a few centimetres. */
const THICK_M = 0.35;
const THICK_GAIN = 0.4;

/** A float as a GLSL literal: `1` is an int there, and an int in a float
 *  expression does not compile on WebGL 1. */
const glsl = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * The flame, as a pure function of a point in the bowl and time.
 *
 * A density field, not a sprite: a teardrop most of the coals' width at the
 * root, less dense with height, with two layers of noise rising through it at 0.5-0.6 m/s
 * that carve the upper half into tongues. That rise is the pace the eye reads;
 * the old embers left the coals at 0.9 m/s and every one was a point to follow.
 * The heat ramp is the embers' one in four stops, soot red to white-hot, and
 * the tips fade by losing emission, never by turning red.
 *
 * The box is marched front to back from the face the fragment is on: the mesh
 * is neither turned nor scaled, so its local space is the bowl's, and `uEye` is
 * the camera in that space.
 */
function registerFlameShader(): void {
  if (Effect.ShadersStore[`${FLAME_SHADER}VertexShader`]) return;
  Effect.ShadersStore[`${FLAME_SHADER}VertexShader`] = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec3 vPos;
    void main(void) {
      vPos = position;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore[`${FLAME_SHADER}FragmentShader`] = `
    precision highp float;
    varying vec3 vPos;
    uniform vec3 uEye;
    uniform float uTime;
    uniform float uFlick;
    uniform float uBright;
    const float HALF_W = ${glsl(TONGUE_W / 2)};
    const float H = ${glsl(TONGUE_H)};
    const int STEPS = ${MARCH_STEPS};
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        // Turned each octave: value noise left on its grid draws stair steps.
        p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }
    vec3 ramp(float h) {
      vec3 soot = vec3(0.55, 0.10, 0.02);
      vec3 orange = vec3(1.0, 0.45, 0.10);
      vec3 yellow = vec3(1.0, 0.80, 0.42);
      vec3 white = vec3(1.0, 0.96, 0.84);
      if (h < 0.33) return mix(soot, orange, h / 0.33);
      if (h < 0.66) return mix(orange, yellow, (h - 0.33) / 0.33);
      return mix(yellow, white, (h - 0.66) / 0.34);
    }
    // How alight one point of the flame is (x), and how hot (y): xz in
    // half-widths, y in heights. The tongues are carved across the view, along
    // \`side\`, and are the same all the way along one ray: carved in 3D they
    // average out over the ray's depth and the flame melts into a ball.
    vec2 burn(vec2 xz, float y, vec2 side, float t, float sway) {
      float lat = dot(xz, side);
      float n = fbm(vec2(lat * 3.2, y * 2.8 - t * 1.6));
      float n2 = fbm(vec2(lat * 6.0 + 7.3, y * 5.0 - t * 2.4));
      vec2 s = xz + side * (-sway + (n - 0.5) * 0.5) * y;
      // Narrower at the root than a sheet was: in depth too, the foot is a disc
      // the eye sees whole, and one the coals' full width reads as a lit ball.
      float w = 0.6 * (1.0 - y * 0.85);
      float d = length(s) / max(w, 0.001);
      float dens = (1.0 - d * d) * 1.1 - y * 1.25 + (n - 0.5) * 1.3 * (0.25 + y) + (n2 - 0.5) * 0.45;
      // The root rises out of the coal bed over its first 13 cm, which from
      // above is a rounded foot across the coals, not a line.
      dens *= smoothstep(0.0, 0.12, y);
      float f = clamp(dens, 0.0, 1.0);
      return vec2(smoothstep(0.0, 0.3, f), clamp(f * 1.25 - y * 0.3, 0.0, 1.0));
    }
    void main(void) {
      // Wrapped, or the hash loses its low bits an hour into a session; the
      // pattern jumps once every ten minutes, for one frame.
      float t = mod(uTime, 600.0);
      float sway = (noise(vec2(t * 0.6, 3.1)) - 0.5) * 0.3;
      vec3 rd = normalize(vPos - uEye);
      vec2 side = normalize(vec2(-rd.z, rd.x) + vec2(1e-6, 0.0));
      // Where the ray leaves the box: the nearer of the three far faces.
      vec3 safe = mix(vec3(1e-5), rd, step(1e-5, abs(rd)));
      vec3 far = (vec3(safe.x > 0.0 ? HALF_W : -HALF_W, safe.y > 0.0 ? H : 0.0, safe.z > 0.0 ? HALF_W : -HALF_W) - vPos) / safe;
      float len = max(0.0, min(min(far.x, far.y), far.z));
      float dt = len / float(STEPS);
      // A fixed per-pixel offset into the first step, so the steps do not
      // stack into bands of the same depth.
      float j = hash(gl_FragCoord.xy);
      // The brightest point on the ray draws the flame; how much of the ray is
      // inside it lifts the core over the edges, which is the depth a sheet lacked.
      vec3 peak = vec3(0.0);
      float inside = 0.0;
      for (int i = 0; i < STEPS; i++) {
        vec3 p = vPos + rd * (dt * (float(i) + j));
        vec2 b = burn(p.xz / HALF_W, p.y / H, side, t, sway);
        // The thin edges emit less than the core, which is the only white in it.
        peak = max(peak, ramp(b.y) * b.x * (0.3 + 0.7 * b.y));
        inside += b.x;
      }
      float depth = min(1.0, inside * dt / ${glsl(THICK_M)});
      // Light, not paint: added straight onto the frame.
      gl_FragColor = vec4(peak * (${glsl(1 - THICK_GAIN)} + ${glsl(THICK_GAIN)} * depth) * uBright * uFlick, 1.0);
    }`;
}

/** One flame body: its mesh and the material its clock is set on. */
interface Tongue {
  mesh: Mesh;
  mat: ShaderMaterial;
  /** The camera in this bowl's local space. Its own vector, because the
   *  material keeps the reference it is given, not a copy. */
  eye: Vector3;
}

function buildTongue(scene: Scene, b: number): Tongue {
  const mesh = MeshBuilder.CreateBox(`${FLAME_TONGUE}${b}`, { width: TONGUE_W, height: TONGUE_H, depth: TONGUE_W }, scene);
  // Floor at the mesh's origin, which the shader's local space depends on.
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, TONGUE_H / 2, 0));
  const mat = new ShaderMaterial(`${FLAME_TONGUE}${b}-mat`, scene, FLAME_SHADER, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "uEye", "uTime", "uFlick", "uBright"],
    needAlphaBlending: true,
  });
  mat.alphaMode = Constants.ALPHA_ADD;
  // Front faces only: each is where the eye's ray enters the box, and a back
  // face would march the same flame a second time.
  mat.backFaceCulling = true;
  // Additive light: a flame that wrote depth would cut out the sparks behind it.
  // Depth TESTING stays on, so a pillar in front of the bowl still hides it.
  mat.disableDepthWrite = true;
  const eye = new Vector3(0, 10, -10);
  mat.setVector3("uEye", eye);
  mat.setFloat("uTime", 0);
  mat.setFloat("uFlick", 1);
  mat.setFloat("uBright", TONGUE_BRIGHT);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  return { mesh, mat, eye };
}

/**
 * Where along its climb an ember is, as a fraction of `EMBER_TOP` flame heights
 * over the coal bed, for `u` through its life. The inverse of a density that is
 * sparse at the coals, fullest in the body of the flame and gone above it, so a
 * pool spread evenly over `u` thins out by height without any ember carrying
 * state. Monotone in `u`: embers only ever rise.
 */
export const EMBER_TOP = 1.5;
/** Seconds a climb takes; the pool is staggered evenly across it. */
export const EMBER_LIFE = 2.4;
const EMBER_PEAK = 0.55;
const HEIGHT_LUT = 64;
const heightLut = (() => {
  const px = EMBER_PEAK / EMBER_TOP;
  const dens = (y: number) => {
    const x = y / EMBER_TOP;
    const rise = 0.12 + 0.88 * Math.sin((Math.min(x / px, 1) * Math.PI) / 2);
    const fall = x <= px ? 1 : Math.max(0, 1 - (x - px) / (1 - px)) ** 1.5;
    return rise * fall;
  };
  const n = 512;
  const cdf = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) cdf[i] = cdf[i - 1]! + dens(((i - 0.5) / n) * EMBER_TOP);
  const lut = new Float64Array(HEIGHT_LUT + 1);
  let j = 0;
  for (let i = 0; i <= HEIGHT_LUT; i++) {
    const target = (i / HEIGHT_LUT) * cdf[n]!;
    while (j < n - 1 && cdf[j + 1]! < target) j++;
    const span = cdf[j + 1]! - cdf[j]!;
    lut[i] = ((j + (span > 0 ? (target - cdf[j]!) / span : 0)) / n) * EMBER_TOP;
  }
  return lut;
})();

/** Height of an ember at `u` (0..1) of its life, in flame heights. */
export function emberHeight(u: number): number {
  const f = Math.min(Math.max(u, 0), 1) * HEIGHT_LUT;
  const i = Math.min(f | 0, HEIGHT_LUT - 1);
  return heightLut[i]! + (heightLut[i + 1]! - heightLut[i]!) * (f - i);
}

/** Life fraction of an ember born at `born`, living `life`, at clock `t`. */
export function emberLife(born: number, life: number, t: number): number {
  return (((t - born) / life) % 1 + 1) % 1;
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
let sparks: Spark[] = [];
let tongues: Tongue[] = [];

/** What `updateParticle` needs and cannot be handed: the bowls burning this
 *  frame, and the clock they burn on. */
let burning: readonly FireSpot[] = [];
let clock = 0;
/** Bowls given particles on the last update. */
let lit = BOWLS;

/**
 * Build the flames and the spark table. Call once per scene, with the lights.
 *
 * Idempotent per scene, for the same reason the light pool is: this is cheap to
 * find and expensive to duplicate.
 */
export function createFireFlames(scene: Scene): Mesh | null {
  const found = scene.getMeshByName(FLAME_MESH) as Mesh | null;
  if (found && sps) return found;
  // A mesh this module has forgotten is a fire that cannot be driven. That is a
  // scene rebuilt after a reset, and the old meshes go.
  for (const m of scene.meshes.filter((x) => x.name.startsWith(FLAME_MESH))) m.dispose();

  registerFlameShader();
  tongues = Array.from({ length: BOWLS }, (_, b) => buildTongue(scene, b));

  const system = new SolidParticleSystem(FLAME_MESH, scene, { updatable: true });
  // Eight triangles. At this camera a spark covers a few pixels, so the solid's
  // own facets are below what can be resolved. Shared corners (`flat: false`):
  // 6 vertices instead of 24, and the material is unlit.
  const proto = MeshBuilder.CreatePolyhedron("fire-ember-proto", { type: 1, size: 0.5, flat: false }, scene);
  system.addShape(proto, BOWLS * SPARKS);
  proto.dispose();
  const m = system.buildMesh();

  const mat = new StandardMaterial("fire-flame-mat", scene);
  // White, because the per-particle vertex colour carries the hue: with the
  // lights off the composition resolves to `emissiveColor * vColor.rgb`.
  mat.emissiveColor = Color3.White();
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  m.material = mat;
  // Puts the mesh in the transparent pass AND turns on the shader's
  // `alpha *= vColor.a`. Without it the sparks render opaque, in the wrong pass.
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

  sparks = [];
  for (let b = 0; b < BOWLS; b++) {
    for (let k = 0; k < SPARKS; k++) {
      sparks.push({
        born: (k / SPARKS) * EMBER_LIFE + b * 0.21,
        life: EMBER_LIFE,
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
  sparks = [];
  tongues = [];
  burning = [];
  clock = 0;
  lit = BOWLS;
}

/** How many sparks are alight, for tests. */
export function flameParticleCount(): number {
  return Math.min(burning.length, BOWLS) * SPARKS;
}

/**
 * Burn the bowls nearest the camera. Called once a frame by `updateFireLights`,
 * on that module's clock so the flame and the light it throws breathe together.
 */
export function updateFireFlames(near: readonly FireSpot[], now: number): void {
  if (!sps) return;
  burning = near;
  clock = now;
  for (let b = 0; b < BOWLS; b++) {
    const s = near[b];
    const tongue = tongues[b];
    if (!s) {
      tongue?.mesh.setEnabled(false);
      continue;
    }
    const ph = now + s.phase;
    // The same two detuned sines the light's intensity rides.
    flicker[b] = 0.72 + 0.2 * Math.sin(ph * 3.1) + 0.1 * Math.sin(ph * 1.27 + 1.7);
    if (!tongue) continue;
    tongue.mesh.position.set(s.x, TONGUE_Y, s.z);
    tongue.mesh.setEnabled(true);
    const cam = tongue.mesh.getScene().activeCamera;
    if (cam) tongue.mat.setVector3("uEye", cam.globalPosition.subtractToRef(tongue.mesh.position, tongue.eye));
    tongue.mat.setFloat("uTime", ph);
    // Half the light's swing: the body is the steady part of a fire.
    tongue.mat.setFloat("uFlick", 0.5 + 0.5 * flicker[b]!);
  }
  // Only the bowls alight now, plus any that went out since last frame so their
  // sparks get parked once. Every bowl beyond both is already parked.
  const alight = Math.min(near.length, BOWLS);
  const span = Math.max(alight, lit);
  lit = alight;
  if (span > 0) sps.setParticles(0, span * SPARKS - 1);
}

/** The flicker each burning bowl is at this frame. See `updateFireFlames`. */
const flicker: number[] = [];

/**
 * One spark, wherever it is in its life.
 *
 * A pure function of the clock, like the menu's: no particle carries state
 * between frames, so a frame can be reproduced from its timestamp alone.
 */
function updateParticle(p: SolidParticle): SolidParticle {
  const b = (p.idx / SPARKS) | 0;
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
  const t = clock;
  const q = sparks[p.idx]!;
  const u = emberLife(q.born, q.life, t);
  const y = emberHeight(u);
  // The teardrop narrows with height, so embers gather over the coals' core as
  // they climb rather than hanging at the lip.
  const lane = LIP_R * 0.9 * (1 - 0.55 * Math.min(y, 1));
  p.position.x = s.x + q.laneX * lane + q.driftX * FLAME_H * u * 0.5
    + Math.sin(u * 5 + q.sway) * FLAME_H * 0.04;
  p.position.z = s.z + q.laneZ * lane + q.driftZ * FLAME_H * u * 0.5
    + Math.cos(u * 5 + q.sway) * FLAME_H * 0.04;
  p.position.y = BASE_Y + FLAME_H * y;
  // In over the first tenth of life and out over the last third, so none pops.
  const env = Math.min(u / 0.1, 1) * Math.min((1 - u) / 0.35, 1);
  p.scaling.setAll(FLAME_H * 0.026 * q.size * (0.5 + 0.5 * env));
  // The old stream's whole ramp: white-hot at the coals, soot red at the end.
  emberColour(u, p.color!);
  p.color!.a = env * BRIGHT * 0.9 * (0.55 + 0.45 * Math.sin(t * q.twinkle + q.sway));
  return p;
}
