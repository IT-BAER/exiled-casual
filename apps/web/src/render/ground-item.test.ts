// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Y_LIFT, updateGroundItem } from "./meshes";

describe("ground item mesh", () => {
  it("has a Y_LIFT entry so it renders on the floor", () => {
    expect(typeof Y_LIFT["groundItem"]).toBe("number");
  });

  it("tints the beacon per rarity and falls back for unknown ones", () => {
    const mat = { diffuseColor: null as unknown, emissiveColor: null as unknown };
    const mesh = { material: mat } as never;
    updateGroundItem(mesh, "rare");
    const rare = { ...(mat.emissiveColor as { r: number; g: number; b: number }) };
    updateGroundItem(mesh, "nonsense");
    const fallback = mat.emissiveColor as { r: number; g: number; b: number };
    expect(rare.r).toBeGreaterThan(rare.b); // gold, not blue
    expect(fallback.r).toBeCloseTo(fallback.b); // grey normal
  });
});
