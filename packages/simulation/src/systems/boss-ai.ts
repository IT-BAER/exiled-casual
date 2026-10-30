import { fp, fpClamp, fpDist2, fpMul, fpStepToward, isqrt, type Fixed } from "@exiled/fixed-point";
import type {
  MonsterDef, BossSpec, BossAbility, BossBroodAbility, BossVolleyAbility,
} from "@exiled/content-schema";
import { Simulation } from "../loop";
import type { World, Entity } from "../ecs";
import { chaseStep, hasLineOfSight, slide, type Collision, type CollisionRef } from "../collision";
import { spawnAdd, mapDangerScale } from "../areas";
import { damageCode } from "../damage-types";
import type { Position, MonsterC, Faction, BossC, TelegraphC, Health, SessionC } from "../components";

type BossStrike = Exclude<BossAbility, BossBroodAbility>;

// Where phase-2 adds appear, as offsets from the boss. Hand-written literals in
// the codebase's ring idiom (cf. PORTAL_RING / PACK_RING) — no runtime trig, so
// the summon is deterministic. addCount imps take the first slots.
export const SUMMON_RING: readonly { dx: number; dy: number }[] = [
  { dx: fp(2.5),  dy: fp(0) },
  { dx: fp(-2.5), dy: fp(0) },
  { dx: fp(0),    dy: fp(2.5) },
  { dx: fp(0),    dy: fp(-2.5) },
  { dx: fp(1.8),  dy: fp(1.8) },
  { dx: fp(-1.8), dy: fp(-1.8) },
];

// Where a volley's unfollowed discs land round the player: the first on him, the
// rest 1.5 units out at uneven angles, inside the reach of a 1.3 disc on a body.
// Standing still takes every one; the answer is to run. Literals: no trig.
export const VOLLEY_RING: readonly { dx: number; dy: number }[] = [
  { dx: fp(0),    dy: fp(0) },
  { dx: fp(1.5),  dy: fp(0.4) },
  { dx: fp(-0.9), dy: fp(1.3) },
  { dx: fp(-1.1), dy: fp(-1.1) },
  { dx: fp(0.6),  dy: fp(-1.4) },
  { dx: fp(0.3),  dy: fp(1.5) },
];

/** How wide a brood mark is drawn. It hurts nobody, so only the eye reads it. */
export const BROOD_MARK_RADIUS = fp(1);

/**
 * How close the player has to come before the boss wakes. Matched to the half-extent
 * mapgen carves the boss room to (`bossRoom` spans x 30..50, y cy±10), so the warden
 * activates as you cross its threshold rather than marching the length of the map from
 * tick 0 — PoE arms a boss when you enter its arena, not when you open the portal. The
 * HUD raises the boss bar off `bossAwake` (this wake), so the bar and the fight start together.
 *
 * A unit wider than `slam.rangeFixed` (9), which leaves the narrow band where a woken
 * boss closes on foot instead of opening with a slam. Waking is carried by MonsterC.state
 * exactly as trash carries it in monster-ai.ts; only BOSS_LEASH_RADIUS puts it back to sleep.
 */
export const BOSS_AGGRO_RADIUS: number = fp(10);

/**
 * How far from `BossC.spawnX/spawnY` the player may go before a woken boss gives up,
 * walks home and sleeps (PoE2's arena leash). Measured from the spawn, not the walls,
 * because the coast's bay has none; twice the 2x2 boss block's half-width.
 */
export const BOSS_LEASH_RADIUS: number = fp(16);

/** Phase 3's entrance: the boss stands this long, then opens the phase with its next cast. */
export const PHASE3_ROOT_TICKS = 30;

/** Ticks between casts in `phase`: the slam's cooldown, quickened by each phase past the first. */
function cadence(spec: BossSpec, phase: 1 | 2 | 3): number {
  const { cooldownTicks } = spec.slam;
  if (phase === 1) return cooldownTicks;
  if (phase === 2) return Math.trunc((cooldownTicks * spec.phase2.cadenceMulPct) / 100);
  return Math.trunc((cooldownTicks * spec.phase2.cadenceMulPct * (spec.phase3CadenceMulPct ?? 100)) / 10000);
}

