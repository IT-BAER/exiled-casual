// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Color3 } from "@babylonjs/core";
import { createScene } from "./engine";
import { buildLevel, applyBiomeTint, tilesetDir } from "./level";
import { MAP_BASES, BIOMES } from "@exiled/content-runtime";
import type { WalkableGrid } from "@exiled/mapgen";

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

// 5×5 grid with a centred 3×3 walkable room (cells (1..3, 1..3)). A wall cell (0)
// is "boundary" when ANY of its 8 neighbours is floor (diagonals included, so room
// corners fill and walls meet flush). Every one of the 16 wall cells here is within
// a Chebyshev step of the room, so all 16 qualify. 16 is the independent expected value.
function roomGrid(): WalkableGrid {
  const cells = new Uint8Array(25);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) cells[y * 5 + x] = 1;
  return { cols: 5, rows: 5, cellSize: 0.5, originX: 0, originY: 0, cells };
}

describe("buildLevel", () => {
  it("builds one merged wall mesh from the grid's boundary wall cells", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const result = buildLevel(scene, roomGrid());

    expect(result.wallCells).toBe(16);
    expect(scene.getMeshByName("level-walls")).not.toBeNull();
  });

  it("replaces the prior walls when a new area arrives (no mesh leak)", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    buildLevel(scene, roomGrid());
    buildLevel(scene, roomGrid());

    expect(scene.meshes.filter((m) => m.name === "level-walls").length).toBe(1);
  });

  it("clears the walls when given a null grid (open area like the hideout)", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    buildLevel(scene, roomGrid());
    const result = buildLevel(scene, null);

    expect(result.walls).toBeNull();
    expect(result.wallCells).toBe(0);
    expect(scene.getMeshByName("level-walls")).toBeNull();
  });

  it("gives each tileset its own material, so a new biome cannot inherit the last one's stone", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const a = buildLevel(scene, roomGrid(), "tileset.desert").walls!.material!.name;
    const b = buildLevel(scene, roomGrid(), "tileset.swamp").walls!.material!.name;

    expect(a).not.toBe(b);
    expect(a).toContain("desert");
    expect(b).toContain("swamp");
  });
});

/**
 * The renderer looks these up by path at runtime, so a base whose plates were
 * never built is a wall that renders untextured in the real game and nowhere
 * else. Same guard as `GEAR_TEXTURE` in rig.test.ts: the data and the files on
 * disk must agree. Rebuild with `python tools/build_tileset_textures.py`.
 */
describe("biome tilesets", () => {
  const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

  it("every map base's tileset has its colour and normal plates on disk", () => {
    for (const base of Object.values(MAP_BASES)) {
      const dir = `${publicDir}${tilesetDir(base.tilesetId)}`;
      expect(existsSync(`${dir}/wall_color.jpg`), `${base.id}: ${dir}/wall_color.jpg`).toBe(true);
      expect(existsSync(`${dir}/wall_normal.jpg`), `${base.id}: ${dir}/wall_normal.jpg`).toBe(true);
    }
  });

  it("every biome carries a usable tint", () => {
    for (const biome of Object.values(BIOMES)) {
      expect(biome.tint).toHaveLength(3);
      for (const c of biome.tint) {
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("tints the light for a biome and puts it back to neutral for the hideout", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const fill = scene.getLightByName("fill")!;

    applyBiomeTint(scene, BIOMES.desert.tint);
    expect(fill.diffuse.equals(new Color3(...BIOMES.desert.tint))).toBe(true);

    applyBiomeTint(scene, null);
    expect(fill.diffuse.equals(new Color3(1, 1, 1))).toBe(true);
  });
});
