// Contact sheets of every VFX kit primitive, sampled over one period in the asset viewer.
// Usage: node tools/skill-lab/kit-sheet.mjs [name ...]   -> review/kit/<name>.jpg
import path from "node:path";
import { rm } from "node:fs/promises";
import { BASE, ROOT, contactSheet, launch, saveDataUrl, sleep, startVite, stopVite } from "./lib.mjs";

const FRAMES = 16;
const OUT = path.join(ROOT, "review", "kit");

const vite = await startVite();
const { browser, page } = await launch();
try {
  await page.goto(`${BASE}?viewer&camera=game&light=game`);
  await page.waitForFunction(() => window.__viewerScene !== undefined, null, { timeout: 60000 });
  await sleep(3000);
  // The viewer frames the body; a skill effect reaches several metres past it.
  await page.evaluate(() => { window.__viewer.camera.radius *= 2.6; });
  const all = await page.evaluate(async () => (await import("/src/render/skills/kit/preview.ts")).KIT_PREVIEWS.map((p) => [p.name, p.period]));
  const want = process.argv.slice(2);
  for (const [name, period] of all.filter(([n]) => want.length === 0 || want.includes(n))) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    const ok = await page.evaluate((n) => window.__viewerScene.fireKit(n), name);
    if (!ok) { console.error(`${name}: fireKit refused`); continue; }
    const t0 = Date.now();
    for (let i = 0; i < FRAMES; i++) {
      const wait = t0 + (i * period * 1000) / FRAMES - Date.now();
      if (wait > 0) await sleep(wait);
      const url = await page.evaluate(() => window.__viewerScene.capture());
      await saveDataUrl(path.join(dir, `${String(i).padStart(3, "0")}.png`), url);
    }
    contactSheet(dir, "png", path.join(OUT, `${name}.jpg`), 4, 4, 400);
    console.log(`${name}: ${FRAMES} frames over ${period}s`);
  }
} finally {
  await browser.close();
  await stopVite(vite);
}
