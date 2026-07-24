import { fpDist2 } from "@exiled/fixed-point";
import { refreshBurning, AILMENT_TICK_INTERVAL } from "@exiled/rules";
import { Simulation } from "../loop";
import { bodyRadiusOf } from "../body";
import type { Position, Faction, GroundAreaC, AilmentC } from "../components";

export function registerGroundAreaTick(sim: Simulation): void {
  sim.register("groundAreaTick", (world, tick) => {
    for (const ae of world.query("groundArea", "position")) {
      const ga = world.get<GroundAreaC>(ae, "groundArea")!;
      if (tick < ga.nextTick) continue;

      const aPos = world.get<Position>(ae, "position")!;

      for (const m of world.query("position", "health", "faction")) {
        const mFaction = world.get<Faction>(m, "faction")!;
        if (mFaction.team === ga.team) continue;

        const mPos = world.get<Position>(m, "position")!;
        const mRadius = bodyRadiusOf(world, m);
        const threshold = ga.radius + mRadius;
        if (fpDist2(aPos.x, aPos.y, mPos.x, mPos.y) > threshold * threshold) continue;

        const prev = world.get<AilmentC>(m, "ailment");
        const prevState = prev
          ? { kind: "burning" as const, stacks: prev.stacks, dpsFixed: prev.dps, expiryTick: prev.expiryTick }
          : undefined;
        const next = refreshBurning(prevState, ga.stacksPerApply, ga.dps, tick, ga.ailmentDuration, ga.maxStacks);
        world.set<AilmentC>(m, "ailment", {
          kind: next.kind,
          stacks: next.stacks,
          dps: next.dpsFixed,
          expiryTick: next.expiryTick,
        });
      }

      world.set<GroundAreaC>(ae, "groundArea", { ...ga, nextTick: ga.nextTick + AILMENT_TICK_INTERVAL });
    }
  });
}
