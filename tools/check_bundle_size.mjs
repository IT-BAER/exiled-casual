// A build that quietly doubles is a build nobody notices until the game takes ten
// seconds to start on a laptop. Vite only ever warns about a fat chunk; this fails.
// Budgets are gzip, because that is what the player actually downloads. Raise one
// only with a reason: the number is the conversation.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const DIST = "apps/web/dist/assets";

/**
 * kB gzip. `total` covers every emitted .js; `chunk` caps the single biggest one.
 * `chunk` went 900 -> 1250 with rolldown 1.2.14, which inlines the lazy Babylon chunks the
 * menu stage loads anyway: measured on a preview, the warmed menu fetched 7377 kB raw JS in
 * 204 files against 7495 kB in 521 before, and the total gzip fell 2081 -> 1942.
 * `total` 2100 -> 2110 for the companion cat (`render/pet.ts`): measured 2101.8 against
 * 2100.0 before it, so the module is 1.8 kB gzip in the GameView chunk.
 */
const BUDGET = { total: 2110, chunk: 1250 };

const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error(`no .js in ${DIST} - run \`npm run build -w apps/web\` first`);
  process.exit(1);
}

const sized = files
  .map((f) => ({ f, kb: gzipSync(readFileSync(join(DIST, f))).length / 1024 }))
  .sort((a, b) => b.kb - a.kb);

const total = sized.reduce((n, s) => n + s.kb, 0);
const biggest = sized[0];

const fail = [];
if (total > BUDGET.total) fail.push(`total ${total.toFixed(0)} kB > ${BUDGET.total} kB`);
if (biggest.kb > BUDGET.chunk)
  fail.push(`${biggest.f} ${biggest.kb.toFixed(0)} kB > ${BUDGET.chunk} kB`);

for (const s of sized.slice(0, 5)) console.log(`  ${s.kb.toFixed(1).padStart(8)} kB  ${s.f}`);
console.log(`  ${total.toFixed(1).padStart(8)} kB  total gzip (budget ${BUDGET.total})`);

if (fail.length) {
  console.error(`\nbundle budget exceeded:\n  ${fail.join("\n  ")}`);
  process.exit(1);
}
