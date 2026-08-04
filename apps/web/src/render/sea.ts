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
import type { Shoreline, WalkableGrid } from "@exiled/mapgen";

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

/** The surf, in WORLD UNITS out from the waterline: where the white band is
 *  centred and how wide it runs.
 *
 *  It is a band and not a ramp from the edge, and that distinction is the whole
 *  reason the first attempt had no foam in it: the water has to fade to nothing
 *  AT the waterline to hide the geometry, so a foam that peaks there peaks where
 *  the water is invisible. In `reference-screenshots/beach-map.jpg` the white is
 *  a metre or so OUT from the sand, breaking, with wet dark sand between it and
 *  the dry beach. */
let FOAM_AT = 0.5;
let FOAM_WIDTH = 0.45;

/** Kept for the cell path, which shades by distance in cells. */
const FOAM_CELLS = 4;

/** How far out the water keeps getting deeper, in cells. The colour ramp over
 *  this distance is the single thing that makes it read as sea rather than a
 *  sheet: the reference goes from tan shallows you can see the sand through to
 *  green-grey depth in about ten metres. */
let DEPTH_CELLS = 14;

/** Cells over which the water fades IN from the shoreline (cell path). */
const WET_CELLS = 3;

/** World units over which the coast's water fades in. Short: long enough that
 *  no polygon edge is ever the waterline, short enough that the surf band above
 *  is drawn at something like full strength. */
let WET_UNITS = 0.35;

/** Vertex tint at the shallow and deep ends of that ramp. Multiplies the
 *  material's own albedo, so these are ratios and not colours: warm and pale
 *  over wet sand, cold and dark once the bottom is gone. */
let SHALLOW_TINT: [number, number, number] = [3.8, 3.4, 2.6];
let DEEP_TINT: [number, number, number] = [0.85, 1.2, 1.15];

/** White added at the surf line, on top of the tint. */
let FOAM_ADD = 8;

/** A second, weaker line of broken water further out. Real surf has more than
 *  one breaker, and the reference shows two before the water goes flat; one
 *  line alone reads as a painted border around the sand. */
let BREAKER_AT = 9.5;
let BREAKER_WIDTH = 1.6;
let BREAKER_ADD = 1.1;

/** Wet sand, landward of the waterline: how far it reaches and how much it
 *  darkens the beach. Drawn as part of the water strip (see SHORE_BANDS), so it
 *  follows the same curve and can never drift out of register with it. */
// Reach and strength of the wet band. At 1.4/0.78 it read as a grey ribbon
// drawn just inland of the white surf — an outline around the sand rather than
// sand the tide has been over. Shorter and lighter, it is a tone the eye takes
// for damp.
let WET_SAND_REACH = 1.0;
let WET_SAND_DARKEN = 0.88;

/** World units per texture repeat for the wave normal, and how fast each of the
 *  two layers travels (repeats per second). Different rates in different
 *  directions on purpose: one scrolling normal is a conveyor belt, two crossing
 *  ones are a surface. */
const WAVE_TILE = 9;
const WAVE_SPEED_U = 0.013;
const WAVE_SPEED_V = 0.009;
const DETAIL_TILE = 3.4;
const DETAIL_SPEED_U = -0.021;
const DETAIL_SPEED_V = 0.017;

/** The water's own albedo, BEFORE the shallow-to-deep vertex tint above
 *  multiplies it. Held low and slightly green so the shallow end lands on the
 *  reference's wet tan and the deep end on its grey-green, from one material. */
const SEA_COLOR = new Color3(0.09, 0.13, 0.11);
const SEA_ROUGHNESS = 0.2;
/** Opaque, except where the vertex alpha fades it out at the shore. It was
 *  0.82, and at that value the sand under the water showed through everywhere
 *  — including the boulders' long shadows, which read as dirt floating in the
 *  sea. Only the shallows are meant to be see-through. */
const SEA_ALPHA = 1;

/** A stand-in for the sky the water has nothing to reflect. Flat water under a
 *  low sun takes almost no diffuse light, so without this the sea is a dark
 *  sheet next to bright sand; a reflection probe would cost a scene pass per
 *  frame to reflect a black void (see the note on the material). */
const SEA_SKY = new Color3(0.035, 0.06, 0.062);

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
  mat.emissiveColor = SEA_SKY;
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
    // Same UVs as the base layer, so the second scale has to come from the
    // texture: crests of one size marching over crests of another is what reads
    // as chop rather than a pattern.
    detail.uScale = WAVE_TILE / DETAIL_TILE;
    detail.vScale = WAVE_TILE / DETAIL_TILE;
    mat.detailMap.texture = detail;
    mat.detailMap.isEnabled = true;
    mat.detailMap.bumpLevel = 0.8;
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
  0, 0.2, 0.45, 0.7, 0.95, 1.25, 1.6, 2.1, 2.8, 4, 6,
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
/** Deterministic 0..1 hash of a sample index, so the surf is not the same all
 *  the way down the beach. No RNG: the same map has to draw the same water. */
