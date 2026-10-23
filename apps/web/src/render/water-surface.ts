// The water's look, computed per pixel from two numbers the mesh carries: how
// far out from the waterline a point is, and how far along the shore. Nothing
// here renders the scene a second time: no reflection or refraction target,
// because from a 45 degree camera flat water reflects about two percent of the
// sky, and past the rim there is no sky. What reads as water from up here is
// what the shallows do: sand seen through a colour that deepens, light webbing
// the bottom, and waves that run up the beach, break white and drain back.
import type { AbstractMesh, BaseTexture, Material } from "@babylonjs/core";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { WAKE_CELL, WAKE_CELLS, WAKE_HEIGHT_RANGE, WAKE_SLOPE_RANGE } from "./wake";

export const WATER_PLUGIN = "ExiledWaterSurface";

/** Vertex buffer kind: [metres out from the waterline (negative inland),
 *  metres along the shore]. A pool has no shore axis and writes 0 there. */
export const WATER_DATA_KIND = "waterData";

/** What bodies wading through it have done to the water (`wake.ts`). */
export interface WaterWake {
  texture: BaseTexture;
  originX: number;
  originZ: number;
}

/** How hard the wake tilts the surface, and how white its foam goes. */
const WAKE_TILT = 2.4;
const WAKE_FOAM = 0.9;
/** Caustic gain per unit of the wake's curvature (1/m): how much a crest
 *  brightens the pattern already there, and the light it adds on bare sand. */
const WAKE_FOCUS_SPREAD = 0.35;
const WAKE_FOCUS_LIGHT = 1.2;
/** Glint per unit of slope tilted away from the eye. The sky colour is darker
 *  than sunlit sand, so more sky in a face would dim it: the face glints white. */
const WAKE_GLINT = 4;

/** Live-tunable look of one water. Colours are linear. */
export interface WaterParams {
  /** Colour of the water body where the bottom is lost. */
  body: [number, number, number];
  /** Extinction per metre of view path, per channel: red goes first. */
  absorb: [number, number, number];
  /** Wave period (s), swash run-up (m), crest spacing (m), foam strength. */
  swash: [number, number, number, number];
  /** Seabed slope (m depth per m out), caustics, wet-sand strength, crest tilt. */
  look: [number, number, number, number];
  /** Sky colour the surface reflects (display space), and reflection gain. */
  sky: [number, number, number, number];
  /** Second ripple layer off the same normal map: metres per repeat, scroll
   *  (repeats per second, u and v), strength. Crosses the material's own layer. */
  ripple: [number, number, number, number];
}

export const COAST_WATER: WaterParams = {
  body: [0.018, 0.05, 0.045],
  absorb: [1.9, 0.75, 0.62],
  swash: [7.5, 1.5, 5.5, 1],
  look: [0.2, 0.55, 0.6, 0.5],
  sky: [0.34, 0.38, 0.4, 1.8],
  ripple: [3.4, -0.021, 0.017, 0.8],
};

export const FEN_WATER: WaterParams = {
  body: [0.012, 0.015, 0.009],
  absorb: [4.5, 3.6, 4.8],
  swash: [0, 0, 0, 0],
  look: [0.6, 0, 0, 0],
  // A pool lies in shade with nothing bright to reflect; without a strong sheen
  // it renders as a black hole in the ground.
  sky: [0.13, 0.15, 0.145, 22],
  // None: a fen has no normal map to ripple (sea.ts), so any chop reads as sea.
  ripple: [3.4, 0, 0, 0],
};

