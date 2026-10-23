import { fp, fpDist2, fpMul, fpStepToward, fpClamp, isqrt, type Fixed } from "@exiled/fixed-point";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { chaseStep, hasLineOfSight, slide, type Collision, type CollisionRef } from "../collision";
import { Simulation } from "../loop";
import type { Position, MonsterC, Faction, Health, ProjectileC, TelegraphC, SessionC, PlayerC } from "../components";
import type { Entity, World } from "../ecs";
import { mapDangerScale } from "../areas";
import { MONSTERS } from "@exiled/content-runtime";

/**
 * How close the player has to come before a sleeping monster notices. Just under
 * the height of the ortho view, so a pack wakes as it comes on screen rather than
 * the whole map walking at the entrance the moment a portal opens — which is what
 * a map without this is: one fight against everything in it, at the door.
 *
 * Waking is one-way (the state field carries it): a pulled pack follows you out
 * of the room, because a monster that gave up the chase at a line on the floor
 * would make every fight optional. PoE leashes bosses, not trash; the boss has
 * its own wider radius and its arena leash in boss-ai.ts (BOSS_AGGRO_RADIUS,
 * BOSS_LEASH_RADIUS).
 */
export const AGGRO_RADIUS: number = fp(9);

/**
 * How far a waking monster's alarm carries: every sleeping non-boss within it
 * wakes too, with or without its own line to the player (PoE's pack aggro).
 */
export const PACK_ALERT_RADIUS: number = fp(5);

/**
 * Idle trash strolls within WANDER_RADIUS of where it stood when a player first
 * came within WANDER_NEAR, at WANDER_PCT of its walk, pausing PAUSE_MIN ticks
 * plus up to PAUSE_SPAN between strolls. A room farther off stays still and
 * unwritten, so it costs the checksum nothing, as before.
 */
export const WANDER_RADIUS: Fixed = fp(3);
export const WANDER_NEAR: Fixed = AGGRO_RADIUS * 2;
const WANDER_PCT = 40;
const PAUSE_MIN = 45;
const PAUSE_SPAN = 76;

/** A stroll's dice, off (entity, tick) and no shared RNG stream, so no other roll shifts. */
function strollHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Wake everything asleep within PACK_ALERT_RADIUS of `origin`, and chain from
 * each one woken, all inside this call: a pack strung out wider than the radius
 * still comes as one. Breadth-first in ascending entity id, so it is
 * deterministic. Both ways of waking call it: noticing the player (here) and
 * being hit (damage-resolve.ts). Bosses are never woken: boss-ai owns them.
 */
export function alertPack(world: World, origin: Entity): void {
  const r2 = PACK_ALERT_RADIUS * PACK_ALERT_RADIUS;
  const sleepers = world.query("monster", "position").filter((e) => e !== origin
    && !world.has(e, "boss") && world.get<MonsterC>(e, "monster")!.state === "idle");
  const woken: Entity[] = [origin];
  for (let i = 0; i < woken.length; i++) {
    const o = world.get<Position>(woken[i]!, "position")!;
    for (const e of sleepers) {
      const mon = world.get<MonsterC>(e, "monster")!;
      if (mon.state !== "idle") continue;
      const p = world.get<Position>(e, "position")!;
      if (fpDist2(o.x, o.y, p.x, p.y) > r2) continue;
      world.set<MonsterC>(e, "monster", { ...mon, state: "chase" });
      woken.push(e);
    }
  }
}

/**
 * A shooter backs off a player standing inside KITE_PCT of its attack range, and
 * between shots strafes at STRAFE_PCT of its walk, switching side every
 * STRAFE_FLIP_TICKS, offset by entity id so two shooters do not mirror.
 */
const KITE_PCT = 45;
const STRAFE_PCT = 50;
const STRAFE_FLIP_TICKS = 45;

/** One body in the separation pass. */
export interface PackBody { e: number; x: Fixed; y: Fixed; r: Fixed }

