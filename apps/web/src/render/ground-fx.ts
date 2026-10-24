/**
 * How a ground patch arrives and leaves.
 *
 * A patch used to pop in whole and leave by dimming while it shrank, which reads
 * as a decal being switched off. This erodes it instead, the way `dissolve.ts`
 * takes a character: noise in WORLD space against a moving threshold, with a hot
 * band just above the cut so the front glows like burning paper. The threshold
 * is biased by radius, so a patch catches from its middle outward and burns out
 * from its rim inward — the same field run backwards, so both ends match.
 */
import { Color3, MaterialPluginBase, StandardMaterial } from "@babylonjs/core";
import type { AbstractEngine, AbstractMesh, GlowLayer, Material, Scene, SubMesh, UniformBuffer } from "@babylonjs/core";
import { CINDER_RATE, type GroundEmbers } from "./skill-fx";

const TICKS_PER_SEC = 30;

/** How long a new patch takes to catch, centre to rim. */
export const IGNITE_TICKS = Math.round(0.35 * TICKS_PER_SEC);

/** How long a removed patch takes to burn out, rim to centre. */
export const GROUND_FADE_TICKS = Math.round(0.9 * TICKS_PER_SEC);

/** Kept past the burn-out until the last ember (1.1 s at most) has risen and gone. */
export const EMBER_TAIL_TICKS = Math.round(1.2 * TICKS_PER_SEC);

/** How many times the base ember rate a patch throws off the moment it catches. */
const IGNITE_FLARE = 3;

interface GroundLook {
  /** The burning front. Above 1 after `gain`, so the glow layer blooms it. */
  edge: Color3;
  gain: number;
  /** What the patch cools toward as it erodes: the colour a dying one goes. */
  cool: Color3;
}

/**
 * One entry per element a patch can be. Fire is the only one because the sim's
 * one ailment is "burning"; a new element is an entry here plus the snapshot
 * telling the client which a patch is.
 */
export const GROUND_LOOKS = {
  fire: { edge: new Color3(1.0, 0.6, 0.2), gain: 1.5, cool: new Color3(0.55, 0.2, 0.07) },
} satisfies Record<string, GroundLook>;
export type GroundElement = keyof typeof GROUND_LOOKS;

/** Share of the erosion spent sweeping across the radius rather than eating in everywhere. */
const SWEEP = 0.6;
/** Width of the glowing band behind the front, in noise units. */
const EDGE = 0.09;
/** Noise cells per world unit: a few ragged tongues across a 2.5-unit patch. */
const SCALE = 1.7;

const PLUGIN = "ExiledGroundErosion";
const f = (n: number) => n.toFixed(4);

class GroundErosionPlugin extends MaterialPluginBase {
  /** 0 is whole; 1 is gone. */
  amount = 0;
  private readonly look: GroundLook;

  constructor(material: Material, look: GroundLook) {
    super(material, PLUGIN, 400, {}, true, true);
    // Same trap as dissolve.ts: a revived plugin looks itself up on a global an
    // ES-module build does not have. Nothing here belongs in a saved material.
    this.doNotSerialize = true;
    this.look = look;
  }

  override getClassName(): string {
    return PLUGIN;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "groundErosion", size: 1, type: "float" },
        { name: "groundGain", size: 1, type: "float" },
        { name: "groundDisc", size: 3, type: "vec3" },
        { name: "groundEdgeColor", size: 3, type: "vec3" },
        { name: "groundCool", size: 3, type: "vec3" },
      ],
      fragment: `
        uniform float groundErosion;
        uniform float groundGain;
        uniform vec3 groundDisc;
        uniform vec3 groundEdgeColor;
        uniform vec3 groundCool;
      `,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    const mesh = subMesh.getMesh();
    ubo.updateFloat("groundErosion", this.amount);
    ubo.updateFloat("groundGain", this.look.gain);
    // Centre on the floor and radius: the disc is built at radius 1 and scaled.
    // Absolute, so a patch's children (scorch, fissures, rim) erode on the parent's disc.
    const at = mesh.getAbsolutePosition();
    ubo.updateFloat3("groundDisc", at.x, at.z, Math.max(mesh.absoluteScaling.x, 1e-3));
    ubo.updateColor3("groundEdgeColor", this.look.edge);
    ubo.updateColor3("groundCool", this.look.cool);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        float groundGlow;

        float exGroundHash(vec2 p) {
          p = fract(p * vec2(0.3183099, 0.3678794) + vec2(0.71, 0.113));
          p *= 17.0;
          return fract(p.x * p.y * (p.x + p.y));
        }

        float exGroundNoise(vec2 x) {
          vec2 i = floor(x);
          vec2 u = fract(x);
          u = u * u * (3.0 - 2.0 * u);
          return mix(mix(exGroundHash(i), exGroundHash(i + vec2(1.0, 0.0)), u.x),
                     mix(exGroundHash(i + vec2(0.0, 1.0)), exGroundHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        float exGroundFbm(vec2 p) {
          float sum = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 4; i++) {
            sum += amp * exGroundNoise(p);
            p = p * 2.03 + vec2(1.7, 9.2);
            amp *= 0.5;
          }
          return sum;
        }
      `,
      CUSTOM_FRAGMENT_MAIN_BEGIN: `
        groundGlow = 0.0;
        if (groundErosion > 0.0) {
          float exRim = clamp(length(vPositionW.xz - groundDisc.xy) / groundDisc.z, 0.0, 1.0);
          float exNoise = exGroundFbm(vPositionW.xz * ${f(SCALE)});
          // Below every noise value at 0 and above every one at 1; the centre is
          // cut last, so it is also the first thing back when this runs in reverse.
          float exCut = groundErosion * ${f(1 + SWEEP + 0.05)} - ${f(SWEEP)} * (1.0 - exRim) - 0.05;
          float exDepth = exNoise - exCut;
          if (exDepth < 0.0) discard;
          groundGlow = 1.0 - smoothstep(0.0, ${f(EDGE)}, exDepth);
        }
      `,
      // `color`, because the disc is a StandardMaterial: cooled first, then the
      // front added on top so it is its own light and not a tint of the cracks.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        color.rgb *= mix(vec3(1.0), groundCool, groundErosion);
        color.rgb += groundEdgeColor * groundGlow * groundGain;
      `,
    };
  }
}

