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
    // PoE2 wand implicits all grant a skill ("Grants Skill: Power Siphon"), which nothing
    // in the sim can honour, so this borrows the implicit of the base whose stat block the
    // wand already copies: PoE1's Goat's Horn, (10-15)% increased Spell Damage.
    implicit: { stat: "spellDamagePct", label: "% increased Spell Damage", value: 12 },
    icon: "/textures/items/emberwand.png",
  },
  // Foci and helmets carry no implicit, which is how PoE2 has them: poe2db lists foci with
  // energy shield alone, and body armour is the only armour slot with implicit bases at all.
  { id: "base.ashen_focus", name: "Ashen Focus", itemClass: "focus", w: 2, h: 2, icon: "/textures/items/ashen_focus.png" },
  { id: "base.cinder_cap", name: "Cinder Cap", itemClass: "helmet", w: 2, h: 2, icon: "/textures/items/cinder_cap.png" },
  // The other three armour slots. Each exists so its equipment slot can actually
  // be filled: the character's wardrobe has a look per slot, and a look nothing
  // can ever equip is a cosmetic that never ships.
  { id: "base.ember_gauntlets", name: "Ember Gauntlets", itemClass: "gloves", w: 2, h: 2, icon: "/textures/items/ember_gauntlets.png" },
  { id: "base.ashen_treads", name: "Ashen Treads", itemClass: "boots", w: 2, h: 2, icon: "/textures/items/ashen_treads.png" },
  { id: "base.cinderchain_sash", name: "Cinderchain Sash", itemClass: "belt", w: 2, h: 1, icon: "/textures/items/cinderchain_sash.png" },
  {
    id: "base.emberweave_robe",
    name: "Emberweave Robe",
    itemClass: "body",
    w: 2,
    h: 3,
    // An energy-shield robe, so it takes the implicit PoE2 puts on its Int body armour:
    // Enlightened Robe's (40-50)% increased Mana Regeneration Rate.
    implicit: { stat: "manaRegenPct", label: "% increased Mana Regeneration Rate", value: 45 },
    icon: "/textures/items/emberweave_robe.png",
  },
];

/**
 * Base ids that content has since renamed. A saved inventory outlives the id it was
 * written with, and `baseOf` throwing on load would cost the player the whole stash
 * over a rename (docs/09: a save that corrupts destroys more than any drop created).
 */
const RENAMED_BASES: Record<string, string> = { "base.wisdom_scroll": "currency.wisdom" };

/**
 * Currency is an item everywhere it matters (it lies on the ground, it sits in the
 * grid, `baseOf` resolves it) but it is not a droppable *equipment* base, so it stays
 * out of `ITEM_POOLS.bases` and rollItem can never hand one out as gear. Ids match the
 * transition table in `@exiled/rules` so a base id is all the sim has to carry.
 */
