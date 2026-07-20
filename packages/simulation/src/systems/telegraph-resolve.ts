import { fpDist2 } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { bodyRadiusOf } from "../body";
import type { Position, Faction, TelegraphC } from "../components";

export function registerTelegraphResolve(sim: Simulation): void {
  sim.register("telegraphResolve", (world, tick) => {
    // Snapshot the list before destroying to avoid mutation-during-iteration issues.
    const telegraphs = world.query("telegraph", "position");

    for (const te of telegraphs) {
      const tg = world.get<TelegraphC>(te, "telegraph")!;
      if (tick < tg.impactTick) continue;

      const tgPos = world.get<Position>(te, "position")!;

      for (const e of world.query("position", "health", "faction")) {
        const faction = world.get<Faction>(e, "faction")!;
        if (faction.team === tg.team) continue;

        const ePos = world.get<Position>(e, "position")!;
        const threshold = tg.radius + bodyRadiusOf(world, e);
        if (fpDist2(tgPos.x, tgPos.y, ePos.x, ePos.y) > threshold * threshold) continue;

        sim.enqueueDamage({ target: e, source: tg.ownerId, amountFixed: tg.damage, type: tg.damageType });
      }

      world.destroy(te);
    }
  });
}
