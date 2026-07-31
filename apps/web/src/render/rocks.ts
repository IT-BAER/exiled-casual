import {
  LoadAssetContainerAsync,
  Matrix,
  Quaternion,
  Vector3,
  type AbstractMesh,
  type AssetContainer,
  type Material,
  type Mesh,
  type Scene,
} from "@babylonjs/core";

/**
 * The blocker rocks — six boulder variants as one authored glTF, scattered along
 * the wall band so a map's edges read as rock instead of as a row of cubes.
 *
 * `tools/build_rocks.py` makes the shapes; this module places them. It carries no
 * material of its own: a rock is dressed in its biome's `wall_color` plate, the
 * same material the merged band already uses, so one glb serves every tileset.
 *
 * Failure is not fatal, exactly as with the character rig and the hideout props:
 * a failed fetch (and every headless test) leaves `loaded` null, `buildLevel`
 * sees that and puts the full-height box band back, and the map still plays.
 */
const ROCKS_URL = "/models/rocks.glb";

/** glTF's own wrapper node, carrying the handedness flip. */
const GLTF_ROOT = "__root__";

/**
 * Rocks share the `wallrun-` prefix so the merge and disposal paths treat them as
 * level geometry, but engine.ts shadow-casts THIS prefix back in. The 4-unit smear
 * that got the box walls excluded is the whole look in `inside-map-battle.webp`:
 * what made a room unplayable was a 3.5-unit run casting one CONTINUOUS band, and
 * discrete boulders throw discrete smears with lit floor between them.
 */
export const ROCK_MESH_PREFIX = "wallrun-rock-";

/** Floor debris. Same exclusion, same reason, and a pebble lying on the ground
 *  has nothing to cast a useful shadow onto anyway. */
const DEBRIS_MESH_PREFIX = "wallrun-debris-";

/** Smallest gap between two rock centres, in world units.
 *
 *  Not a density knob on its own: it sets the WIDEST gap too, and that is the
 *  number the band's opacity depends on. Dart-throwing rejects a candidate that
 *  lands inside `spacing` of an accepted rock, so the worst case is a candidate
 *  rejected by a hair, and the next cell along accepted — `spacing + cellSize +
 *  spacing*JITTER`. At the mapgen's 0.5-unit cell that is 1.29, which MIN_WIDTH
 *  has to cover or the boulders stop overlapping and the void shows between
 *  them. 0.85 put the worst gap at 1.62 and wanted 1.7-wide rocks to close it. */
export const ROCK_SPACING = 0.6;

export { DEBRIS_MESH_PREFIX };

/** Positional jitter as a fraction of the spacing. Capped by MIN_WIDTH — see
 *  where it is used; this is not a free taste knob. */
const JITTER = 0.32;

/** Rock footprint in world units. The floor is NOT free: MIN_WIDTH has to cover
 *  the widest gap the scatter can leave (1.29 — see ROCK_SPACING) or the band
 *  opens notches. Boulders this size are also simply closer to the reference than
 *  the pebbles a smaller number gives. */
const MIN_WIDTH = 1.35;
const MAX_WIDTH = 1.95;
/** Height as a multiple of width. The ceiling is the character, not the box wall
 *  it replaced: at 0.95 the tallest rock matched the old 1.85 wall, which put it
 *  level with his head, and under a camera ~49 degrees up a boulder that tall
 *  hides the man walking behind it — the bug this art pass began with. 0.78 caps
 *  the tallest at ~1.52 so his head clears every rock on the map. Under ~0.6 they
 *  read as flat slabs seen from above. */
const MIN_ASPECT = 0.62;
const MAX_ASPECT = 0.78;
/** Off-vertical lean. Small on purpose — a rock is heavy, and a whole boundary
 *  of visibly tipped boulders reads as debris rather than as bedrock. */
const MAX_TILT = 0.16;

/** Everything the scatter needs to know about one kind of stone. Boulders and
 *  floor debris are the same six meshes at different sizes, so the difference
 *  between them is data, not a second code path. */
