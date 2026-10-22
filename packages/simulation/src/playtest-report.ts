// The wide playtest sweep for one class, as the lines of a markdown report.
// Test tooling only, like playtest.ts: each class runs in its own test file
// (playtest-report-<class>.test.ts), so vitest plays the three in parallel.
import { DEFAULT_ATTACK_BY_CLASS } from "@exiled/content-runtime";
import { AREA, SIGNATURE } from "./bot";
import { campaign, newCharacter, playNextMap, summarize, type MapRun, type Summary } from "./playtest";

export function playtestReport(c: string): string[] {
  const lines: string[] = [`# Playtest report: ${short(c)}`, "", `Generated ${new Date().toISOString()}.`, ""];
  const row = (label: string, s: Summary) =>
    `| ${label} | ${s.maps} | ${pct(s.clearRate)} | ${s.deathsPerMap.toFixed(2)} | ${s.meanClearSec.toFixed(0)} | ${s.killsPerCombatSec.toFixed(2)} | ${s.magicPlusGapSec.toFixed(0)} | ${s.raresPerMap.toFixed(2)} |`;
  const head = ["| | maps | clear | deaths/map | clear s | kills/combat s | s per magic+ | rares/map |", "|---|---|---|---|---|---|---|---|"];

  lines.push("## 1. First map, fresh character (tier 1, 20 seeds)", "", ...head);
  lines.push(row(short(c), summarize(range(20).map((s) => playNextMap(newCharacter(c, 100 + s))!))));

  lines.push("", "## 2. Five-map campaign (10 seeds; the bot opens the lowest uncleared node its stones allow)", "",
    "| class | map | tier (stone) | clear | deaths/map | clear s | level after |", "|---|---|---|---|---|---|---|");
  const all = range(10).map((s) => campaign(c, 200 + s, 5));
  for (let i = 0; i < 5; i++) {
    const at = all.map((r) => r[i]).filter((r): r is MapRun => !!r);
    if (at.length === 0) continue;
    const s = summarize(at);
    const tiers = [...new Set(at.map((r) => r.tier))].sort((a, b) => a - b).join("/");
    const lvl = at.reduce((a, r) => a + r.levelEnd, 0) / at.length;
    lines.push(`| ${short(c)} | ${i + 1} | ${tiers} | ${pct(s.clearRate)} | ${s.deathsPerMap.toFixed(2)} | ${s.meanClearSec.toFixed(0)} | ${lvl.toFixed(1)} |`);
  }

  lines.push("", "## 3. Skill ablation (level 10, on-level gems, tier 1, 10 seeds)", "", ...head);
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

  const flat = all.flat();
  lines.push("", "## 4. Boss fights (five-map campaign, cleared maps; s from the boss's first lost life to its death)", "",
    "| class | boss | fights | mean s | min s | max s |", "|---|---|---|---|---|---|");
  const fights = flat.filter((r) => r.bossSeconds !== null);
  for (const b of [...new Set(fights.map((r) => r.bossId!))].sort()) {
    const t = fights.filter((r) => r.bossId === b).map((r) => r.bossSeconds!);
    lines.push(`| ${short(c)} | ${b.replace(/^monster\.|\.v1$/g, "")} | ${t.length} | ${(t.reduce((a, x) => a + x, 0) / t.length).toFixed(0)} | ${Math.min(...t).toFixed(0)} | ${Math.max(...t).toFixed(0)} |`);
  }
  lines.push("", "## 5. Gold per map (five-map campaign, picked up; the bot never shops)", "",
    "| class | map 1 | map 2 | map 3 | map 4 | map 5 | total |", "|---|---|---|---|---|---|---|");
  const per = range(5).map((i) => { const at = all.map((r) => r[i]).filter((r): r is MapRun => !!r); return at.reduce((a, r) => a + r.gold, 0) / (at.length || 1); });
  lines.push(`| ${short(c)} | ${per.map((g) => g.toFixed(0)).join(" | ")} | ${per.reduce((a, g) => a + g, 0).toFixed(0)} |`);

  const tally = (pick: (r: MapRun) => Record<string, number>) => {
    const t: Record<string, number> = {};
    for (const r of flat) for (const [k, n] of Object.entries(pick(r))) t[k] = (t[k] ?? 0) + n;
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  };
  const affixes = tally((r) => r.affixes);
  const rolled = affixes.reduce((a, [, n]) => a + n, 0);
  lines.push("", `## 6. Affix and unique frequency (this class's campaign drops: ${flat.length} maps, ${rolled} rolled affixes)`, "",
    "| affix | rolls | share |", "|---|---|---|", ...affixes.map(([k, n]) => `| ${k} | ${n} | ${pct(n / rolled)} |`),
    "", "| unique | drops |", "|---|---|", ...tally((r) => r.uniques).map(([k, n]) => `| ${k} | ${n} |`));
  return lines;
}

export function short(id: string): string { return id.replace(/^(class|skill)\./, "").replace(/\.v1$/, ""); }
function range(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
function pct(x: number): string { return `${Math.round(x * 100)}%`; }
