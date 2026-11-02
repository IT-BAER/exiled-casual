import { Color3, FresnelParameters, Material, MeshBuilder, PointLight, Quaternion, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene, TransformNode } from "@babylonjs/core";
import {
  addMat, blendMat, clamp01, cloneOf, core, easeOut, embers, fire, fissure, flameTrailPatch, Fx, fxMesh, Geo, kitFlash, kitPools,
  landingImpact, meteorBody, puff, pulseRingTemplate, ragged, rand, rgba, ribbonTrail, scorch, shockRing, skyFall, sparks,
  TAU, template, throwChunks, type Rgb,
} from "./kit";
import { orbLight } from "../skill-fx";
import type {
  ActorRef, AreaState, AttachedState, BurstHandle, ClassSkillLooks, FxHandle, GroundState, LookContext, StatusLook,
} from "./types";

/**
 * The Emberbound's six (spec 2026-11-01 section 1), composed from the kit plus
 * this file's own geometry: tall flame-tongue crowns (a nova reads by its
 * tongues, not by a flat ring), rune circles, ash beds and a meteor's wake.
 * Every piece is real geometry or pooled particles; nothing faces the camera.
 */

const HOT: Rgb = [1, 0.9, 0.6];
const FIRE: Rgb = [1, 0.45, 0.1];
const DEEP: Rgb = [0.85, 0.2, 0.04];
const SUN: Rgb = [1, 0.62, 0.18];
const CURSE: Rgb = [1, 0.4, 0.06];
const ASH: Rgb = [0.3, 0.28, 0.27];

const floorAt = (x: number, z: number, y = 0) => new Vector3(x, y, z);
const posOf = (b: ActorRef) => b.node.getAbsolutePosition();

/** A kit one-shot run by the dispatcher until it is done. */
function burst(fx: Fx): BurstHandle {
  return { update: (ctx) => { fx.update(ctx.dt); return !fx.done; }, dispose: () => fx.dispose() };
}

/** A lasting kit effect as a look handle: updated with the dispatcher's state, stopped and run out on fade. */
function lasting<S>(fx: Fx, onUpdate?: (ctx: LookContext, s: S) => void, onStop?: () => void, fadeMax = 1.5): FxHandle<S> {
  let stopped = false;
  return {
    update(ctx, s) { onUpdate?.(ctx, s); fx.update(ctx.dt); },
    fade(ctx, seconds) {
      if (!stopped) { stopped = true; onStop?.(); fx.stop(); }
      fx.update(ctx.dt);
      return !fx.done && seconds < fadeMax;
    },
    dispose: () => fx.dispose(),
  };
}

/** A tiny repeatable generator, so a template looks the same however often it is built. */
function seeded(seed: number): () => number {
  let s = (seed * 7919 + 104729) % 233280;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

// ── Geometry ───────────────────────────────────────────────────────────────────

/** Tall tongues of flame stood on a unit ring; scaled (radius, height, radius) it races out. Two seeds flicker against each other. */
function crownTemplate(scene: Scene, seed: number): Mesh {
  return template(scene, `eb-crown-${seed}`, () => {
    const g = new Geo();
    const rnd = seeded(seed + 1);
    const N = 30;
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5 * seed) / N) * TAU;
      const h = 0.5 + 0.5 * rnd();
      const w = 0.05 * (0.75 + 0.5 * rnd());
      g.lathe([
        { r: w * 0.9, y: 0, c: rgba(HOT, 0) },
        { r: w, y: 0.05 * h, c: rgba(HOT, 0.95) },
        { r: w * 0.85, y: 0.32 * h, c: rgba(FIRE, 0.9, 1.25) },
        { r: w * 0.45, y: 0.68 * h, c: rgba(FIRE, 0.55, 0.9) },
        { r: 0, y: h, c: rgba(DEEP, 0) },
      ], 6, 0, TAU, { cx: Math.sin(a), cz: Math.cos(a) });
    }
    return fxMesh(scene, g.mesh(scene, "eb-crown"), addMat(scene));
  });
}

/**
 * A crown of flame tongues racing out from `at` to `radius`, standing `height`
 * at its peak, with embers thrown off its front. Unlike the kit nova's wall it
 * is separate tongues, which is what reads from the game camera.
 */
function flameCrown(scene: Scene, at: Vector3, o: { radius: number; height: number; duration: number; delay?: number; embers?: number }): Fx {
  const a = cloneOf(scene, crownTemplate(scene, 0), "eb-crown-a");
  const b = cloneOf(scene, crownTemplate(scene, 1), "eb-crown-b");
  const yaw = Math.random() * TAU;
  for (const m of [a, b]) { m.position.set(at.x, at.y + 0.02, at.z); m.rotation.y = yaw; m.setEnabled(false); }
  const delay = o.delay ?? 0;
  const rate = o.embers ?? 70;
  let owed = 0;
  const pool = kitPools(scene).shards;
  const fx = new Fx((f, dt) => {
    const t = (f.age - delay) / o.duration;
    if (t < 0) return true;
    if (t >= 1) return false;
    const r = o.radius * (0.12 + 0.88 * easeOut(t));
    const h = o.height * Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * (1 - t * t * 0.85);
    const lick = Math.sin(f.age * 38);
    a.setEnabled(true); b.setEnabled(true);
    a.scaling.set(r, h * (0.9 + 0.1 * lick), r);
    b.scaling.set(r * 1.02, h * (0.9 - 0.1 * lick), r * 1.02);
    a.visibility = (0.6 + 0.4 * lick) * (1 - t * t);
    b.visibility = (0.6 - 0.4 * lick) * (1 - t * t);
    owed += rate * dt;
    for (; owed >= 1; owed--) {
      const ang = Math.random() * TAU;
      pool.emit({
        x: at.x + Math.sin(ang) * r, y: at.y + rand(0.1, 0.6) * h, z: at.z + Math.cos(ang) * r,
        vx: Math.sin(ang) * rand(2, 4.5), vy: rand(1, 3), vz: Math.cos(ang) * rand(2, 4.5), gravity: -4, drag: 1.2,
        life: rand(0.35, 0.7), size: 0.1, thick: 0.022, stretch: 0.05,
        r: HOT[0], g: HOT[1], b: HOT[2], a: 1, r1: DEEP[0], g1: DEEP[1], b1: DEEP[2],
      });
    }
    return true;
  });
  fx.own(a);
  fx.own(b);
  return fx;
}

/**
 * A rune circle: concentric rings, a band of runic ticks, flame glyphs and a flame
 * sigil at the heart. No star figure: a pentagram or hexagram reads as a religious
 * symbol. `hot` is additive light, else alpha-blended ink that keeps its colour on sand.
 */
function runeTemplate(scene: Scene, hot: boolean): Mesh {
  return template(scene, `eb-rune-${hot ? "hot" : "ink"}`, () => {
    const g = new Geo();
    const c = hot ? FIRE : CURSE;
    const band = (r0: number, r1: number, al: number) =>
      g.lathe([{ r: r0, y: 0, c: rgba(c, 0) }, { r: (r0 + r1) / 2, y: 0.01, c: rgba(c, al, 1.3) }, { r: r1, y: 0, c: rgba(c, 0) }], 72);
    const line = (ax: number, az: number, bx: number, bz: number, w: number) => g.strip([[ax, az, w, 1], [bx, bz, w, 1]], c, 0.008);
    band(0.94, 1.0, 1);
    band(0.82, 0.87, 0.9);
    band(0.6, 0.63, 0.7);
    band(0.34, 0.38, 0.85);
    // Runic ticks between the middle rings, long and short in an uneven beat.
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      const r1 = i % 5 === 0 ? 0.79 : i % 2 ? 0.7 : 0.74;
      line(Math.sin(a) * 0.65, Math.cos(a) * 0.65, Math.sin(a) * r1, Math.cos(a) * r1, i % 5 === 0 ? 0.012 : 0.007);
    }
    // The heart: a flame, an outer tongue round an inner one.
    const flame = (s: number, w: number) => {
      const pts: [number, number, number, number][] = [];
      for (let k = 0; k <= 16; k++) {
        const u = k / 16, side = u < 0.5 ? -1 : 1, v = u < 0.5 ? u * 2 : (1 - u) * 2; // v: 0 at the tip, 1 at the base
        const zz = (0.3 - 0.55 * v) * s;
        const xx = side * Math.sin(v * Math.PI * 0.92) * 0.16 * s * (0.6 + 0.4 * v);
        pts.push([xx, zz, w, 1]);
      }
      g.strip(pts, c, 0.008);
    };
    flame(1, 0.014);
    flame(0.55, 0.012);
    // A flame glyph in the band between the outer rings: a chevron over a stem.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13;
      const p = (da: number, dr: number) => [Math.sin(a + da) * (0.905 + dr), Math.cos(a + da) * (0.905 + dr)] as const;
      const strokes = [[p(-0.035, -0.022), p(0, 0.024)], [p(0, 0.024), p(0.035, -0.022)], [p(0, -0.024), p(0, 0.008)]] as const;
      for (const [[ax, az], [bx, bz]] of strokes) g.strip([[ax, az, 0.009, 1], [bx, bz, 0.009, 1]], c, 0.008);
    }
    return fxMesh(scene, g.mesh(scene, "eb-rune"), hot ? addMat(scene) : blendMat(scene), hot);
  });
}

