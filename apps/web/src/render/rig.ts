import {
  Animation,
  AnimationGroup,
  Mesh,
  TransformNode,
  Vector3,
  LoadAssetContainerAsync,
  type AssetContainer,
  type IAnimationKey,
  type InstantiatedEntries,
  type Node,
  type Scene,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/**
 * Skinned player actor: one CC0 humanoid skeleton, animation clips retargeted
 * onto it by bone name, and outfits that are pure data.
 *
 * The two source packs export the same 65-bone Unreal-named rig, so a clip
 * authored on the animation library drives any outfit without retargeting
 * machinery — the bones are matched by name and the eight leaf tips that differ
 * (`foot_end_l` vs `ball_leaf_l`) deform nothing.
 */

/** Clips the game can actually trigger today. The library ships 45. */
export type RigClip = "idle" | "walk" | "run" | "cast";

/** Clip names inside anim-library.glb — FBX2glTF prefixes every take with "Rig|". */
const CLIP_NAME: Record<RigClip, string> = {
  idle: "Rig|Idle_Loop",
  walk: "Rig|Walk_Loop",
  run: "Rig|Jog_Fwd_Loop",
  cast: "Rig|Spell_Simple_Shoot",
};

const CLIP_LOOPS: Record<RigClip, boolean> = {
  idle: true,
  walk: true,
  run: true,
  cast: false,
};

/** Ground speed (units/sec) each locomotion clip was authored at. */
const CLIP_SPEED: Record<"walk" | "run", number> = { walk: 1.4, run: 3.4 };

/**
 * Cadence trim. 1.0 matches the stride exactly to the actor's ground speed;
 * above that the legs turn over faster than strictly correct. The jog reads
 * sluggish at a literal 1.0 under this camera, and the small amount of foot
 * slide the trim introduces is not visible at this zoom.
 */
const CADENCE: Record<"walk" | "run", number> = { walk: 1, run: 1.2 };

const MIN_RATIO = 0.5;
const MAX_RATIO = 1.8;

/** Below this the actor counts as standing still. */
const IDLE_SPEED = 0.15;
/** Above this the jog reads better than the walk. Player base speed is 3.5. */
const RUN_SPEED = 2.2;

/** Which locomotion clip suits a ground speed, in units/sec. */
export function clipForSpeed(speed: number): RigClip {
  // Written so a NaN speed falls to idle rather than sprinting on the spot.
  if (!(speed >= IDLE_SPEED)) return "idle";
  return speed < RUN_SPEED ? "walk" : "run";
}

/**
 * Playback rate that keeps the feet planted instead of skating: the clip is
 * driven by how fast the actor is really moving, the same principle the
 * primitive walk cycle uses. Clamped so extremes still read as a stride.
 */
export function speedRatioFor(clip: RigClip, speed: number): number {
  if (clip !== "walk" && clip !== "run") return 1;
  const matched = (speed / CLIP_SPEED[clip]) * CADENCE[clip];
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, matched));
}

/** A source pack: one skeleton, one set of slot meshes, one texture set. */
export type Pack = "ranger" | "peasant";

const PACK_URL: Record<Pack, string> = {
  ranger: "/models/Male_Ranger.gltf",
  peasant: "/models/Male_Peasant.gltf",
};

/**
 * Both packs export the same 65 joints in the same order with bit-identical
 * inverse bind matrices, so a mesh authored on one binds to the other's skeleton
 * with no re-rigging: clone the mesh, point it at the live skeleton, done. The
 * 78x-124x rest-pose gap noted above is between the *animation library* and the
 * outfits, not between the outfits themselves.
 *
 * That makes the wardrobe pure data. `mixed` exists to keep it honest — it is a
 * peasant wearing the ranger's hood and pauldron, and it is the thing that
 * breaks first if a future pack ships a different joint order.
 */
interface OutfitSpec {
  /** Supplies the skeleton, and every mesh not listed in `borrow`. */
  pack: Pack;
  /** Meshes lifted from another pack and bound to this outfit's skeleton. */
  borrow?: readonly { pack: Pack; mesh: string }[];
}

export type Outfit = "ranger" | "peasant" | "mixed";

export const OUTFITS: readonly Outfit[] = ["ranger", "peasant", "mixed"];