const GLSL_DEFS = `
  #ifdef WATER_SURFACE
    varying vec2 vWater;
    float wFoam = 0.0;
    float wCaust = 0.0;
    float wRefl = 0.0;
    float wGlint = 0.0;
    float wDry = 0.0;
    #ifdef WATER_WAKE
      uniform sampler2D waterWakeSampler;
    #endif
    float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 wHash2(vec2 p) {
      return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
    }
    float wNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 s = f * f * (3.0 - 2.0 * f);
      return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), s.x),
                 mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), s.x), s.y);
    }
    float wFbm(vec2 p) {
      return wNoise(p) * 0.5 + wNoise(p * 2.03 + 17.1) * 0.3 + wNoise(p * 4.07 - 9.3) * 0.2;
    }
    // Distance between the nearest and second-nearest of a set of drifting
    // points: zero along the cell borders, which is where caustics gather.
    float wCells(vec2 p, float t) {
      vec2 i = floor(p), f = fract(p);
      float d1 = 8.0, d2 = 8.0;
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = wHash2(i + g);
          o = 0.5 + 0.4 * sin(t * (0.5 + 0.5 * o) + 6.2831 * o);
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
      return sqrt(d2) - sqrt(d1);
    }
    float wCaustic(vec2 p, float t) {
      float a = 1.0 - smoothstep(0.0, 0.14, wCells(p, t));
      float b = 1.0 - smoothstep(0.0, 0.14, wCells(p * 1.41 + vec2(3.1, 7.7), t * 1.23));
      return a * a * a * 0.6 + b * b * b * 0.4;
    }
  #endif
`;

