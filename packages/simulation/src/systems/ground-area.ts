import { fpDist2 } from "@exiled/fixed-point";
import { refreshBurning, AILMENT_TICK_INTERVAL } from "@exiled/rules";
import { Simulation } from "../loop";
import { bodyRadiusOf } from "../body";
import type { Position, Faction, GroundAreaC, AilmentC, GearModsC } from "../components";
import { applyStatus } from "../status";

/** What a slowing patch leaves on whoever stands in it, refreshed every ailment tick. */
export const GROUND_SLOW_STATUS = "chilled";

export function registerGroundAreaTick(sim: Simulation): void {
  sim.register("groundAreaTick", (world, tick) => {
    for (const ae of world.query("groundArea", "position")) {
      const ga = world.get<GroundAreaC>(ae, "groundArea")!;
      const due = tick >= ga.nextTick;
      const pulse = ga.pulse !== undefined && tick >= ga.pulse.nextPulse ? ga.pulse : undefined;
      if (!due && !pulse) continue;

      const aPos = world.get<Position>(ae, "position")!;

      for (const m of world.query("position", "health", "faction")) {
        const mFaction = world.get<Faction>(m, "faction")!;
        if (mFaction.team === ga.team) continue;

        const mPos = world.get<Position>(m, "position")!;
        const mRadius = bodyRadiusOf(world, m);
        const threshold = ga.radius + mRadius;
        if (fpDist2(aPos.x, aPos.y, mPos.x, mPos.y) > threshold * threshold) continue;

        // PoE1's "Unaffected by Burning Ground" (Cinderveil): the patch's burning skips him.
        const unaffected = ga.ailmentKind === "burning"
          && (world.get<GearModsC>(m, "gearMods")?.unaffectedByBurningGround ?? 0) > 0;
        if (due && ga.ailmentKind !== undefined && !unaffected) {
          const prev = world.get<AilmentC>(m, "ailment");
          const prevState = prev
            ? { kind: "burning" as const, stacks: prev.stacks, dpsFixed: prev.dps, expiryTick: prev.expiryTick }
            : undefined;
          const next = refreshBurning(
            prevState, ga.stacksPerApply ?? 0, ga.dps ?? 0, tick, ga.ailmentDuration ?? 0, ga.maxStacks ?? 0,
          );
          world.set<AilmentC>(m, "ailment", {
            kind: next.kind,
            stacks: next.stacks,
            dps: next.dpsFixed,
            expiryTick: next.expiryTick,
            ...(ga.skillId ? { skillId: ga.skillId } : {}),
          });
        }
        if (due && ga.slowPct) {
          applyStatus(world, m, {
            statusId: GROUND_SLOW_STATUS, durationTicks: AILMENT_TICK_INTERVAL + 1, slowPct: ga.slowPct,
          }, tick);
        }
        // A pulse is a hit, so the patch itself is its source: armour reads it as one.
        for (const p of pulse?.parts ?? []) {
          sim.enqueueDamage({ target: m, source: ae, amountFixed: p.amount, type: p.type });
        }
      }

      world.set<GroundAreaC>(ae, "groundArea", {
        ...ga,
        ...(due ? { nextTick: ga.nextTick + AILMENT_TICK_INTERVAL } : {}),
        ...(pulse ? { pulse: { ...pulse, nextPulse: pulse.nextPulse + pulse.every } } : {}),
      });
    }
  });
}
