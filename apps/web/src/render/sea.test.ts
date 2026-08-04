// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, VertexBuffer, VertexData } from "@babylonjs/core";
import { createScene } from "./engine";
import { buildSea, SEA_MESH_NAME } from "./sea";
import { BIOMES } from "@exiled/content-runtime";
import type { Shoreline, WalkableGrid } from "@exiled/mapgen";

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

/**
 * 9×9 with a 5×5 room at cells (2..6) and ONE interior wall cell at (4,4) — a
 * rock outcrop standing in the middle of the floor. The whole point of flooding
 * from the border is that this pocket stays dry.
 */
function coveGrid(): WalkableGrid {
  const cells = new Uint8Array(81);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) cells[y * 9 + x] = 1;
  cells[4 * 9 + 4] = 0;
  return { cols: 9, rows: 9, cellSize: 0.5, originX: 0, originY: 0, cells };
}

describe("buildSea", () => {
  it("floods the void outside the rim and leaves interior wall pockets dry", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const { mesh, waterCells } = buildSea(scene, coveGrid(), true);

    // 81 cells; the 5×5 room less its outcrop is 24 floor, so 57 are dry land or
    // void. The outcrop is the one the border fill can never reach: 56. Getting
    // 57 would mean every boulder mid-map is standing in its own pond.
    expect(waterCells).toBe(56);
    expect(mesh).not.toBeNull();
    expect(scene.getMeshByName(SEA_MESH_NAME)).toBe(mesh);
  });

  it("builds nothing for a biome without a sea, and clears the last one", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    buildSea(scene, coveGrid(), true);
    const result = buildSea(scene, coveGrid(), false);

    expect(result.mesh).toBeNull();
    expect(result.waterCells).toBe(0);
    expect(scene.getMeshByName(SEA_MESH_NAME)).toBeNull();
  });

  it("never leaves a second sheet behind on an area swap", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    buildSea(scene, coveGrid(), true);
    buildSea(scene, coveGrid(), true);

    expect(scene.meshes.filter((m) => m.name === SEA_MESH_NAME)).toHaveLength(1);
  });

  it("brightens the vertices at the shoreline and leaves open water alone", () => {
    // Foam is free: the fill already knows which flooded cells touch floor, so
    // the band is a vertex colour rather than a second texture or a second mesh.
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const { mesh } = buildSea(scene, coveGrid(), true);
    const colors = mesh!.getVerticesData(VertexBuffer.ColorKind)!;
    let peak = 0;
    let open = Infinity;
    for (let i = 0; i < colors.length; i += 4) {
      peak = Math.max(peak, colors[i]!);
      open = Math.min(open, colors[i]!);
    }

    // Surf at the shore, and open water well under it: the ramp between the two
    // is what stops the sea reading as one flat sheet.
    expect(peak).toBeGreaterThan(2.5);
    expect(open).toBeLessThan(1);
  });

  it("sits just over the sand, so the waterline is the shore itself", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const { mesh } = buildSea(scene, coveGrid(), true);
    const pos = mesh!.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 1; i < pos.length; i += 3) expect(pos[i]).toBeCloseTo(0.02, 6);
  });

  it("winds its quads face-up, so the sheet is visible from the camera", () => {
    // The one bug this whole mesh can have and still look correct in every
    // number: reversed winding culls the top face, and the sea is then a sheet
    // you can only see from under the map. The vertex normals are written by
    // hand, so they cannot catch it — only the winding can.
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const { mesh } = buildSea(scene, coveGrid(), true);
    const pos = mesh!.getVerticesData(VertexBuffer.PositionKind)!;
    const idx = mesh!.getIndices()!;
    const derived = new Float32Array(pos.length);
    VertexData.ComputeNormals(pos, idx, derived);

    for (let i = 1; i < derived.length; i += 3) expect(derived[i]).toBeGreaterThan(0.9);
  });

  it("draws a coast off the shoreline CURVE, not off the cells", () => {
    // The bug this replaced: a waterline quantised to half-unit cells is a
    // staircase of translucent triangles, and no shading hides it. Given a
    // shoreline the strip has to land on the curve exactly, to a fraction of a
    // cell — so the test asserts a cross coordinate that no cell edge can hit.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const grid = coveGrid();
    const n = grid.cols;
    const cross = new Float32Array(n);
    for (let i = 0; i < n; i++) cross[i] = 1.37 + 0.11 * i; // deliberately off-grid
    const shore: Shoreline = {
      along: "x",
      start: grid.originX,
      step: grid.cellSize,
      cross,
      seaSide: 1,
    };

    const { mesh } = buildSea(scene, { ...grid, shore }, true);
    const pos = mesh!.getVerticesData(VertexBuffer.PositionKind)!;
    const zs = new Set<number>();
    for (let i = 0; i < pos.length; i += 3) zs.add(Math.round(pos[i + 2]! * 1000) / 1000);

    // Every sample of the curve appears, at its exact fractional position.
    for (let i = 0; i < n; i++) expect(zs.has(Math.round(cross[i]! * 1000) / 1000)).toBe(true);
  });

  it("fades the coast's water out AT the waterline, so nothing steps", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const grid = coveGrid();
    const cross = new Float32Array(grid.cols).fill(2.5);
    const { mesh } = buildSea(
      scene,
      { ...grid, shore: { along: "x", start: grid.originX, step: grid.cellSize, cross, seaSide: 1 } },
      true,
    );
    const pos = mesh!.getVerticesData(VertexBuffer.PositionKind)!;
    const col = mesh!.getVerticesData(VertexBuffer.ColorKind)!;
    for (let v = 0; v < pos.length / 3; v++) {
      // At or landward of the waterline the water is fully transparent.
      if (pos[v * 3 + 2]! <= 2.5) expect(col[v * 4 + 3]).toBe(0);
    }
  });

  it("is the strand and only the strand", () => {
    expect(BIOMES.strand.sea).toBe(true);
    for (const biome of Object.values(BIOMES))
      if (biome.id !== "strand") expect(biome.sea).toBeUndefined();
  });
});
