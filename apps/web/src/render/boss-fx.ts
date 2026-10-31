import { Color3, Material, Matrix, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Vector3, VertexData } from "@babylonjs/core";
import type { GlowLayer, Scene } from "@babylonjs/core";
import type { SnapshotEntity } from "@exiled/protocol";
import { BROOD_ABILITY } from "./boss-tells";
import { FxPool, fxPools } from "./fx-pool";
import { slamDebris } from "./slam-debris";
import { dustPuff, emberBurst, FALLBACK_FX, flash, type FxProfile } from "./skill-fx";

/** What a boss's marks do when they land, fired by the renderer as a mark leaves the snapshot on its impact
 *  tick and keyed by its `ability` like the sound. Real geometry and the shared pools only, no billboard or sprite. */

/** Each boss's element, which tints everything its hits throw. */
type Look = "fire" | "sun" | "bog" | "thorn" | "stone";
const LOOKS: Record<string, Look> = {
  "monster.cinder_warden.v1": "fire",
  "monster.sirrath.v1": "sun",
  "monster.mother_vhal.v1": "bog",
  "monster.ghaltrek.v1": "thorn",
};
type Rgb = readonly [number, number, number];
/** Hot and cooled colours of what a hit throws, and how much of the shared flash it lights. */
const PALETTE: Record<Look, { hot: Rgb; cool: Rgb; flash: number }> = {
  fire: { hot: [1, 0.72, 0.3], cool: [0.85, 0.22, 0.04], flash: 0.9 },
  sun: { hot: [1, 0.95, 0.72], cool: [1, 0.6, 0.15], flash: 1 },
  bog: { hot: [0.5, 0.58, 0.28], cool: [0.18, 0.22, 0.08], flash: 0 },
  thorn: { hot: [0.72, 0.85, 0.32], cool: [0.28, 0.38, 0.08], flash: 0 },
  stone: { hot: [1, 0.86, 0.62], cool: [0.6, 0.4, 0.2], flash: 0.4 },
};

/** How fast a landing's wave runs out through the floor, units per second. */
const WAVE_SPEED = 14;
/** Dust puffs round the rim of a slam, where its wave arrives. */
const RIM_DUST = 10;
/** What one landing throws of its element. */
const ELEMENT_SPARKS = 28;
/** Drops of mud and bog water in the crown a bog slam throws. */
const MUD_CROWN = 48;

export const FISSURE_NAME = "fx-boss-fissure";
/** Seconds a fissure glows, cooling from molten to nothing; the char under it lasts twice that. */
export const FISSURE_SECONDS = 3;
const CHAR_SECONDS = 6;
/** Fissures at once: a rift, and a volley of three lances' scorch lines. */
const FISSURE_POOL = 4;
const FISSURE_SEGMENTS = 28;
/** Over the slam cracks (0.018) and under a burning patch (0.05). */
const FISSURE_Y = 0.03;
/** Magma Rift's eruption runs out from the Warden at this speed, a flame every this many units. */
const RIFT_SPEED = 18;
const RIFT_STEP = 0.45;

export const SCORCH_NAME = "fx-boss-scorch";
/** Seconds the Kiln Ring's scorched band shows, the last `SCORCH_FADE` of it fading. */
const SCORCH_SECONDS = 5;
const SCORCH_FADE = 3;
const SCORCH_SEGMENTS = 64;
/** Share of the band each soft edge takes, so no hard line is drawn round the hole. */
const SCORCH_FEATHER = 0.18;
/** Flame tongues across the Kiln Ring's band, and sparks thrown off its outer edge. */
const KILN_FLAMES = 48;
const KILN_SPARKS = 36;

export const BEAM_NAME = "fx-boss-beam";
/** Seconds a Sunlance's beam stands, the last `BEAM_FADE` of it fading. */
export const BEAM_SECONDS = 0.35;
const BEAM_FADE = 0.15;
/** How far up the beam reaches: a column on the lane, not a wall across a third of the view. */
const BEAM_HEIGHT = 3;
/** Beams at once: a volley of three, landing 0.3 s apart. */
const BEAM_POOL = 3;
/** The white core's share of the beam's width. */
const BEAM_CORE = 0.35;
const LANCE_SPARKS = 24;

/** A Cinder Rain rock starts falling this long before its marker lands, from this high. */
const FALL_SECONDS = 0.35;
const FALL_HEIGHT = 8;
/** How far off plumb it starts: it comes from somewhere, not straight down a wire. */
const FALL_SLANT = 0.6;
/** A meteor's landing: a fireball a little under Ember Bolt's, and a third of a slam's rubble. */
const METEOR_FX: FxProfile = {
  ...FALLBACK_FX,
  core: new Color3(1, 0.9, 0.62),
  wake: new Color3(1, 0.42, 0.1),
  flash: 0.7,
  blast: 1.7,
  burstShards: 26,
  smoke: 4,
};
const METEOR_RUBBLE = 0.3;

/** Bubbles a second in a waiting bog mark: a geyser's quicken over its last second, a brood mark's simmer. */
const GEYSER_BUBBLES_FAR = 4;
const GEYSER_BUBBLES_NEAR = 16;
const BROOD_BUBBLES = 5;
/** Bog water: what a bubble cools to. */
const BOG_WATER: Rgb = [0.24, 0.27, 0.16];
const WATER_NAME = "fx-boss-water";
const MUD_NAME = "fx-boss-mud";
/** Drops at once: a geyser's jet, spray and drops (106) three times over (the volley's count), and a splash. */
const WATER_CAPACITY = 330;
/** Clumps at once: a last-phase burst's crown (48) and a slam's. */
const MUD_CAPACITY = 84;
/** Foam where water is thrown hardest, and the murky water it falls back as. Pale on purpose: the dark fen swallows anything darker. */
const FOAM: Rgb = [0.88, 0.92, 0.84];
const MURK: Rgb = [0.42, 0.47, 0.32];
/** Wet mud, dark on purpose: on the Strand's sand the foam alone washes out. */
const MUD: Rgb = [0.3, 0.22, 0.12];
const MUD_DRY: Rgb = [0.22, 0.17, 0.1];
/** Thin streaks shot up a geyser's middle, one after another so the first out is the top; the spray its crown throws. */
const GEYSER_JET = 60;
const GEYSER_SPRAY = 36;
const GEYSER_DROPS = 10;
const SPLASH_DROPS = 8;

