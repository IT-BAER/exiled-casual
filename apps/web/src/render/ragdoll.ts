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

/** Seconds a corpse is left on the floor before it is disposed. */
export const CORPSE_SECONDS = 6;

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
const PLAYER_PARTS: Record<string, number> = {
  pelvis: 0.20,
  spine_02: 0.22,
  neck_01: 0.10,
  Head: 0.16,
  upperarm_l: 0.10, lowerarm_l: 0.09, hand_l: 0.07,
  upperarm_r: 0.10, lowerarm_r: 0.09, hand_r: 0.07,
  thigh_l: 0.14, calf_l: 0.12, foot_l: 0.09,
  thigh_r: 0.14, calf_r: 0.12, foot_r: 0.09,
};

/**
 * The creature skeletons are generated (`tools/build_monsters.py`) and share one
 * naming scheme across all seventeen: a `body_<i>` trunk with `leg<n>_<j>` and
 * `arm<n>_<j>` chains off it. So there is no per-species table here and there is
 * not meant to be one — a new species built by the same tool falls over for free.
 */
const TRUNK = 0.18;
const LIMB = 0.10;

function creaturePart(bone: string): number | null {
  if (bone.startsWith("body_")) return TRUNK;
  if (bone.startsWith("leg") || bone.startsWith("arm")) return LIMB;
  return null;
}

function configFor(skeleton: Skeleton): RagdollBoneProperties[] {
  const config: RagdollBoneProperties[] = [];
  // The skeleton's own root bone goes in whether or not it is a body part.
  //
  // Babylon picks the ragdoll's root by walking to the top of the skeleton, and
  // if that bone has no config it reports index -1: no constraints are built at
  // all and the sync loop bails on its first line, which looks exactly like a
  // ragdoll that was never enabled. The wardrobe's top bone is `root`, an
  // origin marker under the feet, and it is only in the list to be found.
  const top = skeleton.bones.find((b) => b.getParent() === null);
  for (const bone of skeleton.bones) {
    const size = bone === top
      ? PLAYER_PARTS[bone.name] ?? creaturePart(bone.name) ?? ROOT_MARKER
      : PLAYER_PARTS[bone.name] ?? creaturePart(bone.name);
    if (size === null || size === undefined) continue;
    config.push({ bone: bone.name, size } as RagdollBoneProperties);
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
 * corpse is thrown away from it.
 *
 * Returns false when nothing could be done — no physics, no skeleton — which is
 * the caller's signal to dispose the mesh the old way.
 */
export function dropDead(scene: Scene, root: Mesh, push: Vector3 | null): boolean {
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
    if (push) {
      // On the root aggregate only. Impulsing every part shreds a body outward
      // from its own centre, which is a firework and not a death.
      doll.getAggregate(0)?.body?.applyImpulse(
        push.scale(DEATH_IMPULSE), root.getAbsolutePosition());
    }
    // Onto whatever metadata the actor already carries (the player's holds its
    // rig), never over it.
    root.metadata = { ...(root.metadata as object | null), doll };
    return true;
  } catch {
    return false;
  }
}

/** Newton-seconds into a corpse. Enough to sell the blow, short of launching it. */
const DEATH_IMPULSE = 3.5;

/** The physics attached to a corpse, so the renderer can let it go. */
export function disposeRagdoll(root: Mesh): void {
  const doll = (root.metadata as { doll?: Ragdoll } | null)?.doll;
  try { doll?.dispose(); } catch { /* already gone with its scene */ }
}
