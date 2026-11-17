import type { Material } from "@babylonjs/core";

/** How many bowls may be lit at once. Babylon's default per-material cap. */
export const LIGHT_POOL = 4;

/** Every light that can stand in a room at once: the fill, the sun, the torch,
 *  the hit flash and the solar orb's light (skill-fx.ts) and the whole brazier pool. Materials are capped to
 *  exactly this, see `createScene` — Babylon's own default of four drops the rest without a word. */
const SCENE_LIGHTS = 5 + LIGHT_POOL;

/**
 * The light cap on every material of a scene or a held-out container, also run by hand before
 * a readiness check that comes ahead of the next frame: a material readied at Babylon's four and
 * raised later lists its lights in another order, a second compile of the same shader.
 */
export function capMaterialLights(owner: { materials: Material[] }): void {
  for (const m of owner.materials) {
    if ("maxSimultaneousLights" in m) {
      (m as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = SCENE_LIGHTS;
    }
  }
}
