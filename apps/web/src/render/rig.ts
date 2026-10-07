import {
  Animation,
  AnimationGroup,
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  LoadAssetContainerAsync,
  MeshoptCompression,
  type AssetContainer,
  type IAnimationKey,
  type InstantiatedEntries,
  type Node,
  type Observer,
  type Scene,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { SkirtSim, type SkirtCollider } from "./skirt";
import { ARROW_LENGTH, buildArrow, swingTrail } from "./skill-fx";

/**
 * Skinned player actor: a base body on a 65-bone Unreal-named skeleton, and
 * animation clips retargeted onto it by bone name.
 *
 * The animation library's clip tracks and the wardrobe's own skeleton share
 * every bone name, so a clip drives the rig without retargeting machinery.
 */

/** Clips the game can actually trigger today. */
export type RigClip =
  | "idle" | "walk" | "run" | "walkBack" | "runBack" | "runBackL" | "runBackR"
  | "walkStrafeL" | "walkStrafeR" | "runStrafeL" | "runStrafeR"
  | "walkFwdL" | "walkFwdR" | "walkBackL" | "walkBackR" | "cast" | "bow" | "strikeA" | "strikeB" | "strikeC"
  | "hit" | "drink" | "open";
export type StrikeClip = "strikeA" | "strikeB" | "strikeC";

/** Melee takes played in turn: UAL2's regular sword chain, forehand, backhand, finisher. */
export const STRIKE_CLIPS: readonly StrikeClip[] = ["strikeA", "strikeB", "strikeC"];

/** The player's one-shot reactions: staggered by a heavy blow, a flask drunk, a chest opened. */
export type ReactionClip = "hit" | "drink" | "open";
export const REACTION_CLIPS: readonly ReactionClip[] = ["hit", "drink", "open"];

/** Clip names inside anim-library.glb — FBX2glTF prefixes every take with "Rig|". */
/**
 * The cast is the pack's `Spell_Simple_Shoot` mirrored onto the right arm by
 * `tools/build_cast_mirror.py`: the original raises the LEFT hand, but the wand
 * skins to `hand_r` and `castPoint()` bends the bolt to that hand, so unmirrored
 * it throws from the empty hand.
 */
export const CLIP_NAME: Record<RigClip, string> = {
  idle: "Rig|Idle_Loop",
  // The eight walks are UAL2's authored takes (`tools/import_ual2_clips.py`).
  // UAL2 has no jog off the forward line: the jog's sidesteps and backpedal are
  // made from it by `tools/build_direction_clips.py`.
  walk: "Rig|Walk_Fwd_Loop",
  run: "Rig|Jog_Fwd_Loop",
  walkFwdL: "Rig|Walk_Fwd_L_Loop",
  walkFwdR: "Rig|Walk_Fwd_R_Loop",
  walkStrafeL: "Rig|Walk_L_Loop",
  walkStrafeR: "Rig|Walk_R_Loop",
  walkBackL: "Rig|Walk_Bwd_L_Loop",
  walkBackR: "Rig|Walk_Bwd_R_Loop",
  walkBack: "Rig|Walk_Bwd_Loop",
  runStrafeL: "Rig|Jog_Strafe_L_Loop",
  runStrafeR: "Rig|Jog_Strafe_R_Loop",
  runBack: "Rig|Jog_Back_Loop",
  runBackL: "Rig|Jog_BackDiag_L_Loop",
  runBackR: "Rig|Jog_BackDiag_R_Loop",
  cast: "Rig|Spell_Simple_Shoot_R",
  // No bow take in the pack: keyed on the wardrobe skeleton by `tools/build_bow_clip.py`.
  bow: "Rig|Bow_Shoot",
  // UAL2's attack takes joined to their `_Rec` recovery (`tools/import_ual2_clips.py`).
  strikeA: "Rig|Sword_Regular_A",
  strikeB: "Rig|Sword_Regular_B",
  strikeC: "Rig|Sword_Regular_C",
  hit: "Rig|Hit_Knockback",
  drink: "Rig|Consume",
  open: "Rig|Chest_Open",
};

const CLIP_LOOPS: Record<RigClip, boolean> = {
  idle: true,
  walk: true,
  run: true,
  walkBack: true,
  walkStrafeL: true,
  walkStrafeR: true,
  runStrafeL: true,
  runStrafeR: true,
  runBack: true,
  runBackL: true,
  runBackR: true,
  walkFwdL: true,
  walkFwdR: true,
  walkBackL: true,
  walkBackR: true,
  cast: false,
  bow: false,
  strikeA: false,
  strikeB: false,
  strikeC: false,
  hit: false,
  drink: false,
  open: false,
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

export type Gait = "walk" | "run";

/** Which gait's pace a locomotion clip was authored at, or null for any other clip. */
export function gaitOf(clip: RigClip): Gait | null {
  if (clip.startsWith("run")) return "run";
  return clip.startsWith("walk") ? "walk" : null;
}

/**
 * The ways the legs move off the hips, per gait, in yaw order, positive to his
 * right. `stride` is each clip's step against its gait's forward one, off the
 * stance foot's sweep in anim-library.glb: UAL2's back walks step 1.2x the
 * forward walk, its sidesteps 0.66x. The jog's backpedal is made from the jog
 * with a shorter step (`STRIDE_CUT` in `tools/build_direction_clips.py`):
 * 1 - 0.25 * max(0, -cos(yaw)).
 */
export const DIRECTIONS: Record<Gait, readonly { yaw: number; clip: RigClip; stride: number }[]> = {
  walk: ([
    [-180, "walkBack", 1.2], [-135, "walkBackL", 1.2], [-90, "walkStrafeL", 0.66], [-45, "walkFwdL", 1],
    [0, "walk", 1], [45, "walkFwdR", 1], [90, "walkStrafeR", 0.66], [135, "walkBackR", 1.2], [180, "walkBack", 1.2],
  ] as const).map(([deg, clip, stride]) => ({ yaw: (deg * Math.PI) / 180, clip, stride })),
  run: ([
    [-180, "runBack", 0.75], [-110, "runBackL", 0.914], [-55, "runStrafeL", 1],
    [0, "run", 1], [55, "runStrafeR", 1], [110, "runBackR", 0.914], [180, "runBack", 0.75],
  ] as const).map(([deg, clip, stride]) => ({ yaw: (deg * Math.PI) / 180, clip, stride })),
};

/**
 * Where each locomotion clip plants the left foot, as a fraction of its cycle
 * (FK over anim-library.glb). The walks and the jog share neither a length nor a
 * phase, so a blend or a switch maps between them through this, not by frame.
 */
export const LEFT_PLANT: Partial<Record<RigClip, number>> = {
  walk: 0.958, walkFwdL: 0.958, walkFwdR: 0.958, walkStrafeL: 0.158, walkStrafeR: 0.183,
  walkBackL: 0.158, walkBack: 0.158, walkBackR: 0.158, run: 0.008, runStrafeL: 0.017, runStrafeR: 0.017,
  runBack: 0.017, runBackL: 0.017, runBackR: 0.017,
};

/** Frame of `to` in step with `frame` of `from`: the same share of a stride past the left plant. */
export function framePhaseMatched(from: RigClip, fromRange: readonly [number, number], frame: number,
  to: RigClip, toRange: readonly [number, number]): number {
  const span = (r: readonly [number, number]) => Math.max(1e-6, r[1] - r[0]);
  const u = (frame - fromRange[0]) / span(fromRange) - (LEFT_PLANT[from] ?? 0) + (LEFT_PLANT[to] ?? 0);
  return toRange[0] + (u - Math.floor(u)) * span(toRange);
}

/**
 * Farthest the hips turn toward the move, at a sidestep; the legs run the rest
 * off the hips. A quarter turn of hips reads as running across the chest.
 */
export const HIP_TURN = Math.PI * (35 / 180);
/** Bone yaw against host yaw: the glTF root's handedness flip runs one against the other. */
const LEG_YAW_SIGN = -1;
/** Time constant the hips ease toward their turn over: long enough to read as a turn, not a snap. */
const LEG_EASE_SEC = 0.25;
/** Radians the spine stands up from the jog's forward lean at a full sidestep. */
const STRAFE_UPRIGHT = 0.28;
/**
 * Radians the spine comes forward under an action clip at a full jogged
 * backpedal. That clip tilts the pelvis back (`BACK_LEAN` in
 * tools/build_direction_clips.py) and an upper-body clip does not key the
 * pelvis, so without this a shot or swing is thrown leaning backwards.
 */
const BACKPEDAL_FORWARD = 0.12;
/** Pitch about the body's right axis against "chest back", after the glTF handedness flip. */
const UPRIGHT_SIGN = 1;
/** Time constant the move's yaw off the chest eases over, so the direction blend sweeps. */
const MOVE_EASE_SEC = 0.08;
/** Crossfade lengths (s): locomotion short so a stop plants the feet, actions softer. */
const LOCO_BLEND_SEC = 0.14;
const ACTION_BLEND_SEC = 0.28;

/**
 * PoE2's run-and-gun: `rel` is the move's yaw off the way the chest faces
 * (positive to his right). The hips turn with the sideways share of it, none
 * straight ahead or behind, HIP_TURN at a sidestep.
 */
export function hipTurn(rel: number): number {
  return HIP_TURN * Math.sin(wrapPi(rel));
}

/**
 * The two DIRECTIONS neighbours either side of `legYaw` (the move's yaw off the
 * hips) and the weight of the second, linear in yaw, so the legs turn with the
 * move instead of switching clips at a border.
 */
export function directionBlend(legYaw: number, gait: Gait): { from: number; to: number; w: number } {
  const dirs = DIRECTIONS[gait];
  const y = wrapPi(legYaw);
  let i = 0;
  while (i < dirs.length - 2 && y > dirs[i + 1]!.yaw) i++;
  const a = dirs[i]!.yaw;
  const b = dirs[i + 1]!.yaw;
  return { from: i, to: i + 1, w: Math.min(1, Math.max(0, (y - a) / (b - a))) };
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

/** Where `Rig|Bow_Shoot` looses, as a fraction of it: `RELEASE / LAST` in `tools/build_bow_clip.py`. */
export const BOW_RELEASE = 12 / 30;

export interface StrikeTiming { drop: number; contact: number }

/**
 * Where each sword take starts its drop and where the blade stops, as fractions
 * of the clip, off the arm's angular speed in anim-library.glb (rig.test.ts
 * re-measures them). C opens with a feint, so its raise is the long one.
 */
export const STRIKE_TIMING: Record<StrikeClip, StrikeTiming> = {
  strikeA: { drop: 0.143, contact: 0.238 },
  strikeB: { drop: 0.128, contact: 0.213 },
  strikeC: { drop: 0.3, contact: 0.417 },
};
/** Share of the wind-up the raise gets. The drop gets the rest, so it snaps. */
const STRIKE_RAISE_SHARE = 0.7;
/** The drop may run faster than any other action: that speed is the weight. */
const STRIKE_DROP_MAX = 4;
/** Where the swing ribbon ends, as a fraction of the clip. */
const TRAIL_END = 0.5;

export interface StrikePace { raise: number; drop: number; follow: number }

/**
 * Three playback rates for one swing: a slow raise and a fast drop that together
 * reach the contact pose when the sim resolves the hit, then a follow-through
 * that fills the rest of the beat. No wind-up from the sim: one even rate.
 */
export function strikePace(clipSeconds: number, t: StrikeTiming, windupSeconds?: number, beatSeconds?: number): StrikePace {
  if (!(clipSeconds > 0) || !(windupSeconds !== undefined && windupSeconds > 0)) {
    const r = actionRatio(clipSeconds, beatSeconds);
    return { raise: r, drop: r, follow: r };
  }
  const clamp = (v: number, max: number) => Math.min(max, Math.max(ACTION_RATIO_MIN, v));
  const rest = (beatSeconds ?? 0) - windupSeconds;
  const raise = clamp((clipSeconds * t.drop) / (windupSeconds * STRIKE_RAISE_SHARE), ACTION_RATIO_MAX);
  // The drop gets what the raise left: a capped raise (C's feint) makes it snap harder.
  const left = Math.max(1e-6, windupSeconds - (clipSeconds * t.drop) / raise);
  return {
    raise,
    drop: clamp((clipSeconds * (t.contact - t.drop)) / left, STRIKE_DROP_MAX),
    follow: rest > 0 ? clamp((clipSeconds * (1 - t.contact)) / rest, ACTION_RATIO_MAX) : ACTION_RATIO_MAX,
  };
}

/** The rate for the phase `frac` (0..1 through the clip) is in. */
export function strikeRatioAt(frac: number, pace: StrikePace, t: StrikeTiming): number {
  return frac < t.drop ? pace.raise : frac < t.contact ? pace.drop : pace.follow;
}

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
export function aimAngles(
  targetYaw: number,
  bodyYaw: number,
  bias = CLIP_BIAS,
): { arm: number; head: number } {
  const aimYaw = wrapPi(-(targetYaw - bodyYaw) + bias);
  const head = wrapPi(aimYaw - bias);
  return {
    arm: Math.max(-ARM_MAX, Math.min(ARM_MAX, aimYaw)),
    head: Math.max(-HEAD_MAX, Math.min(HEAD_MAX, head)) * HEAD_FOLLOW,
  };
}
/** Farthest the neck and head turn off the chest together (~85 degrees), and the neck's share. */
export const LOOK_MAX = 1.48;
export const NECK_SHARE = 0.4;
/** Time constant the gaze eases over: quick, so the eyes lead a turn the body is still making. */
const LOOK_EASE_SEC = 0.1;
/** The aim chain's share of a cast that the chest carries; the head looks past it. */
const CHEST_AIM = 0.3;

/** How far the head turns off the body's facing to look along `lookYaw`, in bone yaw, clamped. */
/**
 * Pitch the spine takes on top of the clips, about the body's right axis
 * (positive stands it up). `actionFree` is 1 with no upper-body clip playing
 * and 0 under one; `moveRel` is the move's yaw off the facing.
 */
export function spinePitch(gait: Gait | null, moveRel: number, actionFree: number): number {
  if (gait !== "run") return 0;
  const sideways = actionFree * STRAFE_UPRIGHT * Math.abs(Math.sin(moveRel));
  const backpedal = (1 - actionFree) * BACKPEDAL_FORWARD * Math.max(0, -Math.cos(moveRel));
  return sideways - backpedal;
}

export function lookOffset(lookYaw: number, bodyYaw: number): number {
  return Math.max(-LOOK_MAX, Math.min(LOOK_MAX, wrapPi(-(lookYaw - bodyYaw))));
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

/** Yaw rate (rad/s) under which a standing body only drifts round; above it the feet step. */
export const TURN_STEP_RATE = 1.5;
/** How far the feet sit off the pivot (units): a turn at `rate` moves them rate x this. */
const TURN_FOOT_RADIUS = 0.25;
/** The shuffle's own pace range: the turn is over in a quarter second, so the walk's 0.5..1.8 is a stroll. */
const TURN_RATIO_MIN = 1.6;
const TURN_RATIO_MAX = 3;
/** Seconds the shuffle outlasts the turn, bridging a turn's slow tail; the idle crossfade adds ~0.14 s. */
const TURN_STEP_HOLD = 0.1;

/** The sidestep a standing turn at `rate` (rad/s, positive to his right) shuffles through, and its pace. */
export function turnStep(rate: number): { clip: RigClip; ratio: number } | null {
  if (!(Math.abs(rate) >= TURN_STEP_RATE)) return null;
  const clip: RigClip = rate > 0 ? "walkStrafeR" : "walkStrafeL";
  const matched = (Math.abs(rate) * TURN_FOOT_RADIUS) / CLIP_SPEED.walk;
  return { clip, ratio: Math.min(TURN_RATIO_MAX, Math.max(TURN_RATIO_MIN, matched)) };
}

export function speedRatioFor(clip: RigClip, speed: number): number {
  const gait = gaitOf(clip);
  if (gait === null) return 1;
  const matched = (speed / CLIP_SPEED[gait]) * CADENCE[gait];
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, matched));
}

/**
 * The character is one asset, `wardrobe.glb`: two base bodies (male, female),
 * each its own skeleton, each carrying its fixed hair, brows and eyes.
 * `tools/build_wardrobe.py` cuts it out of the Quaternius base-character packs.
 *
 * Every part is named `slot.look.part`; the one slot is `base` and a look
 * (`male` or `female`) is shown by enabling its parts and hiding every other
 * look's. Nothing is instantiated or rebuilt when the look changes, which is
 * what keeps a mid-stride swap from restarting the walk cycle.
 */
const WARDROBE_URL = "/models/wardrobe.glb";

// The served wardrobe is meshopt-packed (`tools/pack_wardrobe.mjs`). Babylon's
// default decoder is a script tag off its CDN, which the CSP blocks and node
// tests cannot load, so the loader gets the bundled decoder instead.
(MeshoptCompression as unknown as { _Default: unknown })._Default = {
  async decodeGltfBufferAsync(source: Uint8Array, count: number, stride: number, mode: string, filter?: string) {
    await MeshoptDecoder.ready;
    return MeshoptDecoder.decodeGltfBufferAsync(count, stride, source, mode, filter);
  },
};

/** The skeleton the runtime drives. The wardrobe also ships `Armature_female`,
 * whose 65 bones carry the same names, and nothing selects her yet. */
const MALE_RIG = "Armature";

/** Every skeleton root the wardrobe ships, wired or not. */
const RIG_ROOT = /^Armature(_[a-z]+)?$/;

/**
 * The wardrobe slots. `base` is the body; the rest are gear, and they are named
 * for the equipment slots the sim already uses (`EquipSlotId`) so that dressing
 * the character is a lookup and never a translation table.
 *
 * Gear needs no machinery beyond this. A rigid piece is skinned entirely to the
 * one joint it hangs from and a plate takes the body's own weights over the
 * spine and both shoulders, both pinned by `rig.test.ts`, so either rides the
 * skeleton exactly the way the body does: showing a helmet is enabling a mesh,
 * and there is no socket, no re-parenting and no per-frame work in the client.
 *
 * A slot may hold more than one mesh. The sabatons are one boot fitted to the
 * right leg and its exact reflection on the left, `boots.ironsworn.sabaton_{r,l}`,
 * and both are enabled by the same look — a limb worn in pairs needs no new
 * machinery either, only two names under one slot.
 */
export type Slot = "base" | "helmet" | "chest" | "boots" | "gloves" | "weapon1" | "weapon2";
export const SLOTS: readonly Slot[] =
  ["base", "helmet", "chest", "boots", "gloves", "weapon1", "weapon2"];

/** A look per slot, or null for "nothing shown there". */
export type Looks = Record<Slot, string | null>;

/** Nobody drawn: the menu hall with no character standing in it. */
export const NO_LOOKS: Looks = {
  base: null, helmet: null, chest: null, boots: null, gloves: null, weapon1: null, weapon2: null,
};

/**
 * The bare body, carrying nothing. The wardrobe ships a female body on the same
 * skeleton shape, but nothing yet picks her — see `build_wardrobe.py`.
 */
export const BASE_LOOKS: Looks = {
  base: "male", helmet: null, chest: null, boots: null, gloves: null, weapon1: null, weapon2: null,
};

/**
 * What each worn slot replaces of the body under it.
 *
 * Steel is not laid over skin. Fitting a shell around a limb and hoping the two
 * never meet fails at some pose in some clip, and the failure is skin pushing
 * out through a plate. The body is cut into these pieces by
 * `split_body_regions` in `tools/build_wardrobe.py`, and the piece a worn item
 * closes is simply not drawn - hair under a helmet was the first of them.
 *
 * Only what an item genuinely closes is listed. The plate suit is a whole
 * harness cut off at the skull base, the wrists and the ankles, so it closes
 * the trunk and both legs, and its gorget plate (`chest.ironsworn.gorget`, the
 * collar region itself pushed out to steel) closes the COLLAR. The NECK stays
 * drawn: the gorget ring stands off it, and a hidden neck is a black void
 * inside the ring, as it is under the ember cowl's open throat. The arms, the head, the hands and the feet are absent
 * because the arm is skin under a pauldron and a helmet, a gauntlet and a boot
 * own the rest, each its own item.
 */
/**
 * Chest looks whose cloth below the hip hangs on the skirt chains: the specs
 * `tools/build_wardrobe.py` carries a `skirt` key for. Every other look leaves
 * the chains unused, so the solver can sit out.
 */
const SKIRTED_CHEST: ReadonlySet<string> = new Set(["stalker", "ember"]);

const COVERED_BY: Partial<Record<Slot, readonly string[]>> = {
  helmet: ["hair"],
  gloves: ["hand_l", "hand_r"],
  // A suit ends below the knee: the bare `shin_*` runs from under its hem to the foot.
  boots: ["foot_l", "foot_r", "shin_l", "shin_r"],
  chest: ["torso", "collar", "leg_l", "leg_r"],
};

/** The `<slot>.<look>.<part>` pieces the worn gear replaces. */
export function hiddenBaseParts(looks: Looks): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const [slot, parts] of Object.entries(COVERED_BY)) {
    if (looks[slot as Slot] === null) continue;
    for (const part of parts) hidden.add(part);
  }
  return hidden;
}

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
 * panel had nowhere to put the cloth and went through it. Three had the same
 * fault one step down: at 0.292 a bone is still over three times the capsule, so
 * a running leg flung a block of chains out to radius 0.63 while the ones beside
 * them hung at 0.3, and the cloth drawn between them read as a flat sheet with
 * the leg bare through it. Must match `SKIRT_JOINTS` in
 * `tools/build_wardrobe.py`; `rig.test.ts` pins the pair.
 */
