import type { Scene } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { flash } from "../skill-fx";
import { SKILL_LOOKS } from "./index";
import type {
  ActorRef, AreaState, AttachedState, BurstHandle, ClassSkillLooks, FxHandle, GroundState, LookContext,
  ProjectileHandle, ProjectileState, TravelState,
} from "./types";

const TICKS_PER_SEC = 30;
/** A release older than this many ticks when first seen is history (a restored area), not an event. */
const RELEASE_FRESH_TICKS = 3;

/** A body the dispatcher can hang FX on, and whether it is drawn this frame. */
export type BodyRef = ActorRef & { visible: boolean };

export interface FrameInput {
  prev: Snapshot | null;
  next: Snapshot;
  alpha: number;
  /** The drawn player, null while dead or not yet built. */
  player: ActorRef | null;
  /** A monster's drawn body by entity id, null when it has none. */
  bodyOf(id: number): BodyRef | null;
}

/** How far through a travel he is, interpolated between the two snapshots; null when not travelling. */
export function travelState(prev: Snapshot | null, next: Snapshot, alpha: number): TravelState | null {
  const t = next.player.travel;
  if (!t || t.ticks <= 0) return null;
  const was = prev?.player.travel;
  const from = was && was.skillId === t.skillId && was.elapsed <= t.elapsed ? was.elapsed : t.elapsed;
  const elapsed = from + (t.elapsed - from) * alpha;
  return { skillId: t.skillId, progress: Math.max(0, Math.min(1, elapsed / t.ticks)), seconds: t.ticks / TICKS_PER_SEC, dirX: t.dirX, dirY: t.dirY };
}

/** The body's lift over a travel: a parabola peaking at `arcHeight` halfway. */
export const travelLift = (arcHeight: number, progress: number): number => 4 * arcHeight * progress * (1 - progress);

function areaState(e: SnapshotEntity, alpha: number): AreaState {
  const impactIn = e.spent ? 0 : Math.max(0, (e.impactIn ?? 0) - alpha / TICKS_PER_SEC);
  return {
    id: e.id, skillId: e.skillId ?? "", x: e.x, y: e.y, radius: e.radius ?? 1,
    shape: e.shape === "cone" ? "cone" : "disc", dirX: e.dirX ?? 0, dirY: e.dirY ?? 1, arc: e.arc ?? 0,
    index: e.index ?? 0, impactIn, team: e.team ?? 0,
  };
}

interface Fading { handle: FxHandle<never>; since: number }

/**
 * Drives every class skill look (`SKILL_LOOKS`) off the snapshots and owns each
 * handle's lifetime: an entity that leaves takes its handle with it (after its
 * fade), an area change drops them all, and so does the scene's disposal.
 */
export class SkillLookDispatcher {
  private ctx: LookContext;
  private lastMs = 0;
  private readonly areas = new Map<number, { warn?: FxHandle<AreaState>; fired: boolean; last: AreaState }>();
  private readonly grounds = new Map<number, { handle: FxHandle<GroundState>; born: number; caster?: { x: number; y: number } }>();
  private readonly projectiles = new Map<number, { handle: ProjectileHandle; last: ProjectileState }>();
  private readonly buffs = new Map<string, FxHandle<AttachedState>>();
  /** `<monster id>:<status id>` */
  private readonly statuses = new Map<string, { monster: number; handle: FxHandle<AttachedState> }>();
  private cast: { skillId: string; handle: FxHandle<ActorRef> } | null = null;
  private travel: { skillId: string; handle?: FxHandle<{ body: ActorRef; travel: TravelState }>; last: TravelState } | null = null;
  private readonly bursts: BurstHandle[] = [];
  private readonly fading: Fading[] = [];

  /** Tick of the last release drawn, so one release fires once however many frames show it. */
  private releasedAt = -1;

