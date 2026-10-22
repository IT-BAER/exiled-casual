// @vitest-environment node
import { describe, it, expect } from "vitest";
import { NullEngine, PBRMaterial, RawTexture } from "@babylonjs/core";
import type { WalkableGrid } from "@exiled/mapgen";
import { createScene } from "./engine";
import { buildLevel } from "./level";
import { bindContact, contactActive, contactField, CONTACT_PLUGIN, setContactBand, WET_STONE } from "./contact-band";
import { cliffMaterial } from "./cliffs";
import { setGroundPatch, PATCH_PLUGIN } from "./ground-patch";

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

  // Babylon 9 hands hardBindForSubMesh only to plugins on this list: off it, the
  // band's uniforms stay zero and the floor draws no band at all.
  it("binds its uniforms, as do the ground patches", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    buildLevel(scene, shoreGrid());
    setGroundPatch(scene, "tileset.forest", () => "/none");
    const extra = (scene.getMaterialByName("groundMat")!.pluginManager as unknown as {
      _activePluginsForExtraEvents: { name: string }[];
    })._activePluginsForExtraEvents.map((p) => p.name);
    expect(extra).toContain(CONTACT_PLUGIN);
    expect(extra).toContain(PATCH_PLUGIN);
    engine.dispose();
  });
});

describe("wet stone", () => {
  const kOf = (coast: boolean): number[] => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const rock = new PBRMaterial("rock", scene);
    rock.albedoTexture = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene);
    setContactBand(scene, shoreGrid(), rock, coast);
    let k: number[] = [];
    bindContact({
      updateFloat4() {}, setTexture() {},
      updateFloat3: (n: string, ...v: number[]) => { if (n === "contactK") k = v; },
    } as never, scene);
    engine.dispose();
    return k;
  };

  it("is its own look, apart from the wet sand's flat tint", () => {
    expect(WET_STONE.albedo).toBeLessThan(0.7);
    expect(WET_STONE.saturation).toBeGreaterThan(1);
    expect(WET_STONE.roughness).toBeLessThan(0.3);
    expect(WET_STONE.algae).toBeGreaterThan(0);
    // A flat band is what the owner rejected: the tide line has to wander.
    expect(WET_STONE.wander).toBeGreaterThan(0.3);
  });

  it("is switched on by a coast alone, through contactK.z", () => {
    expect(kOf(true)[2]).toBe(1);
    expect(kOf(false)[2]).toBe(0);
  });

  it("is in the cliff shader with the same numbers", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const mat = cliffMaterial(new PBRMaterial("w", scene));
    const plugin = mat.pluginManager!.getPlugin("ExiledCliff")!;
    const all = Object.values(plugin.getCustomCode("fragment")!).join("\n");
    engine.dispose();
    expect(all).toContain("cliffWet");
    expect(all).toContain(WET_STONE.roughness.toFixed(3));
    expect(all).toContain(WET_STONE.albedo.toFixed(3));
  });
});