/**
 * How far apart overlapping bodies shove each other. Half the overlap each, so a
 * pair settles exactly at contact rather than trading pushes forever, and capped
 * at a fraction of the mover's own step so separation can never outrun the chase
 * that drove them together (a swarm would orbit the player instead of reaching).
 */
const PUSH_NUM = 1;
const PUSH_DEN = 2;

/**
 * The vector that takes `self` out of every body it overlaps. Deterministic:
 * integer math throughout, and a pair standing on exactly the same point splits
 * along X by entity id, since there is no separating axis to read.
 *
 * ponytail: O(n²) over the awake pack, ~60 bodies a map. A grid goes here if a
 * map ever holds hundreds.
 */
export function packPush(
  pack: readonly PackBody[],
  self: number,
  x: Fixed,
  y: Fixed,
  r: Fixed,
  maxPush: Fixed,
): { dx: Fixed; dy: Fixed } {
  let px = 0;
  let py = 0;
  for (const o of pack) {
    if (o.e === self) continue;
    const dx = x - o.x;
    const dy = y - o.y;
    const min = r + o.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    if (d2 === 0) {
      px += self < o.e ? -min : min;
      continue;
    }
    const d = isqrt(d2);
    const overlap = min - d;
    px += Math.trunc((dx * overlap) / d);
    py += Math.trunc((dy * overlap) / d);
  }
  if (px === 0 && py === 0) return { dx: 0, dy: 0 };
  px = Math.trunc((px * PUSH_NUM) / PUSH_DEN);
  py = Math.trunc((py * PUSH_NUM) / PUSH_DEN);
  const len = isqrt(px * px + py * py);
  if (len <= maxPush || len === 0) return { dx: px, dy: py };
  return { dx: Math.trunc((px * maxPush) / len), dy: Math.trunc((py * maxPush) / len) };
}

/**
 * The room a chaser keeps from other monsters, as a multiple of contact. Inside
 * it the part of its step that closes on a neighbour fades out, gone at contact.
 */
const SPACE_NUM = 5;
const SPACE_DEN = 4;

/**
 * The step (dx, dy) with the part that closes on each monster inside personal
 * space taken out: straight behind a body it stops, off its line it slides past.
 * Never pushes away, so a crowd cannot ring like a spring; overlap is packPush's.
 */
export function giveWay(
  herd: readonly PackBody[], self: number, x: Fixed, y: Fixed, r: Fixed, dx: Fixed, dy: Fixed,
): { dx: Fixed; dy: Fixed } {
  let vx = dx;
  let vy = dy;
  for (const o of herd) {
    if (o.e === self) continue;
    const contact = r + o.r;
    const space = Math.trunc((contact * SPACE_NUM) / SPACE_DEN);
    const rx = o.x - x;
    const ry = o.y - y;
    const d2 = rx * rx + ry * ry;
    if (d2 === 0 || d2 >= space * space) continue;
    const closing = vx * rx + vy * ry;
    if (closing <= 0) continue;
    const d = isqrt(d2);
    const fade = Math.min(space - d, space - contact);
    const den = d2 * (space - contact);
    vx -= Math.trunc((rx * closing * fade) / den);
    vy -= Math.trunc((ry * closing * fade) / den);
  }
  return { dx: vx, dy: vy };
}

/**
 * 24 bearings 15 degrees apart, unit vectors in thousandths: the spots a ring of
 * attackers can stand in round the player. Written out, not Math.cos, so every
 * engine rounds them the same.
 */
const QUARTER = [1000, 966, 866, 707, 500, 259, 0];
const BEARINGS: readonly (readonly [number, number])[] = Array.from({ length: 24 }, (_, i) => {
  const c = QUARTER[i % 6]!;
  const s = QUARTER[6 - (i % 6)]!;
  const q = Math.trunc(i / 6);
  return q === 0 ? [c, s] : q === 1 ? [-s, c] : q === 2 ? [-c, -s] : [s, -c];
});

/**
 * The nearest spot on a ring of `ringR` round (px, py) that no other body and
 * no wall stands on, counted out from `self`'s own bearing on the `side` its id picks.
 * Undefined when the ring is full: then it queues behind it.
 */