/**
 * The material one patch wears: the shared template's textures and colour, its
 * own erosion. Per patch because the erosion is a uniform, and two patches on one
 * material would burn out together. Same defines, so it compiles nothing new.
 */
export function groundMaterial(scene: Scene, name: string, template: StandardMaterial, element: GroundElement = "fire"): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = template.diffuseColor;
  mat.specularColor = template.specularColor;
  mat.disableLighting = template.disableLighting;
  mat.alpha = template.alpha;
  mat.alphaMode = template.alphaMode;
  mat.transparencyMode = template.transparencyMode;
  mat.emissiveTexture = template.emissiveTexture;
  mat.opacityTexture = template.opacityTexture;
  // The same Color3, not a copy: the template's pulse (`cinderGlow`) beats every patch.
  mat.emissiveColor = template.emissiveColor;
  new GroundErosionPlugin(mat, GROUND_LOOKS[element]);
  return mat;
}

function erosionOf(mesh: AbstractMesh): GroundErosionPlugin | null {
  return (mesh.material?.pluginManager?.getPlugin(PLUGIN) as GroundErosionPlugin | null) ?? null;
}

/** How far eroded a patch is drawn, 0 whole to 1 gone. */
export function groundErosion(mesh: AbstractMesh): number {
  return erosionOf(mesh)?.amount ?? 0;
}

function embersOf(mesh: AbstractMesh): GroundEmbers | undefined {
  return (mesh.metadata as { embers?: GroundEmbers } | null)?.embers;
}

/** Erode the patch and everything dressed on it together. */
function setErosion(mesh: AbstractMesh, amount: number): void {
  for (const part of [mesh, ...mesh.getChildMeshes(true)]) {
    const plugin = erosionOf(part);
    if (plugin) plugin.amount = amount;
  }
}

/**
 * The bloom draws every emissive mesh through a shader of its own that never runs
 * the erosion, so a patch's glow would stay whole while the patch burns away. This
 * is the layer's default colour, dimmed on a patch by the share it has lost.
 */
export function glowFollowsErosion(glow: GlowLayer): void {
  glow.customEmissiveColorSelector = (mesh, _subMesh, material, result) => {
    const mat = material as (Material & { emissiveColor?: Color3; emissiveTexture?: { level: number } | null; emissiveIntensity?: number }) | null;
    if (!mat?.emissiveColor) {
      result.copyFrom(glow.neutralColor);
      return;
    }
    // Squared: a linear share left a faint whole disc in the bloom around a patch
    // that had barely caught, or had all but gone.
    const keep = 1 - groundErosion(mesh);
    const level = (mat.emissiveTexture?.level ?? 1) * (mat.emissiveIntensity ?? 1) * keep * keep;
    result.set(mat.emissiveColor.r * level, mat.emissiveColor.g * level, mat.emissiveColor.b * level, mat.alpha);
  };
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/** A patch `ticks` after it appeared: catching from the middle, embers flaring where it has caught. */
export function igniteGround(mesh: AbstractMesh, ticks: number): void {
  const k = Math.min(1, Math.max(0, ticks / IGNITE_TICKS));
  setErosion(mesh, 1 - easeOut(k));
  const embers = embersOf(mesh);
  if (!embers) return;
  embers.emitRate = CINDER_RATE * (1 + IGNITE_FLARE * (1 - k));
  embers.radius = 0.2 + 0.8 * easeOut(k);
}

/** A patch `ticks` after the sim removed it: burning out from the rim, embers thinning with it. */
export function burnOutGround(mesh: AbstractMesh, ticks: number): void {
  const k = Math.min(1, Math.max(0, ticks / GROUND_FADE_TICKS));
  setErosion(mesh, easeInOut(k));
  const embers = embersOf(mesh);
  if (!embers) return;
  // Stopped, not disposed: what is already in the air rises out its own life.
  if (k >= 1) embers.stop();
  else embers.emitRate = CINDER_RATE * (1 - k);
}