function wobble(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Shade one vertex of the strip from its distance out to sea, in world units.
 *  `at` and `gain` shift the surf band per sample along the shore: a foam line
 *  of constant width is a painted ribbon, and the reference's is lacy. */
function shoreColor(
  outUnits: number,
  cellSize: number,
  at = FOAM_AT,
  gain = 1,
): [number, number, number, number] {
  // Inland of the waterline this is not water at all: it is the wet sand the
  // last wave left, drawn as a dark multiply over the beach. Alpha rises again
  // going inland, then falls off at the tide's reach.
  if (outUnits < 0) {
    const w = Math.max(0, 1 + outUnits / WET_SAND_REACH);
    return [WET_SAND_DARKEN, WET_SAND_DARKEN * 0.96, WET_SAND_DARKEN * 0.88, w * 0.8];
  }
  const d = outUnits;
  const deep = Math.min(1, d / (DEPTH_CELLS * cellSize));
  // A band, not a ramp: see FOAM_AT. Gaussian so it has no edges of its own.
  const t = (d - at) / FOAM_WIDTH;
  const b = (d - BREAKER_AT) / BREAKER_WIDTH;
  const foam = Math.exp(-t * t) * FOAM_ADD * gain + Math.exp(-b * b) * BREAKER_ADD * gain;
  return [
    SHALLOW_TINT[0] + (DEEP_TINT[0] - SHALLOW_TINT[0]) * deep + foam,
    SHALLOW_TINT[1] + (DEEP_TINT[1] - SHALLOW_TINT[1]) * deep + foam,
    SHALLOW_TINT[2] + (DEEP_TINT[2] - SHALLOW_TINT[2]) * deep + foam,
    // Zero at and inside the waterline: the edge of the water is a gradient with
    // no geometry in it, so there is nothing to stair-step.
    Math.min(1, Math.max(0, outUnits) / WET_UNITS),
  ];
}

/**
 * The sea as a strip laid along the shoreline curve.
 *
 * One ring of vertices per band out from the waterline, one column per sample of
 * the curve, and the curve is the generator's own float-per-column shore — so
 * the waterline is exactly as smooth as the sines that drew it, at any zoom.
 */
function buildShoreSea(scene: Scene, grid: WalkableGrid, shore: Shoreline): SeaResult {
  const { cellSize } = grid;
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
  const colors: number[] = [];
  const bands = SHORE_BANDS.length;

  for (let i = -1; i <= n; i++) {
    const a = alongOf(i);
    const c = crossOf(i);
    // Two low-frequency wobbles, one for where the surf breaks and one for how
    // hard, sampled a few metres apart so the band swells and thins the way a
    // real one does instead of shimmering per vertex.
    const at_ = FOAM_AT + (wobble(Math.floor(i / 7), 1) - 0.5) * 0.5;
    const gain_ = 0.55 + wobble(Math.floor(i / 5), 2) * 0.75;
    for (const band of SHORE_BANDS) {
      const cross = c + shore.seaSide * band;
      const px = shore.along === "x" ? a : cross;
      const pz = shore.along === "x" ? cross : a;
      positions.push(px, SEA_Y, pz);
      normals.push(0, 1, 0);
      uvs.push(px / WAVE_TILE, pz / WAVE_TILE);
      colors.push(...shoreColor(band, cellSize, at_, gain_));
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
  data.colors = colors;
  data.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  const mat = seaMaterial(scene);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
  startScroll(scene, mat);
  return { mesh, waterCells: n * bands };
}

export function buildSea(
  scene: Scene,
  grid: WalkableGrid | null,
  enabled: boolean,
): SeaResult {
  // Disposed per area build, exactly like the wall runs: a mesh left in the
  // render list is the leak the wall boxes already had once.
  scene.getMeshByName(SEA_MESH_NAME)?.dispose();
  if (!grid || !enabled) return { mesh: null, waterCells: 0 };
  lastSeaArgs = { scene, grid };
  if (import.meta.env?.DEV && typeof window !== "undefined") {
    (window as unknown as { __sea?: unknown }).__sea = tuneSea;
  }

  // A coast hands over the waterline as a CURVE, and then the cells are not
  // involved at all: the sea is a strip laid along it. Everything below this is
  // the older path, which floods the void outside a dungeon rim — there the void
  // has no shape of its own and cell squares are the honest answer.
  if (grid.shore) return buildShoreSea(scene, grid, grid.shore);

  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const isFloor = (x: number, y: number): boolean => cells[y * cols + x] === 1;

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
  for (let d = 1; d <= DEPTH_CELLS && queue.length; d++) {
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

  // Depth as a CONTINUOUS field sampled at cell corners, not one value per cell.
  // Per-cell it was flat-shaded: every quad took its own depth at all four
  // corners, so the shallows came out as a mosaic of squares and the waterline
  // stepped. A corner value is the mean of the four cells that meet there, land
  // counted as negative, which is what makes the alpha reach zero smoothly
  // across the shore instead of at a cell boundary.
  const LAND_DEPTH = -2;
  const depthOfCell = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return DEPTH_CELLS;
    const i = y * cols + x;
    if (!water[i]) return LAND_DEPTH;
    return dist[i]! < 0 ? DEPTH_CELLS : dist[i]!;
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
    const d = Math.max(0, depth);
    const deep = Math.min(1, d / DEPTH_CELLS);
    const foam = Math.max(0, 1 - d / FOAM_CELLS) ** 1.5 * FOAM_ADD;
    colors.push(
      SHALLOW_TINT[0] + (DEEP_TINT[0] - SHALLOW_TINT[0]) * deep + foam,
      SHALLOW_TINT[1] + (DEEP_TINT[1] - SHALLOW_TINT[1]) * deep + foam,
      SHALLOW_TINT[2] + (DEEP_TINT[2] - SHALLOW_TINT[2]) * deep + foam,
      Math.min(1, Math.max(0, depth) / WET_CELLS),
    );
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
    if (water[x]) quad(wx - half, minZ - R, wx + half, minZ, DEPTH_CELLS);
    if (water[(rows - 1) * cols + x]) quad(wx - half, maxZ, wx + half, maxZ + R, DEPTH_CELLS);
  }
  for (let y = 0; y < rows; y++) {
    const wz = originY + y * cellSize;
    if (water[y * cols]) quad(minX - R, wz - half, minX, wz + half, DEPTH_CELLS);
    if (water[y * cols + cols - 1]) quad(maxX, wz - half, maxX + R, wz + half, DEPTH_CELLS);
  }

  const mesh = new Mesh(SEA_MESH_NAME, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.colors = colors;
  data.applyToMesh(mesh);
  // The shoreline ramp lives in the vertex alpha, so it has to be read.
  mesh.hasVertexAlpha = true;
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

/**
 * Live tuning from the devtools console, DEV only:
 * `__sea({ FOAM_ADD: 5, SHALLOW_TINT: [3,2.6,2] })` rebuilds the water in place.
 *
 * The alternative is a page reload per number, and a reload means re-entering
 * the map, which costs a Waystone — so the numbers below were guessed rather
 * than looked at, which is how the first surf ended up invisible.
 */
let lastSeaArgs: { scene: Scene; grid: WalkableGrid } | null = null;

export function tuneSea(patch: Record<string, unknown>): string {
  const table: Record<string, (v: unknown) => void> = {
    FOAM_AT: (v) => { FOAM_AT = v as number; },
    FOAM_WIDTH: (v) => { FOAM_WIDTH = v as number; },
    FOAM_ADD: (v) => { FOAM_ADD = v as number; },
    WET_UNITS: (v) => { WET_UNITS = v as number; },
    DEPTH_CELLS: (v) => { DEPTH_CELLS = v as number; },
    SHALLOW_TINT: (v) => { SHALLOW_TINT = v as [number, number, number]; },
    WET_SAND_REACH: (v) => { WET_SAND_REACH = v as number; },
    WET_SAND_DARKEN: (v) => { WET_SAND_DARKEN = v as number; },
    BREAKER_AT: (v) => { BREAKER_AT = v as number; },
    BREAKER_WIDTH: (v) => { BREAKER_WIDTH = v as number; },
    BREAKER_ADD: (v) => { BREAKER_ADD = v as number; },
    DEEP_TINT: (v) => { DEEP_TINT = v as [number, number, number]; },
  };
  for (const [k, v] of Object.entries(patch)) table[k]?.(v);
  if (lastSeaArgs) buildSea(lastSeaArgs.scene, lastSeaArgs.grid, true);
  return JSON.stringify({ FOAM_AT, FOAM_WIDTH, FOAM_ADD, WET_UNITS, DEPTH_CELLS, SHALLOW_TINT, DEEP_TINT, WET_SAND_REACH, WET_SAND_DARKEN, BREAKER_AT, BREAKER_WIDTH, BREAKER_ADD });
}