interface ScatterConfig {
  spacing: number;
  minWidth: number;
  maxWidth: number;
  minAspect: number;
  maxAspect: number;
  maxTilt: number;
  /** How far below the floor the shape sits, as a fraction of its height. A
   *  pebble resting exactly on y=0 reads as placed on the ground; sunk a little
   *  it reads as part of it. */
  sink: number;
  /**
   * Half the depth of the wall cell a rock is centred on, when the rock is meant
   * to line up with that cell's inner FACE. Boulders are 1.35-1.95 wide on a
   * 0.5-unit cell, so centred they bulge up to 0.72 units into floor the sim
   * happily walks on — and since collision stops a body at the cell face, what
   * you see is monsters standing inside rock, worst of all now that they route
   * along walls. Set here, each rock is pushed out along its cell's outward
   * normal by exactly its own overhang, putting the face he sees on the face the
   * sim collides against.
   *
   * ponytail: needs a normal, so a wall cell with floor on opposite sides (a
   * one-cell partition) and an isolated pillar both get no offset — no direction
   * is out. Fixing those means geometry per cell, not a nudge.
   */
  outwardHalfCell?: number;
}

const BOULDERS: ScatterConfig = {
  spacing: ROCK_SPACING,
  minWidth: MIN_WIDTH,
  maxWidth: MAX_WIDTH,
  minAspect: MIN_ASPECT,
  maxAspect: MAX_ASPECT,
  maxTilt: MAX_TILT,
  sink: 0,
};

/**
 * Floor debris: the same boulders at a tenth the size, thrown across the open
 * floor. The tiling plate is the largest thing on screen and its repeat is the
 * loudest artifact left in a frame — a plate cannot hide that on its own, but
 * scattered stone breaking the grid line does, and it costs no new asset.
 *
 * Free to tilt hard, unlike the boulders: a pebble lying on its side is a
 * pebble, while a tipped boulder reads as debris rather than as bedrock.
 */
const DEBRIS: ScatterConfig = {
  spacing: 2.1,
  minWidth: 0.12,
  maxWidth: 0.42,
  minAspect: 0.3,
  maxAspect: 0.6,
  maxTilt: 0.9,
  sink: 0.35,
};

/**
 * The map's outer rim, and the only stone allowed to be tall.
 *
 * Everything else on the grid has the player walking behind it, so its height is
 * capped by his head. Nothing is ever behind this ring — it IS the edge of the
 * world — so the cap does not apply, and it has to be tall because the ground
 * plate stops exactly here and past it is the void. A single row of 1.5-unit
 * boulders left a lip of bare dirt ending in black, which is the one thing the
 * reference frames never show: in PoE the floor runs to every edge and the world
 * never visibly stops.
 *
 * Wider spacing than the boulders on purpose. These are big enough to close the
 * ring on their own, and packing them as tightly turns a rampart into gravel.
 */
const RAMPART: ScatterConfig = {
  spacing: 1,
  minWidth: 1.9,
  maxWidth: 2.6,
  minAspect: 1.05,
  maxAspect: 1.25,
  maxTilt: 0.12,
  /** Bedrock, not scree: the rim should look like it comes out of the ground. */
  sink: 0.08,
};

/** Same shadow-caster exclusion as the rest — and doubly so here, since a 3-unit
 *  rock under this sun throws a shadow longer than a room is wide. */
const RAMPART_MESH_PREFIX = "wallrun-rampart-";
export { RAMPART_MESH_PREFIX };

interface LoadedRocks {
  scene: Scene;
  container: AssetContainer;
}

let loaded: LoadedRocks | null = null;
let pending: Promise<void> | null = null;
/**
 * Which load is the current one. A fetch that was started for a scene that has
 * since gone away must not be allowed to land: React's StrictMode mounts the
 * effect, tears it down and mounts it again, so in dev there are routinely two
 * loads in flight and the FIRST one resolves last about half the time. When it
 * did, it wrote its dead scene into `loaded`, `isRocksReady` went false against
 * the live scene, and the map silently fell back to the box walls — which is
 * exactly the "the rocks were there yesterday" bug.
 */
let generation = 0;
const placed = new Map<string, Mesh[]>();

export function loadRocks(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();

  // No "return the in-flight promise" shortcut: that promise may belong to a
  // scene that is already gone, and handing it back would report the NEW scene
  // ready when nothing was ever loaded into it.
  const gen = ++generation;
  pending = LoadAssetContainerAsync(ROCKS_URL, scene)
    .then((container) => {
      if (gen !== generation) {
        container.dispose();
        return;
      }
      loaded = { scene, container };
    })
    .catch(() => {
      if (gen === generation) loaded = null;
    })
    .finally(() => {
      if (gen === generation) pending = null;
    });

  return pending;
}