const OUTFIT: Record<Outfit, OutfitSpec> = {
  ranger: { pack: "ranger" },
  peasant: { pack: "peasant" },
  mixed: {
    pack: "peasant",
    borrow: [
      { pack: "ranger", mesh: "Male_Ranger_Head_Hood" },
      { pack: "ranger", mesh: "Male_Ranger_Acc_Pauldron" },
    ],
  },
};

const ANIM_URL = "/models/anim-library.glb";

/**
 * The two packs share bone *names* but not rest poses: per-bone rest lengths
 * differ by 78× to 124×, so a translation key authored on one rig means nothing
 * on the other. Replaying them drove the pelvis to y=0.01 instead of 0.95 and
 * buried the character to the knees.
 *
 * Rotations are rest-pose independent, so they transfer as-is and every bone
 * keeps its own outfit's translation — correct proportions, correct height.
 * Every clip in this pack has exactly one translation channel, on the pelvis,
 * and that one still matters: it is what lowers the hips during a stride. Drop
 * it and the legs reach for a floor that is no longer under them. So it is
 * rescaled into this rig instead (see `remapHips`).
 */
const ROTATION = "rotationQuaternion";
const TRANSLATION = "position";

/** The one bone these clips translate. Everything else is pure rotation. */
const HIPS_BONE = "pelvis";

/**
 * Bones a layered clip must not touch, so it can play over locomotion without
 * fighting it for the legs. Leaf tips are included by name from both packs.
 */
const LOWER_BODY: ReadonlySet<string> = new Set([
  "root", HIPS_BONE,
  "thigh_l", "calf_l", "foot_l", "ball_l", "ball_leaf_l", "foot_end_l",
  "thigh_r", "calf_r", "foot_r", "ball_r", "ball_leaf_r", "foot_end_r",
]);

/** Clips that layer over locomotion instead of replacing it. */
const UPPER_BODY_CLIPS: ReadonlySet<RigClip> = new Set<RigClip>(["cast"]);

/**
 * How much of a clip's hips bounce to keep. The jog is authored with 26% of hip
 * height of vertical travel, which on this character is a 0.25-unit hop and
 * reads as bounding rather than running. The curve is compressed toward its
 * lowest point rather than toward the rest pose, so the bottom of the stride —
 * where the foot is planted — stays exactly where it was and only the peak
 * comes down.
 *
 * Tuned by eye against the jog: 1.0 bounds like a hop, 0.4 goes lifeless.
 */
const HIPS_BOB = 0.65;

/**
 * Re-express a hips translation curve in the target rig's proportions: keep the
 * target's rest position, and add the clip's motion away from its own rest,
 * scaled by how much bigger this rig's hips offset is. The bounce is then
 * compressed toward the curve's lowest point (see `HIPS_BOB`).
 */
function remapHips(source: Animation, animRest: Vector3, outfitRest: Vector3): Animation {
  const scale = outfitRest.length() / Math.max(animRest.length(), 1e-9);
  const keys = source.getKeys();

  // Per-axis low-water mark of the curve — the anchor the bounce shrinks toward.
  const floor = new Vector3(Infinity, Infinity, Infinity);
  for (const key of keys) {
    const v = key.value as Vector3;
    floor.set(Math.min(floor.x, v.x), Math.min(floor.y, v.y), Math.min(floor.z, v.z));
  }

  const convert = (v: Vector3): Vector3 =>
    outfitRest.add(
      floor.add(v.subtract(floor).scale(HIPS_BOB)).subtract(animRest).scale(scale),
    );

  const remapped = source.clone();
  remapped.setKeys(
    keys.map((key) => {
      const out: IAnimationKey = { frame: key.frame, value: convert(key.value as Vector3) };
      // Tangents are deltas: they take the same scaling, never the offset.
      const tangentScale = scale * HIPS_BOB;
      if (key.inTangent) out.inTangent = (key.inTangent as Vector3).scale(tangentScale);
      if (key.outTangent) out.outTangent = (key.outTangent as Vector3).scale(tangentScale);
      if (key.interpolation !== undefined) out.interpolation = key.interpolation;
      return out;
    }),
  );
  return remapped;
}