const CURRENCY_BASES: ItemBase[] = [
  { id: "currency.wisdom", name: "Scroll of Wisdom", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/wisdom_scroll.svg" },
  { id: "currency.transmutation", name: "Orb of Transmutation", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_transmutation.png" },
  { id: "currency.augmentation", name: "Orb of Augmentation", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_augmentation.png" },
  { id: "currency.elevation", name: "Orb of Elevation", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_elevation.png" },
  { id: "currency.alchemy", name: "Orb of Alchemy", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_alchemy.png" },
  { id: "currency.embers", name: "Orb of Embers", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_embers.png" },
];

export const WISDOM_SCROLL_BASE_ID = "currency.wisdom";

/** One unit of a currency, as it drops and as it stacks. */
export function currencyItem(baseId: string): Item {
  return { baseId, rarity: "normal", itemLevel: 1, affixes: [] };
}

/** One Scroll of Wisdom. */
export function wisdomScroll(): Item {
  return currencyItem(WISDOM_SCROLL_BASE_ID);
}

/**
 * What drops, and how often relative to each other. Weights are a calibration knob
 * (docs/09 §6), not a constant to guess once: the scroll is common because reading is
 * a chore, and the Orb of Embers is the rarest because it is the one you save for.
 */
export const CURRENCY_DROPS: readonly { baseId: string; weight: number }[] = [
  { baseId: "currency.wisdom", weight: 60 },
  { baseId: "currency.transmutation", weight: 22 },
  { baseId: "currency.augmentation", weight: 14 },
  { baseId: "currency.alchemy", weight: 7 },
  { baseId: "currency.elevation", weight: 5 },
  { baseId: "currency.embers", weight: 2 },
];

/** Pick a currency for a drop from `roll` (0..99 from the caller's deterministic hash). */
export function currencyForRoll(roll: number): string {
  const total = CURRENCY_DROPS.reduce((n, c) => n + c.weight, 0);
  let acc = roll % total;
  for (const c of CURRENCY_DROPS) {
    acc -= c.weight;
    if (acc < 0) return c.baseId;
  }
  return CURRENCY_DROPS[0]!.baseId;
}

/** Currency stacks and is spent; equipment neither. A base the content no longer has is not currency. */
export function isCurrency(item: Item): boolean {
  return CURRENCY_BASES.some((b) => b.id === (RENAMED_BASES[item.baseId] ?? item.baseId));
}

// Prefix/suffix split follows PoE: raw power (life, mana, added damage, armour) is a
// prefix, while resistances, attributes, regeneration and speed hang off the suffix side.
// The nameWord is the part a magic item borrows, so "affix.life" + "affix.fire_res" on a
// wand reads "Hale Wand of the Furnace"; the words are in PoE's idiom, not lifted from its
// tables. Mod text follows PoE2's wording as poe2db lists it ("+(13-19)% to Chaos
// Resistance", "(20-30)% increased Mana Regeneration Rate"), except crit, which stays
// "Critical Strike Chance" to match poe2-screenshots/item-rare.png and the base-stat block.
//
// itemClasses is PoE's per-class mod pool: armour never rolls on a caster weapon, cast
// speed never on a chest. Resistances, attributes and mana regeneration name no class and
// so roll everywhere. Each class keeps four eligible prefixes and four suffixes at item
// level 1, which is what lets a rare of any base fill its 3+3 at any level; gating a pool
// that was wide only in total would have starved whichever class lost the coin flip.
const AFFIXES: Affix[] = [
  { id: "affix.life", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 40, itemClasses: ["helmet", "body", "gloves", "boots", "belt"] },
  { id: "affix.mana", kind: "prefix", nameWord: "Beryl", stat: "maxMana", label: "to maximum Mana", minItemLevel: 1, min: 4, max: 30, itemClasses: ["wand", "focus", "helmet", "body", "gloves", "boots", "belt"] },
  { id: "affix.energy_shield", kind: "prefix", nameWord: "Ghostly", stat: "energyShield", label: "to maximum Energy Shield", minItemLevel: 1, min: 5, max: 35, itemClasses: ["focus", "helmet", "body", "gloves", "boots"] },
  { id: "affix.increased_armour", kind: "prefix", nameWord: "Reinforced", stat: "armourPct", label: "% increased Armour", minItemLevel: 1, min: 10, max: 30, itemClasses: ["helmet", "body", "gloves", "boots", "belt"] },
  { id: "affix.spell_damage", kind: "prefix", nameWord: "Runic", stat: "spellDamagePct", label: "% increased Spell Damage", minItemLevel: 1, min: 10, max: 25, itemClasses: ["wand", "focus"] },
  { id: "affix.fire_dmg", kind: "prefix", nameWord: "Smoldering", stat: "fireDamage", label: "to Fire Damage", minItemLevel: 1, min: 2, max: 18, itemClasses: ["wand", "focus"] },
  { id: "affix.cold_dmg", kind: "prefix", nameWord: "Glacial", stat: "coldDamage", label: "to Cold Damage", minItemLevel: 1, min: 2, max: 16, itemClasses: ["wand", "focus"] },
  { id: "affix.armour", kind: "prefix", nameWord: "Plated", stat: "armour", label: "to Armour", minItemLevel: 8, min: 10, max: 60, itemClasses: ["helmet", "body", "gloves", "boots", "belt"] },
  { id: "affix.increased_es", kind: "prefix", nameWord: "Spectral", stat: "energyShieldPct", label: "% increased Energy Shield", minItemLevel: 8, min: 10, max: 30, itemClasses: ["focus", "helmet", "body", "gloves", "boots"] },
  { id: "affix.fire_res", kind: "suffix", nameWord: "of the Furnace", stat: "fireResPct", label: "% to Fire Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.cold_res", kind: "suffix", nameWord: "of the Yeti", stat: "coldResPct", label: "% to Cold Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.lightning_res", kind: "suffix", nameWord: "of the Squall", stat: "lightningResPct", label: "% to Lightning Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.strength", kind: "suffix", nameWord: "of the Brute", stat: "strength", label: "to Strength", minItemLevel: 1, min: 5, max: 20 },
  { id: "affix.mana_regen", kind: "suffix", nameWord: "of the Spring", stat: "manaRegenPct", label: "% increased Mana Regeneration Rate", minItemLevel: 4, min: 10, max: 35 },
  { id: "affix.crit_chance", kind: "suffix", nameWord: "of Menace", stat: "critChancePct", label: "% increased Critical Strike Chance", minItemLevel: 8, min: 8, max: 25, itemClasses: ["wand", "focus"] },
  { id: "affix.cast_speed", kind: "suffix", nameWord: "of Casting", stat: "castSpeedPct", label: "% increased Cast Speed", minItemLevel: 12, min: 3, max: 12, itemClasses: ["wand", "focus"] },
  { id: "affix.chaos_res", kind: "suffix", nameWord: "of the Outcast", stat: "chaosResPct", label: "% to Chaos Resistance", minItemLevel: 15, min: 4, max: 15 },
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
for (const b of [...ITEM_BASES, ...CURRENCY_BASES]) {
  const r = validateItemBase(b);
  if (!r.ok) throw new Error(`[content-runtime] Invalid item base "${b.id}": ${r.errors.join("; ")}`);
}
{
  // A class the bases do not have is a typo that costs nothing at load and silently makes
  // the mod undroppable, so it is checked here rather than in the schema, which cannot see
  // the base list.
  const classes = new Set(ITEM_BASES.map((b) => b.itemClass));
  for (const a of AFFIXES) {
    const r = validateAffix(a);
    if (!r.ok) throw new Error(`[content-runtime] Invalid affix "${a.id}": ${r.errors.join("; ")}`);
    for (const c of a.itemClasses ?? []) {
      if (!classes.has(c)) throw new Error(`[content-runtime] Invalid affix "${a.id}": no base has item class "${c}"`);
    }
  }
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

const BASE_BY_ID = new Map([...ITEM_BASES, ...CURRENCY_BASES].map((b) => [b.id, b]));
const AFFIX_BY_ID = new Map(AFFIXES.map((a) => [a.id, a]));
const UNIQUE_BY_NAME = new Map(UNIQUES.map((u) => [u.name, u]));

/** The id a base is known by today, so a save written before a rename still matches. */
export function canonicalBaseId(baseId: string): string {
  return RENAMED_BASES[baseId] ?? baseId;
}

export function baseOf(baseId: string): ItemBase {
  const b = BASE_BY_ID.get(RENAMED_BASES[baseId] ?? baseId);
  if (!b) throw new Error(`unknown item base: ${baseId}`);
  return b;
}

/**
 * Sim-ready projection, the counterpart to describeItem: the same implicit and
 * affix rolls, resolved to `(stat, value)` pairs for `applyItemMods`. Implicit
 * first, then affixes in roll order. A dangling affix id is skipped rather than
 * thrown on, matching describeItem's tolerance for content that moved on.
 */
export function itemStatMods(item: Item): { stat: string; value: number }[] {
  const base = baseOf(item.baseId);
  // Structural, not @exiled/rules' ItemStatMod: content must not depend on rules.
  const mods: { stat: string; value: number }[] = [];
  if (base.implicit) mods.push({ stat: base.implicit.stat, value: base.implicit.value });
  for (const ia of item.affixes) {
    const a = AFFIX_BY_ID.get(ia.affixId);
    if (a) mods.push({ stat: a.stat, value: ia.value });
  }
  return mods;
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
  /** the base's fixed implicit, rendered above the affix lines; absent for bases without one */
  implicit?: string;
  /** affix lines */
  lines: string[];
  /** unique only: italic flavour line below the mods. */
  flavour?: string;
  /** Inventory art from the base; absent means the UI falls back to the name. */
  icon?: string;
  /** True while the item is unread: name, mods and flavour are withheld above. */
  unidentified?: boolean;
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
  // An unidentified item is a shape, not a promise: its rolled name and mods stay
  // hidden until a Scroll of Wisdom reads them. The base, its stats and its implicit
  // are visible either way, exactly as PoE shows an unread drop.
  const lines = item.unidentified === true ? [] : item.affixes.map((ia) => {
    const a = AFFIX_BY_ID.get(ia.affixId);
    return a ? affixLine(ia.value, a.label) : `+${ia.value} ${ia.affixId}`;
  });
  const d: ItemDescription = {
    name: item.unidentified === true ? base.name : item.name ?? base.name,
    baseName: base.name,
    rarity: item.rarity,
    itemClass: base.itemClass,
    statLines,
    reqLevel: s?.reqLevel,
    reqAttrValue: s?.reqAttrValue,
    reqAttr: s?.reqAttr,
    lines,
  };
  if (base.implicit) d.implicit = affixLine(base.implicit.value, base.implicit.label);
  // A unique is its own item, not a re-skin: its art overrides the base's.
  // Looked up by the item's true name, so an unidentified unique still shows its own art.
  const unique = item.rarity === "unique" ? UNIQUE_BY_NAME.get(item.name ?? "") : undefined;
  if (unique?.flavour && item.unidentified !== true) d.flavour = unique.flavour;
  if (item.unidentified === true) d.unidentified = true;
  const icon = unique?.icon ?? base.icon;
  if (icon) d.icon = icon;
  return d;
}
