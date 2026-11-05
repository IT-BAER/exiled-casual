import { fp, fpClamp, fpStepToward, isqrt, FP_SCALE, type Fixed } from "@exiled/fixed-point";
import { createStream } from "../rng";
import { scalePct, effectiveSkill } from "@exiled/rules";
import type { EffectNode, SkillDef } from "@exiled/content-schema";
import { UTILITY_SKILLS } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import type { World, Entity } from "../ecs";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { sweep, type Collision, type CollisionRef } from "../collision";
import type {
  Position, PlayerC, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC, CastingC, OffenseC, Health, SkillHoldC,
  SkillsC, StrikeC, RollC, BuffsC, BuffEntry, HitPart, MoveDir, MoveTarget, SkillAreaC, TravelC, MonsterC, CastReleaseC,
} from "../components";
import { damageCode } from "../damage-types";
import { bodyRadiusOf } from "../body";
import { canOpenPortal, openPortalAt } from "../areas";
import { hitParts, weaponHit, type HitMod } from "../weapon";
import { applyStatus, buffSum, groundProfile, reservedMana, spawnGroundPatch, statusOnHit } from "../status";

/** How far in front of the caster the Portal skill opens its doorway, toward the aim. */
const PORTAL_OFFSET = fp(1.6);

/** A skill cooling down this long or less repeats on its cooldown, so attack/cast speed paces it. */
const REPEAT_BEAT_MAX_TICKS = 45;

/** sin(5k degrees) x 10000 for k = 0..18. Literal, not trig: the sim never depends on Math.sin rounding. */
const SIN5 = [
  0, 872, 1736, 2588, 3420, 4226, 5000, 5736, 6428, 7071,
  7660, 8192, 8660, 9063, 9397, 9659, 9848, 9962, 10000,
];

/** (dx, dy) turned `deg` degrees, a multiple of 5 within [-90, 90] (the schema holds a fan to that). */
export function rotate(dx: number, dy: number, deg: number): [number, number] {
  const k = Math.abs(deg) / 5;
  const sin = Math.sign(deg) * SIN5[k]!;
  const cos = SIN5[18 - k]!;
  return [Math.trunc((dx * cos - dy * sin) / 10000), Math.trunc((dx * sin + dy * cos) / 10000)];
}

/** A travel in flight. Expired ones linger until playerMovement hands control back. */
export function activeTravel(travel: TravelC | undefined, tick: number): travel is TravelC {
  return travel !== undefined && tick < travel.untilTick;
}

/** The aura an applyBuff skill toggles, if it is one. */
function auraOf(skill: SkillDef): Extract<EffectNode, { type: "applyBuff" }> | undefined {
  return skill.effects.find((e): e is Extract<EffectNode, { type: "applyBuff" }> =>
    e.type === "applyBuff" && e.durationTicks === 0);
}

