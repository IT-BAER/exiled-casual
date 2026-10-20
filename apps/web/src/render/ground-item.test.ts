// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { Y_LIFT, updateGroundItem, beamTransform, beamLook } from "./meshes";
import { createScene } from "./engine";
import { SnapshotRenderer } from "./renderer";
import { testPlayer } from "../test-fixtures";

function snap(entities: SnapshotEntity[]): Snapshot {
  return {
    tick: 1, player: testPlayer(), area: "map", portalsLeft: 0, mapOpen: false, areaTier: 0, atlasSeed: 0,
    completedNodes: [], entities,
    inventory: { cols: 12, rows: 5, items: [] }, stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] }, shards: {}, equipment: {},
  };
}

let engine: InstanceType<typeof NullEngine> | undefined;
afterEach(() => engine?.dispose());

describe("loot beam look", () => {
  const tiers = ["normal", "magic", "rare", "unique"] as const;

  it("spreads its brightness by tier instead of sitting evenly", () => {
    const lit = tiers.map((t) => beamLook(t).lit);
    for (let i = 1; i < lit.length; i++) expect(lit[i]!).toBeGreaterThan(lit[i - 1]!);
    // Intensity beats density: a unique is several junk beams, not one more step.
    expect(lit[3]! / lit[0]!).toBeGreaterThan(4);
  });

  it("keeps a coloured sheath for every tier above normal, never a white tube", () => {
    for (const t of ["magic", "rare", "unique"] as const) {
      const [r, g, b] = beamLook(t).color;
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0.4);
    }
  });

  it("lights a floor pool under rare and unique drops only", () => {
    expect(tiers.map((t) => beamLook(t).pool)).toEqual([false, false, true, true]);
  });

  it("falls back to the normal look for an unknown rarity", () => {
    expect(beamLook("nonsense")).toEqual(beamLook("normal"));
    expect(beamLook(undefined)).toEqual(beamLook("normal"));
  });
});

describe("a drop the renderer draws", () => {
  function draw(rarity: string) {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    new SnapshotRenderer(scene).apply(null, snap([{ id: 9, kind: "groundItem", x: 1, y: 1, rarity } as SnapshotEntity]), 1);
    return scene;
  }

  it("stands a beam on the drop and pools light under a rare one", () => {
    const scene = draw("rare");
    expect(scene.getMeshByName("entity-9-beam")?.isEnabled()).toBe(true);
    expect(scene.getMeshByName("entity-9-pool")?.isEnabled()).toBe(true);
  });

  it("leaves the floor dark under a normal drop", () => {
    const scene = draw("normal");
    expect(scene.getMeshByName("entity-9-beam")?.isEnabled()).toBe(true);
    expect(scene.getMeshByName("entity-9-pool")?.isEnabled()).toBe(false);
  });
});

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
    const mat = { diffuseColor: null as unknown, emissiveColor: colour() };
    const mesh = { material: mat, metadata: null } as never;
    updateGroundItem(mesh, "rare");
    const rare = { ...(mat.emissiveColor as { r: number; g: number; b: number }) };
    updateGroundItem(mesh, "nonsense");
    const fallback = mat.emissiveColor as { r: number; g: number; b: number };
    expect(rare.r).toBeGreaterThan(rare.b); // gold, not blue
    expect(fallback.r).toBeCloseTo(fallback.b); // grey normal
  });
});
