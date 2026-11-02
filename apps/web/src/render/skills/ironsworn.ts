import { MeshBuilder, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene, TransformNode } from "@babylonjs/core";
import {
  addMat, auraSigil, blendMat, bloodMist, clamp01, cloneOf, core, easeOut, easeOutInv, emberSmoulder, fissure, Fx, fxMesh,
  coneWave, Geo, kitFlash, kitPools, landingImpact, leapArcTrail, litMat, puff, rand, rgba, rgbaHue, ribbonTrail, scorch, shockRing, sparks,
  solidMat, TAU, tauntRage, template, throwChunks, type Rgb,
} from "./kit";
import type {
  ActorRef, AreaLook, AreaState, AttachedState, BurstHandle, CastLook, CastState, ClassSkillLooks, FxHandle, LookContext, SkillLook,
  StatusLook, TravelLook, TravelState,
} from "./types";

/**
 * The Ironsworn's six (spec 2026-11-01 section 1): fire and broken earth. Each hit
 * is several parts arriving together (inside-map-battle.webp): a front standing up
 * off the floor so it reads with bloom off, a light on the floor, solids thrown.
 * Clip release fractions are measured off anim-library.glb (hand and pelvis by FK):
 * the frame the blade or the body lands is the one the sim resolves on.
 */

const FIRE: Rgb = [1, 0.42, 0.1];
const HOT: Rgb = [1, 0.9, 0.62];
const EMBER: Rgb = [0.75, 0.16, 0.03];
/** The glowing seam in broken earth: Ironsworn's slams crack the floor open to heat. */
const SEAM: Rgb = [1, 0.5, 0.14];
const EARTH: Rgb = [1, 0.66, 0.34];
const GOLD: Rgb = [1, 0.74, 0.3];
const BLOOD: Rgb = [0.85, 0.05, 0.03];
const STUN: Rgb = [1, 0.93, 0.45];

const yawOf = (x: number, z: number): number => Math.atan2(x, z);

// ── Handles ──────────────────────────────────────────────────────────────────

/** A parent over kit effects: done when they all are. `lasting` keeps it alive until `stop()`. */
function group(fxs: readonly (Fx | null)[], lasting = false): Fx {
  const root = new Fx(() => lasting, 0.01);
  for (const f of fxs) if (f) root.child(f);
  return root;
}

/** Kit effects as a dispatcher burst: driven on the look clock, disposed by the dispatcher. */
function burst(fxs: readonly (Fx | null)[]): BurstHandle {
  const root = group(fxs);
  return {
    update(ctx) {
      root.update(ctx.dt);
      return !root.done;
    },
    dispose: () => root.dispose(),
  };
}

/** A lasting kit effect as a buff or status handle: paused while its body sleeps off screen, faded on `stop()`. */
function attached(fx: Fx): FxHandle<AttachedState> {
  let stopped = false;
  return {
    update(ctx, s) {
      if (s.visible) fx.update(ctx.dt);
    },
    fade(ctx) {
      if (!stopped) {
        stopped = true;
        fx.stop();
      }
      fx.update(ctx.dt);
      return !fx.done;
    },
    dispose: () => fx.dispose(),
  };
}

/** A body's floor point, re-read every frame (a leap lifts the root; floor looks stay down). */
function floorOf(node: TransformNode): () => Vector3 {
  const v = new Vector3();
  return () => {
    const p = node.getAbsolutePosition();
    return v.set(p.x, 0, p.z);
  };
}

// ── Camera thump ─────────────────────────────────────────────────────────────

/** The renderer's trauma shake (juice.ts), through the look context. Returns no effect of its own. */
function shake(ctx: LookContext, weight: number): Fx | null {
  ctx.shake?.(weight);
  return null;
}

// ── Templates (one per scene, clones share their buffers) ───────────────────

/** A soft additive floor disc, bright at the centre. */
function floorGlowTpl(scene: Scene, c: Rgb): Mesh {
  return template(scene, `iron-glow-${c.join("_")}`, () => {
    const g = new Geo();
    g.lathe([{ r: 0, y: 0, c: rgbaHue(c, 0.85, 1.4) }, { r: 0.45, y: 0, c: rgba(c, 0.4) }, { r: 1, y: 0, c: rgba(c, 0) }], 40);
    return fxMesh(scene, g.mesh(scene, "iron-glow"), addMat(scene));
  });
}

/** A hard ring with a short standing lip: the honest edge of an area about to land. */
function edgeTpl(scene: Scene, c: Rgb): Mesh {
  return template(scene, `iron-edge-${c.join("_")}`, () => {
    const g = new Geo();
    g.lathe([{ r: 0.9, y: 0, c: rgba(c, 0) }, { r: 0.97, y: 0, c: rgba(c, 0.55) }, { r: 1, y: 0, c: rgba(c, 1, 1.4) }, { r: 1.025, y: 0, c: rgba(c, 0) }], 64);
    g.lathe([{ r: 0.99, y: 0, c: rgba(c, 0.9, 1.3) }, { r: 1, y: 0.18, c: rgba(c, 0) }], 64);
    return fxMesh(scene, g.mesh(scene, "iron-edge"), addMat(scene));
  });
}

/** A dark soft blot: the body's shadow on the floor under a leap, which is what makes the height read from above. */
function shadowTpl(scene: Scene): Mesh {
  return template(scene, "iron-shadow", () => {
    const g = new Geo();
    g.lathe([{ r: 0, y: 0, c: [0, 0, 0, 0.55] }, { r: 0.55, y: 0, c: [0, 0, 0, 0.4] }, { r: 1, y: 0, c: [0, 0, 0, 0] }], 32);
    return fxMesh(scene, g.mesh(scene, "iron-shadow"), blendMat(scene), false);
  });
}

/** The leap's landing reticle: a ring and four prongs pointing in. */
function reticleTpl(scene: Scene): Mesh {
  return template(scene, "iron-reticle", () => {
    const g = new Geo();
    const c = FIRE;
    g.lathe([{ r: 0.9, y: 0, c: rgba(c, 0) }, { r: 0.96, y: 0, c: rgba(c, 0.7, 1.2) }, { r: 1, y: 0, c: rgba(HOT, 1) }, { r: 1.03, y: 0, c: rgba(c, 0) }], 64);
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * TAU;
      const sx = Math.sin(a), sz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
      const v0 = g.vert(sx * 0.98 + tx * 0.08, 0, sz * 0.98 + tz * 0.08, rgba(HOT, 0.95));
      const v1 = g.vert(sx * 0.98 - tx * 0.08, 0, sz * 0.98 - tz * 0.08, rgba(HOT, 0.95));
      const v2 = g.vert(sx * 0.7, 0, sz * 0.7, rgba(c, 0.2));
      g.idx.push(v0, v1, v2);
    }
    return fxMesh(scene, g.mesh(scene, "iron-reticle"), addMat(scene));
  });
}

