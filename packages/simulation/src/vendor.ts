import { ITEM_POOLS, baseOf, canonicalBaseId, currencyItem, isPortalScroll, PORTAL_SCROLL_BASE_ID, WISDOM_SCROLL_BASE_ID } from "@exiled/content-runtime";
import { familyForClass, rollVendorStock, SHARDS_PER_ORB } from "@exiled/rules";
import { placeFirstFit } from "./inventory";
import type { Item } from "@exiled/content-schema";
import type { BuybackC, BuybackItem, InventoryC, SessionC, VendorC } from "./components";
import type { Entity, World } from "./ecs";

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
 * level-up would be exactly that. The Scroll of Wisdom is PoE1's other staple:
 * an unread rare must never wait on a lucky drop (docs/09 rule 1), and drops alone
 * pay about one scroll per unidentified item. `isStaple` is what keeps the cell on
 * the shelf after a purchase (systems/equipment.ts): the cell is a price tag, not a unit.
 */
const STAPLES: readonly Item[] = [currencyItem(PORTAL_SCROLL_BASE_ID), currencyItem(WISDOM_SCROLL_BASE_ID)];

/** How many cells the staples take before the rolled stock is laid down. */
export const STAPLE_COUNT = STAPLES.length;

/** Bought without emptying its cell. See STAPLES. */
export function isStaple(item: Item): boolean {
  return isPortalScroll(item) || item.baseId === WISDOM_SCROLL_BASE_ID;
}

/**
 * The buyback page with one more sale on it, borrowed from PoE2's Buyback tab.
 * Same size as the shelf; when the piece does not fit, the oldest sales make way.
 */
export function recordSale(page: BuybackC | undefined, sale: Omit<BuybackItem, "x" | "y">): BuybackC {
  let items = page?.items ?? [];
  for (;;) {
    const grid: BuybackC = { cols: VENDOR_COLS, rows: VENDOR_ROWS, items };
    const at = placeFirstFit(grid, sale.w, sale.h);
    if (at !== null) return { ...grid, items: [...items, { ...sale, x: at.x, y: at.y }] };
    if (items.length === 0) return grid; // a piece larger than the page is not kept
    items = items.slice(1);
  }
}

/**
 * The backpack and shard counter with a sale's shards taken back, or null when
 * they cannot be. Shards the counter no longer holds became an orb, and that orb
 * comes back out of the backpack; if it is gone, the sale cannot be undone exactly.
 */
export function unpayShards(
  inv: InventoryC, counts: Record<string, number>, sale: BuybackItem,
): { inv: InventoryC; counts: Record<string, number> } | null {
  if (sale.orbBaseId === undefined || sale.shards === undefined) return { inv, counts };
  const orb = canonicalBaseId(sale.orbBaseId);
  let left = (counts[sale.orbBaseId] ?? 0) - sale.shards;
  let items = inv.items;
  while (left < 0) {
    const i = items.findIndex((p) => canonicalBaseId(p.item.baseId) === orb);
    if (i < 0) return null;
    items = (items[i]!.count ?? 1) > 1
      ? items.map((p, j) => (j === i ? { ...p, count: (p.count ?? 1) - 1 } : p))
      : items.filter((_, j) => j !== i);
    left += SHARDS_PER_ORB;
  }
  return { inv: { ...inv, items }, counts: { ...counts, [sale.orbBaseId]: left } };
}

/** New goods for `level`, and the buyback page goes with the old ones (PoE2 clears it too). */
export function restockVendor(world: World, sessionE: Entity, level: number): void {
  const s = world.get<SessionC>(sessionE, "session")!;
  world.set<VendorC>(sessionE, "vendor", stockVendor(s.atlasSeed, level, s.classId));
  world.remove(sessionE, "buyback");
}

export function stockVendor(worldSeed: number, level: number, classId?: string): VendorC {
  const shelf: VendorC = { cols: VENDOR_COLS, rows: VENDOR_ROWS, items: [] };
  for (const item of STAPLES) {
    const base = baseOf(item.baseId);
    const at = placeFirstFit(shelf, base.w, base.h);
    if (at === null) break;
    shelf.items.push({ x: at.x, y: at.y, w: base.w, h: base.h, item });
  }
  const seed = (worldSeed ^ Math.imul(level, 0x9e3779b1)) >>> 0;
  for (const item of rollVendorStock(ITEM_POOLS, seed, level, familyForClass(classId))) {
    const base = baseOf(item.baseId);
    const at = placeFirstFit(shelf, base.w, base.h);
    if (at === null) break; // shelf full; the rest of the roll is simply not stocked
    shelf.items.push({ x: at.x, y: at.y, w: base.w, h: base.h, item });
  }
  return shelf;
}
