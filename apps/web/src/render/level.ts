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
import {
  FILL_INTENSITY,
  FLOOR_TILES,
  GROUND_SIZE,
  MAP_FILL_INTENSITY,
  SUN_INTENSITY,
  VOID_COLOR,
  WALL_MESH_NAME,
} from "./engine";
import { tintHaze } from "./haze";
import {
  DEBRIS_MESH_PREFIX,
  RAMPART_MESH_PREFIX,
  buildRocks,
  clearRocks,
  isRocksReady,
  scatterDebris,
  scatterDune,
  scatterDuneRim,
  scatterFlora,
  scatterLedge,
  scatterLedgeWeed,
  scatterRampart,
  scatterRocks,
  scatterWeed,
  DUNE_MESH_PREFIX,
  DUNE_RIM_MESH_PREFIX,
  FLORA_MESH_PREFIX,
  LEDGE_MESH_PREFIX,
  WEED_MESH_PREFIX,
  type RockCell,
} from "./rocks";
import { attachProp } from "./props";
import { standGroundBlob } from "./meshes";
import { setFireSpots, type FireSpot } from "./lights";
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
 *  thing.
 *
 *  And 0.62 did not implement that: it is ABOVE the fifth-to-a-third the line
 *  above argues for, and 0.62x120 lands on the floor's 1.45x55 — dead level in
 *  albedo, then the boulders win outright because a faceted rock catches the low
 *  sun head-on where the flat floor only takes it at a graze. That is why the
 *  screenshot has the stone as the brightest thing in frame. In
 *  `inside-map-battle.webp` the cliffs are the DARKEST thing, near silhouette,
 *  and the saturated floor is what the eye reads.
 *
 *  0.30 was a third of the way through the physical range and STILL came back as
 *  the brightest thing on screen, which is the measurement that settles this: a
 *  boulder is not a wall. Half its facets point at the sky and take this low key
 *  light square on, where the flat floor only ever grazes it, and ACES at
 *  exposure 1.15 then rolls those lit facets toward white. Matching the reference
 *  is therefore not a matter of landing inside stone's albedo range — it is
 *  going UNDER it far enough that a facet in full sun still reads as dark rock.
 *  0.18 is deliberately below the physical fifth-to-a-third for that reason;
 *  the tint pass normalises to mean 1.0, so this is the only place it can come
 *  from. The ground must stay the bright thing in every frame. */
const ROCK_ALBEDO = 0.18;

/** The same number for a coast — see `wallMaterial` for why it is higher. */
const SEA_ROCK_ALBEDO = 0.22;

/** Weathered stone. Lower than the ground's 0.92 on purpose: a rock face is
 *  smoother than loose dirt, and the small sheen difference is what separates
 *  the two materials now that both are lit by the same physical model. */
const ROCK_ROUGHNESS = 0.78;
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
function wallMaterial(scene: Scene, tilesetId: string, sea = false): PBRMaterial {
  const name = `${WALL_MAT_NAME}-${tilesetId}${sea ? "-sea" : ""}`;
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
  // Cool, and harder than the 1.06 blue bias this carried while it was trying to
  // sit next to the floor in value. Hue is the other half of the separation: the
  // reference puts cold desaturated rock against warm saturated ground, while
  // ours had one grey-green doing both. applyBiomeTint drives the LIGHTS, so it
  // moves rock and floor together and can never make this distinction — it has
  // to live in the material.
  // Warm on a coast, cold everywhere else. The cold bias is a DUNGEON rule: it
  // separates rock from ground when both are lit by the same torch, and the rock
  // is the thing in shadow. A shore is lit by open daylight off warm sand and
  // both gameplay references show its rock as brown-ochre with weed in it — under
  // the cold bias ours came off the screen as blue granite, which is the read he
  // rejected outright.
  //
  // And well over ROCK_ALBEDO, which is the other half of the same rule. 0.18 is
  // deliberately under stone's physical range because a dungeon boulder catches
  // a torch square on and would otherwise be the brightest thing in a dark room.
  // A coast has the opposite problem: the plate is a dark brown-and-moss ground
  // scan, the ledge is the DARK thing next to bright sand by construction, and at
  // 0.18 it came off the screen as a black snake against the beach. In the
  // revealed overview the ledge and the sand are close in value.
  const albedo = sea ? SEA_ROCK_ALBEDO : ROCK_ALBEDO;
  mat.albedoColor = sea
    ? new Color3(albedo * 1.2, albedo * 1.02, albedo * 0.78)
    : new Color3(albedo * 0.94, albedo, albedo * 1.14);
  // Nothing mutates this material after this line (biome mood is done through
  // the LIGHTS, see applyBiomeTint), so skip its per-frame dirty checks.
  // checkReadyOnlyOnce still waits for the textures before caching the effect.
  mat.freeze();
  return mat;
}

