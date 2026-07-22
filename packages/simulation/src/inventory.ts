import type { InventoryC } from "./components";

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * First-fit top-left placement for a w×h piece. Scans rows then columns and
 * returns the first free rectangle, or null if none fits. Deterministic.
 */
export function placeFirstFit(inv: InventoryC, w: number, h: number): { x: number; y: number } | null {
  if (w > inv.cols || h > inv.rows) return null;
  for (let y = 0; y <= inv.rows - h; y++) {
    for (let x = 0; x <= inv.cols - w; x++) {
      const clash = inv.items.some((p) => overlaps(x, y, w, h, p.x, p.y, p.w, p.h));
      if (!clash) return { x, y };
    }
  }
  return null;
}
