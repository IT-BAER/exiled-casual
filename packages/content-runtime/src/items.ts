import { validateItemBase, validateAffix, type ItemBase, type Affix, type Item, type ItemPools, type Rarity } from "@pact/content-schema";

// Tiny hand-authored pool for the First Loot slice. Grid dims (w×h) follow the
// 12×5 inventory. Real 45-base / 120-affix content is Phase 4 proper.
const ITEM_BASES: ItemBase[] = [
  { id: "base.emberwand", name: "Ember Wand", itemClass: "wand", w: 1, h: 2 },
  { id: "base.ashen_focus", name: "Ashen Focus", itemClass: "focus", w: 2, h: 2 },
  { id: "base.cinder_cap", name: "Cinder Cap", itemClass: "helmet", w: 2, h: 2 },
  { id: "base.emberweave_robe", name: "Emberweave Robe", itemClass: "body", w: 2, h: 3 },
];

const AFFIXES: Affix[] = [
  { id: "affix.life", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 40 },
  { id: "affix.mana", stat: "maxMana", label: "to maximum Mana", minItemLevel: 1, min: 4, max: 30 },
  { id: "affix.fire_dmg", stat: "fireDamage", label: "to Fire Damage", minItemLevel: 1, min: 2, max: 18 },
  { id: "affix.fire_res", stat: "fireResPct", label: "% to Fire Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.armour", stat: "armour", label: "to Armour", minItemLevel: 8, min: 10, max: 60 },
  { id: "affix.cast_speed", stat: "castSpeedPct", label: "% increased Cast Speed", minItemLevel: 12, min: 3, max: 12 },
];

// Validate at module load; bad content is a programmer error, fail fast.
for (const b of ITEM_BASES) {
  const r = validateItemBase(b);
  if (!r.ok) throw new Error(`[content-runtime] Invalid item base "${b.id}": ${r.errors.join("; ")}`);
}
for (const a of AFFIXES) {
  const r = validateAffix(a);
  if (!r.ok) throw new Error(`[content-runtime] Invalid affix "${a.id}": ${r.errors.join("; ")}`);
}

export const ITEM_POOLS: ItemPools = { bases: ITEM_BASES, affixes: AFFIXES };

const BASE_BY_ID = new Map(ITEM_BASES.map((b) => [b.id, b]));
const AFFIX_BY_ID = new Map(AFFIXES.map((a) => [a.id, a]));

export function baseOf(baseId: string): ItemBase {
  const b = BASE_BY_ID.get(baseId);
  if (!b) throw new Error(`unknown item base: ${baseId}`);
  return b;
}

// Render-ready projection: base name + one line per committed affix roll.
export function describeItem(item: Item): { name: string; rarity: Rarity; itemClass: string; lines: string[] } {
  const base = baseOf(item.baseId);
  const lines = item.affixes.map((ia) => {
    const a = AFFIX_BY_ID.get(ia.affixId);
    return a ? `+${ia.value} ${a.label}` : `+${ia.value} ${ia.affixId}`;
  });
  return { name: base.name, rarity: item.rarity, itemClass: base.itemClass, lines };
}