/** A ragged floor disc, painted by its profile: `glow` additive light, else blended ink kept out of the bloom. */
function discTemplate(scene: Scene, key: string, profile: { r: number; c: readonly [number, number, number, number] }[], glow: boolean, rough = 0.2): Mesh {
  return template(scene, `eb-disc-${key}`, () => {
    const g = new Geo();
    const edge = ragged(rough, key.length * 1.7);
    g.lathe(profile.map((p) => ({ r: p.r, y: 0, c: p.c })), 48, 0, TAU, { jitter: (yaw, k) => (k === 0 ? 1 : edge(yaw)) });
    return fxMesh(scene, g.mesh(scene, `eb-${key}`), glow ? addMat(scene) : blendMat(scene), glow);
  });
}

const warnDisc = (scene: Scene) => discTemplate(scene, "warn", [
  { r: 0, c: rgba(FIRE, 0.3) }, { r: 0.6, c: rgba(FIRE, 0.45, 1.1) }, { r: 0.9, c: rgba(HOT, 0.95) }, { r: 1, c: rgba(FIRE, 0.5) }, { r: 1.08, c: rgba(DEEP, 0) },
], true, 0.08);
const stormShadow = (scene: Scene) => discTemplate(scene, "storm", [
  { r: 0, c: [0.03, 0.02, 0.025, 0.42] }, { r: 0.7, c: [0.035, 0.025, 0.025, 0.34] }, { r: 1, c: [0.05, 0.03, 0.03, 0] },
], false, 0.25);
const sunPool = (scene: Scene) => discTemplate(scene, "sunpool", [
  { r: 0, c: rgba(SUN, 0.5, 1.2) }, { r: 0.7, c: rgba(SUN, 0.28) }, { r: 0.95, c: rgba(FIRE, 0.4) }, { r: 1, c: rgba(DEEP, 0) },
], true, 0.1);
const ashBed = (scene: Scene) => discTemplate(scene, "ash", [
  { r: 0, c: [0.38, 0.36, 0.34, 0.72] }, { r: 0.55, c: [0.31, 0.29, 0.28, 0.66] }, { r: 0.85, c: [0.18, 0.16, 0.15, 0.4] }, { r: 1, c: [0.1, 0.08, 0.08, 0] },
], false, 0.3);

/** Glowing coals pushing through an ash bed: a scatter of small hot blobs. */
function coalsTemplate(scene: Scene): Mesh {
  return template(scene, "eb-coals", () => {
    const g = new Geo();
    const rnd = seeded(5);
    for (let i = 0; i < 11; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.72, s = 0.08 + rnd() * 0.14;
      g.lathe([{ r: 0, y: 0.004, c: rgba(HOT, 0.95) }, { r: s * 0.5, y: 0.004, c: rgba(FIRE, 0.7, 1.2) }, { r: s, y: 0.004, c: rgba(DEEP, 0) }], 10, 0, TAU,
        { cx: Math.sin(a) * d, cz: Math.cos(a) * d });
    }
    return fxMesh(scene, g.mesh(scene, "eb-coals"), addMat(scene));
  });
}

/** The herald's broken ring of cinders round his feet. */
function cinderRingTemplate(scene: Scene): Mesh {
  return template(scene, "eb-herald-ring", () => {
    const g = new Geo();
    const rnd = seeded(11);
    let a = 0;
    while (a < TAU - 0.15) {
      const len = 0.15 + rnd() * 0.35;
      const w = 0.03 + rnd() * 0.05;
      g.lathe([
        { r: 0.96 - w, y: 0, c: rgba(DEEP, 0) }, { r: 0.97, y: 0.012, c: rgba(HOT, 0.95) }, { r: 0.98 + w * 0.5, y: 0.006, c: rgba(FIRE, 0.7) }, { r: 1 + w, y: 0, c: rgba(DEEP, 0) },
      ], 6, a, a + len);
      a += len + 0.06 + rnd() * 0.14;
    }
    g.lathe([{ r: 0.45, y: 0, c: rgba(DEEP, 0) }, { r: 0.9, y: 0, c: rgba(DEEP, 0.16) }, { r: 0.96, y: 0, c: rgba(DEEP, 0) }], 40);
    return fxMesh(scene, g.mesh(scene, "eb-herald-ring"), addMat(scene));
  });
}

/** A loop of fire arcing off the sun: thin, gold at its root and red at its ends, gone at both. */
function flareTemplate(scene: Scene): Mesh {
  return template(scene, "eb-sun-flare", () => {
    const g = new Geo();
    const arc = TAU * 0.42, segs = 24, ring = 6;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs, yaw = u * arc;
      const thick = 0.07 * Math.sin(u * Math.PI);
      const al = Math.sin(u * Math.PI) ** 0.6;
      // Bulges off the surface in the middle of its run: a prominence, not a ring round the ball.
      const lift = 1 + 0.45 * Math.sin(u * Math.PI);
      for (let k = 0; k < ring; k++) {
        const t = (k / ring) * TAU, r = lift + Math.cos(t) * thick;
        g.vert(Math.sin(yaw) * r, Math.sin(t) * thick, Math.cos(yaw) * r, rgba(Math.abs(u - 0.5) < 0.2 ? SUN : DEEP, al * 0.9, 1.1));
      }
    }
    for (let s = 0; s < segs; s++) {
      for (let k = 0; k < ring; k++) {
        const a = s * ring + k, b = s * ring + ((k + 1) % ring);
        g.quad(a, b, a + ring, b + ring);
      }
    }
    return fxMesh(scene, g.mesh(scene, "eb-sun-flare"), addMat(scene));
  });
}

function sphereTemplate(scene: Scene, key: string, material: () => Material): Mesh {
  return template(scene, `eb-sun-${key}`, () =>
    fxMesh(scene, MeshBuilder.CreateSphere(`eb-sun-${key}`, { diameter: 1, segments: 16 }, scene), material()));
}

/** A thin bright rim round the sun's silhouette: opaque only where the surface turns away from the eye. */
function coronaMat(scene: Scene): StandardMaterial {
  const found = scene.getMaterialByName("eb-sun-corona-mat") as StandardMaterial | null;
  if (found) return found;
  const m = new StandardMaterial("eb-sun-corona-mat", scene);
  m.emissiveColor = new Color3(1, 0.62, 0.2);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  m.backFaceCulling = true;
  m.alphaMode = 1; // ALPHA_ADD
  m.disableDepthWrite = true;
  m.opacityFresnelParameters = new FresnelParameters({ leftColor: Color3.White(), rightColor: Color3.Black(), bias: 0, power: 3 });
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  return m;
}

/**
 * A miniature sun: an orange-red surface (alpha-blended, so it never adds up to
 * white), a white-hot heart that only fills its middle, a thin rim of corona and
 * three prominences arcing off it. `place` each frame; `size` is the surface radius.
 */
