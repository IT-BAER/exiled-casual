import {
  Color3, DynamicTexture, Mesh, MeshBuilder, PBRMaterial, Texture, TransformNode, VertexData, type Scene,
} from "@babylonjs/core";
import { atlasGraph, mapBaseIdForNode, type AtlasGraphNode } from "@exiled/rules";
import { mapBase } from "@exiled/content-runtime";

/**
 * Maren's Atlas, in relief on her table.
 *
 * The character's own Atlas (it is seeded per character, like PoE2's), drawn as a
 * model: land coloured by the biome of the nearest place, raised where places
 * cluster, falling to sea at the board's edge, gold routes between linked places
 * and a pin on each, lit gold once it is cleared. Built in code rather than in
 * props.glb because it is a picture of save data, not furniture.
 */

/** The board's footprint on the table, metres: local X across, local Z deep. */
export const ATLAS_MODEL_W = 2.5;
export const ATLAS_MODEL_D = 1.0;

const NODE = "atlas-model";
/** Relief resolution: vertices across and deep. Shape only: the colour is the texture. */
const NX = 128, NZ = 52;
/**
 * The painted land, pixels: about 2.4 mm each on the table. Vertex colour at the
 * relief's own resolution smeared every coast over 3 cm and read as a blur.
 */
const TEX_W = 1024, TEX_H = 416;
/** The places' pull, sampled this coarse and interpolated: it is smooth, the coast is not. */
const GW = 257, GH = 105;
/** Below this height a spot is sea. */
const SHORE = 0.006;
/** Height of the frame the relief sits in, and the tallest hill above it. */
const FRAME_H = 0.045;
const HILL = 0.09;

/** Land colour per biome id, as seen (sRGB) and lifted: the table is lit by candles. */
const BIOME_TINT: Record<string, readonly [number, number, number]> = {
  coast: [0.80, 0.71, 0.50],
  desert: [0.78, 0.58, 0.32],
  forest: [0.28, 0.45, 0.22],
  swamp: [0.33, 0.40, 0.25],
  vaal_stone: [0.52, 0.50, 0.46],
};
const SEA: readonly [number, number, number] = [0.13, 0.25, 0.33];
const SHALLOWS: readonly [number, number, number] = [0.27, 0.43, 0.46];
const SURF: readonly [number, number, number] = [0.58, 0.66, 0.6];
const SAND: readonly [number, number, number] = [0.84, 0.77, 0.58];
const INK: readonly [number, number, number] = [0.2, 0.15, 0.1];

/** What the model was last built from, so a snapshot only rebuilds it on a change. */
let current: { seed: number; completed: readonly string[] } | null = null;

function key(seed: number, completed: readonly string[]): string {
  return `${seed}:${[...completed].sort().join(",")}`;
}

/** Board coordinates of an Atlas position (0..1, y down the panel) on the model. */
function boardXZ(n: { x: number; y: number }): { x: number; z: number } {
  // The panel's top is the board's far edge: local +Z runs up the screen.
  return { x: (n.x - 0.5) * ATLAS_MODEL_W * 0.86, z: (0.5 - n.y) * ATLAS_MODEL_D * 0.8 };
}

/** Deterministic value noise, so the same Atlas is the same landscape every visit. */
function hash(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function tintOf(n: AtlasGraphNode): readonly [number, number, number] {
  return BIOME_TINT[mapBase(mapBaseIdForNode(n.id)).biomeId] ?? BIOME_TINT["vaal_stone"]!;
}

/**
 * PBR like the props it stands among: the hideout's fires are tuned for physical
 * falloff, and a StandardMaterial under them blows out to white.
 */
function material(scene: Scene, name: string, build: (m: PBRMaterial) => void): PBRMaterial {
  const existing = scene.getMaterialByName(name) as PBRMaterial | null;
  if (existing) return existing;
  const m = new PBRMaterial(name, scene);
  m.metallic = 0;
  m.roughness = 0.85;
  build(m);
  return m;
}

/**
 * How much land each spot of the board is, per cell of a GW x GH grid over (u, v):
 * land where places are, sea toward the edge.
 */
function landGrid(nodes: readonly AtlasGraphNode[]): Float32Array {
  const at = nodes.map(boardXZ);
  const grid = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const x = (i / (GW - 1) - 0.5) * ATLAS_MODEL_W, z = (j / (GH - 1) - 0.5) * ATLAS_MODEL_D;
      let land = 0;
      for (const p of at) land = Math.max(land, Math.exp(-(((x - p.x) / 0.5) ** 2 + ((z - p.z) / 0.3) ** 2) * 1.6));
      grid[j * GW + i] = land;
    }
  }
  return grid;
}