export function isRocksReady(scene: Scene): boolean {
  return loaded !== null && loaded.scene === scene;
}

/** Drop the cached container — the scene that owns it is going away. */
export function resetRocks(): void {
  loaded = null;
  pending = null;
  // Retire any load still in flight for the scene being torn down, or it lands
  // after the next scene has already started its own and wins the race.
  generation++;
  placed.clear();
}

export interface RockCell {
  x: number;
  z: number;
  /**
   * Unit vector pointing away from the floor this cell borders, or absent/zero
   * where there is no such direction. Only read when the config sets
   * `outwardHalfCell` — see there.
   */
  nx?: number;
  nz?: number;
}

export interface RockPlacement {
  x: number;
  /** Below the floor by `sink` of the height; see ScatterConfig. */
  y: number;
  z: number;
  /** Footprint in world units; the rock mesh is authored inside a unit box. */
  width: number;
  height: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  variant: number;
}

/**
 * Deterministic unit float from an integer. The scatter has to come out the same
 * on every client and every reload — the walls are part of the map, not weather —
 * and it is keyed off the cell's own index so re-entering an area rebuilds the
 * identical boundary. (finalizer of murmur3, which is cheap and mixes well.)
 */
function hash01(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Thin a run of wall cells down to rock positions.
 *
 * The band is one cell deep and a cell is half a unit, so one rock per cell would
 * be six hundred boulders in a wall's thickness — the thinning is what turns a
 * dense line of cells into a scatter with a believable stone size. Greedy
 * dart-throwing against a spatial hash rather than a stride along each run,
 * because a vertical wall is a stack of one-cell runs and a stride cannot see it.
 *
 * O(n) in the cell count: the bucket is exactly `spacing` wide, so a rejection
 * test only ever looks at the nine buckets around the candidate.
 */
export function scatterRocks(
  cells: readonly RockCell[],
  cellSize = 0.5,
): RockPlacement[] {
  return scatter(cells, { ...BOULDERS, outwardHalfCell: cellSize / 2 });
}

/** Sparse stone across the open floor — see DEBRIS for why it exists. */
export function scatterDebris(cells: readonly RockCell[]): RockPlacement[] {
  return scatter(cells, DEBRIS);
}

/** The tall ring that closes the map's edge — see RAMPART. */
export function scatterRampart(cells: readonly RockCell[]): RockPlacement[] {
  return scatter(cells, RAMPART);
}

function scatter(cells: readonly RockCell[], cfg: ScatterConfig): RockPlacement[] {
  const spacing = cfg.spacing;
  const out: RockPlacement[] = [];
  const buckets = new Map<string, RockPlacement[]>();
  const key = (cx: number, cz: number): string => `${cx},${cz}`;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const r0 = hash01(i * 4 + 1);
    const r1 = hash01(i * 4 + 2);
    const r2 = hash01(i * 4 + 3);
    const r3 = hash01(i * 4 + 4);
    // Jitter widens the worst-case gap one for one, so it is bounded by what the
    // narrowest rock can bridge (see ROCK_SPACING), not by how much scatter looks
    // good. 0.19 units of play on a 0.5-unit cell grid already hides the lattice.
    let x = cell.x + (r0 - 0.5) * spacing * JITTER;
    let z = cell.z + (r1 - 0.5) * spacing * JITTER;

    const width = cfg.minWidth + r2 * (cfg.maxWidth - cfg.minWidth);
    const height = width * (cfg.minAspect + r3 * (cfg.maxAspect - cfg.minAspect));

    // Applied before the rejection test, so spacing is enforced where the rocks
    // actually end up rather than where their cells were.
    if (cfg.outwardHalfCell !== undefined) {
      const out = Math.max(0, width / 2 - cfg.outwardHalfCell);
      x += (cell.nx ?? 0) * out;
      z += (cell.nz ?? 0) * out;
    }

    const cx = Math.floor(x / spacing);
    const cz = Math.floor(z / spacing);
    let blocked = false;
    for (let dx = -1; dx <= 1 && !blocked; dx++) {
      for (let dz = -1; dz <= 1 && !blocked; dz++) {
        for (const other of buckets.get(key(cx + dx, cz + dz)) ?? []) {
          const ddx = other.x - x;
          const ddz = other.z - z;
          if (ddx * ddx + ddz * ddz < spacing * spacing) blocked = true;
        }
      }
    }
    if (blocked) continue;

    const rock: RockPlacement = {
      x,
      y: -height * cfg.sink,
      z,
      width,
      height,
      yaw: hash01(i * 4 + 5) * Math.PI * 2,
      tiltX: (hash01(i * 4 + 6) - 0.5) * 2 * cfg.maxTilt,
      tiltZ: (hash01(i * 4 + 7) - 0.5) * 2 * cfg.maxTilt,
      variant: Math.floor(hash01(i * 4 + 8) * 64),
    };
    out.push(rock);
    const bk = key(cx, cz);
    const list = buckets.get(bk);
    if (list) list.push(rock);
    else buckets.set(bk, [rock]);
  }
  return out;
}

