import { Color3, Matrix, MeshBuilder, PBRMaterial, Quaternion, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";

/**
 * What a struck body throws: blood off flesh, chips off stone, thrown AWAY from
 * the blow and landing as flattened droplets that lie on the floor and dry away.
 *
 * Real geometry, never a sprite: low-poly spheres drawn as thin instances of one
 * host per kind, so a whole fight's worth is one draw call each. How much flies
 * scales with the hit's share of the target's life, and stays barely noticeable
 * on purpose: a chip is one drop, a kill a handful.
 */
export const SPRAY_NAME = "fx-hit-spray";
export type SprayKind = "blood" | "grit";
export const SPRAY_CAPACITY = 320;
/** Seconds a droplet lies on the floor, the last `DRY_SECONDS` of it shrinking away. */
export const SPLAT_SECONDS = 5;
const DRY_SECONDS = 2;

/** Share of max life that counts as a full-strength hit. */
const FULL_SHARE = 0.5;
const MIN_STRENGTH = 0.12;
const KILL_BONUS = 0.3;
const MIN_DROPS = 1;
const MAX_DROPS = 6;
const GRAVITY = -14;
/** Just over the floor plane, so a splat never fights it for depth. */
const FLOOR_Y = 0.012;
/** How much wider than the bead a splat lands, and how thin it is. */
const SPLAT_WIDTH = 1.8;
const SPLAT_THICKNESS = 0.16;
/** Radians either side of straight away from the blow. */
const SPREAD = 0.5;

/** Built of stone or clay: the blow knocks chips off, not blood. */
const GRIT_SPECIES: ReadonlySet<string> = new Set(["monster.vaal_construct.v1", "monster.sunbaked_colossus.v1"]);
/** Nothing inside to spill. */
const DRY_SPECIES: ReadonlySet<string> = new Set(["monster.fen_wisp.v1"]);

export function sprayKindOf(species: string | undefined): SprayKind | null {
  if (species !== undefined && DRY_SPECIES.has(species)) return null;
  return species !== undefined && GRIT_SPECIES.has(species) ? "grit" : "blood";
}

/** 0..1 from the share of max life one hit took; square-rooted so chips still read. */
export function hitStrength(share: number, killed = false): number {
  const s = Math.max(MIN_STRENGTH, Math.sqrt(Math.max(0, share) / FULL_SHARE));
  return Math.min(1, s + (killed ? KILL_BONUS : 0));
}

/** Peak of the struck body's white flash (and the impact light) for a hit of `strength`. */
export function flashPeak(strength: number): number {
  return 0.35 + 0.65 * Math.min(1, Math.max(0, strength));
}

interface Pool {
  host: Mesh;
  data: Float32Array;
  pos: Float32Array; // x y z per droplet
  vel: Float32Array;
  size: Float32Array;
  /** -1 empty, 0 flying, >0 seconds since it landed. */
  age: Float32Array;
  yaw: Float32Array;
  stretch: Float32Array;
  next: number;
  live: number;
}

const ZERO = new Float32Array(16);
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchRot = new Quaternion();
const scratchM = new Matrix();

/** PBR, because the scene's lights are physical (a 14-intensity sun): a
 *  StandardMaterial under them blows out to pink-white. */
function material(scene: Scene, kind: SprayKind): PBRMaterial {
  const m = new PBRMaterial(`${SPRAY_NAME}-${kind}-mat`, scene);
  m.metallic = 0;
  if (kind === "blood") {
    // Dark and wet: near black in shade, a tight highlight where light lands.
    m.albedoColor = new Color3(0.06, 0.003, 0.005);
    m.roughness = 0.25;
  } else {
    m.albedoColor = new Color3(0.3, 0.26, 0.21);
    m.roughness = 0.9;
  }
  return m;
}

function pool(scene: Scene, kind: SprayKind): Pool {
  const host = MeshBuilder.CreateSphere(`${SPRAY_NAME}-${kind}`, { diameter: 1, segments: 4 }, scene);
  host.material = material(scene, kind);
  host.isPickable = false;
  host.alwaysSelectAsActiveMesh = true;
  host.doNotSyncBoundingInfo = true;
  const data = new Float32Array(SPRAY_CAPACITY * 16);
  // Every slot drawn from the start at zero scale: the shader compiles on the
  // first frame (behind the loading plate) and the count never changes.
  host.thinInstanceSetBuffer("matrix", data, 16, false);
  const age = new Float32Array(SPRAY_CAPACITY).fill(-1);
  return {
    host, data, age,
    pos: new Float32Array(SPRAY_CAPACITY * 3),
    vel: new Float32Array(SPRAY_CAPACITY * 3),
    size: new Float32Array(SPRAY_CAPACITY),
    yaw: new Float32Array(SPRAY_CAPACITY),
    stretch: new Float32Array(SPRAY_CAPACITY),
    next: 0,
    live: 0,
  };
}

function write(p: Pool, i: number): void {
  const age = p.age[i]!;
  if (age < 0) {
    p.data.set(ZERO, i * 16);
    return;
  }
  const s = p.size[i]!;
  scratchPos.set(p.pos[i * 3]!, p.pos[i * 3 + 1]!, p.pos[i * 3 + 2]!);
  if (age === 0) {
    scratchScale.setAll(s);
    scratchRot.set(0, 0, 0, 1);
  } else {
    const dry = Math.min(1, (SPLAT_SECONDS - age) / DRY_SECONDS);
    const w = s * SPLAT_WIDTH * dry;
    scratchScale.set(w, s * SPLAT_THICKNESS, w * p.stretch[i]!);
    Quaternion.RotationYawPitchRollToRef(p.yaw[i]!, 0, 0, scratchRot);
  }
  Matrix.ComposeToRef(scratchScale, scratchRot, scratchPos, scratchM);
  scratchM.copyToArray(p.data, i * 16);
}

export class HitSpray {
  private readonly pools: Record<SprayKind, Pool>;

  constructor(scene: Scene) {
    this.pools = { blood: pool(scene, "blood"), grit: pool(scene, "grit") };
    scene.onBeforeRenderObservable.add(() => {
      this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000));
    });
  }

  /** A hit at `at`, thrown along (awayX, awayZ), sized by `hitStrength`. */
  emit(at: Vector3, awayX: number, awayZ: number, strength: number, kind: SprayKind): void {
    const p = this.pools[kind];
    const k = Math.min(1, Math.max(0, strength));
    const count = Math.round(MIN_DROPS + (MAX_DROPS - MIN_DROPS) * k);
    const len = Math.hypot(awayX, awayZ);
    const base = len > 1e-6 ? Math.atan2(awayX, awayZ) : Math.random() * Math.PI * 2;
    for (let n = 0; n < count; n++) {
      const i = p.next;
      p.next = (p.next + 1) % SPRAY_CAPACITY;
      if (p.age[i]! < 0) p.live++;
      const dir = base + (Math.random() * 2 - 1) * SPREAD;
      const speed = (0.5 + Math.random() * 1.3) * (0.6 + 0.7 * k);
      p.pos.set([at.x, at.y, at.z], i * 3);
      p.vel.set([Math.sin(dir) * speed, 0.5 + Math.random() * 1.2, Math.cos(dir) * speed], i * 3);
      // Squared: mostly fine drops and the odd fat one, never a row of equal coins.
      const r = Math.random();
      p.size[i] = (0.01 + r * r * 0.025) * (0.8 + 0.4 * k);
      p.age[i] = 0;
      write(p, i);
    }
    p.host.thinInstanceBufferUpdated("matrix");
  }

  /** Advance every droplet by `dt` seconds. Driven by the scene; public for tests. */
  step(dt: number): void {
    for (const p of Object.values(this.pools)) {
      if (p.live === 0) continue;
      for (let i = 0; i < SPRAY_CAPACITY; i++) {
        const age = p.age[i]!;
        if (age < 0) continue;
        if (age === 0) {
          p.vel[i * 3 + 1]! += GRAVITY * dt;
          p.pos[i * 3]! += p.vel[i * 3]! * dt;
          p.pos[i * 3 + 1]! += p.vel[i * 3 + 1]! * dt;
          p.pos[i * 3 + 2]! += p.vel[i * 3 + 2]! * dt;
          if (p.pos[i * 3 + 1]! <= FLOOR_Y) {
            p.pos[i * 3 + 1] = FLOOR_Y;
            const vx = p.vel[i * 3]!;
            const vz = p.vel[i * 3 + 2]!;
            // Smeared along the way it was travelling: a fast drop lands long.
            p.yaw[i] = Math.atan2(vx, vz);
            p.stretch[i] = 1 + Math.min(1.4, Math.hypot(vx, vz) * 0.22) * Math.random();
            p.age[i] = 1e-6;
          }
        } else if (age + dt >= SPLAT_SECONDS) {
          p.age[i] = -1;
          p.live--;
        } else {
          p.age[i] = age + dt;
        }
        write(p, i);
      }
      p.host.thinInstanceBufferUpdated("matrix");
    }
  }

  /** Wipe every droplet: a new area must not inherit the last one's floor. */
  clear(): void {
    for (const p of Object.values(this.pools)) {
      p.age.fill(-1);
      p.data.fill(0);
      p.live = 0;
      p.host.thinInstanceBufferUpdated("matrix");
    }
  }
}

const sprays = new WeakMap<Scene, HitSpray>();

/** The scene's one spray, built on first use. */
export function hitSpray(scene: Scene): HitSpray {
  let s = sprays.get(scene);
  if (!s) {
    s = new HitSpray(scene);
    sprays.set(scene, s);
    scene.onDisposeObservable.addOnce(() => sprays.delete(scene));
  }
  return s;
}
