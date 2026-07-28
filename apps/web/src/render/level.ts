import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Texture,
  Vector4,
  VertexBuffer,
  type Scene,
} from "@babylonjs/core";
import { FLOOR_TILES, GROUND_SIZE } from "./engine";
import {
  DEBRIS_MESH_PREFIX,
  RAMPART_MESH_PREFIX,
  buildRocks,
  clearRocks,
  isRocksReady,
  scatterDebris,
  scatterRampart,
  scatterRocks,
  type RockCell,
} from "./rocks";
import type { WalkableGrid } from "@exiled/mapgen";

/** Wall height in world units, capped at roughly the player's own 1.8. At 3.5 a
 *  wall cell was seven times taller than it was thick and every isolated one
 *  stood up as a tower; worse, the camera sits ~49 degrees above the horizon, so
 *  a wall of height h hides h/tan(49) ≈ 0.87h of world behind it, and 3.5 hid
 *  three units — the character disappeared behind any wall he walked south of.
 *  At 1.8 his head clears the wall he is directly behind. Raise this and you owe
 *  the frame an occlusion fade, not just a taller box. */
const WALL_HEIGHT = 1.8;

/** Height of the box band once rocks are carrying the silhouette. The band stops
 *  being the wall and becomes the thing that stops daylight showing BETWEEN the
 *  boulders — a kerb the rocks sit in, not a wall.
 *
 *  It has to stay SHORT. The scatter drops a cell whose neighbours already have a
 *  rock, which happens most at an inside corner where two runs meet, and whatever
 *  the band is tall it shows there as a bare rectangular slab with two right
 *  angles — the one shape this whole pass exists to get off the screen. At 0.55
 *  those slabs were the loudest thing left in the frame. */
const BAND_HEIGHT = 0.3;

/** How many cells of wall are drawn outward from the floor. ONE. Three was an
 *  attempt to give a doorway the reveal PoE1's has, and it was the wrong read of
 *  the reference: the band is grown by a Chebyshev neighbourhood, so widening it
 *  fattens every wall in the map at once and turns each corner into a 3-cell
 *  staircase. The frame went to grey bars with floor in the channels between
 *  them. In the reference the ground holds ~70% of the frame and the rock is a
 *  dark border, so depth at a door has to come from the wall's face, never from
 *  extruding the whole band. */
const WALL_THICK_CELLS = 1;

/** How much of the wall texture reaches the TOP face. The single loudest thing
 *  saying "box" was that at this camera the wall tops were the brightest pixels
 *  on screen, brighter than the floor: a lit plateau on every wall, which is
 *  exactly the read Minecraft has and exactly what PoE never shows — its rock
 *  goes to near-black the moment it turns away from the ground. Darkening the
 *  cap turns a lit box back into a silhouetted mass. */
const TOP_SHADE = 0.22;

/** Albedo the wall stone is lit at. This was 1.15 — nearly the floor's own 1.45 —
 *  and that was correct while a wall was a box: its faces were all vertical, they
 *  only ever caught the sun at a grazing angle, and at 0.62 the masonry crushed to
 *  mud. A rock is not a box. Half its facets point at the sky, they take the key
 *  light square on, and at 1.15 the boundary came out brighter than the ground it
 *  borders — the exact inversion of the reference, where rock is the dark frame
 *  around a bright floor. The plate itself is already lifted to 120 luma by
 *  `tools/build_tileset_textures.py`, so the exposure has to come back down here. */
/** Albedo multiplier on the biome's wall plate.
 *
 *  NOT the 0.5 the StandardMaterial rig used: that was a brightness trim on a
 *  diffuse term, while under PBR it is a reflectance and the plate already
 *  carries its own value, so halving it twice crushed every rock facet to the
 *  same near-black.
 *
 *  Not 0.95 either, which was the correction overshooting. It was chosen while
 *  the boulders were drawing the debris matrix buffer, so the only stone on
 *  screen was pebble-sized and pale rock looked like the fix; with real
 *  boulders it made the walls brighter than the ground and inverted the rule
 *  the tint pass exists to hold. Stone reflects about a fifth to a third of
 *  what hits it, the plate is already lifted to 120 luma by
 *  `tools/build_tileset_textures.py`, and the ground has to stay the bright
 *  thing. */
