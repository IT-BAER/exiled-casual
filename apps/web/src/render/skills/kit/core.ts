import { Color3, Material, Mesh, PBRMaterial, PointLight, StandardMaterial, TransformNode, Vector3, VertexData } from "@babylonjs/core";
import type { GlowLayer, Scene } from "@babylonjs/core";
import { FxPool, featherEdges } from "../../fx-pool";
import { FLASH_NAME, flash } from "../../skill-fx";

/**
 * The kit's shared machinery: the handle every primitive returns, the scene's
 * kit pools and materials, a lathe/strip geometry builder and a tinted flash.
 *
 * Every primitive is a factory returning an `Fx`. The caller either drives it
 * (`update(dt)` each frame, `dispose()` when `done`) or hands it to `fire()`,
 * which drives it off the scene and disposes it when it is done. Meshes are
 * owned per effect and disposed with it; materials, templates and pools are
 * per scene and outlive every effect (that is what keeps the cost flat).
 */

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

/** What every primitive hands back. */
export interface FxHandle {
  update(dt: number): void;
  dispose(): void;
  readonly done: boolean;
}

/** An effect that runs until told to stop (auras, statuses, orbs, trails): `stop()` fades it out, then it is `done`. */
export interface LastingFx extends FxHandle {
  stop(): void;
}

/** A position an effect reads every frame: fixed, a node it follows, or a getter. */
export type Point = Vector3 | TransformNode | (() => Vector3);

export function pointOf(p: Point, out: Vector3): Vector3 {
  if (p instanceof Vector3) return out.copyFrom(p);
  if (p instanceof TransformNode) return out.copyFrom(p.getAbsolutePosition());
  return out.copyFrom(p());
}

export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
/** Inverse of `easeOut`: the share of the time at which an eased front reaches share `r` of its reach. */
export const easeOutInv = (r: number): number => 1 - (1 - clamp01(r)) ** (1 / 3);
export const TAU = Math.PI * 2;

/** The scene's frame time in seconds, clamped as the pools clamp it. */
export function frameDt(scene: Scene): number {
  return Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
}

interface Disposable { dispose(): void }

/**
 * The handle every primitive returns. `tick` runs each update with the effect's
 * age; returning false ends it. Children (composed primitives) are updated and
 * disposed with it, and it is not done until they are.
 */
export class Fx implements LastingFx {
  age = 0;
  private finished = false;
  private disposed = false;
  private stopping = -1;
  private readonly owned: Disposable[] = [];
  private readonly children: FxHandle[] = [];
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly tick: (fx: Fx, dt: number) => boolean | void, readonly fadeS = 0.35) {}

  get done(): boolean {
    return this.finished && this.children.every((c) => c.done);
  }

  /** 1 while running; falls to 0 over `fadeS` once stopped. */
  get fade(): number {
    return this.stopping < 0 ? 1 : clamp01(1 - this.stopping / this.fadeS);
  }

  get stopped(): boolean {
    return this.stopping >= 0;
  }

  own<T extends Disposable>(x: T): T {
    this.owned.push(x);
    return x;
  }

  child<T extends FxHandle>(h: T): T {
    this.children.push(h);
    return h;
  }

  onDispose(fn: () => void): void {
    this.cleanups.push(fn);
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (const c of this.children) if (!c.done) c.update(dt);
    if (this.finished) return;
    this.age += dt;
    if (this.stopping >= 0) this.stopping += dt;
    const alive = this.tick(this, dt) !== false;
    if (!alive || (this.stopping >= 0 && this.fade <= 0)) this.finish();
  }

  /** End now, keeping children running to their own end. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const o of this.owned.splice(0)) o.dispose();
  }

  stop(): void {
    if (this.stopping < 0) this.stopping = 0;
    for (const c of this.children) (c as Partial<LastingFx>).stop?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finish();
    for (const c of this.children.splice(0)) c.dispose();
    for (const fn of this.cleanups.splice(0)) fn();
  }
}

/** Drive a handle off the scene's frame and dispose it once done: a fire-and-forget one-shot. */
export function fire<H extends FxHandle>(scene: Scene, h: H): H {
  const obs = scene.onBeforeRenderObservable.add(() => {
    h.update(frameDt(scene));
    if (h.done) {
      scene.onBeforeRenderObservable.remove(obs);
      h.dispose();
    }
  });
  const inner = h.dispose.bind(h);
  h.dispose = () => {
    scene.onBeforeRenderObservable.remove(obs);
    inner();
  };
  return h;
}

