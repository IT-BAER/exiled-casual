import {
  Color3,
  Mesh,
  PBRMaterial,
  Texture,
  VertexData,
  VertexBuffer,
  type Nullable,
  type Observer,
  type Scene,
} from "@babylonjs/core";
import type { WalkableGrid } from "@exiled/mapgen";

/** The single merged water mesh. Born with this name, never renamed: engine.ts
 *  filters shadow casters on `onNewMeshAddedObservable`, which reads a name ONCE
 *  — the same trap the wall mesh fell into. */
export const SEA_MESH_NAME = "sea-surface";
const SEA_MAT_NAME = "sea-mat";

/** Two centimetres over the sand. The waterline is then the fill/floor boundary
 *  itself, and a boulder on the rim stands IN shallow water rather than on a
 *  sheet beside it. Any higher and the water climbs the walkable floor. */
const SEA_Y = 0.02;

/** How far past the grid rect the skirt ring reaches, in world units. The camera
 *  shows about nineteen units across and never more than ~8 past the rim, so
 *  this is generous; there is no horizon and none is wanted (see
 *  `reference-screenshots/map boundary(right side).webp` — PoE closes a map edge
 *  with opaque mass fading to black, not with a view). */
const SKIRT_REACH = 60;

/** Cells from the shore that still take foam. Three is one and a half world
 *  units at the 0.5 cell size: a band the eye reads as surf without turning the
 *  whole shallow into a white rim. */
const FOAM_CELLS = 3;

/** How much brighter a foam vertex is than open water. Vertex colour multiplies
 *  albedo, so 1 is the water's own colour and this is the peak at the shoreline. */
const FOAM_GAIN = 2.4;

/** World units per texture repeat for the wave normal, and how fast each of the
 *  two layers travels (repeats per second). Different rates in different
 *  directions on purpose: one scrolling normal is a conveyor belt, two crossing
 *  ones are a surface. */
const WAVE_TILE = 6;
const WAVE_SPEED_U = 0.013;
const WAVE_SPEED_V = 0.009;
const DETAIL_TILE = 2.2;
const DETAIL_SPEED_U = -0.021;
const DETAIL_SPEED_V = 0.017;

/** Shallow water over pale sand, not open ocean. Dark enough to separate from
 *  the strand's 132-luma floor plate, and teal rather than blue because the
 *  biome tint is already cold — a blue sheet under a cold light goes grey. */
const SEA_COLOR = new Color3(0.04, 0.15, 0.16);
const SEA_ROUGHNESS = 0.14;
const SEA_ALPHA = 0.82;

let scrollObserver: Nullable<Observer<Scene>> = null;

/**
 * The water material, cached by name across area builds. Deliberately NOT
 * frozen (unlike the wall's): the two normal offsets are written every frame.
 *
 * No reflection or refraction render target. Both would cost a full extra scene
 * pass per frame to reflect a scene that is black past the rim anyway; the read
 * comes from the moving normals against the low sun instead.
 */
function seaMaterial(scene: Scene): PBRMaterial {
  const existing = scene.getMaterialByName(SEA_MAT_NAME) as PBRMaterial | null;
  if (existing) return existing;
  const mat = new PBRMaterial(SEA_MAT_NAME, scene);
  mat.metallic = 0;
  mat.roughness = SEA_ROUGHNESS;
  mat.albedoColor = SEA_COLOR;
  mat.alpha = SEA_ALPHA;
  // The sand under the shallows has to show through, and the sea is drawn after
  // the ground so back-to-front is already the order it needs.
  mat.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND;
  try {
    const bump = new Texture("/textures/water/water_normal.jpg", scene);
    bump.uScale = 1;
    bump.vScale = 1;
    mat.bumpTexture = bump;
    // The second wave layer. Babylon's detail map is the only way to get a
    // second normal onto one PBR material without a custom shader, and it costs
    // one extra sample rather than a second draw.
    const detail = new Texture("/textures/water/water_normal.jpg", scene);
    mat.detailMap.texture = detail;
    mat.detailMap.isEnabled = true;
    mat.detailMap.bumpLevel = 0.7;
    mat.detailMap.diffuseBlendLevel = 0;
    mat.detailMap.roughnessBlendLevel = 0;
  } catch {
    /* no canvas under NullEngine; the untextured material is fine in tests */
  }
  return mat;
}

/** Drive both normal layers. Registered once per scene and left running: it
 *  touches only the material, which outlives the mesh. */
function startScroll(scene: Scene, mat: PBRMaterial): void {
  if (scrollObserver) return;
  scrollObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    const bump = mat.bumpTexture as Texture | null;
    if (bump) {
      bump.uOffset = (bump.uOffset + WAVE_SPEED_U * dt) % 1;
      bump.vOffset = (bump.vOffset + WAVE_SPEED_V * dt) % 1;
    }
    const detail = mat.detailMap.texture as Texture | null;
    if (detail) {
      detail.uOffset = (detail.uOffset + DETAIL_SPEED_U * dt) % 1;
      detail.vOffset = (detail.vOffset + DETAIL_SPEED_V * dt) % 1;
    }
  });
}

export interface SeaResult {
  /** The water mesh, or null when this area has no sea. */
  mesh: Mesh | null;
  /** Grid cells flooded. Zero when nothing outside the rim was reachable. */
  waterCells: number;
}