function sunBody(scene: Scene, size: number) {
  const surface = cloneOf(scene, sphereTemplate(scene, "surface", () => blendMat(scene, [0.95, 0.34, 0.06])), "eb-sun-surface");
  const heart = cloneOf(scene, sphereTemplate(scene, "heart", () => addMat(scene, [1, 0.86, 0.55], true)), "eb-sun-heart");
  const corona = cloneOf(scene, sphereTemplate(scene, "corona", () => coronaMat(scene)), "eb-sun-corona");
  // Drawn surface, then heart, then rim, whatever the camera distance says.
  surface.alphaIndex = 100; heart.alphaIndex = 101; corona.alphaIndex = 102;
  const flares = [0, 1, 2].map((i) => ({ m: cloneOf(scene, flareTemplate(scene), "eb-sun-flare"), tilt: 0.4 + 0.7 * i, spin: (1.2 + 0.5 * i) * (i % 2 ? -1 : 1) }));
  const meshes = [surface, heart, corona, ...flares.map((f) => f.m)];
  return {
    meshes,
    place(at: Vector3, k: number, t: number, swell: number): void {
      const s = size * (0.4 + 0.6 * k) * (1 + 0.12 * swell);
      surface.position.copyFrom(at);
      surface.scaling.setAll(2 * s);
      surface.visibility = 0.92 * k;
      heart.position.copyFrom(at);
      heart.scaling.setAll(2 * s * 0.62);
      heart.visibility = k * (0.75 + 0.1 * Math.sin(t * 9) + 0.15 * swell);
      corona.position.copyFrom(at);
      corona.scaling.setAll(2 * s * 1.12);
      corona.visibility = k * (0.85 + 0.15 * Math.sin(t * 5));
      for (const f of flares) {
        f.m.position.copyFrom(at);
        f.m.scaling.setAll(s);
        f.m.rotation.set(f.tilt, t * f.spin, f.tilt * 0.6 * Math.sin(t * 0.8));
        f.m.visibility = k * (0.7 + 0.3 * Math.sin(t * 6 + f.spin));
      }
    },
  };
}

/** A meteor's wake: a tapered cone back along -Z from the rock. */
function wakeTemplate(scene: Scene): Mesh {
  return template(scene, "eb-wake", () => {
    const g = new Geo();
    const prof = [];
    for (let k = 0; k <= 8; k++) {
      const s = k / 8;
      prof.push({ r: 0.5 * (1 - s) ** 0.7, y: -s, c: rgba(s < 0.3 ? HOT : FIRE, (1 - s) ** 1.3 * 0.9, 1 + 0.5 * (1 - s)) });
    }
    g.lathe(prof, 10);
    const m = g.mesh(scene, "eb-wake");
    m.rotation.x = Math.PI / 2;
    m.bakeCurrentTransformIntoVertices();
    return fxMesh(scene, m, addMat(scene, [1, 1, 1], true));
  });
}

// ── Flame Dash ─────────────────────────────────────────────────────────────────

/** Fire knots and sparks shed off a burning body, left behind in the world. */
function shedFire(scene: Scene, at: Vector3, dirX: number, dirZ: number, n: number): void {
  const pools = kitPools(scene);
  for (let i = 0; i < n; i++) {
    pools.glow.emit({
      x: at.x + rand(-0.25, 0.25), y: at.y + rand(0.15, 1.3), z: at.z + rand(-0.25, 0.25),
      vx: -dirX * rand(1, 3), vy: rand(0.3, 1.2), vz: -dirZ * rand(1, 3), drag: 2.5,
      life: rand(0.2, 0.38), size: rand(0.25, 0.45), sizeEnd: 0.1,
      r: 1, g: 0.75, b: 0.35, a: 0.6, r1: DEEP[0], g1: DEEP[1], b1: DEEP[2],
    });
  }
}

const flameDashCast = (ctx: LookContext, body: ActorRef, cast: { dirX: number; dirY: number }): FxHandle<ActorRef> => {
  // The crouch before the rush: fire catches round his feet and spits back.
  const scene = ctx.scene;
  let b = body;
  const p = posOf(b);
  core(scene, floorAt(p.x, p.z, 0.4), 0.9, HOT, FIRE, 0.14);
  sparks(scene, floorAt(p.x, p.z, 0.2), 14, HOT, DEEP, { speed: [3, 6], up: [0.1, 0.5], yaw: Math.atan2(-cast.dirX, -cast.dirY), cone: 0.7, length: 0.18 });
  const fx = new Fx(() => {
    const q = posOf(b);
    shedFire(scene, floorAt(q.x, q.z), cast.dirX, cast.dirY, 2);
    return true;
  }, 0.1);
  return lasting(fx, (_c, s) => { b = s; }, undefined, 0.2);
};

function flameDashTravel(ctx: LookContext, body: ActorRef, t: { dirX: number; dirY: number }): FxHandle<{ body: ActorRef; travel: { dirX: number; dirY: number } }> {
  const scene = ctx.scene;
  let b = body;
  const follow = () => posOf(b);
  const root = new Fx(() => {
    const q = posOf(b);
    shedFire(scene, q, t.dirX, t.dirY, 4);
    return true;
  }, 0.2);
  // A broad low sheet of fire and a hot core streak inside it: low and fast, not a ghost trail.
  root.child(ribbonTrail(scene, follow, { colour: FIRE, life: 0.45, height: 1.5, width: 1.2, lift: 0.02, alpha: 0.9, motes: 6 }));
  root.child(ribbonTrail(scene, follow, { colour: HOT, life: 0.2, height: 0.8, width: 0.45, lift: 0.3, alpha: 1 }));
  return lasting(root, (_c, s) => { b = s.body; }, undefined, 0.8);
}

function flameDashLand(ctx: LookContext, body: ActorRef): BurstHandle {
  const p = posOf(body);
  const at = floorAt(p.x, p.z);
  const fx = new Fx(() => false);
  fx.child(landingImpact(ctx.scene, at, { radius: 1.8, colour: [1, 0.6, 0.3], glow: FIRE, chunks: 6, dust: 10, flash: 0.75 }));
  fx.child(flameCrown(ctx.scene, at, { radius: 1.6, height: 0.9, duration: 0.35, embers: 40 }));
  return burst(fx);
}

/** A patch of the dash's trail: licking tongues on a glowing scorch, lit with a whoomp. Not the cinder disc's cracks. */
function flameDashGround(ctx: LookContext, g: GroundState): FxHandle<GroundState> {
  const at = floorAt(g.x, g.y);
  const scene = ctx.scene;
  core(scene, floorAt(g.x, g.y, 0.3), 1, HOT, FIRE, 0.15);
  sparks(scene, floorAt(g.x, g.y, 0.15), 8, HOT, DEEP, { speed: [1.5, 3.5], up: [0.6, 1.4], life: [0.25, 0.5] });
  const burn = Math.max(0.3, g.remaining - 0.5);
  const fx = flameTrailPatch(scene, at, { radius: 0.62 * g.radius, duration: burn, fade: 0.5, colour: FIRE, embers: 7 });
  // A small crown of flame tongues licking round the patch: the beads read as fire, not as orange dots.
  const tongues = cloneOf(scene, crownTemplate(scene, (g.id % 2) as 0 | 1), "eb-trail-tongues");
  tongues.position.set(g.x, 0.02, g.y);
  tongues.rotation.y = Math.random() * TAU;
  const R = 0.42 * g.radius;
  const seed = Math.random() * 10;
  const root = new Fx((f) => {
    const life = f.age < burn ? 1 : clamp01(1 - (f.age - burn) / 0.5);
    const lick = 0.75 + 0.25 * Math.sin(f.age * 21 + seed) * Math.sin(f.age * 13 + seed * 2);
    const grow = clamp01(f.age / 0.12);
    tongues.scaling.set(R * grow, 0.75 * lick * life * grow, R * grow);
    tongues.visibility = life * (0.75 + 0.25 * Math.sin(f.age * 31 + seed));
    return f.age < burn + 0.5;
  });
  root.own(tongues);
  root.child(fx);
  return lasting(root, undefined, undefined, 1);
}

/**
 * Cinder Ground (level 8): the field burns in tongues across its whole radius over one
 * glowing scorch. The shipped look was a dim red disc beside the newer fire skills.
 */
function cinderGround(ctx: LookContext, g: GroundState): FxHandle<GroundState> {
  const scene = ctx.scene;
  const R = g.radius;
  const burn = Math.max(0.5, g.remaining - 0.6);
  const root = new Fx(() => false);
  core(scene, floorAt(g.x, g.y, 0.3), R * 0.6, HOT, FIRE, 0.16);
  sparks(scene, floorAt(g.x, g.y, 0.15), 18, HOT, DEEP, { speed: [2, 5], up: [0.6, 1.6], life: [0.3, 0.6] });
  root.child(scorch(scene, floorAt(g.x, g.y), { radius: R * 1.05, glow: DEEP, hold: burn, fade: 1, alpha: 0.5 }));
  const spots: [number, number][] = [[0, 0]];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.random() * 0.5;
    spots.push([Math.sin(a) * R * rand(0.45, 0.7), Math.cos(a) * R * rand(0.45, 0.7)]);
  }
  for (const [dx, dz] of spots) {
    root.child(flameTrailPatch(scene, floorAt(g.x + dx, g.y + dz), { radius: R * rand(0.22, 0.3), duration: burn * rand(0.85, 1), fade: 0.6, colour: FIRE, embers: 4 }));
  }
  return lasting(root, undefined, undefined, 1.2);
}

