import {
  Color3,
  Color4,
  Constants,
  FresnelParameters,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  ParticleSystem,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AnimationGroup,
  type AssetContainer,
  type InstantiatedEntries,
  type Scene,
} from "@babylonjs/core";
import { standGroundBlob } from "./meshes";
import { warmContainer } from "./warm-shaders";

/**
 * The companion cat: PoE1's Celestial Cat Pet, its motion recreated from PoE's
 * own floating clips (assets/pets/SOURCE.md). Moving, it gallops IN THE AIR
 * beside the player, a violet nebula and dark smoke streaming behind. Standing,
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
  /** Own speed at which the cloud streams in full. */
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

/** The rim halo: violet light hugging the silhouette, as PoE's cat wears it. */
const HALO_COLOR = new Color3(0.42, 0.26, 1.0);

const PUFF = "/textures/fx/haze.webp";
const SMOKE = "/textures/fx/smoke_puff.webp";
export const PET_FX_NAMES = ["fx-pet-nebula", "fx-pet-smoke", "fx-pet-sparks"] as const;
/** Nebula puffs per second: a thin shimmer at rest, a stream at dash speed. */
export function cloudRate(speed: number): number {
  const k = Math.min(1, Math.max(0, speed) / FOLLOW.dash);
  return 10 + 130 * k;
}
/** Dark smoke per second: none at rest, the far tail of the trail at speed. */
function smokeRate(speed: number): number {
  return 40 * Math.min(1, Math.max(0, speed) / FOLLOW.dash);
}
/** The body about its middle (the anchor), root axes: y up, nose toward +z, tail toward -z. */
const BODY_BOX = { x: 0.13, y: 0.23, zLo: -0.41, zHi: 0.36 } as const;

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
  /** Rides the body's middle (its chest joint) in root space: the clouds are born round it. */
  private readonly anchor: Mesh;
  private chest: TransformNode | null = null;
  private readonly inverse = new Matrix();
  private readonly turn = new Matrix();
  private entries: InstantiatedEntries | null = null;
  private halo: Mesh | null = null;
  /** The clips by name, for the viewer's timeline. */
  readonly clipGroups = new Map<PetClip, AnimationGroup>();
  private current: PetClip | null = null;
  /** Seconds into the current clip; a hover counts its cycles from it. */
  private clipT = 0;
  /** The viewer's action, or null in play. */
  private previewed: PetAction | null = null;
  private fx: ParticleSystem[] = [];
  private nebula: ParticleSystem | null = null;
  private smoke: ParticleSystem | null = null;
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
   * follow: every clip repeats, and the gallop fakes a nose-first dash so its
   * cloud streams.
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
    this.speed = action === "gallop" ? FOLLOW.dash : 0;
    this.follow.vx = 0;
    this.follow.vz = this.speed;
    this.place(0, 0, 0, action);
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
    this.place(this.follow.x, this.follow.z, this.follow.yaw, this.current!);
  }

  /** Put the root on the ground at (x, z), the clouds and the ground blob under the body. */
  private place(x: number, z: number, yaw: number, clip: PetClip): void {
    if (this.chest) {
      // The body's middle in root space, from the last drawn pose: the clip moves
      // it over the root (PoE's root motion), up to three units high.
      this.root.getWorldMatrix().invertToRef(this.inverse);
      this.chest.computeWorldMatrix();
      Vector3.TransformCoordinatesToRef(this.chest.getAbsolutePosition(), this.inverse, this.anchor.position);
    }
    this.root.position.set(x, 0, z);
    this.root.rotation.x = 0;
    this.root.rotation.y = yaw;
    Matrix.RotationYToRef(yaw, this.turn);
    const under = Vector3.TransformCoordinates(this.anchor.position, this.turn);
    this.ground.position.set(x + under.x, 0, z + under.z);
    const travel = clip === "gallop" ? Math.max(this.speed, FOLLOW.dash) : this.speed;
    if (this.nebula) this.nebula.emitRate = cloudRate(travel);
    if (this.smoke) this.smoke.emitRate = smokeRate(travel);
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
      for (const mesh of node.getChildMeshes()) mesh.isPickable = false;
    }
    this.chest =
      entries.rootNodes
        .flatMap((n) => n.getDescendants(false))
        .find((n): n is TransformNode => n instanceof TransformNode && n.name === "chest") ?? null;
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
    this.halo = this.buildHalo(entries);
    this.nebula = this.buildNebula();
    this.smoke = this.buildSmoke();
    this.fx = [this.nebula, this.smoke, this.buildSparks()];
    // Whatever was decided before the body arrived starts now.
    if (this.current) this.start(this.current);
  }

  /**
   * A second skin of the body on the body's own skeleton, lit only at its rim
   * (fresnel opacity, additive): the violet light that hugs PoE's cat and keeps
   * a black cat readable on a dark floor.
   */
  private buildHalo(entries: InstantiatedEntries): Mesh | null {
    const body = entries.rootNodes
      .flatMap((n) => n.getChildMeshes(false))
      .find((m): m is Mesh => m instanceof Mesh && m.name.endsWith(".body"));
    if (!body) return null;
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
   * Particles are born inside the body (round the anchor, so they turn with it)
   * and thrown AGAINST its travel, so the cloud wraps the cat at rest and streams
   * out behind it on the move. `back` shifts the birth box toward the trailing
   * end, for the smoke that only lives at the far tail.
   */
  private emitFromBody(ps: ParticleSystem, back: number, lift: number, spread: number): void {
    ps.emitter = this.anchor;
    const local = new Vector3();
    ps.startPositionFunction = (worldMatrix: Matrix, position: Vector3): void => {
      local.set(
        (Math.random() * 2 - 1) * BODY_BOX.x,
        (Math.random() * 2 - 1) * BODY_BOX.y,
        BODY_BOX.zLo + Math.random() * (BODY_BOX.zHi - BODY_BOX.zLo) - back,
      );
      Vector3.TransformCoordinatesToRef(local, worldMatrix, position);
      if (back > 0) {
        // The far tail is downstream of the body, not behind its nose.
        const k = back * Math.min(1, this.speed / FOLLOW.dash);
        const len = this.speed || 1;
        position.x -= (this.follow.vx / len) * k;
        position.z -= (this.follow.vz / len) * k;
      }
    };
    ps.startDirectionFunction = (_world: Matrix, direction: Vector3): void => {
      direction.set(
        -this.follow.vx * 0.55 + (Math.random() * 2 - 1) * spread,
        lift + (Math.random() * 2 - 1) * spread * 0.6,
        -this.follow.vz * 0.55 + (Math.random() * 2 - 1) * spread,
      );
    };
  }

  private buildNebula(): ParticleSystem {
    const ps = new ParticleSystem(PET_FX_NAMES[0], 220, this.scene);
    ps.particleTexture = new Texture(PUFF, this.scene);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.applyFog = true;
    // Violet at the body, magenta down the trail, gone.
    ps.addColorGradient(0, new Color4(0.5, 0.3, 1, 0));
    ps.addColorGradient(0.2, new Color4(0.55, 0.32, 1, 0.32));
    ps.addColorGradient(0.7, new Color4(0.85, 0.25, 0.75, 0.18));
    ps.addColorGradient(1, new Color4(0.4, 0.1, 0.3, 0));
    ps.addSizeGradient(0, 0.8);
    ps.addSizeGradient(1, 1.3);
    // Puffs no bigger than the cat's head: the body must stay readable inside them.
    ps.minSize = 0.12;
    ps.maxSize = 0.24;
    ps.minLifeTime = 0.45;
    ps.maxLifeTime = 0.8;
    ps.emitRate = cloudRate(0);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1;
    ps.gravity = new Vector3(0, 0.12, 0);
    this.emitFromBody(ps, 0, 0.1, 0.16);
    ps.start();
    return ps;
  }

  private buildSmoke(): ParticleSystem {
    const ps = new ParticleSystem(PET_FX_NAMES[1], 80, this.scene);
    ps.particleTexture = new Texture(SMOKE, this.scene);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.applyFog = true;
    ps.addColorGradient(0, new Color4(0.12, 0.08, 0.18, 0));
    ps.addColorGradient(0.3, new Color4(0.12, 0.08, 0.18, 0.4));
    ps.addColorGradient(1, new Color4(0.08, 0.06, 0.1, 0));
    ps.addSizeGradient(0, 0.7);
    ps.addSizeGradient(1, 1.8);
    ps.minSize = 0.3;
    ps.maxSize = 0.5;
    ps.minLifeTime = 1.0;
    ps.maxLifeTime = 1.4;
    ps.emitRate = smokeRate(0);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1;
    ps.gravity = new Vector3(0, 0.08, 0);
    this.emitFromBody(ps, 0.9, 0.05, 0.1);
    ps.start();
    return ps;
  }

  private buildSparks(): ParticleSystem {
    const ps = new ParticleSystem(PET_FX_NAMES[2], 24, this.scene);
    ps.particleTexture = new Texture(PUFF, this.scene);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.applyFog = true;
    ps.addColorGradient(0, new Color4(1, 1, 1, 0));
    ps.addColorGradient(0.15, new Color4(1, 1, 1, 1));
    ps.addColorGradient(1, new Color4(0.6, 0.9, 1, 0));
    ps.minSize = 0.025;
    ps.maxSize = 0.05;
    ps.minLifeTime = 1.2;
    ps.maxLifeTime = 2.0;
    ps.emitRate = 6;
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1;
    this.emitFromBody(ps, 0, 0.25, 0.12);
    ps.start();
    return ps;
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
    this.nebula = this.smoke = null;
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
