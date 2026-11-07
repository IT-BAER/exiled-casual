import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NEWS_ENTRIES, NEWS_HISTORY, NEWS_VERSION } from "./news.generated";
// The generator is a plain ESM module and exports its two pure halves, so the
// test can re-run it over the real changelog instead of shelling out.
import { parseChangelog, parseHistory, render } from "../../../tools/changelog_to_news.mjs";

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
    expect(generated.replace(/\r\n/g, "\n")).toBe(render(parsed, parseHistory(readFileSync(CHANGELOG, "utf8"))));
  });

  it("never shows an unreleased section", () => {
    const parsed = parseChangelog("## [Unreleased]\n\n- not yet\n\n## [0.1.0] - 2026-07-30\n\n- shipped\n");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.entries).toEqual(["shipped"]);
  });

  it("shows only each entry's first sentence, so the panel stays a headline", () => {
    const parsed = parseChangelog("## [0.2.0] - 2026-10-02\n\n- The braziers burn. Every bowl\n  stands a flame.\n- One line only\n");
    expect(parsed.entries).toEqual(["The braziers burn.", "One line only"]);
  });
});

describe("the menu's patch-notes window", () => {
  it("is the last five releases, newest first, the newest being LATEST's", () => {
    const history = parseHistory(readFileSync(CHANGELOG, "utf8"));
    expect(history).toHaveLength(5);
    expect(history[0]!.version).toBe(NEWS_VERSION);
    expect(history).toEqual(NEWS_HISTORY);
  });

  it("skips Unreleased, keeps every headline of a release, and stops at the count", () => {
    const text = [
      "## [Unreleased]", "", "- not yet", "",
      "## [0.3.0] - 2026-10-03", "", "### Added", "", "- One. More.", "- Two", "- Three", "- Four", "",
      "## [0.2.0] - 2026-10-02", "", "- Older", "",
      "## [0.1.0] - 2026-10-01", "", "- Oldest", "",
    ].join("\n");
    expect(parseHistory(text, 2)).toEqual([
      { version: "0.3.0", date: "2026-10-03", entries: ["One.", "Two", "Three", "Four"] },
      { version: "0.2.0", date: "2026-10-02", entries: ["Older"] },
    ]);
  });
});