/** End a lasting effect when the node it rides is disposed (the monster died). */
export function bindToNode(fx: Fx, node: TransformNode): void {
  const obs = node.onDisposeObservable.addOnce(() => fx.dispose());
  fx.onDispose(() => node.onDisposeObservable.remove(obs));
}

export interface KitPools {
  /** Additive streaks for the loud one-shots: sparks, embers, shards of light. */
  shards: FxPool;
  /** Additive swelling balls: flame knots, cores, flashes. */
  glow: FxPool;
  /** Feathered alpha balls: dust, mist, smoke. */
  smoke: FxPool;
  /** Additive streaks for the long-running auras and statuses, so a crowd of them never steals a hit's sparks. */
  motes: FxPool;
  /** Opaque balls: blood drops, mud. */
  drops: FxPool;
}

export const KIT_POOL_PREFIX = "kit-pool";
const kitPoolMap = new WeakMap<Scene, KitPools>();

/** The kit's own pools, separate from `fxPools` so the kit's volume never recycles a hit's sparks. */
export function kitPools(scene: Scene): KitPools {
  let p = kitPoolMap.get(scene);
  if (!p) {
    p = {
      shards: new FxPool(scene, `${KIT_POOL_PREFIX}-shards`, "streak", "add", 600),
      glow: new FxPool(scene, `${KIT_POOL_PREFIX}-glow`, "ball", "add", 220),
      smoke: new FxPool(scene, `${KIT_POOL_PREFIX}-smoke`, "ball", "alpha", 160),
      motes: new FxPool(scene, `${KIT_POOL_PREFIX}-motes`, "streak", "add", 360),
      drops: new FxPool(scene, `${KIT_POOL_PREFIX}-drops`, "ball", "solid", 120),
    };
    kitPoolMap.set(scene, p);
    scene.onDisposeObservable.addOnce(() => kitPoolMap.delete(scene));
  }
  return p;
}

const hex = (c: Rgb) => c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

function unlit(scene: Scene, name: string, colour: Rgb): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = new Color3(colour[0], colour[1], colour[2]);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  m.backFaceCulling = false;
  return m;
}

/**
 * Additive unlit material, one per scene per colour. White leaves the colour to
 * the vertex colours (lathe geometry paints itself). `feather` thins it to its
 * silhouette, so a shell reads as a soft volume, not a hard ball.
 */
export function addMat(scene: Scene, colour: Rgb = [1, 1, 1], feather = false): StandardMaterial {
  const name = `kit-add-${feather ? "f-" : ""}${hex(colour)}`;
  const found = scene.getMaterialByName(name) as StandardMaterial | null;
  if (found) return found;
  const m = unlit(scene, name, colour);
  m.alphaMode = 1; // ALPHA_ADD
  m.disableDepthWrite = true;
  // At alpha 1 with no opacity texture Babylon draws it opaque and ignores ALPHA_ADD.
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  if (feather) featherEdges(m);
  return m;
}

/** Alpha-blended unlit material: scorch, dark cracks, mist shells. Vertex colours paint it. */
export function blendMat(scene: Scene, colour: Rgb = [1, 1, 1], feather = false): StandardMaterial {
  const name = `kit-blend-${feather ? "f-" : ""}${hex(colour)}`;
  const found = scene.getMaterialByName(name) as StandardMaterial | null;
  if (found) return found;
  const m = unlit(scene, name, colour);
  m.disableDepthWrite = true;
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  if (feather) featherEdges(m);
  return m;
}

