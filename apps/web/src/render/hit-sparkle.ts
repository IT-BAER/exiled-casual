import { Color3, Material, Matrix, MeshBuilder, Quaternion, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";

/**
 * The flash where a blow meets a body: a white-gold core that swells and dies in
 * ~60 ms, and thin glow shards thrown out of the struck face for ~120 ms (PoE2's
 * impact starburst). Real geometry, never a sprite: two thin-instance hosts, one
 * draw call each, a fixed ring of slots so a busy fight recycles the oldest hit.
 */
export const SPARKLE_NAME = "fx-hit-sparkle";
/** Hits drawn at once; the next one past it takes the oldest slot. */
export const SPARKLE_CAPACITY = 12;
export const MIN_SHARDS = 5;
export const MAX_SHARDS = 8;
const CORE_SECONDS = 0.06;
const SHARD_SECONDS = 0.12;
/** Core diameter at a chip and at a full hit, and how far it swells over its life. */
const CORE_MIN = 0.12;
const CORE_MAX = 0.24;
const CORE_SWELL = 0.9;
/** Shard length at a chip and at a full hit, each one varied by up to half again. */
const SHARD_MIN = 0.22;
const SHARD_MAX = 0.5;
const SHARD_THICK = 0.022;
/** Half-angle of the cone the shards leave the struck face in, and their lift. */
const SHARD_CONE = 1.25;
const SHARD_LIFT = 0.35;
const CORE_COLOUR = new Color3(1, 0.95, 0.8);
const SHARD_COLOUR = new Color3(1, 0.72, 0.32);

/** Shards a hit of `hitStrength` throws. */
export function shardCount(strength: number): number {
  const k = Math.min(1, Math.max(0, strength));
  return Math.round(MIN_SHARDS + (MAX_SHARDS - MIN_SHARDS) * k);
}

function glow(scene: Scene, name: string, colour: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = colour;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  m.alphaMode = 1; // ALPHA_ADD: the per-instance alpha below is the fade
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  m.backFaceCulling = false;
  return m;
}

function host(mesh: Mesh, scene: Scene, colour: Color3, count: number): { data: Float32Array; colour: Float32Array } {
  mesh.material = glow(scene, `${mesh.name}-mat`, colour);
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  // Every slot drawn from the start at zero scale: one shader, compiled once.
  const data = new Float32Array(count * 16);
  const tint = new Float32Array(count * 4).fill(1);
  mesh.thinInstanceSetBuffer("matrix", data, 16, false);
  mesh.thinInstanceSetBuffer("color", tint, 4, false);
  return { data, colour: tint };
}

const ZERO = new Float32Array(16);
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchDir = new Vector3();
const scratchRot = new Quaternion();
const scratchM = new Matrix();
const FORWARD = new Vector3(0, 0, 1);
const IDENTITY = Quaternion.Identity();

export class HitSparkle {
  private readonly core: Mesh;
  private readonly shard: Mesh;
  private readonly coreBuf: { data: Float32Array; colour: Float32Array };
  private readonly shardBuf: { data: Float32Array; colour: Float32Array };
  /** -1 empty, else seconds since the hit. */
  private readonly age = new Float32Array(SPARKLE_CAPACITY).fill(-1);
  private readonly at = new Float32Array(SPARKLE_CAPACITY * 3);
  private readonly coreSize = new Float32Array(SPARKLE_CAPACITY);
  private readonly dir = new Float32Array(SPARKLE_CAPACITY * MAX_SHARDS * 3);
  /** 0 for a shard slot this hit does not use. */
  private readonly len = new Float32Array(SPARKLE_CAPACITY * MAX_SHARDS);
  private next = 0;
  /** Hits still drawing. */
  live = 0;

  constructor(scene: Scene) {
    this.core = MeshBuilder.CreateSphere(`${SPARKLE_NAME}-core`, { diameter: 1, segments: 3 }, scene);
    this.shard = MeshBuilder.CreateBox(`${SPARKLE_NAME}-shard`, { size: 1 }, scene);
    this.coreBuf = host(this.core, scene, CORE_COLOUR, SPARKLE_CAPACITY);
    this.shardBuf = host(this.shard, scene, SHARD_COLOUR, SPARKLE_CAPACITY * MAX_SHARDS);
    scene.onBeforeRenderObservable.add(() => {
      if (this.live > 0) this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000));
    });
  }

  /** A hit at `at` on a face pointing `outward`, sized by `hitStrength`. */
  emit(at: Vector3, outward: Vector3, strength: number): void {
    const k = Math.min(1, Math.max(0, strength));
    const i = this.next;
    this.next = (this.next + 1) % SPARKLE_CAPACITY;
    if (this.age[i]! < 0) this.live++;
    this.age[i] = 0;
    this.at.set([at.x, at.y, at.z], i * 3);
    this.coreSize[i] = CORE_MIN + (CORE_MAX - CORE_MIN) * k;

    const base = Math.atan2(outward.x, outward.z);
    const flat = Math.hypot(outward.x, outward.z) < 1e-6;
    const n = shardCount(k);
    for (let s = 0; s < MAX_SHARDS; s++) {
      const j = i * MAX_SHARDS + s;
      if (s >= n) { this.len[j] = 0; continue; }
      // Spread evenly round the cone with jitter, so no two hits fan the same way.
      const yaw = flat
        ? Math.random() * Math.PI * 2
        : base + ((s + Math.random()) / n * 2 - 1) * SHARD_CONE;
      const up = SHARD_LIFT * (0.3 + Math.random() * 1.4);
      scratchDir.set(Math.sin(yaw), up, Math.cos(yaw)).normalize();
      this.dir.set([scratchDir.x, scratchDir.y, scratchDir.z], j * 3);
      this.len[j] = (SHARD_MIN + (SHARD_MAX - SHARD_MIN) * k) * (0.6 + Math.random() * 0.9);
    }
    this.write(i);
    this.flush();
  }

  /** Advance every hit by `dt` seconds. Driven by the scene; public for tests. */
  step(dt: number): void {
    for (let i = 0; i < SPARKLE_CAPACITY; i++) {
      const age = this.age[i]!;
      if (age < 0) continue;
      if (age + dt >= SHARD_SECONDS) {
        this.age[i] = -1;
        this.live--;
      } else {
        this.age[i] = age + dt;
      }
      this.write(i);
    }
    this.flush();
  }

  private write(i: number): void {
    const age = this.age[i]!;
    const { data: cd, colour: cc } = this.coreBuf;
    const { data: sd, colour: sc } = this.shardBuf;
    const tc = age < 0 ? 1 : age / CORE_SECONDS;
    if (tc >= 1) {
      cd.set(ZERO, i * 16);
    } else {
      scratchScale.setAll(this.coreSize[i]! * (1 + CORE_SWELL * Math.sqrt(tc)));
      scratchPos.set(this.at[i * 3]!, this.at[i * 3 + 1]!, this.at[i * 3 + 2]!);
      Matrix.ComposeToRef(scratchScale, IDENTITY, scratchPos, scratchM);
      scratchM.copyToArray(cd, i * 16);
      cc[i * 4 + 3] = (1 - tc) * (1 - tc);
    }
    const ts = age < 0 ? 1 : age / SHARD_SECONDS;
    for (let s = 0; s < MAX_SHARDS; s++) {
      const j = i * MAX_SHARDS + s;
      const len = this.len[j]!;
      if (ts >= 1 || len <= 0) {
        sd.set(ZERO, j * 16);
        continue;
      }
      // The head flies out while the tail shortens behind it: a streak, not a stick.
      const shown = len * (1 - 0.6 * ts);
      const head = len * (0.25 + 1.1 * Math.sqrt(ts));
      scratchDir.set(this.dir[j * 3]!, this.dir[j * 3 + 1]!, this.dir[j * 3 + 2]!);
      scratchPos.set(this.at[i * 3]!, this.at[i * 3 + 1]!, this.at[i * 3 + 2]!)
        .addInPlace(scratchDir.scale(head - shown / 2));
      Quaternion.FromUnitVectorsToRef(FORWARD, scratchDir, scratchRot);
      const thick = SHARD_THICK * (1 - 0.5 * ts);
      scratchScale.set(thick, thick, shown);
      Matrix.ComposeToRef(scratchScale, scratchRot, scratchPos, scratchM);
      scratchM.copyToArray(sd, j * 16);
      sc[j * 4 + 3] = 1 - ts;
    }
  }

  private flush(): void {
    this.core.thinInstanceBufferUpdated("matrix");
    this.core.thinInstanceBufferUpdated("color");
    this.shard.thinInstanceBufferUpdated("matrix");
    this.shard.thinInstanceBufferUpdated("color");
  }

  /** Wipe every hit: a new area starts dark. */
  clear(): void {
    this.age.fill(-1);
    this.live = 0;
    this.coreBuf.data.fill(0);
    this.shardBuf.data.fill(0);
    this.flush();
  }
}

const sparkles = new WeakMap<Scene, HitSparkle>();

/** The scene's one sparkle, built on first use. */
export function hitSparkle(scene: Scene): HitSparkle {
  let s = sparkles.get(scene);
  if (!s) {
    s = new HitSparkle(scene);
    sparkles.set(scene, s);
    scene.onDisposeObservable.addOnce(() => sparkles.delete(scene));
  }
  return s;
}