/** A column of molten light: the aftershock's eruptions. Unit height. */
function geyserTpl(scene: Scene): Mesh {
  return template(scene, "iron-geyser", () => {
    const g = new Geo();
    g.lathe([
      { r: 0.34, y: 0, c: rgba([1, 0.72, 0.36], 0.9) },
      { r: 0.27, y: 0.22, c: rgba(SEAM, 0.85, 1.2) },
      { r: 0.18, y: 0.6, c: rgba(FIRE, 0.45) },
      { r: 0.06, y: 1, c: rgba(EMBER, 0) },
    ], 16);
    return fxMesh(scene, g.mesh(scene, "iron-geyser"), addMat(scene, [1, 1, 1], true));
  });
}

/** Sunder's signature: a cluster of rock fangs, lit, flat shaded, real solids. Unit height. */
function fangsTpl(scene: Scene): Mesh {
  return template(scene, "iron-fangs", () => {
    const g = new Geo();
    const white: [number, number, number, number] = [1, 1, 1, 1];
    const spikes = [
      [0, 0, 1, 0.24, 0.1], [0.32, 0.12, 0.72, 0.17, 0.45], [-0.3, 0.18, 0.66, 0.16, 0.4],
      [0.08, -0.34, 0.6, 0.15, 0.4], [-0.12, -0.24, 0.45, 0.12, 0.5], [0.4, -0.25, 0.4, 0.11, 0.55],
    ] as const;
    for (const [x, z, h, w, lean] of spikes) {
      const out = Math.hypot(x, z) || 1;
      const lx = (x / out) * lean * h, lz = (z / out) * lean * h;
      const base: number[] = [];
      for (let k = 0; k < 4; k++) {
        const t = (k / 4) * TAU + x * 3;
        base.push(g.vert(x + Math.sin(t) * w, -0.15, z + Math.cos(t) * w, white));
      }
      const tip = g.vert(x + lx, h, z + lz, white);
      for (let k = 0; k < 4; k++) g.idx.push(base[k]!, base[(k + 1) % 4]!, tip);
    }
    const m = g.mesh(scene, "iron-fangs");
    m.convertToFlatShadedMesh();
    m.material = litMat(scene, "iron-fang", [0.17, 0.12, 0.085], [0.07, 0.025, 0.006], 0.95);
    m.hasVertexAlpha = false;
    m.isPickable = false;
    return m;
  });
}

/** Infernal Cry's flame crown at the feet: a ring of tongues licking up. Unit radius. */
function flameRingTpl(scene: Scene): Mesh {
  return template(scene, "iron-flame-ring", () => {
    const g = new Geo();
    g.lathe([
      { r: 0.82, y: 0, c: rgba(HOT, 0) },
      { r: 0.9, y: 0.01, c: rgba(HOT, 0.85) },
      { r: 0.95, y: 0.2, c: rgba(FIRE, 0.55, 1.2) },
      { r: 1, y: 0.42, c: rgba(EMBER, 0) },
    ], 72, 0, TAU, { lift: (yaw, ring) => (ring === 3 ? 0.32 * Math.max(0, Math.sin(yaw * 11) * 0.7 + Math.sin(yaw * 5 + 1) * 0.3) : 0) });
    return fxMesh(scene, g.mesh(scene, "iron-flame-ring"), addMat(scene, [1, 1, 1], true));
  });
}

/** Blood Rage's veins: jagged, forking lines of red light wound up a unit cylinder round the body. */
function veinsTpl(scene: Scene): Mesh {
  return template(scene, "iron-veins", () => {
    const g = new Geo();
    const line = (a: number, y: number, top: number, w: number, fork: boolean) => {
      let prev: [number, number] | null = null;
      while (y < top) {
        const t = clamp01((y - 0.1) / 0.8);
        const fade = Math.sin(Math.PI * t) ** 0.6;
        const sx = Math.sin(a), sz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
        const c = rgba([1, 0.16, 0.08], 0.95 * fade, 1.2);
        const v0 = g.vert(sx + tx * w, y, sz + tz * w, c);
        const v1 = g.vert(sx - tx * w, y, sz - tz * w, c);
        if (prev) g.quad(prev[0], prev[1], v0, v1);
        prev = [v0, v1];
        a += rand(-0.22, 0.22);
        y += rand(0.05, 0.1);
        if (fork && Math.random() < 0.12) line(a, y, Math.min(top, y + rand(0.12, 0.3)), w * 0.6, false);
      }
    };
    for (let i = 0; i < 8; i++) line((i / 8) * TAU + rand(-0.2, 0.2), rand(0.08, 0.3), rand(0.7, 0.95), 0.035, true);
    return fxMesh(scene, g.mesh(scene, "iron-veins"), addMat(scene));
  });
}

/** A dazed halo: a bright ring wheeling over a stunned head. */
function haloTpl(scene: Scene): Mesh {
  return template(scene, "iron-halo", () => {
    const g = new Geo();
    g.lathe([{ r: 0.8, y: 0, c: rgba(STUN, 0) }, { r: 0.93, y: 0, c: rgba(STUN, 0.95, 1.3) }, { r: 1.06, y: 0, c: rgba(STUN, 0) }], 48);
    g.lathe([{ r: 0.93, y: -0.05, c: rgba(STUN, 0) }, { r: 0.93, y: 0, c: rgba(STUN, 0.8) }, { r: 0.93, y: 0.05, c: rgba(STUN, 0) }], 48);
    return fxMesh(scene, g.mesh(scene, "iron-halo"), addMat(scene));
  });
}

/** Stun stars sized to read at the game camera: four stellated octahedra on a unit circle, faces shaded by tilt. */
function starsTpl(scene: Scene): Mesh {
  return template(scene, "iron-stars", () => {
    const g = new Geo();
    const A = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as const;
    const B = A.map(([x, y, z]) => [-x, -y, -z] as const);
    const faces = (t: readonly (readonly number[])[]) => [[t[0]!, t[1]!, t[2]!], [t[0]!, t[3]!, t[1]!], [t[0]!, t[2]!, t[3]!], [t[1]!, t[3]!, t[2]!]];
    const S = 0.2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const cx = Math.sin(a), cz = Math.cos(a);
      for (const tet of [A, B]) {
        for (const f of faces(tet)) {
          const p = f.map((v) => [cx + v[0]! * S, v[1]! * S, cz + v[2]! * S] as const);
          const ux = p[1]![0] - p[0]![0], uy = p[1]![1] - p[0]![1], uz = p[1]![2] - p[0]![2];
          const vx = p[2]![0] - p[0]![0], vy = p[2]![1] - p[0]![1], vz = p[2]![2] - p[0]![2];
          const ny = uz * vx - ux * vz;
          const nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
          const shade = 0.6 + 0.4 * Math.abs(ny / nl);
          const col: [number, number, number, number] = [shade, shade, shade, 1];
          g.idx.push(g.vert(...p[0]!, col), g.vert(...p[1]!, col), g.vert(...p[2]!, col));
        }
      }
    }
    const m = g.mesh(scene, "iron-stars");
    m.material = solidMat(scene, STUN);
    m.hasVertexAlpha = false;
    m.isPickable = false;
    return m;
  });
}

/** Determination's ward: a feathered gold shell that rings once round him. */
function wardTpl(scene: Scene): Mesh {
  return template(scene, "iron-ward", () => {
    const m = MeshBuilder.CreateSphere("iron-ward", { diameter: 2, segments: 12 }, scene);
    return fxMesh(scene, m, addMat(scene, GOLD, true));
  });
}

