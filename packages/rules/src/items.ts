// Pure, deterministic item generation. Type-only content-schema import keeps this
// a leaf (matches rare.ts). PRNG inlined like atlas.ts so there is no @exiled dep.
import type { ItemPools, Item, ItemAffix } from "@exiled/content-schema";
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

export function rollItem(pools: ItemPools, seed: number, ilvl: number, monsterRarity: number): Item {
  const rnd = mulberry32(seed);
  const base = pools.bases[rnd() % pools.bases.length]!;
  const roll = rnd() % 100;
  let rarity: "normal" | "magic" | "rare" =
    roll < rarePercent(ilvl, monsterRarity) ? "rare"
    : roll < magicPercent(ilvl, monsterRarity) ? "magic"
    : "normal";

  const affixes: ItemAffix[] = [];
  if (rarity !== "normal") {
    const eligible = pools.affixes.filter((a) => a.minItemLevel <= ilvl);
    if (eligible.length > 0) {
      const want = rarity === "rare" ? 3 + (rnd() % 4) : 1 + (rnd() % 2); // rare 3..6, magic 1..2
      const picked = new Set<string>();
      // Bounded attempts to pick `want` distinct affixes; deterministic order.
      for (let attempt = 0; attempt < want * 4 && picked.size < want && picked.size < eligible.length; attempt++) {
        const a = eligible[rnd() % eligible.length]!;
        if (picked.has(a.id)) continue;
        picked.add(a.id);
        const value = a.min + (rnd() % (a.max - a.min + 1));
        affixes.push({ affixId: a.id, value });
      }
    }
  }

  // An item with no affixes cannot be magic or rare.
  const finalRarity = affixes.length === 0 ? "normal" : rarity;
  const item: Item = { baseId: base.id, rarity: finalRarity, itemLevel: ilvl, affixes };
  if (finalRarity === "rare") item.name = rareName(rnd);
  return item;
}