const GLSL_SHADE = `
  #ifdef WATER_SURFACE
  {
    float d = vWater.x;
    vec2 q = vPositionW.xz;
    float t = waterTime;
    #ifdef BUMP
    {
      // Small chop crossing the material's own normal layer at another scale and
      // heading: one scrolling normal is a conveyor belt, two are a surface.
      vec3 r = texture2D(bumpSampler, q / waterRipple.x + waterRipple.yz * t).xyz * 2.0 - 1.0;
      normalW = normalize(normalW + vec3(r.x, 0.0, r.y) * waterRipple.w);
    }
    #endif
    float wakeFoam = 0.0;
    float wakeH = 0.0;
    float wakeFocus = 0.0;
    float wakeBand = 0.0;
    #ifdef WATER_WAKE
    {
      vec2 wuv = (q - waterWake.xy) * waterWake.z;
      // The window's own edge fades out; past it the field is not there at all.
      vec2 rim = smoothstep(0.0, 0.06, wuv) * smoothstep(1.0, 0.94, wuv);
      float inside = rim.x * rim.y;
      if (inside > 0.0) {
        const float SR = 2.0 * ${WAKE_SLOPE_RANGE.toFixed(3)};
        vec4 w = texture2D(waterWakeSampler, wuv);
        vec2 slope = (w.gb - 0.5) * SR;
        normalW = normalize(normalW - vec3(slope.x, 0.0, slope.y) * waterWake.w * inside);
        // How fast the slope turns, one cell on: under a crest the surface is a
        // converging lens, and the sand below it lights up in moving rings.
        float g = ${(1 / WAKE_CELLS).toFixed(6)};
        float sx = texture2D(waterWakeSampler, wuv + vec2(g, 0.0)).g;
        float sz = texture2D(waterWakeSampler, wuv + vec2(0.0, g)).b;
        wakeFocus = -((sx - w.g) + (sz - w.b)) * SR / ${WAKE_CELL.toFixed(4)} * inside;
        wakeH = (w.r - 0.5) * ${(2 * WAKE_HEIGHT_RANGE).toFixed(3)} * inside;
        // Faces tilted away from the eye mirror the sky, faces tilted toward it
        // show the water: the light and dark bands that make a ripple a ripple.
        vec2 eye = vEyePosition.xz - vPositionW.xz;
        wakeBand = dot(slope, eye / max(length(eye), 1e-3)) * inside;
        // Torn into lace, so churned water reads as bubbles and gaps, never a
        // smear: solid where fresh, then only the lace's ridges as it thins.
        float lace = wFbm(q * 9.0 + vec2(t * 0.3, -t * 0.2));
        wakeFoam = smoothstep(0.0, 0.2, w.a - (1.0 - lace) * 0.65) * ${WAKE_FOAM.toFixed(2)} * inside;
      }
    }
    #endif
    // Water covers every point seaward of edge; for a still pool that is its bank.
    float edge = 0.0;
    // How far past the edge the water takes to fade in: a ragged surf can be
    // sharp, a bank drawn off half-metre cells cannot.
    float soft = 0.08;
    float H = max(d, 0.0) * waterLook.x;
    float foam = 0.0;
    float wet = 0.0;
    #ifdef WATER_SURF
    {
      const float BREAK = 0.6;
      const float UP = 0.34;
      float along = vWater.y;
      float L = waterSwash.z;
      // Waves do not arrive along the whole beach at once.
      float cyc = t / waterSwash.x + wNoise(vec2(along * 0.035, 1.7)) * 1.6 + wNoise(vec2(along * 0.13, 5.3)) * 0.3;
      float k = fract(cyc);
      float id = floor(cyc);
      // The stretch of shore next door may already be on the next wave, so
      // whatever differs between waves must agree at k = 1 and the next k = 0,
      // or the foam is cut along a straight line where the two meet.
      float hand = smoothstep(0.85, 1.0, k);
      // Each wave runs up a different distance; both ends of the cycle sit at
      // the break line, so the per-wave change never shows as a jump.
      float run = waterSwash.y * (0.55 + 0.9 * wNoise(vec2(along * 0.09, id * 1.37)));
      float s = k < UP ? 1.0 - (1.0 - k / UP) * (1.0 - k / UP) : pow((k - UP) / (1.0 - UP), 1.7);
      edge = k < UP ? mix(BREAK, -run, s) : mix(-run, BREAK, s);
      // A ragged front, wandering as it runs: never a ruled line. Each wave's
      // shape hands over into the next one's, so the two agree where they meet.
      float rag = mix(wNoise(vec2(along * 0.9, id * 3.1)), wNoise(vec2(along * 0.9, (id + 1.0) * 3.1)), hand);
      edge += (rag - 0.5) * 0.3 + (wFbm(vec2(along * 2.3, t * 0.4)) - 0.5) * 0.35;
      float off = d - edge;
      // Swells marching in, steepening toward the break line, then breaking.
      float x = fract(cyc + (d - BREAK) / L);
      float shoal = smoothstep(BREAK + L * 3.5, BREAK, d) * step(BREAK - 0.3, d);
      float face = smoothstep(0.86, 0.985, x) * (1.0 - smoothstep(0.985, 1.0, x));
      float back = exp(-x * 5.0);
      vec3 land = vec3(waterShore.x, 0.0, waterShore.y);
      normalW = normalize(normalW + land * (face * 0.9 - back * 0.25) * shoal * waterLook.w);
      // The noise is the expensive part, and open water past the break has none.
      if (off < 3.0 || d < BREAK + 2.2) {
        float lace = wFbm(q * 1.7 + vec2(t * 0.05, -t * 0.08));
        float fine = wFbm(q * 4.3 - vec2(t * 0.11, t * 0.07));
        float churn = smoothstep(0.35, 0.7, lace * 0.6 + fine * 0.4);
        // The bore: white at the leading edge while the wave climbs, thinning to
        // a drained lace as it falls back.
        float vigour = (k < UP ? smoothstep(0.0, 0.06, k) : exp(-(k - UP) * 4.0)) * (1.0 - hand);
        float bore = exp(-(off - 0.08) * (off - 0.08) / 0.05);
        float trail = off > 0.0 ? exp(-off / 1.3) : 0.0;
        // Torn by the churn, so the bore breaks into clots and gaps along its length.
        float tear = smoothstep(0.25, 0.6, wFbm(vec2(along * 1.4, t * 0.3) + q * 0.8));
        foam = (bore * (0.2 + 0.9 * churn) * (0.35 + 0.65 * tear) + trail * churn * 0.7) * vigour;
        foam += step(UP, k) * (1.0 - hand) * trail * smoothstep(0.55, 0.75, fine) * 0.45;
        float cap = smoothstep(0.93, 1.0, x) * smoothstep(BREAK + 2.2, BREAK + 0.2, d) * step(BREAK - 0.3, d);
        foam += cap * (0.35 + 0.8 * churn);
      }
      foam *= waterSwash.w;
      // Sand the last wash left dark, drying again behind the draining edge.
      wet = off < 0.0 ? exp(off / 0.8) : 0.0;
      wet = max(wet, smoothstep(-waterSwash.y * 1.35, 0.0, d) * 0.55);
      wet *= smoothstep(-2.35, -2.0, d);
      // The uprush is a sheet of water over the sand, a few centimetres deep.
      H += off > 0.0 && d < BREAK ? 0.05 * smoothstep(0.0, 0.8, off) : 0.0;
    }
    #else
    {
      // Still water. A bank corner shared with land reads half a metre inside the bank.
      edge = -0.5;
      soft = 0.7;
      H = max(d + 0.5, 0.0) * waterLook.x;
    }
    #endif
    foam += wakeFoam;
    // A trough leaves less water over the sand, a crest more.
    H = max(H + wakeH, 0.0);
    // Beer-Lambert over the view path (down and back up, at about 45 degrees).
    vec3 T = exp(-waterAbsorb * H * 2.4);
    float a = 1.0 - dot(T, vec3(0.3, 0.45, 0.25));
    float inWater = smoothstep(edge - 0.03, edge + soft, d);
    vec3 body = waterBody;
    #ifdef WATER_SURF
    // The surf stirs sand into the water nearest the beach.
    body = mix(body, vec3(0.12, 0.09, 0.05), exp(-max(d, 0.0) / 3.0) * 0.5);
    #endif
    float wA = a * inWater;
    float sA = wet * waterLook.z;
    float A = max(wA, sA);
    vec3 col = mix(vec3(0.09, 0.068, 0.042), body, clamp(wA / max(A, 0.001), 0.0, 1.0));
    wDry = 1.0 - inWater;
    wFoam = clamp(foam, 0.0, 1.0) * smoothstep(edge - 0.2, edge, d);
    col = mix(col, vec3(0.72, 0.75, 0.73), wFoam);
    A = max(A, wFoam);
    // Light webbing the bottom, strongest where the water is a hand deep.
    wCaust = waterLook.y * inWater * smoothstep(0.0, 0.06, H) * (1.0 - smoothstep(0.35, 1.3, H)) * (1.0 - wFoam);
    if (wCaust > 0.001) wCaust *= wCaustic(q * 0.9 + normalW.xz * 0.4, t * 0.8);
    // A wake's crests focus and its troughs spread the light on the sand.
    float shallow = inWater * smoothstep(0.0, 0.04, H) * (1.0 - smoothstep(0.5, 1.5, H)) * (1.0 - wFoam);
    wCaust = wCaust * max(0.0, 1.0 + wakeFocus * ${WAKE_FOCUS_SPREAD.toFixed(2)}) + max(0.0, wakeFocus) * ${WAKE_FOCUS_LIGHT.toFixed(2)} * shallow;
    // Sky in the ripples. Fresnel at this camera is a few percent, which is
    // exactly what lets the moving normals show: the gain exaggerates it.
    vec3 V = normalize(vEyePosition.xyz - vPositionW);
    float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(normalW, V), 0.0, 1.0), 5.0);
    wRefl = clamp(F * waterSky.w, 0.0, 1.0) * inWater * (1.0 - wFoam);
    wGlint = clamp(wakeBand * ${WAKE_GLINT.toFixed(2)}, 0.0, 1.0) * inWater * (1.0 - wFoam);
    surfaceAlbedo = col;
    alpha = A;
  }
  #endif
`;

