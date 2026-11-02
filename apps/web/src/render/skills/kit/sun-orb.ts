import { MeshBuilder, PointLight, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import { addMat, clamp01, cloneOf, Fx, fxMesh, Geo, kitPools, pointOf, rand, rgba, TAU, template, type Point, type Rgb } from "./core";
import { core, embers } from "./emit";
import { shockRing } from "./ground";
import { ORB_LIGHT_NAME, orbLight } from "../../skill-fx";

/**
 * A hovering sun: a white-hot core in layered corona shells that breathe out of
 * step, flare loops wheeling round it on tilted axes, and the one light the kit
 * owns (an orb is a lamp that moves with the player; a borrowed flash would be
 * yanked away by every hit). `pulse()` throws a ring of heat across the floor.
 */

export const SUN_LIGHT_NAME = ORB_LIGHT_NAME;
const SUN_INTENSITY = 90;
const SUN_RANGE = 6;

function coreTemplate(scene: Scene, c: Rgb, key: string, k: number): Mesh {
  return template(scene, `sun-${key}-${c.join("_")}`, () => {
    const m = MeshBuilder.CreateSphere(`kit-sun-${key}`, { diameter: 1, segments: 12 }, scene);
    return fxMesh(scene, m, addMat(scene, [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)], true));
  });
}

function flareTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `sun-flare-${c.join("_")}`, () => {
    // An open loop of fire: a tube cross-section lathed round most of a circle, thick in the middle, gone at the ends.
    const g = new Geo();
    const arc = TAU * 0.62;
    const segs = 28;
    const base = g.pos.length / 3;
    const ring = 6;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const yaw = u * arc;
      const thick = 0.07 * Math.sin(u * Math.PI);
      const a = Math.sin(u * Math.PI) ** 0.8;
      for (let k = 0; k < ring; k++) {
        const t = (k / ring) * TAU;
        const r = 1 + Math.cos(t) * thick;
        g.vert(Math.sin(yaw) * r, Math.sin(t) * thick, Math.cos(yaw) * r, rgba(c, a * 0.9, 1.2));
      }
    }
    for (let s = 0; s < segs; s++) {
      for (let k = 0; k < ring; k++) {
        const a = base + s * ring + k, b = base + s * ring + ((k + 1) % ring);
        g.quad(a, b, a + ring, b + ring);
      }
    }
    return fxMesh(scene, g.mesh(scene, "kit-sun-flare"), addMat(scene, [1, 1, 1], true));
  });
}

export interface SunOrbOptions {
  /** Core radius. */
  radius?: number;
  /** Corona colour; the core is near white. */
  colour?: Rgb;
  /** Height above the followed point (the floor under it). */
  height?: number;
  /** Own a point light (default true). */
  light?: boolean;
  intensity?: number;
}

export interface SunOrbFx extends Fx {
  /** Throw a ring of heat across the floor from under the orb, with a swell of the core and a flare of light. */
  pulse(strength?: number): void;
}