// ── Ember Nova ─────────────────────────────────────────────────────────────────

function emberNovaCast(ctx: LookContext, body: ActorRef, cast: { windup?: number }): FxHandle<ActorRef> {
  // Fire drawn IN over the wind-up: a ring closing on him and embers sucked to his chest.
  const scene = ctx.scene;
  let b = body;
  const windup = Math.max(0.15, cast.windup ?? 0.3);
  const ring = cloneOf(scene, pulseRingTemplate(scene, FIRE, "eb-gather", false), "eb-gather");
  const pool = kitPools(scene).motes;
  let owed = 0;
  const fx = new Fx((f, dt) => {
    const p = posOf(b);
    const k = clamp01(f.age / windup);
    const r = 2.6 - 2.1 * easeOut(k);
    ring.position.set(p.x, p.y + 0.03, p.z);
    ring.scaling.set(r, 1 + 2 * k, r);
    ring.visibility = (0.3 + 0.7 * k) * f.fade;
    owed += 60 * dt * f.fade;
    for (; owed >= 1; owed--) {
      const a = Math.random() * TAU, d = rand(1.6, 2.4), life = rand(0.2, 0.3);
      pool.emit({
        x: p.x + Math.sin(a) * d, y: p.y + rand(0.1, 0.5), z: p.z + Math.cos(a) * d,
        vx: -Math.sin(a) * d / life, vy: 2.5, vz: -Math.cos(a) * d / life, life, size: 0.12, thick: 0.02, stretch: 0.04,
        r: HOT[0], g: HOT[1], b: HOT[2], a: 1, r1: FIRE[0], g1: FIRE[1], b1: FIRE[2],
      });
    }
    if (Math.random() < dt * 20) core(scene, floorAt(p.x, p.z, 1.1), 0.35 + 0.5 * k, HOT, FIRE, 0.1);
    return true;
  }, 0.12);
  fx.own(ring);
  return lasting(fx, (_c, s) => { b = s; }, undefined, 0.3);
}

function emberNovaImpact(ctx: LookContext, a: AreaState): BurstHandle {
  const scene = ctx.scene;
  const at = floorAt(a.x, a.y);
  const R = a.radius;
  const fx = new Fx(() => false);
  // Tall separate tongues racing to the edge with a fire ring under them, a standing push
  // wall a beat behind (the knockback), sparks flung flat, then a charred floor (not
  // orange paint: dark, with embers glowing on it) gone inside a second.
  kitFlash(scene, at, 0.95, FIRE);
  core(scene, floorAt(a.x, a.y, 0.5), 1.4, [1, 0.72, 0.3], DEEP, 0.18);
  fx.child(flameCrown(scene, at, { radius: R * 1.02, height: 1.8, duration: 0.42, embers: 90 }));
  fx.child(shockRing(scene, at, { radius: R, duration: 0.42, colour: FIRE, lip: 0, width: 0.18, dust: 0, flash: 0, floorFlash: false }));
  fx.child(shockRing(scene, at, { radius: R * 1.15, duration: 0.4, colour: [1, 0.55, 0.2], lip: 0.85, width: 0.22, dust: 14, flash: 0, floorFlash: false, delay: 0.04 }));
  sparks(scene, floorAt(a.x, a.y, 0.5), 50, HOT, DEEP, { speed: [7, 12], up: [0.05, 0.35], gravity: -6, life: [0.25, 0.5], length: 0.26, thick: 0.03 });
  fx.child(scorch(scene, at, { radius: R * 0.85, hold: 0.35, fade: 0.6, alpha: 0.6 }));
  embers(scene, floorAt(a.x, a.y, 0.03), 26, [1, 0.7, 0.3], DEEP, { radius: R * 0.8, rise: [0.05, 0.35], life: [0.5, 0.9], gravity: 0, delay: 0.25 });
  return burst(fx);
}

// ── Flammability ───────────────────────────────────────────────────────────────

function flammabilityCast(ctx: LookContext, body: ActorRef, cast: { dirX: number; dirY: number; windup?: number }): FxHandle<ActorRef> {
  // A small rune drawn in the air before his hand, turning faster as the curse gathers.
  const scene = ctx.scene;
  let b = body;
  const windup = Math.max(0.15, cast.windup ?? 0.5);
  const sigil = cloneOf(scene, runeTemplate(scene, true), "eb-hand-rune");
  const yaw = Math.atan2(cast.dirX, cast.dirY);
  const fx = new Fx((f) => {
    const p = posOf(b);
    const k = clamp01(f.age / windup);
    sigil.position.set(p.x + cast.dirX * 0.7, p.y + 1.35, p.z + cast.dirY * 0.7);
    // Upright, facing down the aim, spinning in its own plane.
    sigil.rotation.set(Math.PI / 2, yaw, f.age * (3 + 9 * k));
    sigil.scaling.setAll(0.15 + 0.3 * easeOut(k));
    sigil.visibility = (0.4 + 0.6 * k) * f.fade;
    if (Math.random() < 0.5) embers(scene, sigil.position, 1, HOT, CURSE, { radius: 0.2, rise: [0.2, 0.6], life: [0.3, 0.5], motes: true });
    return true;
  }, 0.15);
  fx.own(sigil);
  return lasting(fx, (_c, s) => { b = s; }, () => kitFlash(scene, sigil.position.clone(), 0.35, CURSE), 0.3);
}

/** The curse's circle slammed onto where the sim cast it (its marker area), at the sim's radius, cursed or not. */
function curseSlam(scene: Scene, cx: number, cz: number, R: number): Fx {
  const ink = cloneOf(scene, runeTemplate(scene, false), "eb-slam-ink");
  const hot = cloneOf(scene, runeTemplate(scene, true), "eb-slam-hot");
  let landed = false;
  const DROP = 0.13;
  const yaw = Math.random() * TAU;
  const fx = new Fx((f) => {
    const t = f.age;
    if (t < DROP) {
      const k = easeOut(t / DROP);
      const y = 2.4 * (1 - k) + 0.03;
      for (const m of [ink, hot]) { m.position.set(cx, y, cz); m.scaling.setAll(R * (1.35 - 0.35 * k)); m.rotation.y = yaw; }
      ink.visibility = 0.5 * k;
      hot.visibility = 0.6 * k;
      return true;
    }
    if (!landed) {
      landed = true;
      for (const m of [ink, hot]) { m.position.set(cx, 0.03, cz); m.scaling.setAll(R); }
      const at = floorAt(cx, cz);
      kitFlash(scene, at, 0.65, CURSE);
      fx.child(shockRing(scene, at, { radius: R * 1.2, duration: 0.35, colour: CURSE, lip: 0.55, width: 0.2, dust: 12, flash: 0 }));
      sparks(scene, floorAt(cx, cz, 0.1), 36, HOT, DEEP, { speed: [4, 8], up: [0.05, 0.3], life: [0.2, 0.45] });
      embers(scene, at, 30, HOT, CURSE, { radius: R * 0.9, rise: [0.8, 2], life: [0.5, 1], motes: true });
    }
    const s = t - DROP;
    ink.rotation.y = yaw - s * 0.4;
    hot.rotation.y = ink.rotation.y;
    hot.visibility = s < 0.2 ? 1 : clamp01(1 - (s - 0.2) / 0.5);
    ink.visibility = s < 0.4 ? 0.95 : clamp01(1 - (s - 0.4) / 0.6) * 0.95;
    return s < 1;
  });
  fx.own(ink);
  fx.own(hot);
  return fx;
}

