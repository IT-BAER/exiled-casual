import { MeshBuilder, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import { buildArrow } from "../../skill-fx";
import {
  addMat, cloneOf, Fx, fxMesh, Geo, kitFlash, kitPools, litMat, rand, rgba, TAU, template,
  type Rgb,
} from "./core";
import { throwChunks } from "./chunks";
import { core, embers, puff, sparks } from "./emit";
import { fissure, scorch, shockRing } from "./ground";

/**
 * Things that fall out of the sky: an arrow volley's arrows and a meteor. A body
 * flies a straight line from height to the floor with a tapered wake laid back
 * along its path, sheds motes as it goes, and lands on `onLand`.
 */

/** What flies: a node pointing down +Z (as every mover does); disposed on landing or after it has stuck. */
export type BodyFactory = (scene: Scene) => TransformNode;

/** An arrow, nocked size: the game's own (`skill-fx.ts` `buildArrow`). */
export function arrowBody(scene: Scene): TransformNode {
  return buildArrow(scene, "kit-sky-arrow");
}

function rockTemplate(scene: Scene): Mesh {
  return template(scene, "meteor-rock", () => {
    const m = MeshBuilder.CreateIcoSphere("kit-meteor-rock", { radius: 0.5, subdivisions: 2, updatable: true }, scene);
    const p = m.getVerticesData("position")!;
    // Lumps, not a ball: the silhouette is the read when bloom is off.
    for (let i = 0; i < p.length; i += 3) {
      const k = 0.78 + 0.3 * Math.abs(Math.sin(p[i]! * 9 + p[i + 2]! * 5) * Math.cos(p[i + 1]! * 7));
      p[i]! *= k; p[i + 1]! *= k; p[i + 2]! *= k;
    }
    m.updateVerticesData("position", p);
    m.convertToFlatShadedMesh();
    m.material = litMat(scene, "meteor-rock", [0.1, 0.06, 0.04], [0.55, 0.16, 0.03], 0.85);
    return m;
  });
}

function shellTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `meteor-shell-${c.join("_")}`, () => {
    const m = MeshBuilder.CreateSphere("kit-meteor-shell", { diameter: 1, segments: 10 }, scene);
    return fxMesh(scene, m, addMat(scene, c, true));
  });
}

/** A meteor's body: a lumpy molten rock in a feathered shell of fire. */
export function meteorBody(size = 0.6, colour: Rgb = [1, 0.5, 0.12]): BodyFactory {
  return (scene) => {
    const root = new TransformNode("kit-meteor", scene);
    const rock = cloneOf(scene, rockTemplate(scene), "kit-meteor-rock");
    rock.scaling.setAll(size);
    rock.parent = root;
    const shell = cloneOf(scene, shellTemplate(scene, colour), "kit-meteor-shell");
    shell.scaling.setAll(size * 1.6);
    shell.visibility = 0.75;
    shell.parent = root;
    return root;
  };
}

function wakeTemplate(scene: Scene, c: Rgb): Mesh {
  return template(scene, `sky-wake-${c.join("_")}`, () => {
    const g = new Geo();
    // A tapered cone along -Z from the body back to a point: rings of (r, y) lathed round Y, then laid down.
    const rings = 8;
    const prof = [];
    for (let k = 0; k <= rings; k++) {
      const s = k / rings; // 0 at the body, 1 at the tip
      prof.push({ r: 0.5 * (1 - s) ** 0.7, y: -s, c: rgba(c, (1 - s) ** 1.4 * 0.9, 1 + 0.6 * (1 - s)) });
    }
    g.lathe(prof, 10);
    const m = g.mesh(scene, "kit-sky-wake");
    m.rotation.x = Math.PI / 2; // +Y lathe axis onto +Z: the tail runs back along -Z.
    m.bakeCurrentTransformIntoVertices();
    return fxMesh(scene, m, addMat(scene, [1, 1, 1], true));
  });
}

export interface SkyFallOptions {
  /** Units a second along the fall. */
  speed?: number;
  /** Seconds before it appears. */
  delay?: number;
  body?: BodyFactory;
  /** Wake: colour, length and width (0 length for none). */
  wake?: Rgb;
  wakeLength?: number;
  wakeWidth?: number;
  /** Motes shed per unit flown. */
  motes?: number;
  /** Seconds the body stays where it landed (an arrow sticks), 0 to vanish on impact. */
  stick?: number;
  /** Tumble, radians a second round its flight axis. */
  spin?: number;
  onLand?: (at: Vector3) => void;
  /** Called every frame in flight with the body's position, for a caller's own trail. */
  onFly?: (at: Vector3, dt: number) => void;
}

