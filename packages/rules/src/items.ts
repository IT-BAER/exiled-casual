// Pure, deterministic item generation. Type-only content-schema import keeps this
// a leaf (matches rare.ts). PRNG inlined like atlas.ts so there is no @pact dep.
import type { ItemPools, Item, ItemAffix } from "@pact/content-schema";

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
// One formula, monotonic in ilvl and monsterRarity; tune here only.
function magicPercent(ilvl: number, monsterRarity: number): number {
  const pct = 20 + Math.trunc(ilvl / 4) + monsterRarity * 15;
  return Math.max(0, Math.min(90, pct));
}

export function rollItem(pools: ItemPools, seed: number, ilvl: number, monsterRarity: number): Item {
  const rnd = mulberry32(seed);
  const base = pools.bases[rnd() % pools.bases.length]!;
  const rarity = (rnd() % 100) < magicPercent(ilvl, monsterRarity) ? "magic" : "normal";

  const affixes: ItemAffix[] = [];
  if (rarity === "magic") {
    const eligible = pools.affixes.filter((a) => a.minItemLevel <= ilvl);
    if (eligible.length > 0) {
      const want = 1 + (rnd() % 2); // 1 or 2
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

  const finalRarity = rarity === "magic" && affixes.length === 0 ? "normal" : rarity;
  return { baseId: base.id, rarity: finalRarity, itemLevel: ilvl, affixes };
}
