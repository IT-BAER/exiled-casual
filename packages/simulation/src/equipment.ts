import type { EquipSlotId } from "@exiled/protocol";

/*
 * Hands are not interchangeable. `weapon1` is the main hand and `weapon2` the
 * off hand, the way PoE numbers them, and the character renders each slot in its
 * own fist (`weapon1.*` on `hand_r`, `weapon2.*` on `hand_l`). A focus that
 * could sit in either slot therefore had a 50% chance of being held as a weapon,
 * so the classes name the hand they belong in rather than both.
 *
 * Dual wielding would put a second wand in `weapon2`; there is no off-hand
 * attack yet, so allowing it would only add a way to hold a dead wand.
 */
export const EQUIP_SLOTS_BY_CLASS: Record<string, EquipSlotId[]> = {
  wand:   ["weapon1"],
  focus:  ["weapon2"],
  shield: ["weapon2"],
  helmet: ["helmet"],
  body:   ["body"],
  gloves: ["gloves"],
  boots:  ["boots"],
  belt:   ["belt"],
};

/** True when itemClass can legally go into slot. Classes absent from the map are not equippable. */
export function canEquip(itemClass: string, slot: EquipSlotId): boolean {
  return EQUIP_SLOTS_BY_CLASS[itemClass]?.includes(slot) ?? false;
}
