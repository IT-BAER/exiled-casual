import { MeshBuilder, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import {
  addMat, blendMat, clamp01, cloneOf, easeOut, Fx, fxMesh, Geo, kitFlash, kitPools, pointOf, rand, rgba, TAU, template,
  type Point, type Rgb,
} from "./core";
import { core, puff, sparks } from "./emit";
import { shockRing } from "./ground";

/**
 * Self-cast looks: a warcry's roar, an aura's rune ring, a buff's rising swirl
 * and a blood rage's pulsing mist. Auras run for minutes, so they are two
 * meshes turning and a trickle of pooled motes, nothing rebuilt per frame.
 */

export interface WarcryOptions {
  radius?: number;
  /** A roar aimed along `yaw` within `half` radians each side; omit for a full ring. */
  yaw?: number;
  half?: number;
  colour?: Rgb;
  /** Standing wave walls thrown one after another. */
  waves?: number;
  duration?: number;
  /** Height of the mouth the roar leaves, and of the wave walls. */
  height?: number;
  embers?: number;
  flash?: number;
}

function waveTemplate(scene: Scene, c: Rgb, half: number): Mesh {
  return template(scene, `warcry-wave-${c.join("_")}-${half.toFixed(2)}`, () => {
    // A standing wall of force: two bright seams, the lower the stronger, fading out top and bottom.
    const g = new Geo();
    g.lathe([
      { r: 1, y: 0, c: rgba(c, 0) },
      { r: 1, y: 0.18, c: rgba(c, 0.85, 1.4) },
      { r: 1.02, y: 0.4, c: rgba(c, 0.25) },
      { r: 1.04, y: 0.62, c: rgba(c, 0.6, 1.2) },
      { r: 1.06, y: 1, c: rgba(c, 0) },
    ], half >= Math.PI ? 56 : Math.max(10, Math.ceil(28 * half / Math.PI)), -half, half);
    return fxMesh(scene, g.mesh(scene, "kit-warcry-wave"), addMat(scene));
  });
}

/** A roar: wave walls thrown out one after another, a floor ring, embers and dust blown flat, and a burst at the mouth. */
export function warcryBlast(scene: Scene, at: Vector3, o: WarcryOptions = {}): Fx {
  const R = o.radius ?? 5;
  const c = o.colour ?? [1, 0.55, 0.2];
  const half = o.half ?? Math.PI;
  const yaw = o.yaw ?? 0;
  const dur = o.duration ?? 0.6;
  const H = o.height ?? 1.5;
  const n = o.waves ?? 3;
  const waves: { m: Mesh; delay: number }[] = [];
  for (let i = 0; i < n; i++) {
    const m = cloneOf(scene, waveTemplate(scene, c, half), "kit-warcry-wave");
    m.position.set(at.x, at.y + 0.02, at.z);
    m.rotation.y = yaw;
    m.setEnabled(false);
    waves.push({ m, delay: i * 0.1 });
  }
  const fx = new Fx((f) => {
    let live = false;
    for (const w of waves) {
      const t = (f.age - w.delay) / dur;
      w.m.setEnabled(t >= 0 && t < 1);
      if (t < 0 || t >= 1) {
        live ||= t < 0;
        continue;
      }
      live = true;
      const r = R * (0.15 + 0.85 * easeOut(t));
      // The wall rises as it runs out, then sinks as it spends itself.
      w.m.scaling.set(r, H * (0.4 + 0.9 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * (1 - 0.5 * t), r);
      w.m.visibility = (1 - t) ** 1.2;
    }
    return live;
  });
  for (const w of waves) fx.own(w.m);
  kitFlash(scene, at, o.flash ?? 0.6, c);
  const mouth = new Vector3(at.x + Math.sin(yaw) * 0.3, at.y + H, at.z + Math.cos(yaw) * 0.3);
  core(scene, mouth, 1.1, [1, 0.92, 0.7], c, 0.18);
  sparks(scene, new Vector3(at.x, at.y + H * 0.6, at.z), o.embers ?? 30, [1, 0.85, 0.5], [c[0] * 0.8, c[1] * 0.4, c[2] * 0.2], {
    speed: [5, 10], up: [-0.05, 0.25], gravity: -2, life: [0.25, 0.5], length: 0.22,
    ...(half < Math.PI ? { yaw, cone: half } : {}),
  });
  for (let i = 0; i < 14; i++) {
    const a = yaw + (half >= Math.PI ? (i / 14) * TAU : rand(-half, half));
    puff(scene, at.x, at.y, at.z, { size: 0.8, drift: rand(4, 6), rise: 0.15, yaw: a, life: rand(0.5, 0.8), alpha: 0.35 });
  }
  fx.child(shockRing(scene, at, {
    radius: R * 0.9, duration: dur * 0.8, colour: c, lip: 0.25, dust: 0, flash: 0, ...(half < Math.PI ? { arc: { yaw, half } } : {}),
  }));
  return fx;
}

function outerSigil(scene: Scene, c: Rgb, runes: number): Mesh {
  return template(scene, `aura-outer-${c.join("_")}-${runes}`, () => {
    const g = new Geo();
    const h = 0.035;
    const span = TAU / runes;
    for (let i = 0; i < runes; i++) {
      const a0 = i * span + span * 0.12, a1 = (i + 1) * span - span * 0.12;
      // An extruded band segment: inner wall, top, outer wall. Real thickness, so it catches the eye edge-on.
      g.lathe([
        { r: 0.9, y: 0, c: rgba(c, 0.35) },
        { r: 0.9, y: h, c: rgba(c, 0.9, 1.3) },
        { r: 0.96, y: h, c: rgba(c, 1, 1.5) },
        { r: 0.96, y: 0, c: rgba(c, 0.35) },
      ], 6, a0, a1);
      // A rune in the gap: a raised diamond.
      const m = (i + 1) * span;
      const ca = Math.sin(m), cz = Math.cos(m);
      const tx = Math.cos(m), tz = -Math.sin(m);
      const r = 0.93, d = 0.05, w = 0.025;
      const v0 = g.vert(ca * (r - d), h, cz * (r - d), rgba(c, 1, 1.5));
      const v1 = g.vert(ca * r + tx * w, h * 1.6, cz * r + tz * w, rgba(c, 1, 1.5));
      const v2 = g.vert(ca * r - tx * w, h * 1.6, cz * r - tz * w, rgba(c, 1, 1.5));
      const v3 = g.vert(ca * (r + d), h, cz * (r + d), rgba(c, 1, 1.5));
      g.quad(v0, v1, v2, v3);
    }
    // The hairline round the outside and a faint fill fading in from it.
    g.lathe([{ r: 1.02, y: 0, c: rgba(c, 0) }, { r: 1.035, y: 0.01, c: rgba(c, 0.8) }, { r: 1.05, y: 0, c: rgba(c, 0) }], 72);
    g.lathe([{ r: 0.55, y: 0, c: rgba(c, 0) }, { r: 0.88, y: 0, c: rgba(c, 0.12) }, { r: 0.9, y: 0, c: rgba(c, 0) }], 48);
    return fxMesh(scene, g.mesh(scene, "kit-aura-outer"), addMat(scene));
  });
}

function innerSigil(scene: Scene, c: Rgb): Mesh {
  return template(scene, `aura-inner-${c.join("_")}`, () => {
    const g = new Geo();
    const h = 0.025;
    g.lathe([
      { r: 0.58, y: 0, c: rgba(c, 0.3) }, { r: 0.58, y: h, c: rgba(c, 0.85, 1.2) },
      { r: 0.62, y: h, c: rgba(c, 0.85, 1.2) }, { r: 0.62, y: 0, c: rgba(c, 0.3) },
    ], 56);
    // Spokes and ticks: the inner wheel turns against the outer, so the sigil reads as working.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.lathe([{ r: 0.22, y: 0.005, c: rgba(c, 0) }, { r: 0.4, y: 0.012, c: rgba(c, 0.7) }, { r: 0.56, y: 0.005, c: rgba(c, 0.2) }], 2, a - 0.035, a + 0.035);
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      g.lathe([{ r: 0.66, y: 0.004, c: rgba(c, 0.6) }, { r: i % 2 ? 0.7 : 0.74, y: 0.004, c: rgba(c, 0.6) }], 1, a - 0.012, a + 0.012);
    }
    g.lathe([{ r: 0, y: 0, c: rgba(c, 0.18) }, { r: 0.5, y: 0, c: rgba(c, 0.07) }, { r: 0.58, y: 0, c: rgba(c, 0) }], 32);
    return fxMesh(scene, g.mesh(scene, "kit-aura-inner"), addMat(scene));
  });
}

export interface AuraOptions {
  radius?: number;
  colour?: Rgb;
  /** Segments in the outer ring, each with a rune in its gap. */
  runes?: number;
  /** Motes a second rising off the ring. */
  motes?: number;
  /** Radians a second; the inner ring turns the other way, faster. */
  spin?: number;
}

/** An aura's rune ring on the floor round `follow`: extruded segmented ring, counter-turning inner wheel, rising motes. */
export function auraSigil(scene: Scene, follow: Point, o: AuraOptions = {}): Fx {
  const R = o.radius ?? 1.6;
  const c = o.colour ?? [1, 0.4, 0.2];
  const spin = o.spin ?? 0.25;
  const outer = cloneOf(scene, outerSigil(scene, c, o.runes ?? 12), "kit-aura-outer");
  const inner = cloneOf(scene, innerSigil(scene, c), "kit-aura-inner");
  const at = new Vector3();
  const rate = o.motes ?? 5;
  let owed = 0;
  const fx = new Fx((f, dt) => {
    pointOf(follow, at);
    const k = clamp01(f.age / 0.35) * f.fade;
    const breathe = 0.85 + 0.15 * Math.sin(f.age * 2.1);
    // It draws itself open on cast: the rings swell out from the body.
    const grow = 0.6 + 0.4 * easeOut(f.age / 0.35);
    outer.position.set(at.x, at.y + 0.02, at.z);
    inner.position.set(at.x, at.y + 0.025, at.z);
    outer.scaling.set(R * grow, 1, R * grow);
    inner.scaling.set(R * grow, 1, R * grow);
    outer.rotation.y = f.age * spin;
    inner.rotation.y = -f.age * spin * 1.8;
    outer.visibility = k * breathe;
    inner.visibility = k * (0.75 + 0.25 * Math.sin(f.age * 2.1 + 1.3));
    owed += rate * dt * k;
    for (; owed >= 1; owed--) {
      const a = Math.random() * TAU;
      const d = R * rand(0.6, 0.95);
      kitPools(scene).motes.emit({
        x: at.x + Math.sin(a) * d, y: at.y + 0.05, z: at.z + Math.cos(a) * d,
        vx: 0, vy: rand(0.5, 1.1), vz: 0, drag: 0.3, life: rand(0.9, 1.5), size: 0.07, thick: 0.014, stretch: 0.05,
        r: Math.min(1, c[0] * 1.3), g: Math.min(1, c[1] * 1.3), b: Math.min(1, c[2] * 1.3), a: 0.8, r1: c[0] * 0.5, g1: c[1] * 0.5, b1: c[2] * 0.5,
      });
    }
    return true;
  }, 0.4);
  fx.own(outer);
  fx.own(inner);
  return fx;
}

function helixTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `buff-helix-${c.join("_")}`, () => {
    // Two ribbons wound 1.25 turns up a unit cylinder, gone at both ends: turning it reads as rising.
    const g = new Geo();
    const steps = 40;
    for (let strand = 0; strand < 2; strand++) {
      const v0 = g.pos.length / 3;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const a = strand * Math.PI + u * TAU * 1.25;
        const fade = Math.sin(u * Math.PI) ** 0.8;
        const w = 0.05 + 0.05 * fade;
        const x = Math.sin(a), z = Math.cos(a);
        g.vert(x, u - w, z, rgba(c, 0.15 * fade));
        g.vert(x, u, z, rgba(c, 0.9 * fade, 1.3));
        g.vert(x, u + w, z, rgba(c, 0.15 * fade));
        if (s > 0) {
          const a0 = v0 + (s - 1) * 3, b0 = v0 + s * 3;
          g.quad(a0, a0 + 1, b0, b0 + 1);
          g.quad(a0 + 1, a0 + 2, b0 + 1, b0 + 2);
        }
      }
    }
    return fxMesh(scene, g.mesh(scene, "kit-buff-helix"), addMat(scene));
  });
}

