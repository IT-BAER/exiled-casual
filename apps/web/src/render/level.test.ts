// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Color3, VertexBuffer } from "@babylonjs/core";
import { createScene } from "./engine";
import { buildLevel, applyBiomeTint, applyTilesetFloor, tilesetDir } from "./level";
import { MAP_BASES, BIOMES } from "@exiled/content-runtime";
import type { WalkableGrid } from "@exiled/mapgen";

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

// 5×5 grid with a centred 3×3 walkable room (cells (1..3, 1..3)). A wall cell (0)
// is drawn when floor lies within WALL_THICK_CELLS of it (diagonals included, so
// room corners fill and walls meet flush). Every one of the 16 wall cells here is
// one step from the room, so all 16 qualify whatever that thickness is.
function roomGrid(): WalkableGrid {
  const cells = new Uint8Array(25);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) cells[y * 5 + x] = 1;
  return { cols: 5, rows: 5, cellSize: 0.5, originX: 0, originY: 0, cells };
}

/** 11×11 with a 3×3 room at cells (4..6): room enough for the wall band to have
 *  an outer edge, which the 5×5 above is too small to show. */
function roomyGrid(): WalkableGrid {
  const cells = new Uint8Array(121);
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) cells[y * 11 + x] = 1;
  return { cols: 11, rows: 11, cellSize: 0.5, originX: 0, originY: 0, cells };
}

describe("buildLevel", () => {
  it("builds one merged wall mesh from the grid's boundary wall cells", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const result = buildLevel(scene, roomGrid());

    expect(result.wallCells).toBe(16);
    expect(scene.getMeshByName("level-walls")).not.toBeNull();
  });

  it("keeps the wall band one cell deep, so walls stay walls and not bars", () => {
    // Three cells was tried and reverted: the band grows by a Chebyshev
    // neighbourhood, so a deeper band fattens EVERY wall and steps every corner
    // into a staircase — the frame became grey bars with floor in the gaps.
    // Floor sits in 4..6, so one cell out covers 3..7: 25 cells, less the 9
    // floor. The 96 cells beyond stay undrawn — a band, not a filled square.
    engine = new NullEngine();
    const { scene } = createScene(engine);

    expect(buildLevel(scene, roomyGrid()).wallCells).toBe(16);
  });

  it("shades the wall tops down, so they never out-bright the floor", () => {
    // The loudest "this is Minecraft" pixel: a lit plateau on every wall top,
    // brighter than the ground. PoE's rock goes near-black off the floor plane.
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const walls = buildLevel(scene, roomGrid()).walls!;
    const normals = walls.getVerticesData(VertexBuffer.NormalKind)!;
    const colors = walls.getVerticesData(VertexBuffer.ColorKind);
    expect(colors, "wall colours survive the merge").not.toBeNull();
    for (let n = 0, c = 0; n < normals.length; n += 3, c += 4) {
      expect(colors![c]).toBeCloseTo((normals[n + 1] ?? 0) > 0.5 ? 0.22 : 1, 5);
    }
  });

  it("shrinks the ground plane to the area, so past the outer wall is black", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    buildLevel(scene, roomGrid()); // 5 cells × 0.5 = 2.5 units square
    const ground = scene.getMeshByName("ground")!;
    expect(ground.scaling.x).toBeCloseTo(2.5 / 200, 6);
    expect(ground.scaling.z).toBeCloseTo(2.5 / 200, 6);
    // Cell (0,0) is centred on the origin, so the middle is half a cell short.
    expect(ground.position.x).toBeCloseTo(1, 6);

    buildLevel(scene, null); // the hideout is open ground again
    expect(ground.scaling.x).toBe(1);
    expect(ground.position.x).toBe(0);
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

  it("never makes level geometry a shadow caster", () => {
    // Two bugs in one, both invisible until an assembled map replaced the disc:
    // a wall casts a shadow longer than a room is wide and blacked every room
    // out, and the per-run boxes are disposed by the merge but stayed in the
    // render list forever — 817 dead meshes after a single map.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const sun = scene.getLightByName("sun");
    const shadows = sun?.getShadowGenerator();
    if (!shadows) return; // NullEngine has no render targets; nothing to assert

    buildLevel(scene, roomGrid());
    buildLevel(scene, roomGrid()); // a second area must not pile up more

    const list = shadows.getShadowMap()?.renderList ?? [];
    expect(list.filter((m) => m.name.startsWith("wallrun-"))).toHaveLength(0);
    expect(list.filter((m) => m.name === "level-walls")).toHaveLength(0);
    expect(list.filter((m) => m.isDisposed())).toHaveLength(0);
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

  it("every map base's tileset has its wall and floor plates on disk", () => {
    for (const base of Object.values(MAP_BASES)) {
      const dir = `${publicDir}${tilesetDir(base.tilesetId)}`;
      for (const plate of ["wall_color.jpg", "wall_normal.jpg", "floor_color.jpg"]) {
        expect(existsSync(`${dir}/${plate}`), `${base.id}: ${dir}/${plate}`).toBe(true);
      }
    }
  });

  it("re-plates the ground per biome and gives the hideout its own back", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const mat = scene.getMaterialByName("groundMat") as { albedoTexture?: { url?: string } };

    applyTilesetFloor(scene, "tileset.swamp");
    expect(mat.albedoTexture?.url).toContain("swamp/floor_color.jpg");

    applyTilesetFloor(scene, "tileset.desert");
    expect(mat.albedoTexture?.url).toContain("desert/floor_color.jpg");

    applyTilesetFloor(scene, null);
    expect(mat.albedoTexture?.url).toContain("floor.png");
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
    // Desert is warm, so red leads and blue trails.
    expect(fill.diffuse.r).toBeGreaterThan(fill.diffuse.b);

    applyBiomeTint(scene, null);
    expect(fill.diffuse.equals(new Color3(1, 1, 1))).toBe(true);
  });

  it("shifts hue without dimming: every tint averages to full brightness", () => {
    // Applied raw, a tint darker than 1.0 doubles as a dimmer, and an assembled
    // map is mostly floor in a wall's shadow — the rooms went black. Normalising
    // to mean 1.0 is what keeps a biome a colour instead of a brightness cut.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const fill = scene.getLightByName("fill")!;

    for (const biome of Object.values(BIOMES)) {
      applyBiomeTint(scene, biome.tint);
      const mean = (fill.diffuse.r + fill.diffuse.g + fill.diffuse.b) / 3;
      expect(mean, `${biome.id} mean tint`).toBeCloseTo(1, 5);
    }
  });
});
