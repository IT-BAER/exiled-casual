import { Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import {
  addMat, blendMat, clamp01, cloneOf, easeOut, easeOutInv, Fx, fxMesh, Geo, kitFlash, kitPools, ragged, rand, rgba, TAU, template,
  type Rgb,
} from "./core";
import { throwChunks, type ChunkKind } from "./chunks";
import { core, DUST, puff, sparks } from "./emit";

/**
 * Floor primitives: the expanding shock ring, the cone of ground force, the
 * cracking burst, the glowing fissure, the scorch left behind and the landing.
 * Each is a stack of parts arriving together (inside-map-battle.webp): a front
 * that stands UP off the floor so it reads without bloom, a light on the floor,
 * and solids or dust thrown by it.
 */

/** Just over the floor plane, under the dust: never fights the floor for depth. */
const FLOOR_LIFT = 0.02;

export interface ShockRingOptions {
  /** Reach in world units, and seconds to get there. */
  radius?: number;
  duration?: number;
  colour?: Rgb;
  /** Glowing band width as a share of the radius: the soft inner glow behind the front. */
  width?: number;
  /** Height of the standing lip at the front, 0 for none. */
  lip?: number;
  /** Dust puffs kicked up where the front passes. */
  dust?: number;
  dustColour?: Rgb;
  /** Shared-flash level, and the bright floor disc under the start. */
  flash?: number;
  floorFlash?: boolean;
  delay?: number;
  /** A wedge instead of a ring: centred on `yaw` (0 = +Z), `half` radians each side. */
  arc?: { yaw: number; half: number };
}

function bandTemplate(scene: Scene, c: Rgb, width: number, half: number): Mesh {
  return template(scene, `ring-band-${c.join("_")}-${width.toFixed(2)}-${half.toFixed(2)}`, () => {
    const g = new Geo();
    g.lathe([
      { r: 1 - width, y: 0, c: rgba(c, 0) },
      { r: 1 - width * 0.4, y: 0, c: rgba(c, 0.3) },
      { r: 0.975, y: 0, c: rgba(c, 0.85) },
      { r: 1, y: 0, c: rgba(c, 1, 1.5) },
      { r: 1.035, y: 0, c: rgba(c, 0) },
    ], half >= Math.PI ? 64 : Math.max(8, Math.ceil(32 * half / Math.PI)), -half, half);
    return fxMesh(scene, g.mesh(scene, "kit-ring-band"), addMat(scene));
  });
}

function lipTemplate(scene: Scene, c: Rgb, half: number): Mesh {
  return template(scene, `ring-lip-${c.join("_")}-${half.toFixed(2)}`, () => {
    const g = new Geo();
    // A thin wall of light at the front, fading up: the silhouette that carries it with bloom off.
    g.lathe([
      { r: 0.97, y: 0, c: rgba(c, 0.9, 1.4) },
      { r: 0.99, y: 0.55, c: rgba(c, 0.45) },
      { r: 1.0, y: 1, c: rgba(c, 0) },
    ], half >= Math.PI ? 64 : Math.max(8, Math.ceil(32 * half / Math.PI)), -half, half);
    return fxMesh(scene, g.mesh(scene, "kit-ring-lip"), addMat(scene));
  });
}

function discTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `floor-disc-${c.join("_")}`, () => {
    const g = new Geo();
    g.lathe([
      { r: 0, y: 0, c: rgba(c, 0.85, 1.5) },
      { r: 0.45, y: 0, c: rgba(c, 0.4) },
      { r: 1, y: 0, c: rgba(c, 0) },
    ], 40);
    return fxMesh(scene, g.mesh(scene, "kit-floor-disc"), addMat(scene));
  });
}