export interface SwirlOptions {
  radius?: number;
  height?: number;
  colour?: Rgb;
  /** Motes a second wound up the spiral. */
  rate?: number;
  /** Radians a second. */
  spin?: number;
  /** A one-shot buff: seconds it plays before fading itself out; omit to last until `stop()`. */
  duration?: number;
}

/** Spiral motes and ribbons rising round `follow`: a buff taking hold. */
export function buffSwirl(scene: Scene, follow: Point, o: SwirlOptions = {}): Fx {
  const R = o.radius ?? 0.7;
  const H = o.height ?? 1.9;
  const c = o.colour ?? [1, 0.85, 0.4];
  const spin = o.spin ?? 5;
  const helix = cloneOf(scene, helixTemplate(scene, c), "kit-buff-helix");
  const at = new Vector3();
  const rate = o.rate ?? 16;
  let owed = 0;
  const fx = new Fx((f, dt) => {
    if (o.duration !== undefined && f.age >= o.duration) f.stop();
    pointOf(follow, at);
    const k = clamp01(f.age / 0.15) * f.fade;
    // The ribbons climb as they turn, and the whole swirl tightens as it fades.
    helix.position.set(at.x, at.y + 0.1 + 0.15 * Math.sin(f.age * 3), at.z);
    helix.scaling.set(R * (0.75 + 0.25 * k), H, R * (0.75 + 0.25 * k));
    helix.rotation.y = f.age * spin;
    helix.visibility = k;
    owed += rate * dt * k;
    for (; owed >= 1; owed--) {
      const a = f.age * spin + rand(0, TAU);
      const y = rand(0, H * 0.7);
      const tang = spin * R;
      kitPools(scene).motes.emit({
        x: at.x + Math.sin(a) * R, y: at.y + y, z: at.z + Math.cos(a) * R,
        // Along the tangent of the turn, and up: a short arc of the spiral.
        vx: Math.cos(a) * tang, vy: rand(1, 2), vz: -Math.sin(a) * tang, drag: 3,
        life: rand(0.35, 0.6), size: 0.08, thick: 0.016, stretch: 0.03,
        r: Math.min(1, c[0] * 1.2), g: Math.min(1, c[1] * 1.2), b: Math.min(1, c[2] * 1.2), a: 0.9, r1: c[0] * 0.6, g1: c[1] * 0.6, b1: c[2] * 0.6,
      });
    }
    return true;
  }, 0.3);
  fx.own(helix);
  return fx;
}

