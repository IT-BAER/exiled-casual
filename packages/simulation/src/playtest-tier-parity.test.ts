import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLASS_IDS } from "@exiled/rules";
import { summarize, type MapRun } from "./playtest";
import { tierSweep } from "./playtest-parallel";

/**
 * Class parity above the Atlas graph's depth: every class's kit bot, 30 natural maps
 * (level ~28), then 4 maps on each forced stone. About an hour at 3 children, so it
 * runs only on `PLAYTEST=tiers` (`PLAYTEST_PROCS` caps the children) and writes
 * review/playtest-tiers.md. Deaths, not their ratio: at 0.1 a map one death swings a ratio.
 */
const SEEDS = Array.from({ length: 10 }, (_, i) => 501 + i);
const TIERS = [12, 13, 14, 15];
const GATED = [13, 14, 15];
/** Per tier: no class above this many deaths per map ... */
const MAX_DEATHS = 1.2;
/** ... and the most-dying class no more than this above the least. */
const MAX_SPREAD = 0.7;

describe.skipIf(process.env["PLAYTEST"] !== "tiers")("class parity at forced tiers 13-15 (bot)", () => {
  const by: Record<string, Record<number, MapRun[]>> = {};
  beforeAll(async () => {
    const jobs = CLASS_IDS.flatMap((classId) => SEEDS.map((seed) => ({ classId, seed })));
    const procs = Number(process.env["PLAYTEST_PROCS"]) || undefined;
    const played = await tierSweep(jobs, TIERS, 4, 30, { kit: true }, procs);
    for (const c of CLASS_IDS) {
      by[c] = Object.fromEntries(TIERS.map((t) => [t, played.flatMap((p, i) => (jobs[i]!.classId === c ? p[t] ?? [] : []))]));
    }
    const lines = ["# Class parity at forced tiers", "", `Generated ${new Date().toISOString()}. Kit bot, seeds 501-510, 30 natural maps, then 4 maps per stone.`, "",
      `| tier | ${CLASS_IDS.join(" | ")} | spread |`, `|---|${CLASS_IDS.map(() => "---|").join("")}---|`];
    for (const t of TIERS) {
      const d = CLASS_IDS.map((c) => summarize(by[c]![t]!));
      lines.push(`| ${t} | ${d.map((s) => `${s.deathsPerMap.toFixed(2)} d/map, ${s.meanClearSec.toFixed(1)} s, ${s.maps} maps`).join(" | ")} | `
        + `${(Math.max(...d.map((s) => s.deathsPerMap)) - Math.min(...d.map((s) => s.deathsPerMap))).toFixed(2)} |`);
    }
    const out = resolve(__dirname, "../../../review/playtest-tiers.md");
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, lines.join("\n") + "\n");
  }, 3 * 60 * 60 * 1000);

  it.each(GATED)("tier %i: no class dies more than 1.2 times a map, nor 0.7 more than another", (tier) => {
    const d = CLASS_IDS.map((c) => summarize(by[c]![tier]!).deathsPerMap);
    expect(Math.max(...d)).toBeLessThanOrEqual(MAX_DEATHS);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(MAX_SPREAD);
  });
});
