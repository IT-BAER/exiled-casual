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
export type RigClip = "idle" | "walk" | "run" | "cast" | "strikeA" | "strikeB";
export type StrikeClip = "strikeA" | "strikeB";

/** Alternated melee takes: two sword-derived slashes with opposite motion. */
export const STRIKE_CLIPS: readonly StrikeClip[] = ["strikeA", "strikeB"];

/** Clip names inside anim-library.glb — FBX2glTF prefixes every take with "Rig|". */
/**
 * The cast is the pack's `Spell_Simple_Shoot` mirrored onto the right arm by
 * `tools/build_cast_mirror.py`: the original raises the LEFT hand, but the wand
 * skins to `hand_r` and `castPoint()` bends the bolt to that hand, so unmirrored
 * it throws from the empty hand.
 */
export const CLIP_NAME: Record<RigClip, string> = {
  idle: "Rig|Idle_Loop",
  walk: "Rig|Walk_Loop",
  run: "Rig|Jog_Fwd_Loop",
  cast: "Rig|Spell_Simple_Shoot_R",
  strikeA: "Rig|Sword_Attack",
  // The pack ships one sword swing. The second take is that swing rolled onto a
  // downward diagonal and played back to front by `tools/build_slash_variant.py`
  // — a slash from the other side, not the pack's bare-fisted punch.
  strikeB: "Rig|Sword_Attack_Down",
};

const CLIP_LOOPS: Record<RigClip, boolean> = {
  idle: true,
  walk: true,
  run: true,
  cast: false,
  strikeA: false,
  strikeB: false,
};

/**
 * Ground speed (units/sec) each locomotion clip was authored at.
 *
 * The jog's 3.4 was a guess and it was low. Measured instead, by walking the
 * leg chain of `anim-library.glb` and taking each foot's travel per cycle:
 * the walk sweeps 0.002 rig units in 1.333s and the jog 0.004 in 0.933, so the
 * jog depicts 2.86x the walk's pace. Anchored on the walk's 1.4, that is 4.0 —
 * which is why the jog looked like it was bounding at the player's 3.5.
 */
const CLIP_SPEED: Record<"walk" | "run", number> = { walk: 1.4, run: 4.0 };

/**
 * Cadence trim. 1.0 paces a clip at exactly its own authored speed, so the
 * planted foot stays planted; anything above it turns the legs over faster
 * than the ground and buys shorter, quicker steps with a little slide.
 *
 * The jog is the compromise line. Its clip depicts 4.0 u/s (measured, see
 * CLIP_SPEED) and the player runs at 3.5, so a literal 1.0 would play it at
 * 0.875 and every step would be a bound. 1.32 (1.25 -> 1.4 -> here on the
 * owner's "match the step sounds" calls; 1.4 overshot slightly) lands the
 * playback at ~1.15 — quicker steps against the same ground speed, at the
 * price of a little more slide. The
 * alternative was the short-stride walk clip driven to 2.5x, which is a
 * power-walk and was rejected on sight.
 */
const CADENCE: Record<"walk" | "run", number> = { walk: 1, run: 1.32 };

const MIN_RATIO = 0.5;
const MAX_RATIO = 1.8;

/** Below this the actor counts as standing still. */
const IDLE_SPEED = 0.15;
/**
 * Above this the jog reads better than the walk. Player base speed is 3.5, and
 * it must land on the jog: pushing the threshold above it handed normal running
 * to the walk clip at 2.5x, which is a power-walk, not a run.
 */
const RUN_SPEED = 2.2;
/**
 * ...and below THIS a runner drops back to a walk. The gap is not decoration:
 * the sim sheds speed through a corner (down to 62 percent of the run), which
 * lands right on a single threshold and made the character flick between jog
 * and walk for the three ticks of every turn.
 */
const WALK_SPEED = 1.7;

/**
 * Which locomotion clip suits a ground speed, in units/sec. `current` is the
 * clip already playing, which is what makes the two thresholds a hysteresis
 * band rather than two ways to say the same thing.
 */
export function clipForSpeed(speed: number, current?: RigClip): RigClip {
  // Written so a NaN speed falls to idle rather than sprinting on the spot.
  if (!(speed >= IDLE_SPEED)) return "idle";
  if (current === "run") return speed < WALK_SPEED ? "walk" : "run";
  return speed < RUN_SPEED ? "walk" : "run";
}

/**
 * Playback rate that keeps the feet planted instead of skating: the clip is
 * driven by how fast the actor is really moving, the same principle the
 * primitive walk cycle uses. Clamped so extremes still read as a stride.
 */
