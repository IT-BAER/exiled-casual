import { Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import { addMat, clamp01, cloneOf, easeOut, easeOutInv, Fx, fxMesh, Geo, kitFlash, kitPools, rand, rgba, TAU, template, type Rgb } from "./core";
import { core, embers } from "./emit";
import { scorch, shockRing } from "./ground";

/**
 * Fire on the ground: a nova whose ring is a wall of flame tongues racing out,
 * and the small burning patches a fiery dash leaves behind. The flame is lathed
 * geometry whose tongue heights are re-rolled every frame, so it licks; it is
 * hot yellow at the root, red and gone at the tips.
 */

export const FIRE: Rgb = [1, 0.45, 0.1];
const HOT: Rgb = [1, 0.9, 0.6];

export interface FireNovaOptions {
  radius?: number;
  duration?: number;
  /** Root and tip colours of the flame wall. */
  colour?: Rgb;
  /** Tongue count round the wall, and its height. */
  tongues?: number;
  height?: number;
  embers?: number;
  flash?: number;
}

/** A ring of flame tongues racing out from `at`, with a heat glow behind it, embers in its wake and a scorch. */
export function fireNova(scene: Scene, at: Vector3, o: FireNovaOptions = {}): Fx {
  const R = o.radius ?? 4;
  const dur = o.duration ?? 0.5;
  const c = o.colour ?? FIRE;
  const T = o.tongues ?? 28;
  const H = o.height ?? 0.9;
  const SEGS = T * 3;
  // A flame wall: root hot and opaque, mid in the fire colour, the tip ragged and gone.
  const profile = [
    { r: 0.96, y: 0, c: rgba(HOT, 0.0) },
    { r: 0.985, y: 0.02, c: rgba(HOT, 0.95) },
    { r: 1.0, y: 0.35, c: rgba(c, 0.7, 1.2) },
    { r: 1.01, y: 1, c: rgba(c, 0, 0.6) },
  ];
  const g = new Geo();
  g.lathe(profile, SEGS);
  const wall = fxMesh(scene, g.mesh(scene, "kit-nova-wall", true), addMat(scene, [1, 1, 1], true));
  const unit = Float32Array.from(wall.getVerticesData("position")!);
  const laid = new Float32Array(unit.length);
  const rows = profile.length;
  const phase = Array.from({ length: T }, () => Math.random() * TAU);
  // The heat glow inside the ring: the shimmer's stand-in, a soft additive floor disc.
  const heat = new Geo();
  heat.lathe([
    { r: 0, y: 0, c: rgba(c, 0.15) },
    { r: 0.8, y: 0, c: rgba(c, 0.4, 1.2) },
    { r: 1, y: 0, c: rgba(c, 0) },
  ], 48);
  const glow = fxMesh(scene, heat.mesh(scene, "kit-nova-heat"), addMat(scene));
  for (const m of [wall, glow]) m.position.set(at.x, at.y + 0.02, at.z);
  const fx = new Fx((f) => {
    const t = f.age / dur;
    if (t >= 1) return false;
    const r = R * (0.1 + 0.9 * easeOut(t));
    const h = H * (0.6 + 0.4 * Math.sin(Math.min(1, t * 2) * Math.PI * 0.5)) * (1 - 0.6 * t);
    // Re-roll every tongue's height: it licks instead of standing as a crown.
    for (let s = 0; s <= SEGS; s++) {
      const k = (s % 3) / 3; // 0 at a tongue's centre column
      const tongue = phase[Math.floor(s / 3) % T]!;
      const lick = (0.55 + 0.45 * Math.sin(f.age * 31 + tongue)) * (k === 0 ? 1 : 0.45);
      for (let row = 0; row < rows; row++) {
        const v = (s * rows + row) * 3;
        laid[v] = unit[v]! * r;
        laid[v + 2] = unit[v + 2]! * r;
        laid[v + 1] = row === rows - 1 ? unit[v + 1]! * h * lick : unit[v + 1]! * h;
      }
    }
    wall.updateVerticesData("position", laid);
    wall.refreshBoundingInfo();
    wall.visibility = 1 - t ** 2;
    glow.scaling.set(r, 1, r);
    glow.visibility = (1 - t) * 0.9;
    return true;
  });
  fx.own(wall);
  fx.own(glow);
  kitFlash(scene, at, o.flash ?? 0.9);
  core(scene, new Vector3(at.x, at.y + 0.5, at.z), 1.4, HOT, c, 0.18);
  // Embers lift where the wall passes, so the ring leaves a wake of sparks.
  const n = o.embers ?? 40;
  const pools = kitPools(scene);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const d = R * rand(0.3, 1);
    pools.shards.emit({
      x: at.x + Math.sin(a) * d, y: at.y + 0.1, z: at.z + Math.cos(a) * d,
      vx: Math.sin(a) * 1.2, vy: rand(1, 3), vz: Math.cos(a) * 1.2, gravity: -1.5, drag: 1,
      life: rand(0.4, 0.9), delay: easeOutInv(d / R) * dur, size: 0.09, thick: 0.018, stretch: 0.05,
      r: HOT[0], g: HOT[1], b: HOT[2], a: 1, r1: c[0] * 0.8, g1: c[1] * 0.3, b1: 0.02,
    });
  }
  fx.child(shockRing(scene, at, { radius: R * 1.05, duration: dur, colour: c, lip: 0, width: 0.18, dust: 0, flash: 0, floorFlash: false }));
  fx.child(scorch(scene, at, { radius: R * 0.55, hold: 1.2, fade: 1.2, alpha: 0.4 }));
  return fx;
}

function tongueTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `flame-tongues-${c.join("_")}`, () => {
    // Four teardrop tongues in a loose cluster, lathed so they are round from any angle.
    const g = new Geo();
    const spots = [[0, 0, 1], [0.32, 0.12, 0.7], [-0.25, 0.28, 0.6], [0.05, -0.33, 0.75]] as const;
    for (const [x, z, s] of spots) {
      g.lathe([
        { r: 0.13 * s, y: 0, c: rgba(HOT, 0.9) },
        { r: 0.16 * s, y: 0.12 * s, c: rgba(HOT, 0.85) },
        { r: 0.12 * s, y: 0.35 * s, c: rgba(c, 0.7, 1.1) },
        { r: 0.05 * s, y: 0.58 * s, c: rgba(c, 0.3, 0.8) },
        { r: 0, y: 0.75 * s, c: rgba(c, 0) },
      ], 8, 0, TAU, { cx: x, cz: z });
    }
    return fxMesh(scene, g.mesh(scene, "kit-flame-tongues"), addMat(scene, [1, 1, 1], true));
  });
}

export interface FlamePatchOptions {
  radius?: number;
  /** Seconds it burns before guttering out over `fade`. */
  duration?: number;
  fade?: number;
  colour?: Rgb;
  /** Embers a second. */
  embers?: number;
}

/** A small burning patch on the floor (a fiery dash's trail): licking tongues, a glowing scorch and rising embers. */
export function flameTrailPatch(scene: Scene, at: Vector3, o: FlamePatchOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const dur = o.duration ?? 2;
  const fadeS = o.fade ?? 0.5;
  const c = o.colour ?? FIRE;
  const tongues = cloneOf(scene, tongueTemplate(scene, c), "kit-flame-patch");
  tongues.position.set(at.x, at.y, at.z);
  tongues.rotation.y = Math.random() * TAU;
  const seed = Math.random() * 10;
  const rate = o.embers ?? 8;
  let owed = 0;
  const fx = new Fx((f, dt) => {
    const life = f.age < dur ? 1 : clamp01(1 - (f.age - dur) / fadeS);
    const lick = 0.8 + 0.25 * Math.sin(f.age * 23 + seed) + 0.12 * Math.sin(f.age * 41 + seed * 2);
    const grow = clamp01(f.age / 0.12);
    tongues.scaling.set(R * 1.6 * grow, R * 1.6 * lick * life * grow, R * 1.6 * grow);
    tongues.rotation.z = 0.08 * Math.sin(f.age * 7 + seed);
    tongues.visibility = life;
    if (life > 0.2) {
      owed += rate * dt;
      if (owed >= 1) {
        embers(scene, at, Math.floor(owed), HOT, c, { radius: R * 0.7, rise: [0.6, 1.5], life: [0.4, 0.8], motes: true });
        owed -= Math.floor(owed);
      }
    }
    return f.age < dur + fadeS;
  });
  fx.own(tongues);
  fx.child(scorch(scene, at, { radius: R * 1.3, glow: c, hold: dur, fade: fadeS + 0.8, alpha: 0.45 }));
  return fx;
}
