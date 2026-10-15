import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sectionFor } from "../../../tools/release_notes.mjs";

const sample = `# Changelog

## [Unreleased]

- not yet

## [0.4.0] - 2026-10-20

Alpha.

### Fixed

- The thing. Explained over
  two lines.

## [0.3.0] - 2026-10-11

- older

[0.4.0]: https://example/compare/v0.3.0...v0.4.0
`;

describe("release notes", () => {
  it("are one version's section, verbatim, without the header", () => {
    expect(sectionFor(sample, "0.4.0")).toBe(
      "Alpha.\n\n### Fixed\n\n- The thing. Explained over\n  two lines.",
    );
  });

  it("refuse a version the changelog does not have", () => {
    expect(() => sectionFor(sample, "9.9.9")).toThrow(/9\.9\.9/);
  });

  it("find the real changelog's newest release", () => {
    const text = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
    expect(sectionFor(text, "0.3.0")).toMatch(/^Alpha\./);
  });
});