const ROCK_ALBEDO = 0.62;

/** Weathered stone. Lower than the ground's 0.92 on purpose: a rock face is
 *  smoother than loose dirt, and the small sheen difference is what separates
 *  the two materials now that both are lit by the same physical model. */
const ROCK_ROUGHNESS = 0.78;
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
function wallMaterial(scene: Scene, tilesetId: string): PBRMaterial {
  const name = `${WALL_MAT_NAME}-${tilesetId}`;
  const existing = scene.getMaterialByName(name) as PBRMaterial | null;
  if (existing) return existing;
  const dir = tilesetDir(tilesetId);
  // PBR, same reason as the floor (engine.ts): the boulders are the one surface
  // in the frame with facets at every angle, and only a roughness term makes the
  // sun break across them instead of shading each facet by its normal alone.
  const mat = new PBRMaterial(name, scene);
  mat.metallic = 0;
  mat.roughness = ROCK_ROUGHNESS;
  mat.albedoTexture = new Texture(`${dir}/wall_color.jpg`, scene);
  mat.bumpTexture = new Texture(`${dir}/wall_normal.jpg`, scene);
  // The floor albedo is boosted to 1.45 (engine.ts) so near-black actors read;
  // a wall at 0.62 was ~2.3x darker and crushed the light masonry texture to a
  // muddy near-black. Lift close to the floor, kept a touch cooler+darker so the
  // walls still read as distinct from the ground rather than merging into it.
  mat.albedoColor = new Color3(ROCK_ALBEDO, ROCK_ALBEDO, ROCK_ALBEDO * 1.06);
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
/**
 * Cut the ground plane down to the area it is the ground OF. The plane is 200
 * units square because `scene.pick` once needed a mesh under every reachable
 * pixel; the cursor now meets the floor plane analytically (`bindings.ts`), so
 * nothing needs ground where the player cannot go, and lit grass stretching
 * past the outer wall was the one thing that said "greybox" loudest.
 *
 * Scaling, not rebuilding: the mesh keeps its UVs, so the texture repeat is
 * scaled with it to hold the tile size constant (`applyTilesetFloor` reads the
 * same scaling back when it swaps a biome's plate in).
 */
function fitGround(scene: Scene, grid: WalkableGrid | null): void {
  const ground = scene.getMeshByName("ground");
  if (!ground) return;
  if (!grid) {
    ground.scaling.set(1, 1, 1);
    ground.position.set(0, 0, 0);
  } else {
    const { cols, rows, cellSize, originX, originY } = grid;
    ground.scaling.set((cols * cellSize) / GROUND_SIZE, 1, (rows * cellSize) / GROUND_SIZE);
    // Cell (0,0) is CENTRED on the origin, so the rect runs half a cell further
    // out at each edge and its middle sits half a cell short of the far corner.
    ground.position.set(
      originX + ((cols - 1) * cellSize) / 2,
      0,
      originY + ((rows - 1) * cellSize) / 2,
    );
  }
  scaleFloorTexture(scene, ground.scaling.x, ground.scaling.z);
}

/** Hold the flagstone size constant however big the ground plane is. */
function scaleFloorTexture(scene: Scene, sx: number, sz: number): void {
  const mat = scene.getMaterialByName("groundMat") as PBRMaterial | null;
  const tex = mat?.albedoTexture as Texture | null;
  if (!tex) return;
  tex.uScale = FLOOR_TILES * sx;
  tex.vScale = FLOOR_TILES * sz;
}

/**
 * Shade a wall box's top face down. Per-vertex rather than per-material because
 * the runs are merged into ONE mesh (a second material would mean a second draw
 * per wall, and the merge exists precisely to avoid that); colour rides along in
 * the merge, and `useVertexColors` is on by default.
 *
 * Keyed off the normal, not the face index, so it cannot silently paint the
 * wrong side if Babylon reorders CreateBox's faces.
 */
function shadeTopFace(box: Mesh): void {
  const normals = box.getVerticesData(VertexBuffer.NormalKind);
  if (!normals) return;
  const colors = new Float32Array((normals.length / 3) * 4);
  for (let n = 0, c = 0; n < normals.length; n += 3, c += 4) {
    const k = (normals[n + 1] ?? 0) > 0.5 ? TOP_SHADE : 1;
    colors[c] = k;
    colors[c + 1] = k;
    colors[c + 2] = k;
    colors[c + 3] = 1;
  }
  box.setVerticesData(VertexBuffer.ColorKind, colors);
}

export function buildLevel(
  scene: Scene,
  grid: WalkableGrid | null,
  tilesetId: string = DEFAULT_TILESET,
): LevelResult {
  // Area swaps (and the open hideout) call this again; drop the previous walls.
  scene.getMeshByName(WALL_MESH_NAME)?.dispose();
  clearRocks();
  fitGround(scene, grid);
  if (!grid) return { walls: null, wallCells: 0 };

  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const isFloor = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === 1;
  // 8-neighbourhood: a wall cell diagonally touching floor is a room corner. Drawing
  // it too fills the corner so the horizontal and vertical walls meet flush (cardinal
  // -only leaves a notch at every corner). Render-only; collision uses the raw grid.
  const isBoundaryWall = (x: number, y: number): boolean => {
    if (cells[y * cols + x] !== 0) return false;
    const n = WALL_THICK_CELLS;
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++)
        if ((dx || dy) && isFloor(x + dx, y + dy)) return true;
    return false;
  };

  // Rocks carry the wall's silhouette when the glb is up; the box band drops to a
  // plinth under them. Without it (headless tests, a failed fetch) the band is
  // the wall again at full height, which is the look this replaced and still plays.
  const rocky = isRocksReady(scene);
  const bandHeight = rocky ? BAND_HEIGHT : WALL_HEIGHT;

  const uH = bandHeight / TILE;
  const uD = cellSize / TILE;
  const boxes: Mesh[] = [];
  const rockCells: RockCell[] = [];
  const floorCells: RockCell[] = [];
  const edgeCells: RockCell[] = [];
  let wallCells = 0;

  // The outermost ring of the grid, floor-adjacent or not. `isBoundaryWall` only
  // sees wall that touches floor, so wherever a map's edge is a thick block of
  // dead cells it drew no rock at all and the ground plate — which is sized to
  // exactly this ring — ended as a lip of bare dirt against the void.
  const isOuterEdge = (x: number, y: number): boolean =>
    x < WALL_THICK_CELLS ||
    y < WALL_THICK_CELLS ||
    x >= cols - WALL_THICK_CELLS ||
    y >= rows - WALL_THICK_CELLS;
  // ponytail: horizontal-run greedy only; add vertical/2D rectangle merging if a
  // profile shows the per-cell vertical walls still cost.
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (!isBoundaryWall(x, y)) {
        // Open floor: a debris candidate. Collected in the same sweep because the
        // walls already cost a full pass over the grid.
        if (rocky && isFloor(x, y))
          floorCells.push({ x: originX + x * cellSize, z: originY + y * cellSize });
        x++;
        continue;
      }
      const runStart = x;
      while (x < cols && isBoundaryWall(x, y)) x++;
      const runLen = x - runStart;
      wallCells += runLen;
      if (rocky)
        for (let i = 0; i < runLen; i++)
          rockCells.push({ x: originX + (runStart + i) * cellSize, z: originY + y * cellSize });

      const width = runLen * cellSize;
      const uW = width / TILE;
      const faceUV = [
        new Vector4(0, 0, uW, uH), new Vector4(0, 0, uW, uH), // ±z faces: width × height
        new Vector4(0, 0, uD, uH), new Vector4(0, 0, uD, uH), // ±x faces: depth × height
        new Vector4(0, 0, uW, uD), new Vector4(0, 0, uW, uD), // ±y faces: width × depth
      ];
      const box = MeshBuilder.CreateBox(
        `wallrun-${runStart}-${y}`,
        { width, depth: cellSize, height: bandHeight, faceUV },
        scene,
      );
      box.position.set(
        originX + (runStart + (runLen - 1) / 2) * cellSize,
        bandHeight / 2,
        originY + y * cellSize,
      );
      shadeTopFace(box);
      boxes.push(box);
    }
  }

  if (wallCells === 0) return { walls: null, wallCells: 0 };

  // disposeSource + 32-bit indices: thousands of boxes can exceed the 16-bit vertex limit.
  const merged = Mesh.MergeMeshes(boxes, true, true, undefined, false, false);
  const material = wallMaterial(scene, tilesetId);
  if (rocky) {
    // Walked as a ring rather than folded into the sweep above: that sweep scans
    // horizontal runs and skips ahead past them, so it cannot see a single cell
    // on a left or right edge without breaking the run merge it exists to do.
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (isOuterEdge(x, y))
          edgeCells.push({ x: originX + x * cellSize, z: originY + y * cellSize });

    buildRocks(scene, scatterRocks(rockCells), material);
    buildRocks(scene, scatterDebris(floorCells), material, DEBRIS_MESH_PREFIX);
    buildRocks(scene, scatterRampart(edgeCells), material, RAMPART_MESH_PREFIX);
  }
  if (merged) {
    merged.name = WALL_MESH_NAME;
    merged.material = material;
    // Walls receive shadows (actors crossing them read correctly) but never cast
    // one — engine.ts excludes "wallrun-*" from the shadow casters, and Babylon
    // names the merged mesh after its first source, so this mesh is excluded too
    // until the rename below. See engine.ts for why walls must not cast.
    merged.receiveShadows = true;
  }
  return { walls: merged, wallCells };
}