  constructor(scene: Scene, private readonly looks: ClassSkillLooks = SKILL_LOOKS, opts: { shake?(weight: number): void } = {}) {
    this.ctx = {
      scene, dt: 0, now: 0,
      flash: (at, level) => flash(scene, at, level),
      adopt: (handle) => { this.bursts.push(handle); },
      ...(opts.shake ? { shake: opts.shake } : {}),
    };
    scene.onDisposeObservable?.addOnce(() => this.clear());
  }

  /** Whether this skill's ground patches are its own look rather than the cinder disc. */
  ownsGround(skillId: string | undefined): boolean {
    return skillId !== undefined && this.looks.skills[skillId]?.ground !== undefined;
  }

  /** Whether this skill's projectiles are its own look rather than the bolt or arrow. */
  ownsProjectile(skillId: string | undefined): boolean {
    return skillId !== undefined && this.looks.skills[skillId]?.projectile !== undefined;
  }

  /** How many handles are alive, for the lifetime tests and the DEV console. */
  get live(): number {
    return this.areas.size + this.grounds.size + this.projectiles.size + this.buffs.size + this.statuses.size
      + (this.cast ? 1 : 0) + (this.travel?.handle ? 1 : 0) + this.bursts.length + this.fading.length;
  }

  /** Start of a frame: the clock every look of this frame is handed. */
  begin(next: Snapshot, alpha: number, nowMs: number = performance.now()): void {
    const dt = this.lastMs > 0 ? Math.min(0.1, (nowMs - this.lastMs) / 1000) : 0;
    this.lastMs = nowMs;
    this.ctx = { ...this.ctx, dt, now: (next.tick + alpha) / TICKS_PER_SEC };
  }

  /**
   * A custom-look projectile's drawn root this frame (the shipped arrow when `arrow`);
   * its handle is made on first sight. `chainFrom` is the body a chained bolt left.
   */
  projectile(
    e: SnapshotEntity, node: ProjectileState["node"], dirX: number, dirY: number,
    arrow = false, chainFrom?: ProjectileState["chainFrom"],
  ): void {
    const look = e.skillId === undefined ? undefined : this.looks.skills[e.skillId]?.projectile;
    if (!look) return;
    const state: ProjectileState = {
      id: e.id, skillId: e.skillId!, node, dirX, dirY, team: e.team ?? 0, spent: e.spent === true, arrow,
      ...(chainFrom ? { chainFrom } : {}),
    };
    let entry = this.projectiles.get(e.id);
    if (!entry) {
      entry = { handle: look.create(this.ctx, state), last: state };
      this.projectiles.set(e.id, entry);
    }
    entry.last = state;
    entry.handle.update(this.ctx, state);
  }

  /** The projectile left the snapshot; `struck` when its last one was spent (its root already on the body). */
  projectileGone(id: number, struck: boolean): void {
    const entry = this.projectiles.get(id);
    if (!entry) return;
    this.projectiles.delete(id);
    if (struck) entry.handle.impact?.(this.ctx, { ...entry.last, spent: true });
    entry.handle.dispose();
  }

