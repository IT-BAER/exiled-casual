import { describe, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setPriority } from "node:os";
import { CLASS_IDS } from "@exiled/rules";
import {
  runJobs, SK, type CampaignResult, type StalkerJob, type Variant, type SkillPolicy, type StalkerRun,
} from "./playtest-stalker";

/**
 * The Stalker coverage sweep (balance-stalker-2026-11-04.md). Measures, tunes nothing.
 *
 *   PLAYTEST=stalker STALKER_GROUPS=parity,campaign npx vitest run src/playtest-coverage-stalker
 *
 * Each group writes review/balance-stalker/<group>.json (every campaign) and <group>.md.
 */
const GROUPS = (process.env["STALKER_GROUPS"] ?? "smoke").split(",");
const OUT = resolve(__dirname, "../../../review/balance-stalker");
const name = (id: string) => id.replace(/^skill\.|\.v1$/g, "");
const seeds = (base: number, n: number) => Array.from({ length: n }, (_, i) => base + i);

const main = (id: string): SkillPolicy => ({ single: [id], pack: [id] });
const SNAP_ONLY: SkillPolicy = { single: [], pack: [] };
/** Every damaging skill the bar can hold beside Marked Prey and Windstride. */
const KIT: Exclude<SkillPolicy, "bot"> = {
  single: [SK.arc, SK.pierce], pack: [SK.sky, SK.arc], mark: true, haste: true, vault: true, blink: false,
};
/** Before Arcing Arrow and Skyfall exist: what a player has at 3-13. */
const EARLY_KIT: SkillPolicy = { single: [SK.pierce, SK.rime], pack: [SK.split, SK.rime], vault: true };

function v(label: string, rest: Partial<Variant> & { level: number }): Variant {
  return { label, maps: 3, skills: "bot", gear: "bot", passives: "bot", ...rest };
}

