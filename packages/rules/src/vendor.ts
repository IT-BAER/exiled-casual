// What a vendor charges and what it pays (docs/02 §17). Every number here is ours:
// §5 says PoE's vendor price formulas were never published, so this is a table with
// a shape we chose, not a clone. Pure leaf, integer gold, same rules as the package.
import type { Item, ItemPools, Rarity } from "@exiled/content-schema";
import { CURRENCY_IDS } from "./currency.js";
import { rollItem } from "./items.js";

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * How much of the asking price the vendor pays when buying the same item back.
 *
 * A margin is the only thing standing between the shop and an infinite gold loop,
 * so it exists for correctness before flavour; 20% is also roughly where PoE1's
 * gold-era shops sat, low enough that selling is a way to clear the backpack
 * rather than a way to farm.
 */
export const VENDOR_MARGIN_PCT = 20;

/** Base gold for a normal item at item level 0, before rarity and level. */
const BASE_GOLD = 8;

/**
 * Rarity is the dominant term, the way it is in every ARPG shop: a rare is worth
 * an order more than the white of the same base, because its affixes are the item.
 */
const RARITY_MULT: Record<Item["rarity"], number> = { normal: 1, magic: 4, rare: 14, unique: 45 };

/** Gold to buy this item out of the vendor's stock. */
export function vendorBuyPrice(item: Item): number {
  // Linear in item level rather than a curve: a level 85 base costs 5x a level 1
  // one, which keeps late shopping meaningful without pricing it out of reach.
  const decades = Math.trunc(Math.max(0, item.itemLevel) / 10);
  return BASE_GOLD * RARITY_MULT[item.rarity] * (2 + decades);
}

/**
 * Gold the vendor pays for the player's item, or 0 if it will not take it.
 *
 * Refusals mirror the disenchanter's: currency is the payment and not the goods,
 * and an unread item is never sold sight unseen (docs/09 rule 1 spends the
 * anticipation on the reveal, and selling before it would skip the beat).
 */
export function vendorSellPrice(item: Item): number {
  if (CURRENCY_IDS.includes(item.baseId)) return 0;
  if (item.unidentified === true) return 0;
  // Floor of one coin: an item the shop accepts always pays something, or the
  // player learns to stop offering and the sell half of the window goes dead.
  return Math.max(1, Math.trunc((vendorBuyPrice(item) * VENDOR_MARGIN_PCT) / 100));
}

/**
 * Gold a fresh character starts with.
 *
 * Enough for two magic pieces off the opening shelf (256 each at the starting
 * level) and short of a rare, so the shop is worth opening on the first day
 * without answering the question the first map is there to answer.
 */
export const START_GOLD = 500;

/** How many pieces stand on the shelf at once. One page of the purchase grid. */
export const VENDOR_STOCK = 12;

/**
 * What the shelf offers, out of 100. Deliberately duller than a monster's drop:
 * docs/09 rule 3 says intensity beats density, and a shop that reliably sells
 * rares is a shop that makes the map's own rare drop feel like nothing. The rare
 * on the shelf is the reason to check the shelf.
 */
const STOCK_RARITY: readonly { rarity: Rarity; pct: number }[] = [
  { rarity: "rare", pct: 8 },
  { rarity: "magic", pct: 42 },
  { rarity: "normal", pct: 50 },
];

/**
 * Roll a vendor's whole shelf. Deterministic in `seed` alone, so the sim can
 * restock by moving the seed and a replay lands on the same goods.
 *
 * Stock tracks the player's level with a spread below it (docs/02 §17: "item
 * levels roughly follow progression with caps"), and never above — a shop that
 * outsells the zone you are in is a shop that replaces playing the zone.
 */
export function rollVendorStock(pools: ItemPools, seed: number, level: number): Item[] {
  const rnd = mulberry32(seed);
  const stock: Item[] = [];
  for (let i = 0; i < VENDOR_STOCK; i++) {
    let roll = rnd() % 100;
    const rarity = STOCK_RARITY.find((r) => (roll -= r.pct) < 0)?.rarity ?? "normal";
    // Down to four levels below the player, floored at 1.
    const ilvl = Math.max(1, level - (rnd() % 5));
    // A fresh sub-seed per slot: rollItem burns a variable number of draws
    // depending on the rarity it lands on, so sharing one stream would make an
    // earlier slot's rarity shift every later slot's base.
    const item = rollItem(pools, rnd(), ilvl, 0, rarity);
    // The shelf is a display case: you can see what you are paying for. It is
    // also why the vendor is not a way to farm unidentified items for the
    // reveal — that beat belongs to the drop (docs/09 rule 1).
    delete item.unidentified;
    stock.push(item);
  }
  return stock;
}
