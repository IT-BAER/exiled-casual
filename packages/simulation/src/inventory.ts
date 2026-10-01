import { permanentWaystone, isPermanentWaystone, isCurrency, isWaystone, canonicalBaseId, baseOf } from "@exiled/content-runtime";
import type { SortMode } from "@exiled/protocol";
import type { InventoryC, PlacedItem } from "./components";

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

/** Paper-doll order: weapons, off-hands, then head to toe. Anything unknown sorts after the belt. */
const CLASS_ORDER = ["mace", "wand", "bow", "shield", "focus", "helmet", "body", "gloves", "boots", "belt"];
const RARITY_ORDER = ["unique", "rare", "magic", "normal"];

function classRank(p: PlacedItem): number {
  let cls = "";
  try { cls = baseOf(p.item.baseId).itemClass; } catch { /* a base the content lost sorts last */ }
  const i = CLASS_ORDER.indexOf(cls);
  return i < 0 ? CLASS_ORDER.length : i;
}

/** Top-left for a w x h piece, scanning down each column, columns from one edge. */
function placeColumnMajor(inv: InventoryC, w: number, h: number, fromRight: boolean): { x: number; y: number } | null {
  for (let i = 0; i <= inv.cols - w; i++) {
    const x = fromRight ? inv.cols - w - i : i;
    for (let y = 0; y <= inv.rows - h; y++) if (canPlaceAt(inv, w, h, x, y)) return { x, y };
  }
  return null;
}

const rarityRank = (p: PlacedItem) => RARITY_ORDER.indexOf(p.item.rarity);
const bySize = (a: PlacedItem, b: PlacedItem) => b.h - a.h || b.w - a.w;
const GEAR_ORDER: Record<SortMode, (a: PlacedItem, b: PlacedItem) => number> = {
  type: (a, b) => classRank(a) - classRank(b) || rarityRank(a) - rarityRank(b) || bySize(a, b),
  rarity: (a, b) => rarityRank(a) - rarityRank(b) || classRank(a) - classRank(b) || bySize(a, b),
  size: (a, b) => b.w * b.h - a.w * a.h || bySize(a, b) || classRank(a) - classRank(b) || rarityRank(a) - rarityRank(b),
};

/**
 * The bag sorted: same-currency stacks merged, then currency and waystones (highest
 * tier first) after the gear. `type` orders gear by slot then rarity down the columns
 * from the left, with the stackables from the right; `rarity` and `size` pack
 * everything row by row from the top left. Ties keep their reading order, so a sorted
 * bag sorts to itself. Null when the pieces cannot all be repacked: a sort never drops
 * an item.
 */
export function sortInventory(inv: InventoryC, mode: SortMode = "type"): InventoryC | null {
  const reading = [...inv.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: PlacedItem[] = [];
  for (const p of reading) {
    const same = isCurrency(p.item)
      ? merged.find((m) => isCurrency(m.item) && canonicalBaseId(m.item.baseId) === canonicalBaseId(p.item.baseId))
      : undefined;
    if (same) same.count = (same.count ?? 1) + (p.count ?? 1);
    else merged.push({ ...p });
  }
  const stackable = (p: PlacedItem) => isCurrency(p.item) || isWaystone(p.item);
  const gear = merged.filter((p) => !stackable(p)).sort(GEAR_ORDER[mode]);
  const rest = merged.filter(stackable).sort((a, b) =>
    Number(isWaystone(a.item)) - Number(isWaystone(b.item)) ||
    (b.item.waystone?.tier ?? 0) - (a.item.waystone?.tier ?? 0));

  const out: InventoryC = { cols: inv.cols, rows: inv.rows, items: [] };
  for (const [list, fromRight] of [[gear, false], [rest, true]] as const) {
    for (const p of list) {
      const at = mode === "type" ? placeColumnMajor(out, p.w, p.h, fromRight) : placeFirstFit(out, p.w, p.h);
      if (!at) return null;
      out.items.push({ ...p, x: at.x, y: at.y });
    }
  }
  return out;
}
