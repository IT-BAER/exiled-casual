import { MeshBuilder, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene, TransformNode } from "@babylonjs/core";
import {
  addMat, bindToNode, blendMat, clamp01, cloneOf, Fx, fxMesh, Geo, kitPools, litMat, rand, rgba, solidMat, TAU, template,
  type Rgb,
} from "./core";
import { pulseRingTemplate } from "./buffs";
import { sparks } from "./emit";

/**
 * Status looks on a monster: frozen, smouldering, stunned, marked, taunted and
 * cursed. Many run at once on a pack for seconds at a time, so each is one or
 * two clones of a per-scene template (shared vertex buffers, shared material)
 * moved each frame, plus a trickle of pooled motes; nothing is rebuilt. Each
 * follows the node's position (never parented: a monster's turn and scale must
 * not spin or squash it) and disposes itself if the node is disposed.
 */

export interface StatusOptions {
  /** The monster's body radius and height (its head is at `height`). */
  radius?: number;
  height?: number;
  colour?: Rgb;
}

const sAt = new Vector3();

function statusFx(node: TransformNode, tick: (fx: Fx, dt: number, at: Vector3) => void): Fx {
  const fx = new Fx((f, dt) => {
    tick(f, dt, sAt.copyFrom(node.getAbsolutePosition()));
    return true;
  }, 0.3);
  bindToNode(fx, node);
  return fx;
}

/** Fade in over a quarter second, out on `stop()`. */
const presence = (f: Fx) => clamp01(f.age / 0.25) * f.fade;

function frostCollar(scene: Scene): Mesh {
  return template(scene, "frost-collar", () => {
    // Ice spikes round the feet leaning out: the crust that says "frozen" with no colour at all.
    const g = new Geo();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (i % 2) * 0.2;
      const r = 0.85 + (i % 3) * 0.12;
      const h = 0.35 + ((i * 7) % 5) * 0.08;
      const lean = 0.25;
      const bx = Math.sin(a) * r, bz = Math.cos(a) * r;
      const tx = Math.sin(a) * (r + lean), tz = Math.cos(a) * (r + lean);
      const w = 0.07;
      const base: number[] = [];
      for (let k = 0; k < 4; k++) {
        const t = (k / 4) * TAU + a;
        base.push(g.vert(bx + Math.sin(t) * w, 0, bz + Math.cos(t) * w, [1, 1, 1, 1]));
      }
      const tip = g.vert(tx, h, tz, [1, 1, 1, 1]);
      for (let k = 0; k < 4; k++) g.idx.push(base[k]!, base[(k + 1) % 4]!, tip);
    }
    const m = g.mesh(scene, "kit-frost-collar");
    m.convertToFlatShadedMesh();
    m.material = litMat(scene, "ice", [0.62, 0.82, 0.95], [0.25, 0.45, 0.65], 0.15, 0.88);
    m.hasVertexAlpha = false;
    return m;
  });
}

function frostShell(scene: Scene, c: Rgb): Mesh {
  return template(scene, `frost-shell-${c.join("_")}`, () => {
    const m = MeshBuilder.CreateSphere("kit-frost-shell", { diameter: 1, segments: 10 }, scene);
    return fxMesh(scene, m, addMat(scene, c, true));
  });
}

