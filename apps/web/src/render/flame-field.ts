/**
 * The brazier fire as data and GLSL, with no engine in it: the game marches it
 * through a Babylon box in each bowl (`flames.ts`), and the menu marches the
 * same field over its painted bowls (`menu/atmos.tsx`) from a raw WebGL pass.
 * One flame, two hosts, so the menu can never drift from what the game burns.
 *
 * Units are metres in the bowl's own space: the box's floor at y = 0, centred
 * on x = z = 0, the coal face `COAL_Y` above the floor.
 */

/** Height of the flame proper, below the player's knee. */
export const FLAME_H = 0.64;
/** The marched box: wider than the lip and taller than the flame, because the
 *  shader tears the edges and tips in from it and a box cut at the flame's own
 *  size clips a tongue into a straight edge. */
export const TONGUE_W = 0.9;
export const TONGUE_H = FLAME_H * 1.3;
/** The coals sit this far above the box's floor, so they, not the box, are
 *  where the flame starts. */
export const COAL_Y = 0.03;
/** How hard the body burns into the frame. It is kept out of the bloom, so
 *  this carries all of its light. */
export const TONGUE_BRIGHT = 1.25;
/** Sparks per bowl. */
export const SPARKS = 40;

/** March steps through the box. The flame is a few dozen pixels across, so the
 *  steps are cheap; under about 16 the noise's layers show as bands. */
const MARCH_STEPS = 24;
/** A ray that crosses this much flame, in metres, shows it at full strength;
 *  one that grazes an edge loses up to `THICK_GAIN` of it. */
const THICK_M = 0.35;
const THICK_GAIN = 0.4;

/** A float as a GLSL literal: `1` is an int there, and an int in a float
 *  expression does not compile on WebGL 1. */
const glsl = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * The flame as GLSL functions, for a host's fragment shader to call
 * `marchFlame(entry, rd, t)`: `entry` is where the eye's ray enters the box,
 * `rd` its direction, both in bowl space, and `t` the clock in seconds,
 * wrapped by the caller. It returns the light to add, before brightness.
 *
 * A density field, not a sprite: a teardrop most of the coals' width at the
 * root, torn at the top by two layers of rising noise, coloured soot red to
 * white-hot, and striped with licks that face the eye.
 */
export const FLAME_GLSL = `
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
      float n = fbm(vec2(lat * 3.2, y * 2.8 - t * 1.1));
      float n2 = fbm(vec2(lat * 6.0 + 7.3, y * 5.0 - t * 1.6));
      float wave = sin(y * 8.0 - t * 3.2 + lat * 2.5) * 0.07 * (0.2 + y);
      vec2 s = xz + side * (-sway + (n - 0.5) * 0.32 + wave) * y;
      // The foot spreads across most of the coal bed and keeps that width through
      // the lower body, narrowing only toward the tip, as a campfire does.
      float w = 0.7 * (1.0 - y * y * 0.9) + 0.1 * (1.0 - smoothstep(0.0, 0.3, y));
      float d = length(s) / max(w, 0.001);
      // Density falls with height squared, so the lower body stays a full mass
      // over the coals; falling linearly it thinned into a cone from the root.
      float dens = (1.0 - d * d) * 1.1 - y * y * 1.42 + (n - 0.5) * 1.0 * (0.25 + y) + (n2 - 0.5) * 0.32;
      // The root rises out of the coal bed over its first 8 cm, which from above
      // is a rounded foot across the coals, not a line; it is full by the rim.
      dens *= smoothstep(0.0, 0.08, y);
      float f = clamp(dens, 0.0, 1.0);
      // A harder edge than a blur, and white only at the core: a broad foot hot
      // all the way out reads as a lamp from above.
      return vec2(smoothstep(0.02, 0.18, f), clamp(f * 1.25 - y * 0.3 - d * 0.45, 0.0, 1.0));
    }
    // Licks: thin bright bands rising on a travelling wave, in coordinates that
    // face the eye. Carved per sample they average out along the ray.
    float licks(vec3 p, vec3 rd, vec3 side, float t) {
      vec3 up = normalize(vec3(0.0, 1.0, 0.0) - rd * rd.y + vec3(0.0, 1e-4, 0.0));
      float u = dot(p, side) / HALF_W;
      float v = dot(p, up) / H;
      float wave = sin(v * 6.0 - t * 3.0 + u * 1.5) * 0.3;
      float r = 1.0 - abs(fbm(vec2(u * 5.0 + wave, v * 2.4 - t * 1.4)) * 2.0 - 1.0);
      return r * r;
    }
    vec3 marchFlame(vec3 entry, vec3 rd, float t) {
      float sway = (noise(vec2(t * 0.45, 3.1)) - 0.5) * 0.18;
      vec2 side = normalize(vec2(-rd.z, rd.x) + vec2(1e-6, 0.0));
      // Where the ray leaves the box: the nearer of the three far faces.
      vec3 safe = mix(vec3(1e-5), rd, step(1e-5, abs(rd)));
      vec3 far = (vec3(safe.x > 0.0 ? HALF_W : -HALF_W, safe.y > 0.0 ? H : 0.0, safe.z > 0.0 ? HALF_W : -HALF_W) - entry) / safe;
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
        vec3 p = entry + rd * (dt * (float(i) + j));
        vec2 b = burn(p.xz / HALF_W, p.y / H, side, t, sway);
        // The thin edges emit less than the core, which is the only white in it.
        peak = max(peak, ramp(b.y) * b.x * (0.3 + 0.7 * b.y));
        inside += b.x;
      }
      float depth = min(1.0, inside * dt / ${glsl(THICK_M)});
      float lick = licks(entry, rd, vec3(side.x, 0.0, side.y), t);
      return peak * (${glsl(1 - THICK_GAIN)} + ${glsl(THICK_GAIN)} * depth) * (0.45 + 0.9 * lick);
    }`;

