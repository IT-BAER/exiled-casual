import { Color3, Material, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, StandardMaterial, Vector3, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

/**
 * What Ground Slam breaks out of the floor: rock chunks and dirt clods thrown up
 * along the blow, bouncing once and lying where they fall before sinking away,
 * and a dark crack left in the ground that fades out after them.
 *
 * Real geometry, never a card: the chunks are irregular polyhedra drawn as thin
 * instances of one host (one draw call), the crack is flat floor geometry. Both
 * are built once per scene; a slam reuses slots and allocates nothing.
 */
export const DEBRIS_NAME = "fx-slam-debris";
export const CRACK_NAME = "fx-slam-crack";
export const DEBRIS_CAPACITY = 160;
/** Seconds a chunk exists, the last `SINK_SECONDS` of it sinking into the floor. */
export const DEBRIS_SECONDS = 4;
const SINK_SECONDS = 1.2;
/** Seconds a crack shows, at full strength for the first `CRACK_HOLD`. */
export const CRACK_SECONDS = 6;
export const CRACK_HOLD = 2;
/** Cracks kept at once, enough for a boss's volley of five; one more reuses the oldest. */
const CRACK_POOL = 6;

const STONES = 14;
const CLODS = 26;
const GRAVITY = -16;
/** Half-angle of the throw around the facing; a share of the rubble falls back anywhere. */
const THROW_CONE = 0.9;
const STRAY_SHARE = 0.15;
/** A landing slower than this rests instead of bouncing. */
const BOUNCE_MIN = 1.5;
const BOUNCE_KEEP = 0.3;

/** Main fissures per crack, and how far the longest runs out (Ground Slam reaches 3.5). */
const FISSURES = 6;
const CRACK_REACH = 2.4;
const CRACK_WIDTH = 0.12;
const CRATER_RADIUS = 0.75;
/** The open fissure, and how much of the floor's light it takes away at its root: dark earth, never ink. */
const CRACK_RGB = [0.05, 0.03, 0.017] as const;
const CRACK_ALPHA = 0.68;
/** Just over the floor plane and under the dust: it never fights the floor for depth. */
const CRACK_Y = 0.018;

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A low-poly chunk: an icosphere pushed in and out per vertex, then faceted. */
function chunkMesh(scene: Scene): Mesh {
  const m = MeshBuilder.CreateIcoSphere(DEBRIS_NAME, { radius: 0.5, subdivisions: 1, updatable: true }, scene);
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

/** A crack network along +Z from the impact: forked fissures that taper, over a dark crater. */
function crackMesh(scene: Scene, name: string): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const [cr, cg, cb] = CRACK_RGB;
  /** One fissure as a single strip, mitred at each kink so it never steps. Points are x, z, half width, alpha. */
  const strip = (pts: number[][]) => {
    const v0 = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [x, z, w, a] = pts[i]!;
      const [px, pz] = pts[Math.max(0, i - 1)]!;
      const [qx, qz] = pts[Math.min(pts.length - 1, i + 1)]!;
      const len = Math.hypot(qx! - px!, qz! - pz!) || 1;
      const nx = -(qz! - pz!) / len, nz = (qx! - px!) / len;
      pos.push(x! + nx * w!, 0, z! + nz * w!, x! - nx * w!, 0, z! - nz * w!);
      col.push(cr, cg, cb, a!, cr, cg, cb, a!);
      if (i > 0) {
        const v = v0 + (i - 1) * 2;
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  };
  const grow = (x: number, z: number, angle: number, reach: number, width: number, fork: boolean) => {
    const pts = [[x, z, width / 2, CRACK_ALPHA]];
    let travelled = 0;
    const heading = angle;
    let side = Math.random() < 0.5 ? -1 : 1;
    while (travelled < reach) {
      // Straight runs that kink back and forth about the heading: rock breaks, it does not flow.
      angle = heading + side * rand(0.15, 0.55);
      side = -side;
      const step = rand(0.12, 0.3);
      x += Math.sin(angle) * step;
      z += Math.cos(angle) * step;
      travelled += step;
      const t = Math.min(1, travelled / reach);
      pts.push([x, z, width * (1 - t) / 2 + 0.003, CRACK_ALPHA * (1 - 0.5 * t)]);
      if (fork && Math.random() < 0.18) grow(x, z, angle + (Math.random() < 0.5 ? -0.8 : 0.8), (reach - travelled) * 0.45, width * (1 - t) * 0.7, false);
    }
    strip(pts);
  };
  for (let f = 0; f < FISSURES; f++) {
    // Most run out ahead, the way the blow travels; a couple split back behind it.
    const ahead = f < FISSURES - 2;
    const angle = ahead ? ((f + 0.5) / (FISSURES - 2) * 2 - 1) * 1.0 + rand(-0.15, 0.15) : Math.PI + rand(-1.2, 1.2);
    const reach = ahead ? CRACK_REACH * rand(0.55, 1) : CRACK_REACH * rand(0.2, 0.35);
    const r = rand(0.05, 0.2);
    grow(Math.sin(angle) * r, Math.cos(angle) * r, angle, reach, CRACK_WIDTH * (ahead ? 1 : 0.6), true);
  }
  // The crater: a fan dark at the centre, gone at its edge, under the fissures.
  const craterIdx: number[] = [];
  const centre = pos.length / 3;
  pos.push(0, 0, 0);
  col.push(cr, cg, cb, CRACK_ALPHA * 0.6);
  const SIDES = 24;
  for (let s = 0; s < SIDES; s++) {
    const a = (s / SIDES) * Math.PI * 2;
    const r = CRATER_RADIUS * rand(0.7, 1.2);
    pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
    col.push(cr, cg, cb, 0);
  }
  for (let s = 0; s < SIDES; s++) craterIdx.push(centre, centre + 1 + s, centre + 1 + ((s + 1) % SIDES));
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.colors = col;
  vd.indices = [...craterIdx, ...idx];
  vd.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  return mesh;
}

interface Crack { mesh: Mesh; age: number }

const ZERO = new Float32Array(16);
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchRot = new Quaternion();
const scratchM = new Matrix();

export class SlamDebris {
  /** Chunks still drawn, flying or lying. */
  live = 0;
  private readonly host: Mesh;
  private readonly data = new Float32Array(DEBRIS_CAPACITY * 16);
  private readonly pos = new Float32Array(DEBRIS_CAPACITY * 3);
  private readonly vel = new Float32Array(DEBRIS_CAPACITY * 3);
  private readonly rot = new Float32Array(DEBRIS_CAPACITY * 3);
  private readonly spin = new Float32Array(DEBRIS_CAPACITY * 3);
  private readonly scale = new Float32Array(DEBRIS_CAPACITY * 3);
  /** -1 empty, otherwise seconds since thrown. */
  private readonly age = new Float32Array(DEBRIS_CAPACITY).fill(-1);
  private next = 0;
  private readonly cracks: Crack[] = [];
  private nextCrack = 0;

  constructor(scene: Scene) {
    const host = chunkMesh(scene);
    // PBR, because the scene's lights are physical: a StandardMaterial blows out under the sun.
    const mat = new PBRMaterial(`${DEBRIS_NAME}-mat`, scene);
    mat.albedoColor = new Color3(0.13, 0.085, 0.05);
    mat.metallic = 0;
    mat.roughness = 0.95;
    host.material = mat;
    host.isPickable = false;
    host.alwaysSelectAsActiveMesh = true;
    host.doNotSyncBoundingInfo = true;
    // Every slot drawn from the start at zero scale: the count never changes.
    host.thinInstanceSetBuffer("matrix", this.data, 16, false);
    this.host = host;

    // Unlit near-black at partial alpha: blending scales whatever floor is under it by
    // (1 - alpha), so the crack keeps the same contrast on beach sand and hideout stone.
    // Lit, it came out lighter than the stone under the hideout's braziers.
    const crackMat = new StandardMaterial(`${CRACK_NAME}-mat`, scene);
    crackMat.diffuseColor = Color3.Black();
    crackMat.specularColor = Color3.Black();
    crackMat.emissiveColor = Color3.White();
    crackMat.disableLighting = true;
    crackMat.backFaceCulling = false;
    crackMat.disableDepthWrite = true;
    crackMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    for (let i = 0; i < CRACK_POOL; i++) {
      const mesh = crackMesh(scene, `${CRACK_NAME}-${i}`);
      mesh.material = crackMat;
      mesh.isPickable = false;
      mesh.position.y = CRACK_Y;
      mesh.setEnabled(false);
      this.cracks.push({ mesh, age: -1 });
    }
    // The cracks start disabled, so compile now (behind the loading plate), not on the first slam.
    crackMat.forceCompilation(this.cracks[0]!.mesh);
    scene.onBeforeRenderObservable.add(() => this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000)));
  }

  /** A slam landing at `at`, the blow travelling along (facingX, facingZ); `rubble` is the share of a slam's chunks. */
  emit(at: Vector3, facingX: number, facingZ: number, rubble = 1): void {
    const len = Math.hypot(facingX, facingZ) || 1;
    const base = Math.atan2(facingX / len, facingZ / len);
    const stones = Math.round(STONES * rubble);
    for (let n = 0; n < stones + Math.round(CLODS * rubble); n++) {
      const stone = n < stones;
      const i = this.next;
      this.next = (this.next + 1) % DEBRIS_CAPACITY;
      if (this.age[i]! < 0) this.live++;
      const yaw = Math.random() < STRAY_SHARE ? Math.random() * Math.PI * 2 : base + rand(-1, 1) * THROW_CONE;
      const r = Math.random();
      // Squared: mostly small chips and the odd heavy chunk.
      const size = stone ? 0.1 + r * r * 0.2 : rand(0.05, 0.09);
      const speed = stone ? rand(1.2, 4) : rand(2, 5.5);
      const from = rand(0, 0.35);
      this.pos.set([at.x + Math.sin(yaw) * from, size / 2, at.z + Math.cos(yaw) * from], i * 3);
      this.vel.set([Math.sin(yaw) * speed, stone ? rand(2.5, 5.5) : rand(3, 7), Math.cos(yaw) * speed], i * 3);
      this.rot.set([rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)], i * 3);
      this.spin.set([rand(-14, 14), rand(-14, 14), rand(-14, 14)], i * 3);
      this.scale.set([size * rand(0.8, 1.3), size * rand(0.7, 1.1), size * rand(0.8, 1.3)], i * 3);
      this.age[i] = 0;
      this.write(i);
    }
    this.host.thinInstanceBufferUpdated("matrix");

    const crack = this.cracks[this.nextCrack]!;
    this.nextCrack = (this.nextCrack + 1) % CRACK_POOL;
    crack.age = 0;
    crack.mesh.position.x = at.x;
    crack.mesh.position.z = at.z;
    crack.mesh.rotation.y = base;
    // Mirrored half the time: three meshes read as many more breaks.
    const k = rand(0.85, 1.15);
    crack.mesh.scaling.set(Math.random() < 0.5 ? -k : k, 1, k);
    crack.mesh.visibility = 1;
    crack.mesh.setEnabled(true);
  }

  /** Advance every chunk and crack by `dt` seconds. Driven by the scene; public for tests. */
  step(dt: number): void {
    if (this.live > 0) {
      for (let i = 0; i < DEBRIS_CAPACITY; i++) {
        const age = this.age[i]!;
        if (age < 0) continue;
        if (age + dt >= DEBRIS_SECONDS) {
          this.age[i] = -1;
          this.live--;
          this.write(i);
          continue;
        }
        this.age[i] = age + dt;
        const o = i * 3;
        const rest = this.scale[o + 1]! / 2;
        if (this.vel[o]! !== 0 || this.vel[o + 1]! !== 0 || this.vel[o + 2]! !== 0) {
          this.vel[o + 1]! += GRAVITY * dt;
          this.pos[o]! += this.vel[o]! * dt;
          this.pos[o + 1]! += this.vel[o + 1]! * dt;
          this.pos[o + 2]! += this.vel[o + 2]! * dt;
          for (let a = 0; a < 3; a++) this.rot[o + a]! += this.spin[o + a]! * dt;
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
    }
    for (const c of this.cracks) {
      if (c.age < 0) continue;
      c.age += dt;
      if (c.age >= CRACK_SECONDS) {
        c.age = -1;
        c.mesh.setEnabled(false);
        continue;
      }
      c.mesh.visibility = c.age <= CRACK_HOLD ? 1 : 1 - (c.age - CRACK_HOLD) / (CRACK_SECONDS - CRACK_HOLD);
    }
  }

  /** Every drawn chunk's position, for tests and for nothing else. */
  positions(): Vector3[] {
    const out: Vector3[] = [];
    for (let i = 0; i < DEBRIS_CAPACITY; i++) {
      if (this.age[i]! >= 0) out.push(new Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]));
    }
    return out;
  }

  /** Wipe every chunk and crack: a new area starts with an unbroken floor. */
  clear(): void {
    this.age.fill(-1);
    this.data.fill(0);
    this.live = 0;
    this.host.thinInstanceBufferUpdated("matrix");
    for (const c of this.cracks) {
      c.age = -1;
      c.mesh.setEnabled(false);
    }
  }

  private write(i: number): void {
    const age = this.age[i]!;
    if (age < 0) {
      this.data.set(ZERO, i * 16);
      return;
    }
    const o = i * 3;
    // Sinks its own height into the floor and shrinks as it goes.
    const sink = Math.max(0, (age - (DEBRIS_SECONDS - SINK_SECONDS)) / SINK_SECONDS);
    const k = 1 - 0.6 * sink;
    scratchScale.set(this.scale[o]! * k, this.scale[o + 1]! * k, this.scale[o + 2]! * k);
    scratchPos.set(this.pos[o]!, this.pos[o + 1]! - this.scale[o + 1]! * sink, this.pos[o + 2]!);
    Quaternion.RotationYawPitchRollToRef(this.rot[o + 1]!, this.rot[o]!, this.rot[o + 2]!, scratchRot);
    Matrix.ComposeToRef(scratchScale, scratchRot, scratchPos, scratchM);
    scratchM.copyToArray(this.data, i * 16);
  }
}

const debris = new WeakMap<Scene, SlamDebris>();

/** The scene's slam debris, built on first use. */
export function slamDebris(scene: Scene): SlamDebris {
  let d = debris.get(scene);
  if (!d) {
    d = new SlamDebris(scene);
    debris.set(scene, d);
    scene.onDisposeObservable.addOnce(() => debris.delete(scene));
  }
  return d;
}
