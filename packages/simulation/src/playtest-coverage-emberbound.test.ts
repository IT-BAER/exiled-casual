import { describe, expect, it } from "vitest";
import { fork } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PASSIVE_TREE } from "@exiled/rules";
import { SK, benchSkill, keystoneCost, EMBER, type BenchRow, type Build, type EmberRun, type Job, type Policy } from "./playtest-emberbound";
import {
  benchTable, campaignTable, nodeWeightedClear, paceTable, resourceTable, skillTable, stats, type Group,
} from "./playtest-emberbound-report";

/**
 * The Emberbound balance matrix (docs/todo/playtest/balance-emberbound-2026-11-04.md):
 * every skill as the main skill, every passive theme and keystone, every gear tier, the
 * vendor, and the natural climb from level 1. Measured, never tuned.
 *
 * `PLAYTEST=emberbound` runs it; `EMBER_SECTIONS=a,b` picks sections (default all,
 * `report` only rebuilds the tables). Each result is appended to
 * review/balance-emberbound/<section>.jsonl as it lands, so a stopped run keeps what it
 * played, and children run at below-normal priority beside the other sessions.
 */
const OUT = resolve(__dirname, "../../../review/balance-emberbound");
const PROCS = Number(process.env["EMBER_PROCS"] ?? 3);
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

// ── Policies ────────────────────────────────────────────────────────────────

const P: Record<string, Policy> = {
  stock: { stock: true },
  stockNoBlink: { stock: true, without: [SK.blink] },
  spark: { main: [] },
  bolt: { main: [SK.bolt] },
  nova: { main: [SK.nova], walkIn: true },
  cinder: { main: [SK.cinder] },
  orb: { main: [SK.orb] },
  storm: { main: [SK.storm] },
  dash: { main: [SK.dash], dashAttack: true },
  boltBlink: { main: [SK.bolt], blinkTravel: true },
  boltDash: { main: [SK.bolt], dash: true },
  boltNoBlink: { main: [SK.bolt], blink: false },
  boltHex: { main: [SK.bolt], hex: true },
  boltHerald: { main: [SK.bolt], herald: true },
  boltHexHerald: { main: [SK.bolt], hex: true, herald: true },
  /** Six skills and the free attack: what a level-24 bar holds. */
  full: { main: [SK.bolt], aoe: [SK.storm, SK.orb, SK.cinder], hex: true, herald: true, blink: false },
  /** The natural climb: the bar re-picked at every map from what has unlocked. */
  climb: {
    priority: [SK.bolt, SK.cinder, SK.storm, SK.orb, SK.hex, SK.herald, SK.nova, SK.blink],
    main: [SK.bolt, SK.nova], aoe: [SK.storm, SK.orb, SK.cinder], hex: true, herald: true, dash: false,
  },
};

const ks = (name: string) => PASSIVE_TREE.find((n) => n.kind === "keystone" && n.name === name)!.id;
const BUILDS: Build[] = [
  { label: "bot default" },
  { label: "none", none: true },
  { label: "spell", weights: { spellDamagePct: 1 } },
  { label: "cast", weights: { castSpeedPct: 1 } },
  { label: "crit", weights: { critChancePct: 1 } },
  { label: "life", weights: { maxLife: 1, strength: 2 } },
  { label: "armour", weights: { armour: 1, armourPct: 2 } },
  { label: "ward", weights: { energyShield: 1, energyShieldPct: 1 } },
  { label: "mana", weights: { maxMana: 1, manaRegenPct: 1 } },
  { label: "res", weights: { fireResPct: 1, coldResPct: 1, lightningResPct: 1, chaosResPct: 1 } },
  { label: "Pyre Oath + spell", keystone: ks("Pyre Oath"), weights: { spellDamagePct: 1 } },
  { label: "Ashen Heart + spell", keystone: ks("Ashen Heart"), weights: { spellDamagePct: 1 } },
  { label: "Overflow + cast", keystone: ks("Overflow"), weights: { castSpeedPct: 1 } },
  { label: "Live Wire + crit", keystone: ks("Live Wire"), weights: { critChancePct: 1 } },
  { label: "Glass Ward + ward", keystone: ks("Glass Ward"), weights: { energyShield: 1, energyShieldPct: 1 } },
  { label: "Hearthbound + res", keystone: ks("Hearthbound"), weights: { fireResPct: 1, coldResPct: 1, lightningResPct: 1, chaosResPct: 1 } },
  { label: "Rooted + armour", keystone: ks("Rooted"), weights: { armour: 1, armourPct: 2 } },
  { label: "Iron Skin + armour", keystone: ks("Iron Skin"), weights: { armour: 1, armourPct: 2 } },
];

