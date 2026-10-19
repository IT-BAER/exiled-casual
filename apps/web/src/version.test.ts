import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GAME_VERSION } from "./version";
import { parseChangelog } from "../../../tools/changelog_to_news.mjs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

// Three places name the release; the release script writes all of them and
// this test is what stops one from drifting when someone edits by hand.
describe("the release number", () => {
  const pkg = JSON.parse(read("package.json")).version as string;
  const web = JSON.parse(read("apps/web/package.json")).version as string;
  const changelog = parseChangelog(read("CHANGELOG.md")).version;

  it("is the newest released changelog section", () => {
    expect(pkg).toBe(changelog);
    expect(web).toBe(pkg);
  });

  it("is what the player sees, in full", () => {
    expect(GAME_VERSION.startsWith(`v${pkg} `)).toBe(true);
  });
});
