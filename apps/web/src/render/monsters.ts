import {
  LoadAssetContainerAsync,
  type AnimationGroup,
  type AssetContainer,
  type InstantiatedEntries,
  type Mesh,
  type Node,
  type Scene,
} from "@babylonjs/core";
import { addRim } from "./rim";
import { idleRatio } from "./rig";
import { warmContainer } from "./warm-shaders";

/**
 * Every creature in the game as one authored glTF.
 *
 * Thirteen species and a boss used to be the same quadruped imp built out of
 * Babylon spheres, told apart by a tint and a scale factor. `tools/
 * build_monsters.py` sculpts each one against its own skeleton, rigs it to an
 * armature grown from that same skeleton and authors its clips; this module is
 * the runtime half: fetch the file once, hand out one skinned instance per
 * monster, and play the clip its ground speed asks for.
 *
 * Failure is not fatal, exactly as with the character rig and the props: a
 * headless test or a failed fetch leaves `loaded` null and every caller falls
 * back to the primitive imp it always had, so the lab still runs.
 */
const MONSTERS_URL = "/models/monsters.glb";

/**
 * glTF's own wrapper node. It carries the right-to-left-handed conversion, so an
 * instance is parented *with* it — reparenting a creature out of it mirrors it.
 */
const GLTF_ROOT = "__root__";

interface LoadedMonsters {
  scene: Scene;
  container: AssetContainer;
}

let loaded: LoadedMonsters | null = null;
/**
 * The load in flight AND the scene it is loading into. See `loadProps` for why
 * the scene is half of the key: a promise shared across scenes leaves
 * `attachCreature` returning null with nothing thrown.
 */
let pending: { scene: Scene; promise: Promise<void> } | null = null;

