import { describe, expect, test } from "vitest";
import { fpAdd } from "@exiled/fixed-point";
import type { Simulation } from "@exiled/simulation";
import { runScenario, firstDifference, type Scenario } from "./index";

// A trivial scenario: one entity whose counter increments by 1 (fixed-point)
// each tick via a system.
function makeScenario(): Scenario {
  return {
    seed: 42,
    contentVersion: "test.v1",
    ticks: 5,
    commandsByTick: [],
    build: (sim: Simulation) => {
      const e = sim.world.create();
      sim.world.set(e, "counter", { n: 0 });
      sim.register("increment", (world) => {
        for (const id of world.query("counter")) {
          const c = world.get<{ n: number }>(id, "counter")!;
          world.set(id, "counter", { n: fpAdd(c.n, 1000) });
        }
      });
    },
  };
}

describe("replay", () => {
  test("same scenario reproduces the same checksum sequence", () => {
    const a = runScenario(makeScenario());
    const b = runScenario(makeScenario());
    expect(a.checksums).toEqual(b.checksums);
    expect(a.checksums.length).toBe(5);
    expect(firstDifference(a.checksums, b.checksums)).toBeNull();
  });

  test("systemOrder is reported", () => {
    const r = runScenario(makeScenario());
    expect(r.systemOrder).toEqual(["increment"]);
  });

  test("firstDifference finds the first divergent index", () => {
    expect(firstDifference([1, 2, 3], [1, 9, 3])).toBe(1);
    expect(firstDifference([1, 2], [1, 2, 3])).toBe(2);
    expect(firstDifference([1, 2, 3], [1, 2, 3])).toBeNull();
  });
});