/** Cursed: an orange rune circle and a throbbing hot rim under its feet, a small sigil over its head, embers off its body. */
const flammableStatus: StatusLook = {
  create(ctx, s) {
    const scene = ctx.scene;
    let b = s.body;
    let visible = s.visible;
    const R = Math.max(0.45, s.radius) * (s.boss ? 1.3 : 1);
    const H = Math.max(1.3, R * 3);
    const ink = cloneOf(scene, runeTemplate(scene, false), "eb-curse-ink");
    const rim = cloneOf(scene, pulseRingTemplate(scene, CURSE, "eb-curse-rim", false), "eb-curse-rim");
    const head = cloneOf(scene, runeTemplate(scene, true), "eb-curse-head");
    const pools = kitPools(scene);
    let ember = 0, ash = 0;
    const fx = new Fx((f, dt) => {
      for (const m of [ink, rim, head]) m.setEnabled(visible);
      if (!visible) return true;
      const p = posOf(b);
      const k = clamp01(f.age / 0.25) * f.fade;
      const snap = 1 + 0.6 * (1 - clamp01(f.age / 0.2)) ** 2;
      ink.position.set(p.x, p.y + 0.03, p.z);
      ink.scaling.setAll(R * 1.55 * snap);
      ink.rotation.y = -f.age * 0.5;
      ink.visibility = k * (0.8 + 0.2 * Math.sin(f.age * 3));
      const ph = (f.age % 0.9) / 0.9;
      rim.position.set(p.x, p.y + 0.025, p.z);
      rim.scaling.set(R * (1.2 + 0.4 * ph), 1.5 * (1 - ph) + 0.3, R * (1.2 + 0.4 * ph));
      rim.visibility = k * (0.35 + 0.65 * (1 - ph) ** 2);
      head.position.set(p.x, p.y + H + 0.45 + 0.05 * Math.sin(f.age * 2.4), p.z);
      head.scaling.setAll(0.32 * snap);
      head.rotation.y = f.age * 1.2;
      head.visibility = k * (0.85 + 0.15 * Math.sin(f.age * 7));
      ember += dt * 9 * k;
      for (; ember >= 1; ember--) {
        const a = Math.random() * TAU, d = R * Math.sqrt(Math.random());
        pools.motes.emit({
          x: p.x + Math.sin(a) * d, y: p.y + H * rand(0.05, 0.85), z: p.z + Math.cos(a) * d,
          vx: rand(-0.2, 0.2), vy: rand(0.7, 1.5), vz: rand(-0.2, 0.2), gravity: 0.3, drag: 0.6,
          life: rand(0.5, 0.9), size: 0.1, thick: 0.022, stretch: 0.05,
          r: 1, g: 0.85, b: 0.45, a: 1, r1: CURSE[0], g1: CURSE[1] * 0.5, b1: 0.02,
        });
      }
      ash += dt * 1.5 * k;
      for (; ash >= 1; ash--) {
        pools.smoke.emit({
          x: p.x + rand(-R, R) * 0.5, y: p.y + H * rand(0.5, 0.9), z: p.z + rand(-R, R) * 0.5,
          vy: rand(0.4, 0.8), drag: 0.8, life: rand(0.8, 1.2), size: 0.2, sizeEnd: 0.5,
          r: ASH[0], g: ASH[1], b: ASH[2], a: 0.3, r1: 0.4, g1: 0.39, b1: 0.38,
        });
      }
      return true;
    }, 0.3);
    fx.own(ink);
    fx.own(rim);
    fx.own(head);
    return lasting<AttachedState>(fx, (_c, st) => { b = st.body; visible = st.visible; }, undefined, 0.5);
  },
};

// ── Solar Orb ──────────────────────────────────────────────────────────────────

/** Solar orbs holding the one light they may own, per scene. */
const litOrbs = new WeakMap<Scene, number>();

/** Over his throwing shoulder: the orb gathers there through the wind-up. */
function handPoint(b: ActorRef): Vector3 {
  const p = posOf(b);
  const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
  return new Vector3(p.x - rx * 0.3 - Math.sin(b.yaw) * 0.2, p.y + 1.95, p.z - rz * 0.3 - Math.cos(b.yaw) * 0.2);
}

function solarOrbCast(ctx: LookContext, body: ActorRef, cast: { windup?: number }): FxHandle<ActorRef> {
  // A small sun swelling over his throwing shoulder through the wind-up. Lightless: the thrown one owns the light.
  const scene = ctx.scene;
  let b = body;
  const windup = Math.max(0.15, cast.windup ?? 0.5);
  const sun = sunBody(scene, 0.32);
  const root = new Fx((f) => {
    sun.place(handPoint(b), clamp01(f.age / windup) * f.fade, f.age, 0);
    return true;
  }, 0.1);
  for (const m of sun.meshes) root.own(m);
  return lasting(root, (_c, s) => { b = s; }, undefined, 0.5);
}

const ORB_LIFT = 1.5;
const ORB_SIZE = 0.6;
const ORB_FLIGHT = 0.28;
const ORB_PULSE = 0.5;
const ORB_INTENSITY = 60;

function solarOrbGround(ctx: LookContext, g: GroundState): FxHandle<GroundState> {
  const scene = ctx.scene;
  let st = g;
  const R = g.radius;
  const target = floorAt(g.x, g.y, ORB_LIFT);
  // Thrown from over his shoulder where he stood as it landed; a patch with no caster drops from above.
  const from = g.caster ? new Vector3(g.caster.x, 1.95, g.caster.y) : target.add(new Vector3(0, 3, 0));
  const lit = (litOrbs.get(scene) ?? 0) === 0;
  if (lit) litOrbs.set(scene, 1);
  const centre = new Vector3();
  const place = (age: number) => {
    if (age < ORB_FLIGHT) {
      const u = age / ORB_FLIGHT;
      Vector3.LerpToRef(from, target, u, centre);
      centre.y += 1.4 * 4 * u * (1 - u);
    } else centre.set(target.x, ORB_LIFT + 0.08 * Math.sin(age * 2.2), target.z);
    return centre;
  };
  const sun = sunBody(scene, ORB_SIZE);
  let light: PointLight | null = null;
  if (lit) {
    light = orbLight(scene);
    light.diffuse.set(1, 0.55, 0.18);
    light.range = 6;
  }
  const pool = cloneOf(scene, sunPool(scene), "eb-sun-pool");
  pool.position.set(g.x, 0.025, g.y);
  pool.setEnabled(false);
  let pulses = 0, swell = 0, drips = 0, ended = false;
  const gold: Rgb = [1, 0.72, 0.3];
  const pulse = (strength: number) => {
    swell = 1;
    const at = floorAt(g.x, g.y);
    // Heat thrown across the floor: a lipped ring and low tongues both clearly past the damage radius.
    root.child(flameCrown(scene, at, { radius: R * 1.08, height: 0.55 * strength, duration: 0.42, embers: 40 }));
    root.child(shockRing(scene, at, { radius: R * 1.12, duration: 0.42, colour: SUN, lip: 0.7, width: 0.18, dust: 0, flash: 0, floorFlash: false }));
    sparks(scene, centre, 14, gold, DEEP, { speed: [2, 4], up: [-1.2, -0.3], gravity: -9, life: [0.3, 0.55], length: 0.16 });
  };
  /** Its life as the sim gives it: whole until the last 0.35 s of the patch, then shrinking out. */
  const life = () => (st.remaining > 0 ? clamp01(st.remaining / 0.35) : 1);
  const root = new Fx((f, dt) => {
    const age = st.age;
    place(age);
    if (age >= ORB_FLIGHT) {
      const due = 1 + Math.floor((age - ORB_FLIGHT) / ORB_PULSE);
      // The arrival is the first, biggest pulse (the sim's first lands as it spawns).
      if (due > pulses && !f.stopped && life() >= 1) { pulse(pulses === 0 ? 1.4 : 1); pulses = due; }
      pool.setEnabled(true);
    }
    if (!ended && life() < 1) {
      ended = true;
      // Guttering out: a last collapse of embers where it hung.
      embers(scene, centre, 18, gold, DEEP, { radius: 0.4, rise: [-1, 1.5], life: [0.4, 0.8] });
    }
    swell = Math.max(0, swell - dt * 3);
    const k = clamp01(age / 0.2) * f.fade * life();
    sun.place(centre, k, f.age, swell);
    if (light) {
      light.position.copyFrom(centre);
      light.intensity = ORB_INTENSITY * k * (0.9 + 0.1 * Math.sin(f.age * 13)) * (1 + 0.8 * swell);
    }
    pool.scaling.set(R, 1, R);
    pool.visibility = k * (0.2 + 0.05 * Math.sin(f.age * 3) + 0.3 * swell);
    // Fire dripping off it onto the floor between pulses.
    drips += dt * 10 * k;
    for (; drips >= 1; drips--) {
      const a = Math.random() * TAU;
      kitPools(scene).shards.emit({
        x: centre.x + Math.sin(a) * 0.35, y: centre.y - ORB_SIZE * 0.8, z: centre.z + Math.cos(a) * 0.35,
        vx: Math.sin(a) * 0.3, vy: rand(-1.5, -0.5), vz: Math.cos(a) * 0.3, gravity: -7, drag: 0.5,
        life: rand(0.35, 0.55), size: 0.12, thick: 0.025, stretch: 0.06,
        r: gold[0], g: gold[1], b: gold[2], a: 1, r1: DEEP[0], g1: DEEP[1], b1: DEEP[2],
      });
    }
    return true;
  }, 0.3);
  for (const m of sun.meshes) root.own(m);
  root.own(pool);
  if (light) root.onDispose(() => { light!.intensity = 0; });
  root.child(scorch(scene, floorAt(g.x, g.y), { radius: R * 0.8, hold: Math.max(0.5, g.remaining), fade: 1.2, alpha: 0.4 }));
  let released = false;
  const release = () => { if (lit && !released) { released = true; litOrbs.set(scene, 0); } };
  root.onDispose(release);
  return lasting(root, (_c, s) => { st = s; }, undefined, 1);
}