/**
 * How the idle breath slows the longer a body stands still.
 *
 * A loop played at one rate is a machine: watch anyone stood waiting and the
 * first few breaths are the ones that still belong to the walk, and the rest
 * settle. `IDLE_SETTLE_SEC` is how long that takes and `IDLE_SETTLED` is where
 * it lands.
 *
 * It lands lower and takes longer than it did (0.75 over six seconds). At three
 * quarters the settle was over before anyone stood still long enough to notice
 * one had happened, which is the same as not having it: the point is that a
 * character left alone keeps getting calmer, so the arc has to run past the
 * span of attention rather than inside it. Not lower than this — under about
 * half speed the chest stops moving between frames and a standing body reads as
 * paused, which is the thing the breath is there to prevent.
 */
export const IDLE_SETTLE_SEC = 14;
export const IDLE_SETTLED = 0.58;

/** Playback rate for an idle that has been standing for `seconds`. */
export function idleRatio(seconds: number): number {
  const t = Math.min(1, Math.max(0, seconds / IDLE_SETTLE_SEC));
  return 1 + (IDLE_SETTLED - 1) * t;
}

/**
 * Playback rate that fits an authored action clip into the wind-up the
 * simulation actually granted, so the release pose lands on the tick the hit
 * does. Clamped: a wind-up shortened by cast speed must not turn the swing into
 * a one-frame twitch, and a slow one must not freeze it into a mime.
 */
export const ACTION_RATIO_MIN = 0.6;
export const ACTION_RATIO_MAX = 3;

/**
 * How far the mirrored cast clip bakes the arm off the direction it is meant to
 * point: about 16 degrees to the right. A fact about the ARM, and nothing else.
 */
export const CLIP_BIAS = 0.42;
/** Shoulder and neck limits, and how much of the residual the head takes. */
export const ARM_MAX = 1.4;
export const HEAD_MAX = 0.87;
export const HEAD_FOLLOW = 0.6;

/** Wrap to (-PI, PI]. */
function wrapPi(a: number): number {
  let w = a;
  while (w > Math.PI) w -= 2 * Math.PI;
  while (w < -Math.PI) w += 2 * Math.PI;
  return w;
}

/**
 * The two rotations one cast frame adds on top of the animated pose: how far
 * the arm chain and the head turn off the body's own facing.
 *
 * The head takes the raw residual and the arm takes it plus the clip's bias.
 * Sharing the bias with the neck was invisible while the body ignored the aim,
 * because the residual was large and the bias was a rounding error inside it.
 * Once a standing cast turned the body onto the target the residual went to
 * zero, and the bias was the only thing left: the head sat cocked 14 degrees to
 * one side for the whole cast, and swung there as the body came about.
 */
export function aimAngles(targetYaw: number, bodyYaw: number): { arm: number; head: number } {
  const aimYaw = wrapPi(-(targetYaw - bodyYaw) + CLIP_BIAS);
  const head = wrapPi(aimYaw - CLIP_BIAS);
  return {
    arm: Math.max(-ARM_MAX, Math.min(ARM_MAX, aimYaw)),
    head: Math.max(-HEAD_MAX, Math.min(HEAD_MAX, head)) * HEAD_FOLLOW,
  };
}
export function actionRatio(authoredSeconds: number, windowSeconds: number | undefined): number {
  if (!(authoredSeconds > 0) || !(windowSeconds !== undefined && windowSeconds > 0)) return 1;
  const matched = authoredSeconds / windowSeconds;
  return Math.min(ACTION_RATIO_MAX, Math.max(ACTION_RATIO_MIN, matched));
}

/** Authored length of a clip in seconds. */
function clipSeconds(group: AnimationGroup): number {
  const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
  return fps > 0 ? (group.to - group.from) / fps : 0;
}

/**
 * Restart a playing group at the frame it is currently on. The restart is the
 * point: `enableBlending` only ramps when a group STARTS, so a group that kept
 * playing underneath a one-shot takes its bones back in a single frame unless
 * it is bounced like this. Keeps phase and speed; only the ease is new.
 */
export function restartAtCurrentFrame(group: AnimationGroup, loop: boolean): void {
  if (!group.isPlaying) return;
  const frame = group.animatables[0]?.masterFrame ?? group.from;
  const ratio = group.speedRatio;
  group.stop();
  // Full range, then jump: passing `frame` as `from` would narrow every later
  // loop of the cycle to frame..to instead of resuming the whole clip.
  group.start(loop, ratio);
  group.goToFrame(frame);
}

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

/**
 * Equipment slots that change how the character looks.
 *
 * The two hands are slots like any other, which is the whole trick: a weapon is
 * a `weapon1.<look>.part` mesh skinned 100% to `hand_r` and an off-hand piece is
 * skinned to `hand_l`, so showing one is the same visibility flip that puts a
 * hood on a head. Nothing is parented, attached or driven per frame, and a
 * weapon swap costs exactly what an armour swap costs: nothing.
 */