/** From (x, y) toward (tx, ty): the unit direction x1000 (no trig) and the distance. */
function aim(x: Fixed, y: Fixed, tx: Fixed, ty: Fixed): { dirX: number; dirY: number; dist: Fixed } {
  const dx = tx - x;
  const dy = ty - y;
  const dist = isqrt(dx * dx + dy * dy);
  if (dist === 0) return { dirX: 1000, dirY: 0, dist };
  return { dirX: Math.trunc((dx * 1000) / dist), dirY: Math.trunc((dy * 1000) / dist), dist };
}

/** One hostile mark of a kit ability at (x, y), its hit scaled by the map like the slam's. */
function mark(
  world: World, owner: Entity, team: number, a: BossStrike, x: Fixed, y: Fixed,
  tick: number, impactTick: number, dmgMilli: number, shape: Partial<TelegraphC>,
): void {
  const tele = world.create();
  world.set<Position>(tele, "position", { x, y });
  world.set<TelegraphC>(tele, "telegraph", {
    ownerId: owner, team, radius: 0, startTick: tick, impactTick,
    damage: fpMul(a.damage.amountFixed, dmgMilli), damageType: damageCode(a.damage.type),
    leavesGroundTicks: 0, ability: a.id, ...shape,
  });
}

/** One mark of a volley, aimed at the player now: a disc where he stands, or a lane at him from the boss. */
function volleyMark(
  world: World, owner: Entity, team: number, a: BossVolleyAbility, bpos: Position, ppos: Position,
  tick: number, dmgMilli: number,
): void {
  const impact = tick + a.windupTicks;
  if (a.radiusFixed !== undefined) {
    mark(world, owner, team, a, ppos.x, ppos.y, tick, impact, dmgMilli, { radius: a.radiusFixed });
    return;
  }
  const { dirX, dirY } = aim(bpos.x, bpos.y, ppos.x, ppos.y);
  mark(world, owner, team, a, bpos.x, bpos.y, tick, impact, dmgMilli,
    { shape: "line", dirX, dirY, length: a.lengthFixed!, radius: a.halfWidthFixed! });
}

/**
 * A brood wave: marks round the boss on walkable ground, each raising one add as
 * it lands (telegraph-resolve). Fewer as the living brood plus the marks still
 * showing near maxAlive.
 */
function raiseBrood(
  world: World, collision: Collision | undefined, monsters: ReadonlyMap<string, MonsterDef>,
  owner: Entity, team: number, brood: BossBroodAbility, bpos: Position, tick: number,
): void {
  const addDef = monsters.get(brood.addDefId);
  if (addDef === undefined) return;
  const alive = world.query("monster").filter((m) => world.get<MonsterC>(m, "monster")!.summoned === 1
    && (world.get<Health>(m, "health")?.life ?? 1) > 0).length;
  const showing = world.query("telegraph")
    .filter((t) => world.get<TelegraphC>(t, "telegraph")!.spawnDefId !== undefined).length;
  for (let k = 0; k < Math.min(brood.count, brood.maxAlive - alive - showing); k++) {
    const slot = SUMMON_RING[(tick + k) % SUMMON_RING.length]!;
    const sx = bpos.x + slot.dx;
    const sy = bpos.y + slot.dy;
    const spot = collision && !collision.isWalkable(sx, sy, addDef.radiusFixed) ? bpos : { x: sx, y: sy };
    const tele = world.create();
    world.set<Position>(tele, "position", { x: spot.x, y: spot.y });
    world.set<TelegraphC>(tele, "telegraph", {
      ownerId: owner, team, radius: BROOD_MARK_RADIUS, startTick: tick, impactTick: tick + brood.windupTicks,
      damage: 0, damageType: 0, leavesGroundTicks: 0, ability: brood.id, spawnDefId: brood.addDefId,
    });
  }
}

