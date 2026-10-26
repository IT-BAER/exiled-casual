import {
  Color3,
  Color4,
  Constants,
  FresnelParameters,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  ParticleSystem,
  ShaderStore,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AnimationGroup,
  type AssetContainer,
  type InstantiatedEntries,
  type Material,
  type Scene,
  type UniformBuffer,
} from "@babylonjs/core";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
// The nebula shader is derived from this one, which Babylon otherwise loads lazily.
import "@babylonjs/core/Shaders/particles.fragment";
import { standGroundBlob } from "./meshes";
import { warmContainer } from "./warm-shaders";

/**
 * The companion cat: PoE1's Celestial Cat Pet, its motion recreated from PoE's
 * own floating clips (assets/pets/SOURCE.md). Moving, it gallops IN THE AIR
 * beside the player, PoE's nebula, wisps and sparks left behind it. Standing,
 * it hovers at his hip with its legs hanging, and at the end of each hover cycle
 * PoE's controller rolls its relaxed idle: a swim up over him and round, a ball
 * chasing its tail, uncurled back into the hover. It drops in somersaulting when
 * it arrives. It never sinks under the hover: the owner's rule, kept by the
 * build. Cosmetic and client-only: the sim never hears of it, so replay
 * checksums and the protocol are untouched.
 *
 * `tools/build_pet.py` puts the body and its four clips into `pet.glb`, each
 * carrying PoE's root path with its height above the ground, so the root here
 * stands ON the ground; this is the runtime half. The follow is a critically
 * damped spring to a spot behind and beside the player, pure arithmetic in
 * `stepFollow`; `PetActor` hangs the glTF on a root and plays the clip PoE's
 * controller would. Failure to load is not fatal: the actor simply has no body.
 */
export const PET_URL = "/models/pet.glb";
export const PET_ID = "pet.cat.v1";
/** PoE's idle_floating, run_floating, idle_relaxed_floating, happy_floating. */
export const PET_CLIPS = ["hover", "gallop", "relaxed", "emerge"] as const;
export type PetClip = (typeof PET_CLIPS)[number];
/** Everything the viewer can ask for: each clip, repeating. */
export const PET_ACTIONS = PET_CLIPS;
export type PetAction = PetClip;
export const CLIP_SECONDS: Record<PetClip, number> = { hover: 2.0, gallop: 1.2, relaxed: 14.67, emerge: 3.0 };
/** The body's middle on PoE's own skeleton (mid back), where the ground blob sits under it. */
export const ANCHOR_BONE = "spine1";
const LOOPED: readonly PetClip[] = ["hover", "gallop"];
/** PoE's idle_relaxed_chance: the roll at the end of every hover cycle while he stands. */
export const RELAXED_CHANCE = 0.25;

export const FOLLOW = {
  /** Units behind the player along his heading. */
  behind: 1.4,
  /** Units to the side of his line of travel, so he never walks through it. */
  beside: 0.9,
  /** Spring rate per second; critically damped. */
  rate: 6,
  /** Inside this of its spot it stops correcting, so it rests rather than hunts. */
  deadZone: 0.4,
  /** A full-speed catch-up, units per second. */
  dash: 4,
  /** Own speed above which it gallops; it hovers again below `gallopEnd`. */
  gallop: 1.2,
  gallopEnd: 0.8,
  /** Further than this from its spot it is simply put there: a portal, a Blink. */
  teleport: 12,
} as const;

/** Yaw chase rate per second. */
const TURN_RATE = 8;
/** Below this own speed it faces where the player faces. */
const FACING_SPEED = 0.3;
/** Below this the player is standing, in units per second. */
const PLAYER_STILL = 0.1;

/** A seeded uniform [0, 1) (mulberry32): the relaxed roll replays in tests. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The rim halo: PoE's HighlightEdges rgb (0.02, 0.02, 0.045), its hue kept and
 * its blue lifted to 0.5. PoE's own level would vanish under our tone map; the
 * lift is ours, judged in game.
 */
const HALO_COLOR = new Color3((0.5 * 0.02) / 0.045, (0.5 * 0.02) / 0.045, 0.5);