/** Fetch the creatures once, before the render loop starts. */
export function loadMonsters(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();
  if (pending?.scene === scene) return pending.promise;

  const prior = pending?.promise ?? Promise.resolve();
  const promise = prior
    .catch(() => undefined)
    .then(() => {
      if (loaded?.scene === scene) return undefined;
      return LoadAssetContainerAsync(MONSTERS_URL, scene);
    })
    .then(async (container) => {
      if (container === undefined) return;
      // Once, on the container's own materials: every instance shares them, so
      // a rim added here reaches all forty creatures for three uniforms.
      for (const material of container.materials) addRim(material);
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

export function isMonstersReady(scene: Scene): boolean {
  return loaded !== null && loaded.scene === scene;
}

/** Drop the cached container — the scene that owns it is going away. */
export function resetMonsters(): void {
  loaded = null;
  pending = null;
}

function isUnder(node: Node, name: string): boolean {
  for (let n: Node | null = node; n; n = n.parent) {
    if (n.name === name) return true;
  }
  return false;
}

/**
 * Whether one thing in the container belongs to `species` — what gets cloned
 * when a monster is built, and what is pruned so sixteen unwanted creatures are
 * never instantiated. A rejected node takes its whole subtree with it.
 *
 * **Babylon asks this about SKELETONS AND ANIMATION GROUPS as well as nodes**
 * (`assetContainer.js` runs the predicate over all three lists). Neither a
 * skeleton nor a clip has a `parent` to walk up, so a node-only test silently
 * rejects every one of them and hands back a skinned creature with no skeleton
 * and no clips: a monster stuck in its bind pose, and a green suite. Both are
 * named for the species — `monster.x.v1` and `monster.x.v1|walk` — which is
 * what the name test carries.
 */
export function partOfCreature(entity: { name: string }, species: string): boolean {
  if (entity.name === GLTF_ROOT || entity.name.startsWith(species)) return true;
  return isUnder(entity as Node, species);
}

/** The clips `build_monsters.py` authors, one NLA track each; a slam only for a species that winds one up. */
type Clip = "walk" | "idle" | "attack" | "slam";
const CLIPS: readonly Clip[] = ["walk", "idle", "attack", "slam"];
type Strike = "attack" | "slam";

/** The strike plays a shade quick — authored over the walk's frames, it reads
 *  sluggish at 1.0 against a swing that has already landed in the sim. */
const ATTACK_RATIO = 1.3;
/** The slowest a heavy's coil stretches; a wind-up longer than that lands its blow early. */
const COIL_RATIO_MIN = 0.15;

/**
 * Seconds from a strike's start to its blow at its own pace. `build_monsters.py`
 * stamps each strike's contact into its glTF animation as `extras.blow` (clip
 * time, seconds), which Babylon hands over as `metadata.gltf.extras`.
 */
function toBlow(group: AnimationGroup): number {
  const fps = group.targetedAnimations[0]?.animation.framePerSecond;
  const blow = (group.metadata as { gltf?: { extras?: { blow?: number } } } | null)?.gltf?.extras?.blow;
  return fps && blow !== undefined ? blow - group.from / fps : 0;
}

/** The strike's rate that lands its blow `impactIn` seconds out, inside the range it still reads at. */
function coilRatio(group: AnimationGroup, impactIn: number): number {
  const s = toBlow(group);
  if (s <= 0 || impactIn <= 0) return ATTACK_RATIO;
  return Math.min(ATTACK_RATIO, Math.max(COIL_RATIO_MIN, s / impactIn));
}

/**
 * Ground speed, in units per second, at which a walk cycle plays back unscaled.
 *
 * The clips are NOT authored to plant their feet at any particular speed: step
 * frequency goes as 1/sqrt(leg length) and this roster spans 0.85 to 3.1 units
 * of height, so timing an imp's cycle to its 2.4-unit/s def gives it a seven
 * hertz scrabble. Cadence is authored to READ (see `CYCLE_AT` in the builder),
 * this is the speed either side of which the runtime hurries it or slows it, and
 * the residual foot slide is the trade — a few centimetres per step on a camera
 * nineteen units up. Monster defs run 1.2 to 3.0, so this sits in the middle.
 */
const WALK_SPEED = 2.0;
/** Beyond this the cycle stops reading as the same gait and starts to skate. */
const RATIO_RANGE = [0.7, 1.55] as const;
/** A breath is authored over the same frames as a stride, and played slow. */
const IDLE_RATIO = 0.4;
/** Below this an actor is standing still, in the renderer's own units. */
const MOVING = 0.05;

/**
 * One creature's authored clips, and which one is playing.
 *
 * Unlike the player's rig (`rig.ts`), nothing is retargeted here: the clips ship
 * inside `monsters.glb` alongside the skeleton they were authored on, so
 * Babylon's own instantiation hands back groups already pointed at this
 * instance's bones.
 */
export class CreatureRig {
  private readonly groups = new Map<Clip, AnimationGroup>();
  private playing: Clip | null = null;
  /** Mid one-shot strike: locomotion keeps its hands off the bones. */
  private striking = false;
  /** Which strike is playing, or last played. */
  private strike: Strike = "attack";
  /** `performance.now()` at which a charge's strike starts, so its blow falls where the run ends. */
  private swingAt: number | undefined;
  /** Last swing tick seen, so only the change fires the clip. */
  private lastAttackTick: number | undefined;
  /** `performance.now()` at which a heavy's slowed blow lands; the follow-through plays at full pace. */
  private blowAt: number | undefined;
  private seen = false;
  /** Seconds stood still, so the breath can settle the way the player's does. */
  private standing = 0;
  /** Off screen and paused: clip changes are remembered, not played. See `setAwake`. */
  private awake = true;
  /** Cross-fade on a clip start. Applied AT a start only, so a ramp already running never snaps. */
  private blend = true;
  private readonly scene: Scene | null;

  constructor(
    private readonly entries: InstantiatedEntries,
    species: string,
    scene: Scene | null = null,
  ) {
    this.scene = scene;
    for (const group of entries.animationGroups) {
      const clip = CLIPS.find((c) => group.name.endsWith(c)) ?? null;
      // Babylon clones every group in the container, and a group whose targets
      // were pruned falls back to the SOURCE nodes — which would animate the
      // shared container out from under every other monster.
      if (clip === null || !group.name.includes(species)) {
        group.dispose();
        continue;
      }
      group.enableBlending = this.blend;
      group.blendingSpeed = 0.1;
      this.groups.set(clip, group);
    }
    // The first breath after being built is the arrival one; the settle starts
    // from there, exactly as it does when a creature stops walking.
    this.play("idle", IDLE_RATIO);
  }

  /**
   * Free the whole instantiation, not just the visible mesh. Each monster gets
   * its OWN skeleton (`doNotInstantiate`), so disposing the entity mesh leaves
   * the bones, the `__root__`, and the cloned animation groups behind — 7000+
   * `leg`/`body_` transform nodes after a few area crossings, the framerate
   * bleeding out. `InstantiatedEntries.dispose()` is the same call `PlayerRig`
   * makes; the renderer invokes this wherever it disposes an actor mesh.
   */
  dispose(): void {
    this.entries.dispose();
    this.groups.clear();
  }

  /** Each clip's group, read-only: the asset viewer's timeline reads them. */
  get clipGroups(): ReadonlyMap<string, AnimationGroup> {
    return this.groups;
  }

  /**
   * The sim swung (snapshot `attackTick` changed): play the strike once, over
   * whatever locomotion asks for, then hand the body back. The tick is only an
   * edge — its value never schedules anything client-side. A wind-up passes the
   * seconds until its hit: the species' slam (its attack where it has none)
   * plays, its coil stretched to land the blow on it. A charge's wind-up is the
   * run, so its attack starts late instead, and the legs run until then.
   */
  noteAttack(tick: number | undefined, impactIn?: number, charge = false): void {
    // The first report only seeds the edge, "no swing yet" included. A creature
    // that comes into view carrying a swing from before it was drawn must not
    // greet the camera with one, but its first swing in view must play.
    if (!this.seen) { this.seen = true; this.lastAttackTick = tick; return; }
    if (tick === undefined || tick === this.lastAttackTick) return;
    this.lastAttackTick = tick;
    if (!this.awake) return; // a swing nobody can see

    if (impactIn === undefined) {
      this.swing("attack", ATTACK_RATIO);
      return;
    }
    const attack = this.groups.get("attack");
    if (charge) {
      this.swingAt = performance.now() + (impactIn - (attack ? toBlow(attack) : 0) / ATTACK_RATIO) * 1000;
      return;
    }
    const strike: Strike = this.groups.has("slam") ? "slam" : "attack";
    const group = this.groups.get(strike);
    if (!group) return;
    this.swing(strike, coilRatio(group, impactIn));
    this.blowAt = performance.now() + impactIn * 1000;
  }

  setLocomotion(speed: number): void {
    if (this.blowAt !== undefined && performance.now() >= this.blowAt) {
      this.blowAt = undefined;
      const strike = this.groups.get(this.strike);
      if (strike && this.striking) strike.speedRatio = ATTACK_RATIO;
    }
    if (this.swingAt !== undefined && performance.now() >= this.swingAt) this.swing("attack", ATTACK_RATIO);
    if (this.striking) return;
    if (speed <= MOVING) {
      // Same settle as the player rig, off the same clock: a creature that has
      // been standing in a corner since the map opened should not be breathing
      // at the rate it arrived at. See idleRatio in rig.ts.
      this.standing += (this.scene?.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000;
      this.play("idle", IDLE_RATIO * idleRatio(this.standing));
      return;
    }
    this.standing = 0;
    const ratio = speed / WALK_SPEED;
    this.play("walk", Math.min(RATIO_RANGE[1], Math.max(RATIO_RANGE[0], ratio)));
  }

  /**
   * Stop the bones of a creature nobody can see, and pick up where locomotion
   * says it should be when it comes back. Every monster in a map animating off
   * screen was an eighth of a mid-range CPU's frame. Stop, not pause: a paused
   * group stays in `Scene.animate` and counts as started, so `start` would no-op.
   */
  setAwake(awake: boolean): void {
    if (awake === this.awake) return;
    this.awake = awake;
    if (!awake) {
      this.swingAt = undefined;
      if (this.striking) {
        this.groups.get(this.strike)?.stop();
        this.striking = false;
        this.playing = null;
      }
      const group = this.playing ? this.groups.get(this.playing) : undefined;
      group?.stop();
      return;
    }
    const clip = this.playing;
    if (!clip) return;
    for (const [name, other] of this.groups) if (name !== clip) other.stop();
    const group = this.groups.get(clip);
    if (group) group.enableBlending = this.blend;
    group?.start(true, group.speedRatio);
  }

  /** Far bodies cut between clips instead of blending; takes effect at the next clip start. */
  setBlending(on: boolean): void {
    this.blend = on;
  }

  /** Let go of the body. A clip still running would drive the bones the physics
   *  is trying to own, and the corpse would twitch through its walk. */
  stopForDeath(): void {
    for (const group of this.groups.values()) group.stop();
    this.striking = false;
    this.swingAt = undefined;
    this.playing = null;
  }

  /** One strike, once, over whatever locomotion was playing; the body goes back to locomotion at its end. */
  private swing(strike: Strike, ratio: number): void {
    const group = this.groups.get(strike);
    if (!group) return;
    for (const [name, other] of this.groups) if (name !== strike) other.stop();
    this.swingAt = undefined;
    this.blowAt = undefined;
    this.striking = true;
    this.strike = strike;
    group.speedRatio = ratio;
    group.enableBlending = this.blend;
    group.start(false, ratio);
    group.onAnimationGroupEndObservable.addOnce(() => {
      if (this.playing !== strike) return; // cut short by the other strike
      this.striking = false;
      this.playing = null; // force the next setLocomotion to restart its clip
    });
    this.playing = strike;
  }

  private play(clip: Clip, ratio: number): void {
    const group = this.groups.get(clip);
    if (!group) return;
    group.speedRatio = ratio;
    if (this.playing === clip) return;
    group.enableBlending = this.blend;
    if (!this.awake) {
      this.playing = clip; // started by setAwake(true)
      return;
    }
    for (const [name, other] of this.groups) if (name !== clip) other.stop();
    group.start(true, ratio);
    this.playing = clip;
  }
}

/**
 * Parent one instance of `species` under `root` and hand back its clips.
 *
 * Null when the asset has not loaded, which is the signal to greybox instead.
 */
export function attachCreature(scene: Scene, root: Mesh, species: string): CreatureRig | null {
  if (!loaded || loaded.scene !== scene) return null;
  if (!loaded.container.rootNodes.some((n) => hasChild(n, species))) return null;

  const entries = loaded.container.instantiateModelsToScene((n) => n, false, {
    predicate: (e: Node) => partOfCreature(e, species),
    // A skinned mesh needs its own skeleton, not a GPU instance sharing one —
    // the same reason the wardrobe is instantiated this way.
    doNotInstantiate: true,
  });

  for (const node of entries.rootNodes) {
    node.parent = root;
    for (const mesh of node.getChildMeshes()) {
      mesh.isPickable = false;
      // Clones share the container mesh's metadata object, and the hit flash rides it.
      mesh.metadata = { ...(mesh.metadata ?? {}) };
    }
  }
  return new CreatureRig(entries, species, scene);
}

/** Every species the loaded file carries, named as the sim names them. Empty until it loads. */
export function creatureSpecies(scene: Scene): string[] {
  if (!loaded || loaded.scene !== scene) return [];
  return loaded.container.rootNodes
    .flatMap((r) => r.getChildren())
    .map((n) => n.name)
    .filter((name) => name.startsWith("monster."));
}

function hasChild(node: Node, name: string): boolean {
  if (node.name === name) return true;
  return node.getChildren().some((c) => hasChild(c, name));
}
