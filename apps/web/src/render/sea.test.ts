// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, VertexBuffer, VertexData } from "@babylonjs/core";
import { createScene } from "./engine";
import { buildSea, SEA_MESH_NAME, stirSea } from "./sea";
import { waterSplash } from "./splash";
import { WATER_DATA_KIND, waterPlugin, waterSurf } from "./water-surface";
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

/** 11x11 open floor with one 3x3 pool at cells 4..6 the player wades: the grid
 *  border is wall, but a fen floods only what the generator marked. */
function fenGrid(): WalkableGrid {
  const cells = new Uint8Array(121);
  for (let y = 1; y <= 9; y++) for (let x = 1; x <= 9; x++) cells[y * 11 + x] = 1;
  const water = new Uint8Array(121);
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) water[y * 11 + x] = 1;
  return { cols: 11, rows: 11, cellSize: 0.5, originX: 0, originY: 0, cells, water };
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

  it("hands the shader each flooded vertex's distance from the shore", () => {
    // The fill already knows which flooded cells touch floor, so depth is free:
    // nothing at the rim, deeper going out.
    engine = new NullEngine();
    const { scene } = createScene(engine);

    const { mesh } = buildSea(scene, coveGrid(), true);
    const water = mesh!.getVerticesData(WATER_DATA_KIND)!;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < water.length; i += 2) {
      min = Math.min(min, water[i]!);
      max = Math.max(max, water[i]!);
    }
    expect(min).toBeLessThanOrEqual(0);
    expect(max).toBeGreaterThan(1);
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

  it("hands the shader every coast vertex's distance out from the waterline and along the shore", () => {
    // The surf, the swash and the depth colour are all computed per pixel from
    // these two numbers, so they are the whole contract between mesh and shader.
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
    const water = mesh!.getVerticesData(WATER_DATA_KIND)!;
    expect(water).not.toBeNull();
    let landward = 0;
    let seaward = 0;
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3]!;
      const z = pos[v * 3 + 2]!;
      // Out is +z here (seaSide 1), so the distance is the offset from the line.
      expect(water[v * 2]!).toBeCloseTo(z - 2.5, 5);
      // Along runs with x, the shore's own axis, so foam and phase can vary down
      // the beach without seams.
      expect(water[v * 2 + 1]!).toBeCloseTo(x, 5);
      if (z < 2.5 - 1e-6) landward++;
      if (z > 2.5 + 1e-6) seaward++;
    }
    // Landward vertices are where the swash runs up the sand and leaves it wet.
    expect(landward).toBeGreaterThan(0);
    expect(seaward).toBeGreaterThan(0);
  });

  it("measures distance on the sea side when the sea lies toward -z", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const grid = coveGrid();
    const cross = new Float32Array(grid.cols).fill(2.5);
    const { mesh } = buildSea(
      scene,
      { ...grid, shore: { along: "x", start: grid.originX, step: grid.cellSize, cross, seaSide: -1 } },
      true,
    );
    const pos = mesh!.getVerticesData(VertexBuffer.PositionKind)!;
    const water = mesh!.getVerticesData(WATER_DATA_KIND)!;
    for (let v = 0; v < pos.length / 3; v++) expect(water[v * 2]!).toBeCloseTo(2.5 - pos[v * 3 + 2]!, 5);
  });

  it("gives the coast the surf and still pools none", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const grid = coveGrid();
    const cross = new Float32Array(grid.cols).fill(2.5);
    const coast = buildSea(
      scene,
      { ...grid, shore: { along: "x", start: grid.originX, step: grid.cellSize, cross, seaSide: 1 } },
      true,
    ).mesh!;
    expect(waterSurf(coast)).toBe(true);
    const water = new Uint8Array(81);
    water[0] = 1;
    const pool = buildSea(scene, { ...coveGrid(), water }, "fen").mesh!;
    expect(waterSurf(pool)).toBe(false);
  });

  it("lets bodies wading through a coast stir its water, and nothing else", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const grid = coveGrid();
    const cross = new Float32Array(grid.cols).fill(2.5);
    const coast = buildSea(
      scene,
      { ...grid, shore: { along: "x", start: grid.originX, step: grid.cellSize, cross, seaSide: 1 } },
      true,
    ).mesh!;
    const wake = waterPlugin(coast.material)!.wake!;
    expect(wake).not.toBeNull();
    let falls = 0;
    // One metre out, walking down the shore at a run.
    for (let x = 0; x <= 4; x += 4.2 / 60)
      falls += stirSea(scene, [{ id: 1, x, z: 3.5, radius: 0.5, player: true }], 1 / 60).length;
    expect(falls).toBeGreaterThan(0);
    // The window follows him: he stands near its middle, 10 m in from its corner.
    expect(wake.originX).toBeGreaterThan(4 - 10.5);
    expect(wake.originX).toBeLessThan(4 - 9.5);

    // A dungeon's void is no water anyone wades.
    buildSea(scene, coveGrid(), true);
    expect(stirSea(scene, [{ id: 1, x: 0, z: 0, radius: 0.5, player: true }], 1 / 60)).toEqual([]);
  });

  it("lets a body wading across a fen pool ring it, foam it and splash, and stays still on the bank", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const pool = buildSea(scene, fenGrid(), "fen").mesh!;
    const wake = waterPlugin(pool.material)!.wake!;
    expect(wake).not.toBeNull();
    const splash = waterSplash(scene);
    const crowns = splash.crowns;
    let falls = 0;
    // Across the pool (cells 4..6 span 1.75..3.25) at a walk.
    for (let x = 0.5; x <= 4.5; x += 2 / 60)
      for (const f of stirSea(scene, [{ id: 1, x, z: 2.5, radius: 0.3, player: true }], 1 / 60)) {
        expect(f.x).toBeGreaterThan(1.75);
        expect(f.x).toBeLessThan(3.25);
        expect(f.depth).toBeGreaterThan(0);
        falls++;
      }
    expect(falls).toBeGreaterThan(0);
    expect(splash.crowns - crowns).toBe(falls);
    // Walking the dry floor beside it stirs nothing.
    for (let x = 0.5; x <= 4.5; x += 2 / 60)
      expect(stirSea(scene, [{ id: 1, x, z: 0.75, radius: 0.3, player: true }], 1 / 60)).toEqual([]);
  });

  it("throws a crown of water off every foot that comes down in it, and lets it fall back", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const grid = coveGrid();
    const cross = new Float32Array(grid.cols).fill(2.5);
    buildSea(scene, { ...grid, shore: { along: "x", start: grid.originX, step: grid.cellSize, cross, seaSide: 1 } }, true);
    const splash = waterSplash(scene);
    const run = (player: boolean, z: number): number => {
      const before = { drops: splash.emitted, crowns: splash.crowns };
      let falls = 0;
      for (let x = 0; x <= 4; x += 4.2 / 60)
        falls += stirSea(scene, [{ id: player ? 1 : 2, x, z, radius: 0.5, player }], 1 / 60).length;
      expect(falls).toBeGreaterThan(0);
      expect(splash.crowns - before.crowns).toBe(falls);
      return (splash.emitted - before.drops) / falls;
    };
    const mine = run(true, 3.5);
    const theirs = run(false, 3.6);
    expect(mine).toBeGreaterThanOrEqual(10);
    expect(theirs).toBeGreaterThanOrEqual(3);
    expect(theirs).toBeLessThan(mine);
    expect(splash.live).toBeGreaterThan(0);
    for (let k = 0; k < 120; k++) splash.step(1 / 60);
    expect(splash.live).toBe(0);
  });

  it("is the strand and only the strand", () => {
    expect(BIOMES.coast.sea).toBe(true);
    for (const biome of Object.values(BIOMES))
      if (biome.id !== "coast") expect(biome.sea).toBeUndefined();
  });

  it("draws a fen's pools as still water: only the marked cells, no surf, faded to nothing at the bank", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const { mesh, waterCells } = buildSea(scene, fenGrid(), "fen");
    expect(waterCells).toBe(9);
    expect(mesh!.name).toBe(SEA_MESH_NAME);
    expect(mesh!.material!.name).toBe("fen-mat");
    expect(mesh!.receiveShadows).toBe(false);
    const pos = mesh!.getVerticesData(VertexBuffer.PositionKind)!;
    const depth = mesh!.getVerticesData(WATER_DATA_KIND)!;
    // Murky and still: no surf.
    expect(waterSurf(mesh!)).toBe(false);
    let deep = 0;
    for (let v = 0; v < pos.length / 3; v++) {
      expect(pos[v * 3 + 1]).toBeCloseTo(0.02, 6);
      const x = pos[v * 3]!, z = pos[v * 3 + 2]!;
      // The pool's outline (cells 4..6 span 1.75..3.25) is its bank: no depth
      // there, so the bank is a gradient, not an edge.
      const onEdge = Math.abs(x - 1.75) < 1e-6 || Math.abs(x - 3.25) < 1e-6 ||
        Math.abs(z - 1.75) < 1e-6 || Math.abs(z - 3.25) < 1e-6;
      if (onEdge) expect(depth[v * 2]!, `${x},${z}`).toBeLessThanOrEqual(0);
      if (depth[v * 2]! > 0) deep++;
    }
    // And it does fill in: the middle has depth, not just a wet stain.
    expect(deep).toBeGreaterThan(0);
  });

  it("draws no fen without a water mask", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    expect(buildSea(scene, coveGrid(), "fen").mesh).toBeNull();
  });
});
