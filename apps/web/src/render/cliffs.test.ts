// @vitest-environment node
import { describe, it, expect } from "vitest";
import { generateArea, type GrammarId } from "@exiled/mapgen";
import { NullEngine, VertexBuffer } from "@babylonjs/core";
import { createScene, BETA_LIMIT, CAMERA_ALPHA } from "./engine";
import { buildCliffs, cliffHeights, cliffMaterial, cliffVertexData, CLIFF_FRONT } from "./cliffs";
import { PBRMaterial } from "@babylonjs/core";

const MAPS: [GrammarId, number][] = [["loop", 1], ["loop", 7], ["sunken-ruins", 3], ["open-field", 5]];

describe("cliffs", () => {
  it("never raises rock over a walkable cell", () => {
    for (const [g, seed] of MAPS) {
      const grid = generateArea(seed, "v", g).grid;
      const f = cliffHeights(grid);
      let raised = 0;
      for (let cy = 0; cy < grid.rows; cy++) for (let cx = 0; cx < grid.cols; cx++) {
        if (grid.cells[cy * grid.cols + cx] !== 1) continue;
        for (let dj = 0; dj <= 2; dj++) for (let di = 0; di <= 2; di++) {
          if (f.heights[(cy * 2 + dj) * f.nx + cx * 2 + di] !== 0) raised++;
        }
      }
      expect(raised, `${g} ${seed}`).toBe(0);
    }
  });

  it("hides no floor behind anything taller than the front cap, at the flattest pitch", () => {
    // Walk from every floor cell toward the camera. Rock may block the line only
    // where it is low (a wall in front of the room, as the boulders always were).
    const toCam = { x: Math.cos(CAMERA_ALPHA), z: Math.sin(CAMERA_ALPHA) };
    const rise = 1 / Math.tan(BETA_LIMIT.max);
    for (const [g, seed] of MAPS) {
      const grid = generateArea(seed, "v", g).grid;
      const f = cliffHeights(grid);
      const at = (x: number, z: number) => {
        const i = (x - f.x0) / f.step, j = (z - f.z0) / f.step;
        const i0 = Math.floor(i), j0 = Math.floor(j);
        if (i0 < 0 || j0 < 0 || i0 + 1 >= f.nx || j0 + 1 >= f.nz) return 0;
        const h = (a: number, b: number) => f.heights[b * f.nx + a]!;
        const ti = i - i0, tj = j - j0;
        return (h(i0, j0) * (1 - ti) + h(i0 + 1, j0) * ti) * (1 - tj) + (h(i0, j0 + 1) * (1 - ti) + h(i0 + 1, j0 + 1) * ti) * tj;
      };
      let tallBlocks = 0;
      for (let cy = 0; cy < grid.rows; cy += 2) for (let cx = 0; cx < grid.cols; cx += 2) {
        if (grid.cells[cy * grid.cols + cx] !== 1) continue;
        const px = grid.originX + cx * grid.cellSize, pz = grid.originY + cy * grid.cellSize;
        for (let t = 0.05; t < 6; t += 0.05) {
          const h = at(px + toCam.x * t, pz + toCam.z * t);
          if (h > t * rise && h > CLIFF_FRONT + 1e-6) { tallBlocks++; break; }
        }
      }
      expect(tallBlocks, `${g} ${seed}`).toBe(0);
    }
  });

  it("stands well over the player where the camera looks at solid rock", () => {
    const f = cliffHeights(generateArea(1, "v", "loop").grid);
    let tall = 0, raised = 0;
    for (const h of f.heights) { if (h > 0) raised++; if (h > 3.5) tall++; }
    expect(tall / raised).toBeGreaterThan(0.05);
  });

  it("meets the floor on a scree slope, not a sheer face", () => {
    // The floor plate climbs to BLEND_H; the slope must hold it for a visible width.
    const f = cliffHeights(generateArea(1, "v", "loop").grid);
    const near: number[] = [];
    for (let k = 0; k < f.heights.length; k++) if (f.depth[k]! > 0.4 && f.depth[k]! <= 0.8) near.push(f.heights[k]!);
    near.sort((a, b) => a - b);
    expect(near[near.length >> 1]).toBeLessThan(0.6);
  });

  it("builds a mesh whose rock tops face up", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const grid = generateArea(1, "v", "loop").grid;
    const mesh = buildCliffs(scene, grid, new PBRMaterial("m", scene))!;
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    let up = 0, down = 0;
    for (let v = 0; v < pos.length / 3; v++) if (pos[v * 3 + 1]! > 2) (nrm[v * 3 + 1]! > 0 ? up++ : down++);
    expect(up).toBeGreaterThan(down * 10);
    expect(cliffVertexData(cliffHeights(grid))).not.toBeNull();
    engine.dispose();
  });

  it("fades and floors only the cliff, never the rocks sharing its wall material", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const wall = new PBRMaterial("wall", scene);
    const mesh = buildCliffs(scene, generateArea(1, "v", "loop").grid, wall)!;
    expect(mesh.material).not.toBe(wall);
    expect(mesh.material!.pluginManager?.getPlugin("ExiledCliff")).toBeTruthy();
    expect(wall.pluginManager?.getPlugin("ExiledCliff") ?? null).toBeNull();
    expect(cliffMaterial(wall)).toBe(mesh.material);
    engine.dispose();
  });
});
