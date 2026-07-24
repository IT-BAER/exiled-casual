import { describe, it, expect } from "vitest";
import { validateItemBase, validateAffix } from "./index.js";

describe("validateItemBase", () => {
  it("accepts a well-formed base", () => {
    const r = validateItemBase({ id: "base.wand", name: "Wand", itemClass: "wand", w: 1, h: 3 });
    expect(r.ok).toBe(true);
  });
  it("rejects non-positive dimensions", () => {
    const r = validateItemBase({ id: "base.wand", name: "Wand", itemClass: "wand", w: 0, h: 3 });
    expect(r.ok).toBe(false);
  });
  it("rejects a missing id", () => {
    const r = validateItemBase({ name: "Wand", itemClass: "wand", w: 1, h: 3 });
    expect(r.ok).toBe(false);
  });
});

describe("validateAffix", () => {
  it("accepts a well-formed affix", () => {
    const r = validateAffix({ id: "affix.life", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 20 });
    expect(r.ok).toBe(true);
  });
  it("rejects an affix that is neither prefix nor suffix", () => {
    const r = validateAffix({ id: "affix.life", kind: "implicit", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 20 });
    expect(r.ok).toBe(false);
  });
  it("rejects min greater than max", () => {
    const r = validateAffix({ id: "affix.life", kind: "prefix", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 30, max: 20 });
    expect(r.ok).toBe(false);
  });
});
