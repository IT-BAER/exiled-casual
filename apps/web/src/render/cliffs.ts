// The inland wall as one continuous rock mass instead of a row of boulders.
//
// A height field over every wall cell: zero at a rounded, wandering foot near the
// collision face (never under the player's body), a low scree apron, then a cliff
// climbing well over the player's head. A wall in front of a
// room is held to CLIFF_FRONT by the view rule in `cliffHeights`; whatever still
// stands between the camera and the player stipples away around him (CliffPlugin),
// PoE's see-through wall. The same plugin paints the floor plate up the scree so
// rock and ground meet without a seam.
import { Mesh, VertexData, type Material, type Scene } from "@babylonjs/core";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { WalkableGrid } from "@exiled/mapgen";
import {
  bindContact, contactDefines, contactReady, contactTextures,
  CONTACT_GLSL, CONTACT_SAMPLERS, CONTACT_UBO, CONTACT_UNIFORMS_GLSL,
} from "./contact-band";
import { BETA_AT_DEFAULT, BETA_LIMIT, CAMERA_ALPHA, GROUND_SIZE } from "./engine";

export const CLIFF_MESH_NAME = "wallrun-cliff";

/** Vertex spacing in world units: half a cell, so a cell's centre is a vertex. */
const STEP = 0.25;
/** The tallest the rock gets anywhere: near three times the player. */
export const CLIFF_MAX = 5;
/** What a wall in FRONT of a room may reach. Over his head; the fade covers him. */
export const CLIFF_FRONT = 2.4;
/** The scree at the foot: how high, and how far into the rock it runs. */
const SCREE_H = 0.6;
const SCREE_W = 1.1;
/** Distance past the scree over which the face climbs to ~63% of its height. */
const RISE = 0.5;
/** Slack between the hidden strip and the floor, for the bilinear top between vertices. */
const MARGIN = 0.35;
/** Ground hidden behind a unit of height at the flattest pitch the zoom allows. */
export const HIDE_PER_UNIT = Math.tan(BETA_LIMIT.max);
/** Height of one rock ledge, and how far toward a flat shelf each ledge is pulled. */
const STRATUM = 0.55;
const STRATA = 0.65;
/** Cycles per world unit of the noise that swaps between the plate's two reads: ~6 units a patch. */
const VARY_FREQ = 0.17;
/** The kerb every wall stands at its foot: how tall, and over what collision depth.
 *  Under the head-height rule for boulders (rocks.ts MAX_ASPECT), so an obstacle in
 *  the open hides nobody and no fade is owed. */
const KERB_PEAK = 1.4;
const KERB_RISE = 0.3;
/** Depth the kerb already has at the foot. Lifts it past the tallest first ledge
 *  (STRATUM * 1.2) on a one-cell spur the foot cut leaves 0.01 deep, so none is flat. */
const KERB_LEAD = 0.16;
/** World units per texture repeat; must match TILE in level.ts. */
const TILE = 2;

/** Unit xz vector from the camera's target toward the camera. */
const CAM_X = Math.cos(CAMERA_ALPHA);
const CAM_Z = Math.sin(CAMERA_ALPHA);

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1] at world (x, z), one lattice per `scale` units. */
function noise(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const c = (i: number, j: number) => hash01(ix + i + seed * 7919, iz + j);
  const top = c(0, 0) + (c(1, 0) - c(0, 0)) * sx;
  const bot = c(0, 1) + (c(1, 1) - c(0, 1)) * sx;
  return top + (bot - top) * sz;
}

/** Corner radii of the foot: rock corners pushed back, room corners filled. Under
 *  the 0.5 body radius, so neither opens a gap or covers ground he stands on. */
const ROUND_OUT = 0.625;
const ROUND_IN = 0.625;
/** The most the rounding may cut back or fill at any point, so it turns corners
 *  without shaving a small obstacle away or closing a narrow bay. */
const ROUND_MAX = 0.3;
/** How far the foot wanders off the collision face: back into the rock, out onto floor. */
const RECEDE = 0.25;
const BULGE = 0.12;
/** The furthest the foot may stand behind the collision face, every cut together.
 *  Under the half cell a one-cell spur or bump is deep, so neither is cut away. */