function groupJobs(group: string): StalkerJob[] {
  const each = (vs: Variant[], s: number[]) => vs.flatMap((variant) => s.map((seed) => ({ variant, seed })));
  switch (group) {
    case "smoke":
      return each([v("smoke kit L18 T5", { level: 18, tier: 5, maps: 1, skills: KIT, gear: "rare" })], [1]);
    // The cross-class parity metric, exactly as playtest-report.ts (L1) and playtest-level10.test.ts (L10) play it.
    case "parity":
      return [
        ...CLASS_IDS.flatMap((c) => each([v(`parity L1 ${c}`, { classId: c, level: 1, maps: 1 })], seeds(100, 20))),
        ...CLASS_IDS.flatMap((c) => each([v(`parity L10 ${c}`, { classId: c, level: 10, maps: 3 })], seeds(401, 30))),
      ];
    // Level 1 to wherever thirty maps reach, the atlas walked by the harness's own rule.
    case "campaign":
      return each([
        v("campaign: bot as shipped", { level: 1, maps: 30 }),
        v("campaign: full kit, attack refit", { level: 1, maps: 30, skills: KIT, gear: "attack" }),
        v("campaign: full kit, attack refit, vendor", { level: 1, maps: 30, skills: KIT, gear: "attack", vendor: true }),
        v("campaign: early kit, attack refit, vendor", { level: 1, maps: 30, skills: EARLY_KIT, gear: "attack", vendor: true }),
      ], seeds(500, 6));
    // Main skill alone (Snap Shot behind it), L10 on Tier 3 with the harness's own gear, as parity plays it.
    case "skills10":
      return each([
        v("L10 T3: bot as shipped", { level: 10, tier: 3 }),
        v("L10 T3: Snap Shot only", { level: 10, tier: 3, skills: SNAP_ONLY }),
        ...[SK.pierce, SK.vault, SK.rime, SK.split].map((id) => v(`L10 T3: ${name(id)}`, { level: 10, tier: 3, skills: main(id) })),
        v("L10 T3: early kit", { level: 10, tier: 3, skills: EARLY_KIT }),
      ], seeds(401, 20));
    // Every damaging skill, L18 on Tier 8 (where natural campaigns are at L18), a locked magic kit.
    case "skills18":
      return each([
        v("L18 T8: bot as shipped", { level: 18, tier: 8, gear: "magic" }),
        v("L18 T8: Snap Shot only", { level: 18, tier: 8, gear: "magic", skills: SNAP_ONLY }),
        ...[SK.pierce, SK.vault, SK.rime, SK.split, SK.arc, SK.sky].map((id) =>
          v(`L18 T8: ${name(id)}`, { level: 18, tier: 8, gear: "magic", skills: main(id) })),
        v("L18 T8: full kit", { level: 18, tier: 8, gear: "magic", skills: KIT }),
      ], seeds(600, 20));
    // Windstride needs L24, which no 30-map campaign reaches: the kit with and without each utility.
    case "utility24":
      return each([
        v("L24 T9: full kit", { level: 24, tier: 9, gear: "magic", skills: KIT }),
        v("L24 T9: kit, no Windstride", { level: 24, tier: 9, gear: "magic", skills: { ...KIT, haste: false } }),
        v("L24 T9: kit, no Marked Prey", { level: 24, tier: 9, gear: "magic", skills: { ...KIT, mark: false } }),
        v("L24 T9: kit, no Vaulting Shot", { level: 24, tier: 9, gear: "magic", skills: { ...KIT, vault: false } }),
        v("L24 T9: kit, Blink for Vaulting", { level: 24, tier: 9, gear: "magic", skills: { ...KIT, vault: false, blink: true } }),
      ], seeds(700, 20));
    // Each spoke walked to its keystone (39 points reach all eight), the bot's skills and a locked magic kit.
    case "passives":
      return each((["bot", "none", "ember", "ash", "cinder", "stone", "bulwark", "veil", "storm", "hearth"] as const).map((p) =>
        v(`L40 T9: passives ${p}`, { level: 40, tier: 9, gear: "magic", passives: p })), seeds(800, 15));
    // Gear tiers on the shipped bot, L18 on Tier 8.
    case "gear":
      return each([
        ...(["starter", "normal", "magic", "rare", "unique"] as const).map((gear) => v(`L18 T8: gear ${gear}`, { level: 18, tier: 8, gear })),
        v("L18 T8: gear by harness refit (drops only)", { level: 18, tier: 8, gear: "bot" }),
        v("L18 T8: gear by attack refit + vendor", { level: 18, tier: 8, gear: "attack", vendor: true }),
      ], seeds(900, 20));
    // Level 1 again, the best stone spent first so the atlas keeps climbing.
    case "climb":
      return each([
        v("climb: bot as shipped", { level: 1, maps: 30, atlas: "climb" }),
        v("climb: full kit, attack refit, vendor", { level: 1, maps: 30, skills: KIT, gear: "attack", vendor: true, atlas: "climb" }),
      ], seeds(500, 6));
    default:
      throw new Error(`unknown group ${group}`);
  }
}

describe.skipIf(process.env["PLAYTEST"] !== "stalker")("stalker coverage sweep", () => {
  it.each(GROUPS)("group %s", async (group) => {
    try { setPriority(10); } catch { /* courtesy only */ }
    // STALKER_REPORT_ONLY=1 re-derives the tables from the saved JSON without playing anything.
    const saved = resolve(OUT, `${group}.json`);
    const started = Date.now();
    const results: CampaignResult[] = process.env["STALKER_REPORT_ONLY"] === "1"
      ? JSON.parse(readFileSync(saved, "utf8"))
      : await runJobs(groupJobs(group), undefined, (d, n) => {
        if (d % 10 === 0 || d === n) console.log(`[${group}] ${d}/${n} campaigns, ${((Date.now() - started) / 1000).toFixed(0)} s`);
      });
    mkdirSync(OUT, { recursive: true });
    if (process.env["STALKER_REPORT_ONLY"] !== "1") writeFileSync(saved, JSON.stringify(results));
    writeFileSync(resolve(OUT, `${group}.md`), report(group, results).join("\n") + "\n");
  }, 6 * 60 * 60 * 1000);
});

// ── Tables ───────────────────────────────────────────────────────────────────

