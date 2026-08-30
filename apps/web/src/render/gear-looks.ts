/**
 * Which wardrobe look each item base is worn as.
 *
 * The wardrobe's gear slots are named for the sim's own equipment slots, so
 * dressing the character is this one lookup and never a translation table.
 *
 * A base that is not in here shows nothing. That is deliberate: rendering some
 * other piece in its place would tell the player a lie about what dropped, and
 * a drop the player cannot read is a reward that did not happen (docs/09). Most
 * bases are unmapped today - only five pieces have meshes.
 */
import { BASE_LOOKS, type Looks, type Slot } from "./rig";

export interface GearLook {
  slot: Slot;
  look: string;
}

export const GEAR_LOOKS: Readonly<Record<string, GearLook>> = {
  "base.emberwand": { slot: "weapon1", look: "emberwand" },
  "base.ember_buckler": { slot: "weapon2", look: "buckler" },
  "base.ashwall_tower_shield": { slot: "weapon2", look: "towershield" },
  "base.cinder_cap": { slot: "helmet", look: "iron" },
  "base.ironsworn_plate": { slot: "chest", look: "plate" },
  "base.ashen_treads": { slot: "boots", look: "plate" },
  "base.ember_gauntlets": { slot: "gloves", look: "plate" },
};

/** What the sim tells the client about one equipped item, as far as looks care. */
interface Equipped {
  baseId?: string;
}

export function looksForEquipment(
  equipment: Partial<Record<string, Equipped>>,
): Looks {
  const looks: Looks = { ...BASE_LOOKS };
  for (const item of Object.values(equipment)) {
    const baseId = item?.baseId;
    if (baseId === undefined) continue;
    const gear = GEAR_LOOKS[baseId];
    if (gear) looks[gear.slot] = gear.look;
  }
  return looks;
}
