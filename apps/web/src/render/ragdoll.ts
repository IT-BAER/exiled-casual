import {
  MeshBuilder, PhysicsAggregate, PhysicsShapeType, Ragdoll, Vector3, HavokPlugin,
  type Mesh, type Scene, type Skeleton, type RagdollBoneProperties,
} from "@babylonjs/core";

/**
 * Dead bodies, fallen rather than animated.
 *
 * A death clip is one death: the same fold, the same direction, every time, and
 * after the twentieth imp it is furniture. Physics gives the shape of the fall
 * back to what killed it — where the blow came from, what the body was doing,
 * what it lands against — which is the only version of this that survives being
 * seen a thousand times a session (docs/09 rule 3: intensity, not repetition).
 *
 * Havok is loaded LAZILY, on the first death of a session, and everything here
 * is silent-on-failure: a headless test, a browser that will not compile the
 * wasm, a species whose skeleton does not fit. All of those end with a corpse
 * that simply disappears the way it used to, never with a throw inside a render
 * loop.
 */

/** Seconds a corpse lies still on the floor before it starts to sink. */
export const CORPSE_SECONDS = 25;

/** Seconds the sink itself takes, once it starts. */
export const SINK_SECONDS = 3;

/** How far under the floor a body has to go before none of it is left. */
const SINK_DEPTH = 1.6;

/**
 * How deep a sinking body is at `t` of the sink, 0..1.
 *
 * Quadratic so it creeps at the start: the moment a corpse begins to move is
 * the one the eye catches, and the floor hides the fast part.
 */
export function sinkDepth(t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return SINK_DEPTH * clamped * clamped;
}

/** Where the physics floor sits. The level's own floor is drawn at y=0. */
const FLOOR_Y = 0;
/** Half-extent of the physics floor. Comfortably past any generated area. */
const FLOOR_HALF = 200;

/**
 * Bones of the player rig that get a body, and the size of the box each gets.
 *
 * A subset on purpose: fingers, toes and the coat's 96 cloth joints are all
 * skinned to the skeleton and none of them are the fall. Babylon walks up the
 * parents to find the nearest bone that IS configured, so leaving one out
 * lengthens its parent's segment instead of breaking the chain.
 */
const PLAYER_PARTS: Record<string, RagdollBoneProperties> = {
  pelvis:      { size: 0.20 } as RagdollBoneProperties,
  spine_02:    { size: 0.22, min: -0.3, max: 0.3 } as RagdollBoneProperties,
  neck_01:     { size: 0.10, min: -0.4, max: 0.4 } as RagdollBoneProperties,
  Head:        { size: 0.16, min: -0.3, max: 0.3 } as RagdollBoneProperties,
  upperarm_l:  { size: 0.10, min: -1.2, max: 1.2 } as RagdollBoneProperties,
  lowerarm_l:  { size: 0.09, min: -0.1, max: 2.2 } as RagdollBoneProperties,
  hand_l:      { size: 0.07, min: -0.4, max: 0.4 } as RagdollBoneProperties,
  upperarm_r:  { size: 0.10, min: -1.2, max: 1.2 } as RagdollBoneProperties,
  lowerarm_r:  { size: 0.09, min: -0.1, max: 2.2 } as RagdollBoneProperties,
  hand_r:      { size: 0.07, min: -0.4, max: 0.4 } as RagdollBoneProperties,
  thigh_l:     { size: 0.14, min: -1.0, max: 1.0 } as RagdollBoneProperties,
  calf_l:      { size: 0.12, min: -0.1, max: 2.0 } as RagdollBoneProperties,
  foot_l:      { size: 0.09, min: -0.5, max: 0.5 } as RagdollBoneProperties,
  thigh_r:     { size: 0.14, min: -1.0, max: 1.0 } as RagdollBoneProperties,
  calf_r:      { size: 0.12, min: -0.1, max: 2.0 } as RagdollBoneProperties,
  foot_r:      { size: 0.09, min: -0.5, max: 0.5 } as RagdollBoneProperties,
};

/**
 * The creature skeletons are generated (`tools/build_monsters.py`) and share one
 * naming scheme across all seventeen: a `body_<i>` trunk with `leg<n>_<j>` and
 * `arm<n>_<j>` chains off it. So there is no per-species table here and there is
 * not meant to be one — a new species built by the same tool falls over for free.
 */
const TRUNK = 0.10;
const LIMB = 0.06;

function creaturePart(bone: string): number | null {
  if (bone.startsWith("body_")) return TRUNK;
  if (bone.startsWith("leg") || bone.startsWith("arm")) return LIMB;
  return null;
}