const FWD = new Vector3(0, 0, 1);
const sDir = new Vector3();
const sQ = new Quaternion();
const sSpin = new Quaternion();

/** A body falling from `from` to `to` in a straight line, with its wake, landing on `onLand`. */
export function skyFall(scene: Scene, from: Vector3, to: Vector3, o: SkyFallOptions = {}): Fx {
  const speed = o.speed ?? 22;
  const delay = o.delay ?? 0;
  const dist = Vector3.Distance(from, to);
  const flight = dist / speed;
  to.subtractToRef(from, sDir).normalize();
  const dir = sDir.clone();
  const look = Quaternion.Identity();
  Quaternion.FromUnitVectorsToRef(FWD, dir, look);
  const body = (o.body ?? arrowBody)(scene);
  body.rotationQuaternion = look.clone();
  body.position.copyFrom(from);
  body.setEnabled(false);
  const wakeLen = o.wakeLength ?? 1.6;
  const wakeC = o.wake ?? [0.85, 0.82, 0.72];
  let wake: Mesh | null = null;
  if (wakeLen > 0) {
    wake = cloneOf(scene, wakeTemplate(scene, wakeC), "kit-sky-wake");
    wake.setEnabled(false);
  }
  const motes = o.motes ?? 1.5;
  let owed = 0;
  let landed = -1;
  let roll = 0;
  const pos = new Vector3();
  const last = from.clone();
  const fx = new Fx((f, dt) => {
    const t = f.age - delay;
    if (t < 0) return true;
    if (landed < 0) {
      const k = Math.min(1, t / flight);
      Vector3.LerpToRef(from, to, k, pos);
      body.setEnabled(true);
      body.position.copyFrom(pos);
      if (o.spin) {
        roll += o.spin * dt;
        Quaternion.RotationAxisToRef(FWD, roll, sSpin);
        look.multiplyToRef(sSpin, body.rotationQuaternion!);
      }
      if (wake) {
        wake.setEnabled(true);
        wake.position.copyFrom(pos);
        (wake.rotationQuaternion ??= new Quaternion()).copyFrom(look);
        const len = Math.min(wakeLen, k * dist);
        wake.scaling.set(o.wakeWidth ?? 0.07, o.wakeWidth ?? 0.07, len);
      }
      const run = Vector3.Distance(last, pos);
      owed += motes * run;
      for (; owed >= 1; owed--) {
        const u = Math.random();
        kitPools(scene).shards.emit({
          x: last.x + (pos.x - last.x) * u, y: last.y + (pos.y - last.y) * u, z: last.z + (pos.z - last.z) * u,
          vx: rand(-0.3, 0.3), vy: rand(0, 0.4), vz: rand(-0.3, 0.3), drag: 2, life: rand(0.15, 0.35), size: 0.06, thick: 0.015,
          r: wakeC[0], g: wakeC[1], b: wakeC[2], a: 0.8, r1: wakeC[0] * 0.5, g1: wakeC[1] * 0.5, b1: wakeC[2] * 0.5,
        });
      }
      last.copyFrom(pos);
      o.onFly?.(pos, dt);
      if (k >= 1) {
        landed = f.age;
        wake?.setEnabled(false);
        o.onLand?.(to.clone());
        if (!(o.stick ?? 0.5)) body.setEnabled(false);
      }
      return true;
    }
    const stick = o.stick ?? 0.5;
    const s = f.age - landed;
    // Stuck in the floor, then sinking out of it.
    if (stick > 0 && s > stick * 0.6) body.position.addInPlace(dir.scale(dt * 0.6));
    return s < stick;
  });
  fx.own(body);
  if (wake) fx.own(wake);
  return fx;
}

export interface MeteorOptions {
  /** Where it falls from; default high above and behind the target. */
  from?: Vector3;
  size?: number;
  speed?: number;
  delay?: number;
  /** Fire colour (shell, trail, impact). */
  colour?: Rgb;
  /** Impact radius. */
  blast?: number;
  onLand?: (at: Vector3) => void;
}