export function freeSpot(
  collision: Collision | undefined, pack: readonly PackBody[], self: number, x: Fixed, y: Fixed, r: Fixed,
  px: Fixed, py: Fixed, ringR: Fixed, side: number,
): { x: Fixed; y: Fixed } | undefined {
  let own = 0;
  let best = -Infinity;
  BEARINGS.forEach(([bx, by], i) => {
    const d = (x - px) * bx + (y - py) * by;
    if (d > best) { best = d; own = i; }
  });
  for (let k = 0; k <= 12; k++) {
    for (const s of k === 0 || k === 12 ? [side] : [side, -side]) {
      const [bx, by] = BEARINGS[(own + s * k + 24) % 24]!;
      const sx = px + Math.trunc((ringR * bx) / 1000);
      const sy = py + Math.trunc((ringR * by) / 1000);
      if ((!collision || collision.isWalkable(sx, sy, r))
        && pack.every((o) => o.e === self || fpDist2(sx, sy, o.x, o.y) >= (r + o.r) * (r + o.r))) {
        return { x: sx, y: sy };
      }
    }
  }
  return undefined;
}

/** Offset a body that has already taken its own step, without entering a wall. */
function shove(
  collision: Collision | undefined,
  x: Fixed,
  y: Fixed,
  push: { dx: Fixed; dy: Fixed },
  r: Fixed,
): { x: Fixed; y: Fixed } {
  if (push.dx === 0 && push.dy === 0) return { x, y };
  if (!collision) return { x: x + push.dx, y: y + push.dy };
  return slide(collision, x, y, push.dx, push.dy, r);
}

/**
 * One tick of an idle monster's stroll. A target is taken only with a clear line
 * to it at the body's width, so a stroll never needs routing; arrived, or gaining
 * under a quarter step, it pauses again. Writes only when it starts, picks, moves or stops.
 */
function stroll(
  world: World, collision: Collision | undefined, herd: readonly PackBody[], pack: readonly PackBody[],
  m: Entity, mpos: Position, mon: MonsterC, tick: number,
): void {
  const pause = (): number => tick + PAUSE_MIN + (strollHash(m, tick) % PAUSE_SPAN);
  if (mon.strollAtTick === undefined || mon.homeX === undefined || mon.homeY === undefined) {
    // It stands a while first, so a pack coming into view does not set off as one.
    world.set<MonsterC>(m, "monster", { ...mon, homeX: mpos.x, homeY: mpos.y, strollAtTick: pause() });
    return;
  }
  const r = mon.bodyRadius;
  let { strollX: tx, strollY: ty } = mon;
  if (tx === undefined || ty === undefined) {
    if (tick < mon.strollAtTick) return;
    const h = strollHash(m, tick);
    const [bx, by] = BEARINGS[h % 24]!;
    const reach = Math.trunc((WANDER_RADIUS * (300 + ((h >>> 8) % 701))) / 1000);
    tx = mon.homeX + Math.trunc((reach * bx) / 1000);
    ty = mon.homeY + Math.trunc((reach * by) / 1000);
    if (collision && (!collision.isWalkable(tx, ty, r) || !hasLineOfSight(collision, mpos.x, mpos.y, tx, ty, r))) {
      world.set<MonsterC>(m, "monster", { ...mon, strollAtTick: pause() });
      return;
    }
  }
  const speed = Math.trunc((mon.moveSpeed * WANDER_PCT) / 100);
  const step = fpStepToward(mpos.x, mpos.y, tx, ty, speed);
  const moved = shove(collision, mpos.x, mpos.y, giveWay(herd, m, mpos.x, mpos.y, r, step.dx, step.dy), r);
  const out = shove(collision, moved.x, moved.y, packPush(pack, m, mpos.x, mpos.y, r, Math.trunc(speed / 2)), r);
  if (out.x !== mpos.x || out.y !== mpos.y) {
    world.set<Position>(m, "position", { x: fpClamp(out.x, WORLD_MIN, WORLD_MAX), y: fpClamp(out.y, WORLD_MIN, WORLD_MAX) });
  }
  const gained = isqrt(fpDist2(mpos.x, mpos.y, tx, ty)) - isqrt(fpDist2(out.x, out.y, tx, ty));
  if ((moved.x === tx && moved.y === ty) || gained * 4 < speed) {
    const { strollX: _x, strollY: _y, ...rest } = mon;
    world.set<MonsterC>(m, "monster", { ...rest, strollAtTick: pause() });
  } else if (tx !== mon.strollX || ty !== mon.strollY) {
    world.set<MonsterC>(m, "monster", { ...mon, strollX: tx, strollY: ty });
  }
}