const MAX_CUT = 0.24;
/** Depth the field dips under the floor past the foot. */
const FOOT_SINK = 0.1;

/** Euclidean distance in world units from each vertex to the nearest set one (Felzenszwalb). */
function distanceTo(mask: Uint8Array, nx: number, nz: number): Float32Array {
  const INF = 1e12;
  const g = new Float64Array(nx * nz);
  for (let k = 0; k < g.length; k++) g[k] = mask[k] ? 0 : INF;
  const n = Math.max(nx, nz);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len: number, at: (q: number) => number) => {
    for (let q = 0; q < len; q++) f[q] = g[at(q)]!;
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) { k--; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
    }
    for (let q = 0; q < len; q++) g[at(q)] = d[q]!;
  };
  for (let j = 0; j < nz; j++) pass(nx, (q) => j * nx + q);
  for (let i = 0; i < nx; i++) pass(nz, (q) => q * nx + i);
  const out = new Float32Array(nx * nz);
  for (let k = 0; k < out.length; k++) out[k] = Math.sqrt(g[k]!) * STEP;
  return out;
}

/** Signed distance to a vertex set's edge, positive inside; zero halfway between neighbours. */
function signedDistance(inside: Uint8Array, nx: number, nz: number): Float32Array {
  const toIn = distanceTo(inside, nx, nz);
  const toOut = distanceTo(inside.map((b) => 1 - b), nx, nz);
  return toIn.map((d, k) => (inside[k] ? toOut[k]! - STEP / 2 : -(d - STEP / 2)));
}

/**
 * Signed distance from each vertex to the rock's foot, positive into the rock.
 * The cell staircase, opened and closed by a radius so its corners turn round,
 * blurred off the lattice, then pushed in and out by noise so no face runs ruler-
 * straight. Euclidean throughout: a chamfer distance drew every ledge as a square.
 */
function footDistance(
  open: Uint8Array, nx: number, nz: number, x0: number, z0: number,
): Float32Array {
  // Shifted half a step so the crossing sits ON the last open vertex, the collision face.
  const base = signedDistance(open.map((o) => 1 - o), nx, nz).map((v) => v + STEP / 2);
  let s = signedDistance(Uint8Array.from(base, (v) => (v > ROUND_OUT ? 1 : 0)), nx, nz)
    .map((v, k) => Math.max(v + ROUND_OUT, base[k]! - ROUND_MAX));
  s = signedDistance(Uint8Array.from(s, (v) => (v > -ROUND_IN ? 1 : 0)), nx, nz)
    .map((v, k) => Math.min(v - ROUND_IN, base[k]! + ROUND_MAX));
  const W = [0.135, 0.607, 1, 0.607, 0.135], SUM = W.reduce((a, b) => a + b, 0);
  const blur = (src: Float32Array, di: number, dj: number) => {
    const out = new Float32Array(src.length);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let acc = 0;
      for (let t = -2; t <= 2; t++) {
        const a = Math.min(nx - 1, Math.max(0, i + t * di)), b = Math.min(nz - 1, Math.max(0, j + t * dj));
        acc += src[b * nx + a]! * W[t + 2]!;
      }
      out[j * nx + i] = acc / SUM;
    }
    return out;
  };
  s = blur(blur(s, 1, 0), 0, 1);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * STEP, z = z0 + j * STEP;
    const n = noise(x, z, 1.6, 5) * 0.65 + noise(x, z, 0.55, 6) * 0.35;
    const w = Math.min(1, Math.max(0, (n - 0.5) * 2 + 0.5));
    s[j * nx + i] = s[j * nx + i]! - RECEDE + (RECEDE + BULGE) * w;
  }
  // A wall one cell thin is all foot: cut it back like a thick one and it is gone,
  // while the sim still collides with it. The cut grows with the rock's thickness.
  const widest = (src: Float32Array, di: number, dj: number) => {
    const out = new Float32Array(src.length);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let m = -Infinity;
      for (let t = -3; t <= 3; t++) {
        const a = Math.min(nx - 1, Math.max(0, i + t * di)), b = Math.min(nz - 1, Math.max(0, j + t * dj));
        m = Math.max(m, src[b * nx + a]!);
      }
      out[j * nx + i] = m;
    }
    return out;
  };
  const thick = widest(widest(base, 1, 0), 0, 1);
  return s.map((v, k) => Math.max(v, base[k]! - Math.min(MAX_CUT, Math.max(0, (thick[k]! - STEP) * 1.1))));
}