/** Opaque unlit: small solids that must read at any light (stun stars). */
export function solidMat(scene: Scene, colour: Rgb): StandardMaterial {
  const name = `kit-solid-${hex(colour)}`;
  return (scene.getMaterialByName(name) as StandardMaterial | null) ?? unlit(scene, name, colour);
}

/** Lit PBR (the scene's lights are physical; a lit StandardMaterial blows out under the sun). */
export function litMat(scene: Scene, key: string, albedo: Rgb, emissive: Rgb, roughness = 0.9, alpha = 1): PBRMaterial {
  const name = `kit-lit-${key}`;
  const found = scene.getMaterialByName(name) as PBRMaterial | null;
  if (found) return found;
  const m = new PBRMaterial(name, scene);
  m.albedoColor = new Color3(...albedo);
  m.emissiveColor = new Color3(...emissive);
  m.metallic = 0;
  m.roughness = roughness;
  if (alpha < 1) {
    m.alpha = alpha;
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  }
  return m;
}

function glowLayer(scene: Scene): GlowLayer | undefined {
  return scene.effectLayers?.find((l) => l.name === "glow") as GlowLayer | undefined;
}

/** Let the glow layer bloom a mesh with its real (vertex-coloured) material, or keep it out of the glow altogether. */
export function glowOwn(scene: Scene, mesh: Mesh, glow = true): void {
  const layer = glowLayer(scene);
  if (!layer) return;
  if (glow) layer.referenceMeshToUseItsOwnMaterial(mesh);
  else layer.addExcludedMesh(mesh);
}

/**
 * Make a built mesh an effect part: not pickable, no shadows, drawn transparent.
 * `glow` false keeps a dark part (scorch, crack, mist) out of the bloom; the
 * choice is remembered so a template's clones inherit it.
 */
export function fxMesh(scene: Scene, mesh: Mesh, material: Material, glow = true): Mesh {
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  if (mesh.getVerticesData("color")) mesh.hasVertexAlpha = true;
  mesh.metadata = { ...(mesh.metadata as object | null), kitGlow: glow };
  glowOwn(scene, mesh, glow);
  return mesh;
}

export interface LatheRing {
  r: number;
  y: number;
  c: Rgba;
}

/**
 * Vertex-coloured geometry, built in plain arrays and turned into one mesh.
 * `lathe` sweeps a profile of (radius, height, colour) rings round +Y, which
 * covers every disc, band, wall, shell and tongue the kit draws; `strip` lays a
 * flat ribbon on the floor through a polyline.
 */
export class Geo {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  vert(x: number, y: number, z: number, c: Rgba): number {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2], c[3]);
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    // a-b along one edge, c-d the next; both windings drawn (backFaceCulling off).
    this.idx.push(a, c, b, b, c, d);
  }

  /**
   * Sweep `profile` round +Y from yaw `a0` to `a1` (yaw 0 is +Z, as every mover
   * faces). `jitter(yaw, ring)` scales a ring's radius per column, for ragged edges;
   * `lift(yaw, ring)` adds height per column, for tongues.
   */
  lathe(
    profile: readonly LatheRing[], segs: number, a0 = 0, a1 = TAU,
    o: { cx?: number; cz?: number; jitter?: (yaw: number, ring: number) => number; lift?: (yaw: number, ring: number) => number } = {},
  ): void {
    const cx = o.cx ?? 0, cz = o.cz ?? 0;
    const base = this.pos.length / 3;
    const rows = profile.length;
    for (let s = 0; s <= segs; s++) {
      const yaw = a0 + ((a1 - a0) * s) / segs;
      const sx = Math.sin(yaw), cz2 = Math.cos(yaw);
      for (let k = 0; k < rows; k++) {
        const ring = profile[k]!;
        const r = ring.r * (o.jitter?.(yaw, k) ?? 1);
        this.vert(cx + sx * r, ring.y + (o.lift?.(yaw, k) ?? 0), cz + cz2 * r, ring.c);
      }
    }
    for (let s = 0; s < segs; s++) {
      for (let k = 0; k < rows - 1; k++) {
        const a = base + s * rows + k;
        this.quad(a, a + 1, a + rows, a + rows + 1);
      }
    }
  }

  /** A flat floor ribbon through `pts` (x, z, half width, alpha), mitred at each kink. */
  strip(pts: readonly (readonly [number, number, number, number])[], rgb: Rgb, y = 0): void {
    const v0 = this.pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [x, z, w, a] = pts[i]!;
      const [px, pz] = pts[Math.max(0, i - 1)]!;
      const [qx, qz] = pts[Math.min(pts.length - 1, i + 1)]!;
      const len = Math.hypot(qx - px, qz - pz) || 1;
      const nx = -(qz - pz) / len, nz = (qx - px) / len;
      this.vert(x + nx * w, y, z + nz * w, [rgb[0], rgb[1], rgb[2], a]);
      this.vert(x - nx * w, y, z - nz * w, [rgb[0], rgb[1], rgb[2], a]);
      if (i > 0) {
        const v = v0 + (i - 1) * 2;
        this.quad(v, v + 1, v + 2, v + 3);
      }
    }
  }

  mesh(scene: Scene, name: string, updatable = false): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.colors = this.col;
    vd.indices = this.idx;
    const normals: number[] = [];
    VertexData.ComputeNormals(this.pos, this.idx, normals);
    vd.normals = normals;
    vd.applyToMesh(mesh, updatable);
    mesh.hasVertexAlpha = true;
    return mesh;
  }
}