/** A floor ring with a short standing lip: a pulse at the feet. */
export function pulseRingTemplate(scene: Scene, c: Rgb, key: string, blend: boolean): Mesh {
  return template(scene, `${key}-${c.join("_")}`, () => {
    const g = new Geo();
    g.lathe([
      { r: 0.55, y: 0, c: rgba(c, 0) },
      { r: 0.9, y: 0, c: rgba(c, 0.3) },
      { r: 0.97, y: 0, c: rgba(c, 0.95) },
      { r: 0.99, y: 0.12, c: rgba(c, 0.6) },
      { r: 1.0, y: 0.22, c: rgba(c, 0) },
    ], 56);
    return fxMesh(scene, g.mesh(scene, `kit-${key}`), blend ? blendMat(scene) : addMat(scene));
  });
}

function shellTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `blood-shell-${c.join("_")}`, () => {
    const m = MeshBuilder.CreateSphere("kit-blood-shell", { diameter: 1, segments: 10 }, scene);
    return fxMesh(scene, m, blendMat(scene, c, true), false);
  });
}

export interface BloodMistOptions {
  radius?: number;
  height?: number;
  colour?: Rgb;
  /** Heartbeats a minute: the mist, ring and drops all throb on it. */
  bpm?: number;
  /** Droplets a second. */
  drops?: number;
}

