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
  Vector3,
  type AnimationGroup,
  type AssetContainer,
  type InstantiatedEntries,
  type Scene,
} from "@babylonjs/core";
import { standGroundBlob } from "./meshes";
import { warmContainer } from "./warm-shaders";

/**
 * The companion cat: PoE1's Celestial Cat Pet, watched frame by frame in three
 * videos (assets/pets/SOURCE.md). Moving, it gallops IN THE AIR beside the player
 * at his shoulder, a violet nebula and dark smoke streaming behind. Standing, it
 * hovers at his hip with its legs hanging loose, and after a few seconds plays
 * PoE's playtime loop: down onto its side, a roll onto its back, a curl in a ring,
 * a stretch, up on its hind legs against him, a spring straight up past his head,
 * a swim high in the air, a head-first dive back to the floor. Cosmetic and
 * client-only: the sim never hears of it, so replay checksums and the protocol
 * are untouched.
 *
 * `tools/build_pet.py` authors the body and its ten clips into `pet.glb` (floor
 * clips carry their own floor contact, root origin = floor); this is the runtime
 * half. The follow is a critically damped spring to a spot behind and beside the
 * player, pure arithmetic in `stepFollow`; the playtime loop is a timeline,
 * `routineAt`, pure arithmetic too; `PetActor` hangs the glTF on a root, sets its
 * height and plays the clip either asks for. Failure to load is not fatal: the
 * actor simply has no body.
 */
export const PET_URL = "/models/pet.glb";
export const PET_ID = "pet.cat.v1";
export const PET_CLIPS = [
  "hover", "gallop", "lie_side", "roll_back", "curl", "stretch", "rear_up", "spring", "swim", "dive",
] as const;
export type PetClip = (typeof PET_CLIPS)[number];
/** Everything the viewer can ask for: the clips, plus the whole playtime loop. */
export const PET_ACTIONS = [...PET_CLIPS, "routine"] as const;
export type PetAction = (typeof PET_ACTIONS)[number];
/** Clips that lie or stand on the floor: root height 0. */
export const FLOOR_CLIPS = ["lie_side", "roll_back", "curl", "stretch", "rear_up"] as const satisfies readonly PetClip[];
const LOOPED: readonly PetClip[] = ["hover", "gallop", "lie_side", "curl", "swim"];

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
  /** Seconds the player stands, the cat hovering, before the playtime loop starts. */
  idleAfter: 5,
} as const;

/**
 * Root heights, the root origin being the floor under a standing cat. The hover
 * spans -0.14..0.44 about its root (`build_pet.py` prints it), so it hangs at
 * his hip to chest as on the bridge in PoE; the gallop rides at his shoulder;
 * the swim is high over his head.
 */
export const HOVER_Y = 1.0;
export const GALLOP_Y = 1.3;
export const SWIM_Y = 2.4;
const BOB = 0.03;
const BOB_PERIOD = 3.2;
/** Height chase rate per second, for every change the timeline does not draw itself. */
const HEIGHT_RATE = 6;
/** Yaw chase rate per second. */
const TURN_RATE = 8;
/** Below this own speed it faces where the player faces. */
const FACING_SPEED = 0.3;
/** Below this the player is standing, in units per second. */
const PLAYER_STILL = 0.1;

const ease = (u: number): number => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

export interface RoutinePhase {
  clip: PetClip;
  start: number;
  seconds: number;
  /** Root height at `u` (0..1) through the phase. */
  height: (u: number) => number;
}

/** PoE's playtime loop in order; each phase lasts its clip's own length. */
export const ROUTINE: readonly RoutinePhase[] = (() => {
  const floor = () => 0;
  const plan: [PetClip, number, (u: number) => number][] = [
    ["lie_side", 3.0, floor],
    ["roll_back", 1.6, floor],
    ["curl", 4.0, floor],
    ["stretch", 1.6, floor],
    ["rear_up", 1.2, floor],
    ["spring", 0.6, (u) => SWIM_Y * ease(u)],
    ["swim", 2.4, (u) => SWIM_Y + 0.12 * Math.sin(2 * Math.PI * u)],
    ["dive", 0.8, (u) => SWIM_Y * (1 - ease(u))],
  ];
  let t = 0;
  return plan.map(([clip, seconds, height]) => {
    const phase = { clip, start: t, seconds, height };
    t += seconds;
    return phase;
  });
})();
export const ROUTINE_PERIOD = ROUTINE.reduce((sum, p) => sum + p.seconds, 0);

