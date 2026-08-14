/**
 * Every item base that can be worn, and the slot it goes in.
 *
 * The viewer's gear panel used to offer raw wardrobe looks, which is the
 * geometry vocabulary and not the game's: a look says "the plate coat", a base
 * says "Ironsworn Plate", and only the base carries the palette its inventory
 * icon was painted with. Judging armour art means seeing what a drop actually
 * looks like, so the list is item bases and equipping one goes down the same
 * `looksForEquipment` path the player's equipment does.
 *
 * Derived from the content pools and the equip rules, never typed out here, so a
 * base added to the game is wearable in the viewer the same day.
 */
import { ITEM_POOLS, STARTER_BASE_IDS, baseOf } from "@exiled/content-runtime";
import { EQUIP_SLOTS_BY_CLASS } from "@exiled/simulation";
import { looksForEquipment, meshLook, type CosmeticSlot } from "../render/rig";

export interface WearableBase {
  id: string;
  name: string;
  slot: CosmeticSlot;
}

/**
 * Wearable bases, in slot order.
 *
 * Starter bodies are appended because they are deliberately out of the drop
 * pool (`STARTER_BASES` in content-runtime) — and they are three of the four
 * body armours in the game, so a list built from the pool alone would be missing
 * exactly the pieces this screen exists to judge.
 */
export const WEARABLE_BASES: readonly WearableBase[] = [
  ...ITEM_POOLS.bases.map((b) => b.id),
  ...STARTER_BASE_IDS,
]
  .map((id) => {
    const base = baseOf(id);
    // The first legal slot: no class maps to two, and one that did would be a
    // rule this screen has no business inventing an answer for.
    const slot = EQUIP_SLOTS_BY_CLASS[base.itemClass]?.[0];
    return slot === undefined ? null : { id, name: base.name, slot: slot as CosmeticSlot };
  })
  .filter((b): b is WearableBase => b !== null);

/** The bases that go in one slot, for that slot's row in the panel. */
export function basesForSlot(slot: CosmeticSlot): WearableBase[] {
  return WEARABLE_BASES.filter((b) => b.slot === slot);
}

/**
 * Looks in this slot that no item base can put on the character.
 *
 * The panel lists bases, because a base is what a player can actually hold and
 * it carries the palette its icon was painted with. Listing the raw geometry
 * beside it mostly repeats that list under a second name — Ironsworn Plate IS
 * the `plate` look — and the repetition is worse than useless, because the two
 * entries render differently and nothing says which is the real item. What is
 * left over is what this returns: `commoner`, the unequipped clothing, and any
 * look built before a base points at it, neither of which is reachable any
 * other way.
 */
export function orphanLooks(slot: CosmeticSlot, looks: readonly string[]): string[] {
  const reachable = new Set(
    basesForSlot(slot).map((b) => {
      const look = looksForEquipment({ [slot]: { baseId: b.id } })[slot];
      return look === null ? "" : meshLook(look);
    }),
  );
  return looks.filter((l) => !reachable.has(l));
}