class WaterSurfacePlugin extends MaterialPluginBase {
  params: WaterParams;
  surf: boolean;
  /** Unit xz direction from the sea toward land; zero for a pool. */
  shore: [number, number] = [0, 0];
  /** Set while the water has a wake field; the define follows it. */
  wake: WaterWake | null = null;

  constructor(material: Material, surf: boolean, params: WaterParams) {
    // Before the fen's own plugin (220): weed floats on this water, not under it.
    super(material, WATER_PLUGIN, 210, { WATER_SURFACE: false, WATER_SURF: false, WATER_WAKE: false });
    this.surf = surf;
    this.params = { ...params };
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName(): string {
    return WATER_PLUGIN;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines["WATER_SURFACE"] = true;
    defines["WATER_SURF"] = this.surf;
    defines["WATER_WAKE"] = this.wake !== null;
  }

  override isReadyForSubMesh(): boolean {
    return this.wake?.texture.isReady() ?? true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("waterWakeSampler");
  }

  override getActiveTextures(active: BaseTexture[]): void {
    if (this.wake) active.push(this.wake.texture);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.wake?.texture;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push(WATER_DATA_KIND);
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "waterTime", size: 1, type: "float" },
        { name: "waterShore", size: 2, type: "vec2" },
        { name: "waterBody", size: 3, type: "vec3" },
        { name: "waterAbsorb", size: 3, type: "vec3" },
        { name: "waterSwash", size: 4, type: "vec4" },
        { name: "waterLook", size: 4, type: "vec4" },
        { name: "waterSky", size: 4, type: "vec4" },
        { name: "waterRipple", size: 4, type: "vec4" },
        { name: "waterWake", size: 4, type: "vec4" },
      ],
      fragment: `uniform float waterTime;
        uniform vec2 waterShore;
        uniform vec3 waterBody;
        uniform vec3 waterAbsorb;
        uniform vec4 waterSwash;
        uniform vec4 waterLook;
        uniform vec4 waterSky;
        uniform vec4 waterRipple;
        uniform vec4 waterWake;`,
    };
  }

  // bindForSubMesh, not hardBind: it runs on every draw, and the waves move.
  override bindForSubMesh(ubo: UniformBuffer): void {
    const p = this.params;
    // Wrapped so float32 keeps sub-frame precision; the wrap is an hourly jump.
    ubo.updateFloat("waterTime", (performance.now() / 1000) % 3600);
    ubo.updateFloat2("waterShore", this.shore[0], this.shore[1]);
    ubo.updateFloat3("waterBody", p.body[0], p.body[1], p.body[2]);
    ubo.updateFloat3("waterAbsorb", p.absorb[0], p.absorb[1], p.absorb[2]);
    ubo.updateFloat4("waterSwash", p.swash[0], p.swash[1], p.swash[2], p.swash[3]);
    ubo.updateFloat4("waterLook", p.look[0], p.look[1], p.look[2], p.look[3]);
    ubo.updateFloat4("waterSky", p.sky[0], p.sky[1], p.sky[2], p.sky[3]);
    ubo.updateFloat4("waterRipple", p.ripple[0], p.ripple[1], p.ripple[2], p.ripple[3]);
    const w = this.wake;
    if (w) {
      ubo.updateFloat4("waterWake", w.originX, w.originZ, 1 / (WAKE_CELLS * WAKE_CELL), WAKE_TILT);
      ubo.setTexture("waterWakeSampler", w.texture);
    }
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
          #ifdef WATER_SURFACE
            attribute vec2 ${WATER_DATA_KIND};
            varying vec2 vWater;
          #endif
        `,
        CUSTOM_VERTEX_MAIN_END: `
          #ifdef WATER_SURFACE
            vWater = ${WATER_DATA_KIND};
          #endif
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFS,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: GLSL_SHADE,
      // Foam is matte; the open water keeps the material's gloss.
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: `
        #ifdef WATER_SURFACE
          // Damp sand has a sheen, not the open water's glitter.
          metallicRoughness.g = mix(mix(metallicRoughness.g, 0.5, wDry), 0.9, wFoam);
        #endif
      `,
      // Added after the blend weight is known: the blend multiplies this pixel by
      // its alpha, so light meant for the sand underneath is divided back out.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        #ifdef WATER_SURFACE
          finalColor.rgb += vec3(0.5, 0.52, 0.42) * wCaust * (1.0 - finalColor.a) / max(finalColor.a, 0.25);
          // Reflection over everything below it, the sand included: widen the
          // blend weight so the sand is dimmed by the same share the sky takes.
          // A wake's crest faces glint on top of the sky's sheen.
          float wR = clamp(wRefl + wGlint, 0.0, 1.0);
          vec3 rc = (waterSky.rgb * wRefl + vec3(0.95, 0.97, 0.95) * wGlint) / max(wRefl + wGlint, 0.001);
          float aR = finalColor.a + wR - finalColor.a * wR;
          finalColor.rgb = (finalColor.rgb * finalColor.a * (1.0 - wR) + rc * wR) / max(aR, 0.001);
          finalColor.a = aR;
        #endif
      `,
    };
  }
}

/** Attach once; the material is cached across area builds. */
export function dressWater(material: Material, surf: boolean, params: WaterParams): WaterSurfacePlugin {
  const existing = material.pluginManager?.getPlugin(WATER_PLUGIN) as WaterSurfacePlugin | null | undefined;
  return existing ?? new WaterSurfacePlugin(material, surf, params);
}

export function waterPlugin(material: Material | null | undefined): WaterSurfacePlugin | null {
  return (material?.pluginManager?.getPlugin(WATER_PLUGIN) as WaterSurfacePlugin | null | undefined) ?? null;
}

/** Whether this water mesh breaks into surf, for tests. */
export function waterSurf(mesh: AbstractMesh): boolean {
  return waterPlugin(mesh.material)?.surf ?? false;
}
