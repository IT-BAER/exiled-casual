import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PASSIVE_TREE } from "@exiled/rules";
import { MONSTERS, BOSSES } from "@exiled/content-runtime";

// Search engines and LLM crawlers read these files, not the game: a number in them
// goes stale silently when the content grows.
const FILES = ["../index.html", "../public/llms-full.txt", "../public/llms.txt"].map((p) => ({
  name: p,
  text: readFileSync(new URL(p, import.meta.url), "utf8"),
}));

describe("the public description", () => {
  it("names the passive tree's real node count", () => {
    for (const { name, text } of FILES) {
      for (const m of text.matchAll(/(\d+)[- ]nodes?\b/g)) expect(`${name}: ${m[1]}`).toBe(`${name}: ${PASSIVE_TREE.length}`);
    }
  });

  it("says how many bosses fight in two phases", () => {
    const bosses = [...new Set(Object.values(BOSSES))];
    const phased = bosses.filter((id) => (MONSTERS.get(id) as { boss?: { phase2?: unknown } })?.boss?.phase2);
    const claim = phased.length === bosses.length ? "every boss fights in two phases" : `${phased.length} bosses fight in two phases`;
    expect(FILES.find((f) => f.name.endsWith("llms-full.txt"))!.text).toContain(claim);
  });
});
