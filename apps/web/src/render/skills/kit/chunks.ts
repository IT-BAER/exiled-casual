import { Matrix, Mesh, MeshBuilder, Quaternion, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { litMat, rand, TAU } from "./core";

/**
 * Solid debris thrown by a burst, a landing or a shatter: rock, ice shards and
 * molten slag. Real polyhedra drawn as thin instances of one host per kind (one
 * draw call each), bouncing once and lying where they fall before sinking away,
 * the way `slam-debris.ts` breaks the floor. Thin-instance colour does not
 * survive this scene's materials (see flames.ts), so the look is per kind.
 */
export type ChunkKind = "rock" | "ice" | "molten";

export const CHUNK_PREFIX = "kit-chunks";
export const CHUNK_CAPACITY = 220;
/** Seconds a chunk exists, the last `SINK` of them sinking into the floor. */
export const CHUNK_SECONDS = 3;
const SINK = 1;
const GRAVITY = -16;
const BOUNCE_MIN = 1.5;
const BOUNCE_KEEP = 0.3;

export interface ChunkSpec {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number;
  /** Seconds before it appears: a front running out through the ground. */
  delay?: number;
  /** The floor it lands on; defaults to the throw's own floor (`y - size / 2` is never below it). */
  floor?: number;
}

function proto(scene: Scene, kind: ChunkKind): Mesh {
  const name = `${CHUNK_PREFIX}-${kind}`;
  if (kind === "ice") {
    // An elongated octahedron: a splinter, which spins into a glint.
    const m = MeshBuilder.CreatePolyhedron(name, { type: 1, size: 0.5, sizeX: 0.35, sizeY: 1.2, sizeZ: 0.35, updatable: true }, scene);
    m.convertToFlatShadedMesh();
    return m;
  }
  const m = MeshBuilder.CreateIcoSphere(name, { radius: 0.5, subdivisions: 1, updatable: true }, scene);
  const pos = m.getVerticesData("position")!;
  for (let i = 0; i < pos.length; i += 3) {
    const k = rand(0.72, 1.18);
    pos[i]! *= k;
    pos[i + 1]! *= k * 0.75;
    pos[i + 2]! *= k;
  }
  m.updateVerticesData("position", pos);
  m.convertToFlatShadedMesh();
  return m;
}

const ZERO = new Float32Array(16);
const sScale = new Vector3();
const sPos = new Vector3();
const sRot = new Quaternion();
const sM = new Matrix();

export class ChunkPool {
  live = 0;
  emitted = 0;
  private readonly host: Mesh;
  private readonly data = new Float32Array(CHUNK_CAPACITY * 16);
  private readonly pos = new Float32Array(CHUNK_CAPACITY * 3);
  private readonly vel = new Float32Array(CHUNK_CAPACITY * 3);
  private readonly rot = new Float32Array(CHUNK_CAPACITY * 3);
  private readonly spin = new Float32Array(CHUNK_CAPACITY * 3);
  private readonly scale = new Float32Array(CHUNK_CAPACITY * 3);
  private readonly floor = new Float32Array(CHUNK_CAPACITY);
  /** Below -1e8 empty; negative counts down a delay; otherwise seconds alive. */
  private readonly age = new Float32Array(CHUNK_CAPACITY).fill(-1e9);
  private next = 0;
  private dirty = false;

  constructor(scene: Scene, kind: ChunkKind) {
    const host = proto(scene, kind);
    host.material = kind === "rock"
      ? litMat(scene, "chunk-rock", [0.13, 0.085, 0.05], [0, 0, 0], 0.95)
      : kind === "ice"
        ? litMat(scene, "chunk-ice", [0.62, 0.82, 0.95], [0.22, 0.42, 0.6], 0.2)
        : litMat(scene, "chunk-molten", [0.08, 0.04, 0.03], [0.95, 0.32, 0.06], 0.8);
    host.isPickable = false;
    host.alwaysSelectAsActiveMesh = true;
    host.doNotSyncBoundingInfo = true;
    host.thinInstanceSetBuffer("matrix", this.data, 16, false);
    this.host = host;
    scene.onBeforeRenderObservable.add(() => {
      if (this.live > 0 || this.dirty) this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000));
    });
  }

  emit(s: ChunkSpec): void {
    const i = this.next;
    this.next = (this.next + 1) % CHUNK_CAPACITY;
    if (this.age[i]! < -1e8) this.live++;
    this.pos.set([s.x, s.y, s.z], i * 3);
    this.vel.set([s.vx, s.vy, s.vz], i * 3);
    this.rot.set([rand(0, TAU), rand(0, TAU), rand(0, TAU)], i * 3);
    this.spin.set([rand(-14, 14), rand(-14, 14), rand(-14, 14)], i * 3);
    this.scale.set([s.size * rand(0.8, 1.3), s.size * rand(0.7, 1.1), s.size * rand(0.8, 1.3)], i * 3);
    this.floor[i] = s.floor ?? s.y - s.size / 2;
    this.age[i] = -(s.delay ?? 0);
    this.write(i);
    this.emitted++;
    this.dirty = true;
  }

  /** Advance every chunk by `dt` seconds. Driven by the scene; public for tests. */
  step(dt: number): void {
    for (let i = 0; i < CHUNK_CAPACITY; i++) {
      const age = this.age[i]!;
      if (age < -1e8) continue;
      if (age + dt >= CHUNK_SECONDS) {
        this.age[i] = -1e9;
        this.live--;
        this.write(i);
        continue;
      }
      this.age[i] = age + dt;
      if (age + dt <= 0) continue;
      const o = i * 3;
      const rest = this.floor[i]! + this.scale[o + 1]! / 2;
      if (this.vel[o]! !== 0 || this.vel[o + 1]! !== 0 || this.vel[o + 2]! !== 0) {
        this.vel[o + 1]! += GRAVITY * dt;
        for (let a = 0; a < 3; a++) {
          this.pos[o + a]! += this.vel[o + a]! * dt;
          this.rot[o + a]! += this.spin[o + a]! * dt;
        }
        if (this.pos[o + 1]! <= rest) {
          this.pos[o + 1] = rest;
          if (this.vel[o + 1]! < -BOUNCE_MIN) {
            this.vel[o + 1] = -this.vel[o + 1]! * BOUNCE_KEEP;
            this.vel[o]! *= 0.45;
            this.vel[o + 2]! *= 0.45;
            for (let a = 0; a < 3; a++) this.spin[o + a]! *= 0.4;
          } else {
            this.vel.fill(0, o, o + 3);
          }
        }
      }
      this.write(i);
    }
    this.host.thinInstanceBufferUpdated("matrix");
    this.dirty = false;
  }

  positions(): Vector3[] {
    const out: Vector3[] = [];
    for (let i = 0; i < CHUNK_CAPACITY; i++) {
      if (this.age[i]! > 0) out.push(new Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]));
    }
    return out;
  }

  clear(): void {
    this.age.fill(-1e9);
    this.data.fill(0);
    this.live = 0;
    this.host.thinInstanceBufferUpdated("matrix");
  }

  private write(i: number): void {
    const age = this.age[i]!;
    if (age <= 0) {
      this.data.set(ZERO, i * 16);
      return;
    }
    const o = i * 3;
    const sink = Math.max(0, (age - (CHUNK_SECONDS - SINK)) / SINK);
    const k = 1 - 0.6 * sink;
    sScale.set(this.scale[o]! * k, this.scale[o + 1]! * k, this.scale[o + 2]! * k);
    sPos.set(this.pos[o]!, this.pos[o + 1]! - this.scale[o + 1]! * sink, this.pos[o + 2]!);
    Quaternion.RotationYawPitchRollToRef(this.rot[o + 1]!, this.rot[o]!, this.rot[o + 2]!, sRot);
    Matrix.ComposeToRef(sScale, sRot, sPos, sM);
    sM.copyToArray(this.data, i * 16);
  }
}

