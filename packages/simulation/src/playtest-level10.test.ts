import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "@exiled/rules";
import { campaign, summarize, type Summary } from "./playtest";

/** Level 10 holds every class's level-8 area skill, which a level-1 map never sees. */
describe("three maps at level 10 (bot)", () => {
  // Thirty, not ten: on ten, moving a few braziers swung the parity ratio 1.20 -> 1.31
  // while thirty seeds of the same code read 1.14.
  const PARITY_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
  const runs = Object.fromEntries(CLASS_IDS.map((c) => [c, PARITY_SEEDS.flatMap((s) => campaign(c, 400 + s, 3, {}, 10))]));
  const sum = Object.fromEntries(CLASS_IDS.map((c) => [c, summarize(runs[c]!)])) as Record<string, Summary>;

  it.each(CLASS_IDS)("%s clears every map and rarely dies", (c) => {
    expect(sum[c]!.clearRate).toBe(1);
    expect(sum[c]!.deathsPerMap).toBeLessThan(0.5);
  });

  // Each campaign opens nodes off its own stone drops, so the classes are timed
  // on the nodes all of them played, each node weighted once.
  it("the classes clear within 25% of each other", () => {
    const nodes = [...new Set(runs[CLASS_IDS[0]!]!.map((r) => r.node))]
      .filter((n) => CLASS_IDS.every((c) => runs[c]!.some((r) => r.node === n && r.cleared)));
    const t = CLASS_IDS.map((c) => nodes.reduce((a, n) =>
      a + summarize(runs[c]!.filter((r) => r.node === n)).meanClearSec, 0) / nodes.length);
    expect(Math.max(...t) / Math.min(...t)).toBeLessThan(1.25);
  });
});
