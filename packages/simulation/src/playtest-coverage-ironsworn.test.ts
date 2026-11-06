// The Ironsworn balance sweep: every skill as the main one, passive builds, gear
// tiers, shopping, and the stock harness beside it for the class-ratio metric.
// Writes review/balance-ironsworn/<suite>.{json,md}; nothing is asserted beyond
// "it ran", because this measures and the tuning call is the owner's.
//
//   PLAYTEST_IRONSWORN=<suite|all> [IRON_PROCS=3] npx vitest run src/playtest-coverage-ironsworn
//
// Suites: check, baseline, natural, skills, passives, gear.
import { describe, it, expect } from "vitest";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLASS_IDS } from "@exiled/rules";
import { S, type IronRun, type Job, type Variant } from "./playtest-ironsworn";
import type { MapRun } from "./playtest";

type AnyJob = (Job & { harness?: false }) | { harness: true; classId: string; seed: number; maps: number; level: number; label: string };
const SUITE = process.env["PLAYTEST_IRONSWORN"] ?? "";
const PROCS = Number(process.env["IRON_PROCS"] ?? 3);
const OUT = resolve(__dirname, "../../../review/balance-ironsworn");
const seeds = (n: number, from: number) => Array.from({ length: n }, (_, i) => from + i);

function play(jobs: readonly AnyJob[]): Promise<unknown[][]> {
  const script = fileURLToPath(new URL("./playtest-fork-ironsworn.mjs", import.meta.url));
  const out: unknown[][] = new Array(jobs.length);
  let next = 0, done = 0;
  return new Promise((res, rej) => {
    if (jobs.length === 0) return res(out);
    for (let p = 0; p < Math.min(PROCS, jobs.length); p++) {
      const child = fork(script, [], { execArgv: ["--experimental-transform-types", "--no-warnings"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
      child.on("message", (m: { id?: number; runs?: unknown[] }) => {
        if (m.runs) {
          out[m.id!] = m.runs;
          if (++done % 10 === 0 || done === jobs.length) console.log(`[iron] ${done}/${jobs.length} jobs`);
          if (done === jobs.length) res(out);
        }
        if (next < jobs.length) { const id = next++; child.send({ id, job: jobs[id] }); } else child.disconnect();
      });
      child.on("error", rej);
      child.on("exit", (code) => { if (code !== 0) rej(new Error(`iron child exited ${code}`)); });
    }
  });
}

// ── Variants ────────────────────────────────────────────────────────────────

/** The pilot's kit with every skill a level has opened, best-first for the six sockets. */
const KIT: Variant = {
  label: "kit", bar: [S.slam, S.sunder, S.heavy, S.cry, S.rage, S.det, S.leap, S.quake, S.blink],
  area: [S.slam, S.quake], main: [S.sunder, S.heavy], buffs: [S.det, S.rage, S.cry], gap: true, passives: "greedy",
};
const one = (label: string, id: string, extra: Partial<Variant> = {}): Variant =>
  ({ label, bar: [id], main: [id], passives: "greedy", ...extra });
/** Heavy Strike and Ground Slam, the stock bot's pair, with one support added. */
const withSupport = (label: string, id: string, extra: Partial<Variant> = {}): Variant =>
  ({ label, bar: [S.heavy, S.slam, id], area: [S.slam], main: [S.heavy], passives: "greedy", ...extra });

const LAB = [
  { level: 2, tier: 1 }, { level: 8, tier: 2 }, { level: 14, tier: 3 }, { level: 26, tier: 5 }, { level: 44, tier: 8 },
] as const;

function skillVariants(level: number): Variant[] {
  const v: Variant[] = [
    { label: "stock bot", stock: true, passives: "greedy" },
    one("strike only", S.strike, { bar: [], main: [] }),
    one("heavy strike", S.heavy),
  ];
  if (level >= 6) v.push(one("leap slam", S.leap));
  if (level >= 8) v.push(one("ground slam", S.slam), { label: "heavy+slam", bar: [S.heavy, S.slam], area: [S.slam], main: [S.heavy], passives: "greedy" });
  if (level >= 12) v.push(one("earthquake", S.quake));
  if (level >= 18) v.push(one("sunder", S.sunder));
  if (level >= 8) {
    v.push(withSupport("h+s +cry", S.cry, { buffs: [S.cry] }));
    v.push(withSupport("h+s +leap gap", S.leap, { gap: true }));
    v.push(withSupport("h+s +blink", S.blink));
  }
  if (level >= 14) v.push(withSupport("h+s +determination", S.det, { buffs: [S.det] }));
  if (level >= 24) v.push(withSupport("h+s +blood rage", S.rage, { buffs: [S.rage] }));
  v.push(KIT);
  // One frozen kit for the whole matrix, so the skill is the only thing that moves.
  return v.map((x) => ({ ...x, gear: "magic", freezeGear: true }));
}

// ── Aggregation ─────────────────────────────────────────────────────────────

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: readonly number[]) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0; };
const med = (xs: readonly number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const sumBy = <T>(xs: readonly T[], g: (x: T) => number) => xs.reduce((a, x) => a + g(x), 0);
const tally = (rs: readonly IronRun[], pick: (r: IronRun) => Record<string, number>) => {
  const t: Record<string, number> = {};
  for (const r of rs) for (const [k, n] of Object.entries(pick(r))) t[k] = (t[k] ?? 0) + n;
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
};
const short = (id: string) => id.replace(/^(skill|monster)\./, "").replace(/\.v1$/, "");

const HEAD_A = "| variant | n (seeds x maps) | clear | clear s mean ± sd | median | kills/min | deaths/map | TTK normal / magic / rare / boss s | dmg taken/map | life/mana flasks per map | low-mana % | mana/min |";
const HEAD_B = "| variant | xp/min | lvl gain/map | magic / rare / unique / currency / stone per map | gold/map | casts/min by skill | top damage sources | death causes |";

function rowsFor(label: string, rs: readonly IronRun[], seedCount: number): { a: string; b: string } {
  const n = rs.length;
  const cleared = rs.filter((r) => r.cleared);
  const secs = cleared.map((r) => r.seconds);
  const minutes = sumBy(rs, (r) => r.seconds) / 60;
  const kills = sumBy(rs, (r) => r.kills.normal + r.kills.magic + r.kills.rare + r.kills.boss);
  const ttk = (k: "normal" | "magic" | "rare" | "boss") => f(mean(rs.flatMap((r) => r.ttk[k])), 2);
  const taken = tally(rs, (r) => r.taken);
  const takenAll = sumBy(taken, ([, v]) => v);
  const casts = tally(rs, (r) => r.casts).map(([k, v]) => `${short(k)} ${f(v / minutes, 1)}`).join(", ");
  const deaths = tally(rs, (r) => Object.fromEntries(r.killers.map((k) => [short(k.top), 1]))).map(([k, v]) => `${k} x${v}`).join(", ");
  const a = `| ${label} | ${n} (${seedCount}x${f(n / Math.max(1, seedCount), 1)}) | ${f((100 * cleared.length) / Math.max(1, n), 0)}% | ${f(mean(secs), 0)} ± ${f(sd(secs), 0)} | ${f(med(secs), 0)} | ${f(kills / minutes, 0)} | ${f(sumBy(rs, (r) => r.deaths) / n, 2)} | ${ttk("normal")} / ${ttk("magic")} / ${ttk("rare")} / ${ttk("boss")} | ${f(takenAll / n, 0)} | ${f(sumBy(rs, (r) => r.lifeFlasks) / n, 1)} / ${f(sumBy(rs, (r) => r.manaFlasks) / n, 1)} | ${f((100 * sumBy(rs, (r) => r.lowManaSeconds)) / (60 * minutes), 0)}% | ${f(sumBy(rs, (r) => r.manaSpent) / minutes, 0)} |`;
  const per = (k: keyof IronRun["drops"]) => f(sumBy(rs, (r) => r.drops[k]) / n, 2);
  const top = taken.slice(0, 3).map(([k, v]) => `${k || "(dead shooter)"} ${f((100 * v) / Math.max(1, takenAll), 0)}%`).join(", ");
  const b = `| ${label} | ${f(sumBy(rs, (r) => r.xpGained) / minutes, 0)} | ${f(sumBy(rs, (r) => r.levelEnd - r.levelStart) / n, 2)} | ${per("magic")} / ${per("rare")} / ${per("unique")} / ${per("currency")} / ${per("waystone")} | ${f(sumBy(rs, (r) => r.gold) / n, 0)} | ${casts} | ${top} | ${deaths || "none"} |`;
  return { a, b };
}

function table(title: string, groups: readonly { label: string; runs: IronRun[]; seeds: number }[]): string[] {
  const rows = groups.map((g) => rowsFor(g.label, g.runs, g.seeds));
  return [`### ${title}`, "", HEAD_A, HEAD_A.replace(/[^|]+/g, "---"), ...rows.map((r) => r.a), "", HEAD_B, HEAD_B.replace(/[^|]+/g, "---"), ...rows.map((r) => r.b), ""];
}

function write(name: string, md: string[], data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${name}.md`), [`# Ironsworn sweep: ${name}`, "", `Generated ${new Date().toISOString()}.`, "", ...md].join("\n") + "\n");
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(data));
}

async function labSuite(name: string, cells: readonly { level: number; tier: number; variants: Variant[] }[], nSeeds: number, maps: number): Promise<void> {
  const jobs: (Job & { cell: string })[] = cells.flatMap((c) => c.variants.flatMap((v) =>
    seeds(nSeeds, 1000).map((seed) => ({ variant: v, seed, maps, level: c.level, tier: c.tier, cell: `L${c.level} T${c.tier}` }))));
  const played = (await play(jobs)) as IronRun[][];
  const md: string[] = [];
  for (const c of cells) {
    const cell = `L${c.level} T${c.tier}`;
    md.push(...table(`${cell} (${nSeeds} seeds x ${maps} maps, seeds 1000-${1000 + nSeeds - 1})`, c.variants.map((v) => ({
      label: v.label, seeds: nSeeds, runs: played.filter((_, i) => jobs[i]!.cell === cell && jobs[i]!.variant.label === v.label).flat(),
    }))));
  }
  write(name, md, jobs.map((j, i) => ({ cell: j.cell, variant: j.variant.label, seed: j.seed, runs: played[i] })));
}

// ── Suites ──────────────────────────────────────────────────────────────────

describe.skipIf(SUITE === "")("Ironsworn balance sweep", () => {
  const on = (s: string) => SUITE === s || SUITE === "all";

  it.runIf(on("check"))("stock mode replays the harness map for map", async () => {
    const jobs: AnyJob[] = [
      ...seeds(3, 200).map((seed) => ({ harness: true as const, classId: "class.ironsworn", seed, maps: 3, level: 1, label: "h" })),
      ...seeds(3, 200).map((seed) => ({ variant: { label: "stock", stock: true, passives: "greedy" as const }, seed, maps: 3, level: 1 })),
    ];
    const r = await play(jobs);
    const h = (r.slice(0, 3) as MapRun[][]).flat();
    const m = (r.slice(3) as IronRun[][]).flat();
    const pairs = h.map((x, i) => `${x.node} ${x.seconds.toFixed(2)} ${x.kills} | ${m[i]?.node} ${m[i]?.seconds.toFixed(2)} ${m[i] ? sumBy([m[i]!], (y) => y.kills.normal + y.kills.magic + y.kills.rare + y.kills.boss) : "-"}`);
    write("check", ["harness | stock mode", "", ...pairs], { h, m });
    expect(m.map((x) => x.seconds)).toEqual(h.map((x) => x.seconds));
  }, 3_600_000);

  it.runIf(on("baseline"))("class-ratio baselines on the stock harness", async () => {
    const jobs: AnyJob[] = [
      ...CLASS_IDS.flatMap((c) => seeds(20, 100).map((seed) => ({ harness: true as const, classId: c, seed, maps: 1, level: 1, label: "L1 first map" }))),
      ...CLASS_IDS.flatMap((c) => seeds(30, 401).map((seed) => ({ harness: true as const, classId: c, seed, maps: 3, level: 10, label: "L10 three maps" }))),
      ...seeds(20, 100).map((seed) => ({ variant: KIT, seed, maps: 1, level: 1 })),
      ...seeds(30, 401).map((seed) => ({ variant: KIT, seed, maps: 3, level: 10 })),
    ];
    const r = await play(jobs);
    const md: string[] = ["| setting | class | maps | clear | deaths/map | mean clear s (cleared) | node-weighted mean s |", "|---|---|---|---|---|---|---|"];
    const out: Record<string, number> = {};
    for (const label of ["L1 first map", "L10 three maps"]) {
      const by = Object.fromEntries(CLASS_IDS.map((c) => [c, jobs.map((j, i) => ({ j, r: r[i] as MapRun[] }))
        .filter((x) => "harness" in x.j && x.j.harness && x.j.classId === c && x.j.label === label).flatMap((x) => x.r)]));
      const nodes = [...new Set(by[CLASS_IDS[0]]!.map((x) => x.node))].filter((n) => CLASS_IDS.every((c) => by[c]!.some((x) => x.node === n && x.cleared)));
      for (const c of CLASS_IDS) {
        const rs = by[c]!;
        const cl = rs.filter((x) => x.cleared);
        const nodeMean = mean(nodes.map((n) => mean(rs.filter((x) => x.node === n && x.cleared).map((x) => x.seconds))));
        out[`${label}|${c}`] = nodeMean;
        md.push(`| ${label} | ${c} | ${rs.length} | ${f((100 * cl.length) / rs.length, 0)}% | ${f(sumBy(rs, (x) => x.deaths) / rs.length, 2)} | ${f(mean(cl.map((x) => x.seconds)), 1)} | ${f(nodeMean, 1)} |`);
      }
      const t = CLASS_IDS.map((c) => out[`${label}|${c}`]!);
      md.push(`| ${label} | max/min ratio | | | | | ${f(Math.max(...t) / Math.min(...t), 3)} |`);
    }
    const kitL1 = (r.slice(jobs.length - 50, jobs.length - 30) as IronRun[][]).flat();
    const kitL10 = (r.slice(jobs.length - 30) as IronRun[][]).flat();
    md.push("", ...table("Ironsworn pilot kit on the same seeds (L1 seeds 100-119 one map; L10 seeds 401-430 three maps)", [
      { label: "kit L1 first map", runs: kitL1, seeds: 20 }, { label: "kit L10 three maps", runs: kitL10, seeds: 30 },
    ]));
    write("baseline", md, { jobs, r });
  }, 7_200_000);

  it.runIf(on("natural"))("fifteen-map campaigns from level 1", async () => {
    const variants: Variant[] = [
      { label: "stock bot", stock: true, passives: "greedy" },
      { ...KIT, label: "kit, iron refit" },
      { ...KIT, label: "kit, iron refit + shop/craft", shop: true },
      { ...KIT, label: "kit, offense passives + shop/craft", shop: true, passives: "offense" },
      { ...KIT, label: "kit, defense passives + shop/craft", shop: true, passives: "defense" },
    ];
    const N = 6, MAPS = 15;
    const jobs: Job[] = variants.flatMap((v) => seeds(N, 500).map((seed) => ({ variant: v, seed, maps: MAPS, level: 1 })));
    const played = (await play(jobs)) as IronRun[][];
    const md: string[] = [];
    for (const v of variants) {
      const camp = played.filter((_, i) => jobs[i]!.variant.label === v.label);
      md.push(...table(`${v.label}: whole campaign (${N} seeds x up to ${MAPS} maps, seeds 500-${500 + N - 1})`, [{ label: v.label, runs: camp.flat(), seeds: N }]));
      md.push(`| map | tiers | level after (mean) | clear | clear s | deaths | max life | armour | dmg% | weapon (seed 500) |`, "|---|---|---|---|---|---|---|---|---|---|");
      for (let i = 0; i < MAPS; i++) {
        const at = camp.map((c) => c[i]).filter((x): x is IronRun => !!x);
        if (at.length === 0) continue;
        const cl = at.filter((x) => x.cleared);
        md.push(`| ${i + 1} | ${[...new Set(at.map((x) => x.tier))].sort((a, b) => a - b).join("/")} | ${f(mean(at.map((x) => x.levelEnd)), 1)} | ${cl.length}/${at.length} | ${f(mean(cl.map((x) => x.seconds)), 0)} | ${sumBy(at, (x) => x.deaths)} | ${f(mean(at.map((x) => x.sheet.maxLife)), 0)} | ${f(mean(at.map((x) => x.sheet.armour)), 0)} | ${f(mean(at.map((x) => x.sheet.damagePct)), 0)} | ${camp[0]?.[i]?.sheet.weapon ?? "-"} |`);
      }
      const shop = camp.flat().filter((x) => x.shop);
      if (shop.length) md.push("", `Shop per map: sold ${f(mean(shop.map((x) => x.shop!.sold)), 1)}, bought ${f(mean(shop.map((x) => x.shop!.bought)), 2)}, gold spent ${f(mean(shop.map((x) => x.shop!.goldSpent)), 0)}, orbs used ${f(mean(shop.map((x) => x.shop!.orbsUsed)), 2)}, identified ${f(mean(shop.map((x) => x.shop!.identified)), 1)}.`);
      md.push("", `Uniques found: ${tally(camp.flat(), (x) => x.uniques).map(([k, n]) => `${k} x${n}`).join(", ") || "none"}. Currency found: ${tally(camp.flat(), (x) => x.currency).map(([k, n]) => `${k.replace("currency.", "")} ${n}`).join(", ")}.`, "");
    }
    write("natural", md, jobs.map((j, i) => ({ variant: j.variant.label, seed: j.seed, runs: played[i] })));
  }, 7_200_000);

  it.runIf(on("skills"))("every skill as the main one, per lab level", async () => {
    await labSuite("skills", LAB.map((c) => ({ ...c, variants: skillVariants(c.level) })), 8, 3);
  }, 7_200_000);

  it.runIf(on("passives"))("passive builds", async () => {
    const builds = (["none", "greedy", "offense", "defense"] as const).map((p) => ({ ...KIT, label: `kit, ${p}`, passives: p, gear: "magic" as const, freezeGear: true }));
    await labSuite("passives", [{ level: 14, tier: 3, variants: builds }, { level: 26, tier: 5, variants: builds }, { level: 44, tier: 8, variants: builds }], 8, 3);
  }, 7_200_000);

  it.runIf(on("gear"))("gear tiers", async () => {
    const tiers = (["starter", "magic", "rare", "unique"] as const).map((t) => ({ ...KIT, label: `kit, ${t} gear`, gear: t, freezeGear: true }));
    await labSuite("gear", [{ level: 14, tier: 3, variants: tiers }, { level: 26, tier: 5, variants: tiers }, { level: 44, tier: 8, variants: tiers }], 8, 3);
  }, 7_200_000);
});
