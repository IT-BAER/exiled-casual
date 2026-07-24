import { Simulation, checksumWorld, type Command, type World } from "@exiled/simulation";

export interface Scenario {
  seed: number;
  contentVersion: string;
  ticks: number;
  commandsByTick: Command[][];
  build: (sim: Simulation, seed: number) => void;
}

export interface ReplayResult {
  checksums: number[];
  final: number;
  systemOrder: string[];
  world: World;
}

export function runScenario(scenario: Scenario): ReplayResult {
  const sim = new Simulation();
  scenario.build(sim, scenario.seed);
  const checksums: number[] = [];
  for (let t = 0; t < scenario.ticks; t++) {
    sim.step(scenario.commandsByTick[t] ?? []);
    checksums.push(checksumWorld(sim.world));
  }
  return {
    checksums,
    final: checksums.length > 0 ? checksums[checksums.length - 1]! : 0,
    systemOrder: sim.systemOrder(),
    world: sim.world,
  };
}

export function firstDifference(
  a: readonly number[],
  b: readonly number[],
): number | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return null;
}