function configFor(skeleton: Skeleton): RagdollBoneProperties[] {
  const config: RagdollBoneProperties[] = [];
  const top = skeleton.bones.find((b) => b.getParent() === null);
  for (const bone of skeleton.bones) {
    const entry = PLAYER_PARTS[bone.name];
    const creatureSize = creaturePart(bone.name);
    // Mass is stated rather than left to Babylon's default, because the death
    // impulse is sized against it: a silent change of default would quietly
    // rescale every fall in the game.
    if (entry) {
      config.push({ ...entry, mass: BOX_MASS, bone: bone.name } as RagdollBoneProperties);
    } else if (creatureSize !== null) {
      config.push({ bone: bone.name, size: creatureSize, mass: BOX_MASS, min: -0.4, max: 0.4 } as RagdollBoneProperties);
    } else if (bone === top) {
      config.push({ bone: bone.name, size: ROOT_MARKER, mass: BOX_MASS } as RagdollBoneProperties);
    }
  }
  return config;
}

/** Box for a root bone that is a marker rather than a body part. */
const ROOT_MARKER = 0.08;

/** Scenes whose physics is up, and the load in flight. */
const ready = new WeakSet<Scene>();
let loading: Promise<boolean> | null = null;

/**
 * Bring the physics engine up for this scene, once.
 *
 * Called at area load rather than at the first death: compiling two megabytes of
 * wasm takes longer than a monster takes to fall over, and a body that starts
 * falling a second after it died is worse than one that never did.
 */
export async function enablePhysics(scene: Scene): Promise<boolean> {
  if (ready.has(scene)) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      const [{ default: HavokPhysics }, wasm] = await Promise.all([
        import("@babylonjs/havok"),
        import("@babylonjs/havok/lib/esm/HavokPhysics.wasm?url"),
      ]);
      const hk = await HavokPhysics({ locateFile: () => wasm.default });
      // Delta-time capped by the plugin: a tab that was in the background for a
      // minute must not resolve a minute of gravity in one step.
      scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, hk));
      buildFloor(scene);
      ready.add(scene);
      return true;
    } catch {
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Forget a scene's physics. The scene that owned it is going away. */
export function resetPhysics(): void {
  loading = null;
}

/**
 * One static box under everything, so a corpse has something to land on.
 *
 * Deliberately not the level's own geometry: walls come and go with every area
 * and are merged into a handful of meshes, so giving them bodies would mean
 * rebuilding the physics world per map to stop a corpse rolling out of the
 * frame. It cannot, because the fall lasts a second and a half and it starts
 * inside a room.
 */
function buildFloor(scene: Scene): void {
  const floor = MeshBuilder.CreateBox(
    "physics-floor", { width: FLOOR_HALF * 2, depth: FLOOR_HALF * 2, height: 1 }, scene);
  floor.position.y = FLOOR_Y - 0.5;
  floor.isVisible = false;
  floor.isPickable = false;
  new PhysicsAggregate(floor, PhysicsShapeType.BOX, { mass: 0, restitution: 0.05 }, scene);
}

/**
 * Let a body fall. `push` is the direction the killing blow came FROM, so the
 * corpse is thrown away from it, and `at` is the world point it landed on —
 * chest height and off the centre line is a body that turns as it drops, the
 * root's own position is a body swept off its feet. Defaults to the root.
 *
 * Returns false when nothing could be done — no physics, no skeleton — which is
 * the caller's signal to dispose the mesh the old way.
 */
export function dropDead(scene: Scene, root: Mesh, push: Vector3 | null, at?: Vector3): boolean {
  if (!ready.has(scene)) return false;
  const skinned = root.getChildMeshes(false).find((m) => m.skeleton);
  const skeleton = skinned?.skeleton;
  if (!skeleton) return false;
  const config = configFor(skeleton);
  if (config.length === 0) return false;

  try {
    // Babylon's own `ragdoll()` cuts every bone's `linkedTransformNode` before
    // it takes over, which is what stops the glTF node graph writing the pose
    // back over the physics on the next frame. It has to happen after the boxes
    // are placed off the live pose, so it is left to Babylon rather than done here.
    const doll = new Ragdoll(skeleton, root, config);
    doll.ragdoll();
    // Damp every body so limbs settle instead of oscillating forever.
    //
    // These were 5 and 8, which is not settling, it is a body falling through
    // treacle: linear damping of 5 leaves under one percent of a velocity after
    // a second, so whatever the blow did was gone before the corpse had left the
    // spot it died on. At 1.2 the throw survives the first half second, which is
    // the part anyone watches, and the limbs still stop instead of ringing.
    for (let i = 0; i < config.length; i++) {
      const body = doll.getAggregate(i)?.body;
      if (body) {
        body.setLinearDamping(LINEAR_DAMPING);
        body.setAngularDamping(ANGULAR_DAMPING);
      }
    }
    if (push) {
      const bodies = config.map((_, i) => doll.getAggregate(i)?.body ?? null);
      throwBody(
        bodies,
        trunkIndex(config.map((c) => (c as { bone?: string }).bone ?? "")),
        push,
        at ?? root.getAbsolutePosition(),
      );
    }
    // Onto whatever metadata the actor already carries (the player's holds its
    // rig), never over it.
    root.metadata = { ...(root.metadata as object | null), doll };
    return true;
  } catch {
    return false;
  }
}

/** What the body a blow lands on can do about it. */
export interface DollBody {
  applyImpulse(impulse: Vector3, at: Vector3): void;
  getLinearVelocity(): Vector3;
  setLinearVelocity(velocity: Vector3): void;
}

/**
 * Which box the killing blow lands ON.
 *
 * Not box 0. Both packs put the top bone first, and the top bone is a marker
 * (`root` on the wardrobe, the armature node on a creature) that gets a body
 * only so the chain is not broken. It sits between the feet, so the whole
 * "chest height, off the centre line" aim was landing on an ankle-high stub.
 */
export function trunkIndex(bones: readonly string[]): number {
  const i = bones.findIndex((b) => b === "pelvis" || b.startsWith("body_"));
  return i < 0 ? 0 : i;
}

/**
 * Throw a doll away from what killed it.
 *
 * The boxes are JOINTED, which is what the old arithmetic missed: an impulse
 * into one of sixteen 10 kg boxes does not leave that box at 3.4 m/s, it leaves
 * the 160 kg it is chained to at 0.2 m/s, and a body already falling at 9.8 goes
 * straight down on the spot it died. That is the whole "the corpse does not
 * react" report. So every box takes the same velocity change and the doll leaves
 * as one thing.
 *
 * The trunk alone takes its share as an impulse at `at` (chest height, off the
 * centre line) and that torque is what turns the body as it goes. The others are
 * pushed through their own centres: sixteen boxes all spinning about one shared
 * point is not a death, it is a shredding.
 */
export function throwBody(
  bodies: readonly (DollBody | null)[],
  trunk: number,
  push: Vector3,
  at: Vector3,
): void {
  const kick = push.scale(DEATH_SPEED);
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body) continue;
    if (i === trunk) body.applyImpulse(push.scale(DEATH_IMPULSE), at);
    else body.setLinearVelocity(body.getLinearVelocity().add(kick));
  }
}

