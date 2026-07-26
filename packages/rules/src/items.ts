// Pure, deterministic item generation. Type-only content-schema import keeps this
// a leaf (matches rare.ts). PRNG inlined like atlas.ts so there is no @exiled dep.
import type { ItemPools, Item, ItemAffix, Rarity } from "@exiled/content-schema";
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

// ponytail: rarity odds are a calibration placeholder (docs/01:780 says empirical).
// One formula per tier, monotonic in ilvl and monsterRarity; tune here only. The rare
// band is carved from below the magic band, so magicPercent always dominates rarePercent.
function magicPercent(ilvl: number, monsterRarity: number): number {
  const pct = 20 + Math.trunc(ilvl / 4) + monsterRarity * 15;
  return Math.max(0, Math.min(90, pct));
}
function rarePercent(ilvl: number, monsterRarity: number): number {
  const pct = Math.trunc((ilvl - 70) / 6) + (monsterRarity - 1) * 12;
  return Math.max(0, Math.min(35, pct));
}
function uniquePercent(ilvl: number, monsterRarity: number): number {
  const pct = Math.trunc((ilvl - 68) / 12) + (monsterRarity - 1) * 2;
  return Math.max(0, Math.min(6, pct));
}

/**
 * How many of each side a rarity may hold, same as PoE: magic 1+1, rare 3+3.
 * Shared with the crafting currencies, which fill this capacity rather than reroll it.
 */
export const CAPACITY: Record<"magic" | "rare", { prefix: number; suffix: number }> = {
  magic: { prefix: 1, suffix: 1 },
  rare: { prefix: 3, suffix: 3 },
};

/**
 * Pick up to `want` new affixes for an item, respecting item level, the base's class
 * pool, and whatever `existing` already occupies. Returns only the new ones, so a
 * caller that is adding to an item can concatenate and one that is generating from
 * scratch can pass `existing: []`.
 *
 * A pool that is short on one side yields fewer mods rather than overfilling the other.
 */
export function pickAffixes(
  pools: ItemPools,
  itemClass: string,
  ilvl: number,
  rnd: () => number,
  want: number,
  existing: readonly ItemAffix[],
  cap: { prefix: number; suffix: number },
  /**
   * Draws allowed beyond the generation budget of `want * 4`. Adding one mod to an
   * item whose prefixes are full needs more than four draws to find the suffix side,
   * where generating from scratch never does. Left at 0 the loop is byte-identical to
   * the one that produced every item in every recorded replay.
   */
  extraAttempts = 0,
): ItemAffix[] {
  // Two gates: item level, and the base's class pool. A mod that names no classes
  // is universal (attributes, resistances); one that names them is bound to them.
  const eligible = pools.affixes.filter(
    (a) => a.minItemLevel <= ilvl && (a.itemClasses === undefined || a.itemClasses.includes(itemClass)),
  );
  const added: ItemAffix[] = [];
  if (eligible.length === 0) return added;

  const left = { ...cap };
  const picked = new Set<string>();
  for (const e of existing) {
    const def = eligible.find((a) => a.id === e.affixId);
    // A mod the pool no longer offers still holds its side, but cannot be redrawn
    // anyway, so it stays out of `picked` and the termination count stays honest.
    if (def) picked.add(def.id);
    const kind = def?.kind ?? pools.affixes.find((a) => a.id === e.affixId)?.kind;
    if (kind) left[kind]--;
  }

  // Bounded attempts to pick `want` distinct affixes; deterministic order. An affix
  // bounced by a full side stays picked, so the loop always makes progress.
  const budget = want * 4 + extraAttempts;
  for (let attempt = 0; attempt < budget && added.length < want && picked.size < eligible.length; attempt++) {
    const a = eligible[rnd() % eligible.length]!;
    if (picked.has(a.id)) continue;
    picked.add(a.id);
    if (left[a.kind] <= 0) continue;
    left[a.kind]--;
    const value = a.min + (rnd() % (a.max - a.min + 1));
    added.push({ affixId: a.id, value });
  }
  return added;
}

/** "[Prefix] Base [Suffix]": a magic item borrows its name from its own two mods. */
export function magicName(pools: ItemPools, baseName: string, affixes: readonly ItemAffix[]): string {
  const wordOf = (kind: "prefix" | "suffix") =>
    affixes.map((ia) => pools.affixes.find((a) => a.id === ia.affixId))
      .find((a) => a?.kind === kind)?.nameWord;
  return [wordOf("prefix"), baseName, wordOf("suffix")].filter(Boolean).join(" ");
}

/**
 * @param forceRarity debug/lab only: skip the rarity roll and produce this tier.
 *   Best-effort: asking for "unique" on a pool without uniques yields a normal item.
 */
export function rollItem(
  pools: ItemPools,
  seed: number,
  ilvl: number,
  monsterRarity: number,
  forceRarity?: Rarity,
): Item {
  const rnd = mulberry32(seed);
  const base = pools.bases[rnd() % pools.bases.length]!;
  const roll = rnd() % 100;
  const rarePct = rarePercent(ilvl, monsterRarity);

  // A unique replaces the whole roll: it brings its own base, name and mod list.
  // Its band is carved from below the rare band so rare always stays reachable.
  const uniques = pools.uniques ?? [];
  const uniquePct = Math.min(uniquePercent(ilvl, monsterRarity), Math.max(0, rarePct - 1));
  if (uniques.length > 0 && (forceRarity === "unique" || (forceRarity === undefined && roll < uniquePct))) {
    const u = uniques[rnd() % uniques.length]!;
    return {
      baseId: u.baseId,
      rarity: "unique",
      itemLevel: ilvl,
      affixes: u.mods.map((m) => ({ affixId: m.affixId, value: m.min + (rnd() % (m.max - m.min + 1)) })),
      name: u.name,
      unidentified: true,
    };
  }

  // "unique" only reaches here when the pool had none to give, so it degrades to normal.
  let rarity: "normal" | "magic" | "rare" =
    forceRarity !== undefined
    ? (forceRarity === "unique" ? "normal" : forceRarity)
    : roll < rarePct ? "rare"
    : roll < magicPercent(ilvl, monsterRarity) ? "magic"
    : "normal";

  let affixes: ItemAffix[] = [];
  if (rarity !== "normal") {
    const want = rarity === "rare" ? 3 + (rnd() % 4) : 1 + (rnd() % 2); // rare 3..6, magic 1..2
    affixes = pickAffixes(pools, base.itemClass, ilvl, rnd, want, [], CAPACITY[rarity]);
  }

  // An item with no affixes cannot be magic or rare.
  const finalRarity = affixes.length === 0 ? "normal" : rarity;
  const item: Item = { baseId: base.id, rarity: finalRarity, itemLevel: ilvl, affixes };
  // Only an item with something to reveal drops unidentified.
  if (finalRarity !== "normal") item.unidentified = true;
  if (finalRarity === "rare") item.name = rareName(rnd);
  if (finalRarity === "magic") item.name = magicName(pools, base.name, affixes);
  return item;
}
