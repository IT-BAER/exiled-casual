// @vitest-environment node
import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core";
import type { WalkableGrid } from "@exiled/mapgen";
import { createScene } from "./engine";
import { buildLevel } from "./level";
import { contactActive, contactField, CONTACT_PLUGIN } from "./contact-band";

/** 24x12 at 0.5-unit cells: wall in columns 0..3, floor right of it, and `sea`
 *  columns from the right edge in as water. */
function shoreGrid(sea = 0): WalkableGrid {
  const cols = 24, rows = 12;
  const cells = new Uint8Array(cols * rows);
  const water = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (x >= cols - sea) water[i] = 1;
    else if (x >= 4) cells[i] = 1;
  }
  return { cols, rows, cellSize: 0.5, originX: 0, originY: 0, cells, ...(sea ? { water } : {}) };
}

describe("contact band", () => {
  it("darkens the floor against a wall and leaves it alone two units out", () => {
    const grid = shoreGrid();
    const f = contactField(grid);
    const at = (x: number) => f[6 * grid.cols + x]!;
    expect(at(4)).toBeGreaterThan(128);
    expect(at(4)).toBeGreaterThan(at(5));
    expect(at(5)).toBeGreaterThan(at(6));
    expect(at(4 + 4)).toBe(0);
  });

  it("never darkens sand against the sea", () => {
    const grid = shoreGrid(6);
    const f = contactField(grid);
    const at = (x: number) => f[6 * grid.cols + x]!;
    for (let x = grid.cols - 6; x < grid.cols; x++) expect(at(x), `sea ${x}`).toBe(0);
    expect(at(grid.cols - 7), "sand at the waterline").toBe(0);
    expect(at(4), "the rock side still is").toBeGreaterThan(128);
  });

  it("shades the ground on a map and lifts it for the hideout", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    buildLevel(scene, shoreGrid());
    expect(scene.getMaterialByName("groundMat")!.pluginManager?.getPlugin(CONTACT_PLUGIN)).toBeTruthy();
    expect(contactActive(scene)).toBe(true);
    buildLevel(scene, null);
    expect(contactActive(scene)).toBe(false);
    engine.dispose();
  });
});