/** The land at (u, v), bilinear. */
function landAt(grid: Float32Array, u: number, v: number): number {
  const fx = u * (GW - 1), fz = v * (GH - 1);
  const i = Math.min(GW - 2, Math.floor(fx)), j = Math.min(GH - 2, Math.floor(fz));
  const sx = fx - i, sz = fz - j;
  const a = j * GW + i, c = a + GW;
  const top = grid[a]! + (grid[a + 1]! - grid[a]!) * sx;
  const bottom = grid[c]! + (grid[c + 1]! - grid[c]!) * sx;
  return top + (bottom - top) * sz;
}

/**
 * The relief's height at board (x, z): `raw` is the land term before the clamp,
 * below zero out at sea, and `h` the metres the relief stands up.
 */
function heightAt(x: number, z: number, u: number, v: number, land: number, seed: number): { raw: number; h: number; n2: number } {
  const edge = Math.min(u, 1 - u, v, 1 - v) * 2;
  const n1 = noise(x * 5, z * 5, seed), n2 = noise(x * 13, z * 13, seed + 7);
  const raw = Math.min(1, land * 1.25 + (n1 - 0.5) * 0.7) * Math.min(1, edge * 3.5) - 0.18;
  return { raw, h: Math.max(0, raw) * HILL * (0.65 + 0.7 * n2), n2 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The land painted at pixel resolution: the same heights as the relief, plus a
 * fine wobble on the coast, an inked shoreline with sand inside it, surf and
 * shallows outside it, each place's biome to an inked border, and hill shading.
 * Null when there is no canvas
 * (NullEngine): the model then stands uncoloured, which only tests ever see.
 */
function paintAtlas(scene: Scene, grid: Float32Array | null, nodes: readonly AtlasGraphNode[], seed: number): DynamicTexture | null {
  let tex: DynamicTexture;
  try {
    tex = new DynamicTexture(`${NODE}-paint`, { width: TEX_W, height: TEX_H }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  } catch {
    return null;
  }
  const ctx = tex.getContext();
  const img = ctx.getImageData(0, 0, TEX_W, TEX_H);
  const px = img.data;
  if (painted?.seed === seed) {
    px.set(painted.pixels);
  } else {
    paintPixels(px, grid, nodes, seed);
    painted = { seed, pixels: px.slice() };
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.anisotropicFilteringLevel = 8;
  tex.metadata = { seed };
  return tex;
}

/**
 * The last Atlas painted, so another scene or another visit to the hideout copies
 * it rather than spending the ~175 ms again.
 */
let painted: { seed: number; pixels: Uint8ClampedArray } | null = null;

function paintPixels(px: Uint8ClampedArray, grid: Float32Array | null, nodes: readonly AtlasGraphNode[], seed: number): void {
  const at = nodes.map((n) => ({ ...boardXZ(n), tint: tintOf(n) }));
  // First pass: the relief's height per pixel plus a finer rumple, which the
  // second pass shades by its slope to the next pixel.
  const n = TEX_W * TEX_H;
  const raws = new Float32Array(n), hs = new Float32Array(n), n2s = new Float32Array(n), shaded = new Float32Array(n);
  for (let py = 0; py < TEX_H; py++) {
    // The canvas's top row is the texture's v = 1 (DynamicTexture.update inverts Y).
    const v = 1 - py / (TEX_H - 1);
    for (let pxi = 0; pxi < TEX_W; pxi++) {
      const u = pxi / (TEX_W - 1);
      const x = (u - 0.5) * ATLAS_MODEL_W, z = (v - 0.5) * ATLAS_MODEL_D;
      const { raw, h, n2 } = heightAt(x, z, u, v, grid ? landAt(grid, u, v) : 0, seed);
      const i = py * TEX_W + pxi;
      raws[i] = raw; hs[i] = h; n2s[i] = n2;
      shaded[i] = h + (noise(x * 30, z * 30, seed + 31) - 0.5) * 0.006 + (noise(x * 80, z * 80, seed + 37) - 0.5) * 0.002;
    }
  }
  const step = ATLAS_MODEL_W / (TEX_W - 1);
  const rgb = [0, 0, 0];
  for (let py = 0; py < TEX_H; py++) {
    const v = 1 - py / (TEX_H - 1);
    for (let pxi = 0; pxi < TEX_W; pxi++) {
      const u = pxi / (TEX_W - 1);
      const x = (u - 0.5) * ATLAS_MODEL_W, z = (v - 0.5) * ATLAS_MODEL_D;
      const i = py * TEX_W + pxi;
      const raw = raws[i]!, h = hs[i]!, n2 = n2s[i]!;
      const coast = h + (noise(x * 45, z * 45, seed + 11) - 0.5) * 0.004;
      if (!grid || coast < SHORE) {
        const deep = Math.min(1, Math.max(0, -raw / 0.35));
        const ripple = 0.92 + noise(x * 70, z * 28, seed + 13) * 0.16;
        const surf = grid && raw > -0.035 ? 0.45 * (1 + raw / 0.035) : 0;
        for (let k = 0; k < 3; k++) rgb[k] = lerp(lerp(SHALLOWS[k]!, SEA[k]!, deep) * ripple, SURF[k]!, surf);
      } else {
        // Each spot belongs to its nearest place, measured through a wobble so the
        // borders wander; a border between two biomes is inked. A blend of every
        // place's colour, the old way, read as a smear at any distance.
        const wx = x + (noise(x * 6, z * 6, seed + 23) - 0.5) * 0.2;
        const wz = z + (noise(x * 6, z * 6, seed + 29) - 0.5) * 0.12;
        let best = Infinity, second = Infinity, bi = 0, si = 0;
        for (let n = 0; n < at.length; n++) {
          const d = Math.hypot((wx - at[n]!.x) / 0.5, (wz - at[n]!.z) / 0.3);
          if (d < best) { second = best; si = bi; best = d; bi = n; } else if (d < second) { second = d; si = n; }
        }
        const tint = at[bi]!.tint;
        // Lit from the board's far left by its own slope, per pixel, so a hill
        // reads as a hill and not a lighter blot. +X is the next pixel, +Z the row above.
        const gx = pxi + 1 < TEX_W ? (shaded[i + 1]! - shaded[i]!) / step : 0;
        const gz = py > 0 ? (shaded[i - TEX_W]! - shaded[i]!) / step : 0;
        const lit = Math.min(1.45, Math.max(0.55, 1 + (gx - gz) * 0.9));
        const shade = (0.84 + 0.25 * Math.min(1, h / HILL) + (n2 - 0.5) * 0.1) * lit;
        const sand = coast < SHORE + 0.004 ? 0.55 : 0;
        for (let k = 0; k < 3; k++) rgb[k] = lerp(tint[k]! * shade, SAND[k]!, sand);
        if (at[si]!.tint !== tint && second - best < 0.06) for (let k = 0; k < 3; k++) rgb[k] = lerp(rgb[k]!, INK[k]!, 0.6);
        if (coast < SHORE + 0.0011) for (let k = 0; k < 3; k++) rgb[k] = INK[k]!;
      }
      const o = (py * TEX_W + pxi) * 4;
      // Written as seen: a texture is gamma space, PBR linearises it on read.
      px[o] = Math.min(255, rgb[0]! * 255);
      px[o + 1] = Math.min(255, rgb[1]! * 255);
      px[o + 2] = Math.min(255, rgb[2]! * 255);
      px[o + 3] = 255;
    }
  }
}

/** The relief: a height field over the board, wearing the painted land. */
function buildRelief(scene: Scene, parent: TransformNode, nodes: readonly AtlasGraphNode[], seed: number): void {
  const grid = nodes.length ? landGrid(nodes) : null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const u = i / (NX - 1), v = j / (NZ - 1);
      const x = (u - 0.5) * ATLAS_MODEL_W, z = (v - 0.5) * ATLAS_MODEL_D;
      const h = grid ? heightAt(x, z, u, v, landAt(grid, u, v), seed).h : 0.004;
      positions.push(x, FRAME_H + h, z);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j + 1 < NZ; j++) {
    for (let i = 0; i + 1 < NX; i++) {
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      // Babylon is left-handed: wound this way the faces look up, the other way culled.
      indices.push(a, b, c, b, d, c);
    }
  }
  const mesh = new Mesh(`${NODE}-relief`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  const mat = material(scene, `${NODE}-relief-mat`, (m) => {
    m.albedoColor = Color3.White();
    // The table stands away from the fires; a little of its own light keeps the
    // land readable as land and not a dark slab.
    m.emissiveColor = new Color3(0.07, 0.06, 0.05).toLinearSpace();
  });
  // Painted once per Atlas: a cleared place relights a pin, never the land.
  const paintKey = grid ? seed : -1;
  if ((mat.albedoTexture?.metadata as { seed?: number } | null)?.seed !== paintKey) {
    mat.albedoTexture?.dispose();
    mat.albedoTexture = paintAtlas(scene, grid, nodes, paintKey);
  }
  mesh.material = mat;
  mesh.parent = parent;
}

/** The routes as raised gold threads, and a pin on every place. */
function buildRoutes(scene: Scene, parent: TransformNode, nodes: readonly AtlasGraphNode[], completed: ReadonlySet<string>): void {
  const gold = material(scene, `${NODE}-route-mat`, (m) => {
    m.albedoColor = new Color3(0.55, 0.4, 0.15).toLinearSpace();
    m.emissiveColor = new Color3(0.45, 0.32, 0.1).toLinearSpace();
  });
  const lit = material(scene, `${NODE}-pin-lit-mat`, (m) => {
    m.albedoColor = new Color3(1, 0.8, 0.35).toLinearSpace();
    m.emissiveColor = new Color3(1, 0.72, 0.25).toLinearSpace();
  });
  const dim = material(scene, `${NODE}-pin-mat`, (m) => {
    m.albedoColor = new Color3(0.55, 0.7, 0.85).toLinearSpace();
    m.emissiveColor = new Color3(0.28, 0.4, 0.55).toLinearSpace();
  });
  const stem = material(scene, `${NODE}-stem-mat`, (m) => {
    m.albedoColor = new Color3(0.2, 0.16, 0.12).toLinearSpace();
  });
  const top = FRAME_H + HILL + 0.012;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const a of nodes) {
    for (const id of a.links) {
      const b = byId.get(id);
      if (!b || a.id > b.id) continue;
      const pa = boardXZ(a), pb = boardXZ(b);
      const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      const thread = MeshBuilder.CreateBox(`${NODE}-route`, { width: len, height: 0.006, depth: 0.012 }, scene);
      thread.position.set((pa.x + pb.x) / 2, top, (pa.z + pb.z) / 2);
      thread.rotation.y = -Math.atan2(pb.z - pa.z, pb.x - pa.x);
      thread.material = gold;
      thread.parent = parent;
    }
  }
  for (const n of nodes) {
    const p = boardXZ(n);
    const pole = MeshBuilder.CreateCylinder(`${NODE}-pin-stem`, { diameter: 0.014, height: HILL + 0.04, tessellation: 6 }, scene);
    pole.position.set(p.x, FRAME_H + (HILL + 0.04) / 2, p.z);
    pole.material = stem;
    pole.parent = parent;
    const done = completed.has(n.id);
    const head = MeshBuilder.CreateSphere(`${NODE}-pin`, { diameter: done ? 0.07 : 0.055, segments: 8 }, scene);
    head.position.set(p.x, FRAME_H + HILL + 0.05, p.z);
    head.material = done ? lit : dim;
    head.parent = parent;
  }
}

/** The wooden frame the relief is set into. */
function buildFrame(scene: Scene, parent: TransformNode): void {
  const wood = material(scene, `${NODE}-frame-mat`, (m) => {
    m.albedoColor = new Color3(0.22, 0.13, 0.07).toLinearSpace();
  });
  const frame = MeshBuilder.CreateBox(`${NODE}-frame`, {
    width: ATLAS_MODEL_W + 0.1, height: FRAME_H, depth: ATLAS_MODEL_D + 0.1,
  }, scene);
  frame.position.y = FRAME_H / 2;
  frame.material = wood;
  frame.parent = parent;
}

function fill(scene: Scene, node: TransformNode): void {
  for (const c of node.getChildren()) c.dispose(false, false);
  const seed = current?.seed;
  const nodes = seed === undefined ? [] : atlasGraph(seed);
  buildFrame(scene, node);
  buildRelief(scene, node, nodes, seed ?? 0);
  buildRoutes(scene, node, nodes, new Set(current?.completed ?? []));
  for (const m of node.getChildMeshes()) {
    m.isPickable = false;
    m.receiveShadows = true;
  }
  node.metadata = { atlasKey: current ? key(current.seed, current.completed) : "" };
}

/** Stand the model under `node` (a table extra), from the last Atlas seen. */
export function buildAtlasModel(scene: Scene, node: TransformNode): void {
  node.name = NODE;
  fill(scene, node);
}

/**
 * Point every standing model at this character's Atlas. Cheap to call per
 * snapshot: it rebuilds only when the seed or the cleared places changed.
 */
export function updateAtlasModel(scene: Scene, seed: number, completed: readonly string[]): void {
  const k = key(seed, completed);
  if (!current || key(current.seed, current.completed) !== k) current = { seed, completed: [...completed] };
  for (const node of scene.transformNodes) {
    if (node.name !== NODE || node.isDisposed()) continue;
    if ((node.metadata as { atlasKey?: string } | null)?.atlasKey !== k) fill(scene, node);
  }
}
