import { fp, fpDist2, fpMul, fpStepToward } from "@exiled/fixed-point";
import type { MonsterDef } from "@exiled/content-schema";
import { monsterTierScale } from "@exiled/rules";
import { Simulation } from "../loop";
import { slide, type CollisionRef } from "../collision";
import { spawnMonster } from "../areas";
import type { Position, MonsterC, Faction, BossC, TelegraphC, Health, SessionC } from "../components";

// Where phase-2 adds appear, as offsets from the boss. Hand-written literals in
// the codebase's ring idiom (cf. PORTAL_RING / PACK_RING) — no runtime trig, so
// the summon is deterministic. addCount imps take the first slots.
const SUMMON_RING: readonly { dx: number; dy: number }[] = [
  { dx: fp(2.5),  dy: fp(0) },
  { dx: fp(-2.5), dy: fp(0) },
  { dx: fp(0),    dy: fp(2.5) },
  { dx: fp(0),    dy: fp(-2.5) },
  { dx: fp(1.8),  dy: fp(1.8) },
  { dx: fp(-1.8), dy: fp(-1.8) },
];

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
    const areaTier = sessionE === undefined
      ? 0
      : world.get<SessionC>(sessionE, "session")?.areaTier ?? 0;
    const { dmgMilli } = monsterTierScale(areaTier);
    for (const e of world.query("boss", "monster", "position", "faction")) {
      const mon = world.get<MonsterC>(e, "monster")!;
      const def = monsters.get(mon.defId);
      if (!def?.boss) continue;

      const players = world.query("player", "position");
      const playerEntity = players[0];
      if (playerEntity === undefined) continue;

      const boss = world.get<BossC>(e, "boss")!;
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
            const imp = spawnMonster(world, addDef, spot.x, spot.y, false);
            world.set<MonsterC>(imp, "monster", { ...world.get<MonsterC>(imp, "monster")!, summoned: 1 });
          }
        }
        world.set<BossC>(e, "boss", { ...boss, phase: 2 });
        continue;
      }

      // 1. Rooted during slam wind-up — do not move or melee.
      if (tick < boss.rootedUntilTick) {
        world.set<MonsterC>(e, "monster", { ...mon, state: "attack" });
        continue;
      }

      // 2. Slam: fire when off cooldown and player is within slam range.
      const dist2 = fpDist2(bpos.x, bpos.y, ppos.x, ppos.y);
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
          leavesGroundTicks: boss.phase === 2 ? phase2.fireGroundDurationTicks : 0,
          ground:
            boss.phase === 2
              ? {
                  ailmentKind: phase2.fireGround.kind,
                  stacksPerApply: phase2.fireGround.stacksPerApply,
                  dps: fpMul(phase2.fireGround.dpsFixed, dmgMilli),
                  ailmentDuration: phase2.fireGround.durationTicks,
                  maxStacks: phase2.fireGround.maxStacks,
                }
              : undefined,
        });
        const cooldown =
          boss.phase === 2
            ? Math.trunc((slam.cooldownTicks * phase2.cadenceMulPct) / 100)
            : slam.cooldownTicks;
        world.set<BossC>(e, "boss", {
          ...boss,
          rootedUntilTick: tick + slam.windupTicks,
          nextAbilityTick: tick + cooldown,
        });
        world.set<MonsterC>(e, "monster", { ...mon, state: "attack" });
        continue;
      }

      // 3. Chase / melee — mirrors monster-ai.ts exactly, sliding on collision.
      const ar = mon.attackRange;
      if (dist2 <= ar * ar) {
        let { attackReadyTick } = mon;
        if (tick >= attackReadyTick) {
          sim.enqueueDamage({
            target: playerEntity,
            source: e,
            amountFixed: mon.attackDamage,
            type: mon.attackType,
          });
          attackReadyTick = tick + mon.attackCooldownTicks;
        }
        world.set<MonsterC>(e, "monster", { ...mon, state: "attack", attackReadyTick });
      } else {
        const { dx, dy } = fpStepToward(bpos.x, bpos.y, ppos.x, ppos.y, mon.moveSpeed);
        const moved = collision
          ? slide(collision, bpos.x, bpos.y, dx, dy, mon.bodyRadius)
          : { x: bpos.x + dx, y: bpos.y + dy };
        world.set<Position>(e, "position", moved);
        world.set<MonsterC>(e, "monster", { ...mon, state: "chase" });
      }
    }
  });
}