export interface CliffField {
  /** Vertices per row and per column. */
  nx: number;
  nz: number;
  /** World position of vertex (0, 0). */
  x0: number;
  z0: number;
  step: number;
  /** Height per vertex, row-major; dips under the floor past the foot. */
  heights: Float32Array;
  /** World distance from each vertex in to the foot; 0 outside the rock. */
  depth: Float32Array;
}

/**
 * The height field. The rock begins on the foot (`footDistance`), which keeps
 * within reach of the face the sim collides against and off any floor he can stand on.
 *
 * The cap is the whole point. Seen from the camera at its flattest pitch, a point
 * of height h hides h * HIDE_PER_UNIT of ground behind it, away from the camera.
 * March from each vertex in that direction to the first floor: the rock there may
 * stand (distance - MARGIN) / HIDE_PER_UNIT tall and no more, or CLIFF_FRONT where
 * that is less; the fade owes the player whatever that hides of him.
 */
export function cliffHeights(grid: WalkableGrid): CliffField {
  const { cols, rows, cellSize, originX, originY, cells } = grid;
  const per = Math.round(cellSize / STEP);
  const nx = cols * per + 1, nz = rows * per + 1;
  const x0 = originX - cellSize / 2, z0 = originY - cellSize / 2;
  // Water is wall to the sim only: a pool is open ground the rock stands back from.
  const floorAt = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < cols && cy < rows &&
    (cells[cy * cols + cx] === 1 || grid.water?.[cy * cols + cx] === 1);

  // Open: some cell this vertex lies in or on the edge of is floor.
  const open = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const cy1 = Math.floor(j / per), cy0 = j % per === 0 ? cy1 - 1 : cy1;
    for (let i = 0; i < nx; i++) {
      const cx1 = Math.floor(i / per), cx0 = i % per === 0 ? cx1 - 1 : cx1;
      if (floorAt(cx0, cy0) || floorAt(cx1, cy0) || floorAt(cx0, cy1) || floorAt(cx1, cy1)) open[j * nx + i] = 1;
    }
  }

  const foot = footDistance(open, nx, nz, x0, z0);
  const depth = foot.map((s) => Math.max(0, s));

  const reach = CLIFF_MAX * HIDE_PER_UNIT + MARGIN;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      // Under the floor, so the ground plane cuts the rock on the smooth zero line
      // rather than on whichever lattice vertex was last open.
      if (foot[k]! <= 0) { heights[k] = Math.max(-FOOT_SINK, foot[k]!); continue; }
      const x = x0 + i * STEP, z = z0 + j * STEP;
      let view = reach;
      for (let t = STEP; t < reach; t += STEP / 2) {
        const a = Math.round(i - (CAM_X * t) / STEP), b = Math.round(j - (CAM_Z * t) / STEP);
        if (a < 0 || b < 0 || a >= nx || b >= nz) break;
        if (open[b * nx + a]) { view = t; break; }
      }
      const n = noise(x, z, 1.3, 1) * 0.7 + noise(x, z, 0.45, 2) * 0.3;
      const d = depth[k]!, u = Math.min(1, d / SCREE_W);
      const scree = SCREE_H * u * u * (3 - 2 * u) * (0.7 + 0.6 * noise(x, z, 0.6, 4));
      const face = Math.max(0, d - SCREE_W * 0.8);
      const rise = scree + (CLIFF_MAX - SCREE_H) * (1 - Math.exp(-face / RISE)) * (0.72 + 0.28 * n);
      const cap = Math.max(CLIFF_FRONT * (0.8 + 0.2 * n), (view - MARGIN) / HIDE_PER_UNIT);
      // Strata: ledges rounded DOWN, so they can only ever lower a vertex under its cap.
      let h = Math.min(rise, cap);
      // A kerb on every wall, on the rounded foot so it keeps its outline: scree
      // alone stays under the floor blend for a unit and reads as ground the sim still blocks.
      const v = Math.min(1, (d + KERB_LEAD) / KERB_RISE);
      h = Math.max(h, Math.min(cap, KERB_PEAK * v * v * (3 - 2 * v) * (0.85 + 0.3 * n)));
      const shelf = STRATUM * (0.8 + 0.4 * noise(x, z, 2.2, 3));
      heights[k] = h - (h % shelf) * STRATA;
    }
  }
  return { nx, nz, x0, z0, step: STEP, heights, depth };
}