export function registerMonsterAI(sim: Simulation, collisionRef?: CollisionRef): void {
  sim.register("monsterAI", (world, tick) => {
    const collision = collisionRef?.active ?? undefined;
    // Mirror the boss's tier-scaling idiom: read the session once per system run
    // so a world without a session (golden replays) serializes byte-identically.
    const sessionE = world.query("session")[0];
    const session = sessionE === undefined ? undefined : world.get<SessionC>(sessionE, "session");
    const { dmgMilli } = session ? mapDangerScale(session) : { dmgMilli: 1000 };
    // A corpse is not a target. Without this the pack stands over the body
    // swinging while the death screen is up, and the screen is a decision, not a
    // fight. A player with no health component counts as alive, so every legacy
    // world reads exactly as it did.
    const players = world
      .query("player", "faction", "position")
      .filter((e) => (world.get<Faction>(e, "faction")?.team ?? -1) === 0)
      .filter((e) => (world.get<Health>(e, "health")?.life ?? 1) > 0);

    // Snapshotted before anything moves, so a body's shove does not depend on how
    // far through the loop its neighbour happens to be. Bosses are in here as
    // pushers (trash gets shouldered off them) but never move: boss-ai owns them.
    // So are the living players: his walk ignores their bodies, so without this a
    // pack he stepped into stood inside him. Contact (radius + 0.5) stays inside
    // every melee attackRange, so a shouldered monster still reaches.
    const pack: PackBody[] = world.query("monster", "position").map((e) => {
      const p = world.get<Position>(e, "position")!;
      return { e, x: p.x, y: p.y, r: world.get<MonsterC>(e, "monster")!.bodyRadius };
    });
    // The crowd a chase step may not walk into: monsters only. His own body is
    // the target, and the push already shoulders a monster off it.
    const herd = pack.slice();
    for (const e of players) {
      const p = world.get<Position>(e, "position")!;
      pack.push({ e, x: p.x, y: p.y, r: world.get<PlayerC>(e, "player")!.bodyRadius });
    }

    for (const m of world.query("monster", "position")) {
      // Boss entities have their own system (boss-ai.ts); skip them here.
      if (world.has(m, "boss")) continue;

      const mpos = world.get<Position>(m, "position")!;
      const mon = world.get<MonsterC>(m, "monster")!;

      if (players.length === 0) {
        // Its home and target date from before it woke; the next player sets both afresh.
        const { homeX: _hx, homeY: _hy, strollX: _x, strollY: _y, ...rest } = mon;
        world.set<MonsterC>(m, "monster", { ...rest, state: "idle" });
        continue;
      }

      // Nearest player — ascending iteration, strict < keeps lowest-id on ties.
      let nearest = players[0]!;
      let nearestD2 = fpDist2(
        mpos.x, mpos.y,
        world.get<Position>(nearest, "position")!.x,
        world.get<Position>(nearest, "position")!.y,
      );
      for (let i = 1; i < players.length; i++) {
        const p = players[i]!;
        const pp = world.get<Position>(p, "position")!;
        const d2 = fpDist2(mpos.x, mpos.y, pp.x, pp.y);
        if (d2 < nearestD2) { nearest = p; nearestD2 = d2; }
      }

      const ppos = world.get<Position>(nearest, "position")!;

      // Asleep and still out of earshot, or in earshot with a wall in the way:
      // it strolls if a player is near enough to see it, and is otherwise left
      // unwritten. The sight test runs only for a sleeper already inside the
      // radius, which is what keeps a ray off every idle monster.
      //
      // Sight gates the WAKE alone. A monster already chasing keeps coming when
      // it loses sight, or every wall in the map would be a place to shake a
      // pack off by stepping behind it. Being shot still wakes it regardless
      // (damage-resolve.ts), because an arrow out of the dark is a fine reason.
      if (mon.state === "idle"
        && (nearestD2 > AGGRO_RADIUS * AGGRO_RADIUS
          || !hasLineOfSight(collision, mpos.x, mpos.y, ppos.x, ppos.y))) {
        if (nearestD2 <= WANDER_NEAR * WANDER_NEAR) stroll(world, collision, herd, pack, m, mpos, mon, tick);
        continue;
      }
      if (mon.state === "idle") alertPack(world, m);

      // Rooted mid-wind-up: hold. Sits above the slam and the melee checks so a
      // heavy cannot re-aim what it has already committed to — the dodge is only
      // real if the ring stays where it was drawn.
      if (tick < mon.rootedUntilTick) {
        world.set<MonsterC>(m, "monster", { ...mon, state: "attack" });
        continue;
      }

      // Mid-dash: run the locked line until the point, a wall, or the tick the
      // telegraph lands, whichever is first. No push: a charge is not shouldered.
      if (mon.dashUntilTick !== undefined && tick < mon.dashUntilTick) {
        const speed = Math.trunc(MONSTERS.get(mon.defId)!.charge!.speedFixed / 30);
        const step = fpStepToward(mpos.x, mpos.y, mon.dashX!, mon.dashY!, speed);
        const out = shove(collision, mpos.x, mpos.y, step, mon.bodyRadius);
        const arrived = out.x === mon.dashX && out.y === mon.dashY;
        const blocked = out.x === mpos.x && out.y === mpos.y;
        world.set<Position>(m, "position", {
          x: fpClamp(out.x, WORLD_MIN, WORLD_MAX),
          y: fpClamp(out.y, WORLD_MIN, WORLD_MAX),
        });
        world.set<MonsterC>(m, "monster", {
          ...mon, state: "chase", ...(arrived || blocked ? { dashUntilTick: tick } : {}),
        });
        continue;
      }

      const def = MONSTERS.get(mon.defId);
      const charge = def?.charge;
      // The line is tested at the body's own width, so the dash it commits to is
      // one it can run; the telegraph waits out the wind-up plus the run.
      if (charge && tick >= (mon.chargeReadyTick ?? 0)
        && nearestD2 >= charge.minRangeFixed * charge.minRangeFixed
        && nearestD2 <= charge.maxRangeFixed * charge.maxRangeFixed
        && hasLineOfSight(collision, mpos.x, mpos.y, ppos.x, ppos.y, mon.bodyRadius)) {
        const speed = Math.trunc(charge.speedFixed / 30);
        const until = tick + charge.windupTicks + Math.ceil(isqrt(nearestD2) / speed);
        const tele = world.create();
        world.set<Position>(tele, "position", { x: ppos.x, y: ppos.y });
        world.set<TelegraphC>(tele, "telegraph", {
          ownerId: m,
          team: world.get<Faction>(m, "faction")!.team,
          radius: charge.radiusFixed,
          startTick: tick,
          impactTick: until,
          damage: fpMul(charge.damageFixed, dmgMilli),
          damageType: mon.attackType,
          leavesGroundTicks: 0,
        });
        world.set<MonsterC>(m, "monster", {
          ...mon,
          state: "attack",
          rootedUntilTick: tick + charge.windupTicks,
          chargeReadyTick: tick + charge.cooldownTicks,
          dashX: ppos.x,
          dashY: ppos.y,
          dashUntilTick: until,
          lastAttackTick: tick,
        });
        continue;
      }

      const heavy = def?.heavy;
      // Gate on slamReadyTick, not attackReadyTick, so the auto-attack timer
      // survives a slam and the heavy keeps swinging in the cooldown gap.
      if (heavy && tick >= mon.slamReadyTick && nearestD2 <= heavy.rangeFixed * heavy.rangeFixed) {
        const faction = world.get<Faction>(m, "faction")!;
        const tele = world.create();
        world.set<Position>(tele, "position", { x: ppos.x, y: ppos.y });
        world.set<TelegraphC>(tele, "telegraph", {
          ownerId: m,
          team: faction.team,
          radius: heavy.radiusFixed,
          startTick: tick,
          impactTick: tick + heavy.windupTicks,
          // Trash leaves no burning patch. That stays the boss's, and it is the
          // difference between a fight you walk out of and one you must leave.
          // Scale by dmgMilli so a high-tier slam hits harder, same as the boss.
          damage: fpMul(heavy.damageFixed, dmgMilli),
          damageType: mon.attackType,
          leavesGroundTicks: 0,
        });
        world.set<MonsterC>(m, "monster", {
          ...mon,
          state: "attack",
          rootedUntilTick: tick + heavy.windupTicks,
          // Only slamReadyTick advances; attackReadyTick is deliberately left
          // alone so melee auto-attacks fire freely during the slam cooldown.
          slamReadyTick: tick + heavy.cooldownTicks,
          lastAttackTick: tick,
        });
        continue;
      }

      const ar = mon.attackRange;
      // Half a step: enough to unstack a pack over a few ticks, never enough to
      // shove a monster backwards faster than it walks in. Read off the snapshot
      // at the body's own pre-step position, not where its step landed — two
      // bodies on one point take the same step, so measuring after it hides the
      // stack the tiebreak exists to break.
      const push = packPush(
        pack, m, mpos.x, mpos.y, mon.bodyRadius, Math.trunc(mon.moveSpeed / 2),
      );

      // A shooter stands only where its bolt reaches: the bolt dies on the first
      // wall its own radius touches, so one in range behind rock keeps walking.
      const ranged = def?.ranged;
      // A shooter too close for comfort steps straight back; pinned flat against
      // a wall the step comes back zero and it stands and shoots instead.
      const kite = Math.trunc((ar * KITE_PCT) / 100);
      let away: { dx: Fixed; dy: Fixed } | undefined;
      if (ranged && nearestD2 < kite * kite) {
        const toward = fpStepToward(mpos.x, mpos.y, ppos.x, ppos.y, mon.moveSpeed);
        const back = shove(collision, mpos.x, mpos.y, { dx: -toward.dx, dy: -toward.dy }, mon.bodyRadius);
        if (back.x !== mpos.x || back.y !== mpos.y) away = { dx: back.x - mpos.x, dy: back.y - mpos.y };
      }
      if (nearestD2 <= ar * ar
        && (!ranged || hasLineOfSight(collision, mpos.x, mpos.y, ppos.x, ppos.y, ranged.radiusFixed))) {
        let { attackReadyTick } = mon;
        if (tick >= attackReadyTick) {
          if (def?.ranged) {
            const speedPerTick = Math.trunc(def.ranged.speedFixed / 30);
            const step = fpStepToward(mpos.x, mpos.y, ppos.x, ppos.y, speedPerTick);
            // Standing exactly on the player: nothing to aim at, so fall through
            // to next tick rather than emitting a bolt with no direction.
            if (step.dx !== 0 || step.dy !== 0) {
              const faction = world.get<Faction>(m, "faction")!;
              const bolt = world.create();
              world.set<Position>(bolt, "position", { x: mpos.x, y: mpos.y });
              world.set<ProjectileC>(bolt, "projectile", {
                dirx: step.dx,
                diry: step.dy,
                remainingRange: mon.attackRange,
                radius: def.ranged.radiusFixed,
                damageType: mon.attackType,
                damageAmount: mon.attackDamage,
                ownerId: m,
                team: faction.team,
              });
              attackReadyTick = tick + mon.attackCooldownTicks;
            }
          } else {
            sim.enqueueDamage({
              target: nearest,
              source: m,
              amountFixed: mon.attackDamage,
              type: mon.attackType,
              via: "melee",
            });
            attackReadyTick = tick + mon.attackCooldownTicks;
          }
        }
        world.set<MonsterC>(m, "monster", {
          ...mon, state: "attack", attackReadyTick,
          // A swing happened exactly when the cooldown advanced this tick.
          ...(attackReadyTick !== mon.attackReadyTick ? { lastAttackTick: tick } : {}),
        });
        let from = mpos;
        if (away) {
          from = { x: mpos.x + away.dx, y: mpos.y + away.dy };
        } else if (ranged && tick < attackReadyTick) {
          // Strafe square to the player between shots; slide keeps it off walls.
          const side = (Math.trunc(tick / STRAFE_FLIP_TICKS) + m) % 2 === 0 ? 1 : -1;
          const t = fpStepToward(mpos.x, mpos.y, ppos.x, ppos.y,
            Math.trunc((mon.moveSpeed * STRAFE_PCT) / 100));
          from = shove(collision, mpos.x, mpos.y, { dx: -t.dy * side, dy: t.dx * side }, mon.bodyRadius);
        }
        const out = shove(collision, from.x, from.y, push, mon.bodyRadius);
        if (out.x !== mpos.x || out.y !== mpos.y) {
          world.set<Position>(m, "position", {
            x: fpClamp(out.x, WORLD_MIN, WORLD_MAX),
            y: fpClamp(out.y, WORLD_MIN, WORLD_MAX),
          });
        }
      } else if (away) {
        const out = shove(collision, mpos.x + away.dx, mpos.y + away.dy, push, mon.bodyRadius);
        world.set<Position>(m, "position", {
          x: fpClamp(out.x, WORLD_MIN, WORLD_MAX),
          y: fpClamp(out.y, WORLD_MIN, WORLD_MAX),
        });
        world.set<MonsterC>(m, "monster", { ...mon, state: "chase" });
      } else {
        let moved = chaseStep(
          collision, mpos.x, mpos.y, ppos.x, ppos.y, mon.moveSpeed, mon.bodyRadius,
        );
        // A body in the way of the step at HIM is what sends a chaser at a free spot
        // on his ring instead; judged off that step alone, so the choice cannot flip-flop.
        let step = { dx: moved.x - mpos.x, dy: moved.y - mpos.y };
        let eased = giveWay(herd, m, mpos.x, mpos.y, mon.bodyRadius, step.dx, step.dy);
        if (eased.dx !== step.dx || eased.dy !== step.dy) {
          const touch = mon.bodyRadius + world.get<PlayerC>(nearest, "player")!.bodyRadius;
          const spot = freeSpot(collision, herd, m, mpos.x, mpos.y, mon.bodyRadius, ppos.x, ppos.y,
            touch + Math.trunc((Math.max(ar, touch) - touch) / 2), m % 2 === 0 ? 1 : -1);
          if (spot) {
            moved = chaseStep(collision, mpos.x, mpos.y, spot.x, spot.y, mon.moveSpeed, mon.bodyRadius);
            step = { dx: moved.x - mpos.x, dy: moved.y - mpos.y };
            eased = giveWay(herd, m, mpos.x, mpos.y, mon.bodyRadius, step.dx, step.dy);
          }
          if (eased.dx !== step.dx || eased.dy !== step.dy) {
            moved = shove(collision, mpos.x, mpos.y, eased, mon.bodyRadius);
          }
        }
        const out = shove(collision, moved.x, moved.y, push, mon.bodyRadius);
        world.set<Position>(m, "position", {
          x: fpClamp(out.x, WORLD_MIN, WORLD_MAX),
          y: fpClamp(out.y, WORLD_MIN, WORLD_MAX),
        });
        world.set<MonsterC>(m, "monster", { ...mon, state: "chase" });
      }
    }
  });
}