/** A self-damaging rage: dark red mist pulsing on a heartbeat round `follow`, a throbbing ring, blood drops falling. */
export function bloodMist(scene: Scene, follow: Point, o: BloodMistOptions = {}): Fx {
  const R = o.radius ?? 0.75;
  const H = o.height ?? 1.8;
  const c = o.colour ?? [0.55, 0.03, 0.02];
  const period = 60 / (o.bpm ?? 80);
  const shell = cloneOf(scene, shellTemplate(scene, c), "kit-blood-shell");
  const ring = cloneOf(scene, pulseRingTemplate(scene, [0.85, 0.08, 0.05], "blood-ring", true), "kit-blood-ring");
  const at = new Vector3();
  let lastBeat = -1;
  let mist = 0, drip = 0;
  const pools = kitPools(scene);
  const fx = new Fx((f, dt) => {
    pointOf(follow, at);
    const k = clamp01(f.age / 0.25) * f.fade;
    const phase = (f.age % period) / period;
    // Lub-dub: two beats close together, then the rest of the period still.
    const beat = Math.min(1.2, Math.exp(-phase * 25) + 0.6 * Math.exp(-Math.abs(phase - 0.2) * 35));
    const n = Math.floor(f.age / period);
    shell.position.set(at.x, at.y + H * 0.5, at.z);
    shell.scaling.set(R * 2.3 * (1 + 0.12 * beat), H * 1.15 * (1 + 0.06 * beat), R * 2.3 * (1 + 0.12 * beat));
    shell.visibility = k * (0.22 + 0.3 * beat);
    ring.position.set(at.x, at.y + 0.02, at.z);
    const rs = R * 1.3 * (0.8 + 0.5 * (1 - Math.exp(-phase * 6)));
    ring.scaling.set(rs, 1 + beat, rs);
    ring.visibility = k * (0.15 + 0.85 * beat);
    mist += dt * 5 * k;
    if (n !== lastBeat) {
      lastBeat = n;
      mist += 4 * k;
    }
    for (; mist >= 1; mist--) {
      const a = Math.random() * TAU;
      pools.smoke.emit({
        x: at.x + Math.sin(a) * R * 0.8, y: at.y + rand(0.2, H * 0.9), z: at.z + Math.cos(a) * R * 0.8,
        vx: Math.sin(a) * 0.5, vy: rand(0.1, 0.4), vz: Math.cos(a) * 0.5, drag: 1.5, life: rand(0.7, 1.1), size: 0.4, sizeEnd: 1,
        r: c[0], g: c[1], b: c[2], a: 0.4, r1: c[0] * 0.6, g1: c[1], b1: c[2],
      });
    }
    drip += dt * (o.drops ?? 7) * k;
    for (; drip >= 1; drip--) {
      const a = Math.random() * TAU;
      pools.drops.emit({
        x: at.x + Math.sin(a) * R * 0.6, y: at.y + rand(0.6, H), z: at.z + Math.cos(a) * R * 0.6,
        vx: Math.sin(a) * rand(0.2, 0.8), vy: rand(0, 1), vz: Math.cos(a) * rand(0.2, 0.8), gravity: -12,
        life: rand(0.4, 0.6), size: rand(0.035, 0.06), r: 0.45, g: 0.02, b: 0.02, a: 1, r1: 0.3, g1: 0.01, b1: 0.01,
      });
    }
    return true;
  }, 0.4);
  fx.own(shell);
  fx.own(ring);
  return fx;
}