export function registerBossAI(
  sim: Simulation,
  monsters: ReadonlyMap<string, MonsterDef>,
  collisionRef?: CollisionRef,
): void {
  sim.register("bossAI", (world, tick) => {
    const collision = collisionRef?.active ?? undefined;

    // A monster's life and basic attack are scaled by the map's tier at spawn
    // (areas.spawnMonster), but a boss's abilities are read off the content def
    // every time it casts, so they never saw the tier at all: a Tier 15 Warden
    // was slamming for its Tier 1 number. Read the same knob here rather than
    // baking it onto BossC, so a world without a session — the golden replays —
    // serializes exactly as it always has.
    const sessionE = world.query("session")[0];
    const session = sessionE === undefined ? undefined : world.get<SessionC>(sessionE, "session");
    const { dmgMilli } = session ? mapDangerScale(session) : { dmgMilli: 1000 };
    for (const e of world.query("boss", "monster", "position", "faction")) {
      const mon = world.get<MonsterC>(e, "monster")!;
      const def = monsters.get(mon.defId);
      if (!def?.boss) continue;

      // A corpse is not a target — same rule as monster-ai, so the boss holds
      // still while the death screen is up instead of slamming the body. Missing
      // health reads as alive, which keeps every health-less fixture identical.
      const players = world
        .query("player", "position")
        .filter((p) => (world.get<Health>(p, "health")?.life ?? 1) > 0);
      const playerEntity = players[0];
      if (playerEntity === undefined) continue;

      let boss = world.get<BossC>(e, "boss")!;
      const bpos = world.get<Position>(e, "position")!;
      const ppos = world.get<Position>(playerEntity, "position")!;
      const { slam, phase2 } = def.boss;

      // 0. Phase 2 transition — once, when life drops to the threshold. Summon adds
      //    on a ring, then spend this tick transitioning. Cross-multiply keeps the
      //    percentage exact (life/maxLife are Fixed). No health component → never
      //    transitions, which preserves the health-less test fixtures byte-for-byte.
      const health = world.get<Health>(e, "health");
      if (
        boss.phase === 1 &&
        health !== undefined &&
        health.life * 100 <= health.maxLife * def.boss.phase2AtLifePct
      ) {
        const addDef = monsters.get(phase2.addDefId);
        if (addDef !== undefined) {
          const n = Math.min(phase2.addCount, SUMMON_RING.length);
          for (let i = 0; i < n; i++) {
            const slot = SUMMON_RING[i]!;
            // Keep the add on walkable ground: fall back to the boss's own cell
            // (always walkable — it is standing there) if the ring slot is a wall.
            const sx = bpos.x + slot.dx;
            const sy = bpos.y + slot.dy;
            const spot = collision && !collision.isWalkable(sx, sy, addDef.radiusFixed)
              ? { x: bpos.x, y: bpos.y }
              : { x: sx, y: sy };
            spawnAdd(world, addDef, spot.x, spot.y);
          }
        }
        world.set<BossC>(e, "boss", { ...boss, phase: 2 });
        continue;
      }

      // 0b. Phase 3, once, below phase3AtLifePct. Absent on the spec = no third phase.
      const pct3 = def.boss.phase3AtLifePct;
      if (boss.phase === 2 && health !== undefined && pct3 !== undefined
        && health.life * 100 <= health.maxLife * pct3) {
        world.set<BossC>(e, "boss", {
          ...boss, phase: 3, rootedUntilTick: tick + PHASE3_ROOT_TICKS, nextAbilityTick: tick + PHASE3_ROOT_TICKS,
        });
        continue;
      }

      // 1. Rooted during slam wind-up — do not move or melee.
      if (tick < boss.rootedUntilTick) {
        world.set<MonsterC>(e, "monster", { ...mon, state: "attack" });
        continue;
      }

      // 1b. Running a lane to its end after the hit. The step is the distance left
      //     over the ticks left, so the run lands on dashUntilTick with no content
      //     lookup; a wall ends it early.
      if (mon.dashUntilTick !== undefined && tick < mon.dashUntilTick) {
        const left = isqrt(fpDist2(bpos.x, bpos.y, mon.dashX!, mon.dashY!));
        const step = fpStepToward(bpos.x, bpos.y, mon.dashX!, mon.dashY!, Math.ceil(left / (mon.dashUntilTick - tick)));
        const out = collision
          ? slide(collision, bpos.x, bpos.y, step.dx, step.dy, mon.bodyRadius)
          : { x: bpos.x + step.dx, y: bpos.y + step.dy };
        const done = (out.x === mon.dashX && out.y === mon.dashY) || (out.x === bpos.x && out.y === bpos.y);
        world.set<Position>(e, "position", out);
        world.set<MonsterC>(e, "monster", { ...mon, state: "chase", ...(done ? { dashUntilTick: tick } : {}) });
        continue;
      }

      // 2. Leashed: the player left the arena, so walk home and sleep on arrival. No
      //    slam or melee on the way, and life is kept, so backing off to flask is free.
      if (mon.state !== "idle"
        && fpDist2(boss.spawnX, boss.spawnY, ppos.x, ppos.y) > BOSS_LEASH_RADIUS * BOSS_LEASH_RADIUS) {
        const home = chaseStep(
          collision, bpos.x, bpos.y, boss.spawnX, boss.spawnY, mon.moveSpeed, mon.bodyRadius,
        );
        const arrived = home.x === boss.spawnX && home.y === boss.spawnY;
        world.set<Position>(e, "position", home);
        world.set<MonsterC>(e, "monster", { ...mon, state: arrived ? "idle" : "chase" });
        continue;
      }

      // 3. Asleep and still outside its room: hold. Sits below the phase-2 check on
      //    purpose — a boss being shot from off-screen still transitions, it just does
      //    not walk. Nothing is written, so an unvisited boss room costs the checksum
      //    nothing, same as monster-ai's sleeping packs.
      //    A wall counts the same as distance here: the arena door is a wall, and a
      //    boss that woke through it walks its whole room before the player arrives.
      const dist2 = fpDist2(bpos.x, bpos.y, ppos.x, ppos.y);
      if (mon.state === "idle"
        && (dist2 > BOSS_AGGRO_RADIUS * BOSS_AGGRO_RADIUS
          || !hasLineOfSight(collision, bpos.x, bpos.y, ppos.x, ppos.y))) continue;

      const kit = def.boss.abilities ?? [];
      const team = world.get<Faction>(e, "faction")!.team;

      // 3b. A volley in flight drops its next mark on time. Not a cast: the boss
      //     walks and swings between marks.
      if (boss.volleyAtTick !== undefined && tick >= boss.volleyAtTick) {
        const v = kit[boss.volleyAbility ?? -1];
        if (v?.kind === "volley") volleyMark(world, e, team, v, bpos, ppos, tick, dmgMilli);
        const left = (boss.volleyLeft ?? 1) - 1;
        const { volleyAbility, volleyLeft: _l, volleyAtTick: _t, ...rest } = boss;
        boss = left > 0 && v?.kind === "volley"
          ? { ...rest, volleyAbility, volleyLeft: left, volleyAtTick: tick + v.everyTicks }
          : rest;
        world.set<BossC>(e, "boss", boss);
      }

      // 3c. The brood rises on its own timer; a wave due while the boss is rooted or
      //     dashing waits for that to end, and the next interval counts from then.
      const brood = kit.find((x): x is BossBroodAbility => x.kind === "brood" && boss.phase >= x.fromPhase);
      if (brood !== undefined && (boss.broodAtTick === undefined || tick >= boss.broodAtTick)) {
        if (boss.broodAtTick !== undefined) raiseBrood(world, collision, monsters, e, team, brood, bpos, tick);
        boss = { ...boss, broodAtTick: tick + (boss.phase === 3 ? brood.phase3CooldownTicks : brood.cooldownTicks) };
        world.set<BossC>(e, "boss", boss);
      }

      // 4. A kit ability: the first entry unlocked, off its own cooldown and in
      //    range. It spends the gap the slam would, so a kit varies the fight more
      //    than it thickens it; with none castable the gap goes to the slam.
      const ready = boss.abilityReadyTicks ?? [];
      const pick = tick < boss.nextAbilityTick ? -1 : kit.findIndex((a, j) => a.kind !== "brood"
        && boss.phase >= a.fromPhase && tick >= (ready[j] ?? 0)
        && dist2 <= a.rangeFixed * a.rangeFixed
        && (a.kind !== "ring" || dist2 >= a.innerFixed * a.innerFixed));
      const a = kit[pick];
      if (a !== undefined && a.kind !== "brood") {
        const impact = tick + a.windupTicks;
        let cast: BossC = {
          ...boss,
          nextAbilityTick: tick + cadence(def.boss, boss.phase),
          abilityReadyTicks: kit.map((_, j) => (j === pick ? tick + a.cooldownTicks : ready[j] ?? 0)),
        };
        let next: MonsterC = { ...mon, state: "attack", lastAttackTick: tick };
        if (a.kind === "line") {
          const { dirX, dirY, dist } = aim(bpos.x, bpos.y, ppos.x, ppos.y);
          const length = a.overshootFixed === undefined
            ? a.lengthFixed
            : fpClamp(dist + a.overshootFixed, a.minLengthFixed!, a.lengthFixed);
          mark(world, e, team, a, bpos.x, bpos.y, tick, impact, dmgMilli,
            { shape: "line", dirX, dirY, length, radius: a.halfWidthFixed, heavy: 1 });
          if (a.dashSpeedFixed !== undefined) {
            next = {
              ...next,
              dashX: bpos.x + Math.trunc((dirX * length) / 1000),
              dashY: bpos.y + Math.trunc((dirY * length) / 1000),
              dashUntilTick: impact + Math.ceil(length / Math.trunc(a.dashSpeedFixed / 30)),
            };
          }
        } else if (a.kind === "ring") {
          mark(world, e, team, a, bpos.x, bpos.y, tick, impact, dmgMilli,
            { shape: "ring", inner: a.innerFixed, radius: a.radiusFixed, heavy: 1 });
        } else if (a.kind === "nova") {
          mark(world, e, team, a, bpos.x, bpos.y, tick, impact, dmgMilli, { radius: a.radiusFixed, heavy: 1 });
        } else if (a.radiusFixed !== undefined && !a.follow) {
          // Discs that do not follow all show now, round where the player stands.
          for (let k = 0; k < a.count; k++) {
            const o = VOLLEY_RING[k % VOLLEY_RING.length]!;
            mark(world, e, team, a, ppos.x + o.dx, ppos.y + o.dy, tick, impact + k * a.everyTicks, dmgMilli,
              { radius: a.radiusFixed });
          }
        } else {
          volleyMark(world, e, team, a, bpos, ppos, tick, dmgMilli);
          if (a.count > 1) cast = { ...cast, volleyAbility: pick, volleyLeft: a.count - 1, volleyAtTick: tick + a.everyTicks };
        }
        if (a.kind !== "volley") cast = { ...cast, rootedUntilTick: impact };
        world.set<BossC>(e, "boss", cast);
        world.set<MonsterC>(e, "monster", next);
        continue;
      }

      // 5. Slam: fire when off cooldown and player is within slam range.
      if (tick >= boss.nextAbilityTick && dist2 <= slam.rangeFixed * slam.rangeFixed) {
        const bossFaction = world.get<Faction>(e, "faction")!;
        const tele = world.create();
        world.set<Position>(tele, "position", { x: ppos.x, y: ppos.y });
        world.set<TelegraphC>(tele, "telegraph", {
          ownerId: e,
          team: bossFaction.team,
          radius: slam.radiusFixed,
          startTick: tick,
          impactTick: tick + slam.windupTicks,
          damage: fpMul(slam.damageFixed, dmgMilli),
          damageType: 1,
          leavesGroundTicks: boss.phase >= 2 ? phase2.fireGroundDurationTicks : 0,
          heavy: 1,
          ground:
            boss.phase >= 2
              ? {
                  ailmentKind: phase2.fireGround.kind,
                  stacksPerApply: phase2.fireGround.stacksPerApply,
                  dps: fpMul(phase2.fireGround.dpsFixed, dmgMilli),
                  ailmentDuration: phase2.fireGround.durationTicks,
                  maxStacks: phase2.fireGround.maxStacks,
                }
              : undefined,
        });
        world.set<BossC>(e, "boss", {
          ...boss,
          rootedUntilTick: tick + slam.windupTicks,
          nextAbilityTick: tick + cadence(def.boss, boss.phase),
        });
        world.set<MonsterC>(e, "monster", { ...mon, state: "attack", lastAttackTick: tick });
        continue;
      }

      // 6. Chase / melee — mirrors monster-ai.ts exactly, routing on collision.
      const ar = mon.attackRange;
      if (dist2 <= ar * ar) {
        let { attackReadyTick, lastAttackTick } = mon;
        if (tick >= attackReadyTick) {
          sim.enqueueDamage({
            target: playerEntity,
            source: e,
            amountFixed: mon.attackDamage,
            type: mon.attackType,
            via: "melee",
          });
          attackReadyTick = tick + mon.attackCooldownTicks;
          lastAttackTick = tick;
        }
        world.set<MonsterC>(e, "monster", {
          ...mon, state: "attack", attackReadyTick, ...(lastAttackTick === undefined ? {} : { lastAttackTick }),
        });
      } else {
        const moved = chaseStep(
          collision, bpos.x, bpos.y, ppos.x, ppos.y, mon.moveSpeed, mon.bodyRadius,
        );
        world.set<Position>(e, "position", moved);
        world.set<MonsterC>(e, "monster", { ...mon, state: "chase" });
      }
    }
  });
}
