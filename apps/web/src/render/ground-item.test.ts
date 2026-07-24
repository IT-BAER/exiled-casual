// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Y_LIFT, updateGroundItem } from "./meshes";

describe("ground item mesh", () => {
  it("has a Y_LIFT entry so it renders on the floor", () => {
    expect(typeof Y_LIFT["groundItem"]).toBe("number");
  });

  it("tints the beacon per rarity and falls back for unknown ones", () => {
    const mat = { diffuseColor: null as unknown, emissiveColor: null as unknown };
    const beamMat = { emissiveColor: null as unknown, alpha: 0 };
    const mesh = { material: mat, getChildMeshes: () => [{ material: beamMat }] } as never;
    updateGroundItem(mesh, "rare");
    const rare = { ...(mat.emissiveColor as { r: number; g: number; b: number }) };
    const rareBeam = beamMat.alpha;
    updateGroundItem(mesh, "normal");
    // A junk beam is dimmer than a rare one, the way a filter tiers its alerts.
    expect(beamMat.alpha).toBeLessThan(rareBeam);
    updateGroundItem(mesh, "nonsense");
    const fallback = mat.emissiveColor as { r: number; g: number; b: number };
    expect(rare.r).toBeGreaterThan(rare.b); // gold, not blue
    expect(fallback.r).toBeCloseTo(fallback.b); // grey normal
    // The beam over the drop carries the same rarity colour as the beacon.
    expect(beamMat.emissiveColor).toEqual(mat.emissiveColor);
  });
});
