// @vitest-environment node
import { describe, it, expect } from "vitest";
import { looksFor } from "./AssetViewer";

/**
 * The panel's two vocabularies composed into one outfit. What matters is that a
 * BASE goes through the game's own resolution — geometry plus the palette baked
 * from its inventory icon — so the viewer shows a drop as the player would get
 * it, and never a look that merely resembles it.
 */
describe("composing what the panel is wearing", () => {
  it("equips a base exactly as the game would", () => {
    expect(looksFor({ body: { kind: "base", baseId: "base.ironsworn_plate" } }).body)
      .toBe("plate#base.ironsworn_plate");
  });

  it("keeps a bare look bare, with no item palette on it", () => {
    expect(looksFor({ body: { kind: "look", look: "plate" } }).body).toBe("plate");
  });

  it("empties a slot set to none, rather than falling back to a default", () => {
    expect(looksFor({ body: null, boots: null }).body).toBeNull();
  });

  it("dresses slots independently", () => {
    const out = looksFor({
      body: { kind: "base", baseId: "base.emberweave_robe" },
      boots: { kind: "look", look: "commoner" },
      helmet: null,
    });
    expect(out.body).toBe("ranger#base.emberweave_robe");
    expect(out.boots).toBe("commoner");
    expect(out.helmet).toBeNull();
  });

  it("leaves a slot the panel has not touched empty", () => {
    // Untouched must not silently inherit the game's UNEQUIPPED commoner: the
    // viewer's outfit is whatever its panel says and nothing else.
    expect(looksFor({}).body).toBeNull();
  });
});
