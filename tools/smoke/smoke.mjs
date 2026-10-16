// Headless smoke: start the Vite dev server, create a character, load a map
// with the bot harness on SwiftShader, assert the simulation runs clean.
// Usage: node tools/smoke/smoke.mjs [--node <id>] [--nodes all]
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(ROOT, "smoke-out");
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS ?? 30000);
const SAMPLE_GAP_MS = 10000;
const VIEWPORT = { width: 1280, height: 720 };

// Mirrors NODE_NAMES in packages/rules/src/atlas.ts (ids: lowercased, non-alphanumerics -> _).
const NODE_NAMES = [
  "The Wrackline", "Emberfall", "Cinder Vault", "Blackmire", "Sunken Chapel",
  "Ossuary Steps", "Rustwater", "The Pale Reach", "Kiln of Ash", "Thornwake",
  "Gallowsmoor", "Vault of Cinders", "Hollowbriar", "Gullscour", "Bonestrand",
];
const nodeId = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

function parseArgs(argv) {
  const args = { node: "the_wrackline", all: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--node") args.node = argv[++i];
    else if (argv[i] === "--nodes" && argv[++i] === "all") args.all = true;
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`vite did not answer 200 on ${url} within ${timeoutMs} ms`);
}

function startVite() {
  const viteJs = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteJs, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: path.join(ROOT, "apps", "web"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  return child;
}

async function assertPortFree(url) {
  const up = await fetch(url).then(() => true, () => false);
  if (up) throw new Error(`something already answers on ${url}; stop it before running the smoke`);
}

function killVite(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.on("exit", resolve);
    child.kill("SIGTERM");
  });
}

const readSnap = () =>
  // eslint-disable-next-line no-undef
  ({ area: window.__snap?.area ?? null, tick: window.__snap?.tick ?? null, entities: window.__snap?.entities?.length ?? null });

async function runNode(browser, node) {
  const t0 = Date.now();
  const timings = {};
  const log = [];
  const errors = { console: 0, page: 0, request: 0 };
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.console++;
    if (["error", "warning"].includes(m.type())) log.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => { errors.page++; log.push(`[pageerror] ${String(e).slice(0, 300)}`); });
  page.on("requestfailed", (r) => {
    const text = r.failure()?.errorText ?? "";
    if (text !== "net::ERR_ABORTED") errors.request++;
    log.push(`[reqfail] ${r.url()} ${text}`);
  });

  // DEV-only harness params (apps/web/src/App.tsx, GameView.tsx): ?play creates a character
  // when the roster is empty, &control answers the controls dialog, &bot&map walks into the node.
  await page.goto(`${BASE}?play&bot&map=${node}&control=mouse`, { waitUntil: "load", timeout: 60000 });
  const inMap = await page
    .waitForFunction(() => window.__snap?.area === "map", null, { timeout: 180000, polling: 1000 })
    .then(() => true, () => false);
  timings.mapReachedMs = Date.now() - t0;
  timings.mapReached = inMap;
  await page.waitForTimeout(SETTLE_MS);
  timings.settledMs = Date.now() - t0;

  const dialogOpen = await page.getByTestId("controls-dialog").isVisible().catch(() => false);
  const snap1 = await page.evaluate(readSnap);
  // On SwiftShader the compositor frame the capture needs can take well over 30 s,
  // so the Playwright default timeout is too short.
  const tShot = Date.now();
  await page.screenshot({ path: path.join(OUT, `${node}.png`), timeout: 120000 });
  timings.screenshotMs = Date.now() - tShot;
  await page.waitForTimeout(SAMPLE_GAP_MS);
  const snap2 = await page.evaluate(readSnap);
  timings.totalMs = Date.now() - t0;
  await ctx.close();

  const reasons = [];
  if (dialogOpen) reasons.push("controls dialog is open; &control=mouse should have answered it");
  if (snap1.area !== "map") reasons.push(`area is ${JSON.stringify(snap1.area)}, expected "map"`);
  if (!(typeof snap1.tick === "number" && typeof snap2.tick === "number" && snap2.tick > snap1.tick))
    reasons.push(`tick did not advance (${snap1.tick} -> ${snap2.tick})`);
  if (errors.console) reasons.push(`${errors.console} console error(s)`);
  if (errors.page) reasons.push(`${errors.page} page error(s)`);
  if (errors.request) reasons.push(`${errors.request} failed request(s) other than net::ERR_ABORTED`);

  const result = { node, ok: reasons.length === 0, reasons, settleMs: SETTLE_MS, viewport: VIEWPORT, snap1, snap2, errors, timings, log };
  await writeFile(path.join(OUT, `${node}.json`), JSON.stringify(result, null, 2));
  console.log(`[smoke] ${node}: ${result.ok ? "ok" : "FAIL"} ${JSON.stringify({ snap1, snap2, errors, timings })}`);
  for (const r of reasons) console.log(`[smoke]   - ${r}`);
  return result;
}

const args = parseArgs(process.argv.slice(2));
const nodes = args.all ? NODE_NAMES.map(nodeId) : [args.node];
await mkdir(OUT, { recursive: true });
let vite;
let failed = false;
try {
  await assertPortFree(BASE);
  vite = startVite();
  await waitForServer(BASE, 60000);
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    for (const node of nodes) {
      const r = await runNode(browser, node);
      if (!r.ok) failed = true;
    }
  } finally {
    await browser.close();
  }
} catch (e) {
  failed = true;
  console.error(`[smoke] error: ${e?.stack ?? e}`);
} finally {
  await killVite(vite);
}
process.exit(failed ? 1 : 0);