const HOT: Rgb = [1, 0.92, 0.7];

/** A meteor: a molten rock with a burning trail and smoke, landing in a flash, an ember shower, molten rubble, a ring and a scorch. */
export function meteor(scene: Scene, to: Vector3, o: MeteorOptions = {}): Fx {
  const c = o.colour ?? [1, 0.48, 0.12];
  const size = o.size ?? 0.6;
  const blast = o.blast ?? 2.6;
  const from = o.from ?? to.add(new Vector3(-3, 14, -2.5));
  const fx = new Fx(() => false);
  let trail = 0;
  const pools = kitPools(scene);
  const fall = skyFall(scene, from, to, {
    speed: o.speed ?? 18, delay: o.delay, body: meteorBody(size, c), wake: c, wakeLength: 3.2, wakeWidth: size * 1.3,
    motes: 3, stick: 0, spin: 3,
    onFly: (at, dt) => {
      // A flame trail of knots and thick smoke, shed per frame and left in world space.
      trail += dt * 60;
      for (; trail >= 1; trail--) {
        pools.glow.emit({
          x: at.x + rand(-0.1, 0.1) * size, y: at.y + rand(-0.1, 0.1) * size, z: at.z + rand(-0.1, 0.1) * size,
          vx: rand(-0.3, 0.3), vy: rand(0, 0.5), vz: rand(-0.3, 0.3), drag: 2,
          life: rand(0.18, 0.32), size: size * 0.9, sizeEnd: size * 0.3,
          r: 1, g: 0.75, b: 0.35, a: 0.55, r1: c[0] * 0.7, g1: c[1] * 0.3, b1: 0.02,
        });
        if (Math.random() < 0.35) {
          pools.smoke.emit({
            x: at.x, y: at.y, z: at.z, vx: rand(-0.2, 0.2), vy: rand(0.2, 0.6), vz: rand(-0.2, 0.2), drag: 1.2,
            life: rand(0.8, 1.3), delay: 0.05, size: size * 0.8, sizeEnd: size * 2.4,
            r: 0.18, g: 0.15, b: 0.13, a: 0.4, r1: 0.32, g1: 0.3, b1: 0.28,
          });
        }
      }
    },
    onLand: (at) => {
      kitFlash(scene, at, 1);
      const up = new Vector3(at.x, at.y + 0.4, at.z);
      core(scene, up, blast * 0.75, HOT, c, 0.22);
      // The flower: thick tongues flung flat and fast out of the core.
      const tongues = Math.round(blast * 9);
      for (let i = 0; i < tongues; i++) {
        const a = ((i + Math.random()) / tongues) * TAU;
        const sp = rand(5, 9) * Math.sqrt(blast);
        pools.shards.emit({
          x: up.x, y: up.y, z: up.z, vx: Math.sin(a) * sp, vy: rand(-0.3, 2.5), vz: Math.cos(a) * sp, drag: 7,
          life: rand(0.16, 0.28), size: blast * 0.22, sizeEnd: blast * 0.1, thick: 0.07 * blast, stretch: 0.05,
          r: HOT[0], g: HOT[1], b: HOT[2], a: 1, r1: c[0], g1: c[1] * 0.8, b1: c[2] * 0.5,
        });
      }
      // The ember shower: a fountain that rains back down.
      sparks(scene, up, Math.round(blast * 14), HOT, [c[0] * 0.8, c[1] * 0.35, 0.03], {
        speed: [1.5, 5], up: [0.9, 2.2], gravity: -9, life: [0.5, 1.1], length: 0.12,
      });
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
      embers(scene, at, 14, HOT, c, { radius: blast * 0.6, life: [0.8, 1.6], motes: true, delay: 0.15 });
      fx.child(shockRing(scene, at, { radius: blast * 1.25, duration: 0.4, colour: c, lip: 0.5, dust: 10, flash: 0 }));
      fx.child(scorch(scene, at, { radius: blast * 0.75, glow: c, hold: 2.2 }));
      fx.child(fissure(scene, at, { radius: blast * 0.9, colour: c, hold: 1.2 }));
      for (let i = 0; i < 6; i++) puff(scene, at.x, at.y, at.z, { size: 1, drift: rand(2, 3.5), rise: 0.3 });
      o.onLand?.(at);
    },
  });
  fx.child(fall);
  return fx;
}