// ── Small pieces ─────────────────────────────────────────────────────────────

/** A floor glow that grows from `r0` to `r1` and brightens to `peak` over `seconds`, then holds until stopped. */
function swell(scene: Scene, follow: () => Vector3, c: Rgb, r0: number, r1: number, seconds: number, peak = 0.9): Fx {
  const m = cloneOf(scene, floorGlowTpl(scene, c), "iron-swell");
  const fx = new Fx((f) => {
    const p = follow();
    const k = easeOut(f.age / seconds);
    const r = r0 + (r1 - r0) * k;
    m.position.set(p.x, 0.03, p.z);
    m.scaling.set(r, 1, r);
    m.visibility = peak * (0.25 + 0.75 * k) * (0.85 + 0.15 * Math.sin(f.age * 24)) * f.fade;
    return true;
  }, 0.15);
  fx.own(m);
  m.visibility = 0;
  return fx;
}

/** Motes drawn IN to a point from a shell round it: power gathering before a release. */
function gather(scene: Scene, to: () => Vector3, c: Rgb, rate: number, reach = 2): Fx {
  let owed = 0;
  const pool = kitPools(scene).motes;
  return new Fx((f, dt) => {
    owed += rate * dt * f.fade;
    const p = to();
    for (; owed >= 1; owed--) {
      const a = Math.random() * TAU;
      const d = reach * rand(0.6, 1);
      const y = rand(-0.9, 0.7);
      const life = rand(0.22, 0.34);
      pool.emit({
        x: p.x + Math.sin(a) * d, y: p.y + y, z: p.z + Math.cos(a) * d,
        vx: (-Math.sin(a) * d) / life, vy: -y / life, vz: (-Math.cos(a) * d) / life,
        life, size: 0.14, thick: 0.02, stretch: 0.02,
        r: Math.min(1, c[0] * 1.3), g: Math.min(1, c[1] * 1.3), b: Math.min(1, c[2] * 1.3), a: 0.95, r1: HOT[0], g1: HOT[1], b1: HOT[2],
      });
    }
    return true;
  }, 0.05);
}

/** A cast's wind-up FX while it lasts; what it throws out comes on the sim's release edge (`releaseFx`). */
type Windup = (ctx: LookContext, body: () => ActorRef, cast: CastState) => Fx | null;
type Release = (ctx: LookContext, at: Vector3, yaw: number) => (Fx | null)[];

function castFx(windup: Windup | null): NonNullable<CastLook["start"]> {
  return (ctx, body, cast) => {
    let last = body;
    const w = windup?.(ctx, () => last, cast) ?? null;
    return {
      update(c, b) {
        last = b;
        w?.update(c.dt);
      },
      fade(c) {
        w?.stop();
        w?.update(c.dt);
        return !(w?.done ?? true);
      },
      dispose() {
        w?.dispose();
      },
    };
  };
}

/** A release thrown where he stands on the tick the cast resolved (a roll-cancelled cast never gets one). */
const releaseFx = (release: Release): NonNullable<SkillLook["release"]> =>
  (ctx, body, r) => burst(release(ctx, new Vector3(body.x, 0, body.z), yawOf(r.dirX, r.dirY)));

const chestOf = (body: () => ActorRef, h = 1.25) => () => {
  const b = body();
  return new Vector3(b.x, h, b.z);
};
const feetOf = (body: () => ActorRef) => () => {
  const b = body();
  return new Vector3(b.x, 0, b.z);
};

/** A ragged crack run from `at`, wider than the kit default so it reads from the game camera. */
const crack = (scene: Scene, at: Vector3, radius: number, o: { yaw?: number; spread?: number; branches?: number; hold?: number; width?: number } = {}) =>
  fissure(scene, at, { radius, colour: SEAM, width: o.width ?? 0.2, branches: o.branches ?? 6, hold: o.hold ?? 0.9, fade: 1, grow: 0.18, embers: 9 * radius, ...(o.yaw !== undefined ? { yaw: o.yaw, spread: o.spread ?? 1 } : {}) });

/** A dirt column thrown straight up out of a strike. */
function dirtColumn(scene: Scene, at: Vector3, size: number, n = 5): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    kitPools(scene).smoke.emit({
      x: at.x + Math.sin(a) * 0.2, y: 0.15, z: at.z + Math.cos(a) * 0.2,
      vx: Math.sin(a) * rand(0.3, 1), vy: rand(2.4, 4), vz: Math.cos(a) * rand(0.3, 1), gravity: -4, drag: 2,
      life: rand(0.7, 1.1), delay: i * 0.02, size: 0.4 * size, sizeEnd: 1.4 * size,
      r: 0.33, g: 0.27, b: 0.2, a: 0.55, r1: 0.44, g1: 0.38, b1: 0.31,
    });
  }
}

/**
 * The roar's wave wall over a wedge of `half` radians each side. Every column's alpha
 * tapers to nothing at both ends of the arc, so the wedge never shows a cut edge.
 */
function roarTpl(scene: Scene, half: number): Mesh {
  return template(scene, `iron-roar-${half.toFixed(2)}`, () => {
    const g = new Geo();
    const rows = [
      { r: 1, y: 0, c: rgba(FIRE, 0) },
      { r: 1, y: 0.16, c: rgba(HOT, 0.85) },
      { r: 1.02, y: 0.4, c: rgba(FIRE, 0.4, 1.2) },
      { r: 1.04, y: 0.65, c: rgba(FIRE, 0.55) },
      { r: 1.06, y: 1, c: rgba(EMBER, 0) },
    ];
    const segs = 40;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const yaw = -half + 2 * half * u;
      const taper = Math.sin(Math.PI * u) ** 1.2;
      for (const ring of rows) g.vert(Math.sin(yaw) * ring.r, ring.y, Math.cos(yaw) * ring.r, [ring.c[0], ring.c[1], ring.c[2], ring.c[3] * taper]);
      if (s > 0) {
        for (let k = 0; k < rows.length - 1; k++) {
          const a = (s - 1) * rows.length + k;
          g.quad(a, a + 1, a + rows.length, a + rows.length + 1);
        }
      }
    }
    return fxMesh(scene, g.mesh(scene, "iron-roar"), addMat(scene));
  });
}

/** The roar's wedge: wave walls thrown out one after another down `yaw`, soft at both sides. */
function roarCone(scene: Scene, at: Vector3, yaw: number, radius: number, half: number): Fx {
  const waves = [0, 0.09, 0.18].map((delay) => {
    const m = cloneOf(scene, roarTpl(scene, half), "iron-roar");
    m.position.set(at.x, 0.02, at.z);
    m.rotation.y = yaw;
    m.setEnabled(false);
    return { m, delay };
  });
  const fx = new Fx((f) => {
    let live = false;
    for (const w of waves) {
      const t = (f.age - w.delay) / 0.5;
      w.m.setEnabled(t >= 0 && t < 1);
      if (t >= 1) continue;
      live = true;
      if (t < 0) continue;
      const r = radius * (0.25 + 0.75 * easeOut(t));
      w.m.scaling.set(r, 1.3 * Math.sin(Math.min(1, t * 1.8) * Math.PI * 0.5) * (1 - 0.5 * t), r);
      w.m.visibility = (1 - t) ** 1.3;
    }
    return live;
  });
  for (const w of waves) fx.own(w.m);
  return fx;
}

