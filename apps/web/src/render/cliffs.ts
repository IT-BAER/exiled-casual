// The inland wall as one continuous rock mass instead of a row of boulders.
//
// A height field over every wall cell: zero at the collision face, a low scree
// apron, then a cliff climbing well over the player's head. A wall in front of a
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

export interface CliffField {
  /** Vertices per row and per column. */
  nx: number;
  nz: number;
  /** World position of vertex (0, 0). */
  x0: number;
  z0: number;
  step: number;
  /** Height per vertex, row-major; 0 wherever a floor cell touches the vertex. */
  heights: Float32Array;
  /** World distance from each vertex to the nearest floor-touching vertex. */
  depth: Float32Array;
}

/**
 * The height field. A vertex touching any floor cell is 0, so the rock begins
 * exactly on the face the sim collides against and never stands on walkable floor.
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
  const floorAt = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < cols && cy < rows && cells[cy * cols + cx] === 1;

  // Open: some cell this vertex lies in or on the edge of is floor.
  const open = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const cy1 = Math.floor(j / per), cy0 = j % per === 0 ? cy1 - 1 : cy1;
    for (let i = 0; i < nx; i++) {
      const cx1 = Math.floor(i / per), cx0 = i % per === 0 ? cx1 - 1 : cx1;
      if (floorAt(cx0, cy0) || floorAt(cx1, cy0) || floorAt(cx0, cy1) || floorAt(cx1, cy1)) open[j * nx + i] = 1;
    }
  }

  // Chamfer distance to the nearest open vertex, two passes.
  const depth = new Float32Array(nx * nz).fill(1e9);
  for (let k = 0; k < open.length; k++) if (open[k]) depth[k] = 0;
  const D = STEP, DD = STEP * Math.SQRT2;
  const relax = (k: number, i: number, j: number, di: number, dj: number, w: number) => {
    const a = i + di, b = j + dj;
    if (a < 0 || b < 0 || a >= nx || b >= nz) return;
    const v = depth[b * nx + a]! + w;
    if (v < depth[k]!) depth[k] = v;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    relax(k, i, j, -1, 0, D); relax(k, i, j, 0, -1, D); relax(k, i, j, -1, -1, DD); relax(k, i, j, 1, -1, DD);
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    relax(k, i, j, 1, 0, D); relax(k, i, j, 0, 1, D); relax(k, i, j, 1, 1, DD); relax(k, i, j, -1, 1, DD);
  }

  const reach = CLIFF_MAX * HIDE_PER_UNIT + MARGIN;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (open[k]) continue;
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
      const h = Math.min(rise, cap);
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
      if (heights[a]! + heights[b]! + heights[c]! + heights[d]! <= 0) continue;
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
/** Radius of the clear column around the camera-to-player line, and its soft edge. */
const FADE_RADIUS = 1.3;
const FADE_FEATHER = 1.1;
/** A faded wall keeps this much of itself: the stipple still says rock. */
const FADE_KEEP = 0.12;
/** Where the line is aimed: his chest, not his feet. */
const FOCUS_Y = 1;
/** Height the floor plate climbs up the scree before the rock takes over. */
const BLEND_H = 0.75;

const PLUGIN = "ExiledCliff";
const f3 = (v: number) => v.toFixed(3);

class CliffPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, PLUGIN, 200, { CLIFF_FLOOR: false });
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

  override prepareDefines(defines: MaterialDefines): void {
    defines["CLIFF_FLOOR"] = !!this.floor();
  }

  override isReadyForSubMesh(): boolean {
    return this.floor()?.isReady() ?? true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("cliffFloorSampler");
  }

  override getActiveTextures(active: BaseTexture[]): void {
    const tex = this.floor();
    if (tex) active.push(tex);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.floor();
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "cliffEye", size: 3, type: "vec3" },
        { name: "cliffFocus", size: 3, type: "vec3" },
        { name: "cliffFloorUV", size: 4, type: "vec4" },
      ],
      fragment: `
        uniform vec3 cliffEye;
        uniform vec3 cliffFocus;
        uniform vec4 cliffFloorUV;
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
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      // Here, not in getUniforms: under a UBO that block is dropped, samplers with it.
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef CLIFF_FLOOR
          uniform sampler2D cliffFloorSampler;
        #endif
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
          // A top-down projection smears into streaks where the face turns steep.
          float cliffMix = (1.0 - smoothstep(${f3(BLEND_H * 0.35)}, ${f3(BLEND_H)}, cliffH))
            * smoothstep(0.55, 0.8, normalW.y);
          vec2 cliffUV = vPositionW.xz * cliffFloorUV.xy + cliffFloorUV.zw;
          vec3 cliffGround = toLinearSpace(texture2D(cliffFloorSampler, cliffUV).rgb);
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