/** An expanding ring of force on the floor: soft glowing band, a standing lip at its front, dust where it passes. */
export function shockRing(scene: Scene, at: Vector3, o: ShockRingOptions = {}): Fx {
  const R = o.radius ?? 3;
  const dur = o.duration ?? 0.45;
  const c = o.colour ?? [1, 0.6, 0.25];
  const half = o.arc?.half ?? Math.PI;
  const yaw = o.arc?.yaw ?? 0;
  const delay = o.delay ?? 0;
  const lipH = o.lip ?? 0.35;
  const fx = new Fx((f) => {
    const t = (f.age - delay) / dur;
    const on = t >= 0 && t < 1;
    for (const m of parts) m.setEnabled(on);
    if (t < 0) return true;
    if (!on) return false;
    if (!fired) {
      fired = true;
      if (o.flash !== 0) kitFlash(scene, at, o.flash ?? 0.5, c);
    }
    const r = R * (0.12 + 0.88 * easeOut(t));
    band.scaling.set(r, 1, r);
    band.visibility = (1 - t) ** 1.3;
    if (lip) {
      lip.scaling.set(r, lipH * (1 - 0.7 * t), r);
      lip.visibility = (1 - t) ** 1.1;
    }
    if (disc) {
      const k = clamp01(t / 0.45);
      disc.scaling.set(R * 0.55, 1, R * 0.55);
      disc.visibility = (1 - k) ** 2;
    }
    return true;
  });
  let fired = false;
  const band = fx.own(cloneOf(scene, bandTemplate(scene, c, o.width ?? 0.35, half), "kit-shock-band"));
  const lip = lipH > 0 ? fx.own(cloneOf(scene, lipTemplate(scene, c, half), "kit-shock-lip")) : null;
  const disc = o.floorFlash === false ? null : fx.own(cloneOf(scene, discTemplate(scene, c), "kit-shock-disc"));
  const parts = [band, lip, disc].filter((m): m is Mesh => m !== null);
  for (const m of parts) {
    m.position.set(at.x, at.y + FLOOR_LIFT, at.z);
    m.rotation.y = yaw;
    m.setEnabled(false);
  }
  const dust = o.dust ?? 10;
  for (let i = 0; i < dust; i++) {
    const a = yaw + (half >= Math.PI ? Math.random() * TAU : rand(-half, half));
    const d = R * rand(0.5, 1);
    puff(scene, at.x + Math.sin(a) * d, at.y, at.z + Math.cos(a) * d, {
      size: 0.6 + 0.25 * d, delay: delay + easeOutInv(d / R) * dur, drift: 1.2, yaw: a, colour: o.dustColour ?? DUST,
    });
  }
  return fx;
}

export interface ConeWaveOptions {
  length?: number;
  /** Half-angle of the wedge, radians. */
  half?: number;
  duration?: number;
  colour?: Rgb;
  /** Rock chunks thrown along the wedge, and dust rows. */
  chunks?: number;
  dustRows?: number;
  kind?: ChunkKind;
  flash?: number;
  lip?: number;
}

/** A wedge of ground force running out along (dirX, dirZ): a standing front, chunks thrown up as it passes, dust in rows. */
export function coneWave(scene: Scene, at: Vector3, dirX: number, dirZ: number, o: ConeWaveOptions = {}): Fx {
  const L = o.length ?? 5;
  const half = o.half ?? 0.55;
  const dur = o.duration ?? 0.4;
  const yaw = Math.atan2(dirX, dirZ);
  const fx = new Fx(() => false);
  fx.child(shockRing(scene, at, {
    radius: L, duration: dur, colour: o.colour ?? [1, 0.68, 0.38], width: 0.5, lip: o.lip ?? 0.55, dust: 0,
    flash: o.flash ?? 0.6, arc: { yaw, half },
  }));
  throwChunks(scene, o.kind ?? "rock", at, {
    count: o.chunks ?? 20, yaw, cone: half, spread: L * 0.9, speed: [0.6, 2.2], up: [3, 6.5],
    delayAt: (d) => easeOutInv(d / L) * dur,
  });
  const rows = o.dustRows ?? 5;
  for (let row = 1; row <= rows; row++) {
    const d = (row / rows) * L;
    for (let i = 0; i < 3; i++) {
      const a = yaw + ((i + 0.5) / 3 * 2 - 1) * half;
      puff(scene, at.x + Math.sin(a) * d, at.y, at.z + Math.cos(a) * d, {
        size: 0.8 + 0.2 * row, delay: easeOutInv(d / L) * dur, drift: 1.3, yaw: a,
      });
    }
  }
  return fx;
}