export const THORN_NAME = "fx-boss-thorns";
/** Spikes at once: a charge's lane and a nova's rings together. */
const THORN_CAPACITY = 160;
/** Seconds a spike takes to thrust up, stands, and takes to sink back into the floor. */
const THORN_RISE = 0.08;
const THORN_HOLD = 0.55;
const THORN_SINK = 0.35;
/** Bramble Charge's thorns run up the lane at his dash (`dashSpeedFixed` 14), a row every this many units. */
const CHARGE_SPEED = 14;
const CHARGE_ROW = 0.4;
/** Briar Nova's rings of thorns, as shares of its radius, the spacing round each, and how fast they run out. */
const NOVA_RINGS = [0.4, 0.67, 0.93];
const NOVA_SPACING = 0.55;
const NOVA_SPEED = 16;
const NOVA_RUBBLE = 0.4;

/** Trauma weight of a heavy boss blow landing on the player, gone this many units outside its reach. */
const HEAVY_SHAKE = 1.4;
const SHAKE_FALLOFF = 8;
/** Trauma weight of a boss entering its last phase, wherever the player stands. */
export const PHASE_SHAKE = 2.5;
/** The last phase's floor shockwave reaches this far, and its dust rises this far out. */
const PHASE_WAVE = 9;
const PHASE_DUST_AT = 2.5;
const PHASE_DUST = 12;
/** The Warden's last-phase fireball: bigger than any the player throws. */
const PHASE_FIRE: FxProfile = { ...METEOR_FX, blast: 2.6, burstShards: 40, smoke: 6, flash: 1 };

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * A jagged unit strip along +z from 0 to 1 within x ±1: it wanders and pinches
 * shut at both ends. Each slot is built once with its own shape.
 */
function fissureMesh(scene: Scene, name: string): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const p1 = rand(0, Math.PI * 2);
  const p2 = rand(0, Math.PI * 2);
  for (let i = 0; i <= FISSURE_SEGMENTS; i++) {
    const z = i / FISSURE_SEGMENTS;
    const centre = 0.22 * Math.sin(z * 9 + p1) + 0.12 * Math.sin(z * 23 + p2);
    const w = (0.3 + 0.7 * Math.sqrt(Math.sin(Math.PI * z))) * rand(0.55, 1);
    const a = Math.max(0, Math.min(1, z / 0.06, (1 - z) / 0.06));
    pos.push(centre - w, 0, z, centre + w, 0, z);
    col.push(1, 1, 1, a, 1, 1, 1, a);
    if (i > 0) {
      const v = (i - 1) * 2;
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  const mesh = new Mesh(name, scene);
  Object.assign(new VertexData(), { positions: pos, colors: col, indices: idx }).applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  return mesh;
}

/** Unlit and two-sided: a floor decal is its own light, and seen only from above. */
function decalMaterial(scene: Scene, name: string, emissive: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = emissive;
  m.disableLighting = true;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}

interface Fissure { molten: Mesh; char: Mesh; mat: StandardMaterial; age: number; hot: Rgb; cool: Rgb }

/**
 * A band at an outer radius of 1, four rings deep: clear at the hole, dark, dark,
 * clear at the rim. The hole's size is set per use (`shapeScorch`).
 */
function scorchMesh(scene: Scene): Mesh {
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < SCORCH_SEGMENTS; j++) {
    col.push(1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0);
    const o = j * 4;
    const n = ((j + 1) % SCORCH_SEGMENTS) * 4;
    for (let k = 0; k < 3; k++) idx.push(o + k, n + k, n + k + 1, o + k, n + k + 1, o + k + 1);
  }
  const mesh = new Mesh(SCORCH_NAME, scene);
  Object.assign(new VertexData(), { positions: new Array<number>(SCORCH_SEGMENTS * 12).fill(0), colors: col, indices: idx })
    .applyToMesh(mesh, true);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  return mesh;
}

/**
 * A unit column standing on the floor (y 0 to 1, diameter 1), solid at its foot
 * and gone at its top: light coming down out of the sky, not a pillar.
 */
function beamMesh(scene: Scene, name: string): Mesh {
  const mesh = MeshBuilder.CreateCylinder(name, { height: 1, diameter: 1, tessellation: 12, cap: 0 }, scene);
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  const pos = mesh.getVerticesData("position")!;
  const col: number[] = [];
  for (let i = 0; i < pos.length; i += 3) col.push(1, 1, 1, (1 - pos[i + 1]!) ** 1.5);
  mesh.setVerticesData("color", col);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  return mesh;
}

interface Beam { outer: Mesh; core: Mesh; age: number }

/** A five-sided cone standing on the floor (base radius 0.5, tip at y 1): dark bark at the root, pale at the point. */
function thornMesh(scene: Scene): Mesh {
  const m = MeshBuilder.CreateCylinder(THORN_NAME, { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 5, cap: 0 }, scene);
  m.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  m.convertToFlatShadedMesh();
  const pos = m.getVerticesData("position")!;
  const col: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const t = pos[i + 1]!;
    col.push(0.13 + 0.32 * t, 0.09 + 0.34 * t, 0.05 + 0.12 * t, 1);
  }
  m.setVerticesData("color", col);
  return m;
}

/** Per spike: x, z, its turn about its own axis, lean, lean direction, height, width, age (negative while it waits). */
const SPIKE = 8;
const ZERO16 = new Float32Array(16);
const scratchAxis = new Vector3();
const mScale = new Matrix();
const mYaw = new Matrix();
const mLean = new Matrix();
const mTurned = new Matrix();
const mSpike = new Matrix();

/**
 * The thorns' host: every spike a thin instance of one cone, one draw call, at
 * zero scale while it waits or once it has sunk. Allocates nothing per burst.
 */
