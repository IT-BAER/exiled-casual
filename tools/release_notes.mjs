/**
 * Print one version's section of CHANGELOG.md, verbatim, for the GitHub
 * release body. The release workflow calls it; the test next to news.test.ts
 * pins the slicing.
 *
 *   node tools/release_notes.mjs 0.4.0
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function sectionFor(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).filter((l) => !/^\[[^\]]+\]:\s*https?:/.test(l));
  return body.join("\n").trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node tools/release_notes.mjs <version>");
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  process.stdout.write(sectionFor(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version) + "\n");
}