export interface FissureOptions {
  radius?: number;
  branches?: number;
  /** Seam colour; the crack itself is dark earth. */
  colour?: Rgb;
  /** Seconds to spread, to hold glowing, and to fade. */
  grow?: number;
  hold?: number;
  fade?: number;
  /** Bias the cracks round `yaw` within `spread` radians each side (omit for all round). */
  yaw?: number;
  spread?: number;
  /** Width of the main fissures at the root. */
  width?: number;
  /** Seam embers a second while it glows. */
  embers?: number;
}

const CRACK_DARK: Rgb = [0.05, 0.03, 0.017];

/** Jagged cracks spreading over the floor from `at`: a dark break with a glowing seam, then fading out. */
export function fissure(scene: Scene, at: Vector3, o: FissureOptions = {}): Fx {
  const R = o.radius ?? 2.2;
  const B = o.branches ?? 6;
  const c = o.colour ?? [1, 0.45, 0.12];
  const grow = o.grow ?? 0.25, hold = o.hold ?? 1.2, fadeS = o.fade ?? 1.2;
  const width = o.width ?? 0.11;
  const dark = new Geo();
  const seam = new Geo();
  const lines: number[] = [];
  const branch = (x: number, z: number, angle: number, reach: number, w: number, fork: boolean) => {
    const pts: [number, number, number, number][] = [[x, z, w / 2, 0.7]];
    const glow: [number, number, number, number][] = [[x, z, w * 0.18, 1]];
    let run = 0;
    let side = Math.random() < 0.5 ? -1 : 1;
    while (run < reach) {
      const a = angle + side * rand(0.15, 0.55);
      side = -side;
      const step = rand(0.1, 0.25) * Math.max(0.6, R / 2.2);
      const nx = x + Math.sin(a) * step, nz = z + Math.cos(a) * step;
      lines.push(x, z, nx, nz);
      x = nx; z = nz;
      run += step;
      const t = Math.min(1, run / reach);
      pts.push([x, z, (w * (1 - t)) / 2 + 0.004, 0.7 * (1 - 0.5 * t)]);
      glow.push([x, z, w * 0.18 * (1 - t) + 0.006, 1 - 0.6 * t]);
      if (fork && Math.random() < 0.2) branch(x, z, a + (Math.random() < 0.5 ? -0.8 : 0.8), (reach - run) * 0.45, w * (1 - t) * 0.7, false);
    }
    dark.strip(pts, CRACK_DARK);
    seam.strip(glow, c, 0.004);
  };
  for (let b = 0; b < B; b++) {
    const angle = o.yaw === undefined
      ? (b / B) * TAU + rand(-0.3, 0.3)
      : o.yaw + ((b + 0.5) / B * 2 - 1) * (o.spread ?? 1) + rand(-0.15, 0.15);
    const r = rand(0.04, 0.15);
    branch(Math.sin(angle) * r, Math.cos(angle) * r, angle, R * rand(0.55, 1), width, true);
  }
  const darkMesh = fxMesh(scene, dark.mesh(scene, "kit-fissure-dark", true), blendMat(scene), false);
  const seamMesh = fxMesh(scene, seam.mesh(scene, "kit-fissure-seam", true), addMat(scene));
  // Each vertex's distance from the centre, and its full alpha: the front reveals it.
  const reveal = [darkMesh, seamMesh].map((m) => {
    const p = m.getVerticesData("position")!;
    const col = m.getVerticesData("color")!;
    const d = new Float32Array(p.length / 3);
    for (let i = 0; i < d.length; i++) d[i] = Math.hypot(p[i * 3]!, p[i * 3 + 2]!);
    return { m, d, base: Float32Array.from(col), col: Float32Array.from(col) };
  });
  const rate = o.embers ?? 10 * R;
  let owed = 0;
  const fx = new Fx((f, dt) => {
    const front = R * 1.15 * easeOut(f.age / grow);
    if (f.age <= grow + dt) {
      for (const r of reveal) {
        for (let i = 0; i < r.d.length; i++) r.col[i * 4 + 3] = r.base[i * 4 + 3]! * clamp01((front - r.d[i]!) / 0.2);
        r.m.updateVerticesData("color", r.col);
      }
    }
    const k = f.age - grow - hold;
    // A slow heat breathing in the seam, fading after the hold.
    seamMesh.visibility = (0.8 + 0.2 * Math.sin(f.age * 9)) * (k <= 0 ? 1 : clamp01(1 - k / (fadeS * 0.7)));
    darkMesh.visibility = k <= 0 ? 1 : clamp01(1 - k / fadeS);
    if (k < 0 && lines.length > 0) {
      owed += rate * dt;
      for (; owed >= 1; owed--) {
        const s = Math.floor(Math.random() * (lines.length / 4)) * 4;
        const u = Math.random();
        const x = lines[s]! + (lines[s + 2]! - lines[s]!) * u, z = lines[s + 1]! + (lines[s + 3]! - lines[s + 1]!) * u;
        if (Math.hypot(x, z) > front) continue;
        kitPools(scene).motes.emit({
          x: at.x + x, y: at.y + 0.03, z: at.z + z, vx: rand(-0.1, 0.1), vy: rand(0.5, 1.2), vz: rand(-0.1, 0.1),
          gravity: 0.4, drag: 0.5, life: rand(0.5, 0.9), size: 0.05, thick: 0.014, stretch: 0.04,
          r: 1, g: Math.min(1, c[1] * 1.6), b: Math.min(1, c[2] * 2), a: 0.9, r1: c[0] * 0.6, g1: c[1] * 0.3, b1: c[2] * 0.2,
        });
      }
    }
    return f.age < grow + hold + fadeS;
  });
  fx.own(darkMesh);
  fx.own(seamMesh);
  for (const m of [darkMesh, seamMesh]) {
    m.position.set(at.x, at.y + FLOOR_LIFT - 0.002, at.z);
    // Mirrored half the time: one generator reads as many breaks.
    if (Math.random() < 0.5) m.scaling.x = -1;
  }
  seamMesh.position.y += 0.002;
  return fx;
}

