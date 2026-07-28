import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector4,
  type Scene,
} from "@babylonjs/core";
import type { WalkableGrid } from "@exiled/mapgen";

/** Wall height in world units — tall enough to read as walls, not kerbs, under
 *  the ~9.5u-tall isometric view; greybox, tune against the boss framing later.
 *  At 2 the short boxes read as flat dark floor-patches from this near-top-down
 *  ortho angle; 3.5 gives a lit brick side face that reads as a real barrier. */
const WALL_HEIGHT = 3.5;
const WALL_MESH_NAME = "level-walls";
const WALL_MAT_NAME = "level-wall-mat";
/** The tileset a map with no base named falls back to. */
const DEFAULT_TILESET = "tileset.vaal_stone";
/** World units per texture repeat, applied via per-box faceUV so bricks keep a
 *  constant size no matter how many cells a merged wall run spans. */
const TILE = 2;

export interface LevelResult {
  /** The single merged wall mesh, or null when the grid has no visible walls. */
  walls: Mesh | null;
  /** Boundary wall cells covered (a wall cell touching floor). */
  wallCells: number;
}

/**
 * Folder holding a tileset's plates. Ids are `tileset.<biome>` and the build
 * script writes `textures/tilesets/<biome>/`, so the id IS the path.
 */
export function tilesetDir(tilesetId: string): string {
  return `/textures/tilesets/${tilesetId.replace(/^tileset\./, "")}`;
}

/**
 * The wall material for one tileset, built once and cached by name. Cached PER
 * TILESET: one shared material would keep the last biome's plates when the
 * player crossed into the next map, because the name would already be taken.
 *
 * The plates are generated per biome and made tiling by
 * `tools/build_tileset_textures.py` — see that script for why the seam pass
 * exists at all.
 */
function wallMaterial(scene: Scene, tilesetId: string): StandardMaterial {
  const name = `${WALL_MAT_NAME}-${tilesetId}`;
  const existing = scene.getMaterialByName(name) as StandardMaterial | null;
  if (existing) return existing;
  const dir = tilesetDir(tilesetId);
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = new Texture(`${dir}/wall_color.jpg`, scene);
  mat.bumpTexture = new Texture(`${dir}/wall_normal.jpg`, scene);
  // The floor albedo is boosted to 1.45 (engine.ts) so near-black actors read;
  // a wall at 0.62 was ~2.3x darker and crushed the light masonry texture to a
  // muddy near-black. Lift close to the floor, kept a touch cooler+darker so the
  // walls still read as distinct from the ground rather than merging into it.
  mat.diffuseColor = new Color3(1.15, 1.15, 1.25);
  mat.specularColor = new Color3(0, 0, 0);
  return mat;
}

/**
 * Build the level's grid-driven walls from the walkable grid, or clear them when
 * `grid` is null (an open area like the hideout lab). The floor stays the shared
 * full-size pickable ground plane so click-to-move can raycast anywhere. Grid
 * sim-coords map x→x, y→z, matching the renderer.
 *
 * Only wall cells (0) bordering a floor cell (1) are drawn — interior walls are
 * never seen from above. Cells are greedy-merged along each row into runs (one
 * box per horizontal run instead of one per cell), then every run box is merged
 * into ONE mesh: an 80×80 dungeon has thousands of wall cells, and both the box
 * count and the draw count decide whether it renders smooth or as a slideshow.
 */
export function buildLevel(
  scene: Scene,
  grid: WalkableGrid | null,
  tilesetId: string = DEFAULT_TILESET,
): LevelResult {
  // Area swaps (and the open hideout) call this again; drop the previous walls.
  scene.getMeshByName(WALL_MESH_NAME)?.dispose();
  if (!grid) return { walls: null, wallCells: 0 };

  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const isFloor = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === 1;
  // 8-neighbourhood: a wall cell diagonally touching floor is a room corner. Drawing
  // it too fills the corner so the horizontal and vertical walls meet flush (cardinal
  // -only leaves a notch at every corner). Render-only; collision uses the raw grid.
  const isBoundaryWall = (x: number, y: number): boolean => {
    if (cells[y * cols + x] !== 0) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && isFloor(x + dx, y + dy)) return true;
    return false;
  };

  const uH = WALL_HEIGHT / TILE;
  const uD = cellSize / TILE;
  const boxes: Mesh[] = [];
  let wallCells = 0;
  // ponytail: horizontal-run greedy only; add vertical/2D rectangle merging if a
  // profile shows the per-cell vertical walls still cost.
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (!isBoundaryWall(x, y)) { x++; continue; }
      const runStart = x;
      while (x < cols && isBoundaryWall(x, y)) x++;
      const runLen = x - runStart;
      wallCells += runLen;

      const width = runLen * cellSize;
      const uW = width / TILE;
      const faceUV = [
        new Vector4(0, 0, uW, uH), new Vector4(0, 0, uW, uH), // ±z faces: width × height
        new Vector4(0, 0, uD, uH), new Vector4(0, 0, uD, uH), // ±x faces: depth × height
        new Vector4(0, 0, uW, uD), new Vector4(0, 0, uW, uD), // ±y faces: width × depth
      ];
      const box = MeshBuilder.CreateBox(
        `wallrun-${runStart}-${y}`,
        { width, depth: cellSize, height: WALL_HEIGHT, faceUV },
        scene,
      );
      box.position.set(
        originX + (runStart + (runLen - 1) / 2) * cellSize,
        WALL_HEIGHT / 2,
        originY + y * cellSize,
      );
      boxes.push(box);
    }
  }

  if (wallCells === 0) return { walls: null, wallCells: 0 };

  // disposeSource + 32-bit indices: thousands of boxes can exceed the 16-bit vertex limit.
  const merged = Mesh.MergeMeshes(boxes, true, true, undefined, false, false);
  if (merged) {
    merged.name = WALL_MESH_NAME;
    merged.material = wallMaterial(scene, tilesetId);
    merged.receiveShadows = true;
  }
  return { walls: merged, wallCells };
}

/**
 * Colour the area's light for its biome. Four wall textures make four places;
 * the light is what makes them four *moods* — a desert should be bleached and a
 * swamp should be sunk, and no amount of masonry does that on its own.
 *
 * Tints multiply the neutral rig, so `null` (the hideout) restores plain white
 * rather than leaving the last map's colour on the lab.
 */
export function applyBiomeTint(scene: Scene, tint: readonly [number, number, number] | null): void {
  const [r, g, b] = tint ?? [1, 1, 1];
  const fill = scene.getLightByName("fill");
  const sun = scene.getLightByName("sun");
  // The sky fill carries most of it: it is the ambient term, so tinting it
  // colours the shadows, which is where a place's mood actually lives.
  if (fill) fill.diffuse = new Color3(r, g, b);
  // The key light takes a half-strength version, so the tint reads without the
  // lit faces losing the contrast that makes the walls legible.
  if (sun) sun.diffuse = new Color3((1 + r) / 2, (1 + g) / 2, (1 + b) / 2);
}