/**
 * Extra yaw applied to every rig instance so the character faces where the
 * renderer aims it (`yaw = atan2(dx, dz)`, i.e. +Z at yaw 0, matching the
 * primitive actors).
 *
 * Zero because Babylon's glTF loader already turns these characters to +Z as
 * part of its right-to-left-handed conversion. Do not set this by eye from a
 * screenshot — a hood looks much the same from either side. Measure it: put the
 * skeleton in its rest pose, then check that `ball_l - foot_l` (toes) and
 * `clavicle_r - clavicle_l` (shoulder line) agree with the mesh's yaw.
 */
const RIG_YAW = 0;

interface LoadedRig {
  scene: Scene;
  anims: AssetContainer;
  packs: Map<Pack, AssetContainer>;
}

let loaded: LoadedRig | null = null;
let pending: Promise<void> | null = null;

/**
 * Fetch the humanoid assets once, before the render loop starts.
 *
 * Failure is not fatal: headless tests and offline loads leave `loaded` null and
 * every caller falls back to the primitive actor, so the lab still runs.
 */
export function loadPlayerRig(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();
  if (pending) return pending;

  pending = (async () => {
    const [anims, ranger, peasant] = await Promise.all([
      LoadAssetContainerAsync(ANIM_URL, scene),
      LoadAssetContainerAsync(PACK_URL.ranger, scene),
      LoadAssetContainerAsync(PACK_URL.peasant, scene),
    ]);
    loaded = {
      scene,
      anims,
      packs: new Map<Pack, AssetContainer>([
        ["ranger", ranger],
        ["peasant", peasant],
      ]),
    };
  })()
    .catch(() => {
      loaded = null;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function isRigReady(scene: Scene): boolean {
  return loaded !== null && loaded.scene === scene;
}

/** Drop the cached containers — the scene that owns them is going away. */
export function resetPlayerRig(): void {
  loaded = null;
  pending = null;
}

/**
 * One animated character instance, parented under an actor root that the
 * renderer keeps positioning and turning as before.
 */
export class RigActor {
  private readonly scene: Scene;
  private readonly host: Mesh;
  private readonly pivot: TransformNode;
  private readonly groups = new Map<RigClip, AnimationGroup>();

  private entries: InstantiatedEntries | null = null;
  private borrowed: Mesh[] = [];
  private active: AnimationGroup | null = null;
  private activeClip: RigClip | null = null;
  private locomotion: RigClip = "idle";

  private currentOutfit: Outfit;

  constructor(scene: Scene, host: Mesh, outfit: Outfit) {
    this.scene = scene;
    this.host = host;
    this.currentOutfit = outfit;
    this.pivot = new TransformNode(`${host.name}-rig`, scene);
    this.pivot.parent = host;
    this.pivot.rotation.y = RIG_YAW;
    this.build(outfit);
  }

  get outfit(): Outfit {
    return this.currentOutfit;
  }

  /** Swap armour. The skeleton and the clip set are rebuilt from the new pack. */
  setOutfit(outfit: Outfit): void {
    if (outfit === this.currentOutfit) return;
    this.currentOutfit = outfit;
    this.build(outfit); // re-enters the current locomotion clip itself
  }

  /** Pick and pace the locomotion clip from the actor's real ground speed. */
  setLocomotion(speed: number): void {
    const clip = clipForSpeed(speed);
    this.locomotion = clip;
    const group = this.groups.get(clip);
    if (group) group.speedRatio = speedRatioFor(clip, speed);
    this.switchTo(clip);
  }

  /**
   * Fire the spell animation. It drives the upper body only, so it layers over
   * whatever the legs are doing: cast while running and the character keeps
   * running, arm outstretched, instead of freezing mid-stride.
   */
  playCast(): void {
    const group = this.groups.get("cast");
    if (!group) return;
    group.stop();
    group.start(false, 1);
  }

  dispose(): void {
    this.teardown();
    this.pivot.dispose();
  }

  private switchTo(clip: RigClip): void {
    const group = this.groups.get(clip);
    if (!group || this.activeClip === clip) return;
    this.active?.stop();
    group.start(CLIP_LOOPS[clip], group.speedRatio);
    this.active = group;
    this.activeClip = clip;
  }

  private build(outfit: Outfit): void {
    this.teardown();
    const spec = OUTFIT[outfit];
    const container = loaded?.packs.get(spec.pack);
    if (!container || !loaded) return;

    // doNotInstantiate: a skinned mesh needs its own skeleton, not a GPU instance.
    const entries = container.instantiateModelsToScene((n) => n, false, {
      doNotInstantiate: true,
    });
    this.entries = entries;

    const byName = new Map<string, Node>();
    for (const root of entries.rootNodes) {
      root.parent = this.pivot;
      byName.set(root.name, root);
      for (const child of root.getDescendants(false)) byName.set(child.name, child);
    }

    // Pieces from another pack. Same joint order, same inverse bind matrices, so
    // pointing the clone at this skeleton is the whole of the "re-rig".
    const skeleton = entries.skeletons[0];
    if (spec.borrow && skeleton) {
      // Hang the piece off whatever node already carries this pack's own skinned
      // meshes, so it inherits the same armature transform.
      const worn = [...byName.values()].find(
        (n): n is Mesh => n instanceof Mesh && n.skeleton !== null,
      );
      for (const piece of spec.borrow) {
        const source = loaded.packs.get(piece.pack)?.meshes.find((m) => m.name === piece.mesh);
        if (!(source instanceof Mesh)) continue;
        const clone = source.clone(`${this.host.name}-${piece.mesh}`, worn?.parent ?? this.pivot);
        if (!clone) continue;
        clone.skeleton = skeleton;
        this.borrowed.push(clone);
      }
    }

    // Read the hips rest pose before any clip starts and could move it.
    const hipsNode = byName.get(HIPS_BONE);
    const hipsRest = hipsNode instanceof TransformNode ? hipsNode.position.clone() : null;

    for (const clip of Object.keys(CLIP_NAME) as RigClip[]) {
      const source = loaded.anims.animationGroups.find((g) => g.name === CLIP_NAME[clip]);
      if (!source) continue;

      // Retarget by bone name. Rotation keyframes are shared with the source
      // container, which is read-only, so instances cost only the group; the
      // hips curve is the one that has to be rebuilt per rig.
      const upperOnly = UPPER_BODY_CLIPS.has(clip);
      const group = new AnimationGroup(`${this.host.name}-${clip}`, this.scene);
      for (const targeted of source.targetedAnimations) {
        const sourceNode = targeted.target as Node;
        if (upperOnly && LOWER_BODY.has(sourceNode.name)) continue;
        const target = byName.get(sourceNode.name);
        if (!target) continue;
        const property = targeted.animation.targetProperty;

        if (property === ROTATION) {
          group.addTargetedAnimation(targeted.animation, target);
        } else if (
          property === TRANSLATION &&
          sourceNode.name === HIPS_BONE &&
          hipsRest &&
          sourceNode instanceof TransformNode
        ) {
          group.addTargetedAnimation(
            remapHips(targeted.animation, sourceNode.position, hipsRest),
            target,
          );
        }
      }
      if (group.targetedAnimations.length === 0) {
        group.dispose();
        continue;
      }
      group.normalize(source.from, source.to);
      group.enableBlending = true;
      group.blendingSpeed = 0.12;
      this.groups.set(clip, group);
    }

    this.active = null;
    this.activeClip = null;
    this.switchTo(this.locomotion);
  }

  private teardown(): void {
    for (const group of this.groups.values()) group.dispose();
    this.groups.clear();
    for (const mesh of this.borrowed) mesh.dispose();
    this.borrowed = [];
    this.entries?.dispose();
    this.entries = null;
    this.active = null;
    this.activeClip = null;
  }
}

/** Metadata slot the actor root carries when it is a skinned rig, not primitives. */
export interface RigParts {
  rig: RigActor;
}

/**
 * Build a skinned player under `host`, or return null when the assets are not
 * loaded (headless tests, a failed fetch) so the caller can fall back.
 */
export function attachRig(scene: Scene, host: Mesh, outfit: Outfit = "ranger"): RigActor | null {
  if (!isRigReady(scene)) return null;
  return new RigActor(scene, host, outfit);
}

/** The rig on an actor root, if it has one. */
export function rigOf(root: Mesh): RigActor | null {
  return (root.metadata as RigParts | null)?.rig ?? null;
}