export interface ScorchOptions {
  radius?: number;
  /** Seconds at full strength, then fading. */
  hold?: number;
  fade?: number;
  /** Darkness of the burn (alpha of near-black). */
  alpha?: number;
  /** A glowing ember fill that cools faster than the burn, or omit for none. */
  glow?: Rgb;
}

/** A ragged burnt patch left on the floor: dark scorch, optionally still glowing, fading out. */
export function scorch(scene: Scene, at: Vector3, o: ScorchOptions = {}): Fx {
  const R = o.radius ?? 1.4;
  const hold = o.hold ?? 2, fadeS = o.fade ?? 1.5;
  const edge = ragged(0.18);
  const g = new Geo();
  const a = o.alpha ?? 0.55;
  g.lathe([
    { r: 0, y: 0, c: [0.03, 0.02, 0.015, a] },
    { r: 0.6, y: 0, c: [0.04, 0.025, 0.018, a * 0.85] },
    { r: 1, y: 0, c: [0.05, 0.035, 0.025, 0] },
  ], 40, 0, TAU, { jitter: (yaw, k) => (k === 0 ? 1 : edge(yaw)) });
  const burn = fxMesh(scene, g.mesh(scene, "kit-scorch"), blendMat(scene), false);
  let ember: Mesh | null = null;
  if (o.glow) {
    const e = new Geo();
    const inner = ragged(0.3);
    e.lathe([
      { r: 0, y: 0, c: rgba(o.glow, 0.7, 1.3) },
      { r: 0.5, y: 0, c: rgba(o.glow, 0.45) },
      { r: 0.85, y: 0, c: rgba(o.glow, 0) },
    ], 40, 0, TAU, { jitter: (yaw, k) => (k === 0 ? 1 : inner(yaw)) });
    ember = fxMesh(scene, e.mesh(scene, "kit-scorch-ember"), addMat(scene));
  }
  const fx = new Fx((f) => {
    const k = f.age - hold;
    burn.visibility = k <= 0 ? 1 : clamp01(1 - k / fadeS);
    if (ember) ember.visibility = clamp01(1 - f.age / (hold * 0.8)) * (0.85 + 0.15 * Math.sin(f.age * 11));
    return f.age < hold + fadeS;
  });
  fx.own(burn);
  if (ember) fx.own(ember);
  burn.position.set(at.x, at.y + FLOOR_LIFT - 0.006, at.z);
  burn.scaling.set(R, 1, R);
  burn.rotation.y = Math.random() * TAU;
  ember?.position.set(at.x, at.y + FLOOR_LIFT - 0.004, at.z);
  ember?.scaling.set(R, 1, R);
  return fx;
}