export type CosmeticSlot =
  | "weapon1" | "weapon2" | "helmet" | "body" | "gloves" | "boots" | "belt";

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = [
  "weapon1", "weapon2", "helmet", "body", "gloves", "boots", "belt",
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
 * agrees with the art too. It is one shape for its whole slot, though, so what
 * still does not vary per base is the cut - only the colour. The helmet has no
 * such shape: a shell grown off the cowl's crown read as a swim cap, so a helmet
 * base recolours the cloth until one is modelled (`build_wardrobe.py`).
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
  // The three class starter bodies. These are what make a class visible: the
  // coat geometry is the same either way, so the base id picking a different
  // palette is the ONLY thing separating an Ironsworn from an Emberbound on a
  // wardrobe with one male rig and two looks per slot.
  "base.ironsworn_plate": "/textures/gear/ironsworn_plate.png",
  "base.stalker_leathers": "/textures/gear/stalker_leathers.png",
  "base.emberbound_robe": "/textures/gear/emberbound_robe.png",
  // The shields. Held gear samples one texel, and untextured that texel is the
  // helm's bright grey, which renders the plate as a white slab. The bake is
  // what gives each shield its own iron, leather and ember palette.
  "base.ember_buckler": "/textures/gear/ember_buckler.png",
  "base.ashwall_tower_shield": "/textures/gear/ashwall_tower_shield.png",
  // The main hand and the stone beside it. The wand carries a projection of its
  // own icon up the shaft (`rod_uv`) and the focus one pinned texel, so without
  // an entry here the wand wears the clothing atlas stretched along it.
  "base.emberwand": "/textures/gear/emberwand.png",
  "base.ashen_focus": "/textures/gear/ashen_focus.png",
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
  weapon1: "base.emberwand",
  weapon2: "base.ember_buckler",
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
  weapon1: null, weapon2: null,
  helmet: null, body: "commoner", gloves: null, boots: "commoner", belt: null,
};

/**
 * What the character wears with *something* in the slot. Deliberately one look
 * per slot rather than a per-base table: with a single armoured set authored so
 * far, mapping every base onto it means any new item is visible the day it is
 * added instead of silently rendering as commoner cloth.
 */
const EQUIPPED: Looks = {
  weapon1: "wand", weapon2: "focus",
  helmet: "hood", body: "ranger", gloves: "bracers", boots: "ranger", belt: "ranger",
};

/**
 * Bases whose geometry is not their slot's default one.
 *
 * The armour slots get away with a single look each because a robe and a plate
 * are both a coat; a hand does not, because the off hand holds either a floating
 * orb or a slab of iron and picking the wrong one is not a wrong colour, it is
 * the wrong object. So the hands are the one place a base names its own mesh,
 * and everything absent here keeps `EQUIPPED`'s default.
 *
 * One mesh per shield, not one shared plate: a buckler and a tower shield are
 * different objects in the icons and at arm's length, and the palette bake alone
 * could only make one shape two colours. Both are modelled where they sit on a
 * standing character (`tools/build_wardrobe.py`), so the hold is the same and the
 * silhouette is not.
 */