export const SKIRT_JOINTS = 6;
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
 * Measured off the Quaternius male by `collider_radii` in
 * `tools/build_wardrobe.py` (`skirt_colliders` in `gear-fit.json`), plus 8mm
 * cloth: the calf and foot at their maximum extent, because a median capsule
 * sat inside the rendered shin and showed a boot through the coat; the thigh at
 * its median, because its maximum is the buttock and would cage the waist.
 *
 * `worn` is what stands there instead once a boot is on, because the cloth is
 * kept off what is DRAWN on the leg and a boot is wider than the shin it
 * covers: the fattest shipped boot about each bone, same 8mm cloth. A capsule
 * cut to bare skin puts the chains ON the shin, which leaves the boot 3cm
 * proud of the cloth and the hem drawn inside its shaft. The thigh keeps one
 * radius: a boot reaches that capsule only mid-stride, and widening it to the
 * boot would cage the hip at every pose.
 *
 * `shaft` is where the boots' shaft is centred, in the calf bone's own frame:
 * 15cm across the bone toward the front and inside, 6cm the other way, so a
 * capsule on the bone holds the robe up to 12cm off a boot. About the shaft,
 * the three shipped boots fit 11.4cm.
 *
 * The worn foot capsule is laid along the sole instead, heel to past the toe:
 * `shaft` shifts its head end and `toe` its tail end, both in the foot bone's
 * frame. Round the ankle joint it needed 18cm to reach heel and sole, stood as
 * far up the shin and pushed the robe's side panel out into a wing at idle.
 */