function sourceMeshes(container: AssetContainer): AbstractMesh[] {
  return container.meshes
    .filter((m) => m.name !== GLTF_ROOT && m.getTotalVertices() > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Drop the previous area's rocks. Safe to call when there were none. */
export function clearRocks(): void {
  for (const meshes of placed.values()) for (const mesh of meshes) mesh.dispose();
  placed.clear();
}

/**
 * Put `placements` on the ground as thin instances, one draw call per variant.
 *
 * Thin instances and not clones: a map's boundary is several hundred rocks, and
 * as real meshes that is several hundred draw calls for scenery nobody looks at
 * directly. They inherit the source's material, so every rock in an area is the
 * same stone as the band it hides.
 *
 * Returns null when the glb has not loaded, which is the caller's signal to keep
 * the full-height box band instead.
 */
export function buildRocks(
  scene: Scene,
  placements: readonly RockPlacement[],
  material: Material,
  prefix: string = ROCK_MESH_PREFIX,
): Mesh[] | null {
  for (const mesh of placed.get(prefix) ?? []) mesh.dispose();
  placed.delete(prefix);
  if (!loaded || loaded.scene !== scene) return null;
  const sources = sourceMeshes(loaded.container);
  if (sources.length === 0) return null;

  const matrices: number[][] = sources.map(() => []);
  const scale = new Vector3();
  const translation = new Vector3();
  const rotation = new Quaternion();
  const matrix = Matrix.Identity();
  for (const p of placements) {
    scale.set(p.width, p.height, p.width);
    translation.set(p.x, p.y, p.z);
    Quaternion.RotationYawPitchRollToRef(p.yaw, p.tiltX, p.tiltZ, rotation);
    Matrix.ComposeToRef(scale, rotation, translation, matrix);
    const bucket = matrices[p.variant % sources.length]!;
    for (const v of matrix.m) bucket.push(v);
  }

  const meshes: Mesh[] = [];
  for (let i = 0; i < sources.length; i++) {
    const data = matrices[i]!;
    if (data.length === 0) continue;
    const mesh = (sources[i] as Mesh).clone(`${prefix}${i}`, null);
    if (!mesh) continue;
    // Out of the glTF root and back to identity: the vertices are already in the
    // pose the exporter baked, and staying parented would hand the whole band the
    // root's handedness flip a second time.
    // A clone SHARES its source's Geometry, and thinInstanceSetBuffer writes the
    // instanced attributes onto the geometry while the matrices it reports back
    // stay on the mesh. Boulders and debris clone the same six sources, so the
    // debris build silently overwrote what every boulder drew: the boundary
    // rendered as pebbles on open floor while every probe -- instance count,
    // bounding box, matrix buffer -- still read as correct boulders.
    mesh.makeGeometryUnique();
    mesh.setParent(null);
    mesh.position.setAll(0);
    mesh.rotationQuaternion = null;
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(data), 16, true);
    mesh.thinInstanceRefreshBoundingInfo(true);
    // The host sits at identity and the instances never move; the bounding info
    // was just refreshed from the final buffer, so neither needs a per-frame sync.
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    meshes.push(mesh);
  }
  placed.set(prefix, meshes);
  return meshes.length > 0 ? meshes : null;
}