export const PET_COAT_PLUGIN = "ExiledPetCoat";
/** PoE's coat: `space_bg_at` through ProjectiveUV_Accurate(1.2, 512, 512), ScaleMoveUV tiling 0.8, DarkenTex 0.3625. */
const COAT = { texture: "/textures/fx/pet/starfield.webp", repeatPx: 512 * 1.2, tiling: 0.8, drift: 0.01, darken: 0.3625, fur: 0.4 } as const;

/**
 * The cat's coat as PoE draws it: its glow is the starfield sampled in SCREEN
 * space, so the stars hold still on the screen while the cat moves under them,
 * a window onto one sky. It replaces the coat's own emissive; albedo and
 * lighting stay. Reading DarkenTex as a gain in linear light is inferred.
 */
class PetCoatPlugin extends MaterialPluginBase {
  stars: Texture | null = null;
  time = 0;

  constructor(material: Material) {
    super(material, PET_COAT_PLUGIN, 230, {});
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName(): string {
    return PET_COAT_PLUGIN;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("coatStars");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [{ name: "coatProjection", size: 4, type: "vec4" }],
      fragment: `
        uniform vec4 coatProjection;
      `,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const perPixel = (COAT.tiling * 1080) / (COAT.repeatPx * scene.getEngine().getRenderHeight());
    ubo.updateFloat4("coatProjection", perPixel, perPixel, this.time * COAT.drift, this.time * COAT.drift);
    ubo.setTexture("coatStars", this.stars);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        uniform sampler2D coatStars;
      `,
      // The fur texture lit read as a grey cat; PoE's is near black (owner's call, 25 October 2026).
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        surfaceAlbedo *= ${COAT.fur.toFixed(3)};
      `,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
        finalEmissive = toLinearSpace(texture2D(coatStars, gl_FragCoord.xy * coatProjection.xy + coatProjection.zw).rgb)
          * ${COAT.darken.toFixed(4)} * vLightingIntensity.y;
      `,
    };
  }
}

/** One PoE pet unit in ours: a Marauder's 190.8 is our 1.81, and the pet stands at PoE's scale 90. */
export const POE_UNIT = (1.81 / 190.8) * 0.9;

/**
 * One of PoE's particle emitters, as its `.pet` file states it in PoE units and
 * seconds. Born along the bone group `mid` (head to tail tip). Read as: size
 * `scale` grows start to end with up to `sizeVar` added, times `emitScale`;
 * `opacity` keys spread evenly over the life; `up` is vertical speed start to
 * end, `along` the [min, max] of a speed (averaged over the life where PoE
 * eases it) in a random direction inside a cone `cone` wide about +Y (negative
 * flies the other way); `accel` is vertical. These readings of PoE's fields are
 * inferred, not documented.
 */
export interface AuraEmitter {
  name: string;
  texture: string;
  blend: "add" | "alpha";
  rate: number;
  life: number;
  scale: readonly [number, number];
  sizeVar: number;
  emitScale: number;
  opacity: readonly number[];
  tint?: readonly [number, number, number];
  /** Rides the cat (PoE's "locked to parent"); otherwise left behind as it moves. */
  locked: boolean;
  up: readonly [number, number];
  along: readonly [number, number];
  accel: number;
  cone: number;
  /** Stretched along its velocity (PoE's velocity-oriented sparks). */
  stretched?: boolean;
  /** The nebula drawn in screen space through a cloud mask (PoE's ProjectiveUV). */
  projected?: boolean;
}

const FX = "/textures/fx/pet";
/** PoE's spaaaace.pet and celestial_body.pet, in that order. */
export const AURA: readonly AuraEmitter[] = [
  { name: "fx-pet-wisps", texture: `${FX}/wisp.webp`, blend: "add", rate: 20.87, life: 0.8, scale: [22, 60.6], sizeVar: 47.6,
    emitScale: 0.261, opacity: [0, 0.42, 0.47, 0.32, 0.2, 0.08, 0], locked: false, up: [17, 2.2], along: [2.2, 19.2], accel: 0, cone: Math.PI },
  { name: "fx-pet-swirls", texture: `${FX}/swirl.webp`, blend: "add", rate: 15.65, life: 0.6, scale: [12, 50], sizeVar: 52,
    emitScale: 0.4, opacity: [0.7, 0.89, 0.7], tint: [0.327, 1, 1], locked: false, up: [16, 2.2], along: [18.25, 34.75], accel: 0, cone: Math.PI },
  { name: "fx-pet-violet-glow", texture: `${FX}/glow_violet.webp`, blend: "add", rate: 8.52, life: 1, scale: [150, 189], sizeVar: 27,
    emitScale: 0.739, opacity: [0, 0.0475, 0], locked: true, up: [0, 0], along: [0, 0], accel: 0, cone: Math.PI },
  { name: "fx-pet-nebula", texture: `${FX}/cloud_mask.webp`, blend: "alpha", rate: 51.37, life: 0.3, scale: [57.6, 57.6], sizeVar: 6.5,
    emitScale: 0.72, opacity: [0, 1, 1, 0.63, 0.35, 0.14, 0], locked: false, up: [0, 0], along: [0, 0], accel: 29.95, cone: Math.PI, projected: true },
  { name: "fx-pet-sparkles", texture: `${FX}/starburst.webp`, blend: "add", rate: 6.78, life: 1, scale: [46, 46], sizeVar: 0,
    emitScale: 0.37, opacity: [0, 1, 1, 0], locked: true, up: [0, 0], along: [0, 0], accel: -11.7, cone: Math.PI },
  { name: "fx-pet-nebula-core", texture: `${FX}/cloud_mask.webp`, blend: "alpha", rate: 12.52, life: 1.5, scale: [57.6, 57.6], sizeVar: 6.5,
    emitScale: 0.57, opacity: [0, 1, 1, 1, 1, 1, 0], locked: true, up: [0, 0], along: [0, 0], accel: 14.35, cone: Math.PI, projected: true },
  { name: "fx-pet-blue-glow", texture: `${FX}/glow_blue.webp`, blend: "add", rate: 10, life: 1, scale: [87.6, 87.6], sizeVar: 0,
    emitScale: 1, opacity: [0, 0.058, 0.058, 0], locked: true, up: [0, 0], along: [0, 0], accel: 0, cone: Math.PI },
  { name: "fx-pet-sparks", texture: `${FX}/spark.webp`, blend: "add", rate: 2.26, life: 1, scale: [3, 3], sizeVar: 0,
    emitScale: 1, opacity: [0, 1, 1, 0], locked: false, up: [-0.4, -0.4], along: [-107, -34], accel: 46.1, cone: 1.95, stretched: true },
];
export const PET_FX_NAMES = AURA.map((e) => e.name);

/**
 * The owner's calls over PoE's numbers (25 October 2026: "too fast", "too
 * strong", trails "smoother and shorter", patches "cheap when they appear";
 * 26 October: the aura "slightly stronger", the patches read as smoke).
 * The particles run on PoE's clock slowed AURA_SLOW times, so lives, rates,
 * speeds and pulls stretch together and every shape stays PoE's; each opacity
 * is scaled by AURA_STRENGTH (the nebula patches by PATCH_STRENGTH again) and
 * eased in and out over the whole life by a sine window.
 */
export const AURA_SLOW = 2.5;
export const AURA_STRENGTH = 0.65;
const PATCH_STRENGTH = 0.12;
/** Share of the cat's own velocity a particle left behind carries: its trail is only what the cat outruns. */
export const TRAIL_FOLLOW = 0.85;
const ENVELOPE_KEYS = 9;

/** PoE's opacity keys, evenly spread over the life, read at `t` (0..1). */
function poeOpacity(keys: readonly number[], t: number): number {
  const at = t * (keys.length - 1);
  const i = Math.min(keys.length - 2, Math.floor(at));
  return keys[i]! + (keys[i + 1]! - keys[i]!) * (at - i);
}

/** An emitter's particle size in our units: [min, max] at birth and at death. */
export function auraSize(e: AuraEmitter): { start: [number, number]; end: [number, number] } {
  const k = e.emitScale * POE_UNIT;
  return {
    start: [e.scale[0] * k, (e.scale[0] + e.sizeVar) * k],
    end: [e.scale[1] * k, (e.scale[1] + e.sizeVar) * k],
  };
}
/** The point `u` (0..1) of the way along the polyline `chain` by arc length, into `out`. */
export function pointOnChain(chain: readonly Vector3[], u: number, out: Vector3): Vector3 {
  let total = 0;
  for (let i = 1; i < chain.length; i++) total += Vector3.Distance(chain[i - 1]!, chain[i]!);
  let left = Math.min(1, Math.max(0, u)) * total;
  for (let i = 1; i < chain.length; i++) {
    const leg = Vector3.Distance(chain[i - 1]!, chain[i]!);
    if (left <= leg && leg > 0) return Vector3.LerpToRef(chain[i - 1]!, chain[i]!, left / leg, out);
    left -= leg;
  }
  return out.copyFrom(chain[chain.length - 1]!);
}

/** PoE's bone group `mid`, head to tail tip: the polyline every aura particle is born on. */
export const MID_CHAIN = [
  "head", "neck", "spine2", "spine4", "spine1", "spine3", "spine", "root",
  "phys_tail_01", "phys_tail_02", "phys_tail_03", "phys_tail_04", "phys_tail_05",
] as const;

/**
 * The particle shader with its colour taken from the nebula in SCREEN space
 * (PoE's ProjectiveUV) and its alpha from the cloud mask on the quad, so the
 * cloud is a window onto one sky rather than a picture stuck on a card.
 */
const NEBULA_SHADER = "petNebula";
const NEBULA_TEX = `${FX}/nebula.webp`;
/** One nebula repeat spans this many screen pixels at 1080p (PoE's tiling 1 over 512). */
const NEBULA_REPEAT_PX = 512;
/** Repeats per second: a tenth of PoE's ScaleMoveUV (0.2, 0.12), which the owner found too fast. */
const NEBULA_DRIFT = [0.02, 0.012] as const;
function registerNebulaShader(): void {
  const name = `${NEBULA_SHADER}PixelShader`;
  if (ShaderStore.ShadersStore[name]) return;
  const base = ShaderStore.ShadersStore["particlesPixelShader"]!;
  const colour = "vec4 baseColor=(textureColor*textureMask+(vec4(1.,1.,1.,1.)-textureMask))*vColor;";
  if (!base.includes(colour)) throw new Error("pet nebula: Babylon's particle shader changed");
  ShaderStore.ShadersStore[name] = base
    .replace("uniform sampler2D diffuseSampler;", "uniform sampler2D diffuseSampler;uniform sampler2D nebulaSampler;uniform vec4 nebulaProjection;")
    .replace(colour, "vec4 baseColor=vec4(texture2D(nebulaSampler,gl_FragCoord.xy*nebulaProjection.xy+nebulaProjection.zw).rgb,textureColor.r*textureColor.r)*vColor;");
}

/** glTF's own wrapper node; an instance is parented *with* it (see monsters.ts). */
const GLTF_ROOT = "__root__";

interface Loaded { scene: Scene; container: AssetContainer }
let loaded: Loaded | null = null;
let pending: { scene: Scene; promise: Promise<void> } | null = null;

/** Fetch the cat once per scene; never awaited by the loading plate. */
export function loadPet(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();
  if (pending?.scene === scene) return pending.promise;
  const prior = pending?.promise ?? Promise.resolve();
  const promise = prior
    .catch(() => undefined)
    .then(() => (loaded?.scene === scene ? undefined : LoadAssetContainerAsync(PET_URL, scene)))
    .then(async (container) => {
      if (container === undefined) return;
      loaded = { scene, container };
      await warmContainer(container);
    })
    .catch(() => {
      loaded = null;
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null;
    });
  pending = { scene, promise };
  return promise;
}

export function isPetReady(scene: Scene): boolean {
  return loaded !== null && loaded.scene === scene;
}

export function resetPet(): void {
  loaded = null;
  pending = null;
}

// --------------------------------------------------------------------------
// the follow, as arithmetic
// --------------------------------------------------------------------------

export interface FollowState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Renderer convention: `atan2(dx, dz)`. */
  yaw: number;
}

/** The spot the cat wants: behind the player and off to one side of his travel. */
export function followTarget(px: number, pz: number, hx: number, hz: number): { x: number; z: number } {
  const len = Math.hypot(hx, hz) || 1;
  const dx = hx / len;
  const dz = hz / len;
  return {
    x: px - dx * FOLLOW.behind - dz * FOLLOW.beside,
    z: pz - dz * FOLLOW.behind + dx * FOLLOW.beside,
  };
}

/** One step of the spring. Returns the cat's own speed after the step. */
export function stepFollow(s: FollowState, dt: number, px: number, pz: number, hx: number, hz: number): number {
  const t = followTarget(px, pz, hx, hz);
  let dx = t.x - s.x;
  let dz = t.z - s.z;
  const dist = Math.hypot(dx, dz);
  if (dist > FOLLOW.teleport) {
    s.x = t.x;
    s.z = t.z;
    s.vx = s.vz = 0;
    s.yaw = Math.atan2(hx, hz);
    return 0;
  }
  // Inside the dead zone the spring pulls at nothing: damping alone brings it to rest.
  if (dist < FOLLOW.deadZone) dx = dz = 0;
  const w = FOLLOW.rate;
  s.vx += (w * w * dx - 2 * w * s.vx) * dt;
  s.vz += (w * w * dz - 2 * w * s.vz) * dt;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const speed = Math.hypot(s.vx, s.vz);
  const want = speed > FACING_SPEED ? Math.atan2(s.vx, s.vz) : Math.atan2(hx, hz);
  let turn = want - s.yaw;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  s.yaw += turn * Math.min(1, TURN_RATE * dt);
  return speed;
}

// --------------------------------------------------------------------------
// the actor
// --------------------------------------------------------------------------

export class PetActor {
  /** Carries the body on the ground at its spot; the renderer never touches it. */
  readonly root: Mesh;
  /** Carries the ground blob at y 0 under the body. */
  private readonly ground: Mesh;
  /** Rides the body's middle (ANCHOR_BONE) in root space: the ground blob sits under it. */
  private readonly anchor: Mesh;
  private middle: TransformNode | null = null;
  /** The MID_CHAIN bones, and their last drawn positions in root space. */
  private chainNodes: TransformNode[] = [];
  private readonly chain: Vector3[] = MID_CHAIN.map(() => new Vector3());
  private nebulaTexture: Texture | null = null;
  /** Seconds the aura has run, for the nebula's drift. */
  private fxTime = 0;
  private readonly inverse = new Matrix();
  private readonly turn = new Matrix();
  private entries: InstantiatedEntries | null = null;
  private halo: Mesh | null = null;
  private coat: PetCoatPlugin | null = null;
  /** The clips by name, for the viewer's timeline. */
  readonly clipGroups = new Map<PetClip, AnimationGroup>();
  private current: PetClip | null = null;
  /** Seconds into the current clip; a hover counts its cycles from it. */
  private clipT = 0;
  /** The viewer's action, or null in play. */
  private previewed: PetAction | null = null;
  private fx: ParticleSystem[] = [];
  private readonly follow: FollowState = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0 };
  private speed = 0;
  private placed = false;
  private lastPlayer: { x: number; z: number } | null = null;
  private shown = true;
  private readonly roll: () => number;

  constructor(
    private readonly scene: Scene,
    seed = Math.floor(Math.random() * 4294967296),
  ) {
    this.roll = seeded(seed);
    this.root = new Mesh("pet-root", scene);
    this.root.isPickable = false;
    this.anchor = new Mesh("pet-anchor", scene);
    this.anchor.isPickable = false;
    this.anchor.parent = this.root;
    this.ground = new Mesh("pet-ground", scene);
    this.ground.isPickable = false;
    standGroundBlob(scene, this.ground, 0.44, 0.31, "actor");
  }

  /** The clip playing, for tests and the DEV handles. */
  get playing(): PetClip | null {
    return this.current;
  }

  clipNames(): string[] {
    return [...this.clipGroups.keys()];
  }

  /**
   * The asset viewer: start `action` on a cat over the origin, restarting it if
   * it is already running. `previewTick` then carries it with no player to
   * follow: every clip repeats.
   */
  previewAction(action: PetAction): void {
    if (!this.entries) this.attach();
    this.show(true);
    this.previewed = action;
    this.start(action);
    this.previewTick(0);
  }

  previewTick(dt: number): void {
    const action = this.previewed;
    if (action === null) return;
    if (!this.entries) this.attach();
    this.clipT += dt;
    this.fxTime += dt;
    this.place(0, 0, 0);
  }

  /**
   * Once per frame with the player's DRAWN position (the interpolated mesh, not
   * the snapshot) and his heading. `jump` is an area change: the cat is put on
   * its spot and drops in again rather than streaking across the new map to it.
   */
  update(
    dt: number,
    px: number,
    pz: number,
    heading: { x: number; y: number } | undefined,
    alive: boolean,
    jump: boolean,
  ): void {
    if (!this.entries) this.attach();
    const hx = heading?.x ?? 0;
    const hz = heading?.y ?? 1;

    if (!alive) {
      this.show(false);
      return;
    }
    this.show(true);

    if (!this.placed || jump) {
      const t = followTarget(px, pz, hx, hz);
      this.follow.x = t.x;
      this.follow.z = t.z;
      this.follow.vx = this.follow.vz = 0;
      this.follow.yaw = Math.atan2(hx, hz);
      this.placed = true;
      this.lastPlayer = null;
      this.start("emerge");
    }
    const playerSpeed = this.lastPlayer ? Math.hypot(px - this.lastPlayer.x, pz - this.lastPlayer.z) / dt : 0;
    this.lastPlayer = { x: px, z: pz };

    this.speed = stepFollow(this.follow, dt, px, pz, hx, hz);
    this.clipT += dt;
    const travelling = this.speed > (this.current === "gallop" ? FOLLOW.gallopEnd : FOLLOW.gallop);
    if (travelling) {
      // PoE's run cuts any idle short.
      if (this.current !== "gallop") this.start("gallop");
    } else if (this.current === "gallop" || this.current === null) {
      this.start("hover");
    } else if (this.clipT >= CLIP_SECONDS[this.current]) {
      // A hover cycle or a one-shot ended: PoE's controller rolls its relaxed idle
      // on every idle cycle while he stands.
      if (this.current === "hover" && playerSpeed < PLAYER_STILL && this.roll() < RELAXED_CHANCE) this.start("relaxed");
      else if (this.current === "hover") this.clipT -= CLIP_SECONDS.hover;
      else this.start("hover");
    }
    this.fxTime += dt;
    this.place(this.follow.x, this.follow.z, this.follow.yaw);
  }

  /** Put the root on the ground at (x, z), the aura's chain on the pose and the ground blob under the body. */
  private place(x: number, z: number, yaw: number): void {
    // The body's middle and its head-to-tail chain in root space, from the last
    // drawn pose: the clip moves them over the root (PoE's root motion).
    this.root.getWorldMatrix().invertToRef(this.inverse);
    if (this.middle) {
      this.middle.computeWorldMatrix();
      Vector3.TransformCoordinatesToRef(this.middle.getAbsolutePosition(), this.inverse, this.anchor.position);
    }
    for (const [i, node] of this.chainNodes.entries()) {
      Vector3.TransformCoordinatesToRef(node.getAbsolutePosition(), this.inverse, this.chain[i]!);
    }
    this.root.position.set(x, 0, z);
    this.root.rotation.x = 0;
    this.root.rotation.y = yaw;
    Matrix.RotationYToRef(yaw, this.turn);
    const under = Vector3.TransformCoordinates(this.anchor.position, this.turn);
    this.ground.position.set(x + under.x, 0, z + under.z);
    if (this.coat) this.coat.time = this.fxTime;
  }

  /** Start `clip` from its first frame; the viewer repeats every clip. */
  private start(clip: PetClip): void {
    this.clipT = 0;
    this.current = clip;
    const group = this.clipGroups.get(clip);
    // No body yet (or no file): attach() starts the choice.
    if (!group) return;
    for (const [name, other] of this.clipGroups) if (name !== clip) other.stop();
    group.stop();
    group.start(LOOPED.includes(clip) || this.previewed !== null, 1);
  }

  private attach(): void {
    if (!loaded || loaded.scene !== this.scene) return;
    const entries = loaded.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    for (const node of entries.rootNodes) {
      node.parent = this.root;
      if (node.name !== GLTF_ROOT) node.name = `${PET_ID}.instance`;
      // The glTF wrapper is itself a Mesh: a click must never land on the cat.
      if (node instanceof Mesh) node.isPickable = false;
      for (const mesh of node.getChildMeshes()) {
        mesh.isPickable = false;
        // A skinned mesh keeps its rest bounds, on the ground under a cat that floats: culled by those, it vanishes.
        if (mesh.skeleton) mesh.alwaysSelectAsActiveMesh = true;
      }
    }
    const bones = entries.rootNodes
      .flatMap((n) => n.getDescendants(false))
      .filter((n): n is TransformNode => n instanceof TransformNode);
    this.middle = bones.find((n) => n.name === ANCHOR_BONE) ?? null;
    this.chainNodes = MID_CHAIN.map((name) => bones.find((n) => n.name === name)).filter((n) => n !== undefined);
    for (const group of entries.animationGroups) {
      const clip = PET_CLIPS.find((c) => group.name.endsWith(`|${c}`));
      if (!clip) {
        group.dispose();
        continue;
      }
      group.enableBlending = true;
      group.blendingSpeed = 0.1;
      this.clipGroups.set(clip, group);
    }
    this.entries = entries;
    const body = entries.rootNodes
      .flatMap((n) => n.getChildMeshes(false))
      .find((m): m is Mesh => m instanceof Mesh && m.name.endsWith(".body"));
    if (body) {
      this.halo = this.buildHalo(body);
      this.coat = this.dressCoat(body);
    }
    this.fx = AURA.map((spec) => this.buildAura(spec));
    // Whatever was decided before the body arrived starts now.
    if (this.current) this.start(this.current);
  }

  /**
   * A second skin of the body on the body's own skeleton, lit only at its rim
   * (fresnel opacity, additive): the violet light that hugs PoE's cat and keeps
   * a black cat readable on a dark floor.
   */
  /** PoE's coat on the body's material, which every cat in the scene shares: dressed once. */
  private dressCoat(body: Mesh): PetCoatPlugin | null {
    const mat = body.material;
    if (!mat) return null;
    // A rough dielectric's sheen under the key light painted the black cat grey; PoE's coat has none.
    if ("metallicF0Factor" in mat) mat.metallicF0Factor = 0;
    // The glow layer draws the material's own emissive, not the plugin's starfield:
    // the painted coat blurred there into grey clouds over the whole cat.
    if ("emissiveTexture" in mat) Object.assign(mat, { emissiveTexture: null, emissiveColor: new Color3(0, 0, 0) });
    const coat = mat.pluginManager?.getPlugin<PetCoatPlugin>(PET_COAT_PLUGIN) ?? new PetCoatPlugin(mat);
    coat.stars ??= new Texture(COAT.texture, this.scene);
    return coat;
  }

  private buildHalo(body: Mesh): Mesh {
    const halo = body.clone(`${PET_ID}.halo`, body.parent);
    halo.skeleton = body.skeleton;
    halo.isPickable = false;
    const mat = new StandardMaterial(`${PET_ID}.halo`, this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = HALO_COLOR;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    // The fresnel term ADDS to alpha, so the base is 0; Babylon's term widens
    // the rim as power grows, so a thin rim wants a power below 1.
    mat.alpha = 0;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.zOffset = -2;
    mat.opacityFresnelParameters = new FresnelParameters({
      leftColor: Color3.White(),
      rightColor: Color3.Black(),
      power: 0.5,
      bias: 0,
    });
    halo.material = mat;
    return halo;
  }

  /**
   * One of PoE's emitters on the cat's root: born at a random point along the
   * posed MID_CHAIN, so the aura follows the clip's every pose. A locked one is
   * born in the root's own space and carried with it; the rest stay where they
   * were born, which is the trail behind a moving cat.
   */
  private buildAura(spec: AuraEmitter): ParticleSystem {
    const ps = new ParticleSystem(spec.name, Math.ceil(spec.rate * spec.life * 1.5) + 4, this.scene);
    ps.emitter = this.root;
    ps.isLocal = spec.locked;
    ps.particleTexture = new Texture(spec.texture, this.scene);
    ps.blendMode = spec.blend === "add" ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.applyFog = true;
    // Babylon steps `updateSpeed` of particle time per 60 Hz frame: one PoE second takes AURA_SLOW real ones.
    ps.updateSpeed = 1 / (60 * AURA_SLOW);
    const [r, g, b] = spec.tint ?? [1, 1, 1];
    const strength = AURA_STRENGTH * (spec.projected ? PATCH_STRENGTH : 1);
    const last = ENVELOPE_KEYS - 1;
    for (let i = 0; i <= last; i++) {
      const t = i / last;
      const a = i === 0 || i === last ? 0 : poeOpacity(spec.opacity, t) * Math.sin(Math.PI * t) * strength;
      ps.addColorGradient(t, new Color4(r, g, b, a));
    }
    const size = auraSize(spec);
    ps.addSizeGradient(0, size.start[0], size.start[1]);
    ps.addSizeGradient(1, size.end[0], size.end[1]);
    ps.minLifeTime = ps.maxLifeTime = spec.life;
    ps.emitRate = spec.rate;
    ps.minEmitPower = ps.maxEmitPower = 1;
    ps.gravity = new Vector3(0, spec.accel * POE_UNIT, 0);
    if (spec.stretched) ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.startPositionFunction = (world: Matrix, position: Vector3, _p, isLocal: boolean): void => {
      pointOnChain(this.chain, Math.random(), position);
      if (!isLocal) Vector3.TransformCoordinatesToRef(position, world, position);
    };
    // The root only ever turns about +Y, so a cone about +Y is the same in its space and the world's.
    const cosEdge = Math.cos(spec.cone / 2);
    const up = ((spec.up[0] + spec.up[1]) / 2) * POE_UNIT;
    ps.startDirectionFunction = (_world: Matrix, direction: Vector3): void => {
      const cos = 1 - Math.random() * (1 - cosEdge);
      const sin = Math.sqrt(1 - cos * cos);
      const turn = Math.random() * Math.PI * 2;
      const speed = (spec.along[0] + Math.random() * (spec.along[1] - spec.along[0])) * POE_UNIT;
      direction.set(sin * Math.cos(turn) * speed, cos * speed + up, sin * Math.sin(turn) * speed);
      // In particle time, so the cat's real velocity is stretched by the same AURA_SLOW.
      if (!spec.locked) {
        const k = TRAIL_FOLLOW * AURA_SLOW;
        direction.addInPlaceFromFloats(this.follow.vx * k, 0, this.follow.vz * k);
      }
    };
    if (spec.projected) this.projectNebula(ps);
    ps.start();
    return ps;
  }

  /** Draw `ps` through the nebula shader: the nebula in screen space, the cloud mask on the quad. */
  private projectNebula(ps: ParticleSystem): void {
    registerNebulaShader();
    this.nebulaTexture ??= new Texture(NEBULA_TEX, this.scene);
    const engine = this.scene.getEngine();
    const defines: string[] = [];
    ps.fillDefines(defines, ps.blendMode);
    const effect = engine.createEffectForParticles(NEBULA_SHADER, ["nebulaProjection"], ["nebulaSampler"], defines.join("\n"), undefined, undefined, undefined, ps);
    ps.setCustomEffect(effect, 0);
    ps.onBeforeDrawParticlesObservable.add((fx) => {
      if (!fx || !this.nebulaTexture) return;
      const perPixel = 1080 / (NEBULA_REPEAT_PX * engine.getRenderHeight());
      fx.setTexture("nebulaSampler", this.nebulaTexture);
      fx.setFloat4("nebulaProjection", perPixel, perPixel, this.fxTime * NEBULA_DRIFT[0], this.fxTime * NEBULA_DRIFT[1]);
    });
  }

  private show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.root.setEnabled(on);
    this.ground.setEnabled(on);
    for (const ps of this.fx) {
      if (on) ps.start();
      else ps.stop();
    }
  }

  dispose(): void {
    for (const ps of this.fx) ps.dispose();
    this.fx = [];
    this.nebulaTexture?.dispose();
    this.nebulaTexture = null;
    // The coat stays on the shared material for the next cat.
    this.coat = null;
    this.halo?.material?.dispose();
    this.halo?.dispose();
    this.halo = null;
    this.entries?.dispose();
    this.entries = null;
    this.clipGroups.clear();
    this.ground.dispose();
    this.anchor.dispose();
    this.root.dispose();
  }
}