function report(group: string, results: CampaignResult[]): string[] {
  const labels = [...new Set(results.map((r) => r.label))];
  const lines = [`## ${group}`, "", ...(group === "parity" ? parity(results) : [])];
  lines.push(
    "| variant | seeds | maps | clear | deaths/map | clear s mean (sd) | kills/min | kills/combat s | TTK normal/magic/rare/boss s | taken/map | mana/min | dry % | life fl/map | mana fl/map | lvl/min | end lvl | gold/map | magic+/map | rare+/map | currency/map |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const label of labels) lines.push(row(label, results.filter((r) => r.label === label)));
  lines.push("", "### Casts per minute of map time", "", "| variant | " + CAST_COLS.map(short).join(" | ") + " |", "|---|" + CAST_COLS.map(() => "---|").join(""));
  for (const label of labels) {
    const runs = results.filter((r) => r.label === label).flatMap((r) => r.runs);
    const min = sum(runs, (r) => r.seconds) / 60 || 1;
    lines.push(`| ${label} | ${CAST_COLS.map((id) => (sum(runs, (r) => r.casts[id] ?? 0) / min).toFixed(1)).join(" | ")} |`);
  }
  lines.push("", "### Damage taken by source (share of all damage taken) and deaths by killing blow", "");
  for (const label of labels) {
    const runs = results.filter((r) => r.label === label).flatMap((r) => r.runs);
    const t: Record<string, number> = {};
    for (const r of runs) for (const [k, n] of Object.entries(r.extra.taken)) t[k] = (t[k] ?? 0) + n;
    const all = Object.values(t).reduce((a, n) => a + n, 0) || 1;
    const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${pct(n / all)}`).join(", ");
    const k: Record<string, number> = {};
    for (const r of runs) for (const x of r.killers) k[x.replace(/monster\.|\.v1/g, "")] = (k[x.replace(/monster\.|\.v1/g, "")] ?? 0) + 1;
    const killers = Object.entries(k).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x} x${n}`).join(", ") || "none";
    lines.push(`- **${label}**: ${top}. Deaths: ${killers}.`);
  }
  if (group === "campaign" || group === "climb") {
    lines.push("", "### Progress by map index (mean over seeds)", "", "| variant | map | tier | clear s | deaths | level after | worn at end |", "|---|---|---|---|---|---|---|");
    for (const label of labels) {
      const cs = results.filter((r) => r.label === label);
      const n = Math.max(...cs.map((c) => c.runs.length));
      for (let i = 0; i < n; i += 3) {
        const at = cs.map((c) => c.runs[i]).filter((r): r is StalkerRun => !!r);
        const tiers = [...new Set(at.map((r) => r.tier))].sort((a, b) => a - b).join("/");
        lines.push(`| ${label} | ${i + 1} | ${tiers} | ${mean(at.filter((r) => r.cleared).map((r) => r.seconds)).toFixed(0)} | ${mean(at.map((r) => r.deaths)).toFixed(2)} | ${mean(at.map((r) => r.levelEnd)).toFixed(1)} | |`);
      }
      lines.push(`| ${label} | end | | | | ${mean(cs.map((c) => c.end.level)).toFixed(1)} | bow x${mean(cs.map((c) => c.end.bowMult)).toFixed(2)}, ${rarityMix(cs)}, bought ${mean(cs.map((c) => c.end.bought)).toFixed(1)} |`);
    }
  }
  return lines;
}

/** Class clear-time ratio, max over min class mean: plain, and node-weighted as playtest-level10.test.ts weighs it. */
function parity(results: CampaignResult[]): string[] {
  const out = ["| level | class | maps | clear | deaths/map | mean clear s | node-weighted s |", "|---|---|---|---|---|---|---|"];
  const ratios: string[] = [];
  for (const lvl of ["L1", "L10"]) {
    const runs = Object.fromEntries(CLASS_IDS.map((c) => [c, results.filter((r) => r.label === `parity ${lvl} ${c}`).flatMap((r) => r.runs)]));
    const nodes = [...new Set(runs[CLASS_IDS[0]]!.map((r) => r.node))]
      .filter((n) => CLASS_IDS.every((c) => runs[c]!.some((r) => r.node === n && r.cleared)));
    const plain = CLASS_IDS.map((c) => mean(runs[c]!.filter((r) => r.cleared).map((r) => r.seconds)));
    const weighted = CLASS_IDS.map((c) => mean(nodes.map((n) => mean(runs[c]!.filter((r) => r.node === n && r.cleared).map((r) => r.seconds)))));
    CLASS_IDS.forEach((c, i) => out.push(`| ${lvl} | ${c} | ${runs[c]!.length} | ${pct(mean(runs[c]!.map((r) => (r.cleared ? 1 : 0))))} | ${mean(runs[c]!.map((r) => r.deaths)).toFixed(2)} | ${plain[i]!.toFixed(1)} | ${weighted[i]!.toFixed(1)} |`));
    ratios.push(`- ${lvl}: ratio max/min ${(Math.max(...plain) / Math.min(...plain)).toFixed(3)} plain, ${(Math.max(...weighted) / Math.min(...weighted)).toFixed(3)} node-weighted over ${nodes.length} shared nodes.`);
  }
  return [...out, "", ...ratios, ""];
}

