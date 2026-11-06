// The Emberbound coverage results as markdown tables. Pure: runs in, lines out.
// Test tooling only; playtest-coverage-emberbound.test.ts writes what this returns.
import type { BenchRow, EmberRun } from "./playtest-emberbound";

const short = (id: string) => id.replace(/^(class|skill|monster)\./, "").replace(/\.v1$/, "");
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const sd = (xs: readonly number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const quantile = (xs: readonly number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "-");
const sum = (runs: readonly EmberRun[], pick: (r: EmberRun) => number) => runs.reduce((a, r) => a + pick(r), 0);
function tally(runs: readonly EmberRun[], pick: (r: EmberRun) => Record<string, number>): [string, number][] {
  const t: Record<string, number> = {};
  for (const r of runs) for (const [k, n] of Object.entries(pick(r))) t[k] = (t[k] ?? 0) + n;
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
}

export interface Group { label: string; runs: EmberRun[] }

/** Seeds, maps and every per-variant number the tables print, for the report's prose. */
export function stats(runs: readonly EmberRun[]) {
  const cleared = runs.filter((r) => r.cleared);
  const minutes = sum(runs, (r) => r.seconds) / 60;
  const ttk = (k: "normal" | "magic" | "rare" | "boss") => runs.flatMap((r) => r.ttk[k]);
  // A seed's mean clear first, so the spread is between characters, not between maps.
  const bySeed = [...new Set(runs.map((r) => r.seed))].map((s) => mean(cleared.filter((r) => r.seed === s).map((r) => r.seconds))).filter(Number.isFinite);
  return {
    seeds: new Set(runs.map((r) => r.seed)).size,
    maps: runs.length,
    clearRate: cleared.length / (runs.length || 1),
    clearSec: mean(cleared.map((r) => r.seconds)),
    clearSd: sd(cleared.map((r) => r.seconds)),
    seedSd: sd(bySeed),
    killsPerMin: sum(runs, (r) => r.kills) / (minutes || 1),
    deathsPerMap: sum(runs, (r) => r.deaths) / (runs.length || 1),
    ttkNormal: quantile(ttk("normal"), 0.5), ttkNormal90: quantile(ttk("normal"), 0.9),
    ttkMagic: quantile(ttk("magic"), 0.5),
    ttkRare: quantile(ttk("rare"), 0.5), ttkRare90: quantile(ttk("rare"), 0.9),
    ttkBoss: quantile(ttk("boss"), 0.5), ttkBoss90: quantile(ttk("boss"), 0.9),
    bossFight: mean(cleared.map((r) => r.bossSeconds!).filter((x) => x !== null)),
    takenPerMin: sum(runs, (r) => Object.values(r.taken).reduce((a, x) => a + x, 0)) / (minutes || 1),
    lifeFlasks: sum(runs, (r) => r.lifeFlasks) / (runs.length || 1),
    manaFlasks: sum(runs, (r) => r.manaFlasks) / (runs.length || 1),
    manaPerMin: sum(runs, (r) => r.manaSpent) / (minutes || 1),
    dry: sum(runs, (r) => r.manaDrySec) / (sum(runs, (r) => r.seconds) || 1),
    levelsPerMin: sum(runs, (r) => r.levelEnd - r.levelStart) / (minutes || 1),
    magic: sum(runs, (r) => r.drops.magic) / (runs.length || 1),
    rare: sum(runs, (r) => r.drops.rare) / (runs.length || 1),
    unique: sum(runs, (r) => r.drops.unique) / (runs.length || 1),
    currency: sum(runs, (r) => r.drops.currency) / (runs.length || 1),
    stones: sum(runs, (r) => r.drops.waystone) / (runs.length || 1),
    gold: sum(runs, (r) => r.gold) / (runs.length || 1),
    killers: tally(runs, (r) => Object.fromEntries(r.killers.map((k) => [k, 1]))),
    takenBy: tally(runs, (r) => r.taken),
    casts: tally(runs, (r) => r.casts).map(([k, n]) => [k, n / (minutes || 1)] as [string, number]),
    dealt: tally(runs, (r) => r.dealt),
    minutes,
  };
}

export function paceTable(groups: readonly Group[]): string[] {
  const out = [
    "| variant | seeds x maps | clear | clear s (sd maps / sd seeds) | kills/min | deaths/map | deaths by | TTK normal s (p90) | TTK magic s | TTK rare s (p90) | boss fight s |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { label, runs } of groups) {
    const s = stats(runs);
    const killers = s.killers.slice(0, 3).map(([k, n]) => `${short(k)} ${n}`).join(", ") || "-";
    out.push(`| ${label} | ${s.seeds} x ${f(s.maps / (s.seeds || 1), 1)} | ${pct(s.clearRate)} | ${f(s.clearSec)} (${f(s.clearSd)} / ${f(s.seedSd)}) | ${f(s.killsPerMin, 1)} | ${f(s.deathsPerMap, 2)} | ${killers} | ${f(s.ttkNormal, 1)} (${f(s.ttkNormal90, 1)}) | ${f(s.ttkMagic, 1)} | ${f(s.ttkRare, 1)} (${f(s.ttkRare90, 1)}) | ${f(s.bossFight, 1)} |`);
  }
  return out;
}

export function resourceTable(groups: readonly Group[]): string[] {
  const out = [
    "| variant | dmg taken/min | top sources | life flasks/map | mana flasks/map | mana spent/min | mana dry | levels/min | magic/map | rare/map | unique/map | currency/map | stones/map | gold/map |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { label, runs } of groups) {
    const s = stats(runs);
    const total = s.takenBy.reduce((a, [, n]) => a + n, 0) || 1;
    const top = s.takenBy.slice(0, 2).map(([k, n]) => `${short(k)} ${pct(n / total)}`).join(", ") || "-";
    out.push(`| ${label} | ${f(s.takenPerMin)} | ${top} | ${f(s.lifeFlasks, 1)} | ${f(s.manaFlasks, 1)} | ${f(s.manaPerMin)} | ${pct(s.dry)} | ${f(s.levelsPerMin, 2)} | ${f(s.magic, 1)} | ${f(s.rare, 2)} | ${f(s.unique, 2)} | ${f(s.currency, 1)} | ${f(s.stones, 2)} | ${f(s.gold)} |`);
  }
  return out;
}

/** Casts per minute and share of damage sent, per skill; burning ticks as one bucket. */
export function skillTable(groups: readonly Group[]): string[] {
  const out = ["| variant | casts/min | share of damage sent (pre-mitigation) |", "|---|---|---|"];
  for (const { label, runs } of groups) {
    const s = stats(runs);
    const total = s.dealt.reduce((a, [, n]) => a + n, 0) || 1;
    out.push(`| ${label} | ${s.casts.map(([k, n]) => `${short(k)} ${f(n, 1)}`).join(", ") || "-"} | ${s.dealt.map(([k, n]) => `${short(k)} ${pct(n / total)}`).join(", ") || "-"} |`);
  }
  return out;
}

/** A campaign, map index by map index: tier, level, clear and pace as the character climbs. */
export function campaignTable(label: string, runs: readonly EmberRun[]): string[] {
  const out = [
    `| ${label}: map | runs | tier (min-max) | level after | clear | clear s | deaths/map | kills/min | rare+unique/map |`,
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const maxMap = Math.max(0, ...runs.map((r) => r.map));
  for (let m = 1; m <= maxMap; m++) {
    const at = runs.filter((r) => r.map === m);
    if (!at.length) continue;
    const s = stats(at);
    const tiers = at.map((r) => r.tier);
    out.push(`| ${m} | ${at.length} | ${f(mean(tiers), 1)} (${Math.min(...tiers)}-${Math.max(...tiers)}) | ${f(mean(at.map((r) => r.levelEnd)), 1)} | ${pct(s.clearRate)} | ${f(s.clearSec)} | ${f(s.deathsPerMap, 2)} | ${f(s.killsPerMin, 1)} | ${f(s.rare + s.unique, 2)} |`);
  }
  return out;
}

export function benchTable(rows: readonly BenchRow[]): string[] {
  const out = [
    "| skill | extra | gem | targets | casts | DPS total | DPS per target | mana/s |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    out.push(`| ${short(r.skill)} | ${r.extra || "-"} | ${r.gem} | ${r.targets} | ${r.casts} | ${f(r.dps, 1)} | ${f(r.dpsPerTarget, 1)} | ${f(r.manaPerSec, 1)} |`);
  }
  return out;
}

/** Mean clear seconds over the nodes every group cleared, each node weighted once (playtest-level10's metric). */
export function nodeWeightedClear(groups: readonly Group[]): number[] {
  if (groups.length === 0) return [];
  const nodes = [...new Set(groups[0]!.runs.map((r) => r.node))]
    .filter((n) => groups.every((g) => g.runs.some((r) => r.node === n && r.cleared)));
  return groups.map((g) => mean(nodes.map((n) => mean(g.runs.filter((r) => r.node === n && r.cleared).map((r) => r.seconds)))));
}
