import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLASS_IDS } from "@exiled/rules";
import { DEFAULT_ATTACK_BY_CLASS } from "@exiled/content-runtime";
import { campaign, newCharacter, playNextMap, summarize, type MapRun, type Summary } from "./playtest";

/**
 * The owner's targets for a fresh character on its first tier-1 map, played by
 * the bot in `playtest.ts` (a competent casual: 200 ms reactions, kites, dodges,
 * drinks, loots). The bands are design intent, the same contract balance.test.ts
 * keeps for the lab: wide enough to survive a retune, narrow enough to catch a
 * drift. `PLAYTEST=full` runs the wide sweep and writes review/playtest-report.md.
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
});

/** Level 10 holds every class's level-8 area skill, which a level-1 map never sees. */
describe("three maps at level 10 (bot)", () => {
  const sum = Object.fromEntries(CLASS_IDS.map((c) =>
    [c, summarize([1, 2, 3, 4, 5, 6].flatMap((s) => campaign(c, 400 + s, 3, {}, 10)))])) as Record<string, Summary>;

  it.each(CLASS_IDS)("%s clears every map and rarely dies", (c) => {
    expect(sum[c]!.clearRate).toBe(1);
    expect(sum[c]!.deathsPerMap).toBeLessThan(0.5);
  });

  it("the classes clear within 25% of each other", () => {
    const t = CLASS_IDS.map((c) => sum[c]!.meanClearSec);
    expect(Math.max(...t) / Math.min(...t)).toBeLessThan(1.25);
  });
});

// ── The wide sweep ───────────────────────────────────────────────────────────

const FULL = process.env["PLAYTEST"] === "full";

describe.skipIf(!FULL)("full playtest report", () => {
  it("writes review/playtest-report.md", () => {
    const lines: string[] = ["# Playtest report", "", `Generated ${new Date().toISOString()}.`, ""];
    const row = (label: string, s: Summary) =>
      `| ${label} | ${s.maps} | ${pct(s.clearRate)} | ${s.deathsPerMap.toFixed(2)} | ${s.meanClearSec.toFixed(0)} | ${s.killsPerCombatSec.toFixed(2)} | ${s.magicPlusGapSec.toFixed(0)} | ${s.raresPerMap.toFixed(2)} |`;
    const head = ["| | maps | clear | deaths/map | clear s | kills/combat s | s per magic+ | rares/map |", "|---|---|---|---|---|---|---|---|"];

    lines.push("## 1. First map, fresh character (tier 1, 20 seeds)", "", ...head);
    for (const c of CLASS_IDS) {
      const runs = range(20).map((s) => firstMap(c, 100 + s));
      lines.push(row(short(c), summarize(runs)));
    }

    lines.push("", "## 2. Five-map campaign (10 seeds; the bot opens the lowest uncleared node its stones allow)", "",
      "| class | map | tier (stone) | clear | deaths/map | clear s | level after |", "|---|---|---|---|---|---|---|");
    for (const c of CLASS_IDS) {
      const all = range(10).map((s) => campaign(c, 200 + s, 5));
      for (let i = 0; i < 5; i++) {
        const at = all.map((r) => r[i]).filter((r): r is MapRun => !!r);
        if (at.length === 0) continue;
        const s = summarize(at);
        const tiers = [...new Set(at.map((r) => r.tier))].sort((a, b) => a - b).join("/");
        const lvl = at.reduce((a, r) => a + r.levelEnd, 0) / at.length;
        lines.push(`| ${short(c)} | ${i + 1} | ${tiers} | ${pct(s.clearRate)} | ${s.deathsPerMap.toFixed(2)} | ${s.meanClearSec.toFixed(0)} | ${lvl.toFixed(1)} |`);
      }
    }

    lines.push("", "## 3. Skill ablation (level 10, on-level gems, tier 1, 10 seeds)", "", ...head);
    for (const c of CLASS_IDS) {
      const variants: [string, string[]][] = [
        ["full bar", []],
        ["no Ember Bolt", ["skill.ember_bolt.v1"]],
        ["no Cinder Ground", ["skill.cinder_ground.v1"]],
        ["no Blink", ["skill.blink.v1"]],
        [`no ${short(DEFAULT_ATTACK_BY_CLASS[c]!)}`, [DEFAULT_ATTACK_BY_CLASS[c]!]],
      ];
      for (const [label, without] of variants) {
        const runs = range(10).map((s) => campaign(c, 300 + s, 1, { without }, 10)[0]!);
        lines.push(row(`${short(c)}, ${label}`, summarize(runs)));
      }
    }

    const out = resolve(__dirname, "../../../review/playtest-report.md");
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, lines.join("\n") + "\n");
  }, 30 * 60 * 1000);
});

function range(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
function pct(x: number): string { return `${Math.round(x * 100)}%`; }
function short(id: string): string { return id.replace(/^(class|skill)\./, "").replace(/\.v1$/, ""); }