/**
 * The floor plate of the shared ground plane. The ground is one 200-unit mesh
 * that outlives every area (click-to-move raycasts against it anywhere), so a
 * biome swaps its texture rather than its geometry. `null` restores the
 * hideout's own flagstones.
 *
 * The floor is the largest surface on screen by far, so this — not the walls —
 * is what actually makes a swamp look like a swamp from an overhead camera.
 */
export function applyTilesetFloor(scene: Scene, tilesetId: string | null): void {
  const mat = scene.getMaterialByName("groundMat") as PBRMaterial | null;
  if (!mat) return;
  const url = tilesetId ? `${tilesetDir(tilesetId)}/floor_color.jpg` : "/textures/floor.png";
  const current = mat.albedoTexture as Texture | null;
  if (current?.url === url) return;
  try {
    const tex = new Texture(url, scene);
    mat.albedoTexture = tex;
    current?.dispose();
    // Same repeat as the hideout's plate, so a biome never changes the SCALE of
    // the ground under the player — only what it is made of. The plane is
    // shrunk to the area, so the repeat follows it or the flagstones grow.
    const ground = scene.getMeshByName("ground");
    scaleFloorTexture(scene, ground?.scaling.x ?? 1, ground?.scaling.z ?? 1);
  } catch {
    /* no canvas under NullEngine; the unloaded texture is fine in tests */
  }
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
  const fill = scene.getLightByName("fill");
  const sun = scene.getLightByName("sun");
  // Normalised to mean 1.0, so a tint shifts HUE and never brightness. Applied
  // raw, Vaal Stone's [0.62,0.70,0.68] took a third out of the ambient term, and
  // an assembled map is mostly corridor floor lying in a wall's shadow — the
  // rooms went to unplayable black. A biome is a colour, not a dimmer.
  const [r, g, b] = tint ?? [1, 1, 1];
  const mean = (r + g + b) / 3;
  const k = mean > 0 ? 1 / mean : 1;
  const nr = r * k, ng = g * k, nb = b * k;
  // The sky fill carries most of it: it is the ambient term, so tinting it
  // colours the shadows, which is where a place's mood actually lives.
  if (fill) fill.diffuse = new Color3(nr, ng, nb);
  // The key light takes a half-strength version, so the tint reads without the
  // lit faces losing the contrast that makes the walls legible.
  if (sun) sun.diffuse = new Color3((1 + nr) / 2, (1 + ng) / 2, (1 + nb) / 2);
}