/** The light's flicker for a bowl at clock `p` (seconds plus its phase): two
 *  detuned sines, so it never repeats on a count. The body takes half of it. */
export function fireFlicker(p: number): number {
  return 0.72 + 0.2 * Math.sin(p * 3.1) + 0.1 * Math.sin(p * 1.27 + 1.7);
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

/** One ember's fixed draw: where it climbs, how it drifts, how it twinkles. */
export interface Spark {
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

/**
 * `bowls` pools of `SPARKS`, seeded: a decorative fire that is nonetheless
 * deterministic renders the same in a captured frame twice running, which is
 * the difference between a devlog shot you can retake and one you cannot.
 */
export function sparkTable(bowls: number): Spark[] {
  let seed = 0x6d2b79f5;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const out: Spark[] = [];
  for (let b = 0; b < bowls; b++) {
    for (let k = 0; k < SPARKS; k++) {
      out.push({
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
  return out;
}

/** Radius of the lip the sparks are born across: the bowl's inner floor. */
const LIP_R = 0.3;
/** How hard a spark burns into the frame at its brightest. */
const SPARK_BRIGHT = 0.47;

/** Where a spark is: metres from the centre of the coal face, its radius, and
 *  its alpha and life fraction, which pick its colour. */
export interface SparkPose { x: number; y: number; z: number; radius: number; alpha: number; u: number }

/**
 * One spark, wherever it is in its life. A pure function of the clock: no
 * spark carries state between frames, so a frame can be reproduced from its
 * timestamp alone.
 */
export function sparkPose(q: Spark, t: number, out: SparkPose): SparkPose {
  const u = emberLife(q.born, q.life, t);
  const y = emberHeight(u);
  // The teardrop narrows with height, so embers gather over the coals' core as
  // they climb rather than hanging at the lip.
  const lane = LIP_R * 0.9 * (1 - 0.55 * Math.min(y, 1));
  out.x = q.laneX * lane + q.driftX * FLAME_H * u * 0.5 + Math.sin(u * 5 + q.sway) * FLAME_H * 0.04;
  out.z = q.laneZ * lane + q.driftZ * FLAME_H * u * 0.5 + Math.cos(u * 5 + q.sway) * FLAME_H * 0.04;
  out.y = FLAME_H * y;
  // In over the first tenth of life and out over the last third, so none pops.
  const env = Math.min(u / 0.1, 1) * Math.min((1 - u) / 0.35, 1);
  out.radius = FLAME_H * 0.013 * q.size * (0.5 + 0.5 * env);
  out.alpha = env * SPARK_BRIGHT * (0.55 + 0.45 * Math.sin(t * q.twinkle + q.sway));
  out.u = u;
  return out;
}

/** Colour of a spark at `u` of its life, 0..255: white-hot at the coals to
 *  soot red at the end. */
export function sparkRgb(u: number, out: number[] = [0, 0, 0]): number[] {
  if (u < 0.22) {
    const k = u / 0.22;
    out[0] = 255; out[1] = 246 - 60 * k; out[2] = 214 - 96 * k;
  } else if (u < 0.6) {
    const k = (u - 0.22) / 0.38;
    out[0] = 255; out[1] = 205 - 58 * k; out[2] = 112 - 74 * k;
  } else {
    const k = (u - 0.6) / 0.4;
    out[0] = 255 - 42 * k; out[1] = 147 - 54 * k; out[2] = 44 - 28 * k;
  }
  return out;
}
