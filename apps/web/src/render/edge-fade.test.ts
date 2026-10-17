// @vitest-environment node
import { describe, it, expect } from "vitest";
import { NullEngine, PBRMaterial } from "@babylonjs/core";
import type { WalkableGrid } from "@exiled/mapgen";
import { createScene } from "./engine";
import {
  EDGE_FADE_FLOOR, EDGE_FADE_LENGTH, EDGE_FADE_PLUGIN, EDGE_FADE_START,
  edgeBrightness, edgeDistance, edgeFadeMaterial, edgeRect,
} from "./edge-fade";

/** 20x20 at 0.5-unit cells with floor in columns/rows 2..17. */
function grid(): WalkableGrid {
  const cols = 20, rows = 20;
  const cells = new Uint8Array(cols * rows);
  for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) cells[y * cols + x] = 1;
  return { cols, rows, cellSize: 0.5, originX: 0, originY: 0, cells };
}

describe("edge fade", () => {
  it("measures distance as zero over the walkable rim and growing outward", () => {
    const rect = edgeRect(grid())!;
    expect(edgeDistance(rect, 4, 4)).toBe(0);
    expect(edgeDistance(rect, rect.maxX, 4)).toBe(0);
    expect(edgeDistance(rect, rect.maxX + 1, 4)).toBeCloseTo(1);
    expect(edgeDistance(rect, rect.maxX + 3, 4)).toBeGreaterThan(edgeDistance(rect, rect.maxX + 1, 4));
    expect(edgeDistance(rect, rect.minX - 2, rect.minZ - 2)).toBeCloseTo(Math.SQRT2 * 2);
  });

  it("keeps full brightness up to the start and sinks to the floor past the falloff", () => {
    expect(edgeBrightness(0)).toBe(1);
    expect(edgeBrightness(EDGE_FADE_START)).toBe(1);
    expect(edgeBrightness(EDGE_FADE_START + EDGE_FADE_LENGTH / 2)).toBeLessThan(1);
    expect(edgeBrightness(EDGE_FADE_START + EDGE_FADE_LENGTH)).toBeCloseTo(EDGE_FADE_FLOOR);
    expect(edgeBrightness(99)).toBeCloseTo(EDGE_FADE_FLOOR);
  });

  it("puts the fade on a copy of the wall material and leaves the shared one plain", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const wall = new PBRMaterial("wall", scene);
    const faded = edgeFadeMaterial(scene, wall, grid());
    expect(faded).not.toBe(wall);
    expect(faded.pluginManager?.getPlugin(EDGE_FADE_PLUGIN)).toBeTruthy();
    expect(wall.pluginManager?.getPlugin(EDGE_FADE_PLUGIN)).toBeFalsy();
    expect(edgeFadeMaterial(scene, wall, grid())).toBe(faded);
    engine.dispose();
  });
});
