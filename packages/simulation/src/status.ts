// Buffs on the player and statuses on monsters: the one place every read site
// asks, so a slow, a stun or a damage-taken modifier means the same thing to
// monster-ai, boss-ai, damage-resolve and the movement systems.
import type { Fixed } from "@exiled/fixed-point";
import type { AilmentSpec, StatusSpec } from "@exiled/content-schema";
import type { World, Entity } from "./ecs";
import type {
  BuffEntry, BuffsC, GroundAreaC, GroundProfile, MonsterC, Position, StatusEntry, StatusesC, StatusOnHit,
} from "./components";
import { damageCode } from "./damage-types";
import { alertPack } from "./systems/monster-ai";

/** Buffs live on this tick: an aura (untilTick 0) or a timed one not yet run out. */
export function activeBuffs(world: World, e: Entity, tick: number): BuffEntry[] {
  const b = world.get<BuffsC>(e, "buffs");
  if (!b) return [];
  return b.list.filter((x) => x.untilTick === 0 || x.untilTick > tick);
}

/** Sum of one numeric buff field over the live buffs. */
export function buffSum(
  world: World, e: Entity, tick: number,
  field: "damagePct" | "speedPct" | "moveSpeedPct" | "damageTakenPct" | "critPct" | "reservePct" | "regen" | "drain",
): number {
  let s = 0;
  for (const b of activeBuffs(world, e, tick)) s += b[field] ?? 0;
  return s;
}

/** Mana held by auras: maxMana * sum(reservePct) / 100. Auras never expire, so no tick is needed. */
export function reservedMana(world: World, e: Entity, maxMana: Fixed): Fixed {
  const b = world.get<BuffsC>(e, "buffs");
  if (!b) return 0;
  let pct = 0;
  for (const x of b.list) if (x.untilTick === 0) pct += x.reservePct ?? 0;
  return Math.trunc((maxMana * pct) / 100);
}

/** Statuses live on this tick. */
export function activeStatuses(world: World, e: Entity, tick: number): StatusEntry[] {
  const s = world.get<StatusesC>(e, "statuses");
  if (!s) return [];
  return s.list.filter((x) => x.untilTick > tick);
}

export function isStunned(mon: MonsterC, tick: number): boolean {
  return mon.stunnedUntilTick !== undefined && tick < mon.stunnedUntilTick;
}

/**
 * A monster's walk this tick: base x (100 - strongest slow) / 100. The strongest,
 * not the sum, so two chills cannot freeze a body. A boss's slows were halved
 * when they were applied. No status = the base, unchanged.
 */
export function monsterSpeed(world: World, e: Entity, base: Fixed, tick: number): Fixed {
  let slow = 0;
  for (const s of activeStatuses(world, e, tick)) slow = Math.max(slow, s.slowPct ?? 0);
  return slow === 0 ? base : Math.trunc((base * (100 - Math.min(100, slow))) / 100);
}

/**
 * Increased damage taken by `target` from a hit of `type`: the player's buffs or
 * the monster's matching statuses, summed. Percent points; 0 = no modifier.
 */
export function damageTakenPct(world: World, target: Entity, type: number, tick: number): number {
  let pct = 0;
  for (const b of activeBuffs(world, target, tick)) pct += b.damageTakenPct ?? 0;
  for (const s of activeStatuses(world, target, tick)) {
    if (s.damageTakenType === undefined || s.damageTakenType === type) pct += s.damageTakenPct ?? 0;
  }
  return pct;
}

/**
 * Put a status on a monster. The same id refreshes, never stacks. A boss takes a
 * stun as nothing and a slow at half. Anything that is not a monster is left alone.
 */
