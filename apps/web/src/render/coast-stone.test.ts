// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core";
import type { WalkableGrid } from "@exiled/mapgen";
import type { RockPlacement } from "./rocks";

/** What `buildLevel` asks `buildRocks` to draw, per prefix. Headless, rocks.glb
 *  never loads, so the scatter is captured here and `isRocksReady` faked. */
const drawn = new Map<string, RockPlacement[]>();
vi.mock("./rocks", async (orig) => {
  const actual = await orig<typeof import("./rocks")>();
  return {
    ...actual,
    isRocksReady: () => true,
    buildRocks: (_s: unknown, ps: readonly RockPlacement[], _m: unknown, prefix = actual.ROCK_MESH_PREFIX) => {
      drawn.set(prefix, [...(drawn.get(prefix) ?? []), ...ps]);
      return null;
    },
  };
});

const { createScene } = await import("./engine");
const { buildLevel } = await import("./level");
const { DUNE_MESH_PREFIX, LEDGE_MESH_PREFIX } = await import("./rocks");
const { generateArea } = await import("@exiled/mapgen");
const { CONTENT_VERSION } = await import("@exiled/content-runtime");

let engine: InstanceType<typeof NullEngine>;
afterEach(() => engine?.dispose());

/** How far the stone's top-down disc reaches past the face of the walkable cell it
 *  covers deepest, in world units (negative: it stops short of every face). */
function pastFace(p: RockPlacement, g: WalkableGrid): number {
  const r = p.width / 2;
  let worst = -Infinity;
  const x0 = Math.floor((p.x - r - g.originX) / g.cellSize), x1 = Math.ceil((p.x + r - g.originX) / g.cellSize);
  const y0 = Math.floor((p.z - r - g.originY) / g.cellSize), y1 = Math.ceil((p.z + r - g.originY) / g.cellSize);
  for (let y = Math.max(0, y0); y <= Math.min(g.rows - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(g.cols - 1, x1); x++)
      if (g.cells[y * g.cols + x] === 1)
        worst = Math.max(worst, r - Math.hypot(g.originX + x * g.cellSize - p.x, g.originY + y * g.cellSize - p.z) + g.cellSize / 2);
  return worst;
}

describe("coast stone stays off the sand the player walks on", () => {
  // Playtest F3: the ledge and the blobs were drawn up to 1.3 units over walkable
  // cells, so the player stood half inside rock. Collision keeps his 0.5 body on
  // floor, so 0.3 past a face still stops 0.2 short of his centre.
  it.each([12345, 777, 4242])("seed %i", (seed) => {
    drawn.clear();
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const { grid } = generateArea(seed, CONTENT_VERSION, "coast");
    buildLevel(scene, grid, "tileset.coast");
    for (const prefix of [LEDGE_MESH_PREFIX, DUNE_MESH_PREFIX]) {
      const stones = drawn.get(prefix) ?? [];
      expect(stones.length, prefix).toBeGreaterThan(50);
      const over = stones.filter((p) => pastFace(p, grid) > 0.3 + 1e-6);
      expect(over.map((p) => `(${p.x.toFixed(1)},${p.z.toFixed(1)})`), prefix).toEqual([]);
    }
  });
});
