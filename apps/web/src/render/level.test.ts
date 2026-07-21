// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core";
import { createScene } from "./engine";
import { buildLevel } from "./level";
import type { WalkableGrid } from "@pact/mapgen";

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

// 5×5 grid with a centred 3×3 walkable room (cells (1..3, 1..3)). A wall cell (0)
// is "boundary" when a cardinal neighbour is floor — the 12 edge cells around the
// room qualify; the 4 outer corners do not. 12 is the independent expected value.
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

    expect(result.wallCells).toBe(12);
    expect(scene.getMeshByName("level-walls")).not.toBeNull();
  });

  it("replaces the prior walls when a new area arrives (no mesh leak)", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    buildLevel(scene, roomGrid());
    buildLevel(scene, roomGrid());

    expect(scene.meshes.filter((m) => m.name === "level-walls").length).toBe(1);
  });
});