const LOOK_BY_BASE: Record<string, string> = {
  "base.ember_buckler": "buckler",
  "base.ashwall_tower_shield": "tower",
  // Body bases whose silhouette is their own, not the generic coat: the plate is
  // bulkier and stops at tassets, the leather is a slim knee-length cut (both
  // `body.<look>.coat` in `build_wardrobe.py`). A base with no entry here still
  // wears `EQUIPPED.body` (the ranger coat), so the robe classes are unchanged
  // until that floor-length look lands.
  "base.ironsworn_plate": "plate",
  "base.stalker_leathers": "leather",
  // The three armour slots plate now has geometry of its own in. Each piece is
  // derived from the one it covers (`build_over` / `build_tassets`), so what
  // separates them from the ranger gear underneath is bulk and a hard flat-shaded
  // edge, not a different cut - the palette bake does the rest. The helmet is
  // still absent: a helmet base recolours the cowl.
  "base.ember_gauntlets": "plate",
  "base.ashen_treads": "plate",
  "base.cinderchain_sash": "plate",
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
 *
 * One chain per coat column, which is the ratio that matters rather than the
 * number. The chains are the only geometry collision acts on, so a column with
 * no chain of its own is skinned to the average of its two neighbours, lies on
 * neither, and hangs in the gap between the collided lines where no capsule can
 * reach it — 0.088 out at the hem, wider than the thigh capsule that is supposed
 * to be pushing it. Raising the count alone does nothing if the coat's ring is
 * raised with it. Must match `SKIRT_CHAINS` in `tools/build_wardrobe.py`, which
 * derives it from `COAT_SEG`; `rig.test.ts` pins the pair and the binding.
 */
export const SKIRT_CHAINS = 32;

/**
 * Bones per chain, and how many places the coat may fold on its way down.
 *
 * Two could not fold at all where it mattered: each bone was 0.464 long against
 * a thigh capsule of radius 0.088, and a bar five times the leg's width can only
 * pivot about its one joint, never dent. A leg pressing into the middle of a
 * panel had nowhere to put the cloth and went through it. Must match
 * `SKIRT_JOINTS` in `tools/build_wardrobe.py`; `rig.test.ts` pins the pair.
 */
export const SKIRT_JOINTS = 3;
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
 * These are maximum radial extents measured from the exported GLB by
 * `tools/measure_wardrobe_colliders.py`, plus 8mm cloth thickness. The old
 * median-width capsules were substantially inside the rendered geometry, so a
 * mathematically clear collider still showed a boot through the coat. Boots get
 * their own profile because the ranger greaves extend above the calf and the
 * commoner shoes are wider at the foot.
 */
const SKIRT_COLLIDERS: readonly {
  from: string; to: string; commoner: number; ranger: number;
}[] = [
  // The coat is authored against the upper-leg median, so its fitted yoke is
  // the separation surface there. Maximum thigh width would cage the waist.
  { from: "thigh_l", to: "calf_l", commoner: 0.088, ranger: 0.088 },
  { from: "thigh_r", to: "calf_r", commoner: 0.088, ranger: 0.088 },
  { from: "calf_l", to: "foot_l", commoner: 0.123, ranger: 0.124 },
  { from: "calf_r", to: "foot_r", commoner: 0.123, ranger: 0.124 },
  { from: "foot_l", to: "ball_l", commoner: 0.117, ranger: 0.109 },
  { from: "foot_r", to: "ball_r", commoner: 0.117, ranger: 0.109 },
];

/** Down the bone: glTF joints out of Blender point along their own +Y. */
const BONE_AXIS = new Vector3(0, 1, 0);

/**
 * Everything about one skirt chain that never changes, read off the asset once
 * so no measurement lives in two places.
 */
interface SkirtChain {
  /** The chain's bones, waist first. */
  joints: TransformNode[];
  /** Bind rotations, so a solved direction can be applied without losing roll. */
  bind: Quaternion[];
  /** Bind direction of each bone, in its own parent's space. */
  bindDir: Vector3[];
  /** Where the chain hangs from, in pelvis space. */
  anchor: Vector3;
  /** Bind position of each joint's tail, in pelvis space. */
  rests: Vector3[];
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

/** Where a spell leaves the body: the weapon hand, the same one `weapon1` skins to. */
const HAND_BONE = "hand_r";

/**
 * Bones a layered clip must not touch, so it can play over locomotion without
 * fighting it for the legs. Leaf tips are included by name from both packs.
 */
const LOWER_BODY: ReadonlySet<string> = new Set([
  "root", HIPS_BONE,
  "thigh_l", "calf_l", "foot_l", "ball_l", "ball_leaf_l", "foot_end_l",
  "thigh_r", "calf_r", "foot_r", "ball_r", "ball_leaf_r", "foot_end_r",
]);

/**
 * Weapon-hand bones layered actions must not touch, or the fingers open and the
 * weapon floats. The grip is whatever the locomotion clip left them at.
 */
const WEAPON_HAND: ReadonlySet<string> = new Set([
  "hand_r",
  "thumb_01_r", "thumb_02_r", "thumb_03_r", "thumb_04_leaf_r",
  "index_01_r", "index_02_r", "index_03_r", "index_04_leaf_r",
  "middle_01_r", "middle_02_r", "middle_03_r", "middle_04_leaf_r",
  "ring_01_r", "ring_02_r", "ring_03_r", "ring_04_leaf_r",
  "pinky_01_r", "pinky_02_r", "pinky_03_r", "pinky_04_leaf_r",
]);

/** Clips that layer over locomotion instead of replacing it. */
const UPPER_BODY_CLIPS: ReadonlySet<RigClip> = new Set<RigClip>(["cast", ...STRIKE_CLIPS]);

/** Whether locomotion keeps ownership of the pelvis and legs under this clip. */
export const isLayeredClip = (clip: RigClip): boolean => UPPER_BODY_CLIPS.has(clip);

/**
 * How much of a clip's hips bounce to keep, PER CLIP. The jog is authored with
 * 26% of hip height of vertical travel, which on this character is a 0.25-unit
 * hop and reads as bounding rather than running. The curve is compressed toward
 * its lowest point rather than toward the rest pose, so the bottom of the stride
 * — where the foot is planted — stays exactly where it was and only the peak
 * comes down. Tuned by eye against the jog: 1.0 bounds like a hop, 0.4 lifeless.
 *
 * **A standing clip must keep all of it.** Only the legs are retargeted raw;
 * the hips are the one curve this rig rewrites, so shrinking it silently breaks
 * whatever the legs were counter-rotating against. `Idle_Loop` is authored
 * foot-planted — the hips breathe 10.4mm and the knees and ankles hold the soles
 * still — so taking a third of that away leaves the legs over-rotated and the
 * residual comes out at the FEET, which is what the character floating on the
 * menu plate was. Replaying the clip onto `wardrobe.glb` offline and measuring
 * the lowest 2% of `boots.ranger.boots`: 0.65 travels 4.68mm, 1.0 travels
 * 1.76mm — the rest is the anim rig's legs being ~7% shorter than this one's,
 * which no single scalar fixes.
 *
 * Locomotion is exempt on purpose: those clips slide the feet anyway.
 */
export const HIPS_BOB: Record<RigClip, number> = {
  idle: 1, walk: 0.65, run: 0.65, cast: 1, strikeA: 1, strikeB: 1,
};

/**
 * Re-express a hips translation curve in the target rig's proportions: keep the
 * target's rest position, and add the clip's motion away from its own rest,
 * scaled by how much bigger this rig's hips offset is. The bounce is then
 * compressed toward the curve's lowest point (see `HIPS_BOB`).
 */
function remapHips(
  source: Animation,
  animRest: Vector3,
  outfitRest: Vector3,
  bob: number,
): Animation {
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
      floor.add(v.subtract(floor).scale(bob)).subtract(animRest).scale(scale),
    );

  const remapped = source.clone();
  remapped.setKeys(
    keys.map((key) => {
      const out: IAnimationKey = { frame: key.frame, value: convert(key.value as Vector3) };
      // Tangents are deltas: they take the same scaling, never the offset.
      const tangentScale = scale * bob;
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
/**
 * The load in flight, AND the scene it is loading into.
 *
 * Both halves matter. An asset container belongs to the scene it was loaded
 * with, so a second scene asking while the first is still loading cannot be
 * handed that promise: it would resolve with `loaded.scene` pointing at somebody
 * else's scene, `isRigReady` would answer false, and `attachRig` would return
 * null for a character nobody could see. That is not hypothetical — it is the
 * menu and the game, and in dev it is one screen twice, because StrictMode
 * mounts, unmounts and remounts every effect.
 */
let pending: { scene: Scene; promise: Promise<void> } | null = null;

/**
 * Fetch the humanoid assets once per scene, before the render loop starts.
 *
 * Failure is not fatal: headless tests and offline loads leave `loaded` null and
 * every caller falls back to the primitive actor, so the lab still runs.
 */
export function loadPlayerRig(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();
  if (pending?.scene === scene) return pending.promise;

  // A load already running for a DIFFERENT scene is queued behind rather than
  // shared, so the containers this caller ends up with are its own.
  const prior = pending?.promise ?? Promise.resolve();
  const promise = prior
    .catch(() => undefined)
    .then(async () => {
      if (loaded?.scene === scene) return;
      const [anims, wardrobe] = await Promise.all([
        LoadAssetContainerAsync(ANIM_URL, scene),
        LoadAssetContainerAsync(WARDROBE_URL, scene),
      ]);
      loaded = { scene, anims, wardrobe };
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

export function isRigReady(scene: Scene): boolean {
  return loaded !== null && loaded.scene === scene;
}

/**
 * Drop the cached containers — the scene that owns them is going away.
 *
 * Pass the scene being disposed and the cache is only cleared if it actually
 * belongs to it. Without that, an abandoned scene tearing down (a fast
 * navigation, or StrictMode's discarded first mount) wipes the cache the LIVE
 * scene is about to read, and the character silently fails to appear. Called
 * with no argument it still clears everything, which is what a full teardown
 * wants.
 */
export function resetPlayerRig(scene?: Scene): void {
  if (scene !== undefined && loaded !== null && loaded.scene !== scene) return;
  loaded = null;
  if (scene === undefined || pending?.scene === scene) pending = null;
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
  private nextStrikeIndex = 0;
  private locomotion: RigClip = "idle";
  /** Seconds this body has been standing still, for the breath to settle over. */
  private standing = 0;

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
  /** The casting hand, so a spell can be drawn leaving it. */
  private hand: TransformNode | null = null;
  /** Bones that carry the cast toward the cursor: spine, clavicle, upper arm. */
  private aimBones: TransformNode[] = [];
  /** World-space aim target (x = Babylon x, z = Babylon z). */
  private aimTarget: { x: number; z: number } | null = null;
  /** Observer that applies aim rotation after the animation system runs. */
  private aimObserver: Observer<Scene> | null = null;
  private colliders: (SkirtCollider & {
    head: TransformNode;
    tail: TransformNode;
    previousA: Vector3;
    previousB: Vector3;
    commonerRadius: number;
    rangerRadius: number;
    initialized: boolean;
  })[] = [];
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
  /** Rotation of the current bone's parent, relative to the pelvis. */
  private readonly cumulative = new Quaternion();
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

  /**
   * Stand as though he had been here a while.
   *
   * The menu's characters are not arriving anywhere: nobody watched them stop.
   * In game the breath settles because `setLocomotion` is called every frame and
   * the standing clock runs; a menu asks for the idle once and would otherwise
   * hold the full-rate breath of a man who just came to a halt, forever.
   */
  standSettled(): void {
    this.standing = IDLE_SETTLE_SEC;
    this.setLocomotion(0);
  }

  /** Pick and pace the locomotion clip from the actor's real ground speed. */
  setLocomotion(speed: number): void {
    const clip = clipForSpeed(speed, this.locomotion);
    this.locomotion = clip;
    const group = this.groups.get(clip);
    if (clip === "idle") {
      // Real seconds off the engine, not a tick count: this is a render-side
      // flourish and the sim never hears about it.
      this.standing += (this.scene.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000;
      if (group) group.speedRatio = idleRatio(this.standing);
    } else {
      this.standing = 0;
      if (group) group.speedRatio = speedRatioFor(clip, speed);
    }
    this.switchTo(clip);
  }

  /**
   * Fire the spell animation. It drives the upper body only, so it layers over
   * whatever the legs are doing: cast while running and the character keeps
   * running, arm outstretched, instead of freezing mid-stride.
   */
  playCast(seconds?: number): void {
    const group = this.groups.get("cast");
    if (!group) return;
    group.stop();
    const ratio = actionRatio(clipSeconds(group), seconds);
    group.speedRatio = ratio;
    // Played ONCE, paced to the wind-up: looping it at a fixed rate meant a
    // third of a second of cast only ever showed the first third of the swing,
    // so the bolt left a hand that was still lifting.
    group.start(false, ratio);
    group.onAnimationGroupEndObservable.addOnce(this.easeOutToLocomotion);
  }

  /** Alternate authored weapon-arm attacks while locomotion keeps the legs. */
  playStrike(seconds?: number): void {
    const clip = STRIKE_CLIPS[this.nextStrikeIndex]!;
    const group = this.groups.get(clip);
    if (!group) return;
    for (const strike of STRIKE_CLIPS) this.groups.get(strike)?.stop();
    const ratio = actionRatio(clipSeconds(group), seconds);
    group.speedRatio = ratio;
    group.start(false, ratio);
    group.onAnimationGroupEndObservable.addOnce(this.easeOutToLocomotion);
    this.nextStrikeIndex = (this.nextStrikeIndex + 1) % STRIKE_CLIPS.length;
  }

  /** Cancel a strike when the actor is removed or otherwise reset. */
  stopStrike(): void {
    for (const strike of STRIKE_CLIPS) this.groups.get(strike)?.stop();
  }

  /** Set the world-space point the casting arm should aim at. */
  setAimTarget(worldX: number, worldZ: number): void {
    this.aimTarget = { x: worldX, z: worldZ };
  }

  dispose(): void {
    this.teardown();
    this.pivot.dispose();
  }

  /**
   * Ease the bones back to locomotion when a one-shot cast or strike lets go.
   *
   * enableBlending only ramps at a START: the locomotion group has been playing
   * underneath the whole time, so when the action clip ends (or is stopped) it
   * takes the upper body back in one frame — that snap is what this removes.
   * Restarting the group at the frame it is already on keeps the legs' phase
   * and buys the blend-in from wherever the action pose left the arms.
   */
  private easeOutToLocomotion = (): void => {
    const group = this.groups.get(this.locomotion);
    if (group) restartAtCurrentFrame(group, CLIP_LOOPS[this.locomotion]);
  };

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

    const handNode = byName.get(HAND_BONE);
    this.hand = handNode instanceof TransformNode ? handNode : null;
    // Bones the aim rotates during a cast: spine, clavicle, upper arm, and head.
    // Each bone gets a share of the aim so the twist distributes naturally.
    // Weights are how much of the TOTAL aim each bone carries; they sum > 1
    // because the child inherits the parent and the clip's own baked direction
    // already biases the arm, so they have to over-correct.
    const AIM_CHAIN: { name: string; weight: number }[] = [
      { name: "spine_03", weight: 0.5 },
      { name: "clavicle_r", weight: 0.7 },
      { name: "upperarm_r", weight: 1.0 },
    ];
    const HEAD_BONE_NAME = "Head";
    this.aimBones = [];
    const aimWeights: number[] = [];
    let headBone: TransformNode | null = null;
    for (const { name, weight } of AIM_CHAIN) {
      const node = byName.get(name);
      if (node instanceof TransformNode) {
        this.aimBones.push(node);
        aimWeights.push(weight);
      }
    }
    const hb = byName.get(HEAD_BONE_NAME);
    if (hb instanceof TransformNode) headBone = hb;

    // Scratch vectors for the aim solver.
    const worldUp = new Vector3(0, 1, 0);
    const localAxis = new Vector3();
    const parentInv = new Matrix();

    // Rotate `bone` by `angle` radians around world Y, expressed in the bone's
    // parent space. This is the key: `rotationQuaternion` is in PARENT space,
    // so a world-up yaw has to be transformed into that frame first.
    const aimBone = (bone: TransformNode, angle: number) => {
      bone.computeWorldMatrix(true);
      const parent = bone.parent as TransformNode | null;
      if (!parent) return;
      parent.computeWorldMatrix(true);
      parent.getWorldMatrix().invertToRef(parentInv);
      Vector3.TransformNormalToRef(worldUp, parentInv, localAxis);
      localAxis.normalize();
      const rot = bone.rotationQuaternion;
      if (rot) {
        Quaternion.RotationAxisToRef(localAxis, angle, this.delta);
        rot.multiplyInPlace(this.delta);
      }
    };

    this.aimObserver = this.scene.onAfterAnimationsObservable.add(() => {
      if (!this.aimTarget) return;
      const castGroup = this.groups.get("cast");
      const casting = castGroup !== undefined && castGroup.isPlaying;
      if (!casting) return;

      this.pivot.computeWorldMatrix(true);

      const px = this.pivot.absolutePosition.x;
      const pz = this.pivot.absolutePosition.z;
      const tdx = this.aimTarget.x - px;
      const tdz = this.aimTarget.z - pz;
      if (tdx * tdx + tdz * tdz < 0.01) return;

      const { arm, head } = aimAngles(Math.atan2(tdx, tdz), this.host.rotation.y);
      for (let i = 0; i < this.aimBones.length; i++) {
        aimBone(this.aimBones[i]!, arm * aimWeights[i]!);
      }
      // The head follows the aim too, but on its own angle: see `aimAngles`.
      if (headBone) aimBone(headBone, head);
    });

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
      const upperOnly = isLayeredClip(clip);
      const group = new AnimationGroup(`${this.host.name}-${clip}`, this.scene);
      for (const targeted of source.targetedAnimations) {
        const sourceNode = targeted.target as Node;
        if (upperOnly && (LOWER_BODY.has(sourceNode.name) || WEAPON_HAND.has(sourceNode.name))) continue;
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
            remapHips(targeted.animation, sourceNode.position, hipsRest, HIPS_BOB[clip]),
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
      // blendingSpeed is a per-frame lerp factor, so the ease shortens as the
      // display speeds up: 0.12 is ~130ms at 60Hz but ~50ms at 165Hz, which is
      // where "the cast snaps in" came from. Action clips take a softer ramp;
      // locomotion keeps the tighter one so a stop still plants the feet.
      group.blendingSpeed = isLayeredClip(clip) ? 0.06 : 0.12;
      this.groups.set(clip, group);
    }

    this.active = null;
    this.activeClip = null;
    this.nextStrikeIndex = 0;
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
      const joints: TransformNode[] = [];
      for (let j = 1; j <= SKIRT_JOINTS; j++) {
        const bone = byName.get(skirtJointName(i, j));
        if (!(bone instanceof TransformNode)) return;
        bone.computeWorldMatrix(true);
        joints.push(bone);
      }

      // The joints arrive with a rotation quaternion from the glTF loader; the
      // euler fallback is only there so a hand-edited asset cannot crash this.
      const bind = joints.map((b) =>
        (b.rotationQuaternion ?? Quaternion.FromEulerVector(b.rotation)).clone(),
      );
      // Every bone in a chain is baked to the same length, so one number drives
      // every constraint in the solver.
      const segment = joints[1]!.position.length();
      const last = joints[SKIRT_JOINTS - 1]!;

      // Each joint's rest point is the *next* joint's head, and the last one's
      // is its own tail, which is the hem.
      const rests = joints.map((b, j) =>
        Vector3.TransformCoordinates(
          j + 1 < SKIRT_JOINTS ? joints[j + 1]!.absolutePosition : Vector3.TransformCoordinates(BONE_AXIS.scale(segment), last.getWorldMatrix()),
          toPelvis,
        ),
      );

      chains.push({
        joints,
        bind,
        bindDir: bind.map((q) => BONE_AXIS.applyRotationQuaternion(q)),
        anchor: Vector3.TransformCoordinates(joints[0]!.absolutePosition, toPelvis),
        rests,
      });
      this.anchorsWorld.push(new Vector3());
      for (let j = 0; j < SKIRT_JOINTS; j++) this.restsWorld.push(new Vector3());
    }

    for (const { from, to, commoner, ranger } of SKIRT_COLLIDERS) {
      const head = byName.get(from);
      const tail = byName.get(to);
      if (head instanceof TransformNode && tail instanceof TransformNode) {
        this.colliders.push({
          head, tail,
          a: new Vector3(), b: new Vector3(),
          previousA: new Vector3(), previousB: new Vector3(),
          radius: commoner,
          commonerRadius: commoner,
          rangerRadius: ranger,
          initialized: false,
        });
      }
    }

    this.pelvis = pelvis;
    this.skirtChains = chains;
    this.skirt = new SkirtSim(chains.length, SKIRT_JOINTS, chains[0]!.joints[1]!.position.length());
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
      for (let j = 0; j < SKIRT_JOINTS; j++) {
        Vector3.TransformCoordinatesToRef(chain.rests[j]!, world, this.restsWorld[i * SKIRT_JOINTS + j]!);
      }
    }
    const rangerBoots = this.looks.boots !== null && meshLook(this.looks.boots) === "ranger";
    for (const collider of this.colliders) {
      collider.radius = rangerBoots ? collider.rangerRadius : collider.commonerRadius;
      if (collider.initialized) {
        collider.previousA.copyFrom(collider.a);
        collider.previousB.copyFrom(collider.b);
      }
      collider.head.computeWorldMatrix(true);
      collider.tail.computeWorldMatrix(true);
      collider.a.copyFrom(collider.head.absolutePosition);
      collider.b.copyFrom(collider.tail.absolutePosition);
      if (!collider.initialized) {
        collider.previousA.copyFrom(collider.a);
        collider.previousB.copyFrom(collider.b);
        collider.initialized = true;
      }
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

      // Down the chain, because each bone's parent is the one above it and this
      // loop has already moved that: the target has to come back out of pelvis
      // space through every rotation applied so far, which `cumulative` carries.
      for (let j = 0; j < SKIRT_JOINTS; j++) {
        sim.direction(i, j, anchor, this.solved);
        Vector3.TransformNormalToRef(this.solved, this.toPelvis, this.local);
        this.local.normalize();

        if (j > 0) {
          // Into the parent's frame, then aim within it.
          this.cumulative.conjugateToRef(this.delta);
          this.local.applyRotationQuaternionToRef(this.delta, this.relative);
          this.local.copyFrom(this.relative);
        }
        // Composing onto the bind rotation rather than replacing it is what
        // keeps the cloth's texture from spinning on the bone.
        Quaternion.FromUnitVectorsToRef(chain.bindDir[j]!, this.local, this.delta);
        this.delta.multiplyToRef(chain.bind[j]!, this.aimed);
        (chain.joints[j]!.rotationQuaternion ??= new Quaternion()).copyFrom(this.aimed);

        // The parent frame the next bone will be aimed inside of.
        if (j === 0) this.cumulative.copyFrom(this.aimed);
        else this.cumulative.multiplyInPlace(this.aimed);
      }
    }
  }

  /**
   * Where the casting hand is this frame, in world space, or null on a rig that
   * fell back to primitives.
   *
   * Read live rather than cached: the arm is mid-animation at the moment of the
   * cast, which is the entire reason the body centre was the wrong answer.
   */
  castPoint(): Vector3 | null {
    if (!this.hand) return null;
    this.hand.computeWorldMatrix(true);
    // Offset along the bone's direction to reach the weapon tip rather than the
    // palm. glTF bones point along their own +Y, so transforming (0, WEAPON_TIP, 0)
    // through the bone's world matrix lands at the tip.
    const WEAPON_TIP = 0.45;
    const tip = Vector3.TransformCoordinates(
      new Vector3(0, WEAPON_TIP, 0),
      this.hand.getWorldMatrix(),
    );
    return tip;
  }

  /**
   * Hand the skeleton over to the physics: every clip stopped, and the coat
   * solver taken off the render loop. Both would otherwise keep writing bones
   * that a ragdoll now owns, and the loser of that fight is whichever runs first.
   */
  stopForDeath(): void {
    for (const group of this.groups.values()) group.stop();
    this.active = null;
    this.activeClip = null;
    this.nextStrikeIndex = 0;
    if (this.cloth) this.scene.onBeforeRenderObservable.remove(this.cloth);
    this.cloth = null;
  }

  private teardown(): void {
    if (this.cloth) this.scene.onBeforeRenderObservable.remove(this.cloth);
    this.cloth = null;
    this.skirt = null;
    this.skirtChains = [];
    this.colliders = [];
    this.pelvis = null;
    this.hand = null;
    this.aimBones = [];
    this.aimTarget = null;
    if (this.aimObserver) this.scene.onAfterAnimationsObservable.remove(this.aimObserver);
    this.aimObserver = null;
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
    this.nextStrikeIndex = 0;
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
    const look = (baseId !== undefined ? LOOK_BY_BASE[baseId] : undefined) ?? EQUIPPED[slot];
    out[slot] = look + (baseId !== undefined && baseId in GEAR_TEXTURE ? `#${baseId}` : "");
  }
  return out;
}