export interface GroundBurstOptions {
  radius?: number;
  /** Heat in the core, the sparks and the fissure seam. */
  colour?: Rgb;
  kind?: ChunkKind;
  chunks?: number;
  dust?: number;
  fissure?: boolean;
  ring?: boolean;
  sparks?: number;
  flash?: number;
}

/** The floor breaking open under a hit: chunks thrown up and falling, a hot core, sparks, a dirt column, a ring and a fissure. */
export function groundBurst(scene: Scene, at: Vector3, o: GroundBurstOptions = {}): Fx {
  const R = o.radius ?? 2;
  const c = o.colour ?? [1, 0.5, 0.15];
  const hot: Rgb = [1, 0.92, 0.7];
  const fx = new Fx(() => false);
  kitFlash(scene, at, o.flash ?? 0.8, c);
  throwChunks(scene, o.kind ?? "rock", at, { count: o.chunks ?? 22, speed: [0.8 * R, 2 * R], up: [3.5, 7], spread: R * 0.25 });
  core(scene, new Vector3(at.x, at.y + 0.3, at.z), R * 0.9, hot, c, 0.2);
  sparks(scene, new Vector3(at.x, at.y + 0.15, at.z), o.sparks ?? 16, hot, c, { speed: [2, 6], up: [0.6, 1.6], gravity: -10 });
  // A column of dirt goes up out of the crater, darker than the dust the ring lifts.
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * TAU;
    kitPools(scene).smoke.emit({
      x: at.x + Math.sin(a) * 0.2, y: at.y + 0.15, z: at.z + Math.cos(a) * 0.2,
      vx: Math.sin(a) * rand(0.3, 1), vy: rand(2.2, 3.6), vz: Math.cos(a) * rand(0.3, 1),
      gravity: -4, drag: 2, life: rand(0.7, 1.1), delay: i * 0.015, size: 0.35 * R / 2, sizeEnd: 1.3 * R / 2,
      r: 0.34, g: 0.28, b: 0.21, a: 0.5, r1: 0.42, g1: 0.37, b1: 0.31,
    });
  }
  if (o.ring !== false) fx.child(shockRing(scene, at, { radius: R * 1.2, duration: 0.35, colour: c, lip: 0.4, dust: o.dust ?? 10, flash: 0 }));
  if (o.fissure !== false) fx.child(fissure(scene, at, { radius: R * 1.1, colour: c, hold: 0.9 }));
  return fx;
}

export interface LandingImpactOptions {
  radius?: number;
  /** The dust and ring colour; `glow` adds a hot fissure for a fiery landing. */
  colour?: Rgb;
  glow?: Rgb;
  chunks?: number;
  dust?: number;
  flash?: number;
}

/** A body landing hard: a dust ring blown flat out, rubble thrown, a standing ring front, the floor lit. */
export function landingImpact(scene: Scene, at: Vector3, o: LandingImpactOptions = {}): Fx {
  const R = o.radius ?? 2.2;
  const c = o.colour ?? [0.85, 0.72, 0.52];
  const fx = new Fx(() => false);
  kitFlash(scene, at, o.flash ?? 0.6);
  fx.child(shockRing(scene, at, { radius: R, duration: 0.32, colour: c, lip: 0.6, width: 0.25, dust: 0, flash: 0, floorFlash: !!o.glow }));
  const n = o.dust ?? 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.15, 0.15);
    // Blown flat and fast: a landing pushes air out, it does not lift it.
    puff(scene, at.x, at.y, at.z, { size: 0.7, drift: rand(3.5, 5.5), rise: rand(0.1, 0.4), yaw: a, life: rand(0.5, 0.8), alpha: 0.38 });
  }
  throwChunks(scene, "rock", at, { count: o.chunks ?? 14, speed: [1, 3.2], up: [2, 4.5], size: [0.05, 0.17] });
  if (o.glow) fx.child(fissure(scene, at, { radius: R * 0.75, colour: o.glow, branches: 5, hold: 0.6 }));
  return fx;
}
