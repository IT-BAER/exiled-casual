// What makes a swamp pool read as still water and not as a dark shape cut out
// of the floor: a bank shaped off a smoothed mask instead of the cell staircase,
// mud wet past the edge, a mud bed where it is shallow, and a canopy mirrored in
// it that slides as the camera moves.
import { Constants, RawTexture, Texture } from "@babylonjs/core";
import type { BaseTexture, Material, Scene } from "@babylonjs/core";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";

export const FEN_PLUGIN = "ExiledFenWater";

/** Linear colours: the bed seen through a film of water, and the bank it keeps wet. */
const MUD = "vec3(0.035, 0.026, 0.016)";
const WET_MUD = "vec3(0.028, 0.021, 0.013)";

/** The water mask blurred once (1 2 1 / 2 4 2 / 1 2 1), as RGBA bytes with the
 *  value in red. Sampled bilinearly, its half-way line runs along the cell edge
 *  where a bank is straight and cuts a staircase's corners round. */
export function shoreMask(water: ArrayLike<number>, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows * 4);
  const K = [1, 2, 1];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const nx = x + i, ny = y + j;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !water[ny * cols + nx]) continue;
          s += K[i + 1]! * K[j + 1]!;
        }
      out[(y * cols + x) * 4] = Math.round((s / 16) * 255);
    }
  return out;
}

/** A pool's shore mask and the grid it was cut from; cell (0, 0)'s centre is
 *  at (originX, originY). */
interface FenShore {
  texture: BaseTexture;
  originX: number;
  originY: number;
  cellSize: number;
  cols: number;
  rows: number;
}

const GLSL = `
  #ifdef FEN_WATER
    #ifdef FEN_SHORE
      uniform sampler2D fenShoreSampler;
    #endif
    float fenHash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
    float fenNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 s = f * f * (3.0 - 2.0 * f);
      return mix(mix(fenHash(i), fenHash(i + vec2(1.0, 0.0)), s.x),
                 mix(fenHash(i + vec2(0.0, 1.0)), fenHash(i + vec2(1.0, 1.0)), s.x), s.y);
    }
  #endif
`;

class FenWaterPlugin extends MaterialPluginBase {
  /** Set while a fen is built; the define follows it. */
  shore: FenShore | null = null;

  constructor(material: Material) {
    super(material, FEN_PLUGIN, 220, { FEN_WATER: false, FEN_SHORE: false });
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName(): string {
    return FEN_PLUGIN;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines["FEN_WATER"] = true;
    defines["FEN_SHORE"] = this.shore !== null;
  }

  override isReadyForSubMesh(): boolean {
    return this.shore?.texture.isReady() ?? true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("fenShoreSampler");
  }

  override getActiveTextures(active: BaseTexture[]): void {
    if (this.shore) active.push(this.shore.texture);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.shore?.texture;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return { ubo: [{ name: "fenShore", size: 4, type: "vec4" }], fragment: "uniform vec4 fenShore;" };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const s = this.shore;
    if (!s) return;
    // World xz to mask uv: texel (x, y) sits at cell (x, y)'s centre.
    ubo.updateFloat4(
      "fenShore", s.originX - s.cellSize / 2, s.originY - s.cellSize / 2,
      1 / (s.cols * s.cellSize), 1 / (s.rows * s.cellSize),
    );
    ubo.setTexture("fenShoreSampler", s.texture);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: GLSL,
      // After the water plugin's: it has set the colour, opacity and sheen.
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef FEN_WATER
        {
          vec2 q = vPositionW.xz;
          float shore = 1.0;
          float band = 0.0;
          #ifdef FEN_SHORE
          {
            // The bank off the smoothed mask, wavered so it never runs ruled straight.
            float m = texture2D(fenShoreSampler, (q - fenShore.xy) * fenShore.zw).r;
            m += (fenNoise(q * 1.3) - 0.5) * 0.18 + (fenNoise(q * 4.7) - 0.5) * 0.06;
            shore = smoothstep(0.45, 0.55, m);
            band = smoothstep(0.1, 0.5, m) * (1.0 - shore);
          }
          #endif
          // Under a film of water the bed is mud, never the floor's sand: the
          // water's own opacity says how much of the bed still shows.
          surfaceAlbedo = mix(${WET_MUD}, mix(${MUD}, surfaceAlbedo, alpha), shore);
          alpha = max(shore * 0.96, band * 0.7);
          wDry = (1.0 - shore) * 0.6;
          wFoam *= shore;
          wCaust *= shore;
          wGlint *= shore;
          // A canopy mirrored overhead, its gaps a little brighter: found off the
          // reflected ray at the canopy's height, so it slides as the camera
          // moves and a ring bends it. Capped, so grazing water never goes grey.
          vec3 fenV = normalize(vEyePosition.xyz - vPositionW);
          vec3 fenR = reflect(-fenV, normalW);
          vec2 up = q + fenR.xz * (6.0 / max(fenR.y, 0.25));
          float gaps = smoothstep(0.5, 0.78, fenNoise(up * 0.55) * 0.65 + fenNoise(up * 1.7) * 0.35);
          wRefl = min(wRefl, 0.45) * (0.15 + 1.4 * gaps) * shore;
        }
        #endif
      `,
    };
  }
}

/** Attach once; the material is cached across area builds. */
export function dressFenWater(material: Material): void {
  if (material.pluginManager?.getPlugin(FEN_PLUGIN)) return;
  new FenWaterPlugin(material);
}

/** Shape the fen's banks off this grid's water, or with null drop the last
 *  one's mask. */
export function shapeFenShore(
  scene: Scene,
  material: Material,
  grid: { cols: number; rows: number; cellSize: number; originX: number; originY: number; water: ArrayLike<number> } | null,
): void {
  const plugin = material.pluginManager?.getPlugin(FEN_PLUGIN) as FenWaterPlugin | null | undefined;
  if (!plugin) return;
  plugin.shore?.texture.dispose();
  plugin.shore = null;
  if (!grid) return;
  const { cols, rows, cellSize, originX, originY, water } = grid;
  const texture = new RawTexture(
    shoreMask(water, cols, rows), cols, rows, Constants.TEXTUREFORMAT_RGBA, scene,
    false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  plugin.shore = { texture, originX, originY, cellSize, cols, rows };
}