/** How far BEHIND the boundary line the ledge's tall rows sit, in world units.
 *  The line itself is drawn separately and always low (LEDGE_FRONT in rocks.ts),
 *  because the player can stand on it; everything here is off the playable grid,
 *  which is the only reason it is allowed over his head. Two rows and no more —
 *  at three spanning 2.6 units the wall became a range of hills over most of the
 *  frame. Depth out there is free; it is the FRAME it costs. */
const LEDGE_ROWS = [1.15, 2.3];

/** The scrub over the ledge.
 *
 *  Dry marram, not lawn: `strand-map-layout2.png` runs its whole coastline in a
 *  khaki-olive that is barely green at all, and the one thing that would undo
 *  the ledge is a band of park grass along it. Sampled off the reference's mat
 *  rather than picked, which is why it is this yellow.
 *
 *  Single-sided geometry (tools/build_rocks.py), so culling is off: a blade has
 *  a back, and half a clump vanishing as the camera passes is worse than the
 *  triangles saved. */
const WEED_COLOR = new Color3(0.46, 0.41, 0.21);
const WEED_MAT_NAME = "level-weed-mat";

function weedMaterial(scene: Scene): PBRMaterial {
  const existing = scene.getMaterialByName(WEED_MAT_NAME) as PBRMaterial | null;
  if (existing) return existing;
  const mat = new PBRMaterial(WEED_MAT_NAME, scene);
  mat.metallic = 0;
  mat.roughness = 0.95;
  mat.albedoColor = WEED_COLOR;
  mat.backFaceCulling = false;
  // Dry grass is thin enough that the sun comes through it. A little emission
  // stands in for the transmission a leaf shader would do, and without it a
  // clump on the shaded side of the berm goes to a black smudge.
  mat.emissiveColor = WEED_COLOR.scale(0.18);
  mat.freeze();
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
  // Static between area builds; freezeWorldMatrix recomputes from the scaling
  // just set, so calling it again on the next build picks the new fit up.
  ground.freezeWorldMatrix();
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

/** Prefix every brazier root an area stands up. Cleared on the next build. */
const AREA_BRAZIER_PREFIX = "area-brazier-";

/** Prefix for the beach dressing, cleared the same way. */
const BEACH_PROP_PREFIX = "beach-prop-";

/** How many of each, and how far from the waterline they may lie, in world
 *  units. Shells wash up AT the tide line and driftwood lands further in — the
 *  two bands are what makes the dressing read as "the sea put this here"
 *  rather than as scatter. `reference-screenshots/beach-map.jpg` has the same
 *  gradient: debris thickens toward the water and thins toward the dunes. */
const SHELL_COUNT = 38;
const SHELL_BAND: [number, number] = [0.4, 3.2];
const DRIFTWOOD_COUNT = 9;
const DRIFTWOOD_BAND: [number, number] = [1.5, 9];
/** Outcrops standing IN the surf. Negative reach means seaward of the
 *  waterline: the water is transparent for its first metre, so a rock there
 *  reads as standing in it — which is what both references have along the whole
 *  coast, and what the biome's grey wall stone can never look like. */
const COAST_ROCK_COUNT = 7;
const COAST_ROCK_BAND: [number, number] = [-3.0, 0.4];
/** Wreck debris further up the sand, where a storm tide would strand it. Both
 *  references scatter broken hull timbers and clusters of bleached bone across
 *  the OPEN beach, not just along the waterline — that mid-band is what still
 *  read empty after the shell and driftwood passes. */
const WRECK_TIMBER_COUNT = 6;
const WRECK_TIMBER_BAND: [number, number] = [3.0, 11];
const BONES_COUNT = 8;
const BONES_BAND: [number, number] = [2.0, 10];

/**
 * Dress a coast: shells along the tide line, driftwood up the beach.
 *
 * Deterministic and RNG-free, the same rule the braziers follow: a hash of the
 * index picks the spot, so a screenshot and a replay agree and nothing has to be
 * threaded through the renderer.
 *
 * One clone per item, not thin instances. Sixty-odd extra draws is what a scan
 * mesh costs when it has to sit at an arbitrary yaw on an arbitrary spot, and
 * the alternative is baking the prop's own node transform into every matrix.
 * ponytail: revisit if a frame profile shows the draw count mattering.
 */
function dressBeach(scene: Scene, grid: WalkableGrid): void {
  const shore = grid.shore;
  if (!shore) return;
  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const n = shore.cross.length;
  const rnd = (i: number, salt: number): number => {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const isFloorAt = (wx: number, wz: number): boolean => {
    const cx = Math.round((wx - originX) / cellSize);
    const cy = Math.round((wz - originY) / cellSize);
    if (cx < 1 || cy < 1 || cx >= cols - 1 || cy >= rows - 1) return false;
    return cells[cy * cols + cx] === 1;
  };

  const place = (
    kind: "shell" | "driftwood" | "coastRock" | "wreckTimber" | "bones",
    count: number,
    band: [number, number],
  ): void => {
    for (let i = 0; i < count; i++) {
      // Spread along the shore, then a step inland from the waterline at that
      // sample. Landward is the opposite of the sea side, by definition.
      const salt =
        kind === "shell" ? 3 :
        kind === "driftwood" ? 4 :
        kind === "wreckTimber" ? 17 :
        kind === "bones" ? 23 : 10;
      const s = Math.floor(((i + rnd(i, salt) * 0.7) / count) * (n - 1));
      const along = shore.start + s * shore.step;
      const inland = band[0] + rnd(i, salt + 2) * (band[1] - band[0]);
      const cross = shore.cross[s]! - shore.seaSide * inland;
      const wx = shore.along === "x" ? along : cross;
      const wz = shore.along === "x" ? cross : along;
      // A rock in the water has no floor cell under it, and that is the point.
      if (kind !== "coastRock" && !isFloorAt(wx, wz)) continue;
      const root = new Mesh(`${BEACH_PROP_PREFIX}${kind}-${i}`, scene);
      root.position.set(wx, 0, wz);
      root.rotation.y = rnd(i, 7) * Math.PI * 2;
      // Small size variation, and shells lie at any angle because a wave does
      // not set them down flat.
      const k = 0.8 + rnd(i, 8) * 0.5;
      // The driftwood scan is a BRANCH: 2.1 metres long and eleven centimetres
      // thick once scaled to length, which at this camera is a hair on the sand.
      // Fattening the cross-section (never the length) turns it into the log the
      // reference has lying about.
      const fat = kind === "driftwood" ? 2.4 : 1;
      root.scaling.set(k, k * fat, k * fat);
      if (kind === "coastRock") {
        // Barely sunk, and tilted: the scan is a flat plate of rock, so lying it
        // dead level under a quarter metre of water left a pale slab floating in
        // the shallows. Tipped and mostly proud of the surface it reads as an
        // outcrop the tide runs around.
        root.position.y = -0.05 - rnd(i, 12) * 0.15;
        root.rotation.x = (rnd(i, 13) - 0.5) * 0.5;
        root.rotation.z = (rnd(i, 14) - 0.5) * 0.5;
      }
      if (kind === "shell") root.rotation.z = (rnd(i, 9) - 0.5) * 0.7;
      if (kind === "wreckTimber") {
        // Sunk a touch and tipped: a plank lying dead flat ON the sand reads
        // as placed, one breaking the surface reads as stranded.
        root.position.y = -0.02 - rnd(i, 15) * 0.03;
        root.rotation.x = (rnd(i, 16) - 0.5) * 0.25;
      }
      root.isPickable = false;
      if (attachProp(scene, root, kind) === null) {
        root.dispose(false, false);
        return; // no props asset: headless or a failed fetch, so drop the lot
      }
      for (const mesh of root.getChildMeshes()) {
        mesh.isPickable = false;
        mesh.receiveShadows = true;
      }
    }
  };

  place("shell", SHELL_COUNT, SHELL_BAND);
  place("driftwood", DRIFTWOOD_COUNT, DRIFTWOOD_BAND);
  place("coastRock", COAST_ROCK_COUNT, COAST_ROCK_BAND);
  place("wreckTimber", WRECK_TIMBER_COUNT, WRECK_TIMBER_BAND);
  place("bones", BONES_COUNT, BONES_BAND);
}

/**
 * How far apart two fires must stand, in world units, and how many an area gets.
 *
 * The camera shows about nineteen units across, so this spacing puts at most a
 * couple in frame at once — which is the point. A corridor lit end to end is a
 * corridor with no dark in it, and dark is what makes the lit part worth walking
 * toward (docs/09: anticipation is the mechanism).
 */
const FIRE_SPACING = 11;
const FIRE_MAX = 10;

/**
 * Stand a brazier against a wall every so often, and tell the light pool where
 * they are.
 *
 * Deterministic and RNG-free: the candidates are taken in grid order and kept
 * whenever they clear the spacing, so the same map always lights the same way —
 * a replay and a screenshot both need that, and neither wants a seed threaded
 * through the renderer.
 */
function standBraziers(
  scene: Scene,
  grid: WalkableGrid,
  isFloor: (x: number, y: number) => boolean,
  isSea: (x: number, y: number) => boolean,
): void {
  for (const node of [...scene.meshes, ...scene.transformNodes]) {
    if (node.name.startsWith(AREA_BRAZIER_PREFIX)) node.dispose(false, false);
  }

  const { cols, rows, cellSize, originX, originY } = grid;
  const spots: FireSpot[] = [];
  for (let y = 1; y < rows - 1 && spots.length < FIRE_MAX; y++) {
    for (let x = 1; x < cols - 1 && spots.length < FIRE_MAX; x++) {
      if (!isFloor(x, y)) continue;
      // Against a wall, and only where the wall is one flat side: a cell in a
      // corner takes a bowl that reads as jammed into the masonry.
      const wallN = !isFloor(x, y - 1);
      const wallS = !isFloor(x, y + 1);
      const wallW = !isFloor(x - 1, y);
      const wallE = !isFloor(x + 1, y);
      const sides = Number(wallN) + Number(wallS) + Number(wallW) + Number(wallE);
      if (sides !== 1) continue;
      // Never against the sea. Water is "wall" to this test, so on a beach every
      // candidate lined the tide line and the whole map was lit from the water —
      // a row of standing fires in the surf, which is the one place a fire cannot
      // be. A brazier belongs against the cliff.
      if (isSea(x, y - 1) || isSea(x, y + 1) || isSea(x - 1, y) || isSea(x + 1, y)) continue;
      const wx = originX + x * cellSize;
      const wz = originY + y * cellSize;
      if (spots.some((s) => Math.hypot(s.x - wx, s.z - wz) < FIRE_SPACING)) continue;
      // Nudged into the wall it stands against, so it hugs the masonry instead
      // of standing a cell out in the walking lane.
      const push = cellSize * 0.3;
      spots.push({
        x: wx + (wallE ? push : wallW ? -push : 0),
        z: wz + (wallS ? push : wallN ? -push : 0),
        // Seconds of offset, spread so no two flames breathe together.
        phase: spots.length * 1.7,
      });
    }
  }

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]!;
    const root = new Mesh(`${AREA_BRAZIER_PREFIX}${i}`, scene);
    root.position.set(s.x, 0, s.z);
    root.isPickable = false;
    if (attachProp(scene, root, "brazier") === null) {
      // No props asset (headless, or a failed fetch). The light still stands:
      // an unlit room with an invisible brazier is worse than a lit one with a
      // missing bowl, and the fallback is the same one every prop here takes.
      root.dispose(false, false);
      continue;
    }
    standGroundBlob(scene, root, 0.5);
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
    }
  }
  setFireSpots(spots);
}

