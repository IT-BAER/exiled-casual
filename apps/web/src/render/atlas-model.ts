import { Color3, Mesh, MeshBuilder, PBRMaterial, TransformNode, VertexData, type Scene } from "@babylonjs/core";
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
/** Relief resolution: vertices across and deep. */
const NX = 76, NZ = 32;
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

/** The relief: a height field over the board, coloured by the nearest places' biomes. */
function buildRelief(scene: Scene, parent: TransformNode, nodes: readonly AtlasGraphNode[], seed: number): void {
  const at = nodes.map((n) => ({ ...boardXZ(n), tint: nodes.length ? tintOf(n) : SEA }));
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const u = i / (NX - 1), v = j / (NZ - 1);
      const x = (u - 0.5) * ATLAS_MODEL_W, z = (v - 0.5) * ATLAS_MODEL_D;
      // Land where places are, sea toward the edge: a coast of noise around them.
      let land = 0, wsum = 0;
      const tint = [0, 0, 0];
      for (const p of at) {
        const d2 = ((x - p.x) / 0.5) ** 2 + ((z - p.z) / 0.3) ** 2;
        land = Math.max(land, Math.exp(-d2 * 1.6));
        const w = 1 / (d2 * d2 + 0.002);
        wsum += w;
        for (let k = 0; k < 3; k++) tint[k]! += p.tint[k]! * w;
      }
      const edge = Math.min(u, 1 - u, v, 1 - v) * 2;
      const n1 = noise(x * 5, z * 5, seed), n2 = noise(x * 13, z * 13, seed + 7);
      const height = Math.max(0, Math.min(1, land * 1.25 + (n1 - 0.5) * 0.7) * Math.min(1, edge * 3.5) - 0.18);
      const h = nodes.length ? height * HILL * (0.65 + 0.7 * n2) : 0.004;
      positions.push(x, FRAME_H + h, z);
      const sea = h < 0.006;
      const shade = sea ? 1 : 0.78 + 0.4 * Math.min(1, h / HILL) + (n2 - 0.5) * 0.12;
      for (let k = 0; k < 3; k++) {
        const c = sea ? SEA[k]! * (0.85 + n1 * 0.3) : (tint[k]! / wsum) * shade;
        // The tints are written as seen; PBR wants them linear.
        colors.push(c * c);
      }
      colors.push(1);
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
  data.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  mesh.material = material(scene, `${NODE}-relief-mat`, (m) => {
    m.albedoColor = Color3.White();
    // The table stands away from the fires; a little of its own light keeps the
    // land readable as land and not a dark slab.
    m.emissiveColor = new Color3(0.07, 0.06, 0.05).toLinearSpace();
  });
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
