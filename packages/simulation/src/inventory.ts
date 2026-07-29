import { permanentWaystone, isPermanentWaystone } from "@exiled/content-runtime";
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

/**
 * The bag with the permanent waystone in it, adding one only if it is missing.
 *
 * Stones are spent to open a map and only come back off a dead map boss, so a
 * character who abandoned a run on their last one used to be locked out of the
 * game: nothing sells stones, nothing crafts them, and the map device has
 * nothing to offer. `permanentWaystone()` is the floor under that.
 *
 * Applied where a bag ENTERS the world — a character being made, and a save
 * being loaded — rather than on a tick. Every session passes through both, so
 * every character has it, including ones saved before it existed; and a stone
 * dropped, sold or stashed on purpose is back the next time the character is
 * loaded, which is cheaper than a rule against each of those and cannot be
 * defeated. Doing it per tick instead would mean every world in the game
 * silently grows an item, which is not something the sim should do underneath
 * a player who is standing in their stash.
 */
export function withPermanentWaystone(inv: InventoryC): InventoryC {
  if (inv.items.some((p) => isPermanentWaystone(p.item))) return inv;
  const cell = placeFirstFit(inv, 1, 1);
  if (!cell) return inv;
  return { ...inv, items: [...inv.items, { x: cell.x, y: cell.y, w: 1, h: 1, item: permanentWaystone() }] };
}