// ── Firestorm ──────────────────────────────────────────────────────────────────

/** Down the sky the meteors fall along: steep, from behind and to the left, as every storm meteor does. */
const FALL_DIR = new Vector3(-0.22, 1, -0.18).normalize();
const FALL_LEN = 11;
const FALL_SECONDS = 0.5;
const FWD = new Vector3(0, 0, 1);

interface StormBatch { now: number; xs: number[]; zs: number[]; total: number; landed: number }
const stormBatch = new WeakMap<Scene, StormBatch>();
const areaBatch = new Map<number, StormBatch>();

/** Join this frame's storm, or open a new one and darken the sky over it. */
function joinStorm(ctx: LookContext, a: AreaState): void {
  if (areaBatch.has(a.id)) return;
  let b = stormBatch.get(ctx.scene);
  if (!b || b.now !== ctx.now) {
    for (const [id, old] of areaBatch) if (ctx.now - old.now > 10) areaBatch.delete(id);
    b = { now: ctx.now, xs: [], zs: [], total: 0, landed: 0 };
    stormBatch.set(ctx.scene, b);
    const sky = storm(ctx.scene, b);
    if (ctx.adopt) ctx.adopt(burst(sky));
    else fire(ctx.scene, sky);
  }
  b.xs.push(a.x);
  b.zs.push(a.y);
  b.total++;
  areaBatch.set(a.id, b);
}

function landStorm(id: number): void {
  const b = areaBatch.get(id);
  if (b) b.landed++;
  areaBatch.delete(id);
}

/** The sky going dark over the storm: a cloud shadow on the floor, smoke rolling overhead lit red from inside. */
function storm(scene: Scene, b: StormBatch): Fx {
  const shadow = cloneOf(scene, stormShadow(scene), "eb-storm-shadow");
  const edge = cloneOf(scene, pulseRingTemplate(scene, DEEP, "eb-storm-edge", false), "eb-storm-edge");
  shadow.setEnabled(false);
  edge.setEnabled(false);
  const pools = kitPools(scene);
  let cx = 0, cz = 0, R = 4.3, ending = -1, cloud = 0, placed = false;
  const fx = new Fx((f, dt) => {
    // Every impact of the cast registered in the frame it opened; this runs after.
    if (!placed && b.xs.length > 0) {
      placed = true;
      for (let i = 0; i < b.xs.length; i++) { cx += b.xs[i]! / b.xs.length; cz += b.zs[i]! / b.zs.length; }
      for (let i = 0; i < b.xs.length; i++) R = Math.max(R, Math.hypot(b.xs[i]! - cx, b.zs[i]! - cz) + 1.5);
      shadow.rotation.y = Math.random() * TAU;
    }
    if (ending < 0 && (b.landed >= b.total || f.age > 4)) ending = f.age;
    const k = clamp01(f.age / 0.35) * (ending < 0 ? 1 : clamp01(1 - (f.age - ending - 0.3) / 0.6));
    shadow.setEnabled(true);
    edge.setEnabled(true);
    shadow.position.set(cx, 0.015, cz);
    shadow.scaling.set(R, 1, R);
    shadow.visibility = k;
    edge.position.set(cx, 0.02, cz);
    edge.scaling.set(R * 0.92, 0.6, R * 0.92);
    edge.visibility = 0.35 * k * (0.8 + 0.2 * Math.sin(f.age * 5));
    cloud += dt * 14 * k;
    for (; cloud >= 1; cloud--) {
      const a = Math.random() * TAU, d = R * Math.sqrt(Math.random()) * 0.8;
      const lit = Math.random() < 0.25;
      (lit ? pools.glow : pools.smoke).emit({
        x: cx + Math.sin(a) * d - FALL_DIR.x * 5, y: rand(4.5, 5.5), z: cz + Math.cos(a) * d - FALL_DIR.z * 5,
        vx: rand(-0.4, 0.4), vy: rand(-0.1, 0.1), vz: rand(-0.4, 0.4), drag: 0.5,
        life: rand(0.8, 1.3), size: lit ? 0.8 : 1.4, sizeEnd: lit ? 1.6 : 2.6,
        ...(lit
          ? { r: 0.9, g: 0.3, b: 0.06, a: 0.25, r1: 0.4, g1: 0.08, b1: 0.02 }
          : { r: 0.1, g: 0.08, b: 0.08, a: 0.3, r1: 0.16, g1: 0.13, b1: 0.12 }),
      });
    }
    return ending < 0 || f.age - ending < 0.9;
  });
  fx.own(shadow);
  fx.own(edge);
  return fx;
}

/** Glowing knots and smoke shed off a falling rock, left in the world. */
function shedMeteor(scene: Scene, at: Vector3): void {
  const pools = kitPools(scene);
  for (let i = 0; i < 3; i++) {
    pools.glow.emit({
      x: at.x + rand(-0.1, 0.1), y: at.y + rand(-0.1, 0.1), z: at.z + rand(-0.1, 0.1),
      vx: rand(-0.3, 0.3), vy: rand(0, 0.5), vz: rand(-0.3, 0.3), drag: 2,
      life: rand(0.18, 0.32), size: 0.55, sizeEnd: 0.18,
      r: 1, g: 0.75, b: 0.35, a: 0.55, r1: FIRE[0] * 0.7, g1: FIRE[1] * 0.3, b1: 0.02,
    });
  }
  if (Math.random() < 0.5) {
    pools.smoke.emit({
      x: at.x, y: at.y, z: at.z, vx: rand(-0.2, 0.2), vy: rand(0.2, 0.6), vz: rand(-0.2, 0.2), drag: 1.2,
      life: rand(0.8, 1.2), delay: 0.05, size: 0.5, sizeEnd: 1.4,
      r: 0.18, g: 0.15, b: 0.13, a: 0.4, r1: 0.32, g1: 0.3, b1: 0.28,
    });
  }
}

function firestormWarn(ctx: LookContext, a: AreaState): FxHandle<AreaState> {
  const scene = ctx.scene;
  joinStorm(ctx, a);
  const total = Math.max(a.impactIn, 0.05);
  const glow = cloneOf(scene, warnDisc(scene), "eb-warn");
  const rim = cloneOf(scene, pulseRingTemplate(scene, FIRE, "eb-warn-rim", false), "eb-warn-rim");
  glow.rotation.y = Math.random() * TAU;
  let rock: TransformNode | null = null;
  let wake: Mesh | null = null;
  const look = new Quaternion();
  Quaternion.FromUnitVectorsToRef(FWD, FALL_DIR.scale(-1), look);
  const spin = new Quaternion();
  const pos = new Vector3();
  return {
    update(c, s) {
      const p = 1 - clamp01(s.impactIn / total);
      // The landing spot heats up as the rock nears: a growing disc with a bright edge, flickering.
      glow.position.set(s.x, 0.03, s.y);
      glow.scaling.setAll(s.radius * (0.45 + 0.55 * p));
      glow.visibility = (0.2 + 0.8 * p * p) * (0.85 + 0.15 * Math.sin(c.now * 40 + s.index));
      rim.position.set(s.x, 0.03, s.y);
      rim.scaling.set(s.radius, 0.4 + 1.6 * p, s.radius);
      rim.visibility = 0.25 + 0.75 * p;
      if (s.impactIn <= FALL_SECONDS) {
        if (!rock) {
          rock = meteorBody(0.5, FIRE)(scene);
          rock.rotationQuaternion = look.clone();
          wake = cloneOf(scene, wakeTemplate(scene), "eb-wake");
          wake.rotationQuaternion = look.clone();
        }
        // Positioned off the sim's own countdown, so the rock lands on the impact tick.
        const d = (s.impactIn / FALL_SECONDS) * FALL_LEN;
        pos.set(s.x + FALL_DIR.x * d, FALL_DIR.y * d, s.y + FALL_DIR.z * d);
        rock.position.copyFrom(pos);
        Quaternion.RotationAxisToRef(FWD, c.now * 4, spin);
        look.multiplyToRef(spin, rock.rotationQuaternion!);
        wake!.position.copyFrom(pos);
        wake!.scaling.set(0.65, 0.65, Math.min(3.5, FALL_LEN - d + 0.3));
        shedMeteor(scene, pos);
      }
    },
    dispose() {
      glow.dispose();
      rim.dispose();
      rock?.dispose();
      wake?.dispose();
    },
  };
}

