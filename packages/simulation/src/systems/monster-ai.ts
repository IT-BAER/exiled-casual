import { fp, fpDist2, fpStepToward, fpClamp } from "@exiled/fixed-point";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { slide, type CollisionRef } from "../collision";
import { Simulation } from "../loop";
import type { Position, MonsterC, Faction, ProjectileC } from "../components";
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

export function registerMonsterAI(sim: Simulation, collisionRef?: CollisionRef): void {
  sim.register("monsterAI", (world, tick) => {
    const collision = collisionRef?.active ?? undefined;
    const players = world
      .query("player", "faction", "position")
      .filter((e) => (world.get<Faction>(e, "faction")?.team ?? -1) === 0);

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
      const ar = mon.attackRange;

      if (nearestD2 <= ar * ar) {
        let { attackReadyTick } = mon;
        if (tick >= attackReadyTick) {
          const def = MONSTERS.get(mon.defId);
          if (def?.ranged) {
            // A shooter's range is its attack range, so chase already stops it
            // where it should stand: no kiting AI, and none needed.
            // ponytail: no line of sight — a bolt crosses walls, as every
            // projectile in this game already does. Range 7.5 under an aggro
            // radius of 9 keeps it close to honest; real LOS is its own pass
            // over collision.ts, for the player's projectiles as much as these.
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
      } else {
        const { dx, dy } = fpStepToward(mpos.x, mpos.y, ppos.x, ppos.y, mon.moveSpeed);
        const moved = collision
          ? slide(collision, mpos.x, mpos.y, dx, dy, mon.bodyRadius)
          : { x: mpos.x + dx, y: mpos.y + dy };
        world.set<Position>(m, "position", {
          x: fpClamp(moved.x, WORLD_MIN, WORLD_MAX),
          y: fpClamp(moved.y, WORLD_MIN, WORLD_MAX),
        });
        world.set<MonsterC>(m, "monster", { ...mon, state: "chase" });
      }
    }
  });
}
