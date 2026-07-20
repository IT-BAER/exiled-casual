import { fpDist2, fpStepToward } from "@pact/fixed-point";
import type { MonsterDef } from "@pact/content-schema";
import { Simulation } from "../loop";
import { clampToArena } from "../movement";
import type { Position, MonsterC, Faction, BossC, TelegraphC } from "../components";

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
      const { slam } = def.boss;

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
          leavesGroundTicks: 0,
        });
        world.set<BossC>(e, "boss", {
          ...boss,
          rootedUntilTick: tick + slam.windupTicks,
          nextAbilityTick: tick + slam.cooldownTicks,
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
