import { Mesh, MeshBuilder, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { addMat, clamp01, cloneOf, Fx, fxMesh, Geo, kitFlash, litMat, ragged, rand, rgba, TAU, template, type Rgb } from "./core";
import { throwChunks } from "./chunks";
import { core, puff, sparks } from "./emit";
import { shockRing } from "./ground";

/**
 * Cold: shards of real ice thrown and spinning, a pale mist that hangs, a frost
 * ring on the floor and crystals that grow out of the ground and shatter. Ice
 * reads by its hard facets and silhouette, so the solids are lit PBR with a
 * little self-light, and only the mist and the ring are soft.
 */

export const FROST: Rgb = [0.6, 0.85, 1];
const ICE_HOT: Rgb = [0.92, 0.98, 1];
const MIST: Rgb = [0.72, 0.85, 0.95];

export interface FrostBurstOptions {
  radius?: number;
  colour?: Rgb;
  shards?: number;
  mist?: number;
  ring?: boolean;
  flash?: number;
  /** A ring of crystals left standing round the burst. */
  crystals?: boolean;
}

/** A burst of cold: ice shards flung, glints, mist, a frost ring and a frosted floor patch. */
export function frostBurst(scene: Scene, at: Vector3, o: FrostBurstOptions = {}): Fx {
  const R = o.radius ?? 2.5;
  const c = o.colour ?? FROST;
  const fx = new Fx(() => false);
  kitFlash(scene, at, o.flash ?? 0.5, c);
  const up = new Vector3(at.x, at.y + 0.5, at.z);
  core(scene, up, R * 0.5, ICE_HOT, c, 0.16);
  throwChunks(scene, "ice", at, { count: o.shards ?? 24, speed: [R * 0.8, R * 2], up: [2, 5], size: [0.08, 0.26], spread: 0.3 });
  sparks(scene, up, 18, ICE_HOT, c, { speed: [4, 9], up: [0, 0.6], gravity: -4, life: [0.12, 0.3], length: 0.2 });
  const mist = o.mist ?? 8;
  for (let i = 0; i < mist; i++) {
    const a = (i / mist) * TAU;
    puff(scene, at.x, at.y, at.z, { size: 1.1, drift: rand(1.5, 2.5) * R / 2.5, rise: 0.2, yaw: a, life: rand(0.9, 1.4), colour: MIST, alpha: 0.3 });
  }
  if (o.ring !== false) fx.child(shockRing(scene, at, { radius: R, duration: 0.4, colour: c, lip: 0.45, dust: 0, flash: 0 }));
  fx.child(frostPatch(scene, at, R * 0.85, c));
  if (o.crystals) fx.child(iceCrystalCluster(scene, at, { count: 6, radius: R * 0.55, height: 0.9, hold: 0.8 }));
  return fx;
}

/** A frosted floor patch: a pale ragged rime that brightens the ground and melts away. */
function frostPatch(scene: Scene, at: Vector3, R: number, c: Rgb): Fx {
  const g = new Geo();
  const edge = ragged(0.22);
  g.lathe([
    { r: 0, y: 0, c: rgba(c, 0.35, 1.2) },
    { r: 0.7, y: 0, c: rgba(c, 0.25) },
    { r: 1, y: 0, c: rgba(c, 0) },
  ], 40, 0, TAU, { jitter: (yaw, k) => (k === 0 ? 1 : edge(yaw)) });
  const m = fxMesh(scene, g.mesh(scene, "kit-frost-patch"), addMat(scene));
  m.position.set(at.x, at.y + 0.015, at.z);
  m.scaling.set(R, 1, R);
  const fx = new Fx((f) => {
    m.visibility = clamp01(f.age / 0.1) * clamp01(1 - (f.age - 1.2) / 1);
    return f.age < 2.2;
  });
  fx.own(m);
  return fx;
}

function spikeTemplate(scene: Scene): Mesh {
  return template(scene, "ice-spike", () => {
    // A hexagonal prism capped by a point, base at y=0: the crystal habit.
    const shaft = MeshBuilder.CreateCylinder("kit-ice-shaft", { height: 0.7, diameter: 0.22, tessellation: 6 }, scene);
    shaft.position.y = 0.35;
    const tip = MeshBuilder.CreateCylinder("kit-ice-tip", { height: 0.3, diameterTop: 0, diameterBottom: 0.22, tessellation: 6 }, scene);
    tip.position.y = 0.85;
    const m = Mesh.MergeMeshes([shaft, tip], true, true)!;
    m.convertToFlatShadedMesh();
    m.material = litMat(scene, "ice", [0.62, 0.82, 0.95], [0.25, 0.45, 0.65], 0.15, 0.88);
    return m;
  });
}

export interface CrystalOptions {
  count?: number;
  /** Tallest spike, and the radius they stand within. */
  height?: number;
  radius?: number;
  /** Seconds each takes to grow, and to stand before shattering. */
  grow?: number;
  hold?: number;
  /** False keeps them until `shatter()` (or `stop()`). */
  shatter?: boolean;
}

export interface CrystalFx extends Fx {
  shatter(): void;
}

/** Ice crystals that punch up out of the floor, stand, and shatter into shards and mist. */
export function iceCrystalCluster(scene: Scene, at: Vector3, o: CrystalOptions = {}): CrystalFx {
  const n = o.count ?? 7;
  const H = o.height ?? 1.4;
  const R = o.radius ?? 0.6;
  const grow = o.grow ?? 0.18;
  const hold = o.hold ?? 0.7;
  const tpl = spikeTemplate(scene);
  const spikes: { m: Mesh; h: number; delay: number }[] = [];
  for (let i = 0; i < n; i++) {
    const m = cloneOf(scene, tpl, "kit-ice-spike");
    const a = (i / n) * TAU + rand(-0.3, 0.3);
    // The tallest in the middle, smaller and leaning out toward the rim.
    const d = i === 0 ? 0 : R * rand(0.35, 1);
    const h = H * (i === 0 ? 1 : rand(0.4, 0.8)) * (1 - 0.35 * (d / R));
    m.position.set(at.x + Math.sin(a) * d, at.y - 0.05, at.z + Math.cos(a) * d);
    // Leaning out from the middle by how far out it stands.
    m.rotation.set((d / R) * 0.55 * Math.cos(a), 0, -(d / R) * 0.55 * Math.sin(a));
    m.scaling.set(0, 0, 0);
    spikes.push({ m, h, delay: i * 0.03 });
  }
  let broke = -1;
  const breakNow = () => {
    if (broke >= 0) return;
    broke = fx.age;
    kitFlash(scene, at, 0.4, FROST);
    for (const s of spikes) {
      const p = s.m.position;
      throwChunks(scene, "ice", new Vector3(p.x, at.y, p.z), { count: 5, speed: [1, 3], up: [2, 4.5], size: [0.05, 0.16], spread: 0.1 });
      sparks(scene, new Vector3(p.x, at.y + s.h * 0.5, p.z), 4, ICE_HOT, FROST, { speed: [2, 5], life: [0.1, 0.25] });
      s.m.setEnabled(false);
    }
    for (let i = 0; i < 5; i++) puff(scene, at.x, at.y, at.z, { size: 0.9, drift: 1.2, colour: MIST, alpha: 0.28, life: 1 });
  };
  const fx = new Fx((f) => {
    if (broke < 0) {
      for (const s of spikes) {
        const k = clamp01((f.age - s.delay) / grow);
        // Overshoot then settle: it punches up out of the ground.
        const e = k < 1 ? 1 + 1.7 * (k - 1) ** 3 + 0.7 * (k - 1) ** 2 : 1;
        const w = s.h / H;
        s.m.scaling.set(0.8 + 0.6 * w, s.h * e, 0.8 + 0.6 * w);
      }
      if (f.stopped || ((o.shatter ?? true) && f.age >= grow + n * 0.03 + hold)) breakNow();
      return true;
    }
    // A brief moment for the shards to leave before the effect reports done.
    return f.age - broke < 0.1;
  }) as CrystalFx;
  for (const s of spikes) fx.own(s.m);
  fx.shatter = breakNow;
  // The rising ice kicks rime off the floor.
  for (let i = 0; i < 4; i++) puff(scene, at.x, at.y, at.z, { size: 0.7, drift: 1, colour: MIST, alpha: 0.25 });
  return fx;
}
