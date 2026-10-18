// What makes a swamp pool read as WATER from the game camera when there is no
// sky worth reflecting: duckweed rafts on the surface, a scum line along the
// bank, and slow glints drifting over the open water. Without them a pool is a
// dark stain the player mistakes for a shadow and walks into.
import type { Material } from "@babylonjs/core";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";

export const FEN_PLUGIN = "ExiledFenWater";

/** Linear colours. Duckweed is the brightest thing on the pool by design. */
const WEED = "vec3(0.11, 0.19, 0.035)";
const SCUM = "vec3(0.10, 0.095, 0.05)";

const GLSL = `
  #ifdef FEN_WATER
    float fenWeed = 0.0;
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
  constructor(material: Material) {
    super(material, FEN_PLUGIN, 220, { FEN_WATER: false });
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName(): string {
    return FEN_PLUGIN;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines["FEN_WATER"] = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return { ubo: [{ name: "fenTime", size: 1, type: "float" }], fragment: "uniform float fenTime;" };
  }

  // bindForSubMesh, not hardBind: it runs on every draw, and the glints move.
  override bindForSubMesh(ubo: UniformBuffer): void {
    // Wrapped so float32 keeps sub-frame precision; the wrap is a 17-minute jump.
    ubo.updateFloat("fenTime", (performance.now() / 1000) % 1000);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: GLSL,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef FEN_WATER
        {
          vec2 q = vPositionW.xz;
          // Rafts a metre or two across, broken into clumps, drifting very slowly.
          vec2 d = q + vec2(fenTime * 0.02, fenTime * 0.013);
          float raft = fenNoise(d * 0.6) * 0.65 + fenNoise(d * 1.8) * 0.35;
          float clump = fenNoise(d * 7.0);
          // Off the bank ramp: weed is opaque, and reaching the thin edge it drew
          // the cell staircase the ramp exists to soften.
          fenWeed = smoothstep(0.54, 0.6, raft) * smoothstep(0.25, 0.45, clump) * smoothstep(0.25, 0.6, alpha);
          // Scum where the water thins out over the bank (the vertex alpha ramp).
          float ring = smoothstep(0.15, 0.45, alpha) * (1.0 - smoothstep(0.55, 0.9, alpha));
          surfaceAlbedo = mix(surfaceAlbedo, ${SCUM}, ring * (0.5 + 0.5 * fenNoise(q * 4.0)));
          surfaceAlbedo = mix(surfaceAlbedo, ${WEED} * (0.8 + 0.4 * clump), fenWeed);
          alpha = max(alpha, fenWeed);
        }
        #endif
      `,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        #ifdef FEN_WATER
        {
          vec2 q = vPositionW.xz;
          // Two noise fields drifting against each other: where both peak, a
          // short-lived glint the size of a hand, scattered, never a line.
          float a1 = fenNoise(q * 9.0 + vec2(fenTime * 0.6, fenTime * 0.4));
          float a2 = fenNoise(q * 10.5 - vec2(fenTime * 0.5, fenTime * 0.65));
          float glint = smoothstep(0.78, 0.92, a1 * a2 * 1.6) * (1.0 - fenWeed) * smoothstep(0.6, 0.95, alpha);
          finalColor.rgb += vec3(0.12, 0.13, 0.1) * glint;
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
