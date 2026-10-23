import {
  Color3,
  Constants,
  Mesh,
  PBRMaterial,
  RawTexture,
  Texture,
  VertexData,
  type Observer,
  type Scene,
} from "@babylonjs/core";
import type { Shoreline, WalkableGrid } from "@exiled/mapgen";
import { dressFenWater } from "./fen-water";
import { waterSplash } from "./splash";
import { FEN_CHURN_FOAM, FEN_MONSTER, WAKE_CELLS, WakeField, WakeStirrer, shoreDepth, type Footfall, type MonsterWake, type WakeBody, type WaterDepth } from "./wake";
import {
  COAST_WATER,
  FEN_WATER,
  WATER_DATA_KIND,
  dressWater,
  waterPlugin,
  type WaterParams,
  type WaterWake,
} from "./water-surface";

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

/** Cell path: how far out the shore BFS measures, in cells; anything past it
 *  is drawn at this depth. */
const DEPTH_CELLS = 14;

/** World units per texture repeat for the wave normal, and how fast it travels
 *  (repeats per second). The second, crossing layer is the water plugin's
 *  `ripple`: Babylon's detail map wants a packed texture (normal X in alpha),
 *  and fed this RGB map it tilted every normal the same way. */
const WAVE_TILE = 9;
const WAVE_SPEED_U = 0.013;
const WAVE_SPEED_V = 0.009;

/** Low, so the sun breaks into glints on the moving normals. */
const SEA_ROUGHNESS = 0.2;

/** A stand-in for the sky the water has nothing to reflect. Flat water under a
 *  low sun takes almost no diffuse light, so without this the sea is a dark
 *  sheet next to bright sand; a reflection probe would cost a scene pass per
 *  frame to reflect a black void (see the note on the material). */
const SEA_SKY = new Color3(0.035, 0.06, 0.062);

/** Which water: the strand's sea, or the fen's standing pools (swamp). A pool
 *  is still and murky: no surf, no breaker, a slow drift instead of a swell. */
export type SeaLook = "coast" | "fen";
const FEN_MAT_NAME = "fen-mat";
const FEN_SKY = new Color3(0.012, 0.018, 0.012);
const FEN_ROUGHNESS = 0.3;
/** Cells to full depth: pools are a few metres across, not a sea. */
const FEN_DEPTH_CELLS = 5;
/** Wave scroll as a share of the sea's: barely moving, so it reads as still. */
const FEN_SCROLL = 0.2;
const FEN_BUMP = 0.35;

const scrollObservers = new Map<string, Observer<Scene>>();

/** The wake of the water bodies wade (the coast's sea, the fen's pools): the
 *  field, what stirs it, and the texture it reaches the shader through. One per
 *  build, gone with the water. */
interface Wake {
  scene: Scene;
  field: WakeField;
  stirrer: WakeStirrer;
  bytes: Uint8Array;
  texture: RawTexture;
  wake: WaterWake;
  mat: PBRMaterial;
}
let liveWake: Wake | null = null;
const footfalls: Footfall[] = [];
const NO_FOOTFALLS: readonly Footfall[] = [];

function dropWake(): void {
  if (!liveWake) return;
  const plugin = waterPlugin(liveWake.mat);
  if (plugin?.wake === liveWake.wake) plugin.wake = null;
  liveWake.texture.dispose();
  liveWake = null;
}