const CAST_COLS = [SK.snap, SK.pierce, SK.vault, SK.rime, SK.split, SK.mark, SK.arc, SK.sky, SK.haste, SK.blink,
  "skill.strike.v1", "skill.heavy_strike.v1", "skill.ground_slam.v1", "skill.ember_spark.v1", "skill.ember_bolt.v1", "skill.cinder_ground.v1"];

function row(label: string, cs: CampaignResult[]): string {
  const runs = cs.flatMap((c) => c.runs);
  const n = runs.length || 1;
  const cleared = runs.filter((r) => r.cleared).map((r) => r.seconds);
  const secs = sum(runs, (r) => r.seconds);
  const ttk = (k: "normal" | "magic" | "rare" | "boss") => {
    const xs = runs.flatMap((r) => r.extra.ttk[k]);
    return xs.length ? mean(xs).toFixed(1) : "-";
  };
  const combat = sum(runs, (r) => r.extra.combatTicks);
  const lvlMin = mean(cs.map((c) => c.runs.length === 0 ? 0
    : (c.runs[c.runs.length - 1]!.levelEnd - c.runs[0]!.levelStart) / (sum(c.runs, (r) => r.seconds) / 60)));
  return `| ${label} | ${cs.length} | ${runs.length} | ${pct(cleared.length / n)} | ${(sum(runs, (r) => r.deaths) / n).toFixed(2)} | ${mean(cleared).toFixed(0)} (${sd(cleared).toFixed(0)}) | ${(sum(runs, (r) => r.kills) / (secs / 60)).toFixed(1)} | ${(sum(runs, (r) => r.kills) / (sum(runs, (r) => r.combatSeconds) || 1)).toFixed(2)} | ${ttk("normal")}/${ttk("magic")}/${ttk("rare")}/${ttk("boss")} | ${(sum(runs, (r) => Object.values(r.extra.taken).reduce((a, x) => a + x, 0)) / n).toFixed(0)} | ${(sum(runs, (r) => r.extra.manaSpent) / (secs / 60)).toFixed(0)} | ${pct(sum(runs, (r) => r.extra.dryTicks) / (combat || 1))} | ${(sum(runs, (r) => r.extra.lifeFlasks) / n).toFixed(2)} | ${(sum(runs, (r) => r.extra.manaFlasks) / n).toFixed(2)} | ${lvlMin.toFixed(2)} | ${mean(cs.map((c) => c.end.level)).toFixed(1)} | ${(sum(runs, (r) => r.gold) / n).toFixed(0)} | ${(sum(runs, (r) => r.drops.magic + r.drops.rare + r.drops.unique) / n).toFixed(2)} | ${(sum(runs, (r) => r.drops.rare + r.drops.unique) / n).toFixed(2)} | ${(sum(runs, (r) => r.drops.currency) / n).toFixed(2)} |`;
}

function rarityMix(cs: CampaignResult[]): string {
  const t: Record<string, number> = {};
  for (const c of cs) for (const r of Object.values(c.end.worn)) t[r] = (t[r] ?? 0) + 1;
  return Object.entries(t).map(([k, n]) => `${k} ${(n / cs.length).toFixed(1)}`).join(" ");
}
function short(id: string): string { return id.replace(/^skill\.|\.v1$/g, ""); }
function sum<T>(xs: readonly T[], f: (x: T) => number): number { return xs.reduce((a, x) => a + f(x), 0); }
function mean(xs: readonly number[]): number { return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0; }
function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
function pct(x: number): string { return `${Math.round(x * 100)}%`; }
