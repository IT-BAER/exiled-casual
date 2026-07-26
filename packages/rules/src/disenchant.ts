// Turning an item back into currency (docs/02 §2). PoE2's disenchant table is one
// of the few economy numbers that is public and exact, which is why this exists and
// a gold price does not: §5 says vendor price formulas were never published.
import type { Item } from "@exiled/content-schema";
import { CURRENCY_IDS } from "./currency.js";

/** Ten matching shards form their orb (docs/02 §2). */
export const SHARDS_PER_ORB = 10;

export interface DisenchantYield {
  /** The orb these shards accumulate towards. */
  orbBaseId: string;
  shards: number;
}

/**
 * What one item is worth at the disenchanter, or null if it cannot be sold.
 *
 * PoE2 pays a Transmutation Shard for magic, a Regal Shard for rare (two once the
 * item carries six affixes) and a Chance Shard for unique. Regal is PoE's coinage,
 * so it is the Orb of Elevation here, and there is no Chance orb in this game at
 * all: a unique pays towards Embers instead, the rarest thing the table can name.
 */
export function disenchantYield(item: Item): DisenchantYield | null {
  // Currency is the payout, not the goods.
  if (CURRENCY_IDS.includes(item.baseId)) return null;
  // Unread items are refused so nothing is thrown away sight unseen: docs/09 rule 1
  // spends the anticipation on the reveal, and selling before it would skip the beat.
  if (item.unidentified === true) return null;

  switch (item.rarity) {
    case "magic":
      return { orbBaseId: "currency.transmutation", shards: 1 };
    case "rare":
      return { orbBaseId: "currency.elevation", shards: item.affixes.length >= 6 ? 2 : 1 };
    case "unique":
      return { orbBaseId: "currency.embers", shards: 1 };
    default:
      // Normal items carry nothing to break down.
      return null;
  }
}