/** Give `mat` a wake field over water `depth` deep, stirred by `stirSea`. */
function attachWake(scene: Scene, mat: PBRMaterial, depth: WaterDepth, churnFoam?: number, monster?: MonsterWake): void {
  const field = new WakeField(churnFoam);
  field.setDepth(depth);
  const bytes = new Uint8Array(WAKE_CELLS * WAKE_CELLS * 4);
  for (let k = 0; k < bytes.length; k += 4) bytes[k] = bytes[k + 1] = bytes[k + 2] = 128;
  const texture = new RawTexture(
    bytes, WAKE_CELLS, WAKE_CELLS, Constants.TEXTUREFORMAT_RGBA, scene,
    false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const wake: WaterWake = { texture, originX: field.originX, originZ: field.originZ };
  waterPlugin(mat)!.wake = wake;
  liveWake = { scene, field, stirrer: new WakeStirrer(field, depth, monster), bytes, texture, wake, mat };
  // Built with the water, so its shaders compile behind the loading plate.
  waterSplash(scene).onLand = (x, z, size) => dropLanded(scene, x, z, size);
}

/** The thin wash of the last wave throws no splash, only its foam. */
const SPLASH_FROM_DEPTH = -0.4;
/** A drop falling back in: the dent it rings out from (m, and m of depth per m
 *  of drop), and the fleck of white it leaves. */
const DROP_RING_RADIUS = 0.06;
const DROP_DENT = 0.12;
const DROP_FOAM = 0.3;

function splash(scene: Scene, f: Footfall): void {
  if (f.depth < SPLASH_FROM_DEPTH) return;
  waterSplash(scene).burst(f, SEA_Y);
}

/** Ring the water where a drop of its own splash falls back in. */
function dropLanded(scene: Scene, x: number, z: number, size: number): void {
  const w = liveWake;
  if (!w || w.scene !== scene) return;
  w.field.push(x, z, DROP_RING_RADIUS, -DROP_DENT * size);
  w.field.foamAt(x, z, DROP_RING_RADIUS * 1.2, DROP_FOAM);
}

/**
 * Let the bodies standing in the coast's sea or the fen's pools stir it, once
 * per frame: steps the wave field, uploads it while it moves and splashes each
 * foot that comes down in water. A no-op without either. Returns this frame's
 * footfalls.
 */
export function stirSea(scene: Scene, bodies: readonly WakeBody[], dtSeconds: number): readonly Footfall[] {
  const w = liveWake;
  if (!w || w.scene !== scene) return NO_FOOTFALLS;
  // A hitch (a tab in the background) is not ten seconds of physics.
  const dt = Math.min(dtSeconds, 0.05);
  const player = bodies.find((b) => b.player);
  if (player) w.field.follow(player.x, player.z);
  w.stirrer.stir(bodies, dt, footfalls);
  w.field.step(dt);
  if (w.field.pack(w.bytes)) w.texture.update(w.bytes);
  w.wake.originX = w.field.originX;
  w.wake.originZ = w.field.originZ;
  for (const f of footfalls) splash(scene, f);
  return footfalls;
}

/**
 * The water material, cached by name across area builds. Deliberately NOT
 * frozen (unlike the wall's): the two normal offsets are written every frame.
 *
 * No reflection or refraction render target. Both would cost a full extra scene
 * pass per frame to reflect a scene that is black past the rim anyway; the read
 * comes from the moving normals against the low sun instead.
 */
function seaMaterial(scene: Scene, look: SeaLook = "coast"): PBRMaterial {
  const fen = look === "fen";
  const name = fen ? FEN_MAT_NAME : SEA_MAT_NAME;
  const existing = scene.getMaterialByName(name) as PBRMaterial | null;
  if (existing) return existing;
  const mat = new PBRMaterial(name, scene);
  mat.metallic = 0;
  mat.roughness = fen ? FEN_ROUGHNESS : SEA_ROUGHNESS;
  mat.emissiveColor = fen ? FEN_SKY : SEA_SKY;
  // Colour and opacity come from the plugin, per pixel, off the mesh's water data.
  dressWater(mat, !fen, fen ? FEN_WATER : COAST_WATER);
  if (fen) dressFenWater(mat);
  // The sand under the shallows has to show through, and the sea is drawn after
  // the ground so back-to-front is already the order it needs.
  mat.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND;
  try {
    const bump = new Texture("/textures/water/water_normal.jpg", scene);
    bump.uScale = 1;
    bump.vScale = 1;
    if (fen) bump.level = FEN_BUMP;
    mat.bumpTexture = bump;
  } catch {
    /* no canvas under NullEngine; the untextured material is fine in tests */
  }
  return mat;
}

/** Drive the normal layer. Registered once per scene and left running: it
 *  touches only the material, which outlives the mesh. */
function startScroll(scene: Scene, mat: PBRMaterial, rate = 1): void {
  if (scrollObservers.has(mat.name)) return;
  scrollObservers.set(mat.name, scene.onBeforeRenderObservable.add(() => {
    const dt = (scene.getEngine().getDeltaTime() / 1000) * rate;
    const bump = mat.bumpTexture as Texture | null;
    if (bump) {
      bump.uOffset = (bump.uOffset + WAVE_SPEED_U * dt) % 1;
      bump.vOffset = (bump.vOffset + WAVE_SPEED_V * dt) % 1;
    }
  }));
}

/**
 * Distance from the waterline, in world units, of every ring of vertices in the
 * strip. Negative is inland — the water runs UNDER the sand edge and fades out
 * there, so the boundary the eye reads is a wet gradient and not a polygon.
 *
 * Graded, not even: the first two metres carry the surf and need the vertices,
 * the last forty are one flat colour and need two.
 */
const SHORE_BANDS = [
  // Wet sand: the tide's last reach, landward of the water and darker than the
  // dry beach. It is drawn by the same strip because it is the same curve, and
  // in `reference-screenshots/beach-map.jpg` it is as wide as the surf itself.
  -2.4, -1.6, -1.0, -0.5,
  // The surf and the shallows.
  0, 0.2, 0.45, 0.7, 0.95, 1.25, 1.6, 2.1, 2.6, 3.1, 3.7, 4.4, 5.2, 6.1, 7,
  // The second breaker, then open water.
  8.5, 11, 14, 22, 34, SKIRT_REACH,
];

/** Extra samples past each end of the shore curve, in world units, so the sea
 *  does not stop where the map does. */
const SHORE_OVERRUN = SKIRT_REACH;

export interface SeaResult {
  /** The water mesh, or null when this area has no sea. */
  mesh: Mesh | null;
  /** Grid cells flooded. Zero when nothing outside the rim was reachable. */
  waterCells: number;
}

/**
 * The sea as a strip laid along the shoreline curve.
 *
 * One ring of vertices per band out from the waterline, one column per sample of
 * the curve, and the curve is the generator's own float-per-column shore — so
 * the waterline is exactly as smooth as the sines that drew it, at any zoom.
 */
function buildShoreSea(scene: Scene, shore: Shoreline): SeaResult {
  const n = shore.cross.length;
  // The curve, plus one flat sample past each end so the water runs off the map
  // rather than stopping square with it.
  const alongOf = (i: number): number =>
    i < 0 ? shore.start - SHORE_OVERRUN
      : i >= n ? shore.start + (n - 1) * shore.step + SHORE_OVERRUN
        : shore.start + i * shore.step;
  const crossOf = (i: number): number =>
    shore.cross[Math.min(n - 1, Math.max(0, i))]!;

  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const water: number[] = [];
  const bands = SHORE_BANDS.length;

  for (let i = -1; i <= n; i++) {
    const a = alongOf(i);
    const c = crossOf(i);
    for (const band of SHORE_BANDS) {
      const cross = c + shore.seaSide * band;
      const px = shore.along === "x" ? a : cross;
      const pz = shore.along === "x" ? cross : a;
      positions.push(px, SEA_Y, pz);
      normals.push(0, 1, 0);
      uvs.push(px / WAVE_TILE, pz / WAVE_TILE);
      // Both linear across every quad, so the shader's per-pixel surf is exact.
      water.push(band, a);
    }
  }

  const cols = n + 2; // the -1 and n samples
  for (let i = 0; i + 1 < cols; i++)
    for (let b = 0; b + 1 < bands; b++) {
      const v00 = i * bands + b;
      const v10 = (i + 1) * bands + b;
      const v01 = v00 + 1;
      const v11 = v10 + 1;
      // Wound to face up; see the note in the cell path. Which winding that is
      // depends on which side the sea lies on, because mirroring the strip
      // mirrors its triangles with it.
      if (shore.seaSide > 0) indices.push(v00, v10, v11, v00, v11, v01);
      else indices.push(v00, v11, v10, v00, v01, v11);
    }

  const mesh = new Mesh(SEA_MESH_NAME, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.applyToMesh(mesh);
  mesh.setVerticesData(WATER_DATA_KIND, water, false, 2);
  const mat = seaMaterial(scene);
  // The swells' faces tilt toward land: away from the sea side, across the shore.
  const toLand = -shore.seaSide;
  const plugin = waterPlugin(mat)!;
  plugin.shore = shore.along === "x" ? [0, toLand] : [toLand, 0];
  attachWake(scene, mat, shoreDepth(shore));
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
  startScroll(scene, mat);
  return { mesh, waterCells: n * bands };
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
 *
 * `true` is the coast's sea; `"fen"` draws `grid.water` as still swamp pools.
 */
export function buildSea(
  scene: Scene,
  grid: WalkableGrid | null,
  enabled: boolean | SeaLook,
): SeaResult {
  // Disposed per area build, exactly like the wall runs: a mesh left in the
  // render list is the leak the wall boxes already had once.
  scene.getMeshByName(SEA_MESH_NAME)?.dispose();
  dropWake();
  if (!grid || !enabled) return { mesh: null, waterCells: 0 };
  const look: SeaLook = enabled === true ? "coast" : enabled;
  const fen = look === "fen";
  lastScene = scene;
  if (import.meta.env?.DEV && typeof window !== "undefined") {
    (window as unknown as { __sea?: unknown }).__sea = tuneSea;
  }

  // A coast hands over the waterline as a CURVE, and then the cells are not
  // involved at all: the sea is a strip laid along it. Everything below this is
  // the older path, which floods the void outside a dungeon rim — there the void
  // has no shape of its own and cell squares are the honest answer.
  if (grid.shore && !fen) return buildShoreSea(scene, grid.shore);
  // A fen floods only what the generator marked; it has no void to fill.
  if (fen && !grid.water) return { mesh: null, waterCells: 0 };

  const { cols, rows, cellSize, originX, originY, cells } = grid;
  // Walkable water (a fen pool) is not its own shore.
  const isFloor = (x: number, y: number): boolean => cells[y * cols + x] === 1 && !grid.water?.[y * cols + x];

  // A coast SAYS which cells are sea, because on a beach it cannot be derived:
  // the cliff behind the player is wall and touches the grid border exactly like
  // the water does. Everywhere else the void outside the rim is all there is, so
  // the border flood below is the whole answer.
  let water = grid.water ? Uint8Array.from(grid.water) : null;
  if (!water) {
    water = new Uint8Array(cols * rows);
    const stack: number[] = [];
    const push = (x: number, y: number): void => {
      const i = y * cols + x;
      if (water![i] || isFloor(x, y)) return;
      water![i] = 1;
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
  const depthCells = fen ? FEN_DEPTH_CELLS : DEPTH_CELLS;
  for (let d = 1; d <= depthCells && queue.length; d++) {
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
  const waterData: number[] = [];
  const half = cellSize / 2;

  // Depth as a CONTINUOUS field sampled at cell corners, not one value per cell.
  // Per-cell it was flat-shaded: every quad took its own depth at all four
  // corners, so the shallows came out as a mosaic of squares and the waterline
  // stepped. A corner value is the mean of the four cells that meet there, land
  // counted as negative, which is what lets the water thin to nothing smoothly
  // across the bank instead of at a cell boundary.
  const LAND_DEPTH = -2;
  const depthOfCell = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return depthCells;
    const i = y * cols + x;
    if (!water[i]) return LAND_DEPTH;
    return dist[i]! < 0 ? depthCells : dist[i]!;
  };
  /** Corner (x,y) is the top-left of cell (x,y) and touches four cells. */
  const cornerDepth = (x: number, y: number): number =>
    (depthOfCell(x - 1, y - 1) + depthOfCell(x, y - 1) +
      depthOfCell(x - 1, y) + depthOfCell(x, y)) / 4;

  const pushVertex = (px: number, pz: number, depth: number): void => {
    positions.push(px, SEA_Y, pz);
    normals.push(0, 1, 0);
    // World-space UVs, so the wave tile size is constant no matter how the
    // quads are cut up.
    uvs.push(px / WAVE_TILE, pz / WAVE_TILE);
    // Metres from the shore, for the shader; a pool has no along-shore axis.
    waterData.push(depth * cellSize, 0);
  };

  /** A quad whose four corners each carry their own depth. */
  const quadAt = (
    x0: number, z0: number, x1: number, z1: number,
    d00: number, d10: number, d11: number, d01: number,
  ): void => {
    const base = positions.length / 3;
    pushVertex(x0, z0, d00);
    pushVertex(x1, z0, d10);
    pushVertex(x1, z1, d11);
    pushVertex(x0, z1, d01);
    // Wound so the face points UP. Babylon is left-handed and culls back faces,
    // so a +Y normal in the vertex data is not what decides visibility: the
    // reversed winding drew a sheet that was correct in every way except that it
    // could only be seen from underneath the map.
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  /** The skirt and the tests want one depth for the whole quad. */
  const quad = (x0: number, z0: number, x1: number, z1: number, depth: number): void =>
    quadAt(x0, z0, x1, z1, depth, depth, depth, depth);

  let waterCells = 0;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!water[i]) continue;
      waterCells++;
      const cx = originX + x * cellSize;
      const cz = originY + y * cellSize;
      quadAt(
        cx - half, cz - half, cx + half, cz + half,
        cornerDepth(x, y), cornerDepth(x + 1, y),
        cornerDepth(x + 1, y + 1), cornerDepth(x, y + 1),
      );
    }

  if (waterCells === 0) return { mesh: null, waterCells: 0 };

  // The skirt, so the water does not stop dead at the outermost cell: each
  // border cell that IS water throws a quad outward. Not a ring around the whole
  // grid — on a coast the far border is a cliff, and a ring would put open sea
  // behind the headland the player is walking under.
  const minX = originX - half;
  const minZ = originY - half;
  const maxX = originX + (cols - 1) * cellSize + half;
  const maxZ = originY + (rows - 1) * cellSize + half;
  const R = SKIRT_REACH;
  for (let x = 0; x < cols; x++) {
    const wx = originX + x * cellSize;
    if (water[x]) quad(wx - half, minZ - R, wx + half, minZ, depthCells);
    if (water[(rows - 1) * cols + x]) quad(wx - half, maxZ, wx + half, maxZ + R, depthCells);
  }
  for (let y = 0; y < rows; y++) {
    const wz = originY + y * cellSize;
    if (water[y * cols]) quad(minX - R, wz - half, minX, wz + half, depthCells);
    if (water[y * cols + cols - 1]) quad(maxX, wz - half, maxX + R, wz + half, depthCells);
  }

  const mesh = new Mesh(SEA_MESH_NAME, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.applyToMesh(mesh);
  mesh.setVerticesData(WATER_DATA_KIND, waterData, false, 2);
  const mat = seaMaterial(scene, look);
  mesh.material = mat;
  // Click-to-move raycasts the floor plane analytically, but a pickable sheet
  // over the whole void would still catch anything that does pick meshes.
  mesh.isPickable = false;
  // Water neither casts (engine.ts filters it out by name) nor receives: a
  // shadow on a moving surface at this camera reads as a stain.
  mesh.receiveShadows = false;
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
  startScroll(scene, mat, fen ? FEN_SCROLL : 1);
  if (fen) {
    // Metres in from the bank at a cell's middle; land never carries water.
    const pool = water;
    attachWake(scene, mat, (x, z) => {
      const cx = Math.round((x - originX) / cellSize), cy = Math.round((z - originY) / cellSize);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows || !pool[cy * cols + cx]) return -Infinity;
      return (depthOfCell(cx, cy) + 0.5) * cellSize;
    }, FEN_CHURN_FOAM, FEN_MONSTER);
  }
  return { mesh, waterCells };
}

/**
 * Live tuning from the devtools console, DEV only, without a rebuild:
 * `__sea({ coast: { body: [0.02, 0.06, 0.05], swash: [7, 1.6, 5.5, 1] } })`.
 * Each key replaces that field of the look's `WaterParams`; the plugin reads
 * them on the next frame. Returns both looks' current values.
 */
let lastScene: Scene | null = null;

export function tuneSea(patch: { coast?: Partial<WaterParams>; fen?: Partial<WaterParams> } = {}): string {
  const out: Record<string, WaterParams | null> = {};
  for (const [look, name] of [["coast", SEA_MAT_NAME], ["fen", FEN_MAT_NAME]] as const) {
    const plugin = waterPlugin(lastScene?.getMaterialByName(name));
    if (plugin && patch[look]) Object.assign(plugin.params, patch[look]);
    out[look] = plugin?.params ?? null;
  }
  return JSON.stringify(out);
}
