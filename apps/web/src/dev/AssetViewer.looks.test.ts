// @vitest-environment node
import { describe, it, expect } from "vitest";
import { looksFor } from "./AssetViewer";

/**
 * The panel's two vocabularies composed into one outfit. What matters is that a
 * BASE goes through the game's own resolution, so the viewer shows a drop as the
 * player would get it and never a look that merely resembles it. On the KayKit
 * wardrobe that resolution is a whole outfit rather than a palette: Ironsworn
 * Plate IS the knight.
 */
describe("composing what the panel is wearing", () => {
  it("equips a base exactly as the game would", () => {
    expect(looksFor({ body: { kind: "base", baseId: "base.ironsworn_plate" } }).body)
      .toBe("knight");
  });

  it("keeps a bare look bare, with no item palette on it", () => {
    expect(looksFor({ body: { kind: "look", look: "knight" } }).body).toBe("knight");
  });

  it("shows the game's own empty slot, because a bare body does not exist here", () => {
    // The torso, arms and legs are looks of the BODY slot, so emptying it
    // undresses him past nudity into invisibility. The game answers an empty
    // body slot with commoner cloth; so does this.
    expect(looksFor({ body: null, boots: null }).body).toBe("ranger");
    expect(looksFor({ body: null, boots: null }).boots).toBe("ranger");
    // A slot the game leaves empty is still empty.
    expect(looksFor({ helmet: null }).helmet).toBeNull();
  });

  it("dresses slots independently", () => {
    const out = looksFor({
      body: { kind: "base", baseId: "base.emberweave_robe" },
      boots: { kind: "look", look: "rogue" },
      helmet: null,
    });
    expect(out.body).toBe("mage");
    expect(out.boots).toBe("rogue");
    expect(out.helmet).toBeNull();
  });

  it("dresses an untouched slot the way an empty slot is dressed in play", () => {
    // Not "whatever the panel says and nothing else" any more: on this wardrobe
    // an unsaid body slot means no torso, arms or legs either.
    expect(looksFor({}).body).toBe("ranger");
    expect(looksFor({}).weapon1).toBeNull();
  });
});
