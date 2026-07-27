import {
  Animation,
  AnimationGroup,
  Color3,
  Mesh,
  PBRMaterial,
  TransformNode,
  Vector3,
  LoadAssetContainerAsync,
  type AssetContainer,
  type IAnimationKey,
  type InstantiatedEntries,
  type Material,
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
 * A look is `<mesh look>` optionally followed by `#<variant>`: the mesh look
 * picks the geometry, the variant recolours it (see `RARITY_TINT`). Only the
 * part before the `#` ever appears in a mesh name.
 */
export type Looks = Record<CosmeticSlot, string | null>;

/** The geometry half of a look value — what `slot.<this>.part` is named after. */
export function meshLook(look: string): string {
  return look.split("#")[0]!;
}

/**
 * Armour tiers that recolour the armoured look instead of replacing it.
 *
 * There is exactly one authored armoured set per slot and no second source pack
 * to cut a second one from, so a rare and a normal helmet are the same hood. But
 * a drop the player cannot *see* on their character did not really pay out
 * (docs/09 rule: a reward you can't hear and see didn't happen), and the tier
 * that matters is rarity, not which base rolled. So the same geometry is tinted
 * toward the rarity colour the HUD already uses for the item's frame and ground
 * label — the worn gear and the label that sold it agree.
 *
 * Applied as *emissive*, not as an albedo multiply. Multiplying was tried first
 * and cannot work: albedo multiplies the authored texture, and that texture is a
 * saturated green, so a gold factor moved the rendered hood by about 3% — under
 * the play camera, nothing. Emissive adds, so it shifts the hue whatever the
 * texture underneath is baked to, and the faint glow reads as "this piece is
 * special" on its own.
 *
 * Eye-tuned against the hood at the play camera, and the useful range is narrow
 * because the scene's glow layer picks emissive up and blooms it: at 0.34 the
 * character rendered as a featureless glowing man, so these sit near 0.1, where
 * the hue reads and the armour's own shading survives. Normal and magic wear the
 * authored colours untouched.
 */
const RARITY_TINT: Record<string, Color3> = {
  rare: new Color3(0.042, 0.032, 0.008),
  unique: new Color3(0.048, 0.021, 0.007),
};

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

  /** The material each part was exported with, before any rarity tint. */
  private readonly baseMaterials = new Map<Mesh, Material | null>();
  /** Tinted clones, `<source material id>#<variant>` -> clone. Cloned once, reused. */
  private readonly tints = new Map<string, PBRMaterial>();

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
    for (const [slot, byLook] of this.parts) {
      const wanted = this.looks[slot as CosmeticSlot] ?? null;
      const wantedLook = wanted === null ? null : meshLook(wanted);
      const variant = wanted === null ? undefined : wanted.split("#")[1];
      for (const [look, meshes] of byLook) {
        const on = look === wantedLook;
        for (const mesh of meshes) {
          mesh.setEnabled(on);
          // Only the visible look pays for a material swap; the hidden ones keep
          // whatever they last wore and get re-tinted when they come back.
          if (on) mesh.material = this.tinted(mesh, variant);
        }
      }
    }
    // A helmet takes the hair off, not the head: see `HAIR_PART`.
    const bare = this.looks.helmet === null;
    for (const mesh of this.headParts) {
      mesh.setEnabled(bare || !mesh.name.startsWith(HAIR_PART));
    }
  }

  /**
   * The material `mesh` should wear for a rarity variant: its own, or a tinted
   * clone of it. Clones are per rig actor because the source materials are
   * shared with the read-only asset container, which must not be recoloured out
   * from under anything else instantiated from it.
   */
  private tinted(mesh: Mesh, variant: string | undefined): Material | null {
    let base = this.baseMaterials.get(mesh);
    if (base === undefined) this.baseMaterials.set(mesh, (base = mesh.material));

    const tint = variant === undefined ? undefined : RARITY_TINT[variant];
    // Non-PBR materials have no albedo to push, so they render untinted rather
    // than not at all — a missing tint is a smaller bug than a missing limb.
    if (!tint || !(base instanceof PBRMaterial)) return base;

    const key = `${base.uniqueId}#${variant}`;
    let clone = this.tints.get(key);
    if (!clone) {
      clone = base.clone(`${base.name}#${variant}`);
      // Babylon multiplies emissiveColor by emissiveTexture, so a black emissive
      // map (which is what these packs ship) would swallow the tint entirely.
      clone.emissiveTexture = null;
      clone.emissiveColor = tint;
      this.tints.set(key, clone);
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
    this.parts.clear();
    this.headParts.length = 0;
    for (const clone of this.tints.values()) clone.dispose();
    this.tints.clear();
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
 * clothes, so the character is never rendered bare. A rare or unique item adds
 * its rarity tint on top of that look, so the tier is visible on the character
 * and not only in the tooltip.
 */
export function looksForEquipment(equipped: Partial<Record<CosmeticSlot, unknown>>): Looks {
  const out = { ...UNEQUIPPED };
  for (const slot of COSMETIC_SLOTS) {
    const item = equipped[slot];
    if (item === undefined) continue;
    const rarity = (item as { rarity?: string } | null)?.rarity;
    out[slot] = EQUIPPED[slot] + (rarity !== undefined && rarity in RARITY_TINT ? `#${rarity}` : "");
  }
  return out;
}