/** A colour scaled, with an alpha: the lathe profiles' shorthand. */
export const rgba = (c: Rgb, a: number, k = 1): Rgba => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k), a];

/**
 * A per-scene template mesh, built once and kept disabled; effects take clones,
 * which share its vertex buffers, so a crowd of statuses costs no geometry.
 */
export function template(scene: Scene, key: string, build: () => Mesh): Mesh {
  const name = `kit-tpl-${key}`;
  const found = scene.getMeshByName(name) as Mesh | null;
  if (found) return found;
  const m = build();
  m.name = name;
  m.isPickable = false;
  m.setEnabled(false);
  return m;
}

export function cloneOf(scene: Scene, tpl: Mesh, name: string): Mesh {
  const m = tpl.clone(name, null, true)!;
  m.setEnabled(true);
  m.isPickable = false;
  if (m.getVerticesData("color")) m.hasVertexAlpha = true;
  const glow = (tpl.metadata as { kitGlow?: boolean } | null)?.kitGlow;
  if (glow !== undefined) glowOwn(scene, m, glow);
  return m;
}

/** The warm colour `skill-fx.ts` gives the shared flash light; restored after a tinted flash. */
const FLASH_WARM: Rgb = [1, 0.62, 0.26];

/**
 * The shared impact light (`skill-fx.ts` `flash`), optionally tinted. Never a new
 * light: a cold flash borrows the one light and gives the warm colour back as soon
 * as it has decayed or another hit has taken it over.
 */
export function kitFlash(scene: Scene, at: Vector3, level: number, tint?: Rgb): void {
  flash(scene, at, level);
  if (!tint) return;
  const light = scene.getLightByName(FLASH_NAME) as PointLight | null;
  if (!light || light.intensity <= 0) return;
  const owned = light.intensity;
  light.diffuse.set(tint[0], tint[1], tint[2]);
  let last = owned;
  const obs = scene.onBeforeRenderObservable.add(() => {
    // Rising intensity means a new hit took the light over; faded means we are done.
    if (light.intensity > last + 1e-3 || light.intensity <= 0.5) {
      light.diffuse.set(FLASH_WARM[0], FLASH_WARM[1], FLASH_WARM[2]);
      scene.onBeforeRenderObservable.remove(obs);
    }
    last = light.intensity;
  });
}

/** A ragged-edge factor per yaw: three detuned harmonics, never a perfect circle. */
export function ragged(amount: number, seed = Math.random() * 100): (yaw: number) => number {
  return (yaw) => 1 + amount * (0.5 * Math.sin(yaw * 3 + seed) + 0.3 * Math.sin(yaw * 7 + seed * 1.7) + 0.2 * Math.sin(yaw * 13 + seed * 2.3));
}
