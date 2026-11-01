// Frame-by-frame capture of every player skill in the never-saved skill lab.
// Usage: node tools/skill-lab/capture.mjs [--class ironsworn|stalker|emberbound]... [--skill <id-part>]...
// Writes review/skills/<skill>/NNN.jpg (every rendered frame) and review/skills/<skill>.jpg (contact sheet).
import { rm } from "node:fs/promises";
import path from "node:path";
import { BASE, ROOT, launch, sheet, sleep, startVite, stopVite } from "./lib.mjs";

const OUT = path.join(ROOT, "review", "skills");
const CLASSES = ["ironsworn", "stalker", "emberbound"];
/** Frames per skill: long enough for its last impact to land and fade. */
const FRAMES = {
  earthquake: 130, rain_of_arrows: 110, firestorm: 150, solar_orb: 180, sunder: 90,
  infernal_cry: 100, blood_rage: 90, determination: 90, haste: 90, herald_of_ash: 90,
  snipers_mark: 90, flammability: 100, cinder_ground: 120,
};
const AURAS = new Set(["determination", "haste", "herald_of_ash"]);
const SKIP = new Set(["town_portal", "move"]);

const args = process.argv.slice(2);
const pick = (flag) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));
const classes = pick("--class").length ? pick("--class") : CLASSES;
const only = pick("--skill");


/** Every skill starts from the same place: lab start, facing the fresh dummy arc, full and ready. */
async function freshDummies(page) {
  await page.evaluate(() => window.__dev.home());
  await sleep(700);
}

async function record(page, label, frames, cast) {
  await rm(path.join(OUT, label), { recursive: true, force: true });
  const n = await Promise.race([
    page.evaluate(([l, f, c]) => window.__dev.record(f, l, c ? { cast: { skillId: c } } : {}), [label, frames, cast]),
    sleep(90000).then(() => { throw new Error(`${label}: record timed out`); }),
  ]);
  sheet(path.join(OUT, label), n, path.join(OUT, `${label}.jpg`));
  console.log(`${label}: ${n} frames`);
}

const vite = await startVite();
const { browser, page } = await launch();
try {
  for (const cls of classes) {
    await page.goto(`${BASE}?play&lab&class=class.${cls}&control=mouse&volume=0`);
    await page.waitForFunction(() => window.__lab?.ready === true, null, { timeout: 120000 });
    await sleep(4000);
    const ids = await page.evaluate(() => (window.__snap?.skills ?? []).map((s) => s.id));
    for (const id of ids) {
      const short = id.replace(/^skill\./, "").replace(/\.v\d+$/, "");
      if (SKIP.has(short) || (only.length && !only.some((o) => short.includes(o)))) continue;
      await freshDummies(page);
      await record(page, short, FRAMES[short] ?? 75, id);
      if (AURAS.has(short)) {
        await sleep(1500);
        await record(page, `${short}-steady`, 30, null);
        if (short === "herald_of_ash") {
          // A kill under the herald: a normal pack, burned down by Ember Nova.
          await page.evaluate(() => { window.__dev.clear?.(); window.__dev.spawn?.("pack"); });
          await sleep(1200);
          for (let i = 0; i < 4; i++) {
            await page.evaluate(() => window.__dev.refill());
            await page.evaluate(() => window.__dev.cast("skill.ember_nova.v1"));
            await sleep(600);
          }
          await record(page, `${short}-kills`, 90, "skill.ember_nova.v1");
        }
        await page.evaluate((s) => { window.__dev.refill(); window.__dev.cast(s); }, id); // toggle off
        await sleep(500);
      }
    }
  }
  await page.goto(BASE); // park on the menu: map scenes hold memory (browser-bot-runs-exhaust-memory)
} finally {
  await browser.close();
  await stopVite(vite);
}
