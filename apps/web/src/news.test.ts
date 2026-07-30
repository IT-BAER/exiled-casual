import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NEWS_ENTRIES, NEWS_VERSION } from "./news.generated";
// The generator is a plain ESM module and exports its two pure halves, so the
// test can re-run it over the real changelog instead of shelling out.
import { parseChangelog, render } from "../../../tools/changelog_to_news.mjs";

const CHANGELOG = new URL("../../../CHANGELOG.md", import.meta.url);

describe("the menu's LATEST panel", () => {
  it("is the changelog, not a copy of it", () => {
    const parsed = parseChangelog(readFileSync(CHANGELOG, "utf8"));
    expect(parsed.version).toBe(NEWS_VERSION);
    expect(parsed.entries).toEqual([...NEWS_ENTRIES]);
  });

  it("is regenerated whenever the changelog moves", () => {
    // Byte-for-byte: if this fails, run `node tools/changelog_to_news.mjs`.
    const parsed = parseChangelog(readFileSync(CHANGELOG, "utf8"));
    const generated = readFileSync(new URL("./news.generated.ts", import.meta.url), "utf8");
    expect(generated.replace(/\r\n/g, "\n")).toBe(render(parsed));
  });

  it("never shows an unreleased section", () => {
    const parsed = parseChangelog("## [Unreleased]\n\n- not yet\n\n## [0.1.0] - 2026-07-30\n\n- shipped\n");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.entries).toEqual(["shipped"]);
  });
});
