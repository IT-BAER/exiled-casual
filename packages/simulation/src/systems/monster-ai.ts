import { fp, fpDist2, fpMul, fpStepToward, fpClamp, isqrt, type Fixed } from "@exiled/fixed-point";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { chaseStep, slide, type Collision, type CollisionRef } from "../collision";
import { Simulation } from "../loop";
import type { Position, MonsterC, Faction, Health, ProjectileC, TelegraphC, SessionC } from "../components";
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
 * its own wider radius in boss-ai.ts (BOSS_AGGRO_RADIUS) but no leash either —
 * BossC.spawnX/spawnY is recorded and never read back.
 */
export const AGGRO_RADIUS: number = fp(9);

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
    const pack: PackBody[] = world.query("monster", "position").map((e) => {
      const p = world.get<Position>(e, "position")!;
      return { e, x: p.x, y: p.y, r: world.get<MonsterC>(e, "monster")!.bodyRadius };
    });

    for (const m of world.query("monster", "position")) {
      // Boss entities have their own system (boss-ai.ts); skip them here.
      if (world.has(m, "boss")) continue;

      const mpos = world.get<Position>(m, "position")!;
      const mon = world.get<MonsterC>(m, "monster")!;

      if (players.length === 0) {
        world.set<MonsterC>(m, "monster", { ...mon, state: "idle" });
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

      // Asleep and still out of earshot: nothing to do, and nothing written, so
      // an untouched room costs the checksum nothing either.
      if (mon.state === "idle" && nearestD2 > AGGRO_RADIUS * AGGRO_RADIUS) continue;

      const ppos = world.get<Position>(nearest, "position")!;

      // Rooted mid-wind-up: hold. Sits above the slam and the melee checks so a
      // heavy cannot re-aim what it has already committed to — the dodge is only
      // real if the ring stays where it was drawn.
      if (tick < mon.rootedUntilTick) {
        world.set<MonsterC>(m, "monster", { ...mon, state: "attack" });
        continue;
      }

      const heavy = MONSTERS.get(mon.defId)?.heavy;
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

      if (nearestD2 <= ar * ar) {
        let { attackReadyTick } = mon;
        if (tick >= attackReadyTick) {
          const def = MONSTERS.get(mon.defId);
          if (def?.ranged) {
            // A shooter's range is its attack range, so chase already stops it
            // where it should stand: no kiting AI, and none needed.
            // ponytail: it fires with no line-of-sight check, but the bolt now
            // dies on the wall (projectile.ts), so a shooter behind rock wastes
            // its shot instead of hitting through it. Not checking here costs one
            // wasted cooldown; checking would need the ray at aim time too.
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
            });
            attackReadyTick = tick + mon.attackCooldownTicks;
          }
        }
        world.set<MonsterC>(m, "monster", { ...mon, state: "attack", attackReadyTick });
        const out = shove(collision, mpos.x, mpos.y, push, mon.bodyRadius);
        if (out.x !== mpos.x || out.y !== mpos.y) {
          world.set<Position>(m, "position", {
            x: fpClamp(out.x, WORLD_MIN, WORLD_MAX),
            y: fpClamp(out.y, WORLD_MIN, WORLD_MAX),
          });
        }
      } else {
        const moved = chaseStep(
          collision, mpos.x, mpos.y, ppos.x, ppos.y, mon.moveSpeed, mon.bodyRadius,
        );
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