/**
 * The cry's ring of fire: the flame crown racing out to `radius`. It starts outside his
 * body (a small bright wall at the feet reads as a white column) and sinks as it spends itself.
 */
function flameWall(scene: Scene, at: Vector3, radius: number): Fx {
  const ring = cloneOf(scene, flameRingTpl(scene), "iron-flame-wall");
  const heat = cloneOf(scene, floorGlowTpl(scene, FIRE), "iron-flame-heat");
  const dur = 0.45;
  const fx = new Fx((f) => {
    const t = f.age / dur;
    if (t >= 1) return false;
    const r = 1 + (radius - 1) * easeOut(t);
    ring.position.set(at.x, 0.02, at.z);
    ring.scaling.set(r, 1.7 * (0.5 + 0.5 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5)) * (1 - 0.55 * t), r);
    ring.rotation.y = f.age * 1.5;
    ring.visibility = 1 - t * t;
    heat.position.set(at.x, 0.025, at.z);
    heat.scaling.set(r, 1, r);
    heat.visibility = 0.55 * (1 - t);
    return true;
  });
  fx.own(ring);
  fx.own(heat);
  ring.visibility = 0;
  heat.visibility = 0;
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * TAU, d = radius * rand(0.3, 1);
    kitPools(scene).shards.emit({
      x: at.x + Math.sin(a) * d, y: 0.1, z: at.z + Math.cos(a) * d,
      vx: Math.sin(a) * 1.2, vy: rand(1, 3), vz: Math.cos(a) * 1.2, gravity: -1.5, drag: 1,
      life: rand(0.4, 0.9), delay: easeOutInv((d - 1) / (radius - 1)) * dur, size: 0.09, thick: 0.018, stretch: 0.05,
      r: HOT[0], g: HOT[1], b: HOT[2], a: 1, r1: FIRE[0] * 0.8, g1: FIRE[1] * 0.3, b1: 0.02,
    });
  }
  return fx;
}

// ── Infernal Cry ─────────────────────────────────────────────────────────────

/** He gathers fire into his chest (embers sucked in, a heat ring under him), then roars it out. */
const infernalWindup: Windup = (ctx, body, cast) => {
  const scene = ctx.scene;
  const chest = chestOf(body, 1.35);
  let pulse = 0;
  const knot = new Fx((f, dt) => {
    pulse += dt;
    if (pulse >= 0.045) {
      pulse = 0;
      const k = clamp01(f.age / Math.max(0.1, cast.windup ?? 0.4));
      core(scene, chest(), 0.35 + 0.7 * k, [1, 0.78, 0.42], FIRE, 0.1);
    }
    return true;
  }, 0.05);
  return group([gather(scene, chest, FIRE, 90, 2.2), swell(scene, feetOf(body), FIRE, 0.6, 2.2, cast.windup ?? 0.4, 0.75), knot], true);
};

/** The roar: a fire wall racing out over the whole taunt radius, a cone of flame thrown forward, embers, a scorch. */
const infernalRoar = (ctx: LookContext, at: Vector3, yaw: number, radius: number): (Fx | null)[] => {
  const scene = ctx.scene;
  const chest = new Vector3(at.x + Math.sin(yaw) * 0.4, 1.5, at.z + Math.cos(yaw) * 0.4);
  core(scene, chest, 1, [1, 0.75, 0.4], FIRE, 0.18);
  kitFlash(scene, at, 0.95, FIRE);
  sparks(scene, chest, 46, [1, 0.8, 0.4], EMBER, { yaw, cone: 0.75, speed: [6, 13], up: [-0.1, 0.35], gravity: -3, life: [0.3, 0.65], length: 0.32, thick: 0.03 });
  for (let i = 0; i < 10; i++) {
    const a = yaw + rand(-0.8, 0.8);
    puff(scene, at.x, 0, at.z, { size: 0.9, drift: rand(4, 7), rise: 0.35, yaw: a, life: rand(0.5, 0.8), alpha: 0.32, colour: [0.32, 0.2, 0.15] });
  }
  return [
    // The taunt's real reach (r 4 at level 1): the ring of fire says exactly who was caught.
    flameWall(scene, at, radius + 0.2),
    shockRing(scene, at, { radius: radius + 0.3, duration: 0.45, colour: FIRE, lip: 0.3, width: 0.2, dust: 0, flash: 0, floorFlash: false }),
    roarCone(scene, at, yaw, radius + 1, 0.75),
    // A brief burn, not a stain: the glow is gone in ~0.3 s and the dark in ~1 s.
    scorch(scene, at, { radius: 1.6, hold: 0.4, fade: 0.6, alpha: 0.4, glow: FIRE }),
    shake(ctx, 0.5),
  ];
};

/** The buff: a crown of flame tongues licking round his feet and embers lifting off him; it gutters in its last 1.5 s. */
const infernalBuff = {
  create(ctx: LookContext, s: AttachedState): FxHandle<AttachedState> {
    const scene = ctx.scene;
    const ring = cloneOf(scene, flameRingTpl(scene), "iron-flame-ring");
    const floor = floorOf(s.body.node);
    let remaining = s.remaining;
    let embers = 0;
    const pool = kitPools(scene).motes;
    const fx = new Fx((f, dt) => {
      const p = floor();
      const gutter = remaining > 0 && remaining < 1.5 ? 0.55 + 0.45 * Math.abs(Math.sin(f.age * 13)) : 1;
      const k = clamp01(f.age / 0.3) * f.fade * gutter;
      ring.position.set(p.x, 0.02, p.z);
      const breathe = 1 + 0.08 * Math.sin(f.age * 7);
      ring.scaling.set(0.75 * breathe, 1 + 0.35 * Math.sin(f.age * 9.3), 0.75 * breathe);
      ring.rotation.y = f.age * 0.9;
      ring.visibility = 0.9 * k;
      embers += dt * 14 * k;
      for (; embers >= 1; embers--) {
        const a = Math.random() * TAU;
        const d = rand(0.15, 0.5);
        pool.emit({
          x: p.x + Math.sin(a) * d, y: rand(0.2, 1.6), z: p.z + Math.cos(a) * d,
          vx: rand(-0.2, 0.2), vy: rand(0.8, 1.6), vz: rand(-0.2, 0.2), gravity: 0.3, drag: 0.6, life: rand(0.45, 0.8),
          size: 0.07, thick: 0.018, stretch: 0.05, r: 1, g: 0.75, b: 0.35, a: 0.95, r1: EMBER[0], g1: EMBER[1], b1: EMBER[2],
        });
      }
      return true;
    }, 0.3);
    fx.own(ring);
    const h = attached(fx);
    return { ...h, update(c, st) { remaining = st.remaining; h.update!(c, st); } };
  },
};