/** Frozen: a pale blue shell over the body, ice spikes round its feet, cold mist and ice motes drifting down. */
export function frostCrust(scene: Scene, node: TransformNode, o: StatusOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const c = o.colour ?? [0.55, 0.8, 1];
  const shell = cloneOf(scene, frostShell(scene, c), "kit-frost-shell");
  const collar = cloneOf(scene, frostCollar(scene), "kit-frost-collar");
  let mist = 0, motes = 0;
  const pools = kitPools(scene);
  const fx = statusFx(node, (f, dt, at) => {
    const k = presence(f);
    shell.position.set(at.x, at.y + H * 0.5, at.z);
    shell.scaling.set(R * 2.4, H * 1.15, R * 2.4);
    shell.visibility = k * (0.24 + 0.04 * Math.sin(f.age * 5));
    collar.position.set(at.x, at.y, at.z);
    // The crust grows up out of the floor as it takes.
    collar.scaling.set(R, R * k, R);
    mist += dt * 2.5 * k;
    for (; mist >= 1; mist--) {
      const a = Math.random() * TAU;
      pools.smoke.emit({
        x: at.x + Math.sin(a) * R, y: at.y + 0.1, z: at.z + Math.cos(a) * R,
        vx: Math.sin(a) * 0.3, vy: 0.05, vz: Math.cos(a) * 0.3, drag: 1, life: rand(1, 1.5), size: 0.4, sizeEnd: 0.9,
        r: 0.72, g: 0.85, b: 0.95, a: 0.22, r1: 0.6, g1: 0.75, b1: 0.9,
      });
    }
    motes += dt * 5 * k;
    for (; motes >= 1; motes--) {
      const a = Math.random() * TAU;
      pools.motes.emit({
        x: at.x + Math.sin(a) * R * rand(0.3, 1.1), y: at.y + H * rand(0.6, 1.1), z: at.z + Math.cos(a) * R * rand(0.3, 1.1),
        vx: rand(-0.1, 0.1), vy: rand(-0.5, -0.2), vz: rand(-0.1, 0.1), life: rand(0.8, 1.4), size: 0.05, thick: 0.02,
        r: 0.9, g: 0.97, b: 1, a: 0.9, r1: c[0], g1: c[1], b1: c[2],
      });
    }
  });
  fx.own(shell);
  fx.own(collar);
  return fx;
}

/** Smouldering: embers lifting off the body, grey ash rising, the odd lick of flame. No meshes: all pooled. */
export function emberSmoulder(scene: Scene, node: TransformNode, o: StatusOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const c = o.colour ?? [1, 0.45, 0.1];
  let embers = 0, ash = 0, licks = 0;
  const pools = kitPools(scene);
  return statusFx(node, (f, dt, at) => {
    const k = presence(f);
    embers += dt * 12 * k;
    for (; embers >= 1; embers--) {
      const a = Math.random() * TAU;
      const d = R * Math.sqrt(Math.random());
      pools.motes.emit({
        x: at.x + Math.sin(a) * d, y: at.y + H * rand(0.1, 0.9), z: at.z + Math.cos(a) * d,
        vx: rand(-0.2, 0.2), vy: rand(0.6, 1.4), vz: rand(-0.2, 0.2), gravity: 0.3, drag: 0.6,
        life: rand(0.5, 1), size: 0.06, thick: 0.016, stretch: 0.05,
        r: 1, g: 0.8, b: 0.4, a: 0.95, r1: c[0] * 0.6, g1: c[1] * 0.25, b1: 0.02,
      });
    }
    ash += dt * 3 * k;
    for (; ash >= 1; ash--) {
      pools.smoke.emit({
        x: at.x + rand(-R, R) * 0.6, y: at.y + H * rand(0.5, 0.9), z: at.z + rand(-R, R) * 0.6,
        vx: rand(-0.1, 0.1), vy: rand(0.4, 0.8), vz: rand(-0.1, 0.1), drag: 0.8, life: rand(0.8, 1.2), size: 0.2, sizeEnd: 0.55,
        r: 0.25, g: 0.23, b: 0.22, a: 0.35, r1: 0.4, g1: 0.39, b1: 0.38,
      });
    }
    licks += dt * 2.5 * k;
    for (; licks >= 1; licks--) {
      pools.glow.emit({
        x: at.x + rand(-R, R) * 0.5, y: at.y + H * rand(0.2, 0.8), z: at.z + rand(-R, R) * 0.5,
        vy: rand(0.4, 0.8), drag: 1, life: rand(0.25, 0.4), size: 0.12, sizeEnd: 0.32,
        r: 1, g: 0.6, b: 0.2, a: 0.4, r1: c[0] * 0.5, g1: c[1] * 0.2, b1: 0.02,
      });
    }
  });
}

