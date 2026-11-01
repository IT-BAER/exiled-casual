// Shared plumbing for the skill-lab captures: a private Vite on a spare port,
// headless Chromium on the real GPU, and ffmpeg contact sheets.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PORT = Number(process.env.LAB_PORT ?? 5198);
export const BASE = `http://127.0.0.1:${PORT}/`;
export const VIEWPORT = { width: 1280, height: 720 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts Vite on PORT, refusing to run beside anything already answering there. */
export async function startVite() {
  if (await fetch(BASE).then(() => true, () => false)) throw new Error(`${BASE} already answers; stop it first`);
  const viteJs = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteJs, "--config", path.join(ROOT, "tools", "skill-lab", "vite.lab.config.ts"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: path.join(ROOT, "apps", "web"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (await fetch(BASE).then((r) => r.status === 200, () => false)) return child;
    await sleep(500);
  }
  child.kill();
  throw new Error("vite did not come up within 60 s");
}

export function stopVite(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.on("exit", resolve);
    child.kill("SIGTERM");
  });
}

/** Headless Chromium on the GPU (ANGLE d3d11), never SwiftShader: SwiftShader saturates the CPU. */
export async function launch() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
  return { browser, page };
}

export async function saveDataUrl(file, dataUrl) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
}

/**
 * Tiles the numbered frames `dir/000.<ext>`.. into `out`, `cols` x `rows`, each `w` px wide.
 * A numbered sequence rather than a glob: the Windows ffmpeg build has no glob input.
 */
export function contactSheet(dir, ext, out, cols, rows, w = 320) {
  const r = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-start_number", "0", "-i", path.join(dir, `%03d.${ext}`),
    "-vf", `scale=${w}:-1,tile=${cols}x${rows}:padding=4:color=black`, "-frames:v", "1", out,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

/**
 * One sheet per skill: at most 24 tiles, every n-th frame, 4 across, each the
 * upper-right 80% of the frame (the player and the dummy arc ahead of him) so the effect is big enough to judge.
 */
export function sheet(dir, n, out) {
  const step = Math.max(1, Math.ceil(n / 24));
  const tiles = Math.ceil(n / step);
  const r = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-start_number", "0", "-i", path.join(dir, "%03d.jpg"),
    "-vf", `select=not(mod(n\\,${step})),crop=iw*0.8:ih*0.8:iw*0.15:ih*0.0,scale=560:-1,` +
      `drawtext=fontfile=arial.ttf:text='%{n}':x=6:y=6:fontsize=20:fontcolor=white,tile=4x${Math.ceil(tiles / 4)}:padding=4:color=black`,
    "-frames:v", "1", "-fps_mode", "passthrough", out,
  // Run from the fonts folder: a drive letter's colon cannot be escaped through a template literal and the filter parser both.
  ], { cwd: "C:/Windows/Fonts" });
  if (r.status !== 0) console.error(`sheet ${out}: ${r.stderr}`);
}
