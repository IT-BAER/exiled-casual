import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLASS_IDS } from "@exiled/rules";
import { DEFAULT_ATTACK_BY_CLASS } from "@exiled/content-runtime";
import { AREA, SIGNATURE } from "./bot";
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
    const campaigns: Record<string, MapRun[][]> = {};
    for (const c of CLASS_IDS) {
      const all = campaigns[c] = range(10).map((s) => campaign(c, 200 + s, 5));
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
        [`no ${short(SIGNATURE[c]!)}`, [SIGNATURE[c]!]],
        [`no ${short(AREA[c]!)}`, [AREA[c]!]],
        ["no blink", ["skill.blink.v1"]],
        [`no ${short(DEFAULT_ATTACK_BY_CLASS[c]!)}`, [DEFAULT_ATTACK_BY_CLASS[c]!]],
      ];
      for (const [label, without] of variants) {
        const runs = range(10).map((s) => campaign(c, 300 + s, 1, { without }, 10)[0]!);
        lines.push(row(`${short(c)}, ${label}`, summarize(runs)));
      }
    }

    const flat = Object.values(campaigns).flat(2);
    lines.push("", "## 4. Boss fights (five-map campaign, cleared maps; s from the boss's first lost life to its death)", "",
      "| class | boss | fights | mean s | min s | max s |", "|---|---|---|---|---|---|");
    for (const c of CLASS_IDS) {
      const fights = campaigns[c]!.flat().filter((r) => r.bossSeconds !== null);
      for (const b of [...new Set(fights.map((r) => r.bossId!))].sort()) {
        const t = fights.filter((r) => r.bossId === b).map((r) => r.bossSeconds!);
        lines.push(`| ${short(c)} | ${b.replace(/^monster\.|\.v1$/g, "")} | ${t.length} | ${(t.reduce((a, x) => a + x, 0) / t.length).toFixed(0)} | ${Math.min(...t).toFixed(0)} | ${Math.max(...t).toFixed(0)} |`);
      }
    }
    lines.push("", "## 5. Gold per map (five-map campaign, picked up; the bot never shops)", "",
      "| class | map 1 | map 2 | map 3 | map 4 | map 5 | total |", "|---|---|---|---|---|---|---|");
    for (const c of CLASS_IDS) {
      const per = range(5).map((i) => { const at = campaigns[c]!.map((r) => r[i]).filter((r): r is MapRun => !!r); return at.reduce((a, r) => a + r.gold, 0) / (at.length || 1); });
      lines.push(`| ${short(c)} | ${per.map((g) => g.toFixed(0)).join(" | ")} | ${per.reduce((a, g) => a + g, 0).toFixed(0)} |`);
    }
    const tally = (pick: (r: MapRun) => Record<string, number>) => {
      const t: Record<string, number> = {};
      for (const r of flat) for (const [k, n] of Object.entries(pick(r))) t[k] = (t[k] ?? 0) + n;
      return Object.entries(t).sort((a, b) => b[1] - a[1]);
    };
    const affixes = tally((r) => r.affixes);
    const rolled = affixes.reduce((a, [, n]) => a + n, 0);
    lines.push("", `## 6. Affix and unique frequency (all campaign drops: ${flat.length} maps, ${rolled} rolled affixes)`, "",
      "| affix | rolls | share |", "|---|---|---|", ...affixes.map(([k, n]) => `| ${k} | ${n} | ${pct(n / rolled)} |`),
      "", "| unique | drops |", "|---|---|", ...tally((r) => r.uniques).map(([k, n]) => `| ${k} | ${n} |`));

    const out = resolve(__dirname, "../../../review/playtest-report.md");
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, lines.join("\n") + "\n");
  }, 30 * 60 * 1000);
});

function range(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
function pct(x: number): string { return `${Math.round(x * 100)}%`; }
function short(id: string): string { return id.replace(/^(class|skill)\./, "").replace(/\.v1$/, ""); }