export function buildLevel(
  scene: Scene,
  grid: WalkableGrid | null,
  tilesetId: string = DEFAULT_TILESET,
): LevelResult {
  // Area swaps (and the open hideout) call this again; drop the previous walls.
  scene.getMeshByName(WALL_MESH_NAME)?.dispose();
  for (const node of [...scene.meshes, ...scene.transformNodes]) {
    if (node.name.startsWith(BEACH_PROP_PREFIX)) node.dispose(false, false);
  }
  clearRocks();
  fitGround(scene, grid);
  if (!grid) return { walls: null, wallCells: 0 };

  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const isFloor = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === 1;
  // Water is wall to the sim and to nothing else. A beach does not have a wall
  // of boulders along the waterline: the sand runs into the sea, and the rock
  // belongs on the landward side only. Without this the coast's seaward edge got
  // the same rampart every dungeon rim gets, which is the "greybox with sand on
  // it" read the whole generator exists to kill.
  const isSea = (x: number, y: number): boolean =>
    grid.water !== undefined && x >= 0 && y >= 0 && x < cols && y < rows &&
    grid.water[y * cols + x] === 1;
  // 8-neighbourhood: a wall cell diagonally touching floor is a room corner. Drawing
  // it too fills the corner so the horizontal and vertical walls meet flush (cardinal
  // -only leaves a notch at every corner). Render-only; collision uses the raw grid.
  const isBoundaryWall = (x: number, y: number): boolean => {
    if (cells[y * cols + x] !== 0 || isSea(x, y)) return false;
    const n = WALL_THICK_CELLS;
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++)
        if ((dx || dy) && isFloor(x + dx, y + dy)) return true;
    return false;
  };

  /**
   * Which way is "further into the wall" from this cell: away from every floor
   * cell it borders. Zero where the floors cancel — a one-cell partition with a
   * room on each side, or a pillar standing in the open — and a boulder on one of
   * those has no direction it could be pushed. See `outwardHalfCell` in rocks.ts.
   */
  const outward = (x: number, y: number): { nx: number; nz: number } => {
    let nx = 0;
    let nz = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && isFloor(x + dx, y + dy)) { nx -= dx; nz -= dy; }
    const len = Math.hypot(nx, nz);
    return len === 0 ? { nx: 0, nz: 0 } : { nx: nx / len, nz: nz / len };
  };

  // Rocks carry the wall's silhouette when the glb is up; the box band drops to a
  // plinth under them. Without it (headless tests, a failed fetch) the band is
  // the wall again at full height, which is the look this replaced and still plays.
  const rocky = isRocksReady(scene);

  /**
   * Which boundary cells are the map's own EDGE, as opposed to an obstacle
   * standing in the open.
   *
   * Flooded inward from the grid's border rather than assumed, because on a
   * coast both are "wall": the landward cliff line AND the blobs scattered
   * across the sand. They must not be drawn the same way — the edge is one-sided
   * and may therefore stand over the player's head, while a blob has floor all
   * round it and a tall one hides whoever walks behind it. Treating every
   * boundary cell as edge is exactly what put a four-unit tower on each blob in
   * the middle of the beach the first time this was tried.
   *
   * A blob is a wall pocket the border flood can never reach, the same way an
   * inland pocket is unreachable from the sea. Coast only: every other biome
   * gets its edge from the rim ring below.
   */
  const isEdgeCell = new Uint8Array(cols * rows);
  if (grid.shore) {
    const stack: number[] = [];
    const push = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const i = y * cols + x;
      if (isEdgeCell[i] || isSea(x, y) || cells[i] === 1) return;
      isEdgeCell[i] = 1;
      stack.push(i);
    };
    for (let x = 0; x < cols; x++) { push(x, 0); push(x, rows - 1); }
    for (let y = 0; y < rows; y++) { push(0, y); push(cols - 1, y); }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % cols;
      const y = (i - x) / cols;
      push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
    }
  }

  const bandHeight = rocky ? BAND_HEIGHT : WALL_HEIGHT;

  const uH = bandHeight / TILE;
  const uD = cellSize / TILE;
  const boxes: Mesh[] = [];
  const rockCells: RockCell[] = [];
  const floorCells: RockCell[] = [];
  const edgeCells: RockCell[] = [];
  /** Boundary cells the border flood reached: the coast's landward wall. Empty
   *  on every other biome, where `isEdgeCell` is never filled. */
  const ledgeCells: RockCell[] = [];
  let wallCells = 0;

  // The outermost ring of the grid, floor-adjacent or not. `isBoundaryWall` only
  // sees wall that touches floor, so wherever a map's edge is a thick block of
  // dead cells it drew no rock at all and the ground plate — which is sized to
  // exactly this ring — ended as a lip of bare dirt against the void.
  const isOuterEdge = (x: number, y: number): boolean =>
    !isSea(x, y) && (
    x < WALL_THICK_CELLS ||
    y < WALL_THICK_CELLS ||
    x >= cols - WALL_THICK_CELLS ||
    y >= rows - WALL_THICK_CELLS);
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
        for (let i = 0; i < runLen; i++) {
          const cx = runStart + i;
          const cell = {
            x: originX + cx * cellSize,
            z: originY + y * cellSize,
            ...outward(cx, y),
          };
          if (isEdgeCell[y * cols + cx] === 1) ledgeCells.push(cell);
          else rockCells.push(cell);
        }

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
        // Sunk to flush with the floor once rocks carry the wall: the band's own
        // right angles were the loudest thing left in the frame wherever the
        // scatter drops a cell, and the boulders are wide enough to seal the
        // silhouette without it (MIN_WIDTH covers the widest gap the scatter can
        // leave — see ROCK_SPACING). What shows in a gap now is the floor plate
        // the ground already extends underneath, not the void. Still built rather
        // than skipped: it is the whole wall in the headless/failed-fetch
        // fallback, where `rocky` is false and it stands at full height.
        // The 0.05 is not slop: at exactly -bandHeight/2 the band's top face is
        // COPLANAR with the ground at y=0, and the two z-fight into flickering
        // near-black quads at the rock bases. It has to be strictly under.
        rocky ? -bandHeight / 2 - 0.05 : bandHeight / 2,
        originY + y * cellSize,
      );
      shadeTopFace(box);
      boxes.push(box);
    }
  }

  // Fires along the walls, before the merge: `floorCells` is already the list of
  // open cells this sweep collected, and a brazier wants one that has a wall to
  // stand against.
  standBraziers(scene, grid, isFloor, isSea);
  // The shore's own dressing. After the braziers because it uses the same
  // sweep's knowledge of where the floor is, and before the merge for no reason
  // other than keeping every "stand something up" call in one place.
  dressBeach(scene, grid);

  if (wallCells === 0) return { walls: null, wallCells: 0 };

  // disposeSource + 32-bit indices: thousands of boxes can exceed the 16-bit vertex limit.
  //
  // Merged INTO a mesh that already carries the final name, rather than merging
  // and renaming after. engine.ts filters shadow casters on
  // onNewMeshAddedObservable, which reads a name once and never again, so a mesh
  // renamed after the merge stays registered under Babylon's default — that is
  // why these 3.5-unit runs have been casting despite the filter meant to stop
  // them. Being born with the name is what lets the filter see it.
  const merged = Mesh.MergeMeshes(
    boxes,
    true,
    true,
    new Mesh(WALL_MESH_NAME, scene),
    false,
    false,
  );
  const material = wallMaterial(scene, tilesetId);
  if (rocky) {
    // Walked as a ring rather than folded into the sweep above: that sweep scans
    // horizontal runs and skips ahead past them, so it cannot see a single cell
    // on a left or right edge without breaking the run merge it exists to do.
    // Outward here is away from the map's CENTRE, not away from adjacent floor:
    // the rim's far side is the void, which has no cells to read a normal off.
    // `scatterRampart` needs it to know which side of the ring the camera is on,
    // and only the sign matters, so a plain centre-to-cell vector is enough.
    const midX = (cols - 1) / 2;
    const midY = (rows - 1) / 2;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (isOuterEdge(x, y)) {
          const ox = x - midX;
          const oy = y - midY;
          const len = Math.hypot(ox, oy) || 1;
          edgeCells.push({
            x: originX + x * cellSize,
            z: originY + y * cellSize,
            nx: ox / len,
            nz: oy / len,
          });
        }

    // A coast borders in sand, not in stone — see `DUNE` in rocks.ts, and the
    // two references it cites. Same scatter, same six meshes, different shape
    // and the FLOOR plate instead of the wall plate.
    if (grid.shore) {
      // Coastal rock, warm rather than the dungeon's cold: same plate, different
      // light to sit in. See `wallMaterial`.
      const stone = wallMaterial(scene, tilesetId, true);
      const weed = weedMaterial(scene);
      // The wall is DEEP, not a line. One cell of boundary is half a unit and a
      // single row of it read as a stack of stones laid side by side however
      // tall each one was; `strand-map-layout2.png` has the boundary two to
      // three player-widths across. The rows behind the first cost nothing to
      // place — everything out there is off the map — and they are what turns a
      // row of rocks into a mass with a back to it.
      const behind = ledgeCells.flatMap((c) =>
        LEDGE_ROWS.map((d) => ({ ...c, x: c.x + (c.nx ?? 0) * d, z: c.z + (c.nz ?? 0) * d })),
      );
      buildRocks(scene, scatterLedge(behind, ledgeCells), stone, LEDGE_MESH_PREFIX);
      buildRocks(scene, scatterDune(rockCells, cellSize), stone, DUNE_MESH_PREFIX);
      // Sparser than a dungeon floor: `beach-map.jpg` keeps its open sand almost
      // clean of loose stone, and at the dungeon spacing the pebbles read as
      // dirt across the whole beach.
      buildRocks(scene, scatterDebris(floorCells, 3.4), material, DEBRIS_MESH_PREFIX);
      buildRocks(scene, scatterDuneRim(edgeCells), stone, DUNE_RIM_MESH_PREFIX);
      // Scrub: a mat over the low blobs standing in the sand, and a fringe where
      // the tall ledge meets the beach. Both references put green in both
      // places, and neither has a hard line where the wall meets the floor.
      buildRocks(
        scene,
        [...scatterWeed(rockCells), ...scatterLedgeWeed(ledgeCells)],
        weed,
        WEED_MESH_PREFIX,
      );
      // And the scanned plants through the mat. `null` material: each species
      // carries its own photograph — see `buildRocks`.
      buildRocks(
        scene,
        scatterFlora([...ledgeCells, ...rockCells]),
        null,
        FLORA_MESH_PREFIX,
      );
    } else {
      buildRocks(scene, scatterRocks(rockCells, cellSize), material);
      buildRocks(scene, scatterDebris(floorCells), material, DEBRIS_MESH_PREFIX);
      buildRocks(scene, scatterRampart(edgeCells), material, RAMPART_MESH_PREFIX);
    }
  }
  if (merged) {
    // The band is the kerb the boundary sits in, and it shows wherever the
    // scatter drops a cell, so on a coast it takes the same warm stone the ledge
    // does rather than a strip of cold cliff running through it.
    merged.material = grid.shore ? wallMaterial(scene, tilesetId, true) : material;
    // Walls receive shadows (actors crossing them read correctly) but never cast
    // one — see engine.ts for why a 3.5-unit run must not.
    merged.receiveShadows = true;
    // The walls never move for the life of the area: skip the per-frame world
    // matrix and bounding sync. Disposed and rebuilt on area swap, so nothing
    // ever needs to unfreeze them.
    merged.freezeWorldMatrix();
    merged.doNotSyncBoundingInfo = true;
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
/** How bright the distance is on a biome that is outdoors under an open sky.
 *
 *  `VOID_COLOR` is 0.02 — the black a dungeon's fog fades into, which is right
 *  when what lies past the rim is rock and unlit air. On a coast it is sea and
 *  daylight, and at fogEnd 28-34 against a camera that sees nineteen units the
 *  band eats the frame's corners: measured at luma 12 out of 255, against a
 *  reference beach whose corners are as bright as its middle. So the far colour
 *  on an open-sky biome is HAZE, not void — light scattered off the water, which
 *  is what `beach-map.jpg` actually shows behind its surf. */
const SEA_HAZE = new Color3(0.42, 0.4, 0.36);

export function applyBiomeTint(
  scene: Scene,
  tint: readonly [number, number, number] | null,
  light = 1,
  sea = false,
): void {
  const fill = scene.getLightByName("fill");
  const sun = scene.getLightByName("sun");
  // Daylight, where a biome has any. Applied to the INTENSITIES, never to the
  // tint: the tint is normalised to mean 1.0 precisely so it cannot dim or lift
  // a place, and this is the one knob that is allowed to.
  //
  // Recomputed from the rig's own constants rather than scaling whatever is
  // currently set, or a second call on the same area multiplies a beach twice.
  // `tint === null` is the hideout, which keeps the lived-in fill; every map
  // takes the dimmer one, exactly as `setMapFill` sets it.
  if (fill) fill.intensity = (tint === null ? FILL_INTENSITY : MAP_FILL_INTENSITY) * light;
  if (sun) sun.intensity = SUN_INTENSITY * light;
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
  // Per-biome fog for free: the tint is already normalised to mean 1.0, so the
  // void keeps its brightness and only takes the biome's hue. No second table to
  // fall out of step with the first — a swamp's distance goes green because the
  // swamp is green, and the hideout's goes back to neutral with everything else.
  const far = sea ? SEA_HAZE : VOID_COLOR;
  scene.fogColor = new Color3(far.r * nr, far.g * ng, far.b * nb);
  // The air in the room is part of the room's colour, so it takes the same tint.
  tintHaze(scene, nr, ng, nb);
}
