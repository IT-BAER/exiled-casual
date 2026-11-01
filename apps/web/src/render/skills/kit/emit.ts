import type { Scene, Vector3 } from "@babylonjs/core";
import { kitPools, rand, TAU, type Rgb } from "./core";

/**
 * Pooled particle recipes shared by the primitives. Every one is geometry from
 * the kit pools (`core.ts` `kitPools`), never a sprite: emitting allocates nothing.
 */

export const DUST: Rgb = [0.46, 0.4, 0.32];

/** A puff of floor dust (or mist, in another colour) that veils rather than glows. */
export function puff(
  scene: Scene, x: number, y: number, z: number,
  o: { size?: number; delay?: number; drift?: number; rise?: number; life?: number; colour?: Rgb; alpha?: number; yaw?: number } = {},
): void {
  const a = o.yaw ?? Math.random() * TAU;
  const c = o.colour ?? DUST;
  const drift = o.drift ?? 0.8;
  const size = o.size ?? 0.8;
  kitPools(scene).smoke.emit({
    x: x + Math.sin(a) * 0.15, y: y + 0.12, z: z + Math.cos(a) * 0.15,
    vx: Math.sin(a) * drift, vy: o.rise ?? 0.35, vz: Math.cos(a) * drift, drag: 2.5,
    life: o.life ?? rand(0.45, 0.8), delay: o.delay ?? 0, size: size * 0.5, sizeEnd: size * 1.5,
    r: c[0], g: c[1], b: c[2], a: o.alpha ?? 0.32, r1: c[0] * 0.8, g1: c[1] * 0.85, b1: c[2] * 0.95,
  });
}

/** Sparks flung out of a point: `up` 0 is flat, 1 a fountain. Hot colour cooling to `cool`. */
export function sparks(
  scene: Scene, at: Vector3, count: number, hot: Rgb, cool: Rgb,
  o: { speed?: readonly [number, number]; up?: readonly [number, number]; gravity?: number; life?: readonly [number, number]; length?: number; thick?: number; yaw?: number; cone?: number; delay?: number } = {},
): void {
  const pool = kitPools(scene).shards;
  const [s0, s1] = o.speed ?? [3, 7];
  const [u0, u1] = o.up ?? [0.1, 0.8];
  const [l0, l1] = o.life ?? [0.15, 0.4];
  for (let i = 0; i < count; i++) {
    const yaw = o.yaw === undefined ? ((i + Math.random()) / count) * TAU : o.yaw + rand(-1, 1) * (o.cone ?? 0.6);
    const speed = rand(s0, s1);
    pool.emit({
      x: at.x, y: at.y, z: at.z,
      vx: Math.sin(yaw) * speed, vy: speed * rand(u0, u1), vz: Math.cos(yaw) * speed,
      gravity: o.gravity ?? -9, drag: 1.4, life: rand(l0, l1), delay: o.delay ?? 0,
      size: o.length ?? 0.16, thick: o.thick ?? 0.022, stretch: 0.03,
      r: hot[0], g: hot[1], b: hot[2], a: 1, r1: cool[0], g1: cool[1], b1: cool[2],
    });
  }
}

/** The white-hot swelling core every loud hit starts with. Small and brief: a big translucent ball reads as a disc. */
export function core(scene: Scene, at: Vector3, size: number, hot: Rgb, cool: Rgb, life = 0.16, delay = 0): void {
  kitPools(scene).glow.emit({
    x: at.x, y: at.y, z: at.z, life, delay, size: size * 0.3, sizeEnd: size,
    r: hot[0], g: hot[1], b: hot[2], a: 0.95, r1: cool[0], g1: cool[1], b1: cool[2],
  });
}

/** Embers lifting off a point or a disc of `radius`, drifting and cooling. `motes` uses the long-running pool. */
export function embers(
  scene: Scene, at: Vector3, count: number, hot: Rgb, cool: Rgb,
  o: { radius?: number; rise?: readonly [number, number]; life?: readonly [number, number]; size?: number; motes?: boolean; delay?: number; gravity?: number } = {},
): void {
  const pool = o.motes ? kitPools(scene).motes : kitPools(scene).shards;
  const [r0, r1] = o.rise ?? [0.5, 1.4];
  const [l0, l1] = o.life ?? [0.5, 1.1];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const d = Math.sqrt(Math.random()) * (o.radius ?? 0);
    pool.emit({
      x: at.x + Math.sin(a) * d, y: at.y, z: at.z + Math.cos(a) * d,
      vx: rand(-0.25, 0.25), vy: rand(r0, r1), vz: rand(-0.25, 0.25), gravity: o.gravity ?? 0.4, drag: 0.5,
      life: rand(l0, l1), delay: o.delay ?? 0, size: o.size ?? 0.06, thick: 0.016, stretch: 0.05,
      r: hot[0], g: hot[1], b: hot[2], a: 0.95, r1: cool[0], g1: cool[1], b1: cool[2],
    });
  }
}
