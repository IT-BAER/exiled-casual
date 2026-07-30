// Pure, deterministic crafting currency (docs/02 §8). Each application is its own
// pull with the item as the slot machine, which is why docs/09 lists orbs as a
// retention device: the uncertainty is in the outcome, not in whether you get one.
import type { Item, ItemAffix, ItemPools } from "@exiled/content-schema";
import { CAPACITY, pickAffixes, magicName } from "./items.js";
import { rareName } from "./item-names.js";

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
 * The five state transitions this game ships, keyed by currency base id. Names are
 * this project's own where PoE's are coinages rather than alchemy vocabulary:
 * "Orb of Elevation" is PoE's Regal and "Orb of Embers" its Exalted.
 */
const TRANSITIONS: Record<string, { from: readonly Item["rarity"][]; to: "magic" | "rare"; add: number; fresh?: boolean }> = {
  "currency.transmutation": { from: ["normal"], to: "magic", add: 1 },
  "currency.augmentation": { from: ["magic"], to: "magic", add: 1 },
  "currency.elevation": { from: ["magic"], to: "rare", add: 1 },
  "currency.alchemy": { from: ["normal", "magic"], to: "rare", add: 4, fresh: true },
  "currency.embers": { from: ["rare"], to: "rare", add: 1 },
};

/**
 * Every currency base the game ships. The Scroll of Wisdom is spent by this module;
 * the Portal Scroll is spent by the sim (systems/interact.ts) and appears here so
 * the shop refuses to buy it back like any other currency.
 */
export const CURRENCY_IDS: readonly string[] = [
  "currency.wisdom", "currency.portal", ...Object.keys(TRANSITIONS),
];

/**
 * Could this currency plausibly apply, judged from what a client can see? The sim
 * re-checks with the whole item, so this is only good enough to colour a cursor; it
 * reads the same table rather than restating it, which is the point.
 */
export function currencyAccepts(
  currencyId: string,
  rarity: Item["rarity"],
  unidentified: boolean,
  modCount: number,
): boolean {
  if (rarity === "unique") return false;
  if (currencyId === "currency.wisdom") return unidentified;
  if (unidentified) return false;
  const t = TRANSITIONS[currencyId];
  if (t === undefined || !t.from.includes(rarity)) return false;
  const cap = CAPACITY[t.to];
  return t.fresh === true || modCount < cap.prefix + cap.suffix;
}

/** The rarity an application lands on, so the client can sound the outcome, or null for a reveal. */
export function currencyResultRarity(currencyId: string): "magic" | "rare" | null {
  return TRANSITIONS[currencyId]?.to ?? null;
}

/**
 * Spend one unit of `currencyId` on `item`. Returns the new item, or null when the
 * preconditions do not hold, so the caller can leave the currency unspent rather than
 * charging for a no-op. `item` is never mutated.
 */
export function applyCurrency(pools: ItemPools, currencyId: string, item: Item, seed: number): Item | null {
  // Uniques carry an authored mod list; crafting on them would be inventing content.
  if (item.rarity === "unique") return null;

  // Reading comes before crafting: an unidentified item's mods are already rolled and
  // withheld (docs/02 §2), so touching them before the reveal would spend the
  // anticipation the reveal exists to pay off.
  if (currencyId === "currency.wisdom") {
    if (item.unidentified !== true) return null;
    const { unidentified: _read, ...revealed } = item;
    return revealed;
  }
  if (item.unidentified === true) return null;

  const t = TRANSITIONS[currencyId];
  if (t === undefined || !t.from.includes(item.rarity)) return null;

  const base = pools.bases.find((b) => b.id === item.baseId);
  if (base === undefined) return null;

  const kept: ItemAffix[] = t.fresh === true ? [] : [...item.affixes];
  const cap = CAPACITY[t.to];
  const used = { prefix: 0, suffix: 0 };
  for (const a of kept) {
    const kind = pools.affixes.find((d) => d.id === a.affixId)?.kind;
    if (kind) used[kind]++;
  }
  // Full on both sides means there is nothing to buy, which is the Exalted/Augment
  // precondition ("open capacity") stated as arithmetic rather than as a rarity check.
  if (used.prefix >= cap.prefix && used.suffix >= cap.suffix) return null;

  const rnd = mulberry32(seed);
  const added = pickAffixes(pools, base.itemClass, item.itemLevel, rnd, t.add, kept, cap, pools.affixes.length * 4);
  if (added.length === 0) return null;

  const affixes = [...kept, ...added];
  const out: Item = { ...item, rarity: t.to, affixes };
  // A magic item's name is its own two mods, so it is rebuilt every time they change.
  // A rare keeps the name it was given; only the promotion into rare earns a new one.
  if (t.to === "magic") out.name = magicName(pools, base.name, affixes);
  else if (item.rarity !== "rare") out.name = rareName(rnd);
  return out;
}