// ── The matrix ──────────────────────────────────────────────────────────────

type Task = { section: string; job?: Job; bench?: Parameters<typeof benchSkill>[] };

function matrix(): Task[] {
  const t: Task[] = [];
  const add = (section: string, variant: string, seeds: number[], base: Omit<Job, "variant" | "seed">) => {
    for (const seed of seeds) t.push({ section, job: { ...base, variant, seed } });
  };
  // Sized for a machine shared with two sibling matrices (about 5 maps a minute): five seeds
  // per variant, Emberbound-only parity (the Stalker report runs all three classes).
  const S = (from: number) => range(from, 5);
  // The climb from level 1 on dropped stones and dropped gear. First: its jobs are the longest.
  for (const [v, pol, vendor] of [["stock", "stock", false], ["climb", "climb", false], ["climb + vendor", "climb", true]] as const) {
    add("climb", v, S(500), { maps: 15, level: 1, policy: P[pol]!, vendor, stopAfterFails: 3 });
  }
  // Parity: the jobs of playtest.test.ts (fresh character, first map, seeds 1-10) and
  // playtest-level10.test.ts (level 10, three maps, seeds 401-430).
  add("parity", `${EMBER} first map`, range(1, 10), { maps: 1, level: 1, policy: P["stock"]! });
  add("parity", `${EMBER} level 10`, range(401, 30), { maps: 3, level: 10, policy: P["stock"]! });
  add("parity", "emberbound first map novice", range(1, 10), { maps: 1, level: 1, policy: P["stock"]!, novice: true });
  // Every skill as the lead, early (level 10, tier 2, starting gear) and late (24, tier 5, magic).
  for (const v of ["stock", "stockNoBlink", "spark", "bolt", "nova", "cinder", "dash", "boltDash", "boltBlink", "boltNoBlink"]) {
    add("skills10", v, S(600), { maps: 2, level: 10, tier: 2, gear: "start", policy: P[v]! });
  }
  for (const v of ["stock", "spark", "bolt", "nova", "cinder", "orb", "storm", "dash", "boltDash", "boltBlink", "boltHex", "boltHerald", "boltHexHerald", "full"]) {
    add("skills24", v, S(700), { maps: 2, level: 24, tier: 5, gear: "magic", policy: P[v]! });
  }
  for (const gear of ["start", "normal", "magic", "rare", "unique"] as const) {
    add("gear", `L10 T2 stock, ${gear}`, S(900), { maps: 2, level: 10, tier: 2, gear, policy: P["stock"]! });
    add("gear", `L24 T5 full, ${gear}`, S(900), { maps: 2, level: 24, tier: 5, gear, policy: P["full"]! });
  }
  for (const b of BUILDS) {
    add("passives", b.label, S(800), { maps: 2, level: 24, tier: 5, gear: "magic", policy: P["full"]!, build: b });
  }
  // The tier ladder: on-level character (area level + 2), rare gear, the full bar.
  for (const tier of range(1, 15)) {
    const level = Math.min(100, Math.max(10, 2 + 6 * (tier - 1) + 2));
    add("ladder", `tier ${tier} (level ${level})`, range(1000, 3), { maps: 2, level, tier, gear: "rare", policy: level >= 24 ? P["full"]! : P["climb"]!, stopAfterFails: 1 });
  }
  const benches: Parameters<typeof benchSkill>[] = [];
  for (const skill of [SK.spark, SK.bolt, SK.nova, SK.cinder, SK.orb, SK.storm, SK.dash]) {
    for (const gem of [1, 10, 20]) for (const n of [1, 5]) benches.push([skill, gem, n]);
  }
  for (const gem of [1, 10, 20]) for (const n of [1, 5]) {
    benches.push([SK.bolt, gem, n, "hex"], [SK.bolt, gem, n, "herald"], [SK.storm, gem, n, "hex"]);
  }
  return [...benches.map((b) => ({ section: "bench", bench: [b] })), ...t];
}