/**
 * What a blow is worth: the speed the corpse leaves at, and the impulse that
 * buys it for one box.
 *
 * Below a walking pace, the fall is gravity alone and every death is the same
 * shape. 3.4 m/s is a stagger and half a turn, not a launch, and `LINEAR_DAMPING`
 * bleeds it off inside the half second anyone watches.
 */
const BOX_MASS = 10;
/** Newton-seconds for one `BOX_MASS` box. The trunk's share, applied off-centre. */
const DEATH_IMPULSE = 55;
/** Metres per second the corpse leaves with. The number above, made checkable.
 *
 * Instrumented at 34/1.2: the throw was applied in full and the trunk travelled
 * ~1.3 units — and the owner still read it as "no reaction", because a uniform
 * drift that decays over half a second is a slide, not a blow. What reads as a
 * killing blow is the PROFILE, not the distance: leave fast, die fast. 5.5 m/s
 * bled at 2.5/s covers about the same ground as 3.4 bled at 1.2, but the first
 * 200ms carries most of it. */
export const DEATH_SPEED = DEATH_IMPULSE / BOX_MASS;
/** How fast that is bled off again. See the note where these are applied. */
const LINEAR_DAMPING = 2.5;
const ANGULAR_DAMPING = 3;

/**
 * Freeze a settled body in the pose it landed in and hand its physics back.
 *
 * Required before the sink, not just tidy: in ragdoll mode Babylon writes each
 * bone from its box's WORLD position through the inverse of the root's matrix,
 * so lowering the root is cancelled on the same frame and the corpse never
 * moves. `pauseSync` stops that observer, and it has to be set before the
 * aggregates go or it reads them after they are disposed.
 */
export function freezeRagdoll(root: Mesh): void {
  const doll = (root.metadata as { doll?: Ragdoll } | null)?.doll;
  if (!doll) return;
  doll.pauseSync = true;
  disposeRagdoll(root);
}

/** The physics attached to a corpse, so the renderer can let it go. */
export function disposeRagdoll(root: Mesh): void {
  const doll = (root.metadata as { doll?: Ragdoll } | null)?.doll;
  try { doll?.dispose(); } catch { /* already gone with its scene */ }
}