/**
 * A meteor striking: the kit meteor's landing, recomposed so no part of it is
 * white-hot. Additive white cores stacked on a bright floor flash as white balls;
 * every core and tongue here starts at gold and cools to red.
 */
function meteorBlast(scene: Scene, at: Vector3, blast: number): Fx {
  const fx = new Fx(() => false);
  const gold: Rgb = [1, 0.66, 0.24];
  const pools = kitPools(scene);
  kitFlash(scene, at, 1, FIRE);
  const up = new Vector3(at.x, at.y + 0.4, at.z);
  core(scene, up, blast * 0.55, gold, DEEP, 0.2);
  // The flower: thick tongues flung flat and fast out of the strike.
  const tongues = Math.round(blast * 9);
  for (let i = 0; i < tongues; i++) {
    const a = ((i + Math.random()) / tongues) * TAU;
    const sp = rand(5, 9) * Math.sqrt(blast);
    pools.shards.emit({
      x: up.x, y: up.y, z: up.z, vx: Math.sin(a) * sp, vy: rand(-0.3, 2.5), vz: Math.cos(a) * sp, drag: 7,
      life: rand(0.16, 0.28), size: blast * 0.22, sizeEnd: blast * 0.1, thick: 0.07 * blast, stretch: 0.05,
      r: gold[0], g: gold[1], b: gold[2], a: 1, r1: FIRE[0], g1: FIRE[1] * 0.6, b1: 0.03,
    });
  }
  sparks(scene, up, Math.round(blast * 14), gold, [0.8, 0.18, 0.03], { speed: [1.5, 5], up: [0.9, 2.2], gravity: -9, life: [0.5, 1.1], length: 0.12 });
  throwChunks(scene, "molten", at, { count: Math.round(blast * 6), speed: [1, 3.5], up: [3, 6.5], size: [0.07, 0.2] });
  throwChunks(scene, "rock", at, { count: Math.round(blast * 5), speed: [1.2, 4], up: [3, 6], size: [0.06, 0.18] });
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU;
    pools.smoke.emit({
      x: at.x + Math.sin(a) * 0.3, y: at.y + 0.3, z: at.z + Math.cos(a) * 0.3,
      vx: Math.sin(a) * 0.8, vy: rand(0.6, 1.4), vz: Math.cos(a) * 0.8, drag: 1.4,
      life: rand(1, 1.6), delay: 0.1, size: blast * 0.3, sizeEnd: blast * 0.8,
      r: 0.22, g: 0.19, b: 0.17, a: 0.42, r1: 0.38, g1: 0.36, b1: 0.34,
    });
  }
  embers(scene, at, 14, gold, FIRE, { radius: blast * 0.6, life: [0.8, 1.6], motes: true, delay: 0.15 });
  fx.child(shockRing(scene, at, { radius: blast * 1.25, duration: 0.4, colour: FIRE, lip: 0.5, dust: 10, flash: 0 }));
  fx.child(scorch(scene, at, { radius: blast * 0.75, glow: FIRE, hold: 2.2 }));
  fx.child(fissure(scene, at, { radius: blast * 0.9, colour: FIRE, hold: 1.2 }));
  for (let i = 0; i < 6; i++) puff(scene, at.x, at.y, at.z, { size: 1, drift: rand(2, 3.5), rise: 0.3 });
  return fx;
}

function firestormImpact(ctx: LookContext, a: AreaState): BurstHandle {
  joinStorm(ctx, a);
  landStorm(a.id);
  const scene = ctx.scene;
  const at = floorAt(a.x, a.y);
  const blast = Math.max(2.2, a.radius * 2);
  // The rest fell on their warns, so their rock is already here and only the blast is left.
  if (a.index > 0) return burst(meteorBlast(scene, at, blast));
  // The first lands as it is called (no warning time): it streaks the last few metres in.
  const fx = new Fx(() => false);
  fx.child(skyFall(scene, at.add(FALL_DIR.scale(5)), at, {
    speed: 60, body: meteorBody(0.5, FIRE), wake: FIRE, wakeLength: 3, wakeWidth: 0.65, motes: 3, stick: 0,
    onLand: () => fx.child(meteorBlast(scene, at, blast)),
  }));
  return burst(fx);
}

function firestormCast(ctx: LookContext, body: ActorRef): FxHandle<ActorRef> {
  // Fire pulled up out of his raised hands into the sky over the wind-up.
  const scene = ctx.scene;
  let b = body;
  const pool = kitPools(scene).motes;
  let owed = 0;
  const fx = new Fx((f, dt) => {
    const p = posOf(b);
    owed += dt * 45 * f.fade;
    for (; owed >= 1; owed--) {
      pool.emit({
        x: p.x + rand(-0.35, 0.35), y: p.y + rand(1.4, 2), z: p.z + rand(-0.35, 0.35),
        vx: rand(-0.4, 0.4), vy: rand(6, 10), vz: rand(-0.4, 0.4), drag: 0.3, life: rand(0.35, 0.6), size: 0.16, thick: 0.025, stretch: 0.05,
        r: HOT[0], g: HOT[1], b: HOT[2], a: 1, r1: DEEP[0], g1: DEEP[1], b1: DEEP[2],
      });
    }
    if (Math.random() < dt * 12) core(scene, floorAt(p.x, p.z, 2.2 + Math.min(1, f.age) * 0.6), 0.6, HOT, FIRE, 0.15);
    return true;
  }, 0.15);
  return lasting(fx, (_c, s) => { b = s; }, () => {
    const p = posOf(b);
    sparks(scene, floorAt(p.x, p.z, 2), 24, HOT, DEEP, { speed: [2, 4], up: [2, 3.5], gravity: -2, life: [0.4, 0.7], length: 0.22 });
  }, 0.3);
}

// ── Herald of Ash ──────────────────────────────────────────────────────────────

function heraldCast(ctx: LookContext, body: ActorRef): FxHandle<ActorRef> {
  // Ash drawn in round him, then thrown out in a ring of cinders as the herald takes.
  const scene = ctx.scene;
  let b = body;
  const pools = kitPools(scene);
  let owed = 0;
  const fx = new Fx((f, dt) => {
    const p = posOf(b);
    owed += dt * 30 * f.fade;
    for (; owed >= 1; owed--) {
      const a = Math.random() * TAU, d = rand(1.2, 1.8);
      pools.smoke.emit({
        x: p.x + Math.sin(a) * d, y: p.y + rand(0.2, 1.4), z: p.z + Math.cos(a) * d,
        vx: -Math.sin(a) * 3 + Math.cos(a) * 2, vy: 0.4, vz: -Math.cos(a) * 3 - Math.sin(a) * 2, drag: 2,
        life: 0.35, size: 0.18, sizeEnd: 0.08, r: ASH[0], g: ASH[1], b: ASH[2], a: 0.55, r1: 0.2, g1: 0.19, b1: 0.18,
      });
    }
    return true;
  }, 0.1);
  return lasting(fx, (_c, s) => { b = s; }, () => {
    const p = posOf(b);
    const at = floorAt(p.x, p.z);
    kitFlash(scene, at, 0.5, FIRE);
    fx.child(shockRing(scene, at, { radius: 2.4, duration: 0.4, colour: FIRE, lip: 0.5, width: 0.2, dust: 14, dustColour: ASH, flash: 0 }));
    embers(scene, at, 30, HOT, FIRE, { radius: 1, rise: [1, 2.5], life: [0.5, 1] });
  }, 0.5);
}

