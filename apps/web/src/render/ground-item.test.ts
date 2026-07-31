// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Y_LIFT, updateGroundItem, beamTransform } from "./meshes";

describe("ground item mesh", () => {
  it("has a Y_LIFT entry so it renders on the floor", () => {
    expect(typeof Y_LIFT["groundItem"]).toBe("number");
  });

  it("keeps the beam plumb, its foot on the drop", () => {
    const { x, y, rz } = beamTransform();
    // Plumb, not raked: a perspective camera splays verticals itself, and an
    // authored lean stacked on that had every beam on the floor leaning the
    // same way, which no camera can produce.
    expect(rz).toBe(0);
    expect(x).toBeCloseTo(0);
    // Rotating the cylinder about its centre by rz must land its base at (0, 0).
    const half = y / Math.cos(rz);
    const baseX = x + Math.sin(rz) * half;
    const baseY = y - Math.cos(rz) * half;
    expect(baseX).toBeCloseTo(0);
    expect(baseY).toBeCloseTo(0);
  });

  it("tints the beacon per rarity and falls back for unknown ones", () => {
    const colour = () => ({
      r: 0, g: 0, b: 0,
      set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; },
    });
    const mat = { diffuseColor: null as unknown, emissiveColor: null as unknown };
    const beamMat = { emissiveColor: colour(), alpha: 0 };
    const mesh = { material: mat, getChildMeshes: () => [{ material: beamMat }] } as never;
    updateGroundItem(mesh, "rare");
    const rare = { ...(mat.emissiveColor as { r: number; g: number; b: number }) };
    const rareBeam = beamMat.emissiveColor.r;
    updateGroundItem(mesh, "normal");
    // A junk beam is dimmer than a rare one, the way a filter tiers its alerts.
    // The tier lives in the beam's EMISSIVE now, not its alpha: the GlowLayer
    // never reads material.alpha, so alpha-tiering was erased by the bloom.
    expect(beamMat.emissiveColor.r).toBeLessThan(rareBeam);
    updateGroundItem(mesh, "nonsense");
    const fallback = mat.emissiveColor as { r: number; g: number; b: number };
    expect(rare.r).toBeGreaterThan(rare.b); // gold, not blue
    expect(fallback.r).toBeCloseTo(fallback.b); // grey normal
  });
});