function starsTemplate(scene: Scene, c: Rgb, count: number): Mesh {
  return template(scene, `stun-stars-${count}-${c.join("_")}`, () => {
    // Each star a stella octangula (two interlocked tetrahedra), faces shaded by their tilt so a flat unlit solid still has form.
    const g = new Geo();
    const A = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    const B = A.map(([x, y, z]) => [-x!, -y!, -z!]);
    const faces = (t: number[][]) => [[t[0], t[1], t[2]], [t[0], t[3], t[1]], [t[0], t[2], t[3]], [t[1], t[3], t[2]]];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const cx = Math.sin(a), cz = Math.cos(a);
      for (const tet of [A, B]) {
        for (const f of faces(tet)) {
          const p = f.map((v) => [cx + v![0]! * 0.09, v![1]! * 0.09, cz + v![2]! * 0.09] as const);
          const ux = p[1]![0] - p[0]![0], uy = p[1]![1] - p[0]![1], uz = p[1]![2] - p[0]![2];
          const vx = p[2]![0] - p[0]![0], vy = p[2]![1] - p[0]![1], vz = p[2]![2] - p[0]![2];
          const ny = uz * vx - ux * vz;
          const nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
          const shade = 0.55 + 0.45 * Math.abs(ny / nl);
          const col: [number, number, number, number] = [shade, shade, shade, 1];
          const i0 = g.vert(...p[0]!, col), i1 = g.vert(...p[1]!, col), i2 = g.vert(...p[2]!, col);
          g.idx.push(i0, i1, i2);
        }
      }
    }
    const m = g.mesh(scene, "kit-stun-stars");
    m.material = solidMat(scene, c);
    m.hasVertexAlpha = false;
    m.isPickable = false;
    return m;
  });
}

export interface StunOptions extends StatusOptions {
  count?: number;
  /** Radians a second round the head. */
  speed?: number;
}

/** Stunned: little 3D stars wheeling round above the head, bobbing. */
export function stunOrbit(scene: Scene, node: TransformNode, o: StunOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const stars = cloneOf(scene, starsTemplate(scene, o.colour ?? [1, 0.88, 0.35], o.count ?? 3), "kit-stun-stars");
  const orbit = Math.max(0.3, R * 0.6);
  const speed = o.speed ?? 4;
  const fx = statusFx(node, (f, _dt, at) => {
    const k = presence(f);
    stars.position.set(at.x, at.y + H + 0.25 + 0.05 * Math.sin(f.age * 6), at.z);
    stars.scaling.set(orbit * k, orbit * k, orbit * k);
    stars.rotation.set(0.25 * Math.sin(f.age * 2), f.age * speed, 0.25 * Math.cos(f.age * 2));
  });
  fx.own(stars);
  return fx;
}

function reticleTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `mark-reticle-${c.join("_")}`, () => {
    const g = new Geo();
    const h = 0.05;
    // A thick ring broken in four, an extruded band with real walls.
    for (let q = 0; q < 4; q++) {
      const mid = (q / 4) * TAU + Math.PI / 4;
      g.lathe([
        { r: 0.82, y: 0, c: rgba(c, 0.85) }, { r: 0.82, y: h, c: rgba(c, 1, 1.3) },
        { r: 1, y: h, c: rgba(c, 1, 1.3) }, { r: 1, y: 0, c: rgba(c, 0.85) }, { r: 0.82, y: 0, c: rgba(c, 0.85) },
      ], 10, mid - 0.62, mid + 0.62);
    }
    // Four prongs pointing in at the gaps: wedges with a top, a bottom and sides.
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * TAU;
      const sx = Math.sin(a), sz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
      const outer = 1.18, inner = 0.6, w = 0.11;
      const pts = [
        [sx * outer + tx * w, sz * outer + tz * w], [sx * outer - tx * w, sz * outer - tz * w], [sx * inner, sz * inner],
      ] as const;
      const top = pts.map(([x, z]) => g.vert(x, h, z, rgba(c, 1, 1.4)));
      const bot = pts.map(([x, z]) => g.vert(x, 0, z, rgba(c, 0.85)));
      g.idx.push(top[0]!, top[1]!, top[2]!, bot[0]!, bot[2]!, bot[1]!);
      for (let k = 0; k < 3; k++) g.quad(top[k]!, top[(k + 1) % 3]!, bot[k]!, bot[(k + 1) % 3]!);
    }
    return fxMesh(scene, g.mesh(scene, "kit-mark-reticle"), blendMat(scene));
  });
}

