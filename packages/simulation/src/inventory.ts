import type { InventoryC } from "./components";

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Can a w x h piece sit with its top-left at (x, y)? In bounds and clear of every
 * other item. `ignoreIndex` skips one entry, which is what lets a move overlap the
 * footprint the moving item is about to vacate.
 */
export function canPlaceAt(inv: InventoryC, w: number, h: number, x: number, y: number, ignoreIndex = -1): boolean {
  if (x < 0 || y < 0 || x + w > inv.cols || y + h > inv.rows) return false;
  return !inv.items.some((p, i) => i !== ignoreIndex && overlaps(x, y, w, h, p.x, p.y, p.w, p.h));
}

/**
 * First-fit top-left placement for a w×h piece. Scans rows then columns and
 * returns the first free rectangle, or null if none fits. Deterministic.
 */
export function placeFirstFit(inv: InventoryC, w: number, h: number): { x: number; y: number } | null {
  if (w > inv.cols || h > inv.rows) return null;
  for (let y = 0; y <= inv.rows - h; y++) {
    for (let x = 0; x <= inv.cols - w; x++) {
      if (canPlaceAt(inv, w, h, x, y)) return { x, y };
    }
  }
  return null;
}
