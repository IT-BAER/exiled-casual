/**
 * What a class looks like on the rig.
 *
 * Its own module, and not part of `MenuStage`, so the answer can be checked
 * without a canvas. A class is shown in the kit it starts with, dressed by the
 * same lookup the game uses, so the menu never shows gear the game would not.
 */
import { characterClass } from "@exiled/content-runtime";
import { looksForEquipment } from "../render/gear-looks";
import type { Looks } from "../render/rig";

export function looksForClass(classId: string): Looks {
  const gear = characterClass(classId).startingGear;
  return looksForEquipment(Object.fromEntries(Object.entries(gear).map(([slot, baseId]) => [slot, { baseId }])));
}