/** Marked: a hard 3D reticle hovering above the head, slowly turning and pulsing. Alpha-blended so it stays its colour on bright sand. */
export function markReticle(scene: Scene, node: TransformNode, o: StatusOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const ret = cloneOf(scene, reticleTemplate(scene, o.colour ?? [1, 0.2, 0.12]), "kit-mark-reticle");
  const size = Math.max(0.35, R * 0.75);
  const fx = statusFx(node, (f, _dt, at) => {
    const k = presence(f);
    // It snaps on: overshoots from large, then breathes.
    const snap = 1 + 0.8 * (1 - clamp01(f.age / 0.2)) ** 2;
    const s = size * snap * (1 + 0.07 * Math.sin(f.age * 6));
    ret.position.set(at.x, at.y + H + 0.45 + 0.04 * Math.sin(f.age * 2.5), at.z);
    ret.scaling.set(s, 1, s);
    ret.rotation.y = f.age * 0.9;
    ret.visibility = k * (0.85 + 0.15 * Math.sin(f.age * 6));
  });
  fx.own(ret);
  return fx;
}

export interface TauntOptions extends StatusOptions {
  /** Seconds between pulses. */
  period?: number;
}

/** Taunted: a red rim at the feet throbbing out, and angry motes. */
export function tauntRage(scene: Scene, node: TransformNode, o: TauntOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const c = o.colour ?? [1, 0.12, 0.06];
  const period = o.period ?? 0.8;
  const ring = cloneOf(scene, pulseRingTemplate(scene, c, "taunt-ring", true), "kit-taunt-ring");
  let motes = 0;
  const fx = statusFx(node, (f, dt, at) => {
    const k = presence(f);
    const ph = (f.age % period) / period;
    const s = R * 1.4 * (0.85 + 0.4 * ph);
    ring.position.set(at.x, at.y + 0.02, at.z);
    ring.scaling.set(s, 1 + (1 - ph), s);
    ring.visibility = k * (0.35 + 0.65 * (1 - ph) ** 2);
    motes += dt * 4 * k;
    for (; motes >= 1; motes--) {
      const a = Math.random() * TAU;
      kitPools(scene).motes.emit({
        x: at.x + Math.sin(a) * R, y: at.y + H * rand(0.2, 0.8), z: at.z + Math.cos(a) * R,
        vx: 0, vy: rand(0.6, 1.2), vz: 0, life: rand(0.4, 0.7), size: 0.07, thick: 0.02,
        r: 1, g: 0.3, b: 0.2, a: 0.9, r1: c[0] * 0.6, g1: c[1] * 0.4, b1: c[2] * 0.4,
      });
    }
  });
  fx.own(ring);
  return fx;
}

function curseTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `curse-sigil-${c.join("_")}`, () => {
    const g = new Geo();
    const band = (r0: number, r1: number, a: number) =>
      g.lathe([{ r: r0, y: 0, c: rgba(c, 0) }, { r: (r0 + r1) / 2, y: 0.01, c: rgba(c, a, 1.2) }, { r: r1, y: 0, c: rgba(c, 0) }], 72);
    band(0.94, 1.0, 1);
    band(0.82, 0.86, 0.8);
    band(0.4, 0.44, 0.7);
    // A five-point star across the inner disc, drawn as flat strokes point to point.
    const star = Array.from({ length: 5 }, (_, i) => (i / 5) * TAU);
    for (let i = 0; i < 5; i++) {
      const a = star[i]!, b = star[(i + 2) % 5]!;
      g.strip([[Math.sin(a) * 0.82, Math.cos(a) * 0.82, 0.018, 0.9], [Math.sin(b) * 0.82, Math.cos(b) * 0.82, 0.018, 0.9]], c, 0.006);
    }
    // Runes in the band between the rings: short angled strokes, three to a glyph.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.1;
      const r = 0.9;
      const p = (da: number, dr: number) => [Math.sin(a + da) * (r + dr), Math.cos(a + da) * (r + dr)] as const;
      const strokes = [[p(-0.04, -0.03), p(0, 0.03)], [p(0, 0.03), p(0.04, -0.03)], [p(-0.02, 0), p(0.03, 0)]] as const;
      for (const [[ax, az], [bx, bz]] of strokes) g.strip([[ax, az, 0.008, 1], [bx, bz, 0.008, 1]], c, 0.006);
    }
    return fxMesh(scene, g.mesh(scene, "kit-curse-sigil"), blendMat(scene));
  });
}