// ── The pool ────────────────────────────────────────────────────────────────

function play(tasks: Task[], onResult: (task: Task, out: unknown) => void): Promise<void> {
  const script = fileURLToPath(new URL("./playtest-emberbound-fork.mjs", import.meta.url));
  let next = 0;
  let done = 0;
  return new Promise((ok, fail) => {
    if (tasks.length === 0) return ok();
    for (let p = 0; p < Math.min(PROCS, tasks.length); p++) {
      const child = fork(script, [], { execArgv: ["--experimental-transform-types", "--no-warnings"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
      try { setPriority(child.pid!, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not ours to lower */ }
      child.on("message", (m: { id?: number; out?: unknown }) => {
        if (m.out !== undefined) {
          onResult(tasks[m.id!]!, m.out);
          if (++done === tasks.length) ok();
        }
        if (next < tasks.length) { const id = next++; child.send({ id, job: tasks[id]!.job, bench: tasks[id]!.bench }); }
        else child.disconnect();
      });
      child.on("error", fail);
      child.on("exit", (code) => { if (code !== 0) fail(new Error(`emberbound child exited with ${code}`)); });
    }
  });
}

function load<T>(section: string): T[] {
  const file = resolve(OUT, `${section}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

// ── The tables ──────────────────────────────────────────────────────────────

function report(): string[] {
  const runs = (s: string) => load<EmberRun[]>(s).flat();
  const groups = (rs: EmberRun[], order?: string[]): Group[] => {
    const labels = order ?? [...new Set(rs.map((r) => r.variant))];
    return labels.map((label) => ({ label, runs: rs.filter((r) => r.variant === label) })).filter((g) => g.runs.length > 0);
  };
  const lines: string[] = [`# Emberbound coverage tables`, "", `Generated ${new Date().toISOString()}.`, ""];
  const section = (title: string, gs: Group[]) => {
    if (!gs.length) return;
    lines.push(`## ${title}`, "", ...paceTable(gs), "", ...resourceTable(gs), "", ...skillTable(gs), "");
  };
  // Ironsworn and Stalker parity rows come from the first, stopped run (same code, same jobs).
  const parity = [...runs("parity"), ...runs("parity-partial-run1").filter((r) => !r.variant.startsWith(EMBER))];
  section("Parity (stock bot, the jobs of playtest.test.ts and playtest-level10.test.ts)", groups(parity));
  const classes = ["class.ironsworn", "class.stalker", EMBER];
  const first = classes.map((c) => stats(parity.filter((r) => r.variant === `${c} first map`)).clearSec);
  const l10 = nodeWeightedClear(classes.map((c) => ({ label: c, runs: parity.filter((r) => r.variant === `${c} level 10`) })).filter((g) => g.runs.length));
  if (first.every(Number.isFinite)) {
    lines.push(`Class clear-time ratio, first map (max/min of class means): ${(Math.max(...first) / Math.min(...first)).toFixed(3)} (ironsworn ${first[0]!.toFixed(1)} s, stalker ${first[1]!.toFixed(1)} s, emberbound ${first[2]!.toFixed(1)} s).`, "");
  }
  if (l10.length === 3 && l10.every(Number.isFinite)) {
    lines.push(`Class clear-time ratio, level 10 (node-weighted, max/min): ${(Math.max(...l10) / Math.min(...l10)).toFixed(3)} (ironsworn ${l10[0]!.toFixed(1)} s, stalker ${l10[1]!.toFixed(1)} s, emberbound ${l10[2]!.toFixed(1)} s).`, "");
  }
  const climb = runs("climb");
  section("Climb from level 1 (15 maps max, dropped stones and gear, stop after 3 failed maps)", groups(climb));
  for (const v of [...new Set(climb.map((r) => r.variant))]) lines.push(...campaignTable(v, climb.filter((r) => r.variant === v)), "");
  section("Skills, level 10, tier 2, starting gear", groups(runs("skills10")));
  section("Skills, level 24, tier 5, magic loadout", groups(runs("skills24")));
  section("Passive builds, level 24 (23 points), tier 5, magic loadout, full bar", groups(runs("passives"), BUILDS.map((b) => b.label)));
  const pass = runs("passives");
  if (pass.length) {
    lines.push("| build | max life | max mana | ES | armour | fire/cold/light/chaos res | spell dmg % | cast speed % | crit % | points |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const b of BUILDS) {
      const r = pass.find((x) => x.variant === b.label && x.map === 2) ?? pass.find((x) => x.variant === b.label);
      if (!r) continue;
      const s = r.stats;
      lines.push(`| ${b.label} | ${s.maxLife.toFixed(0)} | ${s.maxMana.toFixed(0)} | ${s.es.toFixed(0)} | ${s.armour.toFixed(0)} | ${["fire", "cold", "lightning", "chaos"].map((k) => s.res[k] ?? 0).join("/")} | ${s.spellDamagePct} | ${s.castSpeedPct} | ${s.critChancePct} | ${r.passives} |`);
    }
    lines.push("", "Keystone cost from the Emberbound door (points, shortest legal route): "
      + PASSIVE_TREE.filter((n) => n.kind === "keystone").map((n) => `${n.name} ${keystoneCost(EMBER, n.id)}`).join(", ") + ".", "");
  }
  section("Gear tiers", groups(runs("gear")));
  const gear = runs("gear");
  if (gear.length) {
    lines.push("| loadout | max life | max mana | ES | armour | fire/cold/light/chaos res | spell dmg % | cast speed % | crit % |", "|---|---|---|---|---|---|---|---|---|");
    for (const v of [...new Set(gear.map((r) => r.variant))]) {
      const rs = gear.filter((r) => r.variant === v && r.map === 1);
      const m = (pick: (s: EmberRun["stats"]) => number) => (rs.reduce((a, r) => a + pick(r.stats), 0) / (rs.length || 1)).toFixed(0);
      lines.push(`| ${v} | ${m((s) => s.maxLife)} | ${m((s) => s.maxMana)} | ${m((s) => s.es)} | ${m((s) => s.armour)} | ${["fire", "cold", "lightning", "chaos"].map((k) => m((s) => s.res[k] ?? 0)).join("/")} | ${m((s) => s.spellDamagePct)} | ${m((s) => s.castSpeedPct)} | ${m((s) => s.critChancePct)} |`);
    }
    lines.push("");
  }
  section("Tier ladder (on-level character, rare loadout)", groups(runs("ladder")));
  const order = Object.values(SK) as string[];
  const bench = load<BenchRow[]>("bench").flat()
    .sort((a, b) => a.extra.localeCompare(b.extra) || order.indexOf(a.skill) - order.indexOf(b.skill) || a.targets - b.targets || a.gem - b.gem);
  if (bench.length) lines.push("## Bench (inert dummies healed every tick, mana refilled, 20 s)", "", ...benchTable(bench), "");
  return lines;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("emberbound coverage bot", () => {
  // Cheap and always on: the coverage harness can make every damaging Emberbound skill land.
  it.each([SK.spark, SK.bolt, SK.nova, SK.cinder, SK.orb, SK.storm, SK.dash])("%s lands on the bench", (skill) => {
    const row = benchSkill(skill, 1, 1, "", 4);
    expect(row.casts).toBeGreaterThan(0);
    expect(row.dps).toBeGreaterThan(0);
  });
});

describe.skipIf(process.env["PLAYTEST"] !== "emberbound")("emberbound coverage matrix", () => {
  it("plays the matrix and writes review/balance-emberbound/", async () => {
    try { setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not ours to lower */ }
    mkdirSync(OUT, { recursive: true });
    const want = (process.env["EMBER_SECTIONS"] ?? "").split(",").filter(Boolean);
    const tasks = matrix().filter((t) => want.length === 0 || want.includes(t.section));
    for (const s of new Set(tasks.map((t) => t.section))) writeFileSync(resolve(OUT, `${s}.jsonl`), "");
    await play(tasks, (task, out) => appendFileSync(resolve(OUT, `${task.section}.jsonl`), JSON.stringify(out) + "\n"));
    writeFileSync(resolve(OUT, "tables.md"), report().join("\n") + "\n");
  }, 8 * 60 * 60 * 1000);
});