/** A hovering sun orb following `follow`; lasting until `stop()`. */
export function sunOrb(scene: Scene, follow: Point, o: SunOrbOptions = {}): SunOrbFx {
  const R = o.radius ?? 0.45;
  const c = o.colour ?? [1, 0.62, 0.18];
  const lift = o.height ?? 2;
  const parts: { m: Mesh; scale: number; alpha: number; rate: number; ph: number }[] = [];
  const add = (m: Mesh, scale: number, alpha: number, rate: number) => {
    parts.push({ m, scale, alpha, rate, ph: Math.random() * TAU });
    return m;
  };
  add(cloneOf(scene, coreTemplate(scene, [1, 0.95, 0.8], "core", 1), "kit-sun-core"), 2 * R, 1, 9);
  add(cloneOf(scene, coreTemplate(scene, c, "corona", 1.2), "kit-sun-corona"), 2 * R * 1.55, 0.7, 5);
  add(cloneOf(scene, coreTemplate(scene, c, "halo", 0.8), "kit-sun-halo"), 2 * R * 2.3, 0.35, 3);
  add(cloneOf(scene, coreTemplate(scene, [c[0], c[1] * 0.6, c[2] * 0.4], "outer", 0.6), "kit-sun-outer"), 2 * R * 3.2, 0.16, 2);
  const flares: { m: Mesh; axis: Vector3; spin: number; tilt: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const m = cloneOf(scene, flareTemplate(scene, c), "kit-sun-flare");
    flares.push({ m, axis: new Vector3(rand(-1, 1), 1, rand(-1, 1)).normalize(), spin: rand(1.5, 3) * (i % 2 ? -1 : 1), tilt: rand(0.4, 1.2) });
  }
  let light: PointLight | null = null;
  const peak = o.intensity ?? SUN_INTENSITY;
  if (o.light !== false) {
    light = orbLight(scene);
    light.diffuse.set(c[0], Math.min(1, c[1] * 1.1), c[2]);
    light.range = SUN_RANGE;
  }
  const at = new Vector3();
  let swell = 0;
  let motes = 0;
  const fx = new Fx((f, dt) => {
    pointOf(follow, at);
    at.y += lift;
    const fadeIn = clamp01(f.age / 0.3);
    const k = fadeIn * f.fade;
    swell = Math.max(0, swell - dt * 3);
    for (const p of parts) {
      const breathe = 1 + 0.06 * Math.sin(f.age * p.rate + p.ph) + 0.25 * swell;
      p.m.position.copyFrom(at);
      p.m.scaling.setAll(p.scale * breathe * (0.4 + 0.6 * k));
      p.m.visibility = p.alpha * k * (0.9 + 0.1 * Math.sin(f.age * 17 + p.ph));
    }
    for (const fl of flares) {
      fl.m.position.copyFrom(at);
      fl.m.scaling.setAll(R * 1.5 * (0.5 + 0.5 * k) * (1 + 0.2 * swell));
      fl.m.rotation.set(fl.tilt, f.age * fl.spin, fl.tilt * 0.5 * Math.sin(f.age * 0.7));
      fl.m.visibility = k * (0.7 + 0.3 * Math.sin(f.age * 6 + fl.spin));
    }
    if (light) {
      light.position.copyFrom(at);
      light.intensity = peak * k * (0.88 + 0.12 * Math.sin(f.age * 13) * Math.sin(f.age * 7.3)) * (1 + 1.5 * swell);
    }
    // Sparks peeling off the surface and drifting up, a few a second.
    motes += dt * 10 * k;
    for (; motes >= 1; motes--) {
      const a = Math.random() * TAU, e = rand(-0.6, 0.9);
      kitPools(scene).motes.emit({
        x: at.x + Math.sin(a) * Math.cos(e) * R * 1.2, y: at.y + Math.sin(e) * R * 1.2, z: at.z + Math.cos(a) * Math.cos(e) * R * 1.2,
        vx: Math.sin(a) * 0.4, vy: rand(0.4, 1), vz: Math.cos(a) * 0.4, drag: 1, life: rand(0.4, 0.8), size: 0.06, thick: 0.016, stretch: 0.04,
        r: 1, g: 0.9, b: 0.6, a: 0.95, r1: c[0] * 0.8, g1: c[1] * 0.4, b1: 0.02,
      });
    }
    return true;
  }, 0.4) as SunOrbFx;
  for (const p of parts) fx.own(p.m);
  for (const fl of flares) fx.own(fl.m);
  if (light) fx.onDispose(() => { light!.intensity = 0; });
  fx.pulse = (strength = 1) => {
    if (fx.stopped || fx.done) return;
    swell = Math.min(1.5, swell + strength);
    // The followed point is the floor under the orb (`height` lifts the orb off it).
    const floor = pointOf(follow, new Vector3());
    core(scene, at, R * 4, [1, 0.97, 0.85], c, 0.2);
    embers(scene, at, 12, [1, 0.9, 0.6], c, { radius: R, rise: [-1, 2], life: [0.3, 0.6] });
    fx.child(shockRing(scene, floor, { radius: 3.2 * strength, duration: 0.45, colour: c, lip: 0.4, dust: 0, flash: 0 }));
  };
  return fx;
}
