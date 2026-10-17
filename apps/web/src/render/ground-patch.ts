// A second ground plate laid over a biome's floor in world-space noise blobs, so
// a forest floor is gravel AND leaf litter and a swamp is mud with standing
// water in it. One plate tiled over 72 units reads as wallpaper from the game
// camera; PoE's floors (`inside-map.jpg`) are never one material wide.
import { Texture, type Material, type Scene } from "@babylonjs/core";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";

/** How one biome's patches look. Noise is in world units, so a patch is the same
 *  size on every map and every screen. */
export interface PatchSpec {
  /** Plate under `textures/tilesets/<biome>/`. */
  file: string;
  /** World units per repeat of the patch plate. */
  tile: number;
  /** Noise cycles per world unit: 0.1 makes blobs about five units across. */
  freq: number;
  /** Rough share of the floor the patches cover, 0..1. */
  cover: number;
  /** How far the patch replaces the floor at its heart, 0..1. */
  strength: number;
  /** Gloss on the patch (wet mud), 0..1 of a mirror. */
  wet: number;
  /** Standing water this far (in noise units, ~0.1-0.3) inside a patch's edge; 0 for none. */
  puddle: number;
  /** Multiplier on the patch plate, linear. */
  tint: [number, number, number];
}

/** Desert and coast have none: their plates were judged right alone and must not change. */
export const PATCHES: Readonly<Record<string, PatchSpec>> = {
  "tileset.forest": { file: "patch_color.jpg", tile: 4, freq: 0.09, cover: 0.5, strength: 0.92, wet: 0, puddle: 0, tint: [1, 1, 1] },
  "tileset.swamp": { file: "patch_color.jpg", tile: 4, freq: 0.08, cover: 0.55, strength: 0.9, wet: 0.7, puddle: 0.2, tint: [0.95, 1, 0.9] },
  "tileset.vaal_stone": { file: "patch_color.jpg", tile: 3, freq: 0.13, cover: 0.38, strength: 0.75, wet: 0, puddle: 0, tint: [0.9, 1, 0.92] },
};

export const PATCH_PLUGIN = "ExiledGroundPatch";

interface PatchState { tex: Texture | null; spec: PatchSpec | null }
const states = new WeakMap<Scene, PatchState>();

const PATCH_GLSL = `
  #ifdef GROUND_PATCH
    uniform sampler2D patchSampler;
    float patchGloss = 0.0;
    float patchHash(vec2 p) { return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453); }
    float patchNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 s = f * f * (3.0 - 2.0 * f);
      return mix(mix(patchHash(i), patchHash(i + vec2(1.0, 0.0)), s.x),
                 mix(patchHash(i + vec2(0.0, 1.0)), patchHash(i + vec2(1.0, 1.0)), s.x), s.y);
    }
    // Three octaves, rotated between them so the blobs never line up on the grid.
    float patchField(vec2 p) {
      const mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
      float n = patchNoise(p) * 0.6;
      p = r * p * 2.1; n += patchNoise(p) * 0.28;
      p = r * p * 2.3; n += patchNoise(p) * 0.12;
      return n;
    }
    vec3 patchShade(vec3 albedo, vec3 posW) {
      vec2 q = posW.xz;
      float n = patchField(q * patchK.y + 17.0);
      // A fine ragged rim, so the edge of a patch is torn rather than drawn.
      n += (patchNoise(q * 1.7) - 0.5) * 0.07;
      float t = 1.0 - patchK.z;
      float m = smoothstep(t - 0.06, t + 0.06, n) * patchK.w;
      vec3 plate = toLinearSpace(texture2D(patchSampler, q * patchK.x).rgb) * patchTint;
      albedo = mix(albedo, plate, m);
      // Wet: darker and glossier; at the very heart of the wettest patches,
      // standing water that shows the sky and the fire instead of its own colour.
      float water = smoothstep(t + patchWet.y, t + patchWet.y + 0.02, n) * step(0.0001, patchWet.y);
      albedo *= 1.0 - 0.3 * patchWet.x * m;
      albedo = mix(albedo, albedo * vec3(0.18, 0.21, 0.17), water);
      patchGloss = max(patchWet.x * m * 0.7, water * 0.93);
      return albedo;
    }
  #endif
`;

class GroundPatchPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Under the contact band (210): the rock's dust and shadow fall over a patch too.
    super(material, PATCH_PLUGIN, 205, { GROUND_PATCH: false });
    // Or hardBindForSubMesh never runs (Babylon 9): see contact-band.ts.
    this.registerForExtraEvents = true;
    // Same ES-module serialisation trap as rim.ts.
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName(): string {
    return PATCH_PLUGIN;
  }

  override prepareDefines(defines: MaterialDefines, scene: Scene): void {
    defines["GROUND_PATCH"] = !!states.get(scene)?.tex;
  }

  override isReadyForSubMesh(_defines: MaterialDefines, scene: Scene): boolean {
    return states.get(scene)?.tex?.isReady() ?? true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("patchSampler");
  }

  override getActiveTextures(active: BaseTexture[]): void {
    const tex = states.get(this._material.getScene())?.tex;
    if (tex) active.push(tex);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return states.get(this._material.getScene())?.tex === texture;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "patchK", size: 4, type: "vec4" },
        { name: "patchWet", size: 2, type: "vec2" },
        { name: "patchTint", size: 3, type: "vec3" },
      ],
      fragment: `
        uniform vec4 patchK;
        uniform vec2 patchWet;
        uniform vec3 patchTint;
      `,
    };
  }

  override hardBindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const s = states.get(scene);
    if (!s?.tex || !s.spec) return;
    const p = s.spec;
    ubo.updateFloat4("patchK", 1 / p.tile, p.freq, p.cover, p.strength);
    ubo.updateFloat2("patchWet", p.wet, p.puddle);
    ubo.updateFloat3("patchTint", ...p.tint);
    ubo.setTexture("patchSampler", s.tex);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: PATCH_GLSL,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef GROUND_PATCH
          surfaceAlbedo = patchShade(surfaceAlbedo, vPositionW);
        #endif
      `,
      // The floor is a metallic-roughness material; this hook sits in that branch.
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: `
        #ifdef GROUND_PATCH
          metallicRoughness.g = mix(metallicRoughness.g, 0.04, patchGloss);
        #endif
      `,
    };
  }
}

/**
 * Lay `tilesetId`'s patches over the shared ground, or lift them (`null`, or a
 * biome with no entry in PATCHES). The plugin stays attached once made; the
 * GROUND_PATCH define is the switch, the same pattern as the contact band.
 */
export function setGroundPatch(scene: Scene, tilesetId: string | null, dir: (tilesetId: string) => string): void {
  const s: PatchState = states.get(scene) ?? { tex: null, spec: null };
  states.set(scene, s);
  const spec = tilesetId ? PATCHES[tilesetId] ?? null : null;
  const url = spec && tilesetId ? `${dir(tilesetId)}/${spec.file}` : null;
  if (s.tex && s.tex.url !== url) {
    s.tex.dispose();
    s.tex = null;
  }
  s.spec = spec;
  if (url && !s.tex) {
    try {
      s.tex = new Texture(url, scene);
    } catch {
      s.tex = null; // headless: no texture, no patches
    }
  }
  const ground = scene.getMaterialByName("groundMat");
  if (!ground) return;
  const plugin = ground.pluginManager?.getPlugin<GroundPatchPlugin>(PATCH_PLUGIN) ?? new GroundPatchPlugin(ground);
  plugin.markAllDefinesAsDirty();
  // DEV: `__patch({ cover: 0.6, wet: 0.8 })` retunes the open map's patches live.
  if (import.meta.env?.DEV && typeof window !== "undefined") {
    (window as unknown as { __patch?: unknown }).__patch = (over: Partial<PatchSpec>) => {
      if (s.spec) s.spec = { ...s.spec, ...over };
      scene.resetCachedMaterial();
      return s.spec;
    };
  }
}
