import { validateItemBase, validateAffix, type ItemBase, type Affix, type Item, type ItemPools, type Rarity } from "@exiled/content-schema";

// Tiny hand-authored pool for the First Loot slice. Grid dims (w×h) follow the
// 12×5 inventory. Real 45-base / 120-affix content is Phase 4 proper.
const ITEM_BASES: ItemBase[] = [
  {
    id: "base.emberwand",
    name: "Ember Wand",
    itemClass: "wand",
    w: 1,
    h: 2,
    stats: { physMin: 5, physMax: 10, critPct: 8, aps: 1.2, reqLevel: 8, reqAttrValue: 29, reqAttr: "Int" },
  },
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
export interface ItemDescription {
  /** Display name: the item's generated name (rare/unique) or the base name. */
  name: string;
  /** Base type, always the base name, shown under a generated name for rares. */
  baseName: string;
  rarity: Rarity;
  itemClass: string;
  /** base-stat lines rendered "label: value" (empty for bases without stats) */
  statLines: { label: string; value: string }[];
  reqLevel?: number;
  reqAttrValue?: number;
  reqAttr?: string;
  /** affix lines */
  lines: string[];
}

export function describeItem(item: Item): ItemDescription {
  const base = baseOf(item.baseId);
  const s = base.stats;
  const statLines: { label: string; value: string }[] = [];
  if (s?.physMin !== undefined && s.physMax !== undefined) statLines.push({ label: "Physical Damage", value: `${s.physMin}-${s.physMax}` });
  if (s?.critPct !== undefined) statLines.push({ label: "Critical Strike Chance", value: `${s.critPct.toFixed(2)}%` });
  if (s?.aps !== undefined) statLines.push({ label: "Attacks per Second", value: s.aps.toFixed(2) });
  const lines = item.affixes.map((ia) => {
    const a = AFFIX_BY_ID.get(ia.affixId);
    return a ? `+${ia.value} ${a.label}` : `+${ia.value} ${ia.affixId}`;
  });
  return {
    name: item.name ?? base.name,
    baseName: base.name,
    rarity: item.rarity,
    itemClass: base.itemClass,
    statLines,
    reqLevel: s?.reqLevel,
    reqAttrValue: s?.reqAttrValue,
    reqAttr: s?.reqAttr,
    lines,
  };
}
