import { Mesh, MeshBuilder, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { addMat, clamp01, Fx, fxMesh, kitFlash, pointOf, rand, type Point, type Rgb } from "./core";
import { core, sparks } from "./emit";

/**
 * Lightning: real tubes, not cards. A bolt is a jagged white core inside a
 * fatter, feathered halo of its colour, with forks off it; the whole path is
 * re-jagged several times a second and flickers, so it crackles instead of
 * hanging there like a wire. Ends are read every frame, so a bolt between two
 * moving bodies stays attached to both.
 */

export interface LightningOptions {
  /** Halo colour; the core is near white. */
  colour?: Rgb;
  /** Seconds it lives (it fades through the last third). */
  duration?: number;
  /** Core radius; the halo is three times it. */
  width?: number;
  /** Kinks along the main path, and how far they wander as a share of its length. */
  segments?: number;
  jag?: number;
  branches?: number;
  /** Seconds between re-jags. */
  rejag?: number;
  /** Shared-flash level at the far end (0 none), and sparks thrown there. */
  flash?: number;
  sparks?: number;
}

const sA = new Vector3();
const sB = new Vector3();

/** Fill `out` with a jagged path from a to b: displaced perpendicular to the line, pinned at both ends. */
function jagPath(a: Vector3, b: Vector3, out: Vector3[], amp: number): void {
  const n = out.length - 1;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  // Two perpendiculars to the line: sideways on the floor, and up.
  let px = -dz / len, pz = dx / len;
  const pl = Math.hypot(px, pz) || 1;
  px /= pl; pz /= pl;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Pinned ends, loosest in the middle.
    const env = Math.sin(t * Math.PI) ** 0.7;
    const side = (i === 0 || i === n) ? 0 : rand(-1, 1) * amp * len * env;
    const up = (i === 0 || i === n) ? 0 : rand(-0.6, 0.6) * amp * len * env;
    out[i]!.set(a.x + dx * t + px * side, a.y + dy * t + up, a.z + dz * t + pz * side);
  }
}

interface Strand { core: Mesh; halo: Mesh; path: Vector3[]; at: number; reach: number; yaw: number }

function tube(scene: Scene, name: string, path: Vector3[], radius: number, instance?: Mesh): Mesh {
  const n = path.length - 1;
  return MeshBuilder.CreateTube(name, {
    path, radius, tessellation: 5, cap: Mesh.NO_CAP, updatable: true, instance,
    // Thinner toward the ends: a strike, not a pipe.
    radiusFunction: (i) => radius * (0.35 + 0.65 * Math.sin((i / n) * Math.PI)),
  }, scene);
}

export interface LightningFx extends Fx {
  /** Move the ends (a chain arc following two bodies). */
  setEnds(from: Point, to: Point): void;
}

/** A forked lightning bolt between two points, re-jagged and flickering, with a flash and sparks where it strikes. */
export function lightningBolt(scene: Scene, from: Point, to: Point, o: LightningOptions = {}): LightningFx {
  const c = o.colour ?? [0.55, 0.75, 1];
  const dur = o.duration ?? 0.28;
  const w = o.width ?? 0.035;
  const segs = o.segments ?? 12;
  const jag = o.jag ?? 0.09;
  const rejag = o.rejag ?? 0.045;
  let ends: [Point, Point] = [from, to];
  const coreMat = addMat(scene, [0.92, 0.96, 1]);
  const haloMat = addMat(scene, c, true);
  const mk = (n: number, r: number): Strand => {
    const path = Array.from({ length: n + 1 }, () => new Vector3());
    // A first path so the tube has length; it is re-laid before it is ever drawn.
    for (let i = 0; i <= n; i++) path[i]!.set(0, 0, i * 0.1);
    return {
      core: fxMesh(scene, tube(scene, "kit-bolt-core", path, r), coreMat),
      halo: fxMesh(scene, tube(scene, "kit-bolt-halo", path, r * 3.2), haloMat),
      path, at: 0, reach: 0, yaw: 0,
    };
  };
  const main = mk(segs, w);
  const forks: Strand[] = [];
  for (let b = 0; b < (o.branches ?? 3); b++) forks.push(mk(5, w * 0.6));
  const relay = () => {
    pointOf(ends[0], sA);
    pointOf(ends[1], sB);
    jagPath(sA, sB, main.path, jag);
    main.core = tube(scene, "kit-bolt-core", main.path, w, main.core);
    main.halo = tube(scene, "kit-bolt-halo", main.path, w * 3.2, main.halo);
    const len = Vector3.Distance(sA, sB);
    for (const f of forks) {
      // A fork leaves a kink on the main path and runs off at an angle, shorter and thinner.
      const i = 1 + Math.floor(Math.random() * (segs - 2));
      const root = main.path[i]!;
      const next = main.path[i + 1]!;
      const dir = next.subtract(root).normalize();
      const yaw = rand(0.5, 1.1) * (Math.random() < 0.5 ? -1 : 1);
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const end = new Vector3(dir.x * cos - dir.z * sin, dir.y - rand(0.1, 0.5), dir.x * sin + dir.z * cos)
        .normalize().scaleInPlace(len * rand(0.18, 0.38)).addInPlace(root);
      jagPath(root, end, f.path, jag * 1.4);
      f.core = tube(scene, "kit-bolt-core", f.path, w * 0.6, f.core);
      f.halo = tube(scene, "kit-bolt-halo", f.path, w * 1.9, f.halo);
    }
  };
  relay();
  let since = 0;
  let struck = false;
  const fx = new Fx((f, dt) => {
    since += dt;
    if (since >= rejag) {
      since = 0;
      relay();
    }
    if (!struck) {
      struck = true;
      pointOf(ends[1], sB);
      if ((o.flash ?? 0.7) > 0) kitFlash(scene, sB, o.flash ?? 0.7, [0.65, 0.8, 1]);
      core(scene, sB, 0.7, [1, 1, 1], c, 0.12);
      sparks(scene, sB, o.sparks ?? 10, [0.95, 0.98, 1], c, { speed: [3, 8], up: [0.1, 1], life: [0.1, 0.25], length: 0.18 });
    }
    const t = f.age / dur;
    const env = t < 0.66 ? 1 : clamp01((1 - t) / 0.34);
    // Flicker: lightning strobes, it never holds steady.
    const flick = env * f.fade * rand(0.55, 1);
    main.core.visibility = flick;
    main.halo.visibility = flick * 0.8;
    for (const s of forks) {
      const k = flick * rand(0.3, 1);
      s.core.visibility = k;
      s.halo.visibility = k * 0.7;
    }
    return f.age < dur;
  }) as LightningFx;
  for (const s of [main, ...forks]) {
    fx.own(s.core);
    fx.own(s.halo);
  }
  fx.setEnds = (a, b) => {
    ends = [a, b];
  };
  return fx;
}

export interface ChainArcOptions extends LightningOptions {}

/** A quick arc between two moving points: one fork, short-lived, re-read every frame. */
export function chainArc(scene: Scene, from: Point, to: Point, o: ChainArcOptions = {}): LightningFx {
  return lightningBolt(scene, from, to, {
    duration: 0.2, branches: 1, segments: 9, jag: 0.12, rejag: 0.035, flash: 0.45, sparks: 6, width: 0.028, ...o,
  });
}
