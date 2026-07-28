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
 * Rocks share the `wallrun-` prefix deliberately: engine.ts excludes that prefix
 * from the shadow casters, and a 1.8-unit rock under this low sun throws the same
 * 4-unit smear across the floor that got the walls excluded in the first place.
 */
const ROCK_MESH_PREFIX = "wallrun-rock-";

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

/** Positional jitter as a fraction of the spacing. Capped by MIN_WIDTH — see
 *  where it is used; this is not a free taste knob. */
const JITTER = 0.32;

/** Rock footprint in world units. The floor is NOT free: MIN_WIDTH has to cover
 *  the widest gap the scatter can leave (1.29 — see ROCK_SPACING) or the band
 *  opens notches. Boulders this size are also simply closer to the reference than
 *  the pebbles a smaller number gives. */
const MIN_WIDTH = 1.35;
const MAX_WIDTH = 1.95;
/** Height as a multiple of width. Chosen so the tallest rock lands at about the
 *  1.85 the box wall used to be: past that the camera sits ~49 degrees up and a
 *  rock starts hiding the character behind it, which is the bug this art pass
 *  began with. Under ~0.6 they read as flat slabs seen from above. */
const MIN_ASPECT = 0.62;
const MAX_ASPECT = 0.95;
/** Off-vertical lean. Small on purpose — a rock is heavy, and a whole boundary
 *  of visibly tipped boulders reads as debris rather than as bedrock. */
const MAX_TILT = 0.16;

interface LoadedRocks {
  scene: Scene;
  container: AssetContainer;
}

let loaded: LoadedRocks | null = null;
let pending: Promise<void> | null = null;
let placed: Mesh[] = [];

export function loadRocks(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();
  if (pending) return pending;

  pending = LoadAssetContainerAsync(ROCKS_URL, scene)
    .then((container) => {
      loaded = { scene, container };
    })
    .catch(() => {
      loaded = null;
    })
    .finally(() => {
      pending = null;
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
  placed = [];
}

export interface RockCell {
  x: number;
  z: number;
}

export interface RockPlacement {
  x: number;
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
  spacing: number = ROCK_SPACING,
): RockPlacement[] {
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
    const x = cell.x + (r0 - 0.5) * spacing * JITTER;
    const z = cell.z + (r1 - 0.5) * spacing * JITTER;

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

    const width = MIN_WIDTH + r2 * (MAX_WIDTH - MIN_WIDTH);
    const rock: RockPlacement = {
      x,
      z,
      width,
      height: width * (MIN_ASPECT + r3 * (MAX_ASPECT - MIN_ASPECT)),
      yaw: hash01(i * 4 + 5) * Math.PI * 2,
      tiltX: (hash01(i * 4 + 6) - 0.5) * 2 * MAX_TILT,
      tiltZ: (hash01(i * 4 + 7) - 0.5) * 2 * MAX_TILT,
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
  for (const mesh of placed) mesh.dispose();
  placed = [];
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
): Mesh[] | null {
  clearRocks();
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
    translation.set(p.x, 0, p.z);
    Quaternion.RotationYawPitchRollToRef(p.yaw, p.tiltX, p.tiltZ, rotation);
    Matrix.ComposeToRef(scale, rotation, translation, matrix);
    const bucket = matrices[p.variant % sources.length]!;
    for (const v of matrix.m) bucket.push(v);
  }

  const meshes: Mesh[] = [];
  for (let i = 0; i < sources.length; i++) {
    const data = matrices[i]!;
    if (data.length === 0) continue;
    const mesh = (sources[i] as Mesh).clone(`${ROCK_MESH_PREFIX}${i}`, null);
    if (!mesh) continue;
    // Out of the glTF root and back to identity: the vertices are already in the
    // pose the exporter baked, and staying parented would hand the whole band the
    // root's handedness flip a second time.
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
    meshes.push(mesh);
  }
  placed = meshes;
  return meshes.length > 0 ? meshes : null;
}
