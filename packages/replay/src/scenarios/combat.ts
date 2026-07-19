import { createCombatSim, buildSnapshot, checksumWorld } from "@pact/simulation";
import { CONTENT_VERSION } from "@pact/content-runtime";
import type { Command } from "@pact/simulation";
import type { Snapshot } from "@pact/protocol";

export function runCombat(
  seed: number,
  commandsByTick: Command[][],
  ticks: number,
): { checksums: number[]; finalSnapshot: Snapshot } {
  const { sim, world } = createCombatSim(seed);
  const checksums: number[] = [];

  for (let t = 0; t < ticks; t++) {
    sim.step(commandsByTick[t] ?? []);
    checksums.push(checksumWorld(world));
  }

  const finalSnapshot = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
  return { checksums, finalSnapshot };
}