class Thorns {
  readonly host: Mesh;
  private readonly data = new Float32Array(THORN_CAPACITY * 16);
  private readonly spikes = new Float32Array(THORN_CAPACITY * SPIKE);
  private readonly live = new Uint8Array(THORN_CAPACITY);
  private next = 0;
  count = 0;

  constructor(scene: Scene) {
    const host = thornMesh(scene);
    // PBR like the slam's rubble: the scene's lights are physical.
    const mat = new PBRMaterial(`${THORN_NAME}-mat`, scene);
    mat.albedoColor = Color3.White();
    mat.metallic = 0;
    mat.roughness = 0.85;
    host.material = mat;
    host.isPickable = false;
    host.alwaysSelectAsActiveMesh = true;
    host.doNotSyncBoundingInfo = true;
    host.thinInstanceSetBuffer("matrix", this.data, 16, false);
    this.host = host;
  }

  /** A spike at (x, z) leaning `lean` radians toward `leanDir` (radians in x, z), up after `delay` seconds. */
  emit(x: number, z: number, height: number, width: number, lean: number, leanDir: number, delay: number): void {
    const i = this.next;
    this.next = (this.next + 1) % THORN_CAPACITY;
    if (!this.live[i]) this.count++;
    this.live[i] = 1;
    this.spikes.set([x, z, rand(0, Math.PI * 2), lean, leanDir, height, width, -delay], i * SPIKE);
    this.write(i);
  }

  step(dt: number): void {
    if (this.count === 0) return;
    for (let i = 0; i < THORN_CAPACITY; i++) {
      if (!this.live[i]) continue;
      const o = i * SPIKE + 7;
      this.spikes[o] = this.spikes[o]! + dt;
      if (this.spikes[o]! >= THORN_RISE + THORN_HOLD + THORN_SINK) {
        this.live[i] = 0;
        this.count--;
      }
      this.write(i);
    }
    this.host.thinInstanceBufferUpdated("matrix");
  }

  /** Every live spike's foot and point, for tests and for nothing else. */
  points(): { base: Vector3; tip: Vector3 }[] {
    const out: { base: Vector3; tip: Vector3 }[] = [];
    for (let i = 0; i < THORN_CAPACITY; i++) {
      if (!this.live[i]) continue;
      const o = i * SPIKE;
      const m = Matrix.FromArray(this.data, i * 16);
      const base = new Vector3(this.spikes[o]!, m.m[13], this.spikes[o + 1]!);
      out.push({ base, tip: this.spikes[o + 7]! > 0 ? Vector3.TransformCoordinates(new Vector3(0, 1, 0), m) : base.clone() });
    }
    return out;
  }

  clear(): void {
    this.live.fill(0);
    this.data.fill(0);
    this.count = 0;
    this.host.thinInstanceBufferUpdated("matrix");
  }

  private write(i: number): void {
    const s = this.spikes;
    const o = i * SPIKE;
    const age = s[o + 7]!;
    if (!this.live[i] || age <= 0) {
      this.data.set(ZERO16, i * 16);
      return;
    }
    // Thrust up fast and eased, held, then down into the floor at its own height.
    const k = 1 - (1 - Math.min(1, age / THORN_RISE)) ** 3;
    const sink = Math.max(0, (age - THORN_RISE - THORN_HOLD) / THORN_SINK);
    const h = s[o + 5]!;
    const w = s[o + 6]!;
    const dir = s[o + 4]!;
    Matrix.ScalingToRef(w, h * k, w, mScale);
    Matrix.RotationYToRef(s[o + 2]!, mYaw);
    scratchAxis.set(Math.sin(dir), 0, -Math.cos(dir));
    Matrix.RotationAxisToRef(scratchAxis, s[o + 3]!, mLean);
    mScale.multiplyToRef(mYaw, mTurned);
    mTurned.multiplyToRef(mLean, mSpike);
    mSpike.setTranslationFromFloats(s[o]!, -h * sink, s[o + 1]!);
    mSpike.copyToArray(this.data, i * 16);
  }
}