/** Which clip the loop plays `t` seconds in, and the root height there. */
export function routineAt(t: number): { clip: PetClip; height: number; u: number } {
  const local = ((t % ROUTINE_PERIOD) + ROUTINE_PERIOD) % ROUTINE_PERIOD;
  for (const p of ROUTINE) {
    if (local < p.start + p.seconds) {
      const u = (local - p.start) / p.seconds;
      return { clip: p.clip, height: p.height(u), u };
    }
  }
  const last = ROUTINE[ROUTINE.length - 1]!;
  return { clip: last.clip, height: last.height(1), u: 1 };
}

/** A clip shown on its own (the viewer): its height, `t` seconds into it. */
function clipHeight(clip: PetClip, t: number): number {
  if (clip === "hover") return HOVER_Y;
  if (clip === "gallop") return GALLOP_Y;
  const phase = ROUTINE.find((p) => p.clip === clip)!;
  return phase.height((t % phase.seconds) / phase.seconds);
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
/** The floating body in root space: glTF y up, nose toward +z, tail toward -z. */
const BODY_BOX = { x: 0.1, yLo: 0.02, yHi: 0.38, zLo: -0.32, zHi: 0.28 } as const;

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
  /** Carries the body; the renderer never touches it. */
  readonly root: Mesh;
  /** Carries the ground blob at y 0 under the body. */
  private readonly ground: Mesh;
  private entries: InstantiatedEntries | null = null;
  private halo: Mesh | null = null;
  /** The clips by name, for the viewer's timeline. */
  readonly clipGroups = new Map<PetClip, AnimationGroup>();
  private current: PetClip | null = null;
  /** The viewer's action, or null in play. */
  private previewed: PetAction | null = null;
  private previewT = 0;
  /** Seconds into the playtime loop, or -1 when not in it. */
  private routineT = -1;
  /** Root height over the floor, chased toward what the moment asks for. */
  private y = HOVER_Y;
  private fx: ParticleSystem[] = [];
  private nebula: ParticleSystem | null = null;
  private smoke: ParticleSystem | null = null;
  private readonly follow: FollowState = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0 };
  private speed = 0;
  private placed = false;
  private time = 0;
  /** Seconds the player has stood still. */
  private still = 0;
  private lastPlayer: { x: number; z: number } | null = null;
  private shown = true;

  constructor(private readonly scene: Scene) {
    this.root = new Mesh("pet-root", scene);
    this.root.isPickable = false;
    this.ground = new Mesh("pet-ground", scene);
    this.ground.isPickable = false;
    standGroundBlob(scene, this.ground, 0.34, 0.24, "actor");
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
   * follow: every clip repeats at its own height, the routine runs the whole
   * playtime loop, and the gallop fakes a nose-first dash so its cloud streams.
   */
  previewAction(action: PetAction): void {
    if (!this.entries) this.attach();
    this.show(true);
    this.previewed = action;
    this.previewT = 0;
    this.current = null;
    if (action !== "routine") this.play(action, true);
    this.previewTick(0);
  }

  previewTick(dt: number): void {
    const action = this.previewed;
    if (action === null) return;
    this.time += dt;
    this.previewT += dt;
    if (!this.entries) this.attach();
    let clip: PetClip;
    if (action === "routine") {
      const r = routineAt(this.previewT);
      clip = r.clip;
      this.y = r.height;
      this.play(clip, LOOPED.includes(clip));
    } else {
      clip = action;
      this.y = clipHeight(clip, this.previewT);
    }
    this.speed = clip === "gallop" ? FOLLOW.dash : 0;
    this.follow.vx = 0;
    this.follow.vz = this.speed;
    this.place(0, 0, 0, clip);
  }

  /**
   * Once per frame with the player's DRAWN position (the interpolated mesh, not
   * the snapshot) and his heading. `jump` is an area change: the cat is put on
   * its spot rather than streaking across the new map to it.
   */
  update(
    dt: number,
    px: number,
    pz: number,
    heading: { x: number; y: number } | undefined,
    alive: boolean,
    jump: boolean,
  ): void {
    this.time += dt;
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
      this.y = HOVER_Y;
      this.routineT = -1;
      this.placed = true;
      this.lastPlayer = null;
    }
    this.speed = stepFollow(this.follow, dt, px, pz, hx, hz);

    const playerSpeed = this.lastPlayer ? Math.hypot(px - this.lastPlayer.x, pz - this.lastPlayer.z) / dt : 0;
    this.lastPlayer = { x: px, z: pz };
    this.still = playerSpeed < PLAYER_STILL ? this.still + dt : 0;

    let clip: PetClip;
    let want: number;
    const travelling = this.speed > (this.current === "gallop" ? FOLLOW.gallopEnd : FOLLOW.gallop);
    if (this.still > FOLLOW.idleAfter && !travelling) {
      this.routineT = this.routineT < 0 ? 0 : this.routineT + dt;
      const r = routineAt(this.routineT);
      clip = r.clip;
      want = r.height;
    } else {
      this.routineT = -1;
      clip = travelling ? "gallop" : "hover";
      want = clip === "gallop" ? GALLOP_Y : HOVER_Y;
    }
    // The loop's timeline draws its own height; it is chased only on the way in.
    const k = this.routineT > 1 ? 1 : 1 - Math.exp(-HEIGHT_RATE * dt);
    this.y += (want - this.y) * k;
    this.play(clip, LOOPED.includes(clip));
    this.place(this.follow.x, this.follow.z, this.follow.yaw, clip);
  }

  /** Put the root, its ground blob and the cloud rates where the moment says. */
  private place(x: number, z: number, yaw: number, clip: PetClip): void {
    // The bob is a float's; a cat on the floor does not bob.
    const air = Math.min(1, this.y / 0.3);
    this.root.position.set(x, this.y + air * BOB * Math.sin((this.time * 2 * Math.PI) / BOB_PERIOD), z);
    this.root.rotation.x = 0;
    this.root.rotation.y = yaw;
    this.ground.position.set(x, 0, z);
    const travel = clip === "gallop" ? Math.max(this.speed, FOLLOW.dash) : this.speed;
    if (this.nebula) this.nebula.emitRate = cloudRate(travel);
    if (this.smoke) this.smoke.emitRate = smokeRate(travel);
  }

  private play(clip: PetClip, loop: boolean): void {
    const group = this.clipGroups.get(clip);
    if (!group) {
      // No body yet (or no file): remember the choice.
      this.current = clip;
      return;
    }
    if (this.current === clip && (group.isPlaying || !loop)) return;
    for (const [name, other] of this.clipGroups) if (name !== clip) other.stop();
    group.start(loop, 1);
    this.current = clip;
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
    const was = this.current;
    this.current = null;
    if (was) this.play(was, LOOPED.includes(was) || this.previewed !== null);
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
   * Particles are born inside the hung body (root space, so they turn with it)
   * and thrown AGAINST its travel, so the cloud wraps the cat at rest and streams
   * out behind it on the move. `back` shifts the birth box toward the trailing
   * end, for the smoke that only lives at the far tail.
   */
  private emitFromBody(ps: ParticleSystem, back: number, lift: number, spread: number): void {
    ps.emitter = this.root;
    const local = new Vector3();
    ps.startPositionFunction = (worldMatrix: Matrix, position: Vector3): void => {
      local.set(
        (Math.random() * 2 - 1) * BODY_BOX.x,
        BODY_BOX.yLo + Math.random() * (BODY_BOX.yHi - BODY_BOX.yLo),
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
    this.root.dispose();
  }
}