// ── Leap Slam ────────────────────────────────────────────────────────────────

/** Crouch before the spring: dust pressed out from his feet, a ring of heat gathering under them. */
const leapWindup: Windup = (ctx, body, cast) => {
  const feet = feetOf(body)();
  for (let i = 0; i < 8; i++) puff(ctx.scene, feet.x, 0, feet.z, { size: 0.55, drift: rand(1.5, 2.5), rise: 0.1, yaw: (i / 8) * TAU, alpha: 0.28 });
  return swell(ctx.scene, feetOf(body), EARTH, 0.4, 1.1, cast.windup ?? 0.2, 0.6);
};

const leapTravel: TravelLook = {
  // A 60-degree camera halves a height on screen: 2.2 up reads as a real leap over 7 units.
  arcHeight: 2.2,
  clip: "aerialA",
  face: "travel",
  start(ctx, body, t) {
    const scene = ctx.scene;
    const node = body.node;
    const from = new Vector3(body.x, 0, body.z);
    const trail = leapArcTrail(scene, node, { dust: 12 });
    const heat = ribbonTrail(scene, node, { colour: [1, 0.55, 0.2], life: 0.28, height: 1.2, width: 0.55, lift: 0.35, alpha: 0.45, motes: 3 });
    const shadow = cloneOf(scene, shadowTpl(scene), "iron-shadow");
    const reticle = cloneOf(scene, reticleTpl(scene), "iron-reticle");
    reticle.setEnabled(false);
    const landing = new Vector3();
    let age = 0;
    const children = [trail, heat];
    const place = (b: ActorRef, tr: TravelState) => {
      const lift = 4 * 2.2 * tr.progress * (1 - tr.progress);
      shadow.position.set(b.x, 0.025, b.z);
      const s = 0.85 - 0.25 * (lift / 2.2);
      shadow.scaling.set(s, 1, s);
      shadow.visibility = 0.9 - 0.35 * (lift / 2.2);
      // Where he comes down, from how far he has come: honest once a little of the arc is behind him.
      if (tr.progress > 0.06) {
        const k = 1 / tr.progress;
        landing.set(from.x + (b.x - from.x) * k, 0.03, from.z + (b.z - from.z) * k);
        reticle.setEnabled(true);
        reticle.position.copyFrom(landing);
        const r = 2.5 * (1 + 0.6 * (1 - tr.progress));
        reticle.scaling.set(r, 1, r);
        reticle.rotation.y = age * 2.4;
        reticle.visibility = 0.25 + 0.75 * tr.progress ** 1.5;
      }
    };
    place(body, t);
    return {
      update(c, s) {
        age += c.dt;
        for (const f of children) f.update(c.dt);
        place(s.body, s.travel);
      },
      fade(c) {
        shadow.setEnabled(false);
        reticle.setEnabled(false);
        for (const f of children) {
          f.stop();
          f.update(c.dt);
        }
        return children.some((f) => !f.done);
      },
      dispose() {
        for (const f of children) f.dispose();
        shadow.dispose();
        reticle.dispose();
      },
    };
  },
};

/** He comes down: the class's loudest moment with the aftershock. */
function leapLanding(ctx: LookContext, a: AreaState): BurstHandle {
  const scene = ctx.scene;
  const at = new Vector3(a.x, 0, a.y);
  const R = Math.max(1.5, a.radius);
  core(scene, new Vector3(at.x, 0.45, at.z), R * 0.8, HOT, FIRE, 0.2);
  sparks(scene, new Vector3(at.x, 0.2, at.z), 30, HOT, FIRE, { speed: [3, 8], up: [0.5, 1.6], gravity: -10, length: 0.24, thick: 0.03 });
  throwChunks(scene, "rock", at, { count: 26, speed: [1.2, 4], up: [3.5, 8], size: [0.1, 0.34], spread: 0.6 });
  dirtColumn(scene, at, R / 2.5, 6);
  kitFlash(scene, at, 1, FIRE);
  return burst([
    landingImpact(scene, at, { radius: R * 1.2, colour: [0.9, 0.74, 0.5], glow: FIRE, chunks: 18, dust: 26, flash: 0 }),
    shockRing(scene, at, { radius: R * 1.45, duration: 0.36, colour: EARTH, lip: 0.85, width: 0.3, dust: 12, flash: 0 }),
    crack(scene, at, R * 1.2, { branches: 8, width: 0.22, hold: 0.8 }),
    scorch(scene, at, { radius: R * 0.75, hold: 2, glow: FIRE }),
    shake(ctx, 0.8),
  ]);
}

// ── Earthquake ───────────────────────────────────────────────────────────────

/** The overhead wind-up: the floor where the blade will land heats and trembles, pebbles hop. */
const quakeWindup: Windup = (ctx, body, cast) => {
  const scene = ctx.scene;
  const strike = () => {
    const b = body();
    return new Vector3(b.x + cast.dirX * 1.2, 0, b.z + cast.dirY * 1.2);
  };
  const total = Math.max(0.2, cast.windup ?? 1);
  let hop = 0, dust = 0;
  const tremble = new Fx((f, dt) => {
    const k = clamp01(f.age / total);
    hop += dt;
    if (hop > 0.1 - 0.05 * k) {
      hop = 0;
      throwChunks(scene, "rock", strike(), { count: 2, speed: [0.2, 0.7], up: [1 + 2 * k, 2 + 3 * k], size: [0.03, 0.08], spread: 1.3 });
    }
    dust += dt * 5 * k * f.fade;
    for (; dust >= 1; dust--) {
      const b = body();
      const a = Math.random() * TAU;
      puff(scene, b.x + Math.sin(a) * 1.5, 0, b.z + Math.cos(a) * 1.5, { size: 0.5, drift: 0.4, rise: 0.2, alpha: 0.22 });
    }
    return true;
  }, 0.05);
  return group([swell(scene, strike, SEAM, 0.3, 1.4, total, 0.85), tremble], true);
};

/** The cone: a wedge of force out of the blade, the earth cracking open along it and holding its glow for the aftershock. */
function quakeCone(ctx: LookContext, a: AreaState): BurstHandle {
  const scene = ctx.scene;
  const at = new Vector3(a.x, 0, a.y);
  const yaw = yawOf(a.dirX, a.dirY);
  const half = ((a.arc || 90) / 2) * (Math.PI / 180);
  const strike = new Vector3(a.x + a.dirX * 1.1, 0, a.y + a.dirY * 1.1);
  const L = a.radius;
  const dur = 0.32;
  kitFlash(scene, strike, 0.75, SEAM);
  // Small: a big hot core at the hammer whites out the body swinging it.
  core(scene, new Vector3(strike.x, 0.3, strike.z), 0.8, [1, 0.75, 0.38], SEAM, 0.14);
  throwChunks(scene, "rock", strike, { count: 14, speed: [1, 3], up: [4, 7], size: [0.1, 0.3], spread: 0.3 });
  sparks(scene, new Vector3(strike.x, 0.2, strike.z), 26, HOT, FIRE, { yaw, cone: half, speed: [3, 8], up: [0.5, 1.4], gravity: -10, length: 0.26 });
  dirtColumn(scene, strike, 0.8, 5);
  return burst([
    // The front runs out down the wedge as a standing wall of force, rock and dust thrown where it passes.
    coneWave(scene, at, a.dirX, a.dirY, { length: L * 1.05, half, duration: dur, colour: EARTH, chunks: 40, dustRows: 5, lip: 1.1, flash: 0 }),
    shockRing(scene, at, { radius: L, duration: dur * 1.2, colour: SEAM, width: 0.6, lip: 0, dust: 0, flash: 0, floorFlash: false, arc: { yaw, half } }),
    // Held glowing through the second: the cracks are the aftershock's fuse.
    crack(scene, at, L * 1.1, { yaw, spread: half * 0.95, branches: 7, hold: 1.15, width: 0.24 }),
    crack(scene, strike, 1.4, { branches: 5, hold: 1.15, width: 0.2 }),
    shake(ctx, 0.45),
  ]);
}