/** Fit a scorch's band to a hole of `hole` (a share of the outer radius). */
function shapeScorch(mesh: Mesh, hole: number): void {
  const band = 1 - hole;
  const rings = [hole, hole + band * SCORCH_FEATHER, 1 - band * SCORCH_FEATHER, 1];
  const at: number[] = [];
  for (let j = 0; j < SCORCH_SEGMENTS; j++) {
    const a = (2 * Math.PI * j) / SCORCH_SEGMENTS;
    for (const r of rings) at.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  mesh.updateVerticesData("position", at);
}

/** A mark the bosses cast: a heavy wind-up or a named ability. A trash slam is neither. */
export function isBossMark(e: SnapshotEntity): boolean {
  return e.heavy === true || e.ability !== undefined;
}

function lookOf(species: string | undefined): Look {
  return (species === undefined ? undefined : LOOKS[species]) ?? "stone";
}

/**
 * How hard a landed boss mark shakes the camera of a player at (px, py): full
 * inside its reach, nothing `SHAKE_FALLOFF` units beyond it. Only heavies shake.
 */
export function shakeFor(e: SnapshotEntity, px: number, py: number): number {
  if (!e.heavy) return 0;
  let gap: number;
  if (e.shape === "line") {
    const dx = e.dirX ?? 0;
    const dz = e.dirY ?? 1;
    const t = Math.max(0, Math.min(e.length ?? 0, (px - e.x) * dx + (py - e.y) * dz));
    gap = Math.hypot(px - (e.x + dx * t), py - (e.y + dz * t)) - (e.radius ?? 0);
  } else {
    gap = Math.hypot(px - e.x, py - e.y) - (e.radius ?? 0);
  }
  return HEAVY_SHAKE * Math.max(0, 1 - Math.max(0, gap) / SHAKE_FALLOFF);
}

export class BossFx {
  /** How each boss ability's mark lands, keyed by its id; an id missing here lands as the plain slam. */
  static readonly LANDINGS: Readonly<Record<string, (fx: BossFx, e: SnapshotEntity, look: Look) => void>> = {
    cinder_rain: (fx, e) => fx.meteor(e),
    bog_geyser: (fx, e) => fx.geyser(e),
    [BROOD_ABILITY]: (fx, e) => fx.splash(e),
    bramble_charge: (fx, e) => fx.charge(e),
    briar_nova: (fx, e) => fx.nova(e),
    magma_rift: (fx, e, look) => fx.rift(e, look),
    kiln_ring: (fx, e, look) => fx.kiln(e, look),
    sunlance: (fx, e, look) => fx.lance(e, look),
  };
  /** What stirs over a boss's mark before it lands, by ability: its rock falling, or bubbles a second `left` seconds out. */
  static readonly WINDUPS: Readonly<Record<string, { falls?: true; bubbles?: (left: number) => number }>> = {
    cinder_rain: { falls: true },
    bog_geyser: { bubbles: (left) => GEYSER_BUBBLES_FAR + (GEYSER_BUBBLES_NEAR - GEYSER_BUBBLES_FAR) * (1 - Math.min(1, left)) },
    [BROOD_ABILITY]: { bubbles: () => BROOD_BUBBLES },
  };

  private readonly fissures: Fissure[] = [];
  private nextFissure = 0;
  private readonly scorch: Mesh;
  private scorchAge = -1;
  private readonly beams: Beam[] = [];
  private nextBeam = 0;
  /** Cinder Rain markers whose rock is already falling. */
  private readonly falling = new Set<number>();
  /** Each bog mark's share of a bubble not yet risen, so a slow rate still bubbles at 144 Hz. */
  private readonly bubbleDebt = new Map<number, number>();
  private readonly spikes: Thorns;
  /**
   * Mother Vhal's water and mud: crisp drops and round clumps, lit, so the sun
   * puts a glint on them. The shared smoke pool feathers every ball to a soft
   * puff, and her geyser built from it read as smoke.
   */
  readonly water: FxPool;
  readonly mud: FxPool;

  constructor(private readonly scene: Scene) {
    const glow = scene.effectLayers?.find((l) => l.name === "glow") as GlowLayer | undefined;
    this.spikes = new Thorns(scene);
    this.water = new FxPool(scene, WATER_NAME, "streak", "solid", WATER_CAPACITY);
    this.mud = new FxPool(scene, MUD_NAME, "ball", "solid", MUD_CAPACITY);
    for (const pool of [this.water, this.mud]) {
      const wet = pool.mesh.material as StandardMaterial;
      wet.disableLighting = false;
      wet.diffuseColor = new Color3(0.55, 0.55, 0.55);
      wet.emissiveColor = new Color3(0.45, 0.45, 0.45);
      wet.specularColor = new Color3(1, 1, 1);
      wet.specularPower = 40;
    }
    // The char darkens the floor by blending; drawn over it, the molten strip adds light.
    const char = decalMaterial(scene, `${FISSURE_NAME}-char-mat`, new Color3(0.06, 0.03, 0.015));
    char.transparencyMode = Material.MATERIAL_ALPHABLEND;
    char.alpha = 0.62;
    this.scorch = scorchMesh(scene);
    this.scorch.material = char;
    this.scorch.position.y = FISSURE_Y - 0.004;
    glow?.addExcludedMesh(this.scorch);
    for (let i = 0; i < FISSURE_POOL; i++) {
      const molten = fissureMesh(scene, `${FISSURE_NAME}-${i}`);
      const mat = decalMaterial(scene, `${FISSURE_NAME}-${i}-mat`, new Color3(1, 0.55, 0.15));
      mat.alphaMode = 1; // ALPHA_ADD
      molten.material = mat;
      const charMesh = molten.clone(`${FISSURE_NAME}-char-${i}`);
      charMesh.material = char;
      glow?.referenceMeshToUseItsOwnMaterial(molten);
      glow?.addExcludedMesh(charMesh);
      this.fissures.push({ molten, char: charMesh, mat, age: -1, hot: PALETTE.fire.hot, cool: PALETTE.fire.cool });
    }
    // Gold round a white-hot core, both additive: the core reads through the gold.
    const gold = decalMaterial(scene, `${BEAM_NAME}-mat`, new Color3(1, 0.72, 0.28));
    gold.alphaMode = 1; // ALPHA_ADD
    gold.alpha = 0.55;
    const white = decalMaterial(scene, `${BEAM_NAME}-core-mat`, new Color3(1, 0.97, 0.88));
    white.alphaMode = 1; // ALPHA_ADD
    white.alpha = 0.9;
    for (let i = 0; i < BEAM_POOL; i++) {
      const outer = beamMesh(scene, `${BEAM_NAME}-${i}`);
      outer.material = gold;
      const core = outer.clone(`${BEAM_NAME}-core-${i}`);
      core.material = white;
      glow?.referenceMeshToUseItsOwnMaterial(outer);
      glow?.referenceMeshToUseItsOwnMaterial(core);
      this.beams.push({ outer, core, age: -1 });
    }
    // All of it starts disabled, so compile now (behind the loading plate), not on the first landing.
    char.forceCompilation(this.scorch);
    for (const f of this.fissures) f.mat.forceCompilation(f.molten);
    gold.forceCompilation(this.beams[0]!.outer);
    white.forceCompilation(this.beams[0]!.core);
    scene.onBeforeRenderObservable.add(() => this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000)));
  }

  /** Every frame a boss mark is up, `left` seconds from landing, `dt` since the last: a rock falling, the bog stirring. */
  windup(e: SnapshotEntity, left: number, dt: number): void {
    const how = e.ability === undefined ? undefined : BossFx.WINDUPS[e.ability];
    if (how?.falls && left <= FALL_SECONDS && left > 0.02 && !this.falling.has(e.id)) {
      this.falling.add(e.id);
      this.fall(e, left);
    }
    const rate = how?.bubbles?.(left) ?? 0;
    if (rate === 0) return;
    let debt = (this.bubbleDebt.get(e.id) ?? 0) + rate * dt;
    for (; debt >= 1; debt--) this.bubble(e);
    this.bubbleDebt.set(e.id, debt);
  }

  /** A mark left the snapshot, landed or not. */
  forget(id: number): void {
    this.falling.delete(id);
    this.bubbleDebt.delete(id);
  }

  /** A boss mark landed. `from` is where its boss stood, the way the blow travels. */
  land(e: SnapshotEntity, species: string | undefined, from?: { x: number; y: number }): void {
    const look = lookOf(species);
    const how = e.ability === undefined ? undefined : BossFx.LANDINGS[e.ability];
    if (how) how(this, e, look);
    else this.slam(e, look, from);
  }

  /**
   * A boss entering its last phase: its element bursts out of it, a shockwave
   * runs across the floor and dust rises round it.
   */
  phaseThree(boss: { x: number; y: number }, species: string | undefined): void {
    const look = lookOf(species);
    const { hot, cool, flash: light } = PALETTE[look];
    const at = new Vector3(boss.x, 0.9, boss.y);
    const pools = fxPools(this.scene);
    for (const [delay, size] of [[0, 1], [0.12, 0.6]] as const) {
      pools.ring.emit({
        x: boss.x, y: 0.06, z: boss.y, life: 0.6, delay, size, sizeEnd: PHASE_WAVE * 2,
        r: hot[0], g: hot[1], b: hot[2], a: 0.9, r1: cool[0], g1: cool[1], b1: cool[2],
      });
    }
    for (let i = 0; i < PHASE_DUST; i++) {
      const a = ((i + Math.random()) / PHASE_DUST) * Math.PI * 2;
      dustPuff(this.scene, boss.x + Math.cos(a) * PHASE_DUST_AT, boss.y + Math.sin(a) * PHASE_DUST_AT, 1.1, PHASE_DUST_AT / WAVE_SPEED, 1.4);
    }
    if (look === "fire") emberBurst(this.scene, at, PHASE_FIRE);
    else if (light > 0) flash(this.scene, at, light);
    if (look === "thorn") this.nova({ id: -1, kind: "telegraph", x: boss.x, y: boss.y, radius: 2.2 });
    else if (look === "bog") this.drops(boss.x, boss.y, GEYSER_DROPS, 7, 0);
    this.element(at, look, 1.5);
  }

  /** Every live thorn's foot and point, for tests and for nothing else. */
  thorns(): { base: Vector3; tip: Vector3 }[] {
    return this.spikes.points();
  }

  /** Wipe everything standing: a new area starts with an unbroken floor. */
  clear(): void {
    this.spikes.clear();
    this.water.clear();
    this.mud.clear();
    for (const f of this.fissures) {
      f.age = -1;
      f.molten.setEnabled(false);
      f.char.setEnabled(false);
    }
    for (const b of this.beams) {
      b.age = -1;
      b.outer.setEnabled(false);
      b.core.setEnabled(false);
    }
    this.scorchAge = -1;
    this.scorch.setEnabled(false);
    this.falling.clear();
    this.bubbleDebt.clear();
  }

  /** Advance every thorn, fissure, beam and the scorch by `dt` seconds. Driven by the scene; public for tests. */
  step(dt: number): void {
    this.spikes.step(dt);
    for (const b of this.beams) {
      if (b.age < 0) continue;
      b.age += dt;
      if (b.age >= BEAM_SECONDS) {
        b.age = -1;
        b.outer.setEnabled(false);
        b.core.setEnabled(false);
        continue;
      }
      b.outer.visibility = b.core.visibility = Math.min(1, (BEAM_SECONDS - b.age) / BEAM_FADE);
    }
    if (this.scorchAge >= 0) {
      this.scorchAge += dt;
      if (this.scorchAge >= SCORCH_SECONDS) {
        this.scorchAge = -1;
        this.scorch.setEnabled(false);
      } else {
        this.scorch.visibility = Math.min(1, (SCORCH_SECONDS - this.scorchAge) / SCORCH_FADE);
      }
    }
    for (const f of this.fissures) {
      if (f.age < 0) continue;
      f.age += dt;
      const t = f.age / FISSURE_SECONDS;
      if (t >= 1) f.molten.setEnabled(false);
      else {
        // Cools toward its dark colour and dims as it goes: lava skinning over.
        const k = (1 - t) ** 1.5;
        const c = Math.sqrt(t);
        f.mat.emissiveColor.set(
          (f.hot[0] + (f.cool[0] - f.hot[0]) * c) * k,
          (f.hot[1] + (f.cool[1] - f.hot[1]) * c) * k,
          (f.hot[2] + (f.cool[2] - f.hot[2]) * c) * k,
        );
      }
      if (f.age >= CHAR_SECONDS) {
        f.age = -1;
        f.char.setEnabled(false);
        continue;
      }
      f.char.visibility = f.age < FISSURE_SECONDS ? 1 : 1 - (f.age - FISSURE_SECONDS) / (CHAR_SECONDS - FISSURE_SECONDS);
    }
  }

  /** Lay a fissure from (x, z) along (dx, dz), `length` long and `width` wide either side. */
  private fissure(x: number, z: number, dx: number, dz: number, length: number, width: number, look: Look): void {
    const f = this.fissures[this.nextFissure]!;
    this.nextFissure = (this.nextFissure + 1) % FISSURE_POOL;
    f.age = 0;
    f.hot = PALETTE[look].hot;
    f.cool = PALETTE[look].cool;
    f.mat.emissiveColor.set(f.hot[0], f.hot[1], f.hot[2]);
    for (const [mesh, y] of [[f.molten, FISSURE_Y], [f.char, FISSURE_Y - 0.004]] as const) {
      mesh.position.set(x, y, z);
      mesh.rotation.y = Math.atan2(dx, dz);
      // Mirrored half the time: four strips read as many more.
      mesh.scaling.set(Math.random() < 0.5 ? -width : width, 1, length);
      mesh.visibility = 1;
      mesh.setEnabled(true);
    }
  }

  /**
   * Magma Rift: the floor splits from the Warden's feet to the lane's end, flame
   * erupting along it outward from him, rock thrown up the way it runs.
   */
  private rift(e: SnapshotEntity, look: Look): void {
    const length = e.length ?? 0;
    const half = e.radius ?? 0.5;
    const dx = e.dirX ?? 0;
    const dz = e.dirY ?? 1;
    const { hot, cool, flash: light } = PALETTE[look];
    this.fissure(e.x, e.y, dx, dz, length + half * 0.6, half * 0.5, look);
    const pools = fxPools(this.scene);
    for (let d = 0.4; d < length + half * 0.3; d += RIFT_STEP) {
      const side = rand(-0.6, 0.6) * half;
      const x = e.x + dx * d + dz * side;
      const z = e.y + dz * d - dx * side;
      const delay = d / RIFT_SPEED;
      pools.glow.emit({
        x, y: 0.15, z, vy: rand(1.5, 3), drag: 2, life: rand(0.3, 0.5), delay, size: 0.35, sizeEnd: rand(0.8, 1.2),
        r: hot[0], g: hot[1], b: hot[2], a: 0.85, r1: cool[0], g1: cool[1], b1: cool[2],
      });
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2;
        pools.shards.emit({
          x, y: 0.2, z, vx: Math.cos(a) * rand(0.5, 1.5), vy: rand(3, 6), vz: Math.sin(a) * rand(0.5, 1.5),
          gravity: -6, drag: 0.8, life: rand(0.5, 0.9), delay, size: 0.12, thick: 0.025, stretch: 0.03,
          r: hot[0], g: hot[1], b: hot[2], a: 1, r1: cool[0], g1: cool[1], b1: cool[2],
        });
      }
    }
    const mid = new Vector3(e.x + dx * length / 2, 0, e.y + dz * length / 2);
    slamDebris(this.scene).emit(mid, dx, dz);
    if (light > 0) flash(this.scene, mid, light);
  }

  /**
   * Bramble Charge: thorns thrust up the lane row by row at his own dash speed,
   * each leaning out from the line he runs, and dust kicks up behind him.
   */
  private charge(e: SnapshotEntity): void {
    const length = e.length ?? 0;
    const half = e.radius ?? 0.5;
    const dx = e.dirX ?? 0;
    const dz = e.dirY ?? 1;
    for (let d = 0.5; d < length + half * 0.5; d += CHARGE_ROW) {
      const delay = d / CHARGE_SPEED;
      for (const sign of [-1, 1]) {
        const side = sign * rand(0.1, 0.85) * half;
        // Out from the line, and a little the way he runs.
        const ox = dz * sign + dx * 0.4;
        const oz = -dx * sign + dz * 0.4;
        this.spikes.emit(e.x + dx * d + dz * side, e.y + dz * d - dx * side, rand(0.7, 1.4), rand(0.16, 0.26),
          rand(0.15, 0.5), Math.atan2(oz, ox), delay + rand(0, 0.03));
      }
      if (Math.random() < 0.35) dustPuff(this.scene, e.x + dx * d, e.y + dz * d, 0.8, delay + 0.05, 0.6);
    }
  }

  /** Briar Nova: rings of thorns burst out round Ghaltrek, leaning away from him, and throw bark. */
  private nova(e: SnapshotEntity): void {
    const reach = e.radius ?? 1;
    for (const share of NOVA_RINGS) {
      const r = reach * share;
      const n = Math.max(6, Math.round((2 * Math.PI * r) / NOVA_SPACING));
      const turn = Math.random();
      for (let j = 0; j < n; j++) {
        const a = ((j + turn + rand(-0.2, 0.2)) / n) * Math.PI * 2;
        this.spikes.emit(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, rand(0.8, 1.5) * (1.1 - 0.25 * share),
          rand(0.18, 0.28), rand(0.25, 0.6), a, r / NOVA_SPEED);
      }
    }
    slamDebris(this.scene).emit(new Vector3(e.x, 0, e.y), Math.random() - 0.5, Math.random() - 0.5, NOVA_RUBBLE);
    this.element(new Vector3(e.x, 0.3, e.y), "thorn", 0.6);
  }

  /** One bubble breaking the surface somewhere in a bog mark. */
  private bubble(e: SnapshotEntity): void {
    const r = Math.sqrt(Math.random()) * (e.radius ?? 1) * 0.75;
    const a = Math.random() * Math.PI * 2;
    fxPools(this.scene).smoke.emit({
      x: e.x + Math.cos(a) * r, y: 0.08, z: e.y + Math.sin(a) * r, vy: rand(0.3, 0.7), drag: 2,
      life: rand(0.3, 0.5), size: rand(0.06, 0.1), sizeEnd: rand(0.14, 0.22),
      r: 0.36, g: 0.4, b: 0.26, a: 0.6, r1: BOG_WATER[0], g1: BOG_WATER[1], b1: BOG_WATER[2],
    });
  }

  /** Drops of bog water thrown out of (x, z), arcing back down. */
  private drops(x: number, z: number, n: number, speed: number, delay: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = rand(0.8, 2.2);
      this.water.emit({
        x, y: 0.2, z, vx: Math.cos(a) * out, vy: speed * rand(0.6, 1), vz: Math.sin(a) * out, gravity: -12,
        life: rand(0.55, 0.85), delay: delay + rand(0, 0.08), size: 0.16, thick: 0.05, stretch: 0.035,
        r: FOAM[0], g: FOAM[1], b: FOAM[2], a: 0.9, r1: MURK[0], g1: MURK[1], b1: MURK[2],
      });
    }
  }

  /** A ring of murky water spreading on the floor. */
  private ripple(e: SnapshotEntity, reach: number): void {
    fxPools(this.scene).ring.emit({
      x: e.x, y: 0.06, z: e.y, life: 0.45, size: 0.4, sizeEnd: reach * 2,
      r: 0.4, g: 0.46, b: 0.3, a: 0.6, r1: BOG_WATER[0], g1: BOG_WATER[1], b1: BOG_WATER[2],
    });
  }

  /** Bog Geyser: a jet of water bursts straight up out of the marker, its crown sprays back down round it and rings out. */
  private geyser(e: SnapshotEntity): void {
    for (let i = 0; i < GEYSER_JET; i++) {
      // Stacked by launch time: the first out is the top of the column.
      this.water.emit({
        x: e.x + rand(-0.22, 0.22), y: 0.1, z: e.y + rand(-0.22, 0.22), vx: rand(-0.2, 0.2), vy: rand(11, 14), vz: rand(-0.2, 0.2),
        gravity: -12, drag: 0.2, life: rand(0.75, 0.95), delay: (i / GEYSER_JET) * 0.22,
        size: rand(0.5, 0.8), thick: rand(0.06, 0.11), stretch: 0.05,
        r: FOAM[0], g: FOAM[1], b: FOAM[2], a: 0.8, r1: MURK[0], g1: MURK[1], b1: MURK[2],
      });
    }
    for (let i = 0; i < GEYSER_SPRAY; i++) {
      const a = ((i + Math.random()) / GEYSER_SPRAY) * Math.PI * 2;
      const out = rand(1.5, 3.2);
      // Out of the top as the jet gets there, then down round the marker.
      this.water.emit({
        x: e.x, y: rand(2.2, 3.2), z: e.y, vx: Math.cos(a) * out, vy: rand(1, 3), vz: Math.sin(a) * out,
        gravity: -12, life: rand(0.7, 1), delay: rand(0.22, 0.35), size: 0.14, thick: 0.05, stretch: 0.04,
        r: FOAM[0], g: FOAM[1], b: FOAM[2], a: 0.9, r1: MURK[0], g1: MURK[1], b1: MURK[2],
      });
    }
    this.drops(e.x, e.y, GEYSER_DROPS, 6, 0.1);
    this.ripple(e, (e.radius ?? 1) * 1.2);
  }

  /** The brood rising: a splash, its drops and a ring out of the mark. */
  private splash(e: SnapshotEntity): void {
    this.drops(e.x, e.y, SPLASH_DROPS, 3.5, 0);
    this.ripple(e, (e.radius ?? 1) * 1.3);
  }

  /** A burning rock and its fire trail, timed to reach the marker's floor as it lands. */
  private fall(e: SnapshotEntity, left: number): void {
    const { hot, cool } = PALETTE.fire;
    const sx = rand(-FALL_SLANT, FALL_SLANT);
    const sz = rand(-FALL_SLANT, FALL_SLANT);
    const v = { vx: -sx / left, vy: -FALL_HEIGHT / left, vz: -sz / left };
    const pools = fxPools(this.scene);
    pools.glow.emit({
      x: e.x + sx, y: FALL_HEIGHT, z: e.y + sz, ...v, life: left + 0.03, size: 0.55, sizeEnd: 0.45,
      r: 1, g: 0.85, b: 0.55, a: 0.95, r1: hot[0], g1: hot[1], b1: hot[2],
    });
    pools.shards.emit({
      x: e.x + sx, y: FALL_HEIGHT, z: e.y + sz, ...v, life: left + 0.03, size: 0.9, thick: 0.16, stretch: 0.04,
      r: hot[0], g: hot[1], b: hot[2], a: 0.9, r1: cool[0], g1: cool[1], b1: cool[2],
    });
  }

  /** Cinder Rain landing: a fireball, a small crater of rubble and a shockwave the marker's size. */
  private meteor(e: SnapshotEntity): void {
    const at = new Vector3(e.x, 0.3, e.y);
    emberBurst(this.scene, at, METEOR_FX);
    const a = Math.random() * Math.PI * 2;
    slamDebris(this.scene).emit(new Vector3(e.x, 0, e.y), Math.cos(a), Math.sin(a), METEOR_RUBBLE);
    const { hot, cool } = PALETTE.fire;
    fxPools(this.scene).ring.emit({
      x: e.x, y: 0.06, z: e.y, life: 0.3, size: 0.4, sizeEnd: (e.radius ?? 1) * 2,
      r: hot[0], g: hot[1], b: hot[2], a: 0.8, r1: cool[0], g1: cool[1], b1: cool[2],
    });
  }

  /**
   * Sunlance: a beam of sunlight stands on the whole lane for a moment, white at
   * its core, throws sparks off both sides and leaves a scorch line.
   */
  private lance(e: SnapshotEntity, look: Look): void {
    const length = e.length ?? 0;
    const half = e.radius ?? 0.5;
    const dx = e.dirX ?? 0;
    const dz = e.dirY ?? 1;
    const { hot, cool, flash: light } = PALETTE[look];
    const mid = new Vector3(e.x + dx * length / 2, 0, e.y + dz * length / 2);
    const b = this.beams[this.nextBeam]!;
    this.nextBeam = (this.nextBeam + 1) % BEAM_POOL;
    b.age = 0;
    for (const [mesh, share] of [[b.outer, 1], [b.core, BEAM_CORE]] as const) {
      mesh.position.copyFrom(mid);
      mesh.rotation.y = Math.atan2(dx, dz);
      mesh.scaling.set(half * 2 * share, BEAM_HEIGHT, length + half);
      mesh.visibility = 1;
      mesh.setEnabled(true);
    }
    this.fissure(e.x, e.y, dx, dz, length + half * 0.5, half * 0.4, look);
    const pools = fxPools(this.scene);
    for (let i = 0; i < LANCE_SPARKS; i++) {
      const d = Math.random() * length;
      const side = Math.random() < 0.5 ? -1 : 1;
      const out = rand(2, 5);
      pools.shards.emit({
        x: e.x + dx * d, y: 0.2, z: e.y + dz * d,
        vx: dz * side * out, vy: rand(2, 5), vz: -dx * side * out, gravity: -7, drag: 1,
        life: rand(0.3, 0.6), size: 0.18, thick: 0.025, stretch: 0.03,
        r: hot[0], g: hot[1], b: hot[2], a: 1, r1: cool[0], g1: cool[1], b1: cool[2],
      });
    }
    if (light > 0) flash(this.scene, mid, light);
  }

  /**
   * Kiln Ring: flame rises across the whole band at once and sparks fly off its
   * rim; the band is left scorched round a bare hole, where standing was safe.
   */
  private kiln(e: SnapshotEntity, look: Look): void {
    const outer = e.radius ?? 1;
    const inner = Math.min(e.inner ?? 0, outer * 0.95);
    const { hot, cool, flash: light } = PALETTE[look];
    shapeScorch(this.scorch, inner / outer);
    this.scorch.position.x = e.x;
    this.scorch.position.z = e.y;
    this.scorch.scaling.set(outer, 1, outer);
    this.scorch.visibility = 1;
    this.scorch.setEnabled(true);
    this.scorchAge = 0;
    const pools = fxPools(this.scene);
    for (let i = 0; i < KILN_FLAMES; i++) {
      // Even over the band's area, not its width: the outer edge is the longer one.
      const r = Math.sqrt(rand(inner * inner, outer * outer));
      const a = Math.random() * Math.PI * 2;
      pools.glow.emit({
        x: e.x + Math.cos(a) * r, y: 0.15, z: e.y + Math.sin(a) * r, vy: rand(2, 4), drag: 2.2,
        life: rand(0.4, 0.6), delay: rand(0, 0.08), size: 0.4, sizeEnd: rand(0.8, 1.2),
        r: hot[0], g: hot[1], b: hot[2], a: 0.85, r1: cool[0], g1: cool[1], b1: cool[2],
      });
    }
    for (let i = 0; i < KILN_SPARKS; i++) {
      const a = ((i + Math.random()) / KILN_SPARKS) * Math.PI * 2;
      const out = rand(3, 6);
      pools.shards.emit({
        x: e.x + Math.cos(a) * outer, y: 0.3, z: e.y + Math.sin(a) * outer,
        vx: Math.cos(a) * out, vy: rand(1.5, 4), vz: Math.sin(a) * out, gravity: -6, drag: 1,
        life: rand(0.35, 0.7), size: 0.16, thick: 0.025, stretch: 0.03,
        r: hot[0], g: hot[1], b: hot[2], a: 1, r1: cool[0], g1: cool[1], b1: cool[2],
      });
    }
    pools.ring.emit({
      x: e.x, y: 0.06, z: e.y, life: 0.45, size: outer * 1.8, sizeEnd: outer * 2.3,
      r: hot[0], g: hot[1], b: hot[2], a: 0.8, r1: cool[0], g1: cool[1], b1: cool[2],
    });
    if (light > 0) flash(this.scene, new Vector3(e.x, 0, e.y), light);
  }

  private slam(e: SnapshotEntity, look: Look, from?: { x: number; y: number }): void {
    const { hot, cool, flash: light } = PALETTE[look];
    const r = e.radius ?? 2;
    const at = new Vector3(e.x, 0.15, e.y);
    if (light > 0) flash(this.scene, at, light);
    fxPools(this.scene).ring.emit({
      x: e.x, y: 0.06, z: e.y, life: 0.4, size: 0.6, sizeEnd: r * 2,
      r: hot[0], g: hot[1], b: hot[2], a: 0.9, r1: cool[0], g1: cool[1], b1: cool[2],
    });
    // The rubble flies on from the boss, the way the blow came down.
    const away = from ? { x: e.x - from.x, z: e.y - from.y } : { x: Math.random() - 0.5, z: Math.random() - 0.5 };
    slamDebris(this.scene).emit(new Vector3(e.x, 0, e.y), away.x, away.z);
    for (let i = 0; i < RIM_DUST; i++) {
      const a = ((i + Math.random()) / RIM_DUST) * Math.PI * 2;
      dustPuff(this.scene, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, 0.9, r / WAVE_SPEED, 1);
    }
    this.element(at, look, 1, r);
  }

  /** What the boss's element throws out of a landing at `at`, scaled by `k`; a bog crown reaches toward `reach`. */
  private element(at: Vector3, look: Look, k: number, reach = 3): void {
    const pools = fxPools(this.scene);
    const { hot, cool } = PALETTE[look];
    if (look === "bog") {
      // A crown of mud and bog water thrown up and out of the blow: the mud reads
      // on sand, the pale water on the dark fen.
      const n = Math.round(MUD_CROWN * k);
      for (let i = 0; i < n; i++) {
        const a = ((i + Math.random()) / n) * Math.PI * 2;
        const out = rand(0.5, 1.1) * reach * k;
        const mud = i % 3 !== 0;
        const [c, c1] = mud ? [MUD, MUD_DRY] : [FOAM, MURK];
        (mud ? this.mud : this.water).emit({
          x: at.x + Math.cos(a) * 0.3, y: 0.15, z: at.z + Math.sin(a) * 0.3, vx: Math.cos(a) * out, vy: rand(4, 7) * k, vz: Math.sin(a) * out,
          gravity: -13, drag: 0.4, life: rand(0.6, 0.9), size: mud ? rand(0.12, 0.24) : 0.14, sizeEnd: mud ? rand(0.09, 0.16) : 0.14,
          thick: 0.05, stretch: 0.04, r: c[0], g: c[1], b: c[2], a: 0.95, r1: c1[0], g1: c1[1], b1: c1[2],
        });
      }
      return;
    }
    if (look === "stone") return;
    const slow = look === "thorn";
    for (let i = 0; i < Math.round(ELEMENT_SPARKS * k); i++) {
      const a = Math.random() * Math.PI * 2;
      const out = (slow ? rand(0.8, 2.2) : rand(1.5, 4.5)) * k;
      pools.shards.emit({
        x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * out, vy: (slow ? rand(1, 2.5) : rand(3, 7)) * k, vz: Math.sin(a) * out,
        gravity: slow ? -1.5 : -6, drag: slow ? 1.8 : 0.9, life: rand(0.5, 1.1), size: 0.14, thick: 0.03, stretch: 0.03,
        r: hot[0], g: hot[1], b: hot[2], a: 1, r1: cool[0], g1: cool[1], b1: cool[2],
      });
    }
  }
}

const fx = new WeakMap<Scene, BossFx>();

/** The scene's boss effects, built on first use. */
export function bossFx(scene: Scene): BossFx {
  let b = fx.get(scene);
  if (!b) {
    b = new BossFx(scene);
    fx.set(scene, b);
    scene.onDisposeObservable.addOnce(() => fx.delete(scene));
  }
  return b;
}

/** Wipe a scene's boss effects, if it has any. */
export function clearBossFx(scene: Scene): void {
  fx.get(scene)?.clear();
}

/** Build every boss effect behind the loading plate, so the first landing costs no shader compile. */
export function warmBossFx(scene: Scene): void {
  bossFx(scene);
}