  /** Everything else, once per drawn frame after the meshes are synced. */
  frame(f: FrameInput): void {
    const { next, alpha } = f;
    const ctx = this.ctx;
    const seen = new Set<number>();

    for (const e of next.entities) {
      if (e.kind === "skillArea") {
        seen.add(e.id);
        this.area(e, alpha);
      } else if (e.kind === "groundArea" && this.ownsGround(e.skillId)) {
        seen.add(e.id);
        const g = this.grounds.get(e.id);
        const born = g?.born ?? ctx.now;
        const caster = g ? g.caster : (e.team ?? 0) === 0 ? { x: next.player.x, y: next.player.y } : undefined;
        const state: GroundState = {
          id: e.id, skillId: e.skillId!, x: e.x, y: e.y, radius: e.radius ?? 1,
          remaining: e.remainingSeconds ?? 0, age: ctx.now - born, team: e.team ?? 0, ...(caster ? { caster } : {}),
        };
        if (g) g.handle.update?.(ctx, state);
        else this.grounds.set(e.id, { handle: this.looks.skills[e.skillId!]!.ground!.create(ctx, state), born, ...(caster ? { caster } : {}) });
      }
    }
    for (const [id, a] of this.areas) {
      if (seen.has(id)) continue;
      // A player's area always lands (a dead owner does not cancel it): one that
      // vanished between two drawn frames landed in a snapshot we skipped.
      if (!a.fired) this.fireArea(a.last);
      a.warn?.dispose();
      this.areas.delete(id);
    }
    for (const [id, g] of this.grounds) {
      if (seen.has(id)) continue;
      this.grounds.delete(id);
      this.retire(g.handle);
    }

    this.castFrame(f);
    this.releaseFrame(f);
    this.travelFrame(f);
    this.buffFrame(f);
    this.statusFrame(f);

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (this.bursts[i]!.update(ctx)) continue;
      this.bursts[i]!.dispose();
      this.bursts.splice(i, 1);
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const fade = this.fading[i]!;
      if (fade.handle.fade?.(ctx, ctx.now - fade.since)) continue;
      fade.handle.dispose();
      this.fading.splice(i, 1);
    }
  }

  /** An area change: nothing drawn belongs to the place just left. */
  clear(): void {
    for (const a of this.areas.values()) a.warn?.dispose();
    this.areas.clear();
    for (const g of this.grounds.values()) g.handle.dispose();
    this.grounds.clear();
    for (const p of this.projectiles.values()) p.handle.dispose();
    this.projectiles.clear();
    for (const b of this.buffs.values()) b.dispose();
    this.buffs.clear();
    for (const s of this.statuses.values()) s.handle.dispose();
    this.statuses.clear();
    this.cast?.handle.dispose();
    this.cast = null;
    this.travel?.handle?.dispose();
    this.travel = null;
    for (const b of this.bursts) b.dispose();
    this.bursts.length = 0;
    for (const f of this.fading) f.handle.dispose();
    this.fading.length = 0;
  }

  private area(e: SnapshotEntity, alpha: number): void {
    const state = areaState(e, alpha);
    const look = this.looks.skills[state.skillId]?.area;
    let a = this.areas.get(e.id);
    if (!a) {
      a = { fired: false, last: state };
      if (!e.spent && state.impactIn > 0 && look?.warn) a.warn = look.warn(this.ctx, state);
      this.areas.set(e.id, a);
    }
    a.last = state;
    if (e.spent) {
      if (!a.fired) this.fireArea(state);
      a.fired = true;
      a.warn?.dispose();
      a.warn = undefined;
    } else {
      a.warn?.update?.(this.ctx, state);
    }
  }

  private fireArea(state: AreaState): void {
    const burst = this.looks.skills[state.skillId]?.area?.impact?.(this.ctx, state);
    if (burst) this.bursts.push(burst);
  }

  /** Fade a handle out, or drop it at once when it has no fade. */
  private retire(handle: FxHandle<never> | FxHandle<GroundState> | FxHandle<AttachedState>): void {
    if (handle.fade) this.fading.push({ handle: handle as FxHandle<never>, since: this.ctx.now });
    else handle.dispose();
  }

  private castFrame({ next, player }: FrameInput): void {
    const id = player && next.player.casting ? next.player.castSkill : undefined;
    if (this.cast && this.cast.skillId !== id) {
      this.retire(this.cast.handle as FxHandle<never>);
      this.cast = null;
    }
    if (!id || !player) return;
    if (!this.cast) {
      const start = this.looks.skills[id]?.cast?.start;
      if (!start) return;
      const face = next.player.facing ?? next.player.heading ?? { x: 0, y: 1 };
      this.cast = {
        skillId: id,
        handle: start(this.ctx, player, {
          skillId: id, dirX: face.x, dirY: face.y,
          ...(next.player.castWindupTicks !== undefined ? { windup: next.player.castWindupTicks / TICKS_PER_SEC } : {}),
        }),
      };
    }
    this.cast.handle.update?.(this.ctx, player);
  }

  /** A recent cast that resolved: its look's release, once. A stale one (an old cast, a new area) is ignored. */
  private releaseFrame({ next, player }: FrameInput): void {
    const r = next.player.castRelease;
    if (!r || r.tick === this.releasedAt) return;
    this.releasedAt = r.tick;
    if (!player || next.tick - r.tick > RELEASE_FRESH_TICKS) return;
    const release = this.looks.skills[r.skillId]?.release;
    if (!release) return;
    const face = next.player.facing ?? next.player.heading ?? { x: 0, y: 1 };
    const burst = release(this.ctx, player, { skillId: r.skillId, dirX: face.x, dirY: face.y });
    if (burst) this.bursts.push(burst);
  }

  private travelFrame({ prev, next, alpha, player }: FrameInput): void {
    const t = player ? travelState(prev, next, alpha) : null;
    if (this.travel && (!t || t.skillId !== this.travel.skillId)) {
      const ended = this.travel;
      this.travel = null;
      if (ended.handle) this.retire(ended.handle as FxHandle<never>);
      // Landed where he stands now, unless he died or left the area mid-air.
      if (player) {
        const burst = this.looks.skills[ended.skillId]?.travel?.land?.(this.ctx, player, { ...ended.last, progress: 1 });
        if (burst) this.bursts.push(burst);
      }
    }
    if (!t || !player) return;
    if (!this.travel) {
      const look = this.looks.skills[t.skillId]?.travel;
      this.travel = { skillId: t.skillId, last: t, ...(look?.start ? { handle: look.start(this.ctx, player, t) } : {}) };
    }
    this.travel.last = t;
    this.travel.handle?.update?.(this.ctx, { body: player, travel: t });
  }

  private buffFrame({ next, player }: FrameInput): void {
    const active = new Map<string, { aura: boolean; remaining: number }>();
    if (player && next.player.alive) {
      for (const b of next.player.buffs ?? []) {
        if (b.kind === "buff" && this.looks.buffs[b.id]) active.set(b.id, { aura: b.aura === true, remaining: b.remainingSec });
      }
    }
    for (const [id, handle] of this.buffs) {
      if (active.has(id)) continue;
      this.buffs.delete(id);
      this.retire(handle);
    }
    if (!player) return;
    for (const [id, b] of active) {
      const state: AttachedState = { body: player, remaining: b.remaining, visible: true };
      const handle = this.buffs.get(id);
      if (handle) handle.update?.(this.ctx, state);
      else this.buffs.set(id, this.looks.buffs[id]!.create(this.ctx, { ...state, aura: b.aura }));
    }
  }

  private statusFrame({ next, bodyOf }: FrameInput): void {
    const want = new Map<string, { e: SnapshotEntity; status: string; body: BodyRef }>();
    const alive = new Set<number>();
    for (const e of next.entities) {
      if (e.kind !== "monster") continue;
      alive.add(e.id);
      const ids = [...(e.statuses ?? []), ...(e.stunned ? ["stunned"] : [])];
      if (ids.length === 0) continue;
      const body = bodyOf(e.id);
      if (!body) continue;
      for (const status of ids) if (this.looks.statuses[status]) want.set(`${e.id}:${status}`, { e, status, body });
    }
    for (const [key, s] of this.statuses) {
      if (want.has(key)) continue;
      this.statuses.delete(key);
      // A body that left took its geometry with it; one still standing fades it.
      if (alive.has(s.monster)) this.retire(s.handle);
      else s.handle.dispose();
    }
    for (const [key, { e, status, body }] of want) {
      const state: AttachedState = { body, remaining: 0, visible: body.visible };
      const s = this.statuses.get(key);
      if (s) s.handle.update?.(this.ctx, state);
      else {
        this.statuses.set(key, {
          monster: e.id,
          handle: this.looks.statuses[status]!.create(this.ctx, { ...state, radius: e.radius ?? 0.5, boss: e.boss === true }),
        });
      }
    }
  }
}