/** Cursed: a rune circle under the monster, slowly turning, with motes pressing DOWN into it. */
export function curseSigil(scene: Scene, node: TransformNode, o: StatusOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const c = o.colour ?? [1, 0.45, 0.1];
  const sigil = cloneOf(scene, curseTemplate(scene, c), "kit-curse-sigil");
  let motes = 0;
  const fx = statusFx(node, (f, dt, at) => {
    const k = presence(f);
    const s = R * 1.5 * (0.7 + 0.3 * clamp01(f.age / 0.3));
    sigil.position.set(at.x, at.y + 0.025, at.z);
    sigil.scaling.set(s, 1, s);
    sigil.rotation.y = -f.age * 0.5;
    sigil.visibility = k * (0.75 + 0.25 * Math.sin(f.age * 3));
    motes += dt * 5 * k;
    for (; motes >= 1; motes--) {
      const a = Math.random() * TAU;
      const d = R * 1.4 * rand(0.3, 1);
      kitPools(scene).motes.emit({
        x: at.x + Math.sin(a) * d, y: at.y + H * rand(0.8, 1.2), z: at.z + Math.cos(a) * d,
        vx: 0, vy: rand(-1.6, -1), vz: 0, life: rand(0.6, 0.9), size: 0.08, thick: 0.016,
        r: Math.min(1, c[0] * 1.2), g: Math.min(1, c[1] * 1.2), b: Math.min(1, c[2] * 1.2), a: 0.85, r1: c[0] * 0.5, g1: c[1] * 0.4, b1: c[2] * 0.4,
      });
    }
  });
  fx.own(sigil);
  return fx;
}

/** A status whose strength the caller sets each frame: `amount` 0..1. */
export type MeterFx = Fx & { amount: number };

/**
 * Freezing: the meter before the lock. Rime climbs out of the floor as high as the
 * meter is full, and the cold shell and falling motes thicken with it, so a pack
 * visibly whitens toward the freeze (PoE2 shows the buildup on the body too).
 */
export function frostCreep(scene: Scene, node: TransformNode, o: StatusOptions = {}): MeterFx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const collar = cloneOf(scene, frostCollar(scene), "kit-frost-creep");
  const shell = cloneOf(scene, frostShell(scene, [0.55, 0.8, 1]), "kit-frost-creep-shell");
  let motes = 0;
  const pools = kitPools(scene);
  const fx = statusFx(node, (f, dt, at) => {
    const k = presence(f) * clamp01(out.amount);
    collar.position.set(at.x, at.y, at.z);
    collar.scaling.set(R * 0.9, R * 0.9 * k, R * 0.9);
    shell.position.set(at.x, at.y + H * 0.5, at.z);
    shell.scaling.set(R * 2.3, H * 1.1, R * 2.3);
    shell.visibility = 0.16 * k;
    motes += dt * 4 * k;
    for (; motes >= 1; motes--) {
      const a = Math.random() * TAU;
      pools.motes.emit({
        x: at.x + Math.sin(a) * R * rand(0.3, 1), y: at.y + H * rand(0.4, 1), z: at.z + Math.cos(a) * R * rand(0.3, 1),
        vx: 0, vy: rand(-0.4, -0.2), vz: 0, life: rand(0.6, 1), size: 0.04, thick: 0.016,
        r: 0.85, g: 0.95, b: 1, a: 0.7, r1: 0.5, g1: 0.75, b1: 0.95,
      });
    }
  }) as MeterFx;
  const out = fx;
  out.amount = 0;
  fx.own(collar);
  fx.own(shell);
  return out;
}

/**
 * Shocked: the body crackles. A pale violet-white shell flickers on and off at
 * random, and short white-hot arcs jump off its surface in uneven bursts: PoE's
 * shocked monster reads as a light that cannot hold still.
 */
