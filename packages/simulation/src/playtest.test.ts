import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "@exiled/rules";
import { newCharacter, playNextMap, summarize, type MapRun, type Summary } from "./playtest";

/**
 * The owner's targets for a fresh character on its first tier-1 map, played by
 * the bot in `playtest.ts` (a competent casual: 200 ms reactions, kites, dodges,
 * drinks, loots). The bands are design intent, the same contract balance.test.ts
 * keeps for the lab: wide enough to survive a retune, narrow enough to catch a
 * drift. The level-10 sweep is playtest-level10.test.ts; `PLAYTEST=full` runs
 * the wide sweep in playtest-report-<class>.test.ts.
 */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const firstMap = (classId: string, seed: number): MapRun => playNextMap(newCharacter(classId, seed))!;

describe("first tier-1 map, fresh character (bot)", () => {
  const runs = Object.fromEntries(CLASS_IDS.map((c) => [c, SEEDS.map((s) => firstMap(c, s))]));
  const sum = Object.fromEntries(CLASS_IDS.map((c) => [c, summarize(runs[c]!)])) as Record<string, Summary>;

  it.each(CLASS_IDS)("%s clears every map and rarely dies", (c) => {
    expect(sum[c]!.clearRate).toBe(1);
    expect(sum[c]!.deathsPerMap).toBeLessThan(0.5);
  });

  it("the classes clear within 20% of each other", () => {
    const t = CLASS_IDS.map((c) => sum[c]!.meanClearSec);
    expect(Math.max(...t) / Math.min(...t)).toBeLessThan(1.2);
  });

  it.each(CLASS_IDS)("%s: a map is 3-6 minutes, a kill every 4 s in a fight", (c) => {
    expect(sum[c]!.meanClearSec).toBeGreaterThan(180);
    expect(sum[c]!.meanClearSec).toBeLessThan(360);
    expect(sum[c]!.killsPerCombatSec).toBeGreaterThanOrEqual(0.25);
  });

  it.each(CLASS_IDS)("%s: magic-or-better every ~60 s, a rare every map, a level in map one", (c) => {
    expect(sum[c]!.magicPlusGapSec).toBeLessThan(75);
    expect(sum[c]!.raresPerMap).toBeGreaterThanOrEqual(1);
    for (const r of runs[c]!) expect(r.levelEnd).toBeGreaterThan(r.levelStart);
  });

  it.each(CLASS_IDS)("%s: a run reports its boss fight, its gold and the affixes it dropped", (c) => {
    for (const r of runs[c]!) {
      expect(r.bossId).toMatch(/^monster\./);
      expect(r.bossSeconds).toBeGreaterThan(0);
      expect(r.bossSeconds!).toBeLessThan(r.seconds);
      expect(r.gold).toBeGreaterThan(0);
      const rolled = Object.values(r.affixes).reduce((a, n) => a + n, 0);
      expect(rolled).toBeGreaterThanOrEqual(r.drops.magic + r.drops.rare);
    }
  });
});
