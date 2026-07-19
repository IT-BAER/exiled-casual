import { fpDist2 } from "@pact/fixed-point";
import { refreshBurning, AILMENT_TICK_INTERVAL } from "@pact/rules";
import { Simulation } from "../loop";
import type { Position, MonsterC, GroundAreaC, AilmentC } from "../components";

export function registerGroundAreaTick(sim: Simulation): void {
  sim.register("groundAreaTick", (world, tick) => {
    for (const ae of world.query("groundArea", "position")) {
      const ga = world.get<GroundAreaC>(ae, "groundArea")!;
      if (tick < ga.nextTick) continue;

      const aPos = world.get<Position>(ae, "position")!;

      for (const m of world.query("position", "monster")) {
        const mPos = world.get<Position>(m, "position")!;
        const mMon = world.get<MonsterC>(m, "monster")!;
        const threshold = ga.radius + mMon.bodyRadius;
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
