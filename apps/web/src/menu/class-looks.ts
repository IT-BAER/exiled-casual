/**
 * What a class looks like on the rig.
 *
 * Its own module, and not part of `MenuStage`, so the mapping can be checked
 * without a canvas: the thing worth pinning is that every class's starting gear
 * resolves to wardrobe geometry that exists, and that is a data question, not a
 * rendering one. `menu-scene.test.ts` is where it gets asked.
 */
import { characterClass } from "@exiled/content-runtime";
import { looksForEquipment, type Looks } from "../render/rig";

/**
 * The class's starting gear, run through the same slot-to-look table the game
 * dresses the player with. Using anything else here is how a preview and a game
 * drift apart.
 */
export function looksForClass(classId: string): Looks {
  const equipped: Record<string, { baseId: string }> = {};
  for (const [slot, baseId] of Object.entries(characterClass(classId).startingGear)) {
    equipped[slot] = { baseId };
  }
  return looksForEquipment(equipped);
}
