import { fpDist2, fpStepToward, fpClamp } from "@pact/fixed-point";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { slide, type Collision } from "../collision";
import { Simulation } from "../loop";
import type { Position, MonsterC, Faction } from "../components";

export function registerMonsterAI(sim: Simulation, collision?: Collision): void {
  sim.register("monsterAI", (world, tick) => {
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

      const ppos = world.get<Position>(nearest, "position")!;
      const ar = mon.attackRange;

      if (nearestD2 <= ar * ar) {
        let { attackReadyTick } = mon;
        if (tick >= attackReadyTick) {
          sim.enqueueDamage({
            target: nearest,
            source: m,
            amountFixed: mon.attackDamage,
            type: mon.attackType,
          });
          attackReadyTick = tick + mon.attackCooldownTicks;
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