/** The aftershock building: the disc it will cover lights from below, faster and brighter as it nears; rubble hops. */
function quakeWarn(ctx: LookContext, a: AreaState): FxHandle<AreaState> {
  const scene = ctx.scene;
  const glow = cloneOf(scene, floorGlowTpl(scene, SEAM), "iron-quake-glow");
  const edge = cloneOf(scene, edgeTpl(scene, SEAM), "iron-quake-edge");
  const total = Math.max(0.1, a.impactIn);
  let age = 0, hop = 0, dust = 0, motes = 0;
  const pool = kitPools(scene).motes;
  const place = (s: AreaState, dt: number) => {
    age += dt;
    const p = clamp01(1 - s.impactIn / total);
    const throb = 0.75 + 0.25 * Math.sin(age * (6 + 26 * p));
    glow.position.set(s.x, 0.03, s.y);
    glow.scaling.set(s.radius * 1.05, 1, s.radius * 1.05);
    glow.visibility = (0.12 + 0.6 * p * p) * throb;
    edge.position.set(s.x, 0.03, s.y);
    edge.scaling.set(s.radius, 1 + 2 * p, s.radius);
    edge.visibility = (0.2 + 0.8 * p) * throb;
    const at = new Vector3(s.x, 0, s.y);
    hop += dt;
    if (hop > 0.12 - 0.07 * p) {
      hop = 0;
      throwChunks(scene, "rock", at, { count: 2 + Math.round(3 * p), speed: [0.1, 0.5], up: [1 + 3 * p, 2 + 4 * p], size: [0.03, 0.1], spread: s.radius * 0.9 });
    }
    dust += dt * 7 * p;
    for (; dust >= 1; dust--) {
      const r = s.radius * Math.sqrt(Math.random()), t = Math.random() * TAU;
      puff(scene, s.x + Math.sin(t) * r, 0, s.y + Math.cos(t) * r, { size: 0.5, drift: 0.3, rise: 0.25, alpha: 0.2 });
    }
    motes += dt * 30 * p;
    for (; motes >= 1; motes--) {
      const r = s.radius * Math.sqrt(Math.random()), t = Math.random() * TAU;
      pool.emit({
        x: s.x + Math.sin(t) * r, y: 0.04, z: s.y + Math.cos(t) * r, vy: rand(0.8, 1.8), drag: 0.4, life: rand(0.35, 0.6),
        size: 0.08, thick: 0.02, stretch: 0.04, r: 1, g: 0.75, b: 0.35, a: 0.95, r1: EMBER[0], g1: EMBER[1], b1: EMBER[2],
      });
    }
  };
  place(a, 0);
  return { update: (c, s) => place(s, c.dt), dispose: () => { glow.dispose(); edge.dispose(); } };
}

/** One column of molten light shooting up out of the floor, with a fountain of sparks and slag. */
function geyser(scene: Scene, at: Vector3, height: number, delay: number): Fx {
  const m = cloneOf(scene, geyserTpl(scene), "iron-geyser");
  m.setEnabled(false);
  let fired = false;
  const fx = new Fx((f) => {
    const t = f.age - delay;
    if (t < 0) return true;
    if (!fired) {
      fired = true;
      m.setEnabled(true);
      core(scene, new Vector3(at.x, 0.3, at.z), 0.9, [1, 0.72, 0.34], SEAM, 0.16);
      sparks(scene, new Vector3(at.x, 0.2, at.z), 12, HOT, FIRE, { speed: [1, 3], up: [2, 4], gravity: -12, life: [0.4, 0.8], length: 0.2 });
      throwChunks(scene, "molten", at, { count: 3, speed: [0.5, 1.5], up: [5, 9], size: [0.06, 0.14], spread: 0.2 });
    }
    const rise = easeOut(t / 0.12);
    const fall = clamp01((t - 0.12) / 0.45);
    m.position.set(at.x, 0.01, at.z);
    m.scaling.set(1 - 0.5 * fall, height * rise * (1 - 0.3 * fall), 1 - 0.5 * fall);
    m.visibility = (1 - fall) ** 1.5;
    return t < 0.6;
  });
  fx.own(m);
  return fx;
}

/** The aftershock: the floor erupts. The class's loudest moment. */
function quakeAftershock(ctx: LookContext, a: AreaState): BurstHandle {
  const scene = ctx.scene;
  const at = new Vector3(a.x, 0, a.y);
  const R = a.radius;
  const geysers: Fx[] = [geyser(scene, at, 3.4, 0)];
  for (let i = 0; i < 7; i++) {
    const t = (i / 7) * TAU + rand(-0.3, 0.3), d = R * rand(0.35, 0.85);
    geysers.push(geyser(scene, new Vector3(at.x + Math.sin(t) * d, 0, at.z + Math.cos(t) * d), rand(1.8, 3), 0.03 + d * 0.04));
  }
  core(scene, new Vector3(at.x, 0.5, at.z), R * 0.7, [1, 0.72, 0.34], SEAM, 0.2);
  sparks(scene, new Vector3(at.x, 0.2, at.z), 34, [1, 0.8, 0.45], FIRE, { speed: [2, 7], up: [0.6, 1.6], gravity: -10, length: 0.24 });
  throwChunks(scene, "rock", at, { count: 30, speed: [1.2, 4], up: [5, 9.5], size: [0.12, 0.4], spread: R * 0.7 });
  dirtColumn(scene, at, R / 2, 8);
  kitFlash(scene, at, 1, SEAM);
  return burst([
    shockRing(scene, at, { radius: R * 1.35, duration: 0.45, colour: EARTH, lip: 1, width: 0.3, dust: 20, flash: 0 }),
    crack(scene, at, R * 1.2, { branches: 9, width: 0.24, hold: 0.9 }),
    scorch(scene, at, { radius: R * 0.9, hold: 2, glow: SEAM }),
    ...geysers,
    shake(ctx, 1),
  ]);
}

// ── Determination ────────────────────────────────────────────────────────────

const determinationWindup: Windup = (ctx, body, cast) =>
  group([swell(ctx.scene, feetOf(body), GOLD, 0.3, 1.4, cast.windup ?? 0.3, 0.55), gather(ctx.scene, chestOf(body, 1), GOLD, 30, 1.6)], true);

