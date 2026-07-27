import type { EquipSlotId } from "@exiled/protocol";

export const EQUIP_SLOTS_BY_CLASS: Record<string, EquipSlotId[]> = {
  wand:   ["weapon1", "weapon2"],
  focus:  ["weapon1", "weapon2"],
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