export function registerSkillCast(
  sim: Simulation,
  skills: ReadonlyMap<string, SkillDef>,
  collisionRef?: CollisionRef,
  seed = 0,
): void {
  // One stream for every crit roll in the run. It is only drawn from when the
  // skill has a base crit chance at all, so a kit that cannot crit consumes no
  // randomness and replays from before crit existed still check out.
  const critRolls = createStream(seed, "crit");
  // Where scattered impacts fall (Rain of Arrows, Firestorm). Drawn only by an
  // areaHit with scatterFixed > 0, so every older replay draws nothing from it.
  const scatterRolls = createStream(seed, "skillScatter");

  // How long one useSkill command counts as "still holding the button". The
  // client re-issues per 30 Hz snapshot while held, so three ticks bridges any
  // jitter without dragging the slow walk past the release.
  const SKILL_HOLD_TICKS = 3;

  /**
   * The gem level this caster has in this skill, or 1. One lookup per cast: the
   * fold is a handful of integer ops, and caching it would need an invalidation
   * rule for every character level, every load and every respec.
   */
  const gemLevelFor = (world: World, skillId: string): number => {
    const e = world.query("session")[0];
    if (e === undefined) return 1;
    return world.get<SkillsC>(e, "skills")?.gems[skillId]?.level ?? 1;
  };

  /**
   * Whether the character may cast this at all: it is on his bar, which every
   * write path filters to his level and class (persist.ts filterUnlockedBar).
   * A utility (Portal) is never slotted. A world with no session has no character.
   */
  const holds = (world: World, skillId: string): boolean => {
    if (UTILITY_SKILLS.has(skillId)) return true;
    const e = world.query("session")[0];
    if (e === undefined) return true;
    return world.get<SkillsC>(e, "skills")?.bar.includes(skillId) ?? false;
  };

  const actionFor = (skill: SkillDef): "spell" | "melee" | "bow" =>
    skill.effects.some((effect) => effect.type === "meleeStrike") ? "melee" : skill.bow ? "bow" : "spell";

  /** A point inside a disc of radius r, uniform: rejection on the square, bounded. */
  const scatter = (r: number): { x: number; y: number } => {
    for (let i = 0; i < 16; i++) {
      const x = scatterRolls.nextInt(-r, r);
      const y = scatterRolls.nextInt(-r, r);
      if (x * x + y * y <= r * r) return { x, y };
    }
    return { x: 0, y: 0 };
  };

  function resolveSkill(
    world: World,
    tick: number,
    caster: number,
    skill: SkillDef,
    tx: number,
    ty: number,
    spellDamagePct: number,
    didCrit: boolean,
    casterTeam: number,
    collision: Collision | undefined,
    scroll = false,
    hit?: HitMod,
  ): void {
    const pos = world.get<Position>(caster, "position");
    if (!pos) return;
    // Every part of a hit takes the same increased damage and the same crit; each
    // keeps its own type, so resistance and armour read it apart (one event per part).
    const partsOf = (damage: { type: Parameters<typeof damageCode>[0]; amountFixed: number }): HitPart[] =>
      hitParts(damage.amountFixed, damageCode(damage.type), hit)
        .map((p) => ({ type: p.type, amount: scalePct(p.amount, spellDamagePct) * (didCrit ? 2 : 1) }));

    /** Aim as a unit vector x1000: toward (tx, ty), else the way he faces, else +x. */
    const aim = (): { dirX: number; dirY: number } => {
      const ax = tx - pos.x;
      const ay = ty - pos.y;
      const len = isqrt(ax * ax + ay * ay);
      if (len > 0) return { dirX: Math.trunc((ax * 1000) / len), dirY: Math.trunc((ay * 1000) / len) };
      const md = world.get<MoveDir>(caster, "moveDir");
      if (md && (md.hx !== 0 || md.hy !== 0)) {
        return { dirX: Math.trunc((md.hx * 1000) / FP_SCALE), dirY: Math.trunc((md.hy * 1000) / FP_SCALE) };
      }
      return { dirX: 1000, dirY: 0 };
    };

    /** A point placed from (fx, fy) by (dx, dy), stopped at the first wall, inside the world. */
    const placed = (fx: Fixed, fy: Fixed, dx: Fixed, dy: Fixed): { x: Fixed; y: Fixed } => {
      const reach = collision ? sweep(collision, fx, fy, dx, dy, 0) : { dx, dy };
      return { x: fpClamp(fx + reach.dx, WORLD_MIN, WORLD_MAX), y: fpClamp(fy + reach.dy, WORLD_MIN, WORLD_MAX) };
    };

    /** Where an `at` effect centres: on him, or at the aim clamped to its range and stopped at a wall. */
    const centreOf = (at: "self" | "target", maxRange: Fixed | undefined): { x: Fixed; y: Fixed } => {
      if (at === "self") return { x: pos.x, y: pos.y };
      const step = maxRange === undefined
        ? { dx: tx - pos.x, dy: ty - pos.y }
        : fpStepToward(pos.x, pos.y, tx, ty, maxRange);
      return placed(pos.x, pos.y, step.dx, step.dy);
    };

    for (const effect of skill.effects) {
      if (effect.type === "spawnProjectile") {
        const speedPerTick = Math.trunc(effect.speedPerSecFixed / 30);
        const step = fpStepToward(pos.x, pos.y, tx, ty, speedPerTick);
        if (step.dx === 0 && step.dy === 0) continue; // aim on top of caster

        const n = effect.count ?? 1;
        const [main, ...extra] = partsOf(effect.damage);
        for (let i = 0; i < n; i++) {
          const off = n > 1 ? ((effect.spreadDegrees ?? 0) * (2 * i - (n - 1))) / (2 * (n - 1)) : 0;
          const [dirx, diry] = off === 0 ? [step.dx, step.dy] : rotate(step.dx, step.dy, off);
          const proj = world.create();
          world.set<Position>(proj, "position", { x: pos.x, y: pos.y });
          world.set<ProjectileC>(proj, "projectile", {
            dirx,
            diry,
            remainingRange: effect.maxRangeFixed,
            radius: effect.radiusFixed,
            damageType: main!.type,
            damageAmount: main!.amount,
            ownerId: caster,
            team: casterTeam,
            ...(effect.pierceCount ? { pierceLeft: effect.pierceCount, hitIds: [] } : {}),
            ...(n > 1 ? { volley: tick } : {}),
            skillId: skill.id,
            ...(extra.length > 0 ? { extraDamage: extra } : {}),
            ...(effect.explodeRadiusFixed ? { explodeRadius: effect.explodeRadiusFixed } : {}),
            ...(effect.chainCount ? { chainLeft: effect.chainCount, chainRange: effect.chainRangeFixed ?? 0 } : {}),
            ...(effect.onHit ? { onHit: statusOnHit(effect.onHit) } : {}),
            ...(effect.electrocutes ? { electrocutes: true as const } : {}),
          });
        }
      } else if (effect.type === "spawnGroundArea") {
        // Aimed past a wall, the patch lands on the wall instead of in the room
        // behind it. The centre is swept as a point, so the circle may lick over
        // the rock but cannot be placed through it.
        const at = centreOf("target", effect.maxRangeFixed);
        const area = world.create();
        world.set<Position>(area, "position", at);
        const a = effect.ailment;
        world.set<GroundAreaC>(area, "groundArea", {
          radius: effect.radiusFixed,
          expiryTick: tick + effect.durationTicks,
          nextTick: tick,
          ...(a ? {
            ailmentKind: a.kind,
            stacksPerApply: a.stacksPerApply,
            dps: a.dpsFixed,
            ailmentDuration: a.durationTicks,
            maxStacks: a.maxStacks,
          } : {}),
          team: casterTeam,
          skillId: skill.id,
          ...(effect.pulse ? { pulse: { parts: partsOf(effect.pulse.damage), every: effect.pulse.everyTicks, nextPulse: tick } } : {}),
          ...(effect.slowPct ? { slowPct: effect.slowPct } : {}),
        });
      } else if (effect.type === "meleeStrike") {
        // No entity and no flight: the swing resolves inside the cast, which is
        // what lets it hit several targets where a projectile stops at the first.
        const ax = tx - pos.x;
        const ay = ty - pos.y;
        // Aimed at his own feet (a click on a monster standing on him) there is no
        // wedge to test, so the swing takes everything in reach.
        const aimLen = isqrt(ax * ax + ay * ay);

        // The wedge test is a dot product against cos(half-arc), not atan2, so
        // the comparison stays deterministic fixed-point integer math.
        const cosHalfArc = Math.round(Math.cos((effect.arcDegrees / 2) * Math.PI / 180) * 10000);
        const parts = partsOf(effect.damage);
        let hits = 0;
        for (const target of world.query("position", "health", "faction")) {
          if (target === caster) continue;
          if (world.get<Faction>(target, "faction")!.team === casterTeam) continue;
          const tpos = world.get<Position>(target, "position")!;
          const dx = tpos.x - pos.x;
          const dy = tpos.y - pos.y;
          const reach = effect.reachFixed + bodyRadiusOf(world, target);
          const dist2 = dx * dx + dy * dy;
          if (dist2 > reach * reach) continue;

          const dLen = isqrt(dist2);
          if (dLen > 0 && aimLen > 0) {
            const cos = Math.trunc((ax * dx + ay * dy) * 10000 / (aimLen * dLen));
            if (cos < cosHalfArc) continue;
          }

          for (const p of parts) sim.enqueueDamage({ target, source: caster, amountFixed: p.amount, type: p.type });
          hits++;
        }
        world.set<StrikeC>(caster, "strike", { tick, hits, skill: skill.id });
      } else if (effect.type === "teleport") {
        const step = fpStepToward(pos.x, pos.y, tx, ty, effect.distanceFixed);
        let dx = step.dx;
        let dy = step.dy;
        if (collision) {
          // Blink must not land inside a wall and must not cross one.
          const body = world.get<PlayerC>(caster, "player")?.bodyRadius ?? 0;
          const reach = sweep(collision, pos.x, pos.y, step.dx, step.dy, body);
          dx = reach.dx;
          dy = reach.dy;
        }
        world.set<Position>(caster, "position", {
          x: fpClamp(pos.x + dx, WORLD_MIN, WORLD_MAX),
          y: fpClamp(pos.y + dy, WORLD_MIN, WORLD_MAX),
        });
      } else if (effect.type === "openPortal") {
        // Checked again at the END of the cast: a scroll can be dropped, or the
        // map can close, in the two seconds the doorway takes to tear open. A
        // failure refunds the cooldown, so ten seconds are never charged for nothing.
        // PoE opens the doorway a step in front of the caster, never around him.
        const step = fpStepToward(pos.x, pos.y, tx, ty, PORTAL_OFFSET);
        let dx = step.dx;
        let dy = step.dy;
        if (collision) {
          const body = world.get<PlayerC>(caster, "player")?.bodyRadius ?? 0;
          const reach = sweep(collision, pos.x, pos.y, step.dx, step.dy, body);
          dx = reach.dx;
          dy = reach.dy;
        }
        if (!openPortalAt(world, caster, scroll, { x: pos.x + dx, y: pos.y + dy })) {
          const cds = world.get<Cooldowns>(caster, "cooldowns");
          if (cds) world.set<Cooldowns>(caster, "cooldowns", { ...cds, [skill.id]: 0 });
        }
      } else if (effect.type === "areaHit") {
        // Every impact is an entity, even an instant one, so the client always
        // sees it land; the skillArea system resolves each on its impact tick.
        const { dirX, dirY } = aim();
        const centre = centreOf(effect.at, effect.maxRangeFixed);
        const n = effect.count ?? 1;
        const parts = effect.damage ? partsOf(effect.damage) : [];
        for (let i = 0; i < n; i++) {
          let at = centre;
          if (effect.stepFixed && i > 0) {
            const run = effect.stepFixed * i;
            at = placed(centre.x, centre.y, Math.trunc((dirX * run) / 1000), Math.trunc((dirY * run) / 1000));
          }
          if (effect.scatterFixed) {
            const o = scatter(effect.scatterFixed);
            at = { x: fpClamp(at.x + o.x, WORLD_MIN, WORLD_MAX), y: fpClamp(at.y + o.y, WORLD_MIN, WORLD_MAX) };
          }
          const area = world.create();
          world.set<Position>(area, "position", at);
          world.set<SkillAreaC>(area, "skillArea", {
            skillId: skill.id,
            ownerId: caster,
            team: casterTeam,
            radius: effect.radiusFixed,
            startTick: tick,
            impactTick: tick + (effect.delayTicks ?? 0) + i * (effect.intervalTicks ?? 0),
            ...(effect.shape === "cone" ? { shape: "cone" as const, arc: effect.arcDegrees ?? 360 } : {}),
            dirX,
            dirY,
            parts,
            ...(effect.knockbackFixed ? { knockback: effect.knockbackFixed } : {}),
            ...(effect.stunTicks ? { stun: effect.stunTicks } : {}),
            ...(effect.onHit ? { onHit: statusOnHit(effect.onHit) } : {}),
            ...(n > 1 ? { index: i } : {}),
          });
        }
      } else if (effect.type === "applyBuff") {
        const prev = world.get<BuffsC>(caster, "buffs")?.list ?? [];
        const entry: BuffEntry = {
          id: effect.buffId,
          skillId: skill.id,
          untilTick: effect.durationTicks === 0 ? 0 : tick + effect.durationTicks,
          ...(effect.reserveManaPct ? { reservePct: effect.reserveManaPct } : {}),
          ...(effect.damagePct ? { damagePct: effect.damagePct } : {}),
          ...(effect.speedPct ? { speedPct: effect.speedPct } : {}),
          ...(effect.moveSpeedPct ? { moveSpeedPct: effect.moveSpeedPct } : {}),
          ...(effect.damageTakenPct ? { damageTakenPct: effect.damageTakenPct } : {}),
          ...(effect.lifeRegenPerSecFixed ? { regen: effect.lifeRegenPerSecFixed } : {}),
          ...(effect.lifeDrainPerSecFixed ? { drain: effect.lifeDrainPerSecFixed } : {}),
          ...(effect.critChancePct ? { critPct: effect.critChancePct } : {}),
          ...(effect.onKillGround ? { onKill: groundProfile(effect.onKillGround) } : {}),
        };
        if (effect.durationTicks === 0) {
          // An aura switched on: refused if it is already on or the pool cannot
          // hold it now; otherwise its share leaves the pool and stays held.
          if (prev.some((b) => b.id === entry.id)) continue;
          const mana = world.get<Mana>(caster, "mana");
          if (mana) {
            const hold = Math.trunc((mana.maxMana * (entry.reservePct ?? 0)) / 100);
            if (mana.mana < hold) continue;
            world.set<BuffsC>(caster, "buffs", { list: [...prev, entry] });
            const cap = mana.maxMana - reservedMana(world, caster, mana.maxMana);
            world.set<Mana>(caster, "mana", { ...mana, mana: Math.min(mana.mana - hold, cap) });
            continue;
          }
        }
        // A timed buff refreshes its duration, never stacks.
        world.set<BuffsC>(caster, "buffs", { list: [...prev.filter((b) => b.id !== entry.id), entry] });
      } else if (effect.type === "applyStatus") {
        const centre = centreOf(effect.at, effect.maxRangeFixed);
        const spec = statusOnHit(effect);
        const hit: Entity[] = [];
        let best = -1;
        let bestD2 = Infinity;
        for (const target of world.query("monster", "position", "faction")) {
          if (world.get<Faction>(target, "faction")!.team === casterTeam) continue;
          if ((world.get<Health>(target, "health")?.life ?? 1) <= 0) continue;
          const tpos = world.get<Position>(target, "position")!;
          const dx = tpos.x - centre.x;
          const dy = tpos.y - centre.y;
          const d2 = dx * dx + dy * dy;
          const reach = effect.radiusFixed + world.get<MonsterC>(target, "monster")!.bodyRadius;
          if (d2 > reach * reach) continue;
          hit.push(target);
          if (d2 < bestD2) { best = target; bestD2 = d2; }
        }
        for (const target of effect.single ? (best === -1 ? [] : [best]) : hit) {
          applyStatus(world, target, spec, tick, effect.taunt === 1);
        }
        // Where it landed, drawn even when nobody stood there: a parts-less area
        // that resolves this tick and touches nobody (skill-area.ts skips markers).
        const { dirX, dirY } = aim();
        const marker = world.create();
        world.set<Position>(marker, "position", centre);
        world.set<SkillAreaC>(marker, "skillArea", {
          skillId: skill.id, ownerId: caster, team: casterTeam, radius: effect.radiusFixed,
          startTick: tick, impactTick: tick, dirX, dirY, parts: [], marker: 1,
        });
      } else if (effect.type === "travel") {
        const ax = tx - pos.x;
        const ay = ty - pos.y;
        const len = isqrt(ax * ax + ay * ay);
        const away = effect.direction === "away";
        let dirX = 0;
        let dirY = 0;
        if (len > 0) {
          dirX = Math.trunc((ax * FP_SCALE) / len) * (away ? -1 : 1);
          dirY = Math.trunc((ay * FP_SCALE) / len) * (away ? -1 : 1);
        } else {
          // Aimed at his own feet: away from the way he faces, or along it.
          const md = world.get<MoveDir>(caster, "moveDir");
          dirX = (md?.hx ?? 0) * (away ? -1 : 1);
          dirY = (md?.hy ?? 0) * (away ? -1 : 1);
        }
        if (dirX === 0 && dirY === 0) continue;
        const distance = away || len === 0 ? effect.distanceFixed : Math.min(effect.distanceFixed, len);
        const arrival = effect.arrival;
        const trail = effect.trail;
        world.set<TravelC>(caster, "travel", {
          skillId: skill.id,
          startTick: tick,
          untilTick: tick + effect.ticks,
          dirX,
          dirY,
          distance,
          team: casterTeam,
          ...(arrival ? {
            arrival: {
              radius: arrival.radiusFixed,
              parts: arrival.damage ? partsOf(arrival.damage) : [],
              ...(arrival.knockbackFixed ? { knockback: arrival.knockbackFixed } : {}),
              ...(arrival.stunTicks ? { stun: arrival.stunTicks } : {}),
              ...(arrival.onHit ? { onHit: statusOnHit(arrival.onHit) } : {}),
            },
          } : {}),
          ...(trail ? {
            trail: { spacing: trail.spacingFixed, ground: groundProfile(trail) },
            lastTrailX: pos.x,
            lastTrailY: pos.y,
          } : {}),
        });
        // The trail starts under his feet: the first patch is where he took off.
        if (trail) spawnGroundPatch(world, pos.x, pos.y, groundProfile(trail), casterTeam, skill.id, tick);
        // A leap ends where it lands: the walk it interrupted is not resumed.
        const mt = world.get<MoveTarget>(caster, "moveTarget");
        if (mt?.active === 1) world.set<MoveTarget>(caster, "moveTarget", { x: mt.x, y: mt.y, active: 0 });
      }
    }
    // The release edge the client draws a cast's resolve on (render-only, unhashed).
    world.set<CastReleaseC>(caster, "castRelease", { tick, skill: skill.id });
  }

  sim.register("skillCast", (world, tick, commands) => {
    const collision = collisionRef?.active ?? undefined;
    const completedThisTick = new Set<number>();

    // Resolve completed wind-ups before accepting this tick's input. A held
    // button therefore starts the next cast only after the prior action landed.
    for (const caster of world.query("casting")) {
      const casting = world.get<CastingC>(caster, "casting")!;
      if (casting.untilTick > tick) continue;
      if (casting.skillId) {
        const base = skills.get(casting.skillId);
        const skill = base ? effectiveSkill(base, casting.gemLevel ?? 1) : undefined;
        const alive = (world.get<Health>(caster, "health")?.life ?? 1) > 0;
        if (skill && alive) {
          resolveSkill(
            world,
            tick,
            caster,
            skill,
            casting.tx ?? 0,
            casting.ty ?? 0,
            casting.spellDamagePct ?? 0,
            casting.didCrit === 1,
            casting.team ?? world.get<Faction>(caster, "faction")?.team ?? 0,
            collision,
            casting.scroll === 1,
            casting.hit,
          );
        }
      }
      world.remove(caster, "casting");
      completedThisTick.add(caster);
    }

    for (const cmd of commands) {
      if (cmd.type !== "useSkill" || cmd.entity === undefined || !cmd.skillId) continue;
      const caster = cmd.entity;
      const base = skills.get(cmd.skillId);
      if (!base) continue;
      // A skill he does not hold is refused like an unknown id: no hold, no cost.
      if (!holds(world, cmd.skillId)) continue;
      // A corpse does not cast, same rule movement follows. Absent health reads
      // as alive so the health-less test casters are untouched.
      if ((world.get<Health>(caster, "health")?.life ?? 1) <= 0) continue;
      // Mid-roll the button does not exist, not even as a hold: a hold would turn
      // him toward the aim the tick the roll ends, which nobody asked for yet.
      // A travel skill in flight holds it the same way.
      const roll = world.get<RollC>(caster, "roll");
      if (roll && tick < roll.untilTick) continue;
      if (activeTravel(world.get<TravelC>(caster, "travel"), tick)) continue;
      // Every command, refused or not, marks the button as held: the client
      // re-issues per snapshot, so a short window bridges the gaps and movement
      // never bursts back to a run between casts (player-movement reads it).
      world.set<SkillHoldC>(caster, "skillHold", {
        untilTick: tick + SKILL_HOLD_TICKS,
        tx: cmd.data?.["tx"],
        ty: cmd.data?.["ty"],
      });
      if (completedThisTick.has(caster)) continue;

      // A cast is one action, not a queue. Held input can keep issuing commands,
      // but the simulation ignores them until the current wind-up resolves.
      const active = world.get<CastingC>(caster, "casting");
      if (active && active.untilTick > tick) continue;

      const cds = world.get<Cooldowns>(caster, "cooldowns") ?? {};
      if ((cds[cmd.skillId] ?? 0) > tick) continue; // on cooldown

      // An aura that is on goes off: no mana, its reservation let go. Only once the
      // cooldown is up, and it re-arms the cooldown: a held key is re-sent per
      // snapshot, and either edge unguarded lets the next re-send undo it.
      const aura = auraOf(base);
      const buffs = world.get<BuffsC>(caster, "buffs");
      if (aura && buffs?.list.some((b) => b.id === aura.buffId)) {
        const list = buffs.list.filter((b) => b.id !== aura.buffId);
        if (list.length === 0) world.remove(caster, "buffs");
        else world.set<BuffsC>(caster, "buffs", { list });
        world.set<Cooldowns>(caster, "cooldowns", { ...cds, [cmd.skillId]: tick + base.cooldownTicks });
        continue;
      }

      // A Portal that could not open is refused before the wind-up: an animation
      // that ends in nothing reads as a broken key.
      const scroll = cmd.data?.["scroll"] === 1;
      if (base.effects.some((e) => e.type === "openPortal") && !canOpenPortal(world, caster, scroll)) continue;

      const gemLevel = gemLevelFor(world, cmd.skillId);
      const skill = effectiveSkill(base, gemLevel);

      const offense = world.get<OffenseC>(caster, "offense");
      const manaComp = world.get<Mana>(caster, "mana");
      if (!manaComp || manaComp.mana < skill.manaCostFixed) continue; // insufficient mana
      // An aura the pool cannot hold after paying for the cast is refused whole:
      // no mana, no cooldown, as if the key had not been pressed.
      if (aura) {
        const hold = Math.trunc((manaComp.maxMana * (aura.reserveManaPct ?? 0)) / 100);
        if (manaComp.mana - skill.manaCostFixed < hold) continue;
      }
      // What the weapon in hand makes of this cast: its hit, crit and cooldown.
      const weapon = weaponHit(world, skill);
      // A buff's speed also quickens a skill whose cooldown IS its repeat beat
      // (Haste, Blood Rage); a long true cooldown stays as authored, as in PoE.
      const buffSpeed = buffSum(world, caster, tick, "speedPct");
      const cooldownTicks = base.cooldownTicks > 0 && base.cooldownTicks <= REPEAT_BEAT_MAX_TICKS
        && buffSpeed !== 0 && 100 + buffSpeed > 0
        ? Math.max(1, Math.trunc((weapon.cooldownTicks * 100) / (100 + buffSpeed)))
        : weapon.cooldownTicks;

      // Spend mana and set cooldown.
      world.set<Mana>(caster, "mana", {
        mana: manaComp.mana - skill.manaCostFixed,
        maxMana: manaComp.maxMana,
        regen: manaComp.regen,
      });
      world.set<Cooldowns>(caster, "cooldowns", {
        ...cds,
        [cmd.skillId]: tick + cooldownTicks,
      });

      // The caster is slowed during the wind-up. Instant skills (castTicks
      // 0/absent) skip it. Cast speed shortens the wind-up the way PoE does.
      // NOTE (ordering edge case): mana is spent and cooldown is set before the
      // pos/aim guards below. A caster with no Position component, or one aiming
      // exactly on itself, will consume mana and cooldown with no spawned effect.
      // Test casters always have Position; this is per-brief verbatim ordering.

      const pos = world.get<Position>(caster, "position");
      if (!pos) continue;
      const faction = world.get<Faction>(caster, "faction");
      const casterTeam = faction?.team ?? 0;

      const tx = cmd.data?.["tx"] ?? 0;
      const ty = cmd.data?.["ty"] ?? 0;

      // "% increased Damage" (stat id spellDamagePct) scales every skill's hit, and
      // only the hit: in PoE a damaging ailment scales off its own mods, not the
      // damage that lit it, so Cinder Ground's burning dps is deliberately left alone.
      // Buffs add to it, to cast speed and to crit here, at cast start, and the
      // wind-up keeps what they were.
      const spellDamagePct = (offense?.spellDamagePct ?? 0) + buffSum(world, caster, tick, "damagePct");

      // PoE crit: the skill brings the base chance, gear's "% increased Critical
      // Strike Chance" multiplies it rather than adding to it, so 8% with +25%
      // is 10% and not 33%. Rolled in hundredths of a percent to keep that
      // fraction, once per cast, and only for a skill that can crit at all.
      // The bonus is PoE's own base 100% Critical Damage Bonus: a crit is 200%
      // of the hit. Ailments below are left alone, as they are for spell damage.
      // An attack's base is the skill's scaled by the weapon against the starter's.
      const baseCrit100 = weapon.critPct100;
      const didCrit = baseCrit100 > 0
        && critRolls.nextInt(0, 9999)
          < scalePct(baseCrit100, (offense?.critChancePct ?? 0) + buffSum(world, caster, tick, "critPct"));

      const castSpeedPct = (offense?.castSpeedPct ?? 0) + buffSum(world, caster, tick, "speedPct");
      const timingScale = 100 + castSpeedPct;
      const castTicks = skill.castTicks
        ? timingScale > 0
          ? Math.max(1, Math.trunc((skill.castTicks * 100) / timingScale))
          : skill.castTicks
        : 0;
      // The arm is paced by the beat the player watches, which is the repeat
      // interval and not the wind-up. Holding the button re-fires only once the
      // cooldown is up, so a 0.5s clip squeezed into a 7-tick wind-up sprinted
      // through the swing at twice speed and then stood still for the other 8:
      // read as the cast being far too fast. Whichever of the two is longer is
      // the real gap between one release and the next.
      const beatTicks = Math.max(castTicks, cooldownTicks);
      if (castTicks > 0) {
        world.set<CastingC>(caster, "casting", {
          untilTick: tick + castTicks,
          skillId: skill.id,
          tx,
          ty,
          spellDamagePct,
          didCrit: didCrit ? 1 : 0,
          team: casterTeam,
          action: actionFor(skill),
          ticks: beatTicks,
          gemLevel,
          ...(scroll ? { scroll: 1 as const } : {}),
          ...(weapon.mod ? { hit: weapon.mod } : {}),
        });
        continue;
      }

      // No wind-up means this is still an instant skill, such as Blink.
      resolveSkill(world, tick, caster, skill, tx, ty, spellDamagePct, didCrit, casterTeam, collision, false, weapon.mod);
    }
  });
}