/**
 * Flood the void outside a map's rim with water.
 *
 * The fill starts from the grid BORDER and spreads over wall cells only, so it
 * reaches everything outside the playable rim and nothing inside it: an interior
 * rock outcrop is a wall pocket the fill can never enter, and without that every
 * boulder mid-map would sit in its own pond.
 *
 * `enabled` is false for every biome but the strand, and then this only clears
 * whatever the last area left behind.
 */
export function buildSea(
  scene: Scene,
  grid: WalkableGrid | null,
  enabled: boolean,
): SeaResult {
  // Disposed per area build, exactly like the wall runs: a mesh left in the
  // render list is the leak the wall boxes already had once.
  scene.getMeshByName(SEA_MESH_NAME)?.dispose();
  if (!grid || !enabled) return { mesh: null, waterCells: 0 };

  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const isFloor = (x: number, y: number): boolean => cells[y * cols + x] === 1;

  // Border flood over wall cells. `dist` doubles as the visited set and, after
  // the second pass below, as cells-from-the-shore for the foam.
  const water = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    const i = y * cols + x;
    if (water[i] || isFloor(x, y)) return;
    water[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < cols; x++) {
    push(x, 0);
    push(x, rows - 1);
  }
  for (let y = 0; y < rows; y++) {
    push(0, y);
    push(cols - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % cols;
    const y = (i - x) / cols;
    if (x > 0) push(x - 1, y);
    if (x < cols - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < rows - 1) push(x, y + 1);
  }

  // Cells-from-the-shore, BFS over the flooded cells from every one that touches
  // floor. The fill already knows where the shore is, so the foam band is free.
  const dist = new Int16Array(cols * rows).fill(-1);
  let queue: number[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!water[i]) continue;
      const shore =
        (x > 0 && isFloor(x - 1, y)) ||
        (x < cols - 1 && isFloor(x + 1, y)) ||
        (y > 0 && isFloor(x, y - 1)) ||
        (y < rows - 1 && isFloor(x, y + 1));
      if (shore) {
        dist[i] = 0;
        queue.push(i);
      }
    }
  for (let d = 1; d <= FOAM_CELLS && queue.length; d++) {
    const next: number[] = [];
    for (const i of queue) {
      const x = i % cols;
      const y = (i - x) / cols;
      const step = (nx: number, ny: number): void => {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
        const j = ny * cols + nx;
        if (!water[j] || dist[j]! >= 0) return;
        dist[j] = d;
        next.push(j);
      };
      step(x - 1, y);
      step(x + 1, y);
      step(x, y - 1);
      step(x, y + 1);
    }
    queue = next;
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const half = cellSize / 2;
  // One quad per cell rather than greedy runs: the runs would be fewer vertices,
  // but the foam is a per-vertex gradient and merged runs have no vertices where
  // the shoreline actually is. The mesh is one draw either way.
  const quad = (x0: number, z0: number, x1: number, z1: number, foam: number): void => {
    const base = positions.length / 3;
    const corners: [number, number][] = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    for (const [px, pz] of corners) {
      positions.push(px, SEA_Y, pz);
      normals.push(0, 1, 0);
      // World-space UVs, so the wave tile size is constant no matter how the
      // quads are cut up.
      uvs.push(px / WAVE_TILE, pz / WAVE_TILE);
      const k = 1 + foam * (FOAM_GAIN - 1);
      colors.push(k, k, k, 1);
    }
    // Wound so the face points UP. Babylon is left-handed and culls back faces,
    // so a +Y normal in the vertex data is not what decides visibility: the
    // reversed winding drew a sheet that was correct in every way except that it
    // could only be seen from underneath the map.
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  let waterCells = 0;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!water[i]) continue;
      waterCells++;
      const d = dist[i]!;
      const foam = d < 0 ? 0 : 1 - d / (FOAM_CELLS + 1);
      const cx = originX + x * cellSize;
      const cz = originY + y * cellSize;
      quad(cx - half, cz - half, cx + half, cz + half, foam);
    }

  if (waterCells === 0) return { mesh: null, waterCells: 0 };

  // The skirt: four quads ringing the grid rect, so the water does not simply
  // stop at the outermost cell the fill reached. A single big quad UNDER
  // everything would also cover the playable floor, which sits 2cm below it.
  const minX = originX - half;
  const minZ = originY - half;
  const maxX = originX + (cols - 1) * cellSize + half;
  const maxZ = originY + (rows - 1) * cellSize + half;
  const R = SKIRT_REACH;
  quad(minX - R, minZ - R, maxX + R, minZ, 0);
  quad(minX - R, maxZ, maxX + R, maxZ + R, 0);
  quad(minX - R, minZ, minX, maxZ, 0);
  quad(maxX, minZ, maxX + R, maxZ, 0);

  const mesh = new Mesh(SEA_MESH_NAME, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.colors = colors;
  data.applyToMesh(mesh);
  mesh.hasVertexAlpha = false;
  const mat = seaMaterial(scene);
  mesh.material = mat;
  // Click-to-move raycasts the floor plane analytically, but a pickable sheet
  // over the whole void would still catch anything that does pick meshes.
  mesh.isPickable = false;
  // Water neither casts (engine.ts filters it out by name) nor receives: a
  // shadow on a moving surface at this camera reads as a stain.
  mesh.receiveShadows = false;
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
  startScroll(scene, mat);
  return { mesh, waterCells };
}

/** Vertex colour data of the built mesh, for tests. */
export function seaColors(mesh: Mesh): Float32Array | null {
  const data = mesh.getVerticesData(VertexBuffer.ColorKind);
  return data ? Float32Array.from(data) : null;
}
