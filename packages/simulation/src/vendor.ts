import { ITEM_POOLS, baseOf, currencyItem, isPortalScroll, PORTAL_SCROLL_BASE_ID } from "@exiled/content-runtime";
import { rollVendorStock } from "@exiled/rules";
import { placeFirstFit } from "./inventory";
import type { Item } from "@exiled/content-schema";
import type { VendorC } from "./components";

/**
 * PoE1's purchase window is a 12x12 square, but its vendors stock a whole page and
 * ours stocks twelve pieces. Eight rows still leave the shelf half empty, and the
 * four rows saved are what keeps the sell block above the life globe rather than
 * behind it.
 */
export const VENDOR_COLS = 12;
export const VENDOR_ROWS = 8;

/**
 * Lay the rolled shelf out on a grid. The seed folds in the level, so a level-up
 * restocks (docs/02 §17) without the session having to carry a mutable stock seed:
 * the shelf is a function of the world seed and the level that asked for it, and a
 * replay lands on the same goods.
 */
/**
 * Goods the shop always has, laid down before the rolled stock and never sold out.
 *
 * A Portal Scroll is the way home from a map with a full bag, so it cannot be
 * something a bad roll leaves you without — and a shelf that restocks only on a
 * level-up would be exactly that. `isStaple` is what keeps the cell on the shelf
 * after a purchase (systems/equipment.ts): the cell is a price tag, not a unit.
 */
const STAPLES: readonly Item[] = [currencyItem(PORTAL_SCROLL_BASE_ID)];

/** How many cells the staples take before the rolled stock is laid down. */
export const STAPLE_COUNT = STAPLES.length;

/** Bought without emptying its cell. See STAPLES. */
export function isStaple(item: Item): boolean {
  return isPortalScroll(item);
}

export function stockVendor(worldSeed: number, level: number): VendorC {
  const shelf: VendorC = { cols: VENDOR_COLS, rows: VENDOR_ROWS, items: [] };
  for (const item of STAPLES) {
    const base = baseOf(item.baseId);
    const at = placeFirstFit(shelf, base.w, base.h);
    if (at === null) break;
    shelf.items.push({ x: at.x, y: at.y, w: base.w, h: base.h, item });
  }
  const seed = (worldSeed ^ Math.imul(level, 0x9e3779b1)) >>> 0;
  for (const item of rollVendorStock(ITEM_POOLS, seed, level)) {
    const base = baseOf(item.baseId);
    const at = placeFirstFit(shelf, base.w, base.h);
    if (at === null) break; // shelf full; the rest of the roll is simply not stocked
    shelf.items.push({ x: at.x, y: at.y, w: base.w, h: base.h, item });
  }
  return shelf;
}