export function shockCrackle(scene: Scene, node: TransformNode, o: StatusOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  const shell = cloneOf(scene, frostShell(scene, [0.75, 0.7, 1]), "kit-shock-shell");
  let next = 0;
  const fx = statusFx(node, (f, dt, at) => {
    const k = presence(f);
    shell.position.set(at.x, at.y + H * 0.5, at.z);
    shell.scaling.set(R * 2.3, H * 1.1, R * 2.3);
    // A flicker, not a bubble: brighter than this, the shell read as a violet ball.
    shell.visibility = k * (Math.random() < 0.25 ? 0.18 : 0.04);
    next -= dt;
    if (next > 0 || k < 0.2) return;
    next = rand(0.05, 0.16);
    const a = Math.random() * TAU;
    const p = sShock.set(at.x + Math.sin(a) * R * 0.8, at.y + H * rand(0.2, 0.95), at.z + Math.cos(a) * R * 0.8);
    sparks(scene, p, 4 + Math.floor(Math.random() * 4), [1, 1, 0.85], [0.55, 0.45, 1], {
      speed: [3, 6], up: [-0.4, 0.6], gravity: 0, life: [0.05, 0.12], length: 0.22, thick: 0.018, yaw: a, cone: 1.4,
    });
  });
  fx.own(shell);
  return fx;
}

const sShock = new Vector3();

/** Poisoned: green beads seeping up off the body and dripping from it, sickly, never bright. */
export function poisonSeep(scene: Scene, node: TransformNode, o: StatusOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  let beads = 0, drips = 0;
  const pools = kitPools(scene);
  return statusFx(node, (f, dt, at) => {
    const k = presence(f);
    beads += dt * 7 * k;
    for (; beads >= 1; beads--) {
      const a = Math.random() * TAU;
      const d = R * Math.sqrt(Math.random()) * 0.9;
      pools.motes.emit({
        x: at.x + Math.sin(a) * d, y: at.y + H * rand(0.2, 0.85), z: at.z + Math.cos(a) * d,
        vx: rand(-0.08, 0.08), vy: rand(0.25, 0.55), vz: rand(-0.08, 0.08), drag: 1, life: rand(0.6, 1), size: 0.05, thick: 0.03,
        r: 0.55, g: 0.95, b: 0.2, a: 0.75, r1: 0.12, g1: 0.35, b1: 0.04,
      });
    }
    drips += dt * 2.5 * k;
    for (; drips >= 1; drips--) {
      const a = Math.random() * TAU;
      pools.drops.emit({
        x: at.x + Math.sin(a) * R * 0.7, y: at.y + H * rand(0.3, 0.7), z: at.z + Math.cos(a) * R * 0.7,
        vx: 0, vy: -0.2, vz: 0, gravity: -6, life: rand(0.35, 0.55), size: rand(0.035, 0.06),
        r: 0.3, g: 0.62, b: 0.08, a: 1, r1: 0.16, g1: 0.32, b1: 0.04,
      });
    }
  });
}

/** Bleeding: dark red drops falling off the body onto the floor, steadily. */
export function bloodDrip(scene: Scene, node: TransformNode, o: StatusOptions = {}): Fx {
  const R = o.radius ?? 0.6;
  const H = o.height ?? 1.6;
  let drips = 0;
  const pools = kitPools(scene);
  return statusFx(node, (f, dt, at) => {
    drips += dt * 5 * presence(f);
    for (; drips >= 1; drips--) {
      const a = Math.random() * TAU;
      pools.drops.emit({
        x: at.x + Math.sin(a) * R * 0.6, y: at.y + H * rand(0.35, 0.75), z: at.z + Math.cos(a) * R * 0.6,
        vx: Math.sin(a) * 0.3, vy: rand(0, 0.6), vz: Math.cos(a) * 0.3, gravity: -10, life: rand(0.35, 0.6), size: rand(0.035, 0.065),
        r: 0.5, g: 0.02, b: 0.02, a: 1, r1: 0.28, g1: 0.01, b1: 0.01,
      });
    }
  });
}
