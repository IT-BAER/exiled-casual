import { Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { Footfall } from "./wake";

/**
 * What a foot throws when it comes down in the shallows: a crown, a thin wall of
 * water that flares up round the foot and collapses back, and a spray of drops
 * that arc out and fall in, each ringing the surface where it lands.
 *
 * Real geometry, never a sprite: lit, clear PBR solids drawn as thin instances of
 * one host per kind, so all the splashes on screen are two draw calls. Thin
 * instance colour does not survive in this scene (flames.ts), so a crown fades by
 * collapsing and a drop by falling in, never by alpha.
 */
export const SPLASH_DROPS_NAME = "fx-splash-drops";
export const SPLASH_CROWNS_NAME = "fx-splash-crowns";
const DROP_CAPACITY = 256;
const CROWN_CAPACITY = 16;
const GRAVITY = -9.8;

/** Per footfall: drops, crown width at its widest (m) and height at its tallest. */
const PLAYER = { drops: 16, crown: 0.8, rise: 0.28 };
const MONSTER = { drops: 5, crown: 0.5, rise: 0.15 };
/** Seconds from the foot landing to the crown lying flat again. */
const CROWN_LIFE = 0.38;
/** The crown is born this share of its widest. */
const CROWN_FROM = 0.3;

const FORWARD = new Vector3(0, 0, 1);
const ZERO = new Float32Array(16);
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchDir = new Vector3();
const scratchRot = new Quaternion();
const IDENTITY = Quaternion.Identity();
const scratchM = new Matrix();

/** Thrown water is aerated: white and lit on both faces, glossy where it is
 *  thin. Lit from one side only, the inside of a crown reads as a black hole. */
function waterMaterial(scene: Scene, name: string, alpha: number, roughness: number): PBRMaterial {
  const m = new PBRMaterial(`${name}-mat`, scene);
  m.albedoColor = new Color3(0.82, 0.86, 0.85);
  m.emissiveColor = new Color3(0.22, 0.24, 0.24);
  m.metallic = 0;
  m.roughness = roughness;
  m.alpha = alpha;
  m.backFaceCulling = false;
  m.twoSidedLighting = true;
  return m;
}

function host(mesh: Mesh, capacity: number): Float32Array {
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.receiveShadows = false;
  const data = new Float32Array(capacity * 16);
  // Every slot drawn from the start at zero scale: the shader compiles behind the
  // loading plate and the instance count never changes.
  mesh.thinInstanceSetBuffer("matrix", data, 16, false);
  return data;
}

export class WaterSplash {
  /** Drops ever thrown and crowns ever raised: test seams that survive recycling. */
  emitted = 0;
  crowns = 0;
  /** Drops and crowns still drawing. */
  live = 0;
  /** Where a drop fell back in, and how big it was: the sea rings the surface there. */
  onLand: ((x: number, z: number, size: number) => void) | null = null;

  private readonly drops: Mesh;
  private readonly dropData: Float32Array;
  private readonly pos = new Float32Array(DROP_CAPACITY * 3);
  private readonly vel = new Float32Array(DROP_CAPACITY * 3);
  private readonly size = new Float32Array(DROP_CAPACITY);
  /** Water level each drop falls back to; NaN for an empty slot. */
  private readonly floor = new Float32Array(DROP_CAPACITY).fill(NaN);
  private nextDrop = 0;

  private readonly crownMesh: Mesh;
  private readonly crownData: Float32Array;
  /** x, y, z, age, widest, tallest per crown; age < 0 is an empty slot. */
  private readonly crown = new Float32Array(CROWN_CAPACITY * 6);
  private nextCrown = 0;

  constructor(scene: Scene) {
    this.drops = MeshBuilder.CreateSphere(SPLASH_DROPS_NAME, { diameter: 1, segments: 3 }, scene);
    this.drops.material = waterMaterial(scene, SPLASH_DROPS_NAME, 0.9, 0.15);
    this.dropData = host(this.drops, DROP_CAPACITY);
    // An open tube flaring upward, base at its own origin: a crown, not a can.
    this.crownMesh = MeshBuilder.CreateCylinder(SPLASH_CROWNS_NAME, {
      height: 1, diameterTop: 1, diameterBottom: 0.55, tessellation: 20, cap: Mesh.NO_CAP,
    }, scene);
    this.crownMesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    this.crownMesh.material = waterMaterial(scene, SPLASH_CROWNS_NAME, 0.6, 0.45);
    this.crownData = host(this.crownMesh, CROWN_CAPACITY);
    for (let i = 0; i < CROWN_CAPACITY; i++) this.crown[i * 6 + 3] = -1;
    scene.onBeforeRenderObservable.add(() => {
      if (this.live > 0) this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000));
    });
  }

  /** Splash a foot landing in water whose surface stands at `y`. */
  burst(f: Footfall, y: number): void {
    const kind = f.player ? PLAYER : MONSTER;
    const c = this.nextCrown;
    this.nextCrown = (c + 1) % CROWN_CAPACITY;
    if (this.crown[c * 6 + 3]! < 0) this.live++;
    this.crown.set([f.x, y, f.z, 0, kind.crown, kind.rise], c * 6);
    this.crowns++;
    for (let n = 0; n < kind.drops; n++) {
      const i = this.nextDrop;
      this.nextDrop = (i + 1) % DROP_CAPACITY;
      if (Number.isNaN(this.floor[i]!)) this.live++;
      const a = Math.random() * Math.PI * 2;
      const out = 0.5 + Math.random() * 0.9;
      // Off the rim of the crown, carried on with the body's own run.
      this.pos.set([f.x + Math.cos(a) * kind.crown * 0.2, y + 0.02, f.z + Math.sin(a) * kind.crown * 0.2], i * 3);
      this.vel.set([
        Math.cos(a) * out + f.dirX * f.speed * 0.35,
        1.6 + Math.random() * 1.6,
        Math.sin(a) * out + f.dirZ * f.speed * 0.35,
      ], i * 3);
      // Squared: mostly fine drops and the odd fat one.
      const r = Math.random();
      this.size[i] = 0.025 + r * r * 0.035;
      this.floor[i] = y;
      this.emitted++;
    }
  }

  /** Advance every drop and crown by `dt` seconds. Driven by the scene; public for tests. */
  step(dt: number): void {
    const { pos, vel } = this;
    for (let i = 0; i < DROP_CAPACITY; i++) {
      const floor = this.floor[i]!;
      if (Number.isNaN(floor)) continue;
      vel[i * 3 + 1] = vel[i * 3 + 1]! + GRAVITY * dt;
      pos[i * 3] = pos[i * 3]! + vel[i * 3]! * dt;
      pos[i * 3 + 1] = pos[i * 3 + 1]! + vel[i * 3 + 1]! * dt;
      pos[i * 3 + 2] = pos[i * 3 + 2]! + vel[i * 3 + 2]! * dt;
      if (vel[i * 3 + 1]! < 0 && pos[i * 3 + 1]! <= floor) {
        this.floor[i] = NaN;
        this.live--;
        this.onLand?.(pos[i * 3]!, pos[i * 3 + 2]!, this.size[i]!);
        this.dropData.set(ZERO, i * 16);
        continue;
      }
      const vx = vel[i * 3]!, vy = vel[i * 3 + 1]!, vz = vel[i * 3 + 2]!;
      const speed = Math.hypot(vx, vy, vz);
      scratchDir.set(vx / speed, vy / speed, vz / speed);
      Quaternion.FromUnitVectorsToRef(FORWARD, scratchDir, scratchRot);
      const s = this.size[i]!;
      // Drawn out along its flight, as a fast drop reads to the eye.
      scratchScale.set(s, s, s + speed * 0.012);
      scratchPos.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      Matrix.ComposeToRef(scratchScale, scratchRot, scratchPos, scratchM);
      scratchM.copyToArray(this.dropData, i * 16);
    }
    const cr = this.crown;
    for (let i = 0; i < CROWN_CAPACITY; i++) {
      const o = i * 6;
      if (cr[o + 3]! < 0) continue;
      const age = cr[o + 3]! + dt;
      if (age >= CROWN_LIFE) {
        cr[o + 3] = -1;
        this.live--;
        this.crownData.set(ZERO, i * 16);
        continue;
      }
      cr[o + 3] = age;
      const t = age / CROWN_LIFE;
      // Flares out fast and keeps spreading; rises at once and sinks back.
      const w = cr[o + 4]! * (CROWN_FROM + (1 - CROWN_FROM) * Math.sqrt(t));
      const h = cr[o + 5]! * Math.sin(Math.PI * Math.pow(t, 0.6));
      scratchScale.set(w, Math.max(h, 1e-4), w);
      scratchPos.set(cr[o]!, cr[o + 1]!, cr[o + 2]!);
      Matrix.ComposeToRef(scratchScale, IDENTITY, scratchPos, scratchM);
      scratchM.copyToArray(this.crownData, i * 16);
    }
    this.drops.thinInstanceBufferUpdated("matrix");
    this.crownMesh.thinInstanceBufferUpdated("matrix");
  }
}

const splashes = new WeakMap<Scene, WaterSplash>();

/** The scene's splash pool, built on first use. */
export function waterSplash(scene: Scene): WaterSplash {
  let s = splashes.get(scene);
  if (!s) {
    s = new WaterSplash(scene);
    splashes.set(scene, s);
    scene.onDisposeObservable.addOnce(() => splashes.delete(scene));
  }
  return s;
}
