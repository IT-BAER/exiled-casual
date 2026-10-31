import { Color3, Color4, MaterialPluginBase, MeshBuilder, Quaternion, SolidParticleSystem, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { GlowLayer, Material, Mesh, Scene, SolidParticle } from "@babylonjs/core";

/**
 * Pooled geometric particles for every skill effect: sparks, embers, flame
 * tongues, smoke and shockwave rings. Real solids in world units, never a
 * billboard, sprite or flipbook. Each pool is one SolidParticleSystem (vertex
 * colour, so heat and alpha survive; thin-instance colour does not in this
 * scene, see flames.ts), built once per scene with a fixed capacity: a busy
 * fight recycles the oldest slot and allocates nothing per hit.
 */
export type FxShape = "streak" | "ball" | "ring";
/** `alpha` feathers each solid to its outline (smoke, dust); `solid` keeps it crisp (drops of water, mud). */
export type FxBlend = "add" | "alpha" | "solid";

export interface FxSpec {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  /** Seconds alive, and seconds before it appears (a travelling wave). */
  life: number;
  delay?: number;
  /** Diameter for a ball or ring, length for a streak; eased to `sizeEnd` over life. */
  size: number;
  sizeEnd?: number;
  /** Streak thickness, and its extra length per unit of speed. */
  thick?: number;
  stretch?: number;
  r: number; g: number; b: number; a: number;
  /** Colour it cools toward by the end of its life. */
  r1?: number; g1?: number; b1?: number;
  /** Units/s² on y; negative falls. */
  gravity?: number;
  /** Share of velocity lost per second. */
  drag?: number;
}

const FIELDS = 24;
// Slot layout in one Float32Array: cheaper than an object per particle.
const X = 0, Y = 1, Z = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, S0 = 8, S1 = 9;
const TH = 10, ST = 11, R = 12, G = 13, B = 14, A = 15, R1 = 16, G1 = 17, B1 = 18, GR = 19, DR = 20;

export const SMOKE_EDGE_PLUGIN = "ExiledSmokeEdge";
/** How fast smoke thins toward its outline: alpha x facing^power, 0 where the ball turns edge-on. */
const SMOKE_EDGE_POWER = 1.6;

/** A flat-alpha ball reads as a hard grey disc on the floor; this feathers it out to its silhouette. */
class SmokeEdgePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, SMOKE_EDGE_PLUGIN, 200, {});
    // Same ES-module serialisation trap as rim.ts.
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName(): string {
    return SMOKE_EDGE_PLUGIN;
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        color.a *= pow(abs(dot(normalW, viewDirectionW)), ${SMOKE_EDGE_POWER.toFixed(2)});
      `,
    };
  }
}

/** Thin a material out toward its silhouette, so a solid reads as soft volume. */
export function featherEdges(material: Material): void {
  new SmokeEdgePlugin(material);
}

const FORWARD = new Vector3(0, 0, 1);
const scratchDir = new Vector3();
const scratchQ = new Quaternion();

export class FxPool {
  readonly mesh: Mesh;
  readonly capacity: number;
  private readonly sps: SolidParticleSystem;
  private readonly slots: Float32Array;
  private readonly shape: FxShape;
  private next = 0;
  /** Slots still drawing, delayed ones included. */
  live = 0;
  /** Particles ever emitted: a test seam that survives the slots recycling. */
  emitted = 0;
  private dirty = true;

  constructor(scene: Scene, name: string, shape: FxShape, blend: FxBlend, capacity: number) {
    this.shape = shape;
    this.capacity = capacity;
    this.slots = new Float32Array(capacity * FIELDS);
    for (let i = 0; i < capacity; i++) this.slots[i * FIELDS + AGE] = -1e9;
    const sps = new SolidParticleSystem(name, scene, { updatable: true });
    const proto = shape === "streak"
      ? MeshBuilder.CreatePolyhedron(`${name}-proto`, { type: 1, size: 0.5, flat: false }, scene)
      : shape === "ball"
        ? MeshBuilder.CreateSphere(`${name}-proto`, { diameter: 1, segments: 3 }, scene)
        : MeshBuilder.CreateTorus(`${name}-proto`, { diameter: 1, thickness: 0.035, tessellation: 40 }, scene);
    sps.addShape(proto, capacity);
    proto.dispose();
    this.mesh = sps.buildMesh();
    this.mesh.name = name;
    const mat = new StandardMaterial(`${name}-mat`, scene);
    mat.emissiveColor = Color3.White();
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    // Overlap is the look: a slot writing depth would reject the slots behind it.
    mat.disableDepthWrite = true;
    if (blend === "add") mat.alphaMode = 1; // ALPHA_ADD
    else if (blend === "alpha") featherEdges(mat);
    this.mesh.material = mat;
    // Transparent pass and `alpha *= vColor.a`; without it the pool draws opaque.
    this.mesh.hasVertexAlpha = true;
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    sps.computeParticleRotation = shape === "streak";
    sps.computeParticleTexture = false;
    sps.computeParticleVertex = false;
    sps.isAlwaysVisible = true;
    sps.updateParticle = (p) => this.write(p);
    this.sps = sps;
    const glow = scene.effectLayers?.find((l) => l.name === "glow") as GlowLayer | undefined;
    // The glow pass reads material emissive only (white here): give it the real
    // material for additive light, and keep smoke out of it altogether.
    if (glow) {
      if (blend === "add") glow.referenceMeshToUseItsOwnMaterial(this.mesh);
      else glow.addExcludedMesh(this.mesh);
    }
    sps.setParticles();
    scene.onBeforeRenderObservable.add(() => {
      if (this.live > 0 || this.dirty) this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000));
    });
  }

  emit(s: FxSpec): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const o = i * FIELDS;
    const d = this.slots;
    if (d[o + AGE]! < -1e8) this.live++;
    d[o + X] = s.x; d[o + Y] = s.y; d[o + Z] = s.z;
    d[o + VX] = s.vx ?? 0; d[o + VY] = s.vy ?? 0; d[o + VZ] = s.vz ?? 0;
    d[o + AGE] = -(s.delay ?? 0);
    d[o + LIFE] = Math.max(1e-3, s.life);
    d[o + S0] = s.size; d[o + S1] = s.sizeEnd ?? s.size;
    d[o + TH] = s.thick ?? 0.02; d[o + ST] = s.stretch ?? 0;
    d[o + R] = s.r; d[o + G] = s.g; d[o + B] = s.b; d[o + A] = s.a;
    d[o + R1] = s.r1 ?? s.r; d[o + G1] = s.g1 ?? s.g; d[o + B1] = s.b1 ?? s.b;
    d[o + GR] = s.gravity ?? 0; d[o + DR] = s.drag ?? 0;
    this.emitted++;
    this.dirty = true;
  }

  /** Advance every slot by `dt` seconds. Driven by the scene; public for tests. */
  step(dt: number): void {
    const d = this.slots;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * FIELDS;
      const age = d[o + AGE]!;
      if (age < -1e8) continue;
      const next = age + dt;
      if (next >= d[o + LIFE]!) {
        d[o + AGE] = -1e9;
        this.live--;
        continue;
      }
      d[o + AGE] = next;
      if (next <= 0) continue;
      const keep = Math.max(0, 1 - d[o + DR]! * dt);
      d[o + VX] = d[o + VX]! * keep;
      d[o + VY] = d[o + VY]! * keep + d[o + GR]! * dt;
      d[o + VZ] = d[o + VZ]! * keep;
      d[o + X] = d[o + X]! + d[o + VX]! * dt;
      d[o + Y] = d[o + Y]! + d[o + VY]! * dt;
      d[o + Z] = d[o + Z]! + d[o + VZ]! * dt;
    }
    this.sps.setParticles();
    this.dirty = this.live > 0;
  }

  /** Every live slot's position, for tests and for nothing else. */
  positions(): Vector3[] {
    const out: Vector3[] = [];
    for (let i = 0; i < this.capacity; i++) {
      const o = i * FIELDS;
      if (this.slots[o + AGE]! > -1e8) out.push(new Vector3(this.slots[o + X], this.slots[o + Y], this.slots[o + Z]));
    }
    return out;
  }

  /** Wipe every slot: a new area starts dark. */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.slots[i * FIELDS + AGE] = -1e9;
    this.live = 0;
    this.dirty = true;
  }

  private write(p: SolidParticle): SolidParticle {
    const o = p.idx * FIELDS;
    const d = this.slots;
    const age = d[o + AGE]!;
    if (age <= 0) {
      p.scaling.setAll(0);
      return p;
    }
    const t = age / d[o + LIFE]!;
    // Quick rise, long fall: a hit is loudest at once and lingers as it cools.
    const env = (t < 0.08 ? t / 0.08 : 1) * (1 - t) ** 1.5;
    const size = d[o + S0]! + (d[o + S1]! - d[o + S0]!) * Math.sqrt(t);
    p.position.set(d[o + X]!, d[o + Y]!, d[o + Z]!);
    if (this.shape === "streak") {
      const vx = d[o + VX]!, vy = d[o + VY]!, vz = d[o + VZ]!;
      const speed = Math.hypot(vx, vy, vz);
      if (speed > 1e-4) scratchDir.set(vx / speed, vy / speed, vz / speed);
      else scratchDir.set(0, 1, 0);
      Quaternion.FromUnitVectorsToRef(FORWARD, scratchDir, scratchQ);
      p.rotationQuaternion ??= new Quaternion();
      p.rotationQuaternion.copyFrom(scratchQ);
      const len = size + d[o + ST]! * speed;
      const thick = d[o + TH]! * (1 - 0.5 * t);
      p.scaling.set(thick, thick, len);
      // The head leads: the streak trails behind where the spark is.
      p.position.subtractInPlace(scratchDir.scaleInPlace(len / 2));
    } else if (this.shape === "ring") {
      p.scaling.set(size, 1, size);
    } else {
      p.scaling.setAll(size);
    }
    if (!p.color) p.color = new Color4(1, 1, 1, 1);
    const c = p.color;
    c.r = d[o + R]! + (d[o + R1]! - d[o + R]!) * t;
    c.g = d[o + G]! + (d[o + G1]! - d[o + G]!) * t;
    c.b = d[o + B]! + (d[o + B1]! - d[o + B]!) * t;
    c.a = d[o + A]! * env;
    return p;
  }
}

export const FX_SHARDS_NAME = "fx-shards";
export const FX_GLOW_NAME = "fx-glow";
export const FX_SMOKE_NAME = "fx-smoke";
export const FX_RING_NAME = "fx-ring";
/** Slots per pool: the cost is the capacity (the whole buffer uploads), not the live count. */
const SHARD_CAPACITY = 420;
const GLOW_CAPACITY = 96;
const SMOKE_CAPACITY = 64;
const RING_CAPACITY = 6;

export interface FxPools {
  /** Additive streaks: sparks, embers, tracer motes. */
  shards: FxPool;
  /** Additive swelling balls: flame tongues, fireball cores, flashes. */
  glow: FxPool;
  /** Alpha-blended balls: smoke and dust. */
  smoke: FxPool;
  /** Additive flat rings on the floor: shockwaves. */
  ring: FxPool;
}

const pools = new WeakMap<Scene, FxPools>();

/** The scene's pools, built on first use. */
export function fxPools(scene: Scene): FxPools {
  let p = pools.get(scene);
  if (!p) {
    p = {
      shards: new FxPool(scene, FX_SHARDS_NAME, "streak", "add", SHARD_CAPACITY),
      glow: new FxPool(scene, FX_GLOW_NAME, "ball", "add", GLOW_CAPACITY),
      smoke: new FxPool(scene, FX_SMOKE_NAME, "ball", "alpha", SMOKE_CAPACITY),
      ring: new FxPool(scene, FX_RING_NAME, "ring", "add", RING_CAPACITY),
    };
    pools.set(scene, p);
    scene.onDisposeObservable.addOnce(() => pools.delete(scene));
  }
  return p;
}

/** Wipe every pool on a scene that has them. */
export function clearFxPools(scene: Scene): void {
  const p = pools.get(scene);
  if (!p) return;
  for (const pool of [p.shards, p.glow, p.smoke, p.ring]) pool.clear();
}
