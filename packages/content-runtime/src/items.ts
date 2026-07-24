import { validateItemBase, validateAffix, type ItemBase, type Affix, type Item, type ItemPools, type Rarity, type UniqueItem } from "@exiled/content-schema";

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
    icon: "/textures/items/emberwand.png",
  },
  { id: "base.ashen_focus", name: "Ashen Focus", itemClass: "focus", w: 2, h: 2, icon: "/textures/items/ashen_focus.png" },
  { id: "base.cinder_cap", name: "Cinder Cap", itemClass: "helmet", w: 2, h: 2, icon: "/textures/items/cinder_cap.png" },
  { id: "base.emberweave_robe", name: "Emberweave Robe", itemClass: "body", w: 2, h: 3, icon: "/textures/items/emberweave_robe.png" },
];

// Prefix/suffix split follows PoE: raw power (life, mana, added damage, armour) is a
// prefix, while resistances and speed hang off the suffix side. The nameWord is the
// part a magic item borrows, so "affix.life" + "affix.fire_res" on a wand reads
// "Hale Wand of the Furnace"; the words are in PoE's idiom, not lifted from its tables.
const AFFIXES: Affix[] = [
  { id: "affix.life", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 40 },
  { id: "affix.mana", kind: "prefix", nameWord: "Beryl", stat: "maxMana", label: "to maximum Mana", minItemLevel: 1, min: 4, max: 30 },
  { id: "affix.fire_dmg", kind: "prefix", nameWord: "Smoldering", stat: "fireDamage", label: "to Fire Damage", minItemLevel: 1, min: 2, max: 18 },
  { id: "affix.fire_res", kind: "suffix", nameWord: "of the Furnace", stat: "fireResPct", label: "% to Fire Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.armour", kind: "prefix", nameWord: "Plated", stat: "armour", label: "to Armour", minItemLevel: 8, min: 10, max: 60 },
  { id: "affix.cast_speed", kind: "suffix", nameWord: "of Casting", stat: "castSpeedPct", label: "% increased Cast Speed", minItemLevel: 12, min: 3, max: 12 },
];

// Named items bound to one base each. Mod ranges are the unique's own and deliberately
// beat the shared affix pool's ranges; flavour is the italic orange line in the tooltip
// (poe2-screenshots/item-unique.png).
const UNIQUES: UniqueItem[] = [
  {
    id: "unique.ashmaw",
    name: "Ashmaw",
    baseId: "base.emberwand",
    flavour: "It was a torch, once, before the ash learned to bite.",
    icon: "/textures/items/unique_ashmaw.png",
    mods: [
      { affixId: "affix.fire_dmg", min: 22, max: 34 },
      { affixId: "affix.cast_speed", min: 14, max: 20 },
      { affixId: "affix.mana", min: 20, max: 30 },
    ],
  },
  {
    id: "unique.emberchoir",
    name: "Emberchoir",
    baseId: "base.ashen_focus",
    flavour: "Every voice it kept is a voice that burned.",
    icon: "/textures/items/unique_emberchoir.png",
    mods: [
      { affixId: "affix.fire_res", min: 30, max: 45 },
      { affixId: "affix.mana", min: 35, max: 50 },
      { affixId: "affix.life", min: 10, max: 20 },
    ],
  },
  {
    id: "unique.cinderveil",
    name: "Cinderveil",
    baseId: "base.emberweave_robe",
    flavour: "The fire spared her. Nothing else did.",
    icon: "/textures/items/unique_cinderveil.png",
    mods: [
      { affixId: "affix.life", min: 45, max: 70 },
      { affixId: "affix.armour", min: 70, max: 110 },
      { affixId: "affix.fire_res", min: 20, max: 30 },
    ],
  },
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
// Uniques are shape-checked by the compiler; what it cannot catch is a dangling id,
// an inverted range, or two uniques sharing the display name describeItem looks them up by.
{
  const baseIds = new Set(ITEM_BASES.map((b) => b.id));
  const affixIds = new Set(AFFIXES.map((a) => a.id));
  const names = new Set<string>();
  for (const u of UNIQUES) {
    const bad = (msg: string) => { throw new Error(`[content-runtime] Invalid unique "${u.id}": ${msg}`); };
    if (!baseIds.has(u.baseId)) bad(`unknown baseId "${u.baseId}"`);
    if (u.mods.length === 0) bad("must have at least one mod");
    if (names.has(u.name)) bad(`duplicate name "${u.name}"`);
    names.add(u.name);
    for (const m of u.mods) {
      if (!affixIds.has(m.affixId)) bad(`unknown affixId "${m.affixId}"`);
      if (m.min > m.max) bad(`mod "${m.affixId}" has min > max`);
    }
  }
}

export const ITEM_POOLS: ItemPools = { bases: ITEM_BASES, affixes: AFFIXES, uniques: UNIQUES };

const BASE_BY_ID = new Map(ITEM_BASES.map((b) => [b.id, b]));
const AFFIX_BY_ID = new Map(AFFIXES.map((a) => [a.id, a]));
const UNIQUE_BY_NAME = new Map(UNIQUES.map((u) => [u.name, u]));

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
  /** unique only: italic flavour line below the mods. */
  flavour?: string;
  /** Inventory art from the base; absent means the UI falls back to the name. */
  icon?: string;
}

/**
 * Affix line exactly as poe2-screenshots/item-*.png renders it: a percent label
 * hugs its number ("13% to Fire Resistance", not "13 % ..."), and increased/reduced
 * mods carry no sign, while flat and resistance mods do ("+9 to maximum Life").
 */
function affixLine(value: number, label: string): string {
  const pct = label.startsWith("%");
  const signed = !/^% (increased|reduced)\b/.test(label);
  return `${signed ? "+" : ""}${value}${pct ? "" : " "}${label}`;
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
    return a ? affixLine(ia.value, a.label) : `+${ia.value} ${ia.affixId}`;
  });
  const d: ItemDescription = {
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
  // A unique is its own item, not a re-skin: its art overrides the base's.
  const unique = item.rarity === "unique" ? UNIQUE_BY_NAME.get(d.name) : undefined;
  if (unique?.flavour) d.flavour = unique.flavour;
  const icon = unique?.icon ?? base.icon;
  if (icon) d.icon = icon;
  return d;
}