/**
 * The mesh for a field: quads wherever any corner stands up, jittered off the
 * lattice inside the rock, UVs projected along the camera's own view direction.
 * That projection is why a sheer face shows the plate at the same grain as a flat
 * top: from the lens the texture is never stretched, whatever the slope.
 */
export function cliffVertexData(field: CliffField): VertexData | null {
  const { nx, nz, x0, z0, step, heights, depth } = field;
  const index = new Int32Array(nx * nz).fill(-1);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const awayX = -CAM_X, awayZ = -CAM_Z;
  const cosB = Math.cos(BETA_AT_DEFAULT), sinB = Math.sin(BETA_AT_DEFAULT);

  const vertex = (i: number, j: number): number => {
    const k = j * nx + i;
    if (index[k]! >= 0) return index[k]!;
    let x = x0 + i * step, z = z0 + j * step;
    // Off the lattice, but only well inside the rock: the foot stays on the face.
    if (depth[k]! >= step) {
      x += (hash01(i, j * 3 + 1) - 0.5) * step * 0.9;
      z += (hash01(i * 5 + 2, j) - 0.5) * step * 0.9;
    }
    const y = heights[k]!;
    positions.push(x, y, z);
    uvs.push((x * awayZ - z * awayX) / TILE, ((x * awayX + z * awayZ) * cosB + y * sinB) / TILE);
    // Deep rock goes dark: PoE's walls are near-black off the floor plane.
    const t = Math.min(1, Math.max(0, (depth[k]! - 0.75) / 2.25));
    const shade = 1 - 0.6 * t * t * (3 - 2 * t);
    colors.push(shade, shade, shade, 1);
    index[k] = positions.length / 3 - 1;
    return index[k]!;
  };

  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (Math.max(heights[a]!, heights[b]!, heights[c]!, heights[d]!) <= 0) continue;
      const va = vertex(i, j), vb = vertex(i + 1, j), vc = vertex(i, j + 1), vd = vertex(i + 1, j + 1);
      // Alternate the diagonal so the facets do not all lean one way.
      if ((i + j) % 2 === 0) indices.push(va, vb, vc, vb, vd, vc);
      else indices.push(va, vd, vc, va, vb, vd);
    }
  }
  if (indices.length === 0) return null;
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  data.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  return data;
}

/** Rock under this height never fades, so his feet keep their ground contact. */
const FADE_FOOT = 0.6;
/** Radius of the clear column around the camera-to-player line, and its soft edge.
 *  About his own width: at 1.3 + 1.1 the hole was wider than a pack and read as a
 *  window cut in the map rather than as seeing him through the rock. */
const FADE_RADIUS = 0.6;
const FADE_FEATHER = 0.7;
/** A faded wall keeps this much of itself: enough stipple that it is still rock
 *  in front of him, not a gap he is standing in. */
const FADE_KEEP = 0.4;
/** Where the line is aimed: his chest, not his feet. */
const FOCUS_Y = 1;
/** Height the floor plate climbs up the scree before the rock takes over, and how
 *  far noise moves that line up and down, as a fraction of it. */
const BLEND_H = 0.75;
const BLEND_WANDER = 0.45;

const PLUGIN = "ExiledCliff";
const f3 = (v: number) => v.toFixed(3);

class CliffPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, PLUGIN, 200, { CLIFF_FLOOR: false, CONTACT_BAND: false });
    // Same ES-module serialisation trap as rim.ts.
    this.doNotSerialize = true;
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  override getClassName(): string {
    return PLUGIN;
  }

  /** The ground's plate, read live: a biome swaps it (applyTilesetFloor). */
  private floor(): Texture | null {
    const mat = this._material.getScene().getMaterialByName("groundMat") as PBRMaterial | null;
    return (mat?.albedoTexture as Texture | null) ?? null;
  }

  override prepareDefines(defines: MaterialDefines, scene: Scene): void {
    defines["CLIFF_FLOOR"] = !!this.floor();
    contactDefines(defines, scene);
  }

  override isReadyForSubMesh(_defines: MaterialDefines, scene: Scene): boolean {
    return (this.floor()?.isReady() ?? true) && contactReady(scene);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("cliffFloorSampler", ...CONTACT_SAMPLERS);
  }

  override getActiveTextures(active: BaseTexture[]): void {
    const tex = this.floor();
    if (tex) active.push(tex);
    active.push(...contactTextures(this._material.getScene()));
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.floor() || contactTextures(this._material.getScene()).includes(texture);
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "cliffEye", size: 3, type: "vec3" },
        { name: "cliffFocus", size: 3, type: "vec3" },
        { name: "cliffFloorUV", size: 4, type: "vec4" },
        ...CONTACT_UBO,
      ],
      fragment: `
        uniform vec3 cliffEye;
        uniform vec3 cliffFocus;
        uniform vec4 cliffFloorUV;
        ${CONTACT_UNIFORMS_GLSL}
      `,
    };
  }

  // Every draw: the camera moves every frame and a biome can swap the plate.
  override hardBindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const cam = scene.activeCamera as ArcRotateCamera | null;
    if (cam?.target) {
      ubo.updateFloat3("cliffEye", cam.position.x, cam.position.y, cam.position.z);
      ubo.updateFloat3("cliffFocus", cam.target.x, FOCUS_Y, cam.target.z);
    }
    const tex = this.floor();
    const ground = scene.getMeshByName("ground");
    if (!tex || !ground) return;
    // CreateGround maps u = x / width + 0.5 (v likewise on z) and the texture only
    // scales that, no offset: measured under NullEngine.
    const ku = tex.uScale / (GROUND_SIZE * ground.scaling.x);
    const kv = tex.vScale / (GROUND_SIZE * ground.scaling.z);
    ubo.updateFloat4("cliffFloorUV", ku, kv, tex.uScale / 2 - ground.position.x * ku, tex.vScale / 2 - ground.position.z * kv);
    ubo.setTexture("cliffFloorSampler", tex);
    bindContact(ubo, scene);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      // Here, not in getUniforms: under a UBO that block is dropped, samplers with it.
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef CLIFF_FLOOR
          uniform sampler2D cliffFloorSampler;
        #endif
        ${CONTACT_GLSL}
        float cliffNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 s = f * f * (3.0 - 2.0 * f);
          #define CLIFF_NHASH(q) fract(sin(dot(q, vec2(269.5, 183.3))) * 43758.5453)
          return mix(mix(CLIFF_NHASH(i), CLIFF_NHASH(i + vec2(1.0, 0.0)), s.x),
                     mix(CLIFF_NHASH(i + vec2(0.0, 1.0)), CLIFF_NHASH(i + vec2(1.0, 1.0)), s.x), s.y);
        }
      `,
      // Stippled, not blended: a translucent wall needs sorting against every
      // creature behind it, a discard needs nothing.
      CUSTOM_FRAGMENT_MAIN_BEGIN: `
        {
          vec3 cliffLine = cliffFocus - cliffEye;
          float cliffLen = length(cliffLine);
          vec3 cliffDir = cliffLine / cliffLen;
          vec3 cliffRel = vPositionW - cliffEye;
          float cliffAlong = dot(cliffRel, cliffDir);
          float cliffOff = length(cliffRel - cliffDir * cliffAlong);
          float cliffFade = (1.0 - smoothstep(${f3(FADE_RADIUS)}, ${f3(FADE_RADIUS + FADE_FEATHER)}, cliffOff))
            * step(cliffAlong, cliffLen - 0.2)
            * smoothstep(${f3(FADE_FOOT)}, ${f3(FADE_FOOT + 0.5)}, vPositionW.y)
            * ${f3(1 - FADE_KEEP)};
          float cliffNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (cliffFade > cliffNoise) discard;
        }
      `,
      // A second read of the plate, turned and rescaled, faded in and out by
      // world-space noise a few tiles wide: one plate along a whole cliff line
      // repeats every 2 units otherwise. Then the floor plate up the scree,
      // broken by the rock's own grain so the line wanders; the normal leans to
      // the floor's so the light agrees too.
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef ALBEDO
        {
          vec2 cliffCell = vPositionW.xz * ${f3(VARY_FREQ)};
          vec2 cliffI = floor(cliffCell), cliffF = fract(cliffCell);
          vec2 cliffS = cliffF * cliffF * (3.0 - 2.0 * cliffF);
          #define CLIFF_HASH(p) fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
          float cliffN = mix(mix(CLIFF_HASH(cliffI), CLIFF_HASH(cliffI + vec2(1.0, 0.0)), cliffS.x),
                             mix(CLIFF_HASH(cliffI + vec2(0.0, 1.0)), CLIFF_HASH(cliffI + vec2(1.0, 1.0)), cliffS.x), cliffS.y);
          float cliffW = smoothstep(0.3, 0.7, cliffN);
          vec2 cliffUV2 = mat2(0.4536, -0.8912, 0.8912, 0.4536) * vAlbedoUV * 0.73 + vec2(0.37, 0.61);
          vec3 cliffAlt = texture2D(albedoSampler, cliffUV2).rgb;
          #ifdef GAMMAALBEDO
            cliffAlt = toLinearSpace(cliffAlt);
          #endif
          cliffAlt *= vAlbedoInfos.y * vAlbedoColor.rgb;
          surfaceAlbedo = mix(surfaceAlbedo, cliffAlt, cliffW);
        }
        #endif
        #ifdef CLIFF_FLOOR
        {
          float cliffGrain = dot(surfaceAlbedo, vec3(0.333)) / max(dot(vAlbedoColor.rgb, vec3(0.333)), 1e-3);
          float cliffH = vPositionW.y + (cliffGrain - 0.5) * 0.35;
          // The line the floor reaches wanders up and down the scree, a few
          // units a swing, so no contour of the rock shows as a ruled edge.
          float cliffTop = ${f3(BLEND_H)} * (1.0 + (cliffNoise(vPositionW.xz * 0.45) - 0.5) * ${f3(2 * BLEND_WANDER)});
          // A top-down projection smears into streaks where the face turns steep.
          float cliffMix = (1.0 - smoothstep(cliffTop * 0.35, cliffTop, cliffH))
            * smoothstep(0.55, 0.8, normalW.y);
          vec2 cliffUV = vPositionW.xz * cliffFloorUV.xy + cliffFloorUV.zw;
          vec3 cliffGround = toLinearSpace(texture2D(cliffFloorSampler, cliffUV).rgb);
          #ifdef CONTACT_BAND
            cliffGround = contactShade(cliffGround, vPositionW);
          #endif
          surfaceAlbedo = mix(surfaceAlbedo, cliffGround, cliffMix);
          normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), cliffMix * 0.8));
        }
        #endif
      `,
    };
  }
}

/**
 * The cliff's own material: the tileset's wall material plus the plugin, cached
 * beside it. A clone, because rubble and rampart share the original and must
 * neither fade nor wear floor.
 */
export function cliffMaterial(wall: Material): Material {
  const name = `${wall.name}-cliff`;
  const existing = wall.getScene().getMaterialByName(name);
  if (existing) return existing;
  const mat = wall.clone(name)!;
  new CliffPlugin(mat);
  return mat;
}

/** Build the cliff mesh for a grid, or nothing when the grid has no rock to raise. */
export function buildCliffs(scene: Scene, grid: WalkableGrid, material: Material): Mesh | null {
  scene.getMeshByName(CLIFF_MESH_NAME)?.dispose();
  const data = cliffVertexData(cliffHeights(grid));
  if (!data) return null;
  const mesh = new Mesh(CLIFF_MESH_NAME, scene);
  data.applyToMesh(mesh, false);
  // Facets are what make it rock: smooth normals read as a moulded ramp.
  mesh.convertToFlatShadedMesh();
  mesh.material = cliffMaterial(material);
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
  return mesh;
}
