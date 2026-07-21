import { fp, fpDist2, fpStepToward } from "@pact/fixed-point";
import type { MonsterDef } from "@pact/content-schema";
import { Simulation } from "../loop";
import { clampToArena } from "../movement";
import { spawnMonster } from "../areas";
import type { Position, MonsterC, Faction, BossC, TelegraphC, Health } from "../components";

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
): void {
  sim.register("bossAI", (world, tick) => {
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
            const spot = clampToArena(bpos.x + slot.dx, bpos.y + slot.dy, addDef.radiusFixed);
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
          damage: slam.damageFixed,
          damageType: 1,
          leavesGroundTicks: boss.phase === 2 ? phase2.fireGroundDurationTicks : 0,
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

      // 3. Chase / melee — mirrors monster-ai.ts exactly, with arena clamp.
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
        const clamped = clampToArena(bpos.x + dx, bpos.y + dy, mon.bodyRadius);
        world.set<Position>(e, "position", clamped);
        world.set<MonsterC>(e, "monster", { ...mon, state: "chase" });
      }
    }
  });
}