const BREATH_S = 3.2;
/** The steady aura runs for minutes: half the brightness of a hit. The cast's ring and ward keep full gold. */
const GOLD_CALM: Rgb = [0.5, 0.37, 0.15];

/** The aura: an iron-gold rune ring that settles under him, rung in by a ward shell; then a slow breath every few seconds. */
const determinationBuff = {
  create(ctx: LookContext, s: AttachedState): FxHandle<AttachedState> {
    const scene = ctx.scene;
    const floor = floorOf(s.body.node);
    const sigil = auraSigil(scene, floor, { radius: 1.8, colour: GOLD_CALM, runes: 12, motes: 2, spin: 0.15 });
    const ward = cloneOf(scene, wardTpl(scene), "iron-ward");
    const ring = shockRing(scene, floor().clone(), { radius: 2.1, duration: 0.5, colour: GOLD, lip: 0.4, width: 0.25, dust: 6, flash: 0.35 });
    const breath = cloneOf(scene, edgeTpl(scene, GOLD), "iron-breath");
    const fx = new Fx((f) => {
      const p = floor();
      const t = clamp01(f.age / 0.55);
      ward.setEnabled(t < 1);
      ward.position.set(p.x, 0.9, p.z);
      const r = 0.5 + 0.7 * easeOut(t);
      ward.scaling.set(r, r * 1.05, r);
      ward.visibility = 0.5 * (1 - t);
      // A slow breath out to the ring's edge every BREATH_S: steady, never busy.
      const b = clamp01(((f.age + BREATH_S - 1) % BREATH_S) / 1.4);
      const br = 0.6 + 1.35 * easeOut(b);
      breath.position.set(p.x, 0.03, p.z);
      breath.scaling.set(br, 0.6, br);
      breath.visibility = 0.22 * Math.sin(Math.PI * b) * f.fade * clamp01((f.age - 0.6) / 0.4);
      return true;
    }, 0.4);
    fx.own(breath);
    fx.own(ward);
    fx.child(sigil);
    fx.child(ring);
    return attached(fx);
  },
};

// ── Sunder ───────────────────────────────────────────────────────────────────

const sunderWindup: Windup = (ctx, body, cast) => swell(ctx.scene, feetOf(body), SEAM, 0.3, 1, cast.windup ?? 0.4, 0.6);

/** A pending burst: its spot heats under the floor as its turn comes. */
function sunderWarn(ctx: LookContext, a: AreaState): FxHandle<AreaState> {
  const scene = ctx.scene;
  const glow = cloneOf(scene, floorGlowTpl(scene, SEAM), "iron-sunder-glow");
  const total = Math.max(0.05, a.impactIn);
  const place = (s: AreaState) => {
    const p = clamp01(1 - s.impactIn / total);
    glow.position.set(s.x, 0.03, s.y);
    const r = s.radius * (0.3 + 0.5 * p);
    glow.scaling.set(r, 1, r);
    glow.visibility = 0.2 + 0.7 * p;
  };
  place(a);
  return { update: (_c, s) => place(s), dispose: () => glow.dispose() };
}

/** Rock fangs punching up out of the floor, holding, then sinking back. */
function fangs(scene: Scene, at: Vector3, yaw: number, size: number): Fx {
  const m = cloneOf(scene, fangsTpl(scene), "iron-fangs");
  m.position.set(at.x, 0, at.z);
  m.rotation.y = yaw + rand(-0.6, 0.6);
  if (Math.random() < 0.5) m.scaling.x = -1;
  const sx = Math.sign(m.scaling.x);
  const fx = new Fx((f) => {
    const up = f.age / 0.07;
    const k = up < 1 ? easeOut(up) * 1.18 : 1 + 0.18 * Math.max(0, 1 - (f.age - 0.07) / 0.08);
    const sink = clamp01((f.age - 0.6) / 0.4);
    m.scaling.set(sx * size, size * k * (1 - 0.15 * sink), size);
    m.position.y = -size * sink * 1.05;
    return f.age < 1;
  });
  fx.own(m);
  return fx;
}

/** One burst of the line, louder down it: the last one is the payoff. */
function sunderBurst(ctx: LookContext, a: AreaState): BurstHandle {
  const scene = ctx.scene;
  const at = new Vector3(a.x, 0, a.y);
  const i = Math.min(a.index, 6);
  const grow = 1 + 0.15 * i;
  const yaw = yawOf(a.dirX, a.dirY);
  core(scene, new Vector3(at.x, 0.35, at.z), 0.95 * grow, [1, 0.8, 0.5], SEAM, 0.14);
  sparks(scene, new Vector3(at.x, 0.2, at.z), 14 + 2 * i, HOT, FIRE, { speed: [2, 5], up: [0.8, 1.8], gravity: -10, length: 0.2, thick: 0.026 });
  throwChunks(scene, "rock", at, { count: 14 + 3 * i, speed: [0.8, 3], up: [4, 8], size: [0.08, 0.3 * grow], spread: 0.5 });
  dirtColumn(scene, at, 0.7 * grow, 4);
  kitFlash(scene, at, 0.45 + 0.07 * i, SEAM);
  return burst([
    fangs(scene, at, yaw, 0.95 * grow),
    shockRing(scene, at, { radius: a.radius * 1.3 * grow, duration: 0.3, colour: EARTH, lip: 0.55, width: 0.3, dust: 8, flash: 0 }),
    crack(scene, at, 1.4 * grow, { yaw, spread: 0.9, branches: 4, hold: 0.5, width: 0.2 }),
    shake(ctx, 0.25 + 0.07 * i),
  ]);
}

// ── Blood Rage ───────────────────────────────────────────────────────────────

const bloodWindup: Windup = (ctx, body, cast) =>
  group([gather(ctx.scene, chestOf(body, 1.2), BLOOD, 70, 1.8), swell(ctx.scene, feetOf(body), BLOOD, 0.4, 1.4, cast.windup ?? 0.3, 0.7)], true);

/** The frenzy takes him: a red ring blown out, blood sprayed, mist. */
const bloodRelease: Release = (ctx, at) => {
  const scene = ctx.scene;
  const chest = new Vector3(at.x, 1.2, at.z);
  core(scene, chest, 1.3, [1, 0.35, 0.28], [0.6, 0, 0], 0.2);
  const drops = kitPools(scene).drops;
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * TAU, sp = rand(2, 5);
    drops.emit({
      x: at.x, y: rand(0.9, 1.5), z: at.z, vx: Math.sin(a) * sp, vy: rand(1, 3.5), vz: Math.cos(a) * sp, gravity: -12,
      life: rand(0.45, 0.8), size: rand(0.04, 0.08), r: 0.5, g: 0.02, b: 0.02, a: 1, r1: 0.3, g1: 0.01, b1: 0.01,
    });
  }
  for (let i = 0; i < 10; i++) puff(scene, at.x, 0.4, at.z, { size: 0.8, drift: rand(2, 3.5), rise: 0.5, yaw: (i / 10) * TAU, alpha: 0.42, colour: [0.5, 0.03, 0.02] });
  return [
    shockRing(scene, at, { radius: 2.6, duration: 0.38, colour: BLOOD, lip: 0.55, width: 0.3, dust: 0, flash: 0.55 }),
    shake(ctx, 0.3),
  ];
};