/** The aura: a broken ring of cinders at his feet and a slow vortex of ash flakes and embers round him. */
function heraldBuff(ctx: LookContext, s: AttachedState): FxHandle<AttachedState> {
  const scene = ctx.scene;
  let b = s.body;
  const ring = cloneOf(scene, cinderRingTemplate(scene), "eb-herald-ring");
  const pools = kitPools(scene);
  let ember = 0, ash = 0, lick = 0;
  const SPIN = 2.2;
  const fx = new Fx((f, dt) => {
    const p = posOf(b);
    const k = clamp01(f.age / 0.35) * f.fade;
    ring.position.set(p.x, p.y + 0.02, p.z);
    ring.scaling.set(1.05, 1, 1.05);
    ring.rotation.y = f.age * 0.35;
    ring.visibility = k * (0.7 + 0.2 * Math.sin(f.age * 5) + 0.1 * Math.sin(f.age * 13));
    ember += dt * 11 * k;
    for (; ember >= 1; ember--) {
      const a = Math.random() * TAU, r = rand(0.65, 1.05), tang = SPIN * r;
      pools.motes.emit({
        x: p.x + Math.sin(a) * r, y: p.y + rand(0.1, 1.2), z: p.z + Math.cos(a) * r,
        vx: Math.cos(a) * tang, vy: rand(0.6, 1.3), vz: -Math.sin(a) * tang, drag: 1.2,
        life: rand(0.6, 1), size: 0.08, thick: 0.018, stretch: 0.04,
        r: 1, g: 0.75, b: 0.35, a: 0.95, r1: DEEP[0], g1: DEEP[1], b1: DEEP[2],
      });
    }
    ash += dt * 6 * k;
    for (; ash >= 1; ash--) {
      const a = Math.random() * TAU, r = rand(0.6, 1), tang = SPIN * r;
      pools.smoke.emit({
        x: p.x + Math.sin(a) * r, y: p.y + rand(0.3, 1.6), z: p.z + Math.cos(a) * r,
        vx: Math.cos(a) * tang, vy: rand(0.2, 0.6), vz: -Math.sin(a) * tang, drag: 1,
        life: rand(0.7, 1.1), size: 0.07, sizeEnd: 0.13, r: 0.16, g: 0.15, b: 0.14, a: 0.6, r1: 0.35, g1: 0.33, b1: 0.31,
      });
    }
    lick += dt * 2 * k;
    for (; lick >= 1; lick--) {
      pools.glow.emit({
        x: p.x + rand(-0.3, 0.3), y: p.y + rand(1.1, 1.5), z: p.z + rand(-0.3, 0.3),
        vy: rand(0.4, 0.8), drag: 1, life: rand(0.25, 0.4), size: 0.1, sizeEnd: 0.28,
        r: 1, g: 0.55, b: 0.18, a: 0.35, r1: 0.5, g1: 0.12, b1: 0.02,
      });
    }
    return true;
  }, 0.4);
  fx.own(ring);
  return lasting(fx, (_c, st) => { b = st.body; }, undefined, 0.6);
}

/** A kill under the herald: an ash flare, then a bed of grey ash with coals glowing through and smoke wisping off. */
function heraldGround(ctx: LookContext, g: GroundState): FxHandle<GroundState> {
  const scene = ctx.scene;
  const at = floorAt(g.x, g.y);
  const R = g.radius;
  const pools = kitPools(scene);
  let st = g;
  kitFlash(scene, at, 0.55, FIRE);
  core(scene, floorAt(g.x, g.y, 0.6), 1.6, HOT, FIRE, 0.18);
  sparks(scene, floorAt(g.x, g.y, 0.4), 26, HOT, DEEP, { speed: [1.5, 4], up: [1, 2.4], gravity: -8, life: [0.4, 0.8], length: 0.14 });
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * TAU;
    pools.smoke.emit({
      x: g.x + Math.sin(a) * 0.25, y: 0.3, z: g.y + Math.cos(a) * 0.25,
      vx: Math.sin(a) * rand(0.3, 1), vy: rand(2.2, 4), vz: Math.cos(a) * rand(0.3, 1), gravity: -2, drag: 1.6,
      life: rand(0.8, 1.3), delay: i * 0.02, size: 0.35, sizeEnd: 1.1, r: 0.22, g: 0.2, b: 0.19, a: 0.55, r1: 0.42, g1: 0.4, b1: 0.38,
    });
  }
  const bed = cloneOf(scene, ashBed(scene), "eb-ash-bed");
  const coals = cloneOf(scene, coalsTemplate(scene), "eb-coals");
  for (const m of [bed, coals]) { m.position.set(g.x, 0.02, g.y); m.rotation.y = Math.random() * TAU; }
  let smoke = 0, ember = 0;
  const fx = new Fx((f, dt) => {
    const grow = easeOut(clamp01(f.age / 0.25));
    const life = f.fade * (st.remaining > 0 ? clamp01(st.remaining / 0.5) : 1);
    bed.scaling.set(R * grow, 1, R * grow);
    coals.scaling.set(R * grow, 1, R * grow);
    bed.visibility = life;
    coals.visibility = life * (0.7 + 0.2 * Math.sin(f.age * 6) + 0.1 * Math.sin(f.age * 17));
    smoke += dt * 2.5 * life;
    for (; smoke >= 1; smoke--) {
      const a = Math.random() * TAU, d = R * 0.7 * Math.sqrt(Math.random());
      pools.smoke.emit({
        x: g.x + Math.sin(a) * d, y: 0.1, z: g.y + Math.cos(a) * d, vx: rand(-0.1, 0.1), vy: rand(0.4, 0.8), vz: rand(-0.1, 0.1),
        drag: 0.8, life: rand(1, 1.5), size: 0.2, sizeEnd: 0.6, r: 0.3, g: 0.29, b: 0.28, a: 0.3, r1: 0.45, g1: 0.44, b1: 0.43,
      });
    }
    ember += dt * 6 * life;
    for (; ember >= 1; ember--) embers(scene, at, 1, HOT, FIRE, { radius: R * 0.75, rise: [0.4, 1.1], life: [0.5, 0.9], motes: true });
    return true;
  }, 0.5);
  fx.own(bed);
  fx.own(coals);
  fx.child(shockRing(scene, at, { radius: R * 1.4, duration: 0.35, colour: FIRE, lip: 0.45, width: 0.2, dust: 10, dustColour: ASH, flash: 0 }));
  return lasting(fx, (_c, s) => { st = s; }, undefined, 1);
}

// ── Registry ───────────────────────────────────────────────────────────────────

/**
 * Clips and releases are measured off anim-library.glb (FK over the takes): Sword_Dash
 * bottoms out at 0.2 and leans 0.5 from 0.2 to 0.7, so the 4-tick wind-up lands on
 * the crouch and the 6-tick travel plays the held lean; LiftAir swings from the
 * forward gather to the upward heave at 0.4; Spell_Simple_Enter's hand reaches the
 * target at 0.8; OverhandThrow's hand is fastest, out in front, at 0.3;
 * MonsterTransformation brings both arms down from overhead at 0.3; Surprise's
 * hand is on the chest at 0.1.
 */
export const EMBERBOUND_LOOKS: ClassSkillLooks = {
  skills: {
    // Level 8, before this kit: keeps its shipped cast and cue, only the field is redrawn.
    "skill.cinder_ground.v1": { ground: { create: cinderGround } },
    "skill.flame_dash.v1": {
      // The cast take carries through the travel (which plays none), so the rush is one motion.
      cast: { clip: "swordDash", release: 0.2, start: flameDashCast },
      travel: { face: "travel", start: flameDashTravel, land: flameDashLand },
      ground: { create: flameDashGround },
    },
    "skill.ember_nova.v1": {
      cast: { clip: "liftAir", release: 0.4, start: emberNovaCast },
      area: { impact: emberNovaImpact },
    },
    "skill.flammability.v1": {
      cast: { clip: "spellEnter", release: 0.8, start: flammabilityCast },
      area: { impact: (ctx, a) => burst(curseSlam(ctx.scene, a.x, a.y, a.radius)) },
    },
    "skill.solar_orb.v1": {
      cast: { clip: "overhandThrow", release: 0.3, start: solarOrbCast },
      ground: { create: solarOrbGround },
    },
    "skill.firestorm.v1": {
      cast: { clip: "transform", release: 0.3, start: firestormCast },
      area: { warn: firestormWarn, impact: firestormImpact },
    },
    "skill.herald_of_ash.v1": {
      cast: { clip: "surprise", release: 0.1, playback: 1.5, start: heraldCast },
      ground: { create: heraldGround },
    },
  },
  buffs: {
    herald_of_ash: { create: heraldBuff },
  },
  statuses: {
    flammable: flammableStatus,
  },
};
