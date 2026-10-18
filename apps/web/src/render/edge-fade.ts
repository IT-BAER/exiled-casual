// The map's edge sinks into the void: the rampart's rocks darken to the scene's fog
// colour with their distance past the walkable rim, so an outer face is black
// where it would otherwise end in a hard lit edge. Interior rocks and cliffs
// keep the plain wall material; only the copy the rampart wears carries this.
import type { Material } from "@babylonjs/core/Materials/material";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { WalkableGrid } from "@exiled/mapgen";

/** World units past the walkable rim where the darkening begins. The rampart's
 *  inner face stands inside this and keeps its look. */
export const EDGE_FADE_START = 0.5;
/** World units over which the rock falls from its look to the floor below. */
export const EDGE_FADE_LENGTH = 2.5;
/** Fraction of the fog colour's brightness the fade ends on: 0 is the fog itself. */
export const EDGE_FADE_FLOOR = 0.03;

export const EDGE_FADE_PLUGIN = "ExiledEdgeFade";
const f3 = (v: number) => v.toFixed(3);

/** The walkable area's bounding box in world xz, cell edges included. */
export interface EdgeRect { minX: number; minZ: number; maxX: number; maxZ: number }

export function edgeRect(grid: WalkableGrid): EdgeRect | null {
  const { cols, rows, cellSize, originX, originY, cells } = grid;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (cells[y * cols + x] !== 1) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const h = cellSize / 2;
  return {
    minX: originX + x0 * cellSize - h, maxX: originX + x1 * cellSize + h,
    minZ: originY + y0 * cellSize - h, maxZ: originY + y1 * cellSize + h,
  };
}

/** Distance from (x, z) outside the rect: 0 over it. Mirrors the shader. */
export function edgeDistance(r: EdgeRect, x: number, z: number): number {
  return Math.hypot(Math.max(r.minX - x, x - r.maxX, 0), Math.max(r.minZ - z, z - r.maxZ, 0));
}

/** 1 at the rim, EDGE_FADE_FLOOR once fully faded. Mirrors the shader. */
export function edgeBrightness(d: number): number {
  const t = Math.min(1, Math.max(0, (d - EDGE_FADE_START) / EDGE_FADE_LENGTH));
  return 1 - (1 - EDGE_FADE_FLOOR) * t * t * (3 - 2 * t);
}

class EdgeFadePlugin extends MaterialPluginBase {
  rect: EdgeRect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  constructor(material: Material) {
    super(material, EDGE_FADE_PLUGIN, 220, {});
    // Same ES-module serialisation trap as rim.ts.
    this.doNotSerialize = true;
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  override getClassName(): string {
    return EDGE_FADE_PLUGIN;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "edgeRect", size: 4, type: "vec4" },
        { name: "edgeFog", size: 3, type: "vec3" },
      ],
      fragment: `
        uniform vec4 edgeRect;
        uniform vec3 edgeFog;
      `,
    };
  }

  // Every draw, and the live fog colour: a biome tint or the coast's haze
  // changes it after the material is built.
  override hardBindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const r = this.rect;
    ubo.updateFloat4("edgeRect", r.minX, r.minZ, r.maxX, r.maxZ);
    const f = scene.fogColor;
    ubo.updateFloat3("edgeFog", f.r, f.g, f.b);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        float edgeFadeT() {
          vec2 edgeOut = max(max(edgeRect.xy - vPositionW.xz, vPositionW.xz - edgeRect.zw), vec2(0.0));
          return smoothstep(0.0, 1.0, (length(edgeOut) - ${f3(EDGE_FADE_START)}) / ${f3(EDGE_FADE_LENGTH)});
        }
      `,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        surfaceAlbedo = mix(surfaceAlbedo, toLinearSpace(edgeFog) * ${f3(EDGE_FADE_FLOOR)}, edgeFadeT());
      `,
      // Albedo alone leaves specular and sky light on the faded rock, a grey
      // shape on the void. The raw fog colour is what the clear colour shows
      // as, with or without the image-processing post-process.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        finalColor.rgb = mix(finalColor.rgb, edgeFog, edgeFadeT());
      `,
    };
  }
}

/**
 * The rampart's own copy of `rock`, darkening toward the fog with its distance
 * past `grid`'s walkable rim. Built once per `rock` and re-aimed on each area.
 */
export function edgeFadeMaterial(scene: Scene, rock: PBRMaterial, grid: WalkableGrid): PBRMaterial {
  const name = `${rock.name}-edge`;
  const mat = (scene.getMaterialByName(name) as PBRMaterial | null) ?? rock.clone(name);
  aimEdgeFade(mat, grid);
  return mat;
}

/** Give `mat` the fade if it lacks it, aimed at `grid`'s walkable rim. */
export function aimEdgeFade(mat: Material, grid: WalkableGrid): void {
  mat.unfreeze();
  const plugin = mat.pluginManager?.getPlugin<EdgeFadePlugin>(EDGE_FADE_PLUGIN) ?? new EdgeFadePlugin(mat);
  const rect = edgeRect(grid);
  if (rect) plugin.rect = rect;
}
