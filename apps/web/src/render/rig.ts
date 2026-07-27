import {
  Animation,
  AnimationGroup,
  Matrix,
  Mesh,
  PBRMaterial,
  Quaternion,
  Texture,
  TransformNode,
  Vector3,
  LoadAssetContainerAsync,
  type AssetContainer,
  type IAnimationKey,
  type InstantiatedEntries,
  type Material,
  type Node,
  type Observer,
  type Scene,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { SkirtSim, type SkirtCollider } from "./skirt";

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

/**
 * The character is one asset, `wardrobe.glb`, carrying every slot's geometry on
 * a single 65-joint skeleton. `tools/build_wardrobe.py` cuts it out of the two
 * source packs offline, because neither pack is modular on its own: each welds
 * its sleeves to its bare forearms, and neither ships a head at all — the ranger
 * only looks finished because his hood *is* his head.
 *
 * Every part is named `slot.look.part`, so dressing the character is pure
 * visibility: show the meshes of the chosen look, hide the rest of that slot.
 * Nothing is instantiated or rebuilt when gear changes, which is what keeps a
 * mid-stride armour swap from restarting the walk cycle.
 */
const WARDROBE_URL = "/models/wardrobe.glb";

/** Equipment slots that change how the character looks. */
export type CosmeticSlot = "helmet" | "body" | "gloves" | "boots" | "belt";

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = [
  "helmet", "body", "gloves", "boots", "belt",
];

/**
 * A look per slot, or null for "wearing nothing there".
 *
 * A look is `<mesh look>`, optionally followed by `#<base id>`: the mesh look
 * picks the geometry, the base id picks the armour texture that geometry wears
 * (see `GEAR_TEXTURE`). Only the part before the `#` ever names a mesh.
 */
export type Looks = Record<CosmeticSlot, string | null>;

/** The geometry half of a look value — what `slot.<this>.part` is named after. */
export function meshLook(look: string): string {
  return look.split("#")[0]!;
}

/**
 * Armour texture per item base, baked by `tools/build_gear_textures.py`.
 *
 * The character wears one authored outfit and the item art is charred iron with
 * ember in the seams, so equipping an Emberweave Robe used to leave him in green
 * linen — the inventory and the world looked like two different games. New
 * geometry per base is out of reach, so the material is what changes: each base
 * gets the ranger atlas re-palettized to that icon's own colours, and only
 * `albedoTexture` is swapped at runtime.
 *
 * Shape is not something a texture can fix, and it is not this table's job: the
 * armoured body carries a generated coat (`body.ranger.coat`) so the silhouette
 * agrees with the art too. That coat is one shape for the whole slot, though, so
 * what still does not vary per base is the cut - only the colour.
 *
 * Keys are item base ids. A base with no entry keeps the authored look, so an
 * unmapped base renders as green ranger gear rather than as nothing.
 */
const GEAR_TEXTURE: Record<string, string> = {
  "base.cinder_cap": "/textures/gear/cinder_cap.png",
  "base.emberweave_robe": "/textures/gear/emberweave_robe.png",
  "base.ember_gauntlets": "/textures/gear/ember_gauntlets.png",
  "base.ashen_treads": "/textures/gear/ashen_treads.png",
  "base.cinderchain_sash": "/textures/gear/cinderchain_sash.png",
};

/** Base ids the character has a baked armour texture for. Pinned by `rig.test.ts`. */
export const GEAR_TEXTURE_BASES: readonly string[] = Object.keys(GEAR_TEXTURE);

/**
 * What the lab preview puts in each slot. The preview exists so the wardrobe can
 * be checked without farming five drops, and a preview that skipped the base ids
 * would show the authored green outfit — the one thing the armour textures are
 * there to replace.
 */
const PREVIEW_BASE: Record<CosmeticSlot, string> = {
  helmet: "base.cinder_cap",
  body: "base.emberweave_robe",
  gloves: "base.ember_gauntlets",
  boots: "base.ashen_treads",
  belt: "base.cinderchain_sash",
};

/** A stand-in equipped item for the lab preview, shaped like the snapshot's. */
export function previewItemFor(slot: CosmeticSlot): { baseId: string } {
  return { baseId: PREVIEW_BASE[slot] };
}

/*
 * Rarity used to recolour these looks, and it is deliberately gone.
 *
 * The idea was sound — there is one authored armoured set per slot, so a rare
 * and a normal helmet are the same hood, and a drop the player cannot see did
 * not really pay out. The execution was not. Two findings are worth keeping so
 * the next attempt does not repeat them:
 *
 * 1. Albedo cannot tint these packs at all. `albedoColor` multiplies the
 *    authored texture, and that texture is a saturated green, so a gold factor
 *    moved the rendered hood by about 3% — invisible under the play camera.
 * 2. Emissive does shift the hue, whatever is baked underneath, but the scene's
 *    glow layer blooms it and the usable range is tiny: 0.34 rendered a
 *    featureless glowing man, and even 0.04 washed the whole outfit one colour.
 *
 * That is the real problem: tinting every part of a slot recolours the entire
 * silhouette instead of reading as "this piece is special". A second look needs
 * accent *geometry*, not a colour pass over the geometry that is already there.
 */

/**
 * What the character wears with the slot empty. Body and boots are never bare:
 * an unequipped character is a commoner in shirt and shoes, the way PoE2 starts
 * you clothed rather than naked.
 */
const UNEQUIPPED: Looks = {
  helmet: null, body: "commoner", gloves: null, boots: "commoner", belt: null,
};

/**
 * What the character wears with *something* in the slot. Deliberately one look
 * per slot rather than a per-base table: with a single armoured set authored so
 * far, mapping every base onto it means any new item is visible the day it is
 * added instead of silently rendering as commoner cloth.
 */
const EQUIPPED: Looks = {
  helmet: "hood", body: "ranger", gloves: "bracers", boots: "ranger", belt: "ranger",
};

const HEAD_PREFIX = "base.head.";

/** The part of a look that the cloth solver drives, if the look has one. */
const COAT_PART = ".coat";

/**
 * The hair cap, which is the one head part a helmet really does replace.
 *
 * The rest of the head stays on under a helmet. The wardrobe's only helmet look
 * is the ranger's hood, and that hood is an open-faced cowl, not a closed shape:
 * hiding the whole head under it left the character looking out of an empty
 * hood. Hair is different — it sits proud of the skull and would push through
 * the cowl — so it is the only part that comes off.
 */
const HAIR_PART = `${HEAD_PREFIX}hair`;

/**
 * The bones the coat hangs from, baked by `tools/build_wardrobe.py`: a ring of
 * chains under the pelvis, each two joints deep, carrying no animation at all.
 * `SkirtSim` is what puts them somewhere; see `skirt.ts` for why the coat is not
 * simply skinned to the legs.
 */
const SKIRT_CHAINS = 8;
const skirtJointName = (chain: number, joint: number): string =>
  `skirt_${chain}_${String(joint).padStart(2, "0")}`;

/**
 * What the cloth is pushed out of: a capsule down each bone of both legs.
 *
 * Every one of them earns its place. Spheres at the knee and the ankle left the
 * shin bare between them, and the hem hangs at exactly that height, so a stride
 * ran the boot straight through the coat. The foot needs its own because a boot
 * reaches a long way forward of the ankle it pivots on.
 *
 * Radii are the leg's real half-width plus nothing: each capsule clears the
 * coat's rest radius by 0.01-0.08, so a standing character's coat hangs in its
 * exact bind pose and only a moving limb ever touches it.
 */
const SKIRT_COLLIDERS: readonly { from: string; to: string; radius: number }[] = [
  { from: "thigh_l", to: "calf_l", radius: 0.11 },
  { from: "thigh_r", to: "calf_r", radius: 0.11 },
  { from: "calf_l", to: "foot_l", radius: 0.11 },
  { from: "calf_r", to: "foot_r", radius: 0.11 },
  { from: "foot_l", to: "ball_l", radius: 0.1 },
  { from: "foot_r", to: "ball_r", radius: 0.1 },
];

/** Down the bone: glTF joints out of Blender point along their own +Y. */
const BONE_AXIS = new Vector3(0, 1, 0);

/**
 * Everything about one skirt chain that never changes, read off the asset once
 * so no measurement lives in two places.
 */
interface SkirtChain {
  upper: TransformNode;
  lower: TransformNode;
  /** Bind rotations, so a solved direction can be applied without losing roll. */
  bindUpper: Quaternion;
  bindLower: Quaternion;
  /** Bind directions: the upper in pelvis space, the lower in the upper's. */
  bindDirUpper: Vector3;
  bindDirLower: Vector3;
  /** Bind positions in pelvis space: waist, joint, hem tip. */
  anchor: Vector3;
  mid: Vector3;
  tip: Vector3;
}

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
  wardrobe: AssetContainer;
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
    const [anims, wardrobe] = await Promise.all([
      LoadAssetContainerAsync(ANIM_URL, scene),
      LoadAssetContainerAsync(WARDROBE_URL, scene),
    ]);
    loaded = { scene, anims, wardrobe };
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
  private active: AnimationGroup | null = null;
  private activeClip: RigClip | null = null;
  private locomotion: RigClip = "idle";

  /** Every wardrobe part, grouped `slot` -> `look` -> meshes. */
  private readonly parts = new Map<string, Map<string, Mesh[]>>();
  private readonly headParts: Mesh[] = [];
  private looks: Looks = { ...UNEQUIPPED };

  /** The material each part was exported with, before any gear texture. */
  private readonly baseMaterials = new Map<Mesh, Material | null>();
  /** Re-textured clones, `<source material id>#<base id>` -> clone. Built once, reused. */
  private readonly gearedMaterials = new Map<string, PBRMaterial>();

  /** Coat cloth. Null when the wardrobe has no skirt chains (an older asset). */
  private skirt: SkirtSim | null = null;
  private skirtChains: SkirtChain[] = [];
  private pelvis: TransformNode | null = null;
  private colliders: (SkirtCollider & { head: TransformNode; tail: TransformNode })[] = [];
  private cloth: Observer<Scene> | null = null;
  /** Solving cloth nobody can see is the one cost worth a flag. */
  private coatVisible = false;

  // Per-frame scratch, so the cloth does not allocate 300 vectors a frame.
  private readonly anchorsWorld: Vector3[] = [];
  private readonly restsWorld: Vector3[] = [];
  private readonly toPelvis = new Matrix();
  private readonly solved = new Vector3();
  private readonly local = new Vector3();
  private readonly relative = new Vector3();
  private readonly delta = new Quaternion();
  private readonly aimed = new Quaternion();

  constructor(scene: Scene, host: Mesh) {
    this.scene = scene;
    this.host = host;
    this.pivot = new TransformNode(`${host.name}-rig`, scene);
    this.pivot.parent = host;
    this.pivot.rotation.y = RIG_YAW;
    this.build();
    this.applyLooks();
  }

  get currentLooks(): Looks {
    return { ...this.looks };
  }

  /**
   * Dress the character. Only visibility moves, so this is safe to call every
   * frame from the snapshot without disturbing the animation.
   */
  setLooks(looks: Looks): void {
    let changed = false;
    for (const slot of COSMETIC_SLOTS) {
      if (this.looks[slot] !== looks[slot]) {
        this.looks[slot] = looks[slot];
        changed = true;
      }
    }
    if (changed) this.applyLooks();
  }

  private applyLooks(): void {
    let coat = false;
    for (const [slot, byLook] of this.parts) {
      const wanted = this.looks[slot as CosmeticSlot] ?? null;
      const wantedLook = wanted === null ? null : meshLook(wanted);
      const baseId = wanted === null ? undefined : wanted.split("#")[1];
      for (const [look, meshes] of byLook) {
        const on = look === wantedLook;
        for (const mesh of meshes) {
          mesh.setEnabled(on);
          if (on && mesh.name.includes(COAT_PART)) coat = true;
          // Only the visible look pays for the swap; a hidden one is re-dressed
          // when it comes back.
          if (on) mesh.material = this.geared(mesh, baseId);
        }
      }
    }
    // Cloth that was hidden has been swinging nowhere; drop it back onto the
    // bind pose so it does not snap into place in front of the player.
    if (coat && !this.coatVisible) this.skirt?.unsettle();
    this.coatVisible = coat;
    // A helmet takes the hair off, not the head: see `HAIR_PART`.
    const bare = this.looks.helmet === null;
    for (const mesh of this.headParts) {
      mesh.setEnabled(bare || !mesh.name.startsWith(HAIR_PART));
    }
  }

  /**
   * The material `mesh` should wear for an equipped base: its own, or a clone of
   * it carrying that base's armour texture.
   *
   * Clones are per rig actor, and the source material is never touched, because
   * it belongs to the read-only asset container every instance is built from —
   * re-texturing it in place would dress the disenchanter in the player's gear.
   *
   * The texture is *cloned from the material's own* and then pointed at a new
   * URL rather than constructed fresh. A new `Texture` would default to Babylon's
   * own invertY and UV set, and the glTF loader does not use those, so a
   * hand-built one lands upside down on a hand-authored atlas.
   */
  private geared(mesh: Mesh, baseId: string | undefined): Material | null {
    let base = this.baseMaterials.get(mesh);
    if (base === undefined) this.baseMaterials.set(mesh, (base = mesh.material));

    const url = baseId === undefined ? undefined : GEAR_TEXTURE[baseId];
    // An unmapped base, or a material with no albedo to replace, keeps the
    // authored look: wrong-coloured armour beats an invisible limb.
    if (!url || !(base instanceof PBRMaterial) || !(base.albedoTexture instanceof Texture)) {
      return base;
    }

    const key = `${base.uniqueId}#${baseId}`;
    let clone = this.gearedMaterials.get(key);
    if (!clone) {
      clone = base.clone(`${base.name}#${baseId}`);
      const texture = base.albedoTexture.clone();
      if (texture) {
        texture.updateURL(url);
        clone.albedoTexture = texture;
      }
      this.gearedMaterials.set(key, clone);
    }
    return clone;
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

  private build(): void {
    this.teardown();
    if (!loaded) return;

    // doNotInstantiate: a skinned mesh needs its own skeleton, not a GPU instance.
    const entries = loaded.wardrobe.instantiateModelsToScene((n) => n, false, {
      doNotInstantiate: true,
    });
    this.entries = entries;

    const byName = new Map<string, Node>();
    for (const root of entries.rootNodes) {
      root.parent = this.pivot;
      byName.set(root.name, root);
      for (const child of root.getDescendants(false)) byName.set(child.name, child);
    }

    // Index the parts by the `slot.look.part` names the builder emits. Cloned
    // instances keep the source name plus a Babylon suffix, so the slot and look
    // are read off the first two dot-separated fields and nothing else.
    for (const node of byName.values()) {
      if (!(node instanceof Mesh)) continue;
      const [slot, look] = node.name.split(".");
      if (slot === undefined || look === undefined) continue;
      if (node.name.startsWith(HEAD_PREFIX)) {
        this.headParts.push(node);
        continue;
      }
      let byLook = this.parts.get(slot);
      if (!byLook) this.parts.set(slot, (byLook = new Map()));
      const list = byLook.get(look);
      if (list) list.push(node);
      else byLook.set(look, [node]);
    }

    // Read the hips rest pose before any clip starts and could move it.
    const hipsNode = byName.get(HIPS_BONE);
    const hipsRest = hipsNode instanceof TransformNode ? hipsNode.position.clone() : null;

    // Same window: the coat's bind pose has to be measured before an animation
    // has moved anything, because it is the shape the cloth springs back to.
    if (hipsNode instanceof TransformNode) this.buildSkirt(hipsNode, byName);

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

  /**
   * Measure the coat's bind pose off the loaded asset and hang cloth on it.
   *
   * Nothing here is a constant: the chain count is the only number the code
   * knows, and the segment length, the rest positions and the joints' bind
   * rotations all come out of the glb. A wardrobe without the chains (an older
   * asset, or a load that fell back) simply leaves `skirt` null and the coat
   * rides the waist as plain skinned geometry.
   */
  private buildSkirt(pelvis: TransformNode, byName: Map<string, Node>): void {
    pelvis.computeWorldMatrix(true);
    const toPelvis = Matrix.Invert(pelvis.getWorldMatrix());
    const chains: SkirtChain[] = [];

    for (let i = 0; i < SKIRT_CHAINS; i++) {
      const upper = byName.get(skirtJointName(i, 1));
      const lower = byName.get(skirtJointName(i, 2));
      if (!(upper instanceof TransformNode) || !(lower instanceof TransformNode)) return;
      upper.computeWorldMatrix(true);
      lower.computeWorldMatrix(true);

      // The joints arrive with a rotation quaternion from the glTF loader; the
      // euler fallback is only there so a hand-edited asset cannot crash this.
      const bindUpper = (upper.rotationQuaternion ?? Quaternion.FromEulerVector(upper.rotation)).clone();
      const bindLower = (lower.rotationQuaternion ?? Quaternion.FromEulerVector(lower.rotation)).clone();
      const segment = lower.position.length();
      const tipLocal = BONE_AXIS.scale(segment);

      chains.push({
        upper,
        lower,
        bindUpper,
        bindLower,
        bindDirUpper: BONE_AXIS.applyRotationQuaternion(bindUpper),
        bindDirLower: BONE_AXIS.applyRotationQuaternion(bindLower),
        anchor: Vector3.TransformCoordinates(upper.absolutePosition, toPelvis),
        mid: Vector3.TransformCoordinates(lower.absolutePosition, toPelvis),
        tip: Vector3.TransformCoordinates(
          Vector3.TransformCoordinates(tipLocal, lower.getWorldMatrix()),
          toPelvis,
        ),
      });
      this.anchorsWorld.push(new Vector3());
      this.restsWorld.push(new Vector3(), new Vector3());
    }

    for (const { from, to, radius } of SKIRT_COLLIDERS) {
      const head = byName.get(from);
      const tail = byName.get(to);
      if (head instanceof TransformNode && tail instanceof TransformNode) {
        this.colliders.push({ head, tail, a: new Vector3(), b: new Vector3(), radius });
      }
    }

    this.pelvis = pelvis;
    this.skirtChains = chains;
    // Both joints of a chain are baked to the same length, so one number drives
    // every constraint in the solver.
    this.skirt = new SkirtSim(chains.length, chains[0]!.lower.position.length());
    this.cloth = this.scene.onBeforeRenderObservable.add(() => this.solveCloth());
  }

  /**
   * Swing the coat, once per frame.
   *
   * The cloth is solved in world space and the result is written back as joint
   * rotations, which means the order is: read where the body put the waist this
   * frame, integrate, then aim each joint down the segment the solver produced.
   * World matrices are forced rather than assumed current — this runs alongside
   * the animation update and must not depend on which of them Babylon ran first.
   */
  private solveCloth(): void {
    const sim = this.skirt;
    const pelvis = this.pelvis;
    if (!sim || !pelvis || !this.coatVisible) return;

    pelvis.computeWorldMatrix(true);
    const world = pelvis.getWorldMatrix();
    for (let i = 0; i < this.skirtChains.length; i++) {
      const chain = this.skirtChains[i]!;
      Vector3.TransformCoordinatesToRef(chain.anchor, world, this.anchorsWorld[i]!);
      Vector3.TransformCoordinatesToRef(chain.mid, world, this.restsWorld[i * 2]!);
      Vector3.TransformCoordinatesToRef(chain.tip, world, this.restsWorld[i * 2 + 1]!);
    }
    for (const collider of this.colliders) {
      collider.head.computeWorldMatrix(true);
      collider.tail.computeWorldMatrix(true);
      collider.a.copyFrom(collider.head.absolutePosition);
      collider.b.copyFrom(collider.tail.absolutePosition);
    }

    sim.step(
      this.scene.getEngine().getDeltaTime() / 1000,
      this.anchorsWorld,
      this.restsWorld,
      this.colliders,
    );

    // Through the inverse matrix, not through the world rotation: Babylon's glTF
    // loader mirrors the scene to convert handedness, so the pelvis's world
    // matrix has determinant -1 and `decompose` hands back a rotation with an
    // axis flipped. Solved directions came back Y-inverted and the coat folded up
    // over the character's head. The matrix carries the mirror correctly; joint
    // rotations below then stay in un-mirrored local space, where they belong.
    world.invertToRef(this.toPelvis);

    for (let i = 0; i < this.skirtChains.length; i++) {
      const chain = this.skirtChains[i]!;
      const anchor = this.anchorsWorld[i]!;

      // Upper joint: its parent is the pelvis, so the solved world direction is
      // aimed in pelvis space. Composing onto the bind rotation rather than
      // replacing it is what keeps the cloth's texture from spinning on the bone.
      sim.direction(i, 0, anchor, this.solved);
      Vector3.TransformNormalToRef(this.solved, this.toPelvis, this.local);
      this.local.normalize();
      Quaternion.FromUnitVectorsToRef(chain.bindDirUpper, this.local, this.delta);
      this.delta.multiplyToRef(chain.bindUpper, this.aimed);
      (chain.upper.rotationQuaternion ??= new Quaternion()).copyFrom(this.aimed);

      // Lower joint: its parent is the upper one, which the line above just
      // moved, so the target has to come back out of pelvis space through it.
      sim.direction(i, 1, anchor, this.solved);
      Vector3.TransformNormalToRef(this.solved, this.toPelvis, this.local);
      this.local.normalize();
      this.aimed.conjugateToRef(this.delta);
      this.local.applyRotationQuaternionToRef(this.delta, this.relative);
      Quaternion.FromUnitVectorsToRef(chain.bindDirLower, this.relative, this.delta);
      this.delta.multiplyToRef(chain.bindLower, this.aimed);
      (chain.lower.rotationQuaternion ??= new Quaternion()).copyFrom(this.aimed);
    }
  }

  private teardown(): void {
    if (this.cloth) this.scene.onBeforeRenderObservable.remove(this.cloth);
    this.cloth = null;
    this.skirt = null;
    this.skirtChains = [];
    this.colliders = [];
    this.pelvis = null;
    this.anchorsWorld.length = 0;
    this.restsWorld.length = 0;
    this.coatVisible = false;
    for (const group of this.groups.values()) group.dispose();
    this.groups.clear();
    this.parts.clear();
    this.headParts.length = 0;
    for (const clone of this.gearedMaterials.values()) {
      clone.albedoTexture?.dispose();
      clone.dispose();
    }
    this.gearedMaterials.clear();
    this.baseMaterials.clear();
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
export function attachRig(scene: Scene, host: Mesh): RigActor | null {
  if (!isRigReady(scene)) return null;
  return new RigActor(scene, host);
}

/** The rig on an actor root, if it has one. */
export function rigOf(root: Mesh): RigActor | null {
  return (root.metadata as RigParts | null)?.rig ?? null;
}

/**
 * Which look each slot should wear, given what is equipped. Any item in a slot
 * shows that slot's armoured look; an empty slot falls back to the commoner
 * clothes, so the character is never rendered bare. The item's *base* picks the
 * armour texture that look wears; its rarity is deliberately not consulted,
 * because recolouring a whole slot by tier washes the silhouette one colour
 * instead of pointing at the piece that is special.
 */
export function looksForEquipment(equipped: Partial<Record<CosmeticSlot, unknown>>): Looks {
  const out = { ...UNEQUIPPED };
  for (const slot of COSMETIC_SLOTS) {
    const item = equipped[slot];
    if (item === undefined) continue;
    const baseId = (item as { baseId?: string } | null)?.baseId;
    out[slot] = EQUIPPED[slot] + (baseId !== undefined && baseId in GEAR_TEXTURE ? `#${baseId}` : "");
  }
  return out;
}
