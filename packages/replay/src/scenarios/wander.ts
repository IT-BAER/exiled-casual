import { registerMovement, type Command, type Simulation } from "@exiled/simulation";
import { fp } from "@exiled/fixed-point";
import type { Scenario } from "../index";

// Five entities wandering under a shared deterministic seed, with optional
// per-tick impulse commands.
export function makeWanderScenario(
  seed: number,
  ticks: number,
  commandsByTick: Command[][] = [],
): Scenario {
  return {
    seed,
    contentVersion: "kernel.wander.v1",
    ticks,
    commandsByTick,
    build: (sim: Simulation, s: number) => {
      for (let i = 0; i < 5; i++) {
        const e = sim.world.create();
        sim.world.set(e, "position", { x: fp(i), y: fp(-i) });
        sim.world.set(e, "motion", { vx: 0, vy: 0, streamName: `wander.${i}` });
      }
      registerMovement(sim, s);
    },
  };
}
