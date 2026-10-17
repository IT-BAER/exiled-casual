// Where rock meets the floor, on the floor's side: a contact shadow and a fall of
// the rock's own dust, broken by noise so the line wanders. The cliff paints the
// floor plate up its scree (cliffs.ts) and shades it with the same function, so
// ground and scree agree at the foot and no crease runs along it.
import { Constants, RawTexture, type Material, type Scene } from "@babylonjs/core";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { WalkableGrid } from "@exiled/mapgen";

/** How far the band reaches onto the floor from the rock's edge, in world units. */
const CONTACT_REACH = 1.5;
/** Darkening right at the rock, and how far toward rock dust the floor turns.
 *  A coast is lit by open daylight off sand, so its band is lighter. */
const DARK = 0.45;
const DUST = 0.55;
const COAST_DARK = 0.25;
const COAST_DUST = 0.3;
/** World units per repeat of the wall plate: the walls' own TILE (level.ts). */
const ROCK_TILE = 2;

export const CONTACT_PLUGIN = "ExiledContact";
const f3 = (v: number) => v.toFixed(3);

/**
 * Per cell, how close the nearest rock is, 0..255: 255 under rock, falling off
 * with the square of the distance to 0 at CONTACT_REACH. Sea is not rock, so sand
 * at the waterline stays clean, and a sea cell is 0.
 */
export function contactField(grid: WalkableGrid): Uint8Array<ArrayBuffer> {
  const { cols, rows, cellSize, cells, water } = grid;
  const out = new Uint8Array(cols * rows);
  const sea = (i: number): boolean => water !== undefined && water[i] === 1;
  const R = Math.ceil(CONTACT_REACH / cellSize);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (sea(i)) continue;
    if (cells[i] !== 1) { out[i] = 255; continue; }
    let best = Infinity;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (cells[j] === 1 || sea(j)) continue;
      // From this cell's centre to the edge of that rock cell's box.
      const gap = Math.hypot(Math.max(0, Math.abs(dx) - 0.5), Math.max(0, Math.abs(dy) - 0.5)) * cellSize;
      if (gap < best) best = gap;
    }
    const v = Math.max(0, 1 - best / CONTACT_REACH);
    out[i] = Math.round(v * v * 255);
  }
  return out;
}

/** The band of the area on screen, read by every material that draws floor. */
interface ContactState {
  field: RawTexture | null;
  rock: Texture | null;
  rockTint: [number, number, number];
  /** World xz -> field uv: scale x, scale z, offset u, offset v. */
  uv: [number, number, number, number];
  dark: number;
  dust: number;
}
const states = new WeakMap<Scene, ContactState>();

function state(scene: Scene): ContactState | undefined {
  return states.get(scene);
}

/** Uniforms and samplers a plugin that shades floor with `contactShade` declares. */
export const CONTACT_UBO = [
  { name: "contactUV", size: 4, type: "vec4" },
  { name: "contactK", size: 3, type: "vec3" },
  { name: "contactRock", size: 3, type: "vec3" },
];
export const CONTACT_UNIFORMS_GLSL = `
  uniform vec4 contactUV;
  uniform vec3 contactK;
  uniform vec3 contactRock;
`;
export const CONTACT_SAMPLERS = ["contactSampler", "contactRockSampler"];

/** `contactShade(albedo, posW)`: linear albedo in, the same with the band on it.
 *  The dust takes the rock plate's grain and hue at the floor's own brightness,
 *  so darkening is the shadow's job alone. */
export const CONTACT_GLSL = `
  #ifdef CONTACT_BAND
    uniform sampler2D contactSampler;
    uniform sampler2D contactRockSampler;
    float contactHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float contactNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 s = f * f * (3.0 - 2.0 * f);
      return mix(mix(contactHash(i), contactHash(i + vec2(1.0, 0.0)), s.x),
                 mix(contactHash(i + vec2(0.0, 1.0)), contactHash(i + vec2(1.0, 1.0)), s.x), s.y);
    }
    vec3 contactShade(vec3 albedo, vec3 posW) {
      float p = texture2D(contactSampler, posW.xz * contactUV.xy + contactUV.zw).r;
      float n = contactNoise(posW.xz * 1.3) * 0.65 + contactNoise(posW.xz * 3.7) * 0.35;
      float dust = smoothstep(0.1, 0.8, p + (n - 0.5) * 0.7);
      vec3 rock = toLinearSpace(texture2D(contactRockSampler, posW.xz * ${f3(1 / ROCK_TILE)}).rgb) * contactRock;
      const vec3 lum = vec3(0.2126, 0.7152, 0.0722);
      rock *= dot(albedo, lum) / max(dot(rock, lum), 1e-3);
      albedo = mix(albedo, rock, dust * contactK.y);
      return albedo * (1.0 - contactK.x * p * (0.75 + 0.5 * n));
    }
  #endif
`;

