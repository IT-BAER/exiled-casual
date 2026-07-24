import { describe, expect, test } from "vitest";
import { WORLD_MIN, WORLD_MAX, type Command } from "@exiled/simulation";
import { runScenario, firstDifference } from "../index";
import { makeWanderScenario } from "./wander";

describe("wander determinism proof", () => {
  test("3000-tick scenario reproduces an identical checksum sequence", () => {
    const a = runScenario(makeWanderScenario(123, 3000));
    const b = runScenario(makeWanderScenario(123, 3000));
    expect(a.checksums.length).toBe(3000);
    expect(firstDifference(a.checksums, b.checksums)).toBeNull();
    expect(a.final).toBe(b.final);
  });

  test("different seeds diverge", () => {
    const a = runScenario(makeWanderScenario(123, 500));
    const b = runScenario(makeWanderScenario(999, 500));
    expect(a.final).not.toBe(b.final);
  });

  test("fuzzed impulse commands never break determinism or bounds", () => {
    // Command generation uses Math.random (a test input, never in the sim).
    const commandsByTick: Command[][] = [];
    for (let t = 0; t < 1000; t++) {
      const cmds: Command[] = [];
      for (let e = 1; e <= 5; e++) {
        if (Math.random() < 0.3) {
          cmds.push({
            tick: t,
            entity: e,
            type: "impulse",
            data: {
              dvx: Math.floor((Math.random() - 0.5) * 20),
              dvy: Math.floor((Math.random() - 0.5) * 20),
            },
          });
        }
      }
      commandsByTick.push(cmds);
    }

    const a = runScenario(makeWanderScenario(7, 1000, commandsByTick));
    const b = runScenario(makeWanderScenario(7, 1000, commandsByTick));
    // Same seed + same command log => identical checksums.
    expect(firstDifference(a.checksums, b.checksums)).toBeNull();
    expect(a.checksums.length).toBe(1000);

    // Final positions stayed integer and inside the arena for the whole run.
    // (Any non-integer or non-finite value would have thrown inside checksumWorld during the run.)
    for (const id of a.world.query("position")) {
      const p = a.world.get<{ x: number; y: number }>(id, "position")!;
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(WORLD_MIN);
      expect(p.x).toBeLessThanOrEqual(WORLD_MAX);
      expect(p.y).toBeGreaterThanOrEqual(WORLD_MIN);
      expect(p.y).toBeLessThanOrEqual(WORLD_MAX);
    }
  });
});
