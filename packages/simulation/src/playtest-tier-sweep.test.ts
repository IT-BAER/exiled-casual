import { describe, expect, it } from "vitest";
import { forcedTierRuns } from "./playtest-tier-sweep";
import { newCharacter } from "./playtest";
import { snapshot } from "./persist";

describe("forced-tier sweep (bot)", () => {
  it("runs the map at the forced stone's tier, past the graph's depth", () => {
    const state = snapshot(newCharacter("class.ironsworn", 7, 20).world)!;
    const [run] = forcedTierRuns(state, 700, 14, 1);
    expect(run?.tier).toBe(14);
  }, 120_000);
});
