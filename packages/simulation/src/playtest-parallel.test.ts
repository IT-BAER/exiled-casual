import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "@exiled/rules";
import { campaign } from "./playtest";
import { campaigns } from "./playtest-parallel";

describe("campaigns across child processes", () => {
  // The children run plain Node's type transform, not Vite's: any difference between
  // the two in the bot or the sim shows up here as a different run.
  it("plays every job exactly as the in-process campaign does, in job order", async () => {
    const jobs = [
      { classId: CLASS_IDS[0]!, seed: 401, maps: 1, level: 10 },
      { classId: CLASS_IDS[2]!, seed: 7, maps: 1 },
    ];
    const forked = await campaigns(jobs, 2);
    expect(forked).toEqual(jobs.map((j) => campaign(j.classId, j.seed, j.maps, {}, j.level)));
  }, 120_000);
});
