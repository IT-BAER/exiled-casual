// Rebuilds the contact sheets from frames already under review/skills/.
// Usage: node tools/skill-lab/resheet.mjs [label ...]
import { readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, sheet } from "./lib.mjs";

const OUT = path.join(ROOT, "review", "skills");
const want = process.argv.slice(2);
for (const d of readdirSync(OUT, { withFileTypes: true })) {
  if (!d.isDirectory() || (want.length && !want.includes(d.name))) continue;
  const n = readdirSync(path.join(OUT, d.name)).filter((f) => f.endsWith(".jpg")).length;
  sheet(path.join(OUT, d.name), n, path.join(OUT, `${d.name}.jpg`));
}
