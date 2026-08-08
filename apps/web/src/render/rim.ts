/**
 * A lit edge on every creature.
 *
 * Measured against the reference frame (`reference-screenshots/inside-map-battle.webp`)
 * the roster had two value problems, not one. The first was the hide itself,
 * which is fixed where it is authored — `build_monsters.py` now tints each sheet
 * to a fraction of the floor its biome ships, so a monster is darker than the
 * ground it stands on instead of brighter than it.
 *
 * That alone trades one failure for another: a dark shape on a dark floor has no
 * outline either. What separates the two in the reference is that the monsters
 * carry a bright edge where the surface turns away from the camera, and the
 * ground does not. The sun cannot do it — it comes from one direction, so it
 * lights one side and leaves the silhouette open on the other three.
 *
 * So this is a Fresnel term added after tone mapping: brightest exactly where
 * the surface is edge-on to the viewer, which at a camera thirty-seven degrees
 * off vertical is the whole outline. It is a cheat, it is the same cheat every
 * ARPG uses, and it is the difference between a shape and a smudge at the
 * seventy pixels a trash monster actually occupies.
 *
 * Added as a plugin rather than a replacement material for the reason `dissolve.ts`
 * gives: the creature has to keep its PBR lighting, its hide texture and its
 * baked occlusion, all of which a bespoke `ShaderMaterial` would drop.
 */
import type { Material } from "@babylonjs/core/Materials/material";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { Color3 } from "@babylonjs/core/Maths/math";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";

/**
 * Daylight off the sky, not a second sun: cool, so it reads as the edge of the
 * creature catching what is left of the light rather than as another lamp in
 * the room. Warm would collide with the torch the player carries, and the two
 * together make every monster look like it is on fire.
 */
export const RIM_COLOR = new Color3(0.52, 0.60, 0.74);
/** How much of it. Judged in the app, at the distance the camera actually sits. */
export const RIM_INTENSITY = 0.34;
/**
 * How tightly the term hugs the outline. Low values wash the whole creature and
 * undo the darkening the hide tint just bought; this keeps it inside a few
 * degrees of edge-on.
 */
export const RIM_POWER = 3.4;

const NAME = "ExiledRim";

/**
 * The hit flash lives here too, not in Babylon's `renderOverlay`: that extra
 * overlay pass mis-renders on skinned PBR materials carrying this plugin (a
 * data texture drawn as colour — green hatch rows on every hit tick). The
 * material stays shared per species, so the flash value rides the struck
 * MESH's metadata and is read per submesh at bind time.
 *
 * Deliberately small (docs/09 rule 3: intensity beats density). A hit lands
 * several times a second all fight; anything that reads as a flash from across
 * the room becomes a strobe by the second pack.
 */
export const HIT_TINT = new Color3(1, 0.93, 0.86);
export const HIT_ALPHA = 0.3;

class RimPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // After lighting and tone mapping, like the dissolve edge: this is its own
    // light, not a surface the braziers get a vote on.
    super(material, NAME, 300, {}, true, true);
    // `rig.ts` clones PBR materials, and a cloned material serialises its
    // plugins and revives them through a global that does not exist in an
    // ES-module build. Same trap, same fix.
    this.doNotSerialize = true;
  }

  override getClassName(): string {
    return NAME;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "rimIntensity", size: 1, type: "float" },
        { name: "rimPower", size: 1, type: "float" },
        { name: "rimColor", size: 3, type: "vec3" },
        { name: "hitFlash", size: 1, type: "float" },
      ],
      fragment: `
        uniform float rimIntensity;
        uniform float rimPower;
        uniform vec3 rimColor;
        uniform float hitFlash;
      `,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    uniformBuffer.updateFloat("rimIntensity", RIM_INTENSITY);
    uniformBuffer.updateFloat("rimPower", RIM_POWER);
    uniformBuffer.updateColor3("rimColor", RIM_COLOR);
    const flash = (subMesh.getMesh().metadata as { hitFlash?: number } | null)?.hitFlash ?? 0;
    uniformBuffer.updateFloat("hitFlash", flash);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      // `normalW` only exists when the mesh carries normals, and a material with
      // this plugin on a mesh without them would fail to COMPILE rather than
      // fail to shade — which takes every creature sharing that material with it.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        #ifdef NORMAL
          float rimFacing = 1.0 - clamp(dot(normalize(normalW), viewDirectionW), 0.0, 1.0);
          finalColor.rgb += rimColor * pow(rimFacing, rimPower) * rimIntensity;
        #endif
        finalColor.rgb = mix(finalColor.rgb, vec3(${HIT_TINT.r.toFixed(3)}, ${HIT_TINT.g.toFixed(3)}, ${HIT_TINT.b.toFixed(3)}), hitFlash * ${HIT_ALPHA.toFixed(3)});
      `,
    };
  }
}

/**
 * Give one material a lit edge. Idempotent: the creature container is walked
 * once per load, but a scene that reloads would otherwise stack the term.
 */
export function addRim(material: Material): void {
  if (material.pluginManager?.getPlugin(NAME)) return;
  new RimPlugin(material);
}

/** Whether a material already carries the plugin — the flash rides it if so. */
export function hasRim(material: Material | null): boolean {
  return !!material?.pluginManager?.getPlugin(NAME);
}