export function applyStatus(world: World, target: Entity, spec: StatusOnHit, tick: number, taunt = false): void {
  const mon = world.get<MonsterC>(target, "monster");
  if (!mon) return;
  const boss = world.has(target, "boss");
  const slow = spec.slowPct ? (boss ? Math.trunc(spec.slowPct / 2) : spec.slowPct) : 0;
  const entry: StatusEntry = {
    id: spec.statusId,
    untilTick: tick + spec.durationTicks,
    ...(spec.damageTakenPct ? { damageTakenPct: spec.damageTakenPct } : {}),
    ...(spec.damageTakenType !== undefined ? { damageTakenType: spec.damageTakenType } : {}),
    ...(slow > 0 ? { slowPct: slow } : {}),
  };
  if (spec.durationTicks > 0) {
    const prev = world.get<StatusesC>(target, "statuses")?.list ?? [];
    world.set<StatusesC>(target, "statuses", { list: [...prev.filter((s) => s.id !== entry.id), entry] });
  }
  if (spec.stunTicks) stun(world, target, spec.stunTicks, tick);
  if (taunt) {
    const now = world.get<MonsterC>(target, "monster")!;
    if (now.state === "idle" && !boss) {
      world.set<MonsterC>(target, "monster", { ...now, state: "chase" });
      alertPack(world, target);
    }
  }
}

/** Stun a monster for `ticks`, never shortening one already running. Bosses resist stun outright. */
export function stun(world: World, target: Entity, ticks: number, tick: number): void {
  const mon = world.get<MonsterC>(target, "monster");
  if (!mon || ticks <= 0 || world.has(target, "boss")) return;
  const until = tick + ticks;
  if ((mon.stunnedUntilTick ?? 0) >= until) return;
  world.set<MonsterC>(target, "monster", { ...mon, stunnedUntilTick: until });
}

/** A content StatusSpec in component terms: the damage type as its DAMAGE_TYPES code. */
export function statusOnHit(spec: StatusSpec): StatusOnHit {
  return {
    statusId: spec.statusId,
    durationTicks: spec.durationTicks,
    ...(spec.damageTakenPct ? { damageTakenPct: spec.damageTakenPct } : {}),
    ...(spec.damageTakenType !== undefined ? { damageTakenType: damageCode(spec.damageTakenType) } : {}),
    ...(spec.slowPct ? { slowPct: spec.slowPct } : {}),
    ...(spec.stunTicks ? { stunTicks: spec.stunTicks } : {}),
  };
}

/** A content ground spec (trail, corpse fire) as the profile a patch is laid from. */
export function groundProfile(g: { radiusFixed: Fixed; durationTicks: number; ailment: AilmentSpec }): GroundProfile {
  return {
    radius: g.radiusFixed,
    durationTicks: g.durationTicks,
    ailmentKind: g.ailment.kind,
    stacksPerApply: g.ailment.stacksPerApply,
    dps: g.ailment.dpsFixed,
    ailmentDuration: g.ailment.durationTicks,
    maxStacks: g.ailment.maxStacks,
  };
}

/** Lay a burning patch owned by `team` at (x, y), starting to burn this tick. */
export function spawnGroundPatch(
  world: World, x: Fixed, y: Fixed, g: GroundProfile, team: number, skillId: string, tick: number,
): Entity {
  const area = world.create();
  world.set<Position>(area, "position", { x, y });
  world.set<GroundAreaC>(area, "groundArea", {
    radius: g.radius,
    expiryTick: tick + g.durationTicks,
    nextTick: tick,
    ailmentKind: g.ailmentKind,
    stacksPerApply: g.stacksPerApply,
    dps: g.dps,
    ailmentDuration: g.ailmentDuration,
    maxStacks: g.maxStacks,
    team,
    skillId,
  });
  return area;
}

/** Drop run-out buffs and statuses; a list left empty takes its component with it. */
export function expireEffects(world: World, tick: number): void {
  for (const e of world.entitiesWith("buffs")) {
    const b = world.get<BuffsC>(e, "buffs")!;
    const live = b.list.filter((x) => x.untilTick === 0 || x.untilTick > tick);
    if (live.length === b.list.length) continue;
    if (live.length === 0) world.remove(e, "buffs");
    else world.set<BuffsC>(e, "buffs", { list: live });
  }
  for (const e of world.entitiesWith("statuses")) {
    const s = world.get<StatusesC>(e, "statuses")!;
    const live = s.list.filter((x) => x.untilTick > tick);
    if (live.length === s.list.length) continue;
    if (live.length === 0) world.remove(e, "statuses");
    else world.set<StatusesC>(e, "statuses", { list: live });
  }
}
