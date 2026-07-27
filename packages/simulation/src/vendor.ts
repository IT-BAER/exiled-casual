import { ITEM_POOLS, baseOf } from "@exiled/content-runtime";
import { rollVendorStock } from "@exiled/rules";
import { placeFirstFit } from "./inventory";
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
export function stockVendor(worldSeed: number, level: number): VendorC {
  const shelf: VendorC = { cols: VENDOR_COLS, rows: VENDOR_ROWS, items: [] };
  const seed = (worldSeed ^ Math.imul(level, 0x9e3779b1)) >>> 0;
  for (const item of rollVendorStock(ITEM_POOLS, seed, level)) {
    const base = baseOf(item.baseId);
    const at = placeFirstFit(shelf, base.w, base.h);
    if (at === null) break; // shelf full; the rest of the roll is simply not stocked
    shelf.items.push({ x: at.x, y: at.y, w: base.w, h: base.h, item });
  }
  return shelf;
}
