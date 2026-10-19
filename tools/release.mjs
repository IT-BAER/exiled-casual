/**
 * Cut a release: `node tools/release.mjs 0.4.0`
 *
 * Moves the Unreleased section of CHANGELOG.md under the new version with
 * today's date, writes the version into both package.json files and the
 * lockfile root, rewrites the number in GAME_VERSION (the phase word stays),
 * regenerates the menu news, commits and tags v<version>. It does not push:
 * `git push --follow-tags` is the moment the release workflow starts.
 *
 * `--no-git` stops after writing the files: for a release PR (Jeff's path),
 * where the merge to main is what tags and publishes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const noGit = args.includes("--no-git");
const version = args.find((a) => !a.startsWith("--"));
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error("usage: node tools/release.mjs <major.minor.patch[-pre]> [--no-git]");
  process.exit(2);
}
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (git("status", "--porcelain")) {
  console.error("working tree is not clean; commit or stash first");
  process.exit(1);
}
if (git("tag", "--list", `v${version}`)) {
  console.error(`tag v${version} already exists`);
  process.exit(1);
}

const changelogPath = join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const unreleased = /^## \[Unreleased\]\r?\n([\s\S]*?)(?=^## \[)/m.exec(changelog);
if (!unreleased || !unreleased[1].trim()) {
  console.error("CHANGELOG.md: the Unreleased section is empty; write the entries first");
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  changelogPath,
  changelog.replace(
    unreleased[0],
    `## [Unreleased]\n\n## [${version}] - ${today}\n\n${unreleased[1].trim()}\n\n`,
  ),
);

const setVersion = (file) => {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  if (json.packages?.[""]) json.packages[""].version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
};
setVersion("package.json");
setVersion("apps/web/package.json");
setVersion("package-lock.json");

const versionTs = join(root, "apps/web/src/version.ts");
writeFileSync(
  versionTs,
  readFileSync(versionTs, "utf8").replace(/GAME_VERSION = "v\S+ /, `GAME_VERSION = "v${version} `),
);

execFileSync("node", [join(root, "tools/changelog_to_news.mjs")], { cwd: root, stdio: "inherit" });

if (noGit) {
  console.log(`files written for ${version}; commit them as "release ${version}" and open the PR`);
  process.exit(0);
}
git("add", "CHANGELOG.md", "package.json", "apps/web/package.json", "package-lock.json", "apps/web/src/version.ts", "apps/web/src/news.generated.ts");
git("commit", "-m", `release ${version}`);
git("tag", "-a", `v${version}`, "-m", `release ${version}`);
console.log(`committed and tagged v${version}; now: git push --follow-tags`);