/** Whether a band lies under `scene`'s floor: a map's, never the hideout's. */
export function contactActive(scene: Scene): boolean {
  const s = state(scene);
  return !!(s?.field && s.rock);
}

export function contactDefines(defines: MaterialDefines, scene: Scene): void {
  defines["CONTACT_BAND"] = contactActive(scene);
}

export function contactReady(scene: Scene): boolean {
  const s = state(scene);
  return (s?.field?.isReady() ?? true) && (s?.rock?.isReady() ?? true);
}

export function contactTextures(scene: Scene): BaseTexture[] {
  const s = state(scene);
  return s?.field && s.rock ? [s.field, s.rock] : [];
}

export function bindContact(ubo: UniformBuffer, scene: Scene): void {
  const s = state(scene);
  if (!s?.field || !s.rock) return;
  ubo.updateFloat4("contactUV", ...s.uv);
  ubo.updateFloat3("contactK", s.dark, s.dust, 0);
  ubo.updateFloat3("contactRock", ...s.rockTint);
  ubo.setTexture("contactSampler", s.field);
  ubo.setTexture("contactRockSampler", s.rock);
}

class GroundContactPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, CONTACT_PLUGIN, 210, { CONTACT_BAND: false });
    // Babylon 9 calls hardBindForSubMesh only for plugins on the extra-events
    // list; without this the band's uniforms stay zero and the floor shows none of it.
    this.registerForExtraEvents = true;
    // Same ES-module serialisation trap as rim.ts.
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName(): string {
    return CONTACT_PLUGIN;
  }

  override prepareDefines(defines: MaterialDefines, scene: Scene): void {
    contactDefines(defines, scene);
  }

  override isReadyForSubMesh(_defines: MaterialDefines, scene: Scene): boolean {
    return contactReady(scene);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push(...CONTACT_SAMPLERS);
  }

  override getActiveTextures(active: BaseTexture[]): void {
    active.push(...contactTextures(this._material.getScene()));
  }

  override hasTexture(texture: BaseTexture): boolean {
    return contactTextures(this._material.getScene()).includes(texture);
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return { ubo: CONTACT_UBO, fragment: CONTACT_UNIFORMS_GLSL };
  }

  override hardBindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    bindContact(ubo, scene);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: CONTACT_GLSL,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef CONTACT_BAND
          surfaceAlbedo = contactShade(surfaceAlbedo, vPositionW);
        #endif
      `,
    };
  }
}

/**
 * Lay the band for `grid` under the ground and every cliff, or lift it with
 * `null` (the hideout has no rock to meet). `rock` is the wall material whose
 * plate the dust is made of.
 */
export function setContactBand(scene: Scene, grid: WalkableGrid | null, rock: PBRMaterial | null, coast = false): void {
  const s: ContactState = states.get(scene) ?? {
    field: null, rock: null, rockTint: [1, 1, 1], uv: [0, 0, 0, 0], dark: DARK, dust: DUST,
  };
  states.set(scene, s);
  s.field?.dispose();
  s.field = null;
  const ground = scene.getMaterialByName("groundMat");
  // Active for good once attached: the CONTACT_BAND define is the switch.
  const plugin = ground
    ? ground.pluginManager?.getPlugin<GroundContactPlugin>(CONTACT_PLUGIN) ?? new GroundContactPlugin(ground)
    : null;
  if (!grid || !rock) {
    plugin?.markAllDefinesAsDirty();
    return;
  }
  const { cols, rows, cellSize, originX, originY } = grid;
  s.field = RawTexture.CreateLuminanceTexture(
    contactField(grid), cols, rows, scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
  );
  s.field.wrapU = s.field.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  // Texel (x, y) is centred on cell (x, y), and cell (0, 0) on the origin.
  const w = cols * cellSize, h = rows * cellSize;
  s.uv = [1 / w, 1 / h, (cellSize / 2 - originX) / w, (cellSize / 2 - originY) / h];
  s.rock = rock.albedoTexture as Texture | null;
  const c = rock.albedoColor;
  s.rockTint = [c.r, c.g, c.b];
  s.dark = coast ? COAST_DARK : DARK;
  s.dust = coast ? COAST_DUST : DUST;
  plugin?.markAllDefinesAsDirty();
}