/** The buff: mist on a racing heartbeat, and veins of red light up his body throbbing on the same beat. */
const bloodBuff = {
  create(ctx: LookContext, s: AttachedState): FxHandle<AttachedState> {
    const scene = ctx.scene;
    const floor = floorOf(s.body.node);
    const BPM = 110;
    const period = 60 / BPM;
    const mist = bloodMist(scene, floor, { radius: 0.75, height: 1.8, colour: [0.55, 0.03, 0.02], bpm: BPM, drops: 6 });
    const veins = cloneOf(scene, veinsTpl(scene), "iron-veins");
    let remaining = s.remaining;
    const fx = new Fx((f) => {
      const p = floor();
      const phase = (f.age % period) / period;
      const beat = Math.min(1.2, Math.exp(-phase * 25) + 0.6 * Math.exp(-Math.abs(phase - 0.2) * 35));
      const gutter = remaining > 0 && remaining < 1.5 ? 0.5 + 0.5 * Math.abs(Math.sin(f.age * 11)) : 1;
      const k = clamp01(f.age / 0.25) * f.fade * gutter;
      veins.position.set(p.x, 0, p.z);
      const r = 0.42 * (1 + 0.05 * beat);
      veins.scaling.set(r, 1.75, r);
      veins.rotation.y = f.age * 0.4;
      veins.visibility = k * (0.3 + 0.7 * beat);
      return true;
    }, 0.4);
    fx.own(veins);
    fx.child(mist);
    const h = attached(fx);
    return { ...h, update(c, st) { remaining = st.remaining; h.update!(c, st); } };
  },
};

// ── Statuses ─────────────────────────────────────────────────────────────────

const heightOf = (radius: number, boss: boolean): number => Math.max(1.1, radius * 3.2) * (boss ? 1.15 : 1);

const scorched: StatusLook = {
  create: (ctx, s) => attached(emberSmoulder(ctx.scene, s.body.node, { radius: s.radius, height: heightOf(s.radius, s.boss), colour: FIRE })),
};

const taunted: StatusLook = {
  create: (ctx, s) => attached(tauntRage(ctx.scene, s.body.node, { radius: Math.max(0.45, s.radius), height: heightOf(s.radius, s.boss), colour: [1, 0.2, 0.05], period: 0.7 })),
};

/** Stunned: big bright stars wheeling over the head, a dazed halo, and a crack of light as it lands. */
const stunned: StatusLook = {
  create(ctx, s) {
    const scene = ctx.scene;
    const node = s.body.node;
    const H = heightOf(s.radius, s.boss);
    const orbit = Math.max(0.55, s.radius * 1.1);
    const stars = cloneOf(scene, starsTpl(scene), "iron-stars");
    const halo = cloneOf(scene, haloTpl(scene), "iron-halo");
    const head = node.getAbsolutePosition();
    core(scene, new Vector3(head.x, H + 0.25, head.z), 0.9, [1, 1, 0.85], STUN, 0.14);
    sparks(scene, new Vector3(head.x, H + 0.25, head.z), 8, [1, 1, 0.8], STUN, { speed: [1.5, 3], up: [0.2, 0.9], gravity: -4, length: 0.14 });
    const fx = new Fx((f) => {
      const p = node.getAbsolutePosition();
      const k = clamp01(f.age / 0.2) * f.fade;
      halo.position.set(p.x, p.y + H + 0.22 + 0.05 * Math.sin(f.age * 6), p.z);
      halo.scaling.set(orbit * k, 1, orbit * k);
      halo.rotation.set(0.25 * Math.sin(f.age * 2), -f.age * 3, 0.25 * Math.cos(f.age * 2));
      halo.visibility = 0.85 * k;
      stars.position.set(p.x, p.y + H + 0.3 + 0.06 * Math.sin(f.age * 6), p.z);
      stars.scaling.set(orbit * k, orbit * k, orbit * k);
      stars.rotation.set(0.25 * Math.sin(f.age * 2), f.age * 4.5, 0.25 * Math.cos(f.age * 2));
      return true;
    }, 0.3);
    fx.own(halo);
    fx.own(stars);
    // The monster's node going takes the halo with it, as the kit's statuses do.
    const gone = node.onDisposeObservable.addOnce(() => fx.dispose());
    fx.onDispose(() => node.onDisposeObservable.remove(gone));
    return attached(fx);
  },
};

// ── Table ────────────────────────────────────────────────────────────────────

const earthquakeArea: AreaLook = {
  warn: (ctx, a) => (a.shape === "disc" ? quakeWarn(ctx, a) : { dispose() {} }),
  impact: (ctx, a) => (a.shape === "cone" ? quakeCone(ctx, a) : quakeAftershock(ctx, a)),
};

/**
 * Clips and release fractions, measured off anim-library.glb:
 * - MonsterTransformation: arms up, then slammed down into a wide crouch at 0.25-0.28.
 * - NinjaJump_Start: the spring off a crouch at 0.03-0.05; Sword_Aerial_A over the flight raises the blade at the
 *   apex and brings it round on the way down.
 * - Sword_GroundPound (the shared "slam"): heaved up to 0.14, the hands on the floor at 0.31.
 * - Sword_Block: the guard is set by 0.12-0.24.
 * - Sword_Heavy_B: the diagonal chop lands at 0.32-0.37.
 * - LiftAir (upper body): arched back, head thrown up and arms spread by 0.55-0.7.
 */
export const IRONSWORN_LOOKS: ClassSkillLooks = {
  skills: {
    // The roar is the cry's marker area (the sim's applyStatus): centred and sized by the sim, curse or no curse.
    "skill.infernal_cry.v1": {
      cast: { clip: "transform", release: 0.26, start: castFx(infernalWindup) },
      area: { impact: (ctx, a) => burst(infernalRoar(ctx, new Vector3(a.x, 0, a.y), yawOf(a.dirX, a.dirY), a.radius)) },
    },
    "skill.leap_slam.v1": {
      cast: { clip: "ninjaJumpStart", release: 0.05, start: castFx(leapWindup) },
      travel: leapTravel,
      area: { impact: leapLanding },
    },
    // The ground pound, paced as a strike: Sword_Heavy_D is a level swing that never reaches the floor.
    "skill.earthquake.v1": { cast: { clip: "slam", start: castFx(quakeWindup) }, area: earthquakeArea },
    "skill.determination.v1": { cast: { clip: "block", release: 0.2, start: castFx(determinationWindup) } },
    "skill.sunder.v1": { cast: { clip: "heavyB", release: 0.35, start: castFx(sunderWindup) }, area: { warn: sunderWarn, impact: sunderBurst } },
    "skill.blood_rage.v1": { cast: { clip: "liftAir", release: 0.6, start: castFx(bloodWindup) }, release: releaseFx(bloodRelease) },
  },
  buffs: {
    infernal_cry: infernalBuff,
    determination: determinationBuff,
    blood_rage: bloodBuff,
  },
  statuses: { scorched, taunted, stunned },
};
