// @vitest-environment node
import { describe, it, expect } from "vitest";
import { generateArea, type GrammarId, type WalkableGrid } from "@exiled/mapgen";
import { NullEngine, VertexBuffer } from "@babylonjs/core";
import { createScene, BETA_LIMIT, CAMERA_ALPHA } from "./engine";
import { buildCliffs, cliffHeights, cliffMaterial, cliffVertexData, CLIFF_FRONT, type CliffField } from "./cliffs";
import { PBRMaterial } from "@babylonjs/core";

const MAPS: [GrammarId, number][] = [["loop", 1], ["loop", 7], ["sunken-ruins", 3], ["open-field", 5]];

describe("cliffs", () => {
  it("never stands rock where the player's body reaches", () => {
    // The foot may wander off the collision face, but rock deeper than SINK into
    // a disc the sim lets him stand in would cover his feet.
    const R = 0.5, SINK = 0.15;
    for (const [g, seed] of MAPS) {
      const grid = generateArea(seed, "v", g).grid;
      const f = cliffHeights(grid);
      const bad: string[] = [];
      for (let j = 0; j < f.nz; j++) for (let i = 0; i < f.nx; i++) {
        if (f.heights[j * f.nx + i]! <= 0.02 || f.depth[j * f.nx + i]! > 1.5) continue;
        const x = f.x0 + i * f.step, z = f.z0 + j * f.step;
        if (wallDistance(grid, x, z) >= R) { bad.push(`${x},${z}`); continue; }
        for (let a = 0; a < 16 && bad.length < 5; a++) {
          const cx = x + Math.cos((a * Math.PI) / 8) * (R - SINK), cz = z + Math.sin((a * Math.PI) / 8) * (R - SINK);
          if (wallDistance(grid, cx, cz) >= R) { bad.push(`${x},${z}`); break; }
        }
      }
      expect(bad, `${g} ${seed}`).toEqual([]);
    }
  }, 30_000);

  it("rounds the corners of an obstacle", () => {
    // 36 square islands: the foot starts further in on a corner's diagonal than on
    // a face, by the rounding radius, averaged so the wobble cancels.
    const S = 8, P = 20;
    const grid = gridOf(120, 120, (x, y) => x % P >= 6 && x % P < 6 + S && y % P >= 6 && y % P < 6 + S);
    const f = cliffHeights(grid);
    const corner: number[] = [], face: number[] = [];
    const edge = (c: number) => c * grid.cellSize - grid.cellSize / 2;
    for (let a = 6; a < 120; a += P) for (let b = 6; b < 120; b += P) {
      const x0 = edge(a), x1 = edge(a + S), z0 = edge(b), z1 = edge(b + S);
      const r = Math.SQRT1_2;
      corner.push(foot(f, x0, z0, r, r), foot(f, x1, z0, -r, r), foot(f, x0, z1, r, -r), foot(f, x1, z1, -r, -r));
      face.push(foot(f, (x0 + x1) / 2, z0, 0, 1), foot(f, (x0 + x1) / 2, z1, 0, -1),
        foot(f, x0, (z0 + z1) / 2, 1, 0), foot(f, x1, (z0 + z1) / 2, -1, 0));
    }
    // Bounded by MAX_CUT, which keeps a one-cell bump from being rounded away.
    expect(mean(corner) - mean(face)).toBeGreaterThan(0.08);
  });

  it("wobbles a straight wall face instead of ruling it", () => {
    const grid = gridOf(120, 120, (x) => x < 60);
    const f = cliffHeights(grid);
    const feet: number[] = [];
    for (let z = 10; z < 50; z += 0.1) feet.push(31.5 - foot(f, 31.5, z, -1, 0));
    const m = mean(feet);
    const sd = Math.sqrt(mean(feet.map((v) => (v - m) ** 2)));
    expect(sd).toBeGreaterThan(0.06);
  });

  it("keeps the foot's round, wandering outline up the kerb, not the cell staircase", () => {
    // Driven by collision depth alone, the kerb drew every wall as ruled, square-cornered blocks.
    const H = 0.7;
    const wall = cliffHeights(gridOf(120, 120, (x) => x < 60));
    const feet: number[] = [];
    for (let z = 10; z < 50; z += 0.1) feet.push(foot(wall, 31.5, z, -1, 0, H));
    const m = mean(feet);
    expect(Math.sqrt(mean(feet.map((v) => (v - m) ** 2)))).toBeGreaterThan(0.06);
    const isles = cliffHeights(gridOf(120, 120, (x, y) => x % 20 >= 6 && x % 20 < 14 && y % 20 >= 6 && y % 20 < 14));
    const corner: number[] = [], face: number[] = [];
    const edge = (c: number) => c * 0.5 - 0.25, r = Math.SQRT1_2;
    for (let a = 6; a < 120; a += 20) for (let b = 6; b < 120; b += 20) {
      const x0 = edge(a), x1 = edge(a + 8), z0 = edge(b), z1 = edge(b + 8);
      corner.push(foot(isles, x0, z0, r, r, H), foot(isles, x1, z1, -r, -r, H));
      face.push(foot(isles, (x0 + x1) / 2, z0, 0, 1, H), foot(isles, x1, (z0 + z1) / 2, -1, 0, H));
    }
    expect(mean(corner) - mean(face)).toBeGreaterThan(0.2);
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

  it("stands a visible rock on every obstacle standing in the open", () => {
    // A wall island is all scree by depth alone, and scree wears the floor plate:
    // a two-unit obstacle drew as flat sand that the sim still collides against.
    for (const [g, seed] of [["open-field", 5], ["open-field", 9], ["sunken-ruins", 3]] as const) {
      const grid = generateArea(seed, "v", g).grid;
      const { cols, rows, cells } = grid;
      const f = cliffHeights(grid);
      const seen = new Uint8Array(cols * rows);
      for (let s = 0; s < cells.length; s++) {
        if (cells[s] !== 0 || seen[s]) continue;
        const comp = [s];
        seen[s] = 1;
        let edge = false;
        for (let h = 0; h < comp.length; h++) {
          const i = comp[h]!, x = i % cols, y = (i - x) / cols;
          if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) edge = true;
          for (const j of [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
            if (j >= 0 && j < cells.length && cells[j] === 0 && !seen[j]) { seen[j] = 1; comp.push(j); }
          }
        }
        if (edge || comp.length < 9) continue;
        let peak = 0;
        for (const i of comp) {
          const x = i % cols, y = (i - x) / cols;
          peak = Math.max(peak, f.heights[(y * 2 + 1) * f.nx + x * 2 + 1]!);
        }
        expect(peak, `${g} ${seed}: island of ${comp.length} at cell ${comp[0]! % cols},${Math.floor(comp[0]! / cols)}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("stands visible rock at the collision edge of every wall, thin ones too", () => {
    // Low scree inside the blocked cells reads as floor: the player stops on open
    // ground short of the rock. March from each face into the wall it bounds.
    const VIS = 0.3, GAP = 0.5;
    for (const [g, seed] of [...MAPS, ["open-field", 9], ["sunken-ruins", 8]] as const) {
      const grid = generateArea(seed, "v", g).grid;
      const { cols, rows, cells, cellSize: cs, originX, originY } = grid;
      const f = cliffHeights(grid);
      const isWall = (x: number, z: number) => {
        const cx = Math.round((x - originX) / cs), cy = Math.round((z - originY) / cs);
        return !(cx >= 0 && cy >= 0 && cx < cols && cy < rows && cells[cy * cols + cx] === 1);
      };
      const bad: string[] = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (cells[y * cols + x] !== 1) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const wx = x + dx, wy = y + dy;
          if (wx < 2 || wy < 2 || wx >= cols - 2 || wy >= rows - 2 || cells[wy * cols + wx] !== 0) continue;
          const fx = originX + (x + dx / 2) * cs, fz = originY + (y + dy / 2) * cs;
          let seen = false;
          for (let t = 0.02; t <= GAP && isWall(fx + dx * t, fz + dy * t); t += 0.02) {
            if (heightAt(f, fx + dx * t, fz + dy * t) >= VIS) { seen = true; break; }
          }
          if (!seen) bad.push(`${wx},${wy}`);
        }
      }
      expect(bad.length, `${g} ${seed}: flat faces at ${bad.slice(0, 6).join(" ")}`).toBe(0);
    }
  }, 60_000);

  it("stands well over the player where the camera looks at solid rock", () => {
    const f = cliffHeights(generateArea(1, "v", "loop").grid);
    let tall = 0, raised = 0;
    for (const h of f.heights) { if (h > 0) raised++; if (h > 3.5) tall++; }
    expect(tall / raised).toBeGreaterThan(0.05);
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

function gridOf(cols: number, rows: number, wall: (x: number, y: number) => boolean): WalkableGrid {
  const cells = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells[y * cols + x] = wall(x, y) ? 0 : 1;
  return { cols, rows, cellSize: 0.5, originX: 0, originY: 0, cells };
}

/** Bilinear height of the field at world (x, z). */
function heightAt(f: CliffField, x: number, z: number): number {
  const i = (x - f.x0) / f.step, j = (z - f.z0) / f.step;
  const i0 = Math.floor(i), j0 = Math.floor(j);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= f.nx || j0 + 1 >= f.nz) return 0;
  const h = (a: number, b: number) => f.heights[b * f.nx + a]!;
  const ti = i - i0, tj = j - j0;
  return (h(i0, j0) * (1 - ti) + h(i0 + 1, j0) * ti) * (1 - tj) + (h(i0, j0 + 1) * (1 - ti) + h(i0 + 1, j0 + 1) * ti) * tj;
}

/** Distance marched from (x, z) along (dx, dz) to where rock first stands over `level`. */
function foot(f: CliffField, x: number, z: number, dx: number, dz: number, level = 0.002): number {
  for (let t = 0; t < 3; t += 0.01) if (heightAt(f, x + dx * t, z + dz * t) > level) return t;
  return 3;
}

/** World distance from (x, z) to the nearest wall cell's box; off-grid is wall. */
function wallDistance(grid: WalkableGrid, x: number, z: number): number {
  const { cols, rows, cellSize: cs, originX, originY, cells } = grid;
  const cx = Math.round((x - originX) / cs), cy = Math.round((z - originY) / cs);
  let best = Infinity;
  for (let y = cy - 3; y <= cy + 3; y++) for (let xx = cx - 3; xx <= cx + 3; xx++) {
    if (xx >= 0 && y >= 0 && xx < cols && y < rows && cells[y * cols + xx] === 1) continue;
    const gx = Math.max(0, Math.abs(x - (originX + xx * cs)) - cs / 2);
    const gz = Math.max(0, Math.abs(z - (originY + y * cs)) - cs / 2);
    best = Math.min(best, Math.hypot(gx, gz));
  }
  return best;
}

function mean(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}