export const SKIRT_COLLIDERS: readonly {
  from: string; to: string; radius: number; worn?: number;
  shaft?: readonly [number, number, number];
  toe?: readonly [number, number, number];
}[] = [
  { from: "thigh_l", to: "calf_l", radius: 0.0956 },
  { from: "thigh_r", to: "calf_r", radius: 0.0956 },
  { from: "calf_l", to: "foot_l", radius: 0.121, worn: 0.1223, shaft: [0.02, 0, 0.0325] },
  { from: "calf_r", to: "foot_r", radius: 0.121, worn: 0.1223, shaft: [-0.02, 0, 0.0325] },
  { from: "foot_l", to: "ball_l", radius: 0.1079, worn: 0.1219,
    shaft: [0.02, -0.0575, 0.02], toe: [0.02, 0.06, -0.04] },
  { from: "foot_r", to: "ball_r", radius: 0.1079, worn: 0.1219,
    shaft: [-0.02, -0.0575, 0.02], toe: [-0.02, 0.06, -0.04] },
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

/** Where a spell leaves the body: the weapon hand, the same one a held mesh would skin to. */
const HAND_BONE = "hand_r";

/** The bow is skinned to the OTHER hand, and the arrow leaves from its grip. */
const BOW_HAND_BONE = "hand_l";

/** The bow look, and the nocks `tools/build_wardrobe.py` cuts its string down to, top first. */
const BOW_LOOK = "stalkerbow";
const BOW_NOCKS = ["stalkerbow_nock_top", "stalkerbow_nock_bottom"] as const;
/** The draw hand's finger joints the string sits in; it is drawn to their centre. */
const STRING_FINGERS = ["index_02_r", "middle_02_r", "ring_02_r"] as const;
/** The bow fist's finger joints; the nocked arrow rests across the top of them. */
const BOW_FIST = ["index", "middle", "ring", "pinky"].flatMap((f) => [1, 2, 3].map((i) => `${f}_0${i}_l`));
/** The bow thumb, which says which side of the stave the arrow lies on. */
const BOW_THUMB = "thumb_02_l";
/** Arrow axis above the highest fist joint (finger, glove, shaft) and off the stave's centre. */
const ARROW_SHELF = 0.025;
const ARROW_SIDE = 0.03;
/**
 * Fractions of `Rig|Bow_Shoot` over which the fingers take the string: the draw
 * hand reaches the nock at frame 5 of 30. Before, the string is straight.
 */
export const BOW_HOOK: readonly [number, number] = [3 / 30, 8 / 30];
/**
 * The bow fist between shots: a one-pose clip on `hand_l` alone (`tools/build_bow_clip.py`),
 * so the arm swings with idle, walk and run while the fist tips the bow forward. Laid over
 * them while the bow is worn and no action clip owns the upper body, eased over `CARRY_EASE_SEC`.
 */
export const BOW_CARRY = "Rig|Bow_Carry";
const CARRY_EASE_SEC = 0.25;
const STRING_RADIUS = 0.003;
/** The donor's own string colour (`STRING_COLOUR` in `tools/prep_held_weapons.py`). */
const STRING_COLOUR = new Color3(0.55, 0.5, 0.4);

/**
 * The bowstring and the arrow on it, posed every frame between the nocks.
 *
 * The bow mesh is rigid on `hand_l`, so a string baked into it can never bend.
 * This one runs top nock -> draw fingers -> bottom nock while the clip draws and
 * straight nock to nock otherwise; the nocked arrow lies from the string across
 * the bow fist until the release, when the sim's arrow takes over. Both hang off
 * the rig's pivot, so they go wherever the character does.
 */
export class BowString {
  readonly string: Mesh;
  readonly arrow: Mesh;
  /** Where the string is held this frame, world space. */
  readonly drawn = new Vector3();
  private readonly path = [new Vector3(), new Vector3(), new Vector3()];
  private readonly toLocal = new Matrix();
  private readonly top = new Vector3();
  private readonly bottom = new Vector3();
  private readonly fingerAt = new Vector3();
  private readonly dir = new Vector3();
  private readonly up = new Vector3();
  private readonly fist = new Vector3();
  private readonly side = new Vector3();
  private readonly shelf = new Vector3();

  constructor(
    scene: Scene,
    private readonly parent: TransformNode,
    private readonly nocks: readonly [TransformNode, TransformNode],
    private readonly fingers: readonly TransformNode[],
    private readonly bowFist: readonly TransformNode[],
    private readonly thumb: TransformNode,
  ) {
    this.string = MeshBuilder.CreateTube(`${parent.name}-bowstring`, {
      path: this.path, radius: STRING_RADIUS, tessellation: 4, updatable: true,
    }, scene);
    const name = "bowstring-mat";
    let mat = scene.getMaterialByName(name) as StandardMaterial | null;
    if (!mat) {
      mat = new StandardMaterial(name, scene);
      mat.diffuseColor = STRING_COLOUR;
      mat.specularColor = Color3.Black();
    }
    this.string.material = mat;
    this.string.isPickable = false;
    this.string.parent = parent;
    this.arrow = buildArrow(scene, `${parent.name}-nocked-arrow`);
    this.arrow.parent = parent;
    this.arrow.rotationQuaternion = new Quaternion();
    this.arrow.setEnabled(false);
  }

  /** A bow that is not in his hand has no string either. */
  setEnabled(on: boolean): void {
    this.string.setEnabled(on);
    if (!on) this.arrow.setEnabled(false);
  }

  /** Pose for this frame: `draw` is how far through the bow clip, null when it is not playing. */
  update(draw: number | null): void {
    if (!this.string.isEnabled(false)) return;
    for (const nock of this.nocks) nock.computeWorldMatrix(true);
    this.top.copyFrom(this.nocks[0].absolutePosition);
    this.bottom.copyFrom(this.nocks[1].absolutePosition);
    Vector3.CenterToRef(this.top, this.bottom, this.drawn);
    const nocked = draw !== null && draw < BOW_RELEASE;
    if (nocked) {
      this.fingerAt.setAll(0);
      for (const finger of this.fingers) {
        finger.computeWorldMatrix(true);
        this.fingerAt.addInPlace(finger.absolutePosition);
      }
      this.fingerAt.scaleInPlace(1 / this.fingers.length);
      const t = Math.min(1, Math.max(0, (draw - BOW_HOOK[0]) / (BOW_HOOK[1] - BOW_HOOK[0])));
      Vector3.LerpToRef(this.drawn, this.fingerAt, t * t * (3 - 2 * t), this.drawn);
    }

    this.parent.computeWorldMatrix(true);
    this.parent.getWorldMatrix().invertToRef(this.toLocal);
    Vector3.TransformCoordinatesToRef(this.top, this.toLocal, this.path[0]!);
    Vector3.TransformCoordinatesToRef(this.drawn, this.toLocal, this.path[1]!);
    Vector3.TransformCoordinatesToRef(this.bottom, this.toLocal, this.path[2]!);
    MeshBuilder.CreateTube(this.string.name, { path: this.path, instance: this.string });

    // Only once the fingers hold the string: before, the hands are off the arrow
    // line and the shaft sticks out sideways at the hip.
    const shown = nocked && draw >= BOW_HOOK[1];
    this.arrow.setEnabled(shown);
    if (!shown) return;
    // The shelf: over the top of the fist along the stave, beside the stave on
    // the thumb's side, so the shaft crosses the knuckles instead of the palm.
    this.top.subtractToRef(this.bottom, this.up).normalize();
    this.fist.setAll(0);
    for (const joint of this.bowFist) {
      joint.computeWorldMatrix(true);
      this.fist.addInPlace(joint.absolutePosition);
    }
    this.fist.scaleInPlace(1 / this.bowFist.length);
    let rise = -Infinity;
    for (const joint of this.bowFist) {
      rise = Math.max(rise, Vector3.Dot(joint.absolutePosition.subtract(this.fist), this.up));
    }
    this.fist.addToRef(this.up.scale(rise + ARROW_SHELF), this.shelf);
    Vector3.CrossToRef(this.up, this.shelf.subtract(this.drawn), this.side);
    this.side.normalize();
    this.thumb.computeWorldMatrix(true);
    if (Vector3.Dot(this.thumb.absolutePosition.subtract(this.fist), this.side) < 0) this.side.scaleInPlace(-1);
    this.shelf.addInPlace(this.side.scaleInPlace(ARROW_SIDE));
    Vector3.TransformCoordinatesToRef(this.shelf, this.toLocal, this.dir);
    this.dir.subtractInPlace(this.path[1]!).normalize();
    // The arrow is built centred along +Z, so its nock is half a shaft back.
    this.path[1]!.addToRef(this.dir.scale(ARROW_LENGTH / 2), this.arrow.position);
    Quaternion.FromUnitVectorsToRef(Vector3.Forward(), this.dir, this.arrow.rotationQuaternion!);
  }

  dispose(): void {
    this.string.dispose();
    this.arrow.dispose();
  }
}

/** The string for a rig whose wardrobe carries the nocks, or null for an older asset. */
export function bowStringFor(scene: Scene, parent: TransformNode, byName: Map<string, Node>): BowString | null {
  const node = (name: string): TransformNode | null => {
    const n = byName.get(name);
    return n instanceof TransformNode ? n : null;
  };
  const top = node(BOW_NOCKS[0]);
  const bottom = node(BOW_NOCKS[1]);
  const thumb = node(BOW_THUMB);
  const fingers = STRING_FINGERS.map(node).filter((f): f is TransformNode => f !== null);
  const fist = BOW_FIST.map(node).filter((f): f is TransformNode => f !== null);
  if (!top || !bottom || !thumb || fingers.length !== STRING_FINGERS.length || fist.length !== BOW_FIST.length) return null;
  return new BowString(scene, parent, [top, bottom], fingers, fist, thumb);
}

/**
 * Bones a layered clip must not touch, so it can play over locomotion without
 * fighting it for the legs. Leaf tips are included by name.
 */
const LOWER_BODY: ReadonlySet<string> = new Set([
  "root", HIPS_BONE,
  "thigh_l", "calf_l", "foot_l", "ball_l", "ball_end_l", "foot_end_l",
  "thigh_r", "calf_r", "foot_r", "ball_r", "ball_end_r", "foot_end_r",
]);

/**
 * Weapon-hand bones layered actions must not touch, or the fingers open and the
 * weapon floats. The grip is whatever the locomotion clip left them at. The bow
 * draw is the exception: the bow is in the other hand and this one hooks the string.
 */
const WEAPON_HAND: ReadonlySet<string> = new Set([
  "hand_r",
  "thumb_01_r", "thumb_02_r", "thumb_03_r", "thumb_04_end_r",
  "index_01_r", "index_02_r", "index_03_r", "index_04_end_r",
  "middle_01_r", "middle_02_r", "middle_03_r", "middle_04_end_r",
  "ring_01_r", "ring_02_r", "ring_03_r", "ring_04_end_r",
  "pinky_01_r", "pinky_02_r", "pinky_03_r", "pinky_04_end_r",
]);

/** Attacks: a reaction never interrupts one, and one always cuts a reaction short. */
const ACTION_CLIPS: readonly RigClip[] = ["cast", "bow", ...STRIKE_CLIPS];

/** Clips that layer over locomotion instead of replacing it. */
const UPPER_BODY_CLIPS: ReadonlySet<RigClip> = new Set<RigClip>([...ACTION_CLIPS, ...REACTION_CLIPS]);

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
  idle: 1, walk: 0.65, run: 0.65, walkBack: 0.65,
  runBack: 0.65, runBackL: 0.65, runBackR: 0.65,
  walkStrafeL: 0.65, walkStrafeR: 0.65, runStrafeL: 0.65, runStrafeR: 0.65,
  walkFwdL: 0.65, walkFwdR: 0.65, walkBackL: 0.65, walkBackR: 0.65, cast: 1, bow: 1, strikeA: 1, strikeB: 1, strikeC: 1, hit: 1, drink: 1, open: 1,
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

/** This scene's wardrobe import, or null before it lands. Never a second import. */
export function wardrobeFor(scene: Scene): AssetContainer | null {
  return loaded?.scene === scene ? loaded.wardrobe : null;
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
 * Index the wired body's skeleton subtree by node name, and switch every other
 * skeleton in the import off.
 *
 * The wardrobe ships two skeletons ("Armature", "Armature_female") carrying the
 * same 65 bone names, so indexing both into one map would let whichever landed
 * second silently own the animation. A second rig in the same scene clones
 * these nodes and a clone carries a `.001` suffix, so a root is matched on its
 * stem.
 *
 * The skeletons are searched for BELOW the nodes handed in, never among them:
 * Babylon's glTF loader wraps an import in one `__root__` node carrying the
 * right-to-left-handed conversion, so a container's root nodes are that wrapper
 * and the armatures are its children. Treating the wrapper as an armature
 * indexes nothing and disables the entire import, silently.
 */
export function indexRigSubtree(roots: readonly Node[]): Map<string, Node> {
  const byName = new Map<string, Node>();
  for (const root of roots) {
    for (const node of [root, ...root.getDescendants(false)]) {
      const stem = node.name.replace(/\.\d+$/, "");
      if (!RIG_ROOT.test(stem)) continue;
      if (stem !== MALE_RIG) {
        if (node instanceof TransformNode) node.setEnabled(false);
        continue;
      }
      byName.set(node.name, node);
      for (const child of node.getDescendants(false)) {
        byName.set(child.name, child);
        // A skinned part's bounds stay at the bind pose, so a posed hand or
        // foot leaves them and the part is culled while plainly on screen.
        if (child instanceof Mesh && child.skeleton) child.alwaysSelectAsActiveMesh = true;
      }
    }
  }
  return byName;
}

/**
 * One animated character instance, parented under an actor root that the
 * renderer keeps positioning and turning as before.
 */
/** Reach along the hand bone when no weapon mesh says where its tip is. */
const WEAPON_TIP = 0.45;

/**
 * Where a held weapon's tip sits in its hand bone's frame: the vertex farthest
 * from the hand, read in the rest pose the parts are bound in. Rigid on the
 * hand, so one read holds for every frame of every clip.
 */
export function weaponTipLocal(hand: TransformNode, weapon: readonly Mesh[]): Vector3 {
  hand.computeWorldMatrix(true);
  const at = hand.absolutePosition;
  let tip: Vector3 | null = null;
  let far = -1;
  for (const mesh of weapon) {
    const p = mesh.getVerticesData("position");
    if (!p) continue;
    const world = mesh.computeWorldMatrix(true);
    for (let i = 0; i < p.length; i += 3) {
      const v = Vector3.TransformCoordinates(new Vector3(p[i]!, p[i + 1]!, p[i + 2]!), world);
      const d = Vector3.DistanceSquared(v, at);
      if (d > far) { far = d; tip = v; }
    }
  }
  if (!tip) return new Vector3(0, WEAPON_TIP, 0);
  return Vector3.TransformCoordinates(tip, hand.getWorldMatrix().clone().invert());
}

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
  /** The move's yaw off the body's facing, and the hip turn eased toward it. */
  private moveRel = 0;
  private legsTarget = 0;
  private legs = 0;
  /** 1 with no layered clip playing, eased to 0 while one owns the spine (see `spinePitch`). */
  private uprightGain = 1;
  /** The direction clip blended over the playing one, and its weight (`directionBlend`). */
  private blendTo: AnimationGroup | null = null;
  private blendClip: RigClip | null = null;
  private blendW = 0;
  /** Seconds this body has been standing still, for the breath to settle over. */
  private standing = 0;
  /** This frame's yaw change, and the standing shuffle it started with the seconds it has left. */
  private yawStep = 0;
  private turning: { clip: RigClip; ratio: number } | null = null;
  private turnHold = 0;

  /** Every wardrobe part, grouped `slot` -> `look` -> meshes. */
  private readonly parts = new Map<string, Map<string, Mesh[]>>();
  private looks: Looks = { ...NO_LOOKS };

  /** Coat cloth. Null when the wardrobe has no skirt chains (an older asset). */
  private skirt: SkirtSim | null = null;
  private skirtChains: SkirtChain[] = [];
  private pelvis: TransformNode | null = null;
  /** The casting hand, so a spell can be drawn leaving it. */
  private hand: TransformNode | null = null;
  private bowHand: TransformNode | null = null;
  /** Each held look's tip in the hand's frame, read at build in the rest pose. */
  private readonly tips = new Map<string, Vector3>();
  private bowString: BowString | null = null;
  private stringObserver: Observer<Scene> | null = null;
  /** The carry pose per bow-arm bone, how far it is laid over the clips, and its observer. */
  private carry: { node: TransformNode; pose: Quaternion }[] = [];
  private carryWeight = 0;
  private carryObserver: Observer<Scene> | null = null;
  /** Bones that carry the cast toward the cursor: spine, clavicle, upper arm. */
  private aimBones: TransformNode[] = [];
  /** World-space aim target (x = Babylon x, z = Babylon z). */
  private aimTarget: { x: number; z: number } | null = null;
  private lookYaw: number | null = null;
  /** The gaze's current turn off the chest, eased (bone yaw, radians). */
  private look = 0;
  /** Observer that applies aim rotation after the animation system runs. */
  private aimObserver: Observer<Scene> | null = null;
  private legsObserver: Observer<Scene> | null = null;
  private legsRestore: Observer<Scene> | null = null;
  /** The swing in flight and the rates it is paced by; null between swings. */
  private strike: { group: AnimationGroup; pace: StrikePace; timing: StrikeTiming } | null = null;
  private trail: ReturnType<typeof swingTrail> | null = null;
  private strikeObserver: Observer<Scene> | null = null;
  private colliders: (SkirtCollider & {
    head: TransformNode;
    tail: TransformNode;
    previousA: Vector3;
    previousB: Vector3;
    initialized: boolean;
    /** Bare skin and booted radii; `radius` is whichever the looks call for. */
    bare: number;
    worn: number;
    /** The worn ends' shifts in the head bone's frame, and the pair in use. */
    shaft: Vector3 | null;
    toe: Vector3 | null;
    offset: Vector3 | null;
    tailOffset: Vector3 | null;
  })[] = [];
  private readonly shaftTail = new Vector3();
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
    for (const slot of SLOTS) {
      if (this.looks[slot] !== looks[slot]) {
        this.looks[slot] = looks[slot];
        changed = true;
      }
    }
    if (changed) this.applyLooks();
  }

  /** A boot is wider than the shin, so the cloth is pushed out of the boot. */
  private fitColliders(): void {
    const booted = this.looks.boots !== null;
    for (const collider of this.colliders) {
      collider.radius = booted ? collider.worn : collider.bare;
      collider.offset = booted ? collider.shaft : null;
      collider.tailOffset = booted ? collider.toe ?? collider.shaft : null;
    }
  }

  private applyLooks(): void {
    this.coatVisible = SKIRTED_CHEST.has(this.looks.chest ?? "");
    this.fitColliders();
    this.bowString?.setEnabled(this.looks.weapon1 === BOW_LOOK);
    const hidden = hiddenBaseParts(this.looks);
    for (const [slot, byLook] of this.parts) {
      const wanted = this.looks[slot as Slot] ?? null;
      for (const [look, meshes] of byLook) {
        const on = look === wanted;
        for (const mesh of meshes) {
          // A clone carries a Babylon suffix after the part, so the part is the
          // third field and nothing else. Body and gear part names never collide.
          const part = mesh.name.split(".")[2] ?? "";
          mesh.setEnabled(on && !hidden.has(part));
        }
      }
    }
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

  /**
   * Where the body is moving, as yaw off the way it faces (0 ahead, PI behind),
   * and how far it turned this frame (radians, positive to his right).
   */
  /** The yaw the body is turning to while it moves, which the head looks along; null to watch the cursor. */
  setLookYaw(yaw: number | null): void {
    this.lookYaw = yaw;
  }

  setMoveAngle(rel: number, yawStep = 0): void {
    // Eased: the move only changes on a 30 Hz tick, and a step there would step the direction blend.
    const dt = (this.scene.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000;
    this.moveRel = wrapPi(this.moveRel + wrapPi(rel - this.moveRel) * (1 - Math.exp(-dt / MOVE_EASE_SEC)));
    this.yawStep = yawStep;
  }

  /** Pick and pace the locomotion clip from the actor's real ground speed. */
  setLocomotion(speed: number): void {
    // Real seconds off the engine, not a tick count: this is a render-side
    // flourish and the sim never hears about it.
    const dt = (this.scene.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000;
    let clip = clipForSpeed(speed, gaitOf(this.locomotion) ?? "idle");
    let stride = 1;
    this.blendTo = null;
    this.blendClip = null;
    this.blendW = 0;
    let shuffle: { clip: RigClip; ratio: number } | null = null;
    if (clip === "idle") {
      this.legsTarget = 0;
      // A body turning on the spot steps round instead of swivelling on planted feet.
      const step = turnStep(this.yawStep / Math.max(dt, 1e-3));
      if (step) {
        // The turn decelerates into its end: hold its fastest pace, not its last.
        const held = this.turnHold > 0 && this.turning?.clip === step.clip ? this.turning.ratio : 0;
        this.turning = { clip: step.clip, ratio: Math.max(held, step.ratio) };
        this.turnHold = TURN_STEP_HOLD;
      } else {
        this.turnHold -= dt;
      }
      if (this.turnHold > 0 && this.turning) {
        shuffle = this.turning;
        clip = shuffle.clip;
      }
    } else {
      this.turnHold = 0;
      const gait = clip === "run" ? "run" : "walk";
      this.legsTarget = hipTurn(this.moveRel);
      // Off the hips as they ARE, mid-turn, so the feet always travel the real move.
      const b = directionBlend(this.moveRel - this.legs, gait);
      // The heavier clip plays, the lighter one is blended in: straight behind
      // sits on the +-PI seam, and there the pair flips every frame.
      const [main, over, w] = b.w > 0.5 ? [b.to, b.from, 1 - b.w] : [b.from, b.to, b.w];
      const dirs = DIRECTIONS[gait];
      clip = dirs[main]!.clip;
      this.blendClip = dirs[over]!.clip;
      this.blendTo = this.groups.get(this.blendClip) ?? null;
      this.blendW = w;
      stride = dirs[main]!.stride + (dirs[over]!.stride - dirs[main]!.stride) * w;
    }
    this.locomotion = clip;
    const group = this.groups.get(clip);
    if (clip === "idle") {
      this.standing += dt;
      if (group) group.speedRatio = idleRatio(this.standing);
    } else if (shuffle) {
      this.standing = 0;
      if (group) group.speedRatio = shuffle.ratio;
    } else {
      this.standing = 0;
      if (group) group.speedRatio = speedRatioFor(clip, speed / stride);
    }
    this.switchTo(clip);
  }

  /**
   * Fire the spell animation. It drives the upper body only, so it layers over
   * whatever the legs are doing: cast while running and the character keeps
   * running, arm outstretched, instead of freezing mid-stride.
   */
  playCast(seconds?: number): void {
    // A bow tail still playing would keep castPoint() on the bow hand.
    this.groups.get("bow")?.stop();
    this.playOnce("cast", seconds);
  }

  /**
   * Draw and loose. Paced so the release pose lands when the arrow appears,
   * not on the beat: the beat puts it anywhere from 15% to 47% into the clip
   * depending on the skill. The follow-through then plays out at that rate.
   */
  playBow(seconds?: number, releaseSeconds?: number): void {
    const group = this.groups.get("bow");
    const ratio = group && releaseSeconds !== undefined
      ? actionRatio(clipSeconds(group) * BOW_RELEASE, releaseSeconds)
      : undefined;
    this.playOnce("bow", seconds, ratio);
  }

  private playOnce(clip: "cast" | "bow", seconds?: number, paced?: number): void {
    const group = this.groups.get(clip);
    if (!group) return;
    this.stopReactions();
    group.stop();
    const ratio = paced ?? actionRatio(clipSeconds(group), seconds);
    group.speedRatio = ratio;
    // Played ONCE, paced to the wind-up: looping it at a fixed rate meant a
    // third of a second of cast only ever showed the first third of the swing,
    // so the bolt left a hand that was still lifting.
    group.start(false, ratio);
    group.onAnimationGroupEndObservable.addOnce(this.easeOutToLocomotion);
  }

  /**
   * Alternate authored weapon-arm attacks while locomotion keeps the legs. Paced
   * per phase (`strikePace`) so the blade stops on the tick the sim lands the hit.
   */
  playStrike(seconds?: number, releaseSeconds?: number): void {
    const clip = STRIKE_CLIPS[this.nextStrikeIndex]!;
    const group = this.groups.get(clip);
    if (!group) return;
    this.stopReactions();
    for (const strike of STRIKE_CLIPS) this.groups.get(strike)?.stop();
    const timing = STRIKE_TIMING[clip];
    const pace = strikePace(clipSeconds(group), timing, releaseSeconds, seconds);
    group.speedRatio = pace.raise;
    group.start(false, pace.raise);
    group.onAnimationGroupEndObservable.addOnce(this.easeOutToLocomotion);
    this.strike = { group, pace, timing };
    this.strikeObserver ??= this.scene.onBeforeAnimationsObservable.add(this.paceStrike);
    this.nextStrikeIndex = (this.nextStrikeIndex + 1) % STRIKE_CLIPS.length;
  }

  /** A reaction over the legs at the authored pace; skipped while an attack plays. */
  playReaction(clip: ReactionClip): void {
    const group = this.groups.get(clip);
    if (!group || ACTION_CLIPS.some((c) => this.groups.get(c)?.isPlaying)) return;
    this.stopReactions();
    group.speedRatio = 1;
    group.start(false, 1);
    group.onAnimationGroupEndObservable.addOnce(this.easeOutToLocomotion);
  }

  private stopReactions(): void {
    for (const clip of REACTION_CLIPS) this.groups.get(clip)?.stop();
  }

  /** Let go of a cast, bow or strike mid-clip; the end observer eases back to locomotion. */
  cancelAction(): void {
    for (const clip of ACTION_CLIPS) {
      const group = this.groups.get(clip);
      if (group?.isPlaying) group.stop();
    }
  }

  /** Cancel a strike when the actor is removed or otherwise reset. */
  stopStrike(): void {
    for (const strike of STRIKE_CLIPS) this.groups.get(strike)?.stop();
  }

  /** Per frame, before the clips advance: the phase's rate and the ribbon. */
  private paceStrike = (): void => {
    const strike = this.strike;
    const frame = strike?.group.isPlaying ? strike.group.animatables[0]?.masterFrame : undefined;
    if (!strike || frame === undefined) {
      this.strike = null;
      this.trail?.dispose();
      this.trail = null;
      return;
    }
    const { group, pace, timing } = strike;
    const frac = (frame - group.from) / Math.max(1e-6, group.to - group.from);
    const ratio = strikeRatioAt(frac, pace, timing);
    if (group.speedRatio !== ratio) group.speedRatio = ratio;
    // The ribbon is the drop and nothing else: on the raise it is a slow smear.
    const tip = frac >= timing.drop && frac < TRAIL_END ? this.castPoint() : null;
    if (tip) {
      this.trail ??= swingTrail(this.scene);
      this.trail.follow(tip);
    } else if (this.trail) {
      this.trail.dispose();
      this.trail = null;
    }
  };

  private isDrawingBow(): boolean {
    return this.groups.get("bow")?.isPlaying === true;
  }

  /** How far through the bow clip, or null when it is not playing. */
  private bowDraw(): number | null {
    const group = this.groups.get("bow");
    const frame = group?.isPlaying ? group.animatables[0]?.masterFrame : undefined;
    if (!group || frame === undefined) return null;
    return (frame - group.from) / Math.max(1e-6, group.to - group.from);
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
  /**
   * Pull the pose toward the second direction clip by its weight, sampled in
   * step with the playing clip (`framePhaseMatched`), so the feet stay one step.
   * Under a layered cast or strike, the legs and hips only.
   */
  private blendDirection(): void {
    const other = this.blendTo;
    const at = this.active?.animatables[0]?.masterFrame;
    if (!other || !this.active || !this.activeClip || !this.blendClip || this.blendW < 1e-3 || at === undefined) return;
    const frame = framePhaseMatched(this.activeClip, [this.active.from, this.active.to], at, this.blendClip, [other.from, other.to]);
    const layered = [...UPPER_BODY_CLIPS].some((c) => this.groups.get(c)?.isPlaying);
    for (const { animation, target } of other.targetedAnimations) {
      const node = target as TransformNode;
      if (layered && !LOWER_BODY.has(node.name)) continue;
      if (animation.targetProperty === ROTATION && node.rotationQuaternion) {
        Quaternion.SlerpToRef(node.rotationQuaternion, animation.evaluate(frame) as Quaternion, this.blendW, node.rotationQuaternion);
      } else if (animation.targetProperty === TRANSLATION) {
        Vector3.LerpToRef(node.position, animation.evaluate(frame) as Vector3, this.blendW, node.position);
      }
    }
  }

  private easeOutToLocomotion = (): void => {
    const group = this.groups.get(this.locomotion);
    if (group) restartAtCurrentFrame(group, CLIP_LOOPS[this.locomotion]);
    this.scene.sortActiveAnimatables();
  };

  private switchTo(clip: RigClip): void {
    const group = this.groups.get(clip);
    if (!group || this.activeClip === clip) return;
    // Carry the stride phase from one locomotion clip to the next, or every
    // turn of the legs restarts the step.
    const from = this.activeClip;
    const at = this.active?.animatables[0]?.masterFrame;
    const carry = from !== null && gaitOf(from) !== null && gaitOf(clip) !== null && this.active && at !== undefined
      ? framePhaseMatched(from, [this.active.from, this.active.to], at, clip, [group.from, group.to])
      : undefined;
    this.active?.stop();
    group.start(CLIP_LOOPS[clip], group.speedRatio);
    if (carry !== undefined) group.goToFrame(carry);
    // Babylon applies animatables in list order and a start appends: without the
    // sort a leg clip switched mid-swing takes the arms back and cuts the action off.
    this.scene.sortActiveAnimatables();
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

    // The wardrobe ships two skeletons ("Armature", "Armature_female") with the
    // same 65 bone names, so indexing both into one map by name would let
    // whichever loaded second silently own the animation. Only the male body is
    // wired today, so only his skeleton's subtree is read, and the female one is
    // switched off outright rather than left to whatever visibility it imported
    // with.
    // A second rig in the same scene clones these nodes, and a clone carries a
    // `.001` suffix, so the root is matched on its stem.
    for (const root of entries.rootNodes) root.parent = this.pivot;
    const byName = indexRigSubtree(entries.rootNodes);

    // Index the parts by the `slot.look.part` names the builder emits. Cloned
    // instances keep the source name plus a Babylon suffix, so the slot and look
    // are read off the first two dot-separated fields and nothing else.
    for (const node of byName.values()) {
      if (!(node instanceof Mesh)) continue;
      const [slot, look] = node.name.split(".");
      if (slot === undefined || look === undefined) continue;
      let byLook = this.parts.get(slot);
      if (!byLook) this.parts.set(slot, (byLook = new Map()));
      const list = byLook.get(look);
      if (list) list.push(node);
      else byLook.set(look, [node]);
    }

    const handNode = byName.get(HAND_BONE);
    this.hand = handNode instanceof TransformNode ? handNode : null;
    this.tips.clear();
    const hand = this.hand;
    if (hand) for (const [look, meshes] of this.parts.get("weapon1") ?? []) this.tips.set(look, weaponTipLocal(hand, meshes));
    const bowHandNode = byName.get(BOW_HAND_BONE);
    this.bowHand = bowHandNode instanceof TransformNode ? bowHandNode : null;
    this.bowString = bowStringFor(this.scene, this.pivot, byName);
    // Before render: after the clips and the aim have both moved the hands.
    if (this.bowString) {
      this.stringObserver = this.scene.onBeforeRenderObservable.add(() => this.bowString?.update(this.bowDraw()));
    }
    // Bones the aim rotates during a cast: spine, clavicle, upper arm, and head.
    // Each bone gets a share of the aim so the twist distributes naturally.
    // Weights are how much of the TOTAL aim each bone carries; they sum > 1
    // because the child inherits the parent and the clip's own baked direction
    // already biases the arm, so they have to over-correct.
    const AIM_CHAIN: { name: string; weight: number }[] = [
      { name: "spine_03", weight: CHEST_AIM },
      { name: "clavicle_r", weight: 0.7 },
      { name: "upperarm_r", weight: 1.2 },
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
    const nb = byName.get("neck_01");
    const gaze = [nb instanceof TransformNode ? nb : null, headBone];
    const ungazed = gaze.map((n) => n?.rotationQuaternion?.clone() ?? null);
    let looked = false;

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

    // Hips toward the move, chest back onto the facing, before the aim reads the
    // chest. Eased, so a backpedal starting or a sidestep flipping sides turns
    // the hips over a few frames instead of snapping them round.
    const pelvisNode = byName.get(HIPS_BONE);
    const waist = ["spine_01", "spine_02"].map((n) => byName.get(n)).filter((n): n is TransformNode => n instanceof TransformNode);
    // World-up yaw applied in the bone's PARENT frame (delta * rot): the hips
    // turn about the floor's normal, not about whatever axis the pelvis rests on.
    const turnInParent = (bone: TransformNode, axis: Vector3, angle: number) => {
      const parent = bone.parent as TransformNode | null;
      const rot = bone.rotationQuaternion;
      if (!parent || !rot) return;
      parent.computeWorldMatrix(true).invertToRef(parentInv);
      Vector3.TransformNormalToRef(axis, parentInv, localAxis);
      Quaternion.RotationAxisToRef(localAxis.normalize(), angle, this.delta);
      this.delta.multiplyToRef(rot, rot);
    };
    const yawInParent = (bone: TransformNode, angle: number) => turnInParent(bone, worldUp, angle);
    const bodyRight = new Vector3();
    // Not every clip keys every one of these bones, and an unkeyed bone keeps
    // last frame's turn: each pose is put back before the clips run, or it spins.
    const twisted = [pelvisNode, ...waist].filter((n): n is TransformNode => n instanceof TransformNode);
    const untwisted = twisted.map((n) => n.rotationQuaternion?.clone() ?? null);
    let turned = false;
    let blendDt = 0;
    this.legsRestore = this.scene.onBeforeAnimationsObservable.add(() => {
      // blendingSpeed is a per-FRAME linear step, so it is re-set off this frame's
      // seconds, or a crossfade lasts a third as long at 165Hz as at 60Hz.
      const dt = Math.min(0.1, (this.scene.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000);
      if (Math.abs(dt - blendDt) > blendDt * 0.1) {
        blendDt = dt;
        for (const [clip, group] of this.groups) group.blendingSpeed = dt / (isLayeredClip(clip) ? ACTION_BLEND_SEC : LOCO_BLEND_SEC);
      }
      if (looked) {
        gaze.forEach((n, i) => { if (ungazed[i]) n?.rotationQuaternion?.copyFrom(ungazed[i]!); });
        looked = false;
      }
      if (!turned) return;
      twisted.forEach((n, i) => { if (untwisted[i]) n.rotationQuaternion?.copyFrom(untwisted[i]!); });
      turned = false;
    });
    this.legsObserver = this.scene.onAfterAnimationsObservable.add(() => {
      const dt = (this.scene.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000;
      this.legs += wrapPi(this.legsTarget - this.legs) * Math.min(1, dt / LEG_EASE_SEC);
      this.blendDirection();
      const layered = [...UPPER_BODY_CLIPS].some((c) => this.groups.get(c)?.isPlaying);
      this.uprightGain += ((layered ? 0 : 1) - this.uprightGain) * Math.min(1, dt / ACTION_BLEND_SEC);
      // The jog leans its chest into the run; carried sideways, that lean points
      // at nothing, so the spine stands up by how sideways the move is. A layered
      // clip (bow, cast, strike) holds the spine itself, but not the pelvis a
      // backpedal tilts back, so under one the spine comes forward instead.
      const pitch = spinePitch(gaitOf(this.locomotion), this.moveRel, this.uprightGain);
      const twist = Math.abs(this.legs) >= 1e-4;
      if ((!twist && Math.abs(pitch) <= 1e-3) || !(pelvisNode instanceof TransformNode)) return;
      twisted.forEach((n, i) => { if (n.rotationQuaternion) untwisted[i]?.copyFrom(n.rotationQuaternion); });
      turned = true;
      if (twist) {
        yawInParent(pelvisNode, LEG_YAW_SIGN * this.legs);
        for (const bone of waist) yawInParent(bone, -LEG_YAW_SIGN * this.legs / waist.length);
      }
      if (Math.abs(pitch) > 1e-3 && waist[0]) {
        const yaw = this.host.rotation.y;
        bodyRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
        turnInParent(waist[0], bodyRight, UPRIGHT_SIGN * pitch);
      }
    });

    this.aimObserver = this.scene.onAfterAnimationsObservable.add(() => {
      const dt = (this.scene.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000;
      const castGroup = this.groups.get("cast");
      const casting = castGroup !== undefined && castGroup.isPlaying;
      const drawing = !casting && this.isDrawingBow();

      this.pivot.computeWorldMatrix(true);
      const tdx = this.aimTarget ? this.aimTarget.x - this.pivot.absolutePosition.x : 0;
      const tdz = this.aimTarget ? this.aimTarget.z - this.pivot.absolutePosition.z : 0;
      const aimYaw = tdx * tdx + tdz * tdz >= 0.01 ? Math.atan2(tdx, tdz) : null;
      const bodyYaw = this.host.rotation.y;

      // How far the head still has to turn past what the chest already carries.
      let want = 0;
      if (drawing && aimYaw !== null) {
        // An archer aims with his chest: the clip holds both arms on the arrow
        // line, so turning the top of the spine turns bow, string and head as one.
        const { arm } = aimAngles(aimYaw, bodyYaw, 0);
        const chest = this.aimBones[0];
        if (chest) aimBone(chest, Math.max(-HEAD_MAX, Math.min(HEAD_MAX, arm)));
      } else if (casting && aimYaw !== null) {
        const { arm } = aimAngles(aimYaw, bodyYaw);
        for (let i = 0; i < this.aimBones.length; i++) {
          aimBone(this.aimBones[i]!, arm * aimWeights[i]!);
        }
        want = lookOffset(aimYaw, bodyYaw) - CHEST_AIM * arm;
      } else {
        // The eyes lead: where the body is turning to while it moves, the cursor while it stands.
        const yaw = this.lookYaw ?? aimYaw;
        if (yaw !== null) want = lookOffset(yaw, bodyYaw);
      }
      this.look += (want - this.look) * (1 - Math.exp(-dt / LOOK_EASE_SEC));
      if (Math.abs(this.look) < 1e-4) return;
      gaze.forEach((n, i) => { if (n?.rotationQuaternion) ungazed[i]?.copyFrom(n.rotationQuaternion); });
      looked = true;
      if (gaze[0]) aimBone(gaze[0], this.look * NECK_SHARE);
      if (gaze[1]) aimBone(gaze[1], this.look * (gaze[0] ? 1 - NECK_SHARE : 1));
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
        if (upperOnly && (LOWER_BODY.has(sourceNode.name) || (WEAPON_HAND.has(sourceNode.name) && clip !== "bow"))) continue;
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
      // Layered clips apply after locomotion whenever the list is sorted (`switchTo`).
      if (upperOnly) group.playOrder = 1;
      group.enableBlending = true;
      // A 60Hz frame's worth until the first frame re-sets it off the real one.
      group.blendingSpeed = 1 / 60 / (isLayeredClip(clip) ? ACTION_BLEND_SEC : LOCO_BLEND_SEC);
      this.groups.set(clip, group);
    }

    const carried = loaded.anims.animationGroups.find((g) => g.name === BOW_CARRY);
    for (const t of carried?.targetedAnimations ?? []) {
      const node = byName.get((t.target as Node).name);
      if (t.animation.targetProperty === ROTATION && node instanceof TransformNode) {
        this.carry.push({ node, pose: t.animation.evaluate(carried!.from) as Quaternion });
      }
    }
    if (this.carry.length > 0) {
      this.carryObserver = this.scene.onAfterAnimationsObservable.add(() => {
        const worn = this.looks.weapon1 === BOW_LOOK;
        const busy = [...UPPER_BODY_CLIPS].some((c) => this.groups.get(c)?.isPlaying);
        const step = (this.scene.getEngine?.()?.getDeltaTime?.() ?? 16) / 1000 / CARRY_EASE_SEC;
        this.carryWeight = worn && !busy ? Math.min(1, this.carryWeight + step) : Math.max(0, this.carryWeight - step);
        if (this.carryWeight <= 0) return;
        for (const { node, pose } of this.carry) {
          const rot = node.rotationQuaternion;
          if (rot) Quaternion.SlerpToRef(rot, pose, this.carryWeight, rot);
        }
      });
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

    for (const { from, to, radius, worn, shaft, toe } of SKIRT_COLLIDERS) {
      const head = byName.get(from);
      const tail = byName.get(to);
      if (head instanceof TransformNode && tail instanceof TransformNode) {
        this.colliders.push({
          head, tail,
          a: new Vector3(), b: new Vector3(),
          previousA: new Vector3(), previousB: new Vector3(),
          radius,
          bare: radius, worn: worn ?? radius,
          shaft: shaft ? Vector3.FromArray(shaft) : null, toe: toe ? Vector3.FromArray(toe) : null,
          offset: null, tailOffset: null,
          initialized: false,
        });
      }
    }
    this.fitColliders();

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
    for (const collider of this.colliders) {
      if (collider.initialized) {
        collider.previousA.copyFrom(collider.a);
        collider.previousB.copyFrom(collider.b);
      }
      collider.head.computeWorldMatrix(true);
      collider.tail.computeWorldMatrix(true);
      if (collider.offset) {
        const bone = collider.head.getWorldMatrix();
        Vector3.TransformCoordinatesToRef(collider.offset, bone, collider.a);
        this.shaftTail.copyFrom(collider.tail.position).addInPlace(collider.tailOffset ?? collider.offset);
        Vector3.TransformCoordinatesToRef(this.shaftTail, bone, collider.b);
      } else {
        collider.a.copyFrom(collider.head.absolutePosition);
        collider.b.copyFrom(collider.tail.absolutePosition);
      }
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
    if (this.bowHand && this.isDrawingBow()) {
      this.bowHand.computeWorldMatrix(true);
      return this.bowHand.getAbsolutePosition().clone();
    }
    if (!this.hand) return null;
    this.hand.computeWorldMatrix(true);
    const local = this.tips.get(this.looks.weapon1 ?? "") ?? new Vector3(0, WEAPON_TIP, 0);
    return Vector3.TransformCoordinates(local, this.hand.getWorldMatrix());
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
    this.bowHand = null;
    if (this.stringObserver) this.scene.onBeforeRenderObservable.remove(this.stringObserver);
    this.stringObserver = null;
    if (this.carryObserver) this.scene.onAfterAnimationsObservable.remove(this.carryObserver);
    this.carryObserver = null;
    this.carry = [];
    this.carryWeight = 0;
    this.bowString?.dispose();
    this.bowString = null;
    this.aimBones = [];
    this.aimTarget = null;
    this.look = 0;
    if (this.aimObserver) this.scene.onAfterAnimationsObservable.remove(this.aimObserver);
    if (this.legsObserver) this.scene.onAfterAnimationsObservable.remove(this.legsObserver);
    this.aimObserver = null;
    this.legsObserver = null;
    if (this.legsRestore) this.scene.onBeforeAnimationsObservable.remove(this.legsRestore);
    this.legsRestore = null;
    if (this.strikeObserver) this.scene.onBeforeAnimationsObservable.remove(this.strikeObserver);
    this.strikeObserver = null;
    this.strike = null;
    this.trail?.dispose();
    this.trail = null;
    this.anchorsWorld.length = 0;
    this.restsWorld.length = 0;
    this.coatVisible = false;
    for (const group of this.groups.values()) group.dispose();
    this.groups.clear();
    this.parts.clear();
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
