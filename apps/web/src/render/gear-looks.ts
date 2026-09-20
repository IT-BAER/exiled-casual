/**
 * Which wardrobe look each item base is worn as.
 *
 * The wardrobe's gear slots are named for the sim's own equipment slots, so
 * dressing the character is this one lookup and never a translation table.
 *
 * A base that is not in here shows nothing. That is deliberate: rendering some
 * other piece in its place would tell the player a lie about what dropped, and
 * a drop the player cannot read is a reward that did not happen (docs/09). The
 * belts are the only bases left unmapped - the wardrobe has no belt slot, and a
 * belt under a cuirass or a robe is not seen.
 */
import { BASE_LOOKS, type Looks, type Slot } from "./rig";

export interface GearLook {
  slot: Slot;
  look: string;
}

export const GEAR_LOOKS: Readonly<Record<string, GearLook>> = {
  // The armour slots name their family, so the look is the base id's own prefix.
  "base.ironsworn_helm": { slot: "helmet", look: "ironsworn" },
  "base.ironsworn_plate": { slot: "chest", look: "ironsworn" },
  "base.ironsworn_gauntlets": { slot: "gloves", look: "ironsworn" },
  "base.ironsworn_sabatons": { slot: "boots", look: "ironsworn" },
  "base.stalker_hood": { slot: "helmet", look: "stalker" },
  "base.stalker_leathers": { slot: "chest", look: "stalker" },
  "base.stalker_gloves": { slot: "gloves", look: "stalker" },
  "base.stalker_boots": { slot: "boots", look: "stalker" },
  // `base.ember_cowl` is deliberately absent: its mesh has not decoded yet, and
  // mapping it would hide the hair for a helmet look with no parts - a bald
  // head. An unmapped base shows nothing, which is a bare head with hair.
  "base.ember_robe": { slot: "chest", look: "ember" },
  "base.ember_wraps": { slot: "gloves", look: "ember" },
  "base.ember_slippers": { slot: "boots", look: "ember" },
  // The hands do NOT: a buckler and a tower shield are both `weapon2`, so one
  // look per family would have them fight over the slot. A held look is named
  // for the weapon it is.
  "base.ember_wand": { slot: "weapon1", look: "emberwand" },
  "base.stalker_buckler": { slot: "weapon2", look: "buckler" },
  "base.ironsworn_tower_shield": { slot: "weapon2", look: "towershield" },
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
