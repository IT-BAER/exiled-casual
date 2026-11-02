// Frame times of every player skill in the skill lab, and of all three auras running at once.
// Usage: node tools/skill-lab/perf.mjs [--class ironsworn|stalker|emberbound]... [--skill <id-part>]... [--passes N] [--out <file>]
// Vsync and the frame cap are off, so a frame's time is its cost, not the display's 16.7 ms.
// Writes review/perf/<stamp>.json and prints one line per measurement.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { BASE, ROOT, sleep, startVite, stopVite } from "./lib.mjs";

const CLASSES = ["ironsworn", "stalker", "emberbound"];
const AURAS = ["skill.determination.v1", "skill.haste.v1", "skill.herald_of_ash.v1"];
const SKIP = new Set(["town_portal", "move"]);
/** Long enough for the slowest skill's last impact to land and fade. */
const WINDOW_MS = 3500;

const args = process.argv.slice(2);
const pick = (flag) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));
const classes = pick("--class").length ? pick("--class") : CLASSES;
const only = pick("--skill");
/** A second pass casts every skill again in the same page: what is left is not first-use cost. */
const passes = Number(pick("--passes")[0] ?? 1);
const out = pick("--out")[0] ?? path.join(ROOT, "review", "perf", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

/** In the page: rAF deltas and render CPU time over `ms`, firing `cast` (if any) on the first frame. */
function measure([ms, cast]) {
  const scene = window.__scene;
  const frames = [];
  const cpu = [];
  let t;
  const before = scene.onBeforeRenderObservable.add(() => { t = performance.now(); });
  const after = scene.onAfterRenderObservable.add(() => { if (t !== undefined) cpu.push(performance.now() - t); });
  let active = 0, particles = 0, lights = 0, meshes = 0;
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      active = Math.max(active, scene.getActiveMeshes().length);
      particles = Math.max(particles, scene.particleSystems.length);
      lights = Math.max(lights, scene.lights.filter((l) => l.isEnabled()).length);
      meshes = Math.max(meshes, scene.meshes.length);
      if (now - t0 < ms) requestAnimationFrame(tick);
      else {
        scene.onBeforeRenderObservable.remove(before);
        scene.onAfterRenderObservable.remove(after);
        resolve({ frames: frames.slice(1), cpu, active, particles, lights, meshes });
      }
    };
    requestAnimationFrame(tick);
    if (cast) { window.__dev.refill(); window.__dev.cast(cast); }
  });
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function stat(label, m) {
  const r = {
    label, n: m.frames.length,
    fps: 1000 / mean(m.frames), p50: pct(m.frames, 0.5), p95: pct(m.frames, 0.95), p99: pct(m.frames, 0.99), max: Math.max(...m.frames),
    cpu50: pct(m.cpu, 0.5), cpu95: pct(m.cpu, 0.95), active: m.active, particles: m.particles, lights: m.lights, meshes: m.meshes,
  };
  const f = (x) => x.toFixed(1).padStart(6);
  console.log(`${label.padEnd(32)} fps ${f(r.fps)}  p50 ${f(r.p50)}  p95 ${f(r.p95)}  p99 ${f(r.p99)}  max ${f(r.max)}  cpu50 ${f(r.cpu50)}  cpu95 ${f(r.cpu95)}  active ${r.active} ps ${r.particles} lights ${r.lights}`);
  return r;
}

const vite = await startVite();
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
const results = [];
try {
  for (const cls of classes) {
    await page.goto(`${BASE}?play&lab&class=class.${cls}&control=mouse&volume=0`);
    await page.waitForFunction(() => window.__lab?.ready === true && window.__scene, null, { timeout: 120000 });
    await sleep(5000);
    if (!results.length) console.log("graphics:", await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => /setting|graphic/i.test(k))))));
    await page.evaluate(() => window.__dev.home());
    await sleep(1000);
    results.push({ cls, ...stat(`${cls}: idle`, await page.evaluate(measure, [2000, null])) });
    const ids = await page.evaluate(() => (window.__snap?.skills ?? []).map((s) => s.id));
    for (let pass = 1; pass <= passes; pass++) for (const id of ids) {
      const short = id.replace(/^skill\./, "").replace(/\.v\d+$/, "");
      if (SKIP.has(short) || AURAS.includes(id) || (only.length && !only.some((o) => short.includes(o)))) continue;
      await page.evaluate(() => window.__dev.home());
      await sleep(800);
      results.push({ cls, pass, ...stat(`${cls}: ${short}${passes > 1 ? ` #${pass}` : ""}`, await page.evaluate(measure, [WINDOW_MS, id])) });
    }
  }
  if (!only.length || only.some((o) => "auras".includes(o))) {
    // All three auras on one character, steady and then over a pack dying under the herald.
    await page.evaluate(() => window.__dev.home());
    await sleep(800);
    for (const a of AURAS) { await page.evaluate((s) => { window.__dev.refill(); window.__dev.cast(s); }, a); await sleep(1200); }
    const on = await page.evaluate(() => (window.__snap?.player.buffs ?? []).filter((b) => b.aura).map((b) => b.id));
    console.log("auras on:", on.join(", "));
    results.push({ cls: "all", auras: on, ...stat("three auras: steady", await page.evaluate(measure, [3000, null])) });
    await page.evaluate(() => { window.__dev.clear(); window.__dev.spawn("pack"); });
    await sleep(1200);
    results.push({ cls: "all", auras: on, ...stat("three auras: pack + nova", await page.evaluate(measure, [WINDOW_MS, "skill.ember_nova.v1"])) });
  }
  await page.goto(BASE); // park on the menu: map scenes hold memory
} finally {
  await browser.close();
  await stopVite(vite);
}
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`wrote ${out}`);
