import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type Scene,
} from "@babylonjs/core";
import type { WalkableGrid } from "@pact/mapgen";

/** Wall height in world units — tall enough to read as walls, not kerbs, under
 *  the ~9.5u-tall isometric view; greybox, tune against the boss framing later. */
const WALL_HEIGHT = 2;
const WALL_MESH_NAME = "level-walls";

export interface LevelResult {
  /** The single merged wall mesh, or null when the grid has no visible walls. */
  walls: Mesh | null;
  /** Boundary wall cells rendered (a wall cell touching floor). */
  wallCells: number;
}

/**
 * Build the level's grid-driven geometry from the walkable grid. Today that is
 * the walls only; the floor stays the shared full-size pickable ground plane so
 * click-to-move can raycast anywhere (a grid-clipped floor would miss clicks
 * aimed into walls). Grid sim-coords map x→x, y→z, matching the renderer.
 *
 * Only wall cells (0) that border a floor cell (1) are drawn: interior wall
 * cells are never seen from above. Each boundary cell is a box, and all boxes
 * are merged into ONE mesh — an 80×80 grid can have thousands of wall cells, and
 * one draw call is the difference between smooth and a slideshow.
 */
export function buildLevel(scene: Scene, grid: WalkableGrid): LevelResult {
  // Area swaps (Phase D) call this again; drop the previous walls so they don't leak.
  scene.getMeshByName(WALL_MESH_NAME)?.dispose();

  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const isFloor = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === 1;

  let mat = scene.getMaterialByName("level-wall-mat") as StandardMaterial | null;
  if (!mat) {
    mat = new StandardMaterial("level-wall-mat", scene);
    mat.diffuseColor = new Color3(0.14, 0.14, 0.17); // cold grey dungeon stone
    mat.emissiveColor = new Color3(0.02, 0.02, 0.03); // faint self-light so it isn't pure black
    mat.specularColor = new Color3(0, 0, 0);
  }

  const boxes: Mesh[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (cells[y * cols + x] === 1) continue; // floor cell, nothing to build
      if (!(isFloor(x + 1, y) || isFloor(x - 1, y) || isFloor(x, y + 1) || isFloor(x, y - 1)))
        continue; // interior wall — never visible from above
      const box = MeshBuilder.CreateBox(
        `wallcell-${x}-${y}`,
        { width: cellSize, depth: cellSize, height: WALL_HEIGHT },
        scene,
      );
      box.position.set(originX + x * cellSize, WALL_HEIGHT / 2, originY + y * cellSize);
      boxes.push(box);
    }
  }

  const wallCells = boxes.length;
  if (wallCells === 0) return { walls: null, wallCells: 0 };

  // disposeSource + 32-bit indices: thousands of boxes can exceed the 16-bit vertex limit.
  const merged = Mesh.MergeMeshes(boxes, true, true, undefined, false, false);
  if (merged) {
    merged.name = WALL_MESH_NAME;
    merged.material = mat;
    merged.receiveShadows = true;
  }
  return { walls: merged, wallCells };
}