const pools = new WeakMap<Scene, Map<ChunkKind, ChunkPool>>();

/** The scene's debris pool of one kind, built on first use. */
export function chunkPool(scene: Scene, kind: ChunkKind): ChunkPool {
  let byKind = pools.get(scene);
  if (!byKind) {
    byKind = new Map();
    pools.set(scene, byKind);
    scene.onDisposeObservable.addOnce(() => pools.delete(scene));
  }
  let p = byKind.get(kind);
  if (!p) {
    p = new ChunkPool(scene, kind);
    byKind.set(kind, p);
  }
  return p;
}

export interface ThrowOptions {
  count: number;
  /** Horizontal speed range, and upward speed range. */
  speed?: readonly [number, number];
  up?: readonly [number, number];
  /** Chunk size range (largest chunks are rarer). */
  size?: readonly [number, number];
  /** Throw centred on this yaw (0 = +Z) within `cone` half-angle; omitted = all round. */
  yaw?: number;
  cone?: number;
  /** Radius the chunks start from, and the delay at a start radius (a front running out). */
  spread?: number;
  delayAt?: (from: number) => number;
}

/** Throw `count` chunks out of `at` on its floor. */
export function throwChunks(scene: Scene, kind: ChunkKind, at: Vector3, o: ThrowOptions): void {
  const pool = chunkPool(scene, kind);
  const [s0, s1] = o.speed ?? [1.5, 4.5];
  const [u0, u1] = o.up ?? [2.5, 6];
  const [z0, z1] = o.size ?? [0.06, 0.24];
  for (let n = 0; n < o.count; n++) {
    const yaw = o.yaw === undefined ? Math.random() * TAU : o.yaw + rand(-1, 1) * (o.cone ?? 0.6);
    const r = Math.random();
    const size = z0 + r * r * (z1 - z0);
    const from = rand(0, o.spread ?? 0.35);
    const speed = rand(s0, s1);
    pool.emit({
      x: at.x + Math.sin(yaw) * from, y: at.y + size / 2, z: at.z + Math.cos(yaw) * from,
      vx: Math.sin(yaw) * speed, vy: rand(u0, u1), vz: Math.cos(yaw) * speed,
      size, delay: o.delayAt?.(from) ?? 0, floor: at.y,
    });
  }
}
