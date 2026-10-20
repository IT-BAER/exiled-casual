// Dev hooks and harness switches belong to `npm run dev`. A production build that
// still answers `?bot` hands every player the whole Atlas on autopilot, so this
// fails the build when one leaks. Run after `npm run build -w apps/web`.
// Vite folds `import.meta.env.DEV` to false and the minifier drops the branch, so a
// gated read leaves no trace; the minifier writes string literals as backticks.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "apps/web/dist/assets";

/** Each must appear 0 times in the emitted .js. */
export const FORBIDDEN = [
  "window.__",          // any DEV console hook (__snap, __layout, __sfx, __wear, ...)
  "has(`bot`)",         // bot mode: open Atlas plus autopilot
  "has(`tour`)",        // tour mode: open Atlas, no saving
  "has(`revealed`)",    // un-fogged minimap
  "get(`volume`)",      // mix override
];

const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error(`no .js in ${DIST} - run \`npm run build -w apps/web\` first`);
  process.exit(1);
}

const hits = [];
for (const f of files) {
  const src = readFileSync(join(DIST, f), "utf8");
  for (const needle of FORBIDDEN) if (src.includes(needle)) hits.push(`${f}: ${needle}`);
}
for (const needle of FORBIDDEN) console.log(`  ${needle.padEnd(18)} ${hits.filter((h) => h.endsWith(needle)).length}`);

if (hits.length) {
  console.error(`\ndev surface in the production build:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
