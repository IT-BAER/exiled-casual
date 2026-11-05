// Class parity on the seeds of record, stock bot against each class's kit, as the
// lines of a markdown report (balance report 4 Nov, section 5 step 6). Test tooling
// only: `PLAYTEST=parity` runs it from playtest-parity.test.ts.
import { CLASS_IDS } from "@exiled/rules";
import { summarize, type MapRun } from "./playtest";
import { campaigns, type CampaignJob } from "./playtest-parallel";
import { short } from "./playtest-report";

type Opts = CampaignJob["opts"];
const PILOTS: [string, Opts][] = [["stock", {}], ["kit", { kit: true }]];

export async function parityReport(): Promise<string[]> {
  const lines = ["# Class parity: stock bot and class kit", "", `Generated ${new Date().toISOString()}.`, "",
    "max/min is the slowest class's mean clear over the fastest's. Bands: 1.20 at level 1, 1.25 at level 10.", ""];
  const head = ["| row | pilot | ironsworn s | stalker s | emberbound s | max/min | deaths/map | boss s | flasks/map |",
    "|---|---|---|---|---|---|---|---|---|"];
  const play = async (seeds: number[], maps: number, level: number, opts: Opts): Promise<Record<string, MapRun[]>> => {
    const jobs = CLASS_IDS.flatMap((c) => seeds.map((seed) => ({ classId: c, seed, maps, level, opts })));
    const runs = await campaigns(jobs);
    return Object.fromEntries(CLASS_IDS.map((c) => [c, runs.filter((_, i) => jobs[i]!.classId === c).flat()]));
  };
  const row = (label: string, pilot: string, by: Record<string, MapRun[]>, t: number[]) => {
    const all = CLASS_IDS.flatMap((c) => by[c]!);
    const boss = all.filter((r) => r.bossSeconds !== null).map((r) => r.bossSeconds!);
    return `| ${label} | ${pilot} | ${t.map((x) => x.toFixed(1)).join(" | ")} | ${(Math.max(...t) / Math.min(...t)).toFixed(3)} | `
      + `${summarize(all).deathsPerMap.toFixed(2)} | ${mean(boss).toFixed(1)} | ${(all.reduce((a, r) => a + r.flasks, 0) / all.length).toFixed(1)} |`;
  };
  const plain = (by: Record<string, MapRun[]>) => CLASS_IDS.map((c) => summarize(by[c]!).meanClearSec);
  // playtest-level10.test.ts: the nodes every class played, each node weighted once.
  const nodeWeighted = (by: Record<string, MapRun[]>) => {
    const nodes = [...new Set(by[CLASS_IDS[0]!]!.map((r) => r.node))]
      .filter((n) => CLASS_IDS.every((c) => by[c]!.some((r) => r.node === n && r.cleared)));
    return CLASS_IDS.map((c) => nodes.reduce((a, n) => a + summarize(by[c]!.filter((r) => r.node === n)).meanClearSec, 0) / nodes.length);
  };

  lines.push("## 1. Parity rows of record", "", ...head);
  const l10: Record<string, Record<string, MapRun[]>> = {};
  for (const [pilot, opts] of PILOTS) {
    const l1a = await play(range(1, 10), 1, 1, opts);
    lines.push(row("L1 first map, seeds 1-10 (playtest.test.ts)", pilot, l1a, plain(l1a)));
    const l1b = await play(range(100, 119), 1, 1, opts);
    lines.push(row("L1 first map, seeds 100-119 (playtest-report.ts)", pilot, l1b, plain(l1b)));
    l10[pilot] = await play(range(401, 430), 3, 10, opts);
    lines.push(row("L10, 3 maps, seeds 401-430, node-weighted", pilot, l10[pilot]!, nodeWeighted(l10[pilot]!)));
    lines.push(row("L10, 3 maps, seeds 401-430, plain mean", pilot, l10[pilot]!, plain(l10[pilot]!)));
  }
  const novice = await play(range(1, 10), 1, 1, { novice: true });
  lines.push(row("L1 first map, seeds 1-10, novice (pressure)", "stock", novice, plain(novice)));

  lines.push("", "## 2. Natural campaigns from level 1 (15 maps, seeds 501-510; gems at their natural level)", "",
    "| pilot | maps | ironsworn s | stalker s | emberbound s | max/min | level after (I/S/E) | tier (I/S/E) |", "|---|---|---|---|---|---|---|---|");
  for (const [pilot, opts] of PILOTS) {
    const by = await play(range(501, 510), 15, 1, opts);
    for (const [from, to] of [[0, 5], [5, 10], [10, 15]] as const) {
      const at = Object.fromEntries(CLASS_IDS.map((c) => [c, by[c]!.filter((_, i) => i % 15 >= from && i % 15 < to)]));
      const t = plain(at);
      const lvl = CLASS_IDS.map((c) => mean(at[c]!.map((r) => r.levelEnd)).toFixed(1)).join("/");
      const tier = CLASS_IDS.map((c) => mean(at[c]!.map((r) => r.tier)).toFixed(1)).join("/");
      lines.push(`| ${pilot} | ${from + 1}-${to} | ${t.map((x) => x.toFixed(1)).join(" | ")} | ${(Math.max(...t) / Math.min(...t)).toFixed(3)} | ${lvl} | ${tier} |`);
    }
  }

  lines.push("", "## 3. Damage share by skill (L10 rows; burning credited to the skill that laid it)", "");
  for (const [pilot] of PILOTS) {
    for (const c of CLASS_IDS) {
      const dealt: Record<string, number> = {};
      for (const r of l10[pilot]![c]!) for (const [k, n] of Object.entries(r.dealt)) dealt[k] = (dealt[k] ?? 0) + n;
      const total = Object.values(dealt).reduce((a, n) => a + n, 0) || 1;
      const top = Object.entries(dealt).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${short(k)} ${Math.round((100 * n) / total)}%`);
      lines.push(`- ${pilot}, ${short(c)}: ${top.join(", ")}`);
    }
  }
  return lines;
}

function range(from: number, to: number): number[] { return Array.from({ length: to - from + 1 }, (_, i) => from + i); }
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0; }
