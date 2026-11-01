import type { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { FxProfile } from "../skill-fx";
import type { RigClip } from "../rig";

/**
 * How a class skill looks: what the per-class modules (`ironsworn.ts`, `stalker.ts`,
 * `emberbound.ts`) fill in, and what `dispatcher.ts` drives off the snapshot.
 *
 * The dispatcher owns every handle's lifetime. A handle is disposed when its entity
 * leaves the snapshot (after `fade`, when it has one), on an area change, and when
 * the scene is disposed; a look never has to clean up after itself. Status and buff
 * FX are real geometry or particle systems, never sprites or camera-facing cards.
 */

/** What every look is handed on every call. */
export interface LookContext {
  scene: Scene;
  /** Seconds since the last drawn frame (0 on the first). */
  dt: number;
  /** Render time in seconds on the sim clock: (tick + alpha) / 30. */
  now: number;
  /** The ONE shared impact light (`skill-fx` `flash`), 0..1 of its intensity. Never make another. */
  flash(at: Vector3, level?: number): void;
  /** The renderer's camera trauma (juice.ts), `weight` 0..1 like a skill's shake weight. */
  shake?(weight: number): void;
  /**
   * Hand a free-running scene effect (a sky darkening, a slam on its own clock) to the
   * dispatcher: updated every frame until it says done, and disposed on an area change
   * or the scene's teardown. Always present under the dispatcher.
   */
  adopt?(handle: BurstHandle): void;
}

/** A body a look rides on: its drawn root (feet at local y 0) and where it stands. */
export interface ActorRef {
  node: TransformNode;
  /** World position of the root (x, z on the floor). */
  x: number;
  z: number;
  /** Yaw the body faces (radians, +z = 0). */
  yaw: number;
}

/** Something drawn while a condition holds. */
export interface FxHandle<S = void> {
  update?(ctx: LookContext, state: S): void;
  /**
   * The condition ended. Called every frame after, with seconds since; return
   * false once nothing is left to draw. Absent = disposed at once.
   */
  fade?(ctx: LookContext, seconds: number): boolean;
  dispose(): void;
}

/** A one-shot left running: `update` returns false when it is finished, then it is disposed. */
export interface BurstHandle {
  update(ctx: LookContext): boolean;
  dispose(): void;
}

// ── Cast ───────────────────────────────────────────────────────────────────────

export interface CastState {
  skillId: string;
  /** Seconds the sim granted the wind-up, when it said. */
  windup?: number;
  /** Aim the sim fixed on the press (unit, sim x/y), when known. */
  dirX: number;
  dirY: number;
}

export interface CastLook {
  /** Any rig clip: a class take (`SKILL_CLIPS`), or the shared cast, bow or a strike take. */
  clip: RigClip;
  /** Fraction of the clip where the skill resolves; landed on the sim's release tick. Default 0.5. */
  release?: number;
  /** Speed multiplier on top of that pacing. Default 1. */
  playback?: number;
  /** FX from the tick `player.castSkill` becomes this skill until the cast ends. */
  start?(ctx: LookContext, body: ActorRef, cast: CastState): FxHandle<ActorRef>;
}

// ── Projectile ─────────────────────────────────────────────────────────────────

export interface ProjectileState {
  id: number;
  skillId: string;
  /** Drawn root: the renderer positions it (hand offset, chest height) and points +z down the flight. */
  node: TransformNode;
  /** Unit flight direction on the floor plane (sim x/y). */
  dirX: number;
  dirY: number;
  team: number;
  /** Its last snapshot, where it struck. */
  spent: boolean;
  /** Drawn as the shipped arrow (`projectileFx.arrow`): `node` is that arrow, flown and posed by the renderer. */
  arrow: boolean;
  /** A chained bolt: the body it left, where it stands (or last stood), and its drawn root while it has one. */
  chainFrom?: { id: number; x: number; z: number; node: TransformNode | null };
}

export interface ProjectileHandle {
  update(ctx: LookContext, p: ProjectileState): void;
  /** It struck: the root has been moved onto the body it hit. Not called for a bolt that ran out of range. */
  impact?(ctx: LookContext, p: ProjectileState): void;
  dispose(): void;
}

export interface ProjectileLook {
  create(ctx: LookContext, p: ProjectileState): ProjectileHandle;
}

// ── Release ────────────────────────────────────────────────────────────────────

/** A cast RESOLVED (`player.castRelease`): its effects applied this tick. */
export interface ReleaseState {
  skillId: string;
  /** Aim the sim fixed on the press (unit, sim x/y). */
  dirX: number;
  dirY: number;
}

// ── Skill area (an areaHit impact, `kind: "skillArea"`) ────────────────────────

export interface AreaState {
  id: number;
  skillId: string;
  x: number;
  y: number;
  radius: number;
  shape: "disc" | "cone";
  /** Unit aim on the floor plane (sim x/y). */
  dirX: number;
  dirY: number;
  /** Cone width, degrees (0 on a disc). */
  arc: number;
  /** Which impact of its cast (0-based; 0 when the cast has one). */
  index: number;
  /** Seconds to impact, interpolated; 0 at and after it. */
  impactIn: number;
  team: number;
}

export interface AreaLook {
  /** Created when first seen with impactIn > 0; updated every frame; disposed when it lands or leaves. */
  warn?(ctx: LookContext, a: AreaState): FxHandle<AreaState>;
  /** Once, on `spent` (or when it vanishes unseen-spent). A returned handle runs until it says done. */
  impact?(ctx: LookContext, a: AreaState): BurstHandle | void;
}

// ── Ground area ────────────────────────────────────────────────────────────────

export interface GroundState {
  id: number;
  skillId: string;
  x: number;
  y: number;
  radius: number;
  /** Seconds left, as the sim reports it (0 when it does not). */
  remaining: number;
  /** Seconds since it was first drawn. */
  age: number;
  team: number;
  /** Where the player stood when it was first drawn (his patches only): a throw's origin. */
  caster?: { x: number; y: number };
}

/** Registered only by skills that replace the cinder disc; every other patch keeps it. */
export interface GroundLook {
  create(ctx: LookContext, g: GroundState): FxHandle<GroundState>;
}

// ── Travel ─────────────────────────────────────────────────────────────────────

export interface TravelState {
  skillId: string;
  /** 0..1 through the travel, interpolated. */
  progress: number;
  /** Seconds the whole travel takes. */
  seconds: number;
  dirX: number;
  dirY: number;
}

export interface TravelLook {
  /** Peak lift of the body over the travel, units; 0 or absent keeps him on the floor. */
  arcHeight?: number;
  /** Played over the travel, paced to its length. */
  clip?: RigClip;
  playback?: number;
  /** "travel" (default) turns the body down the heading; "aim" keeps it on the cursor (a hop backwards). */
  face?: "travel" | "aim";
  /** FX while travelling, riding the player. */
  start?(ctx: LookContext, body: ActorRef, t: TravelState): FxHandle<{ body: ActorRef; travel: TravelState }>;
  /** Once, where he lands. */
  land?(ctx: LookContext, body: ActorRef, t: TravelState): BurstHandle | void;
}

// ── Buffs and statuses ─────────────────────────────────────────────────────────

export interface AttachedState {
  body: ActorRef;
  /** Seconds left, 0 for an aura or a status the wire gives no timer. */
  remaining: number;
  /** False while the body is asleep off screen: hide or pause. */
  visible: boolean;
}

export interface BuffLook {
  /** Created when the buff id appears in `player.buffs`; `aura` for a toggled one. */
  create(ctx: LookContext, s: AttachedState & { aura: boolean }): FxHandle<AttachedState>;
}

export interface StatusLook {
  /** Created when the status id appears on a monster (`stunned` reads the `stunned` flag). */
  create(ctx: LookContext, s: AttachedState & { radius: number; boss: boolean }): FxHandle<AttachedState>;
}

// ── One skill, one class ───────────────────────────────────────────────────────

export interface SkillLook {
  cast?: CastLook;
  /** Once, on the tick the cast resolved: not on its wind-up, and never for a cast a roll cancelled. */
  release?(ctx: LookContext, body: ActorRef, r: ReleaseState): BurstHandle | void;
  /** A whole projectile look, replacing the bolt or arrow. */
  projectile?: ProjectileLook;
  /** Or the shared bolt/arrow pipeline with this profile (colour, trail, flash, arrow). */
  projectileFx?: FxProfile;
  area?: AreaLook;
  ground?: GroundLook;
  travel?: TravelLook;
}

export interface ClassSkillLooks {
  /** Keyed by full skill id (`skill.<x>.v1`). */
  skills: Record<string, SkillLook>;
  /** Keyed by buff id (`player.buffs[].id`). */
  buffs: Record<string, BuffLook>;
  /** Keyed by status id (`SnapshotEntity.statuses`, plus `stunned`). */
  statuses: Record<string, StatusLook>;
}
