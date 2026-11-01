import { Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { addMat, blendMat, Fx, fxMesh, Geo, kitPools, pointOf, rand, type Point, type Rgb } from "./core";
import { puff } from "./emit";

/**
 * Trails behind a moving body: a ribbon laid through where it has been, aged out
 * by time (never by frame count, which is a different length at 30 and 144 fps).
 * The ribbon is a cross: an upright sheet and a flat one, so it has width from
 * the game's high camera and from the side alike, and both feather to nothing at
 * their edges and their tail.
 */

/** Samples kept along a ribbon; old ones fall off the tail. */
const SAMPLES = 32;
/** Vertices per sample: three up the upright sheet, three across the flat one. */
const PER = 6;

export interface RibbonOptions {
  colour?: Rgb;
  /** Seconds a point of the trail lives. */
  life?: number;
  /** Upright sheet height (from `lift` above the point), and flat sheet width. */
  height?: number;
  width?: number;
  lift?: number;
  /** Peak alpha. */
  alpha?: number;
  /** Additive light (a dash) or alpha-blended (dust). */
  blend?: "add" | "alpha";
  /** Motes shed a unit moved. */
  motes?: number;
}

/** A trail ribbon following `target`; `stop()` lets the tail run out, then it is done. */
export function ribbonTrail(scene: Scene, target: Point, o: RibbonOptions = {}): Fx {
  const c = o.colour ?? [0.6, 0.75, 1];
  const life = o.life ?? 0.35;
  const H = o.height ?? 1.2;
  const W = o.width ?? 0.5;
  const lift = o.lift ?? 0.2;
  const peak = o.alpha ?? 0.8;
  const g = new Geo();
  for (let s = 0; s < SAMPLES; s++) {
    for (let k = 0; k < PER; k++) g.vert(0, 0, 0, [c[0], c[1], c[2], 0]);
    if (s > 0) {
      const a = (s - 1) * PER, b = s * PER;
      // Upright sheet: rows 0-1-2. Flat sheet: rows 3-4-5.
      g.quad(a, a + 1, b, b + 1);
      g.quad(a + 1, a + 2, b + 1, b + 2);
      g.quad(a + 3, a + 4, b + 3, b + 4);
      g.quad(a + 4, a + 5, b + 4, b + 5);
    }
  }
  const mat = o.blend === "alpha" ? blendMat(scene, [1, 1, 1], false) : addMat(scene);
  const mesh = fxMesh(scene, g.mesh(scene, "kit-ribbon", true), mat, o.blend !== "alpha");
  mesh.alwaysSelectAsActiveMesh = true;
  const pos = new Float32Array(SAMPLES * PER * 3);
  const col = new Float32Array(SAMPLES * PER * 4);
  // Ring buffer of samples: x, y, z, age.
  const px = new Float32Array(SAMPLES), py = new Float32Array(SAMPLES), pz = new Float32Array(SAMPLES);
  const age = new Float32Array(SAMPLES).fill(1e9);
  let head = 0;
  let count = 0;
  const now = new Vector3();
  const last = new Vector3();
  let have = false;
  const motes = o.motes ?? 0;
  let owed = 0;
  const fx = new Fx((f, dt) => {
    for (let i = 0; i < SAMPLES; i++) age[i]! += dt;
    if (!f.stopped) {
      pointOf(target, now);
      // A new sample only once the body has moved; a standing body keeps its trail ageing out.
      if (!have || now.subtract(last).lengthSquared() > 0.0025) {
        px[head] = now.x; py[head] = now.y; pz[head] = now.z; age[head] = 0;
        head = (head + 1) % SAMPLES;
        count = Math.min(SAMPLES, count + 1);
        if (have && motes > 0) {
          owed += motes * Vector3.Distance(last, now);
          for (; owed >= 1; owed--) {
            kitPools(scene).motes.emit({
              x: now.x + rand(-0.2, 0.2), y: now.y + lift + rand(0, H), z: now.z + rand(-0.2, 0.2),
              vx: rand(-0.3, 0.3), vy: rand(0.1, 0.6), vz: rand(-0.3, 0.3), drag: 1.5, life: rand(0.25, 0.5), size: 0.06, thick: 0.016,
              r: Math.min(1, c[0] * 1.3), g: Math.min(1, c[1] * 1.3), b: Math.min(1, c[2] * 1.3), a: 0.9, r1: c[0] * 0.5, g1: c[1] * 0.5, b1: c[2] * 0.5,
            });
          }
        }
        last.copyFrom(now);
        have = true;
      }
    }
    // Lay the samples newest first, so the mesh runs head to tail.
    let alive = 0;
    for (let j = 0; j < SAMPLES; j++) {
      const i = (head - 1 - Math.min(j, count - 1) + SAMPLES * 2) % SAMPLES;
      const a = j < count ? Math.max(0, 1 - age[i]! / life) : 0;
      if (a > 0) alive++;
      // Across the trail on the floor: perpendicular to the way it ran here.
      const n = (head - 1 - Math.min(j + 1, count - 1) + SAMPLES * 2) % SAMPLES;
      const p = (head - 1 - Math.max(0, Math.min(j - 1, count - 1)) + SAMPLES * 2) % SAMPLES;
      let dx = px[p]! - px[n]!, dz = pz[p]! - pz[n]!;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      const w = (W / 2) * (0.4 + 0.6 * a);
      const x = px[i]!, y = py[i]!, z = pz[i]!;
      const v = j * PER * 3;
      pos.set([x, y + lift, z, x, y + lift + H * 0.5, z, x, y + lift + H, z], v);
      pos.set([x - dz * w, y + lift + H * 0.35, z + dx * w, x, y + lift + H * 0.35, z, x + dz * w, y + lift + H * 0.35, z - dx * w], v + 9);
      const k = peak * a ** 1.5 * f.fade;
      const vc = j * PER * 4;
      for (let r = 0; r < PER; r++) {
        // Bright along the middle row of each sheet, gone at its edges.
        const mid = r === 1 || r === 4 ? 1 : 0;
        col[vc + r * 4] = Math.min(1, c[0] * (1 + 0.5 * mid * a));
        col[vc + r * 4 + 1] = Math.min(1, c[1] * (1 + 0.5 * mid * a));
        col[vc + r * 4 + 2] = Math.min(1, c[2] * (1 + 0.5 * mid * a));
        col[vc + r * 4 + 3] = k * mid;
      }
    }
    mesh.updateVerticesData("position", pos);
    mesh.updateVerticesData("color", col);
    return !f.stopped || alive > 0;
  }, 1e9);
  fx.own(mesh);
  return fx;
}

export interface DashOptions extends RibbonOptions {}

/** A dash's streak: a bright, short-lived ribbon and motes shed along it. */
export function dashStreak(scene: Scene, target: Point, o: DashOptions = {}): Fx {
  return ribbonTrail(scene, target, { colour: [0.6, 0.78, 1], life: 0.3, height: 1.3, width: 0.7, motes: 2.5, ...o });
}

export interface LeapOptions extends RibbonOptions {
  /** Dust kicked off the floor at take-off. */
  dust?: number;
}

/** A leap's arc: a faint dusty ribbon following the body through the air, and dust kicked at take-off. */
export function leapArcTrail(scene: Scene, target: Point, o: LeapOptions = {}): Fx {
  const at = pointOf(target, new Vector3());
  for (let i = 0; i < (o.dust ?? 8); i++) puff(scene, at.x, at.y, at.z, { size: 0.7, drift: rand(1.5, 3), rise: 0.5 });
  return ribbonTrail(scene, target, { colour: [0.9, 0.8, 0.62], life: 0.45, height: 0.9, width: 0.6, lift: 0.4, alpha: 0.5, motes: 1, ...o });
}
