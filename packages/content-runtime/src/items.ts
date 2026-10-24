import { validateItemBase, validateAffix, type ItemBase, type Affix, type Item, type ItemPools, type Rarity, type UniqueItem } from "@exiled/content-schema";
import { areaLevel, waystoneRarity, waystoneMods } from "@exiled/rules";

// Tiny hand-authored pool for the First Loot slice. Grid dims (w×h) follow the
// 12×5 inventory. Real 45-base / 120-affix content is Phase 4 proper.
//
// One family per class and nothing else: `ironsworn_*` is the plate set,
// `stalker_*` the leather set, `ember_*` the cloth set, and every piece a
// character wears is one of the bases below. A base outside the three
// families would be a drop the wardrobe has no look for, and a drop the player
// cannot read is a reward that did not happen (docs/09).
const ITEM_BASES: ItemBase[] = [
  // Ironsworn, the plate set. PoE2 puts its armour-base implicit on the body
  // slot alone, so the helm, gauntlets, sabatons and girdle carry none. Base
  // Armour is PoE2's lowest Str base per slot (poe2db: body 45, helmet 29,
  // gloves 15, boots 22); no belt has any.
  { id: "base.ironsworn_helm", name: "Ironsworn Helm", itemClass: "helmet", w: 2, h: 2, stats: { armour: 29 }, icon: "/textures/items/ironsworn_helm.webp" },
  {
    id: "base.ironsworn_plate",
    name: "Ironsworn Plate",
    itemClass: "body",
    w: 2,
    h: 3,
    stats: { armour: 45 },
    // PoE2's Str body bases carry +(10-20) to Strength.
    implicit: { stat: "strength", label: "to Strength", value: 12 },
    icon: "/textures/items/ironsworn_plate.webp",
  },
  { id: "base.ironsworn_gauntlets", name: "Ironsworn Gauntlets", itemClass: "gloves", w: 2, h: 2, stats: { armour: 15 }, icon: "/textures/items/ironsworn_gauntlets.webp" },
  { id: "base.ironsworn_sabatons", name: "Ironsworn Sabatons", itemClass: "boots", w: 2, h: 2, stats: { armour: 22 }, icon: "/textures/items/ironsworn_sabatons.webp" },
  { id: "base.ironsworn_girdle", name: "Ironsworn Girdle", itemClass: "belt", w: 2, h: 1, icon: "/textures/items/ironsworn_girdle.webp" },
  // Jewellery has no look, like a belt. Each piece copies one PoE2 base's implicit
  // and level (poe2db), fixed at a value inside its range: Amber Amulet, Ruby Ring.
  {
    id: "base.ironsworn_torc", name: "Ironsworn Torc", itemClass: "amulet", w: 1, h: 1, stats: { reqLevel: 8 },
    implicit: { stat: "strength", label: "to Strength", value: 12 }, icon: "/textures/items/ironsworn_torc.webp",
  },
  {
    id: "base.ironsworn_signet", name: "Ironsworn Signet", itemClass: "ring", w: 1, h: 1, stats: { reqLevel: 8 },
    implicit: { stat: "fireResPct", label: "% to Fire Resistance", value: 25 }, icon: "/textures/items/ironsworn_signet.webp",
  },
  // PoE2 gives every shield an implicit block chance and nothing here blocks
  // yet, so the two shields take the armour side of the base instead and roll
  // armour and life like the rest of the armour classes. The tower shield is
  // PoE2's Splintered Tower Shield (poe2db: 18 Armour).
  { id: "base.ironsworn_tower_shield", name: "Ironsworn Tower Shield", itemClass: "shield", w: 2, h: 3, stats: { armour: 18 }, icon: "/textures/items/ironsworn_tower_shield.webp" },
  // The starter weapons copy PoE2's own level-1 bases (poe2db): the hammer is the
  // Wooden Club's block, the bow the Crude Bow's. Attacks are authored against the
  // class's starter (simulation/weapon.ts), so another weapon scales them by ratio.
  {
    id: "base.ironsworn_hammer",
    name: "Ironsworn Hammer",
    itemClass: "mace",
    w: 2,
    h: 3,
    stats: { physMin: 6, physMax: 10, critPct: 5, aps: 1.45, reqLevel: 1 },
    icon: "/textures/items/ironsworn_hammer.webp",
  },
  // A broadsword model on PoE2's level-1 Shortsword block (poe2db: 6-9, 1.55 APS).
  {
    id: "base.ironsworn_broadsword",
    name: "Ironsworn Broadsword",
    itemClass: "sword",
    w: 1,
    h: 3,
    stats: { physMin: 6, physMax: 9, critPct: 5, aps: 1.55, reqLevel: 1 },
    icon: "/textures/items/broadsword.webp",
  },

  // Stalker, the leather set. No implicit anywhere: PoE2's Dex bases are
  // evasion bases, there is no evasion stat here, and inventing one would open
  // a balance surface for a cosmetic.
  { id: "base.stalker_hood", name: "Stalker Hood", itemClass: "helmet", w: 2, h: 2, icon: "/textures/items/stalker_hood.webp" },
  { id: "base.stalker_leathers", name: "Stalker Leathers", itemClass: "body", w: 2, h: 3, icon: "/textures/items/stalker_leathers.webp" },
  { id: "base.stalker_gloves", name: "Stalker Gloves", itemClass: "gloves", w: 2, h: 2, icon: "/textures/items/stalker_gloves.webp" },
  { id: "base.stalker_boots", name: "Stalker Boots", itemClass: "boots", w: 2, h: 2, icon: "/textures/items/stalker_boots.webp" },
  { id: "base.stalker_strap", name: "Stalker Strap", itemClass: "belt", w: 2, h: 1, icon: "/textures/items/stalker_strap.webp" },
  // Pearlescent Amulet and Sapphire Ring. Jade's Dexterity would be an inert line.
  {
    id: "base.stalker_talisman", name: "Stalker Talisman", itemClass: "amulet", w: 1, h: 1, stats: { reqLevel: 8 },
    implicit: { stat: "allElementalResPct", label: "% to all Elemental Resistances", value: 8 }, icon: "/textures/items/stalker_talisman.webp",
  },
  {
    id: "base.stalker_band", name: "Stalker Band", itemClass: "ring", w: 1, h: 1, stats: { reqLevel: 12 },
    implicit: { stat: "coldResPct", label: "% to Cold Resistance", value: 25 }, icon: "/textures/items/stalker_band.webp",
  },
  { id: "base.stalker_buckler", name: "Stalker Buckler", itemClass: "shield", w: 2, h: 2, icon: "/textures/items/stalker_buckler.webp" },
  {
    id: "base.stalker_bow",
    name: "Stalker Bow",
    itemClass: "bow",
    w: 2,
    h: 4,
    stats: { physMin: 6, physMax: 9, critPct: 5, aps: 1.2, reqLevel: 1 },
    icon: "/textures/items/stalker_bow.webp",
  },

  // Ember, the cloth set, and the only family that carries the two hands: a
  // wand and a focus.
  { id: "base.ember_cowl", name: "Ember Cowl", itemClass: "helmet", w: 2, h: 2, icon: "/textures/items/ember_cowl.webp" },
  {
    id: "base.ember_robe",
    name: "Ember Robe",
    itemClass: "body",
    w: 2,
    h: 3,
    // The Int body implicit, after PoE2's Enlightened Robe.
    implicit: { stat: "manaRegenPct", label: "% increased Mana Regeneration Rate", value: 30 },
    icon: "/textures/items/ember_robe.webp",
  },
  { id: "base.ember_wraps", name: "Ember Wraps", itemClass: "gloves", w: 2, h: 2, icon: "/textures/items/ember_wraps.webp" },
  { id: "base.ember_slippers", name: "Ember Slippers", itemClass: "boots", w: 2, h: 2, icon: "/textures/items/ember_slippers.webp" },
  { id: "base.ember_sash", name: "Ember Sash", itemClass: "belt", w: 2, h: 1, icon: "/textures/items/ember_sash.webp" },
  // Azure Amulet and Lazuli Ring, the two PoE2 pieces with no level requirement.
  {
    id: "base.ember_pendant", name: "Ember Pendant", itemClass: "amulet", w: 1, h: 1,
    implicit: { stat: "manaRegenPct", label: "% increased Mana Regeneration Rate", value: 25 }, icon: "/textures/items/ember_pendant.webp",
  },
  {
    id: "base.ember_loop", name: "Ember Loop", itemClass: "ring", w: 1, h: 1,
    implicit: { stat: "maxMana", label: "to maximum Mana", value: 25 }, icon: "/textures/items/ember_loop.webp",
  },
  {
    id: "base.ember_wand",
    name: "Ember Wand",
    itemClass: "wand",
    w: 1,
    h: 2,
    stats: { physMin: 5, physMax: 10, critPct: 8, aps: 1.2, reqLevel: 8 },
    // PoE2 wand implicits all grant a skill ("Grants Skill: Power Siphon"), which nothing
    // in the sim can honour, so this borrows the implicit of the base whose stat block the
    // wand already copies: PoE1's Goat's Horn, (10-15)% increased Spell Damage. Here
    // the stat scales every skill's hit, attacks too, so every line says "Damage".
    implicit: { stat: "spellDamagePct", label: "% increased Damage", value: 12 },
    icon: "/textures/items/ember_wand.webp",
  },
  // PoE2's Withered Wand asks nothing of its wielder; this is the wand a new
  // Emberbound can hold, and the Ember Wand above is what replaces it.
  {
    id: "base.ember_kindling_wand",
    name: "Kindling Wand",
    itemClass: "wand",
    w: 1,
    h: 2,
    stats: { physMin: 3, physMax: 6, critPct: 7, aps: 1.4, reqLevel: 1 },
    implicit: { stat: "spellDamagePct", label: "% increased Damage", value: 6 },
    icon: "/textures/items/ember_kindling_wand.webp",
  },
  // Foci carry no implicit: poe2db lists them with energy shield alone.
  { id: "base.ember_focus", name: "Ember Focus", itemClass: "focus", w: 2, h: 2, icon: "/textures/items/ember_focus.webp" },
];

/**
 * The body armour each class is created wearing.
 *
 * These are ordinary drops, unlike the currency and the waystone: a slot whose
 * base can never drop is a slot the player can never improve, and `Cinderveil`
 * is a unique body armour that needs a body base in the pool to roll onto.
 */
const STARTER_BODY_IDS = ["base.ironsworn_plate", "base.stalker_leathers", "base.ember_robe"] as const;

/** The starter bodies, so the class table can be checked against real content. */
export const STARTER_BASE_IDS: readonly string[] = STARTER_BODY_IDS;

/**
 * Base ids that content has since renamed. A saved inventory outlives the id it was
 * written with, and `baseOf` throwing on load would cost the player the whole stash
 * over a rename (docs/09: a save that corrupts destroys more than any drop created).
 */
const RENAMED_BASES: Record<string, string> = {
  "base.wisdom_scroll": "currency.wisdom",
  // The 2026-09 pass that cut every base down to one family per class.
  "base.cinder_cap": "base.ironsworn_helm",
  "base.ember_gauntlets": "base.ironsworn_gauntlets",
  "base.ashen_treads": "base.ironsworn_sabatons",
  "base.ashwall_tower_shield": "base.ironsworn_tower_shield",
  "base.ember_buckler": "base.stalker_buckler",
  "base.cinderchain_sash": "base.ember_sash",
  "base.emberbound_robe": "base.ember_robe",
  "base.emberweave_robe": "base.ember_robe",
  "base.emberwand": "base.ember_wand",
  "base.ashen_focus": "base.ember_focus",
};

/**
 * Currency is an item everywhere it matters (it lies on the ground, it sits in the
 * grid, `baseOf` resolves it) but it is not a droppable *equipment* base, so it stays
 * out of `ITEM_POOLS.bases` and rollItem can never hand one out as gear. Ids match the
 * transition table in `@exiled/rules` so a base id is all the sim has to carry.
 */
const CURRENCY_BASES: ItemBase[] = [
  { id: "currency.wisdom", name: "Scroll of Wisdom", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/wisdom_scroll.webp" },
  { id: "currency.transmutation", name: "Orb of Transmutation", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_transmutation.webp" },
  { id: "currency.augmentation", name: "Orb of Augmentation", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_augmentation.webp" },
  { id: "currency.elevation", name: "Orb of Elevation", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_elevation.webp" },
  { id: "currency.alchemy", name: "Orb of Alchemy", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_alchemy.webp" },
  { id: "currency.embers", name: "Orb of Embers", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/orb_embers.webp" },
  { id: "currency.portal", name: "Portal Scroll", itemClass: "currency", w: 1, h: 1, icon: "/textures/items/portal_scroll.webp" },
];

export const WISDOM_SCROLL_BASE_ID = "currency.wisdom";

/**
 * The scroll that opens a way home from where you are standing.
 *
 * Deliberately NOT in `CURRENCY_DROPS`: the drop table hands out a fixed number of
 * currency items per kill, so anything added to it is taken out of something else,
 * and what it would have taken from is the reveal economy the band in
 * `death.test.ts` exists to hold. It is stocked by the disenchanter instead
 * (simulation/vendor.ts), which is also where PoE gets its scrolls, and which
 * finally gives gold something to be for.
 */
export const PORTAL_SCROLL_BASE_ID = "currency.portal";

export function isPortalScroll(item: Item): boolean {
  return item.baseId === PORTAL_SCROLL_BASE_ID;
}

/**
 * The waystone, on the same footing as currency: a 1x1 grid item that is not
 * droppable *gear*, so it stays out of `ITEM_POOLS.bases` and `rollItem` can
 * never hand one out. Its mods do NOT come from the affix pool — they come from
 * `waystoneMods(seed)` in `@exiled/rules`, which is what every monster-scaling
 * call site already reads, so the stone carries its seed and tier on the item
 * (`Item.waystone`) rather than being re-rolled as affixes.
 */
export const WAYSTONE_BASE_ID = "map.waystone";

const WAYSTONE_BASE: ItemBase = {
  id: WAYSTONE_BASE_ID, name: "Waystone", itemClass: "waystone", w: 1, h: 1,
  icon: "/textures/ui/waystone_icon_v1.webp",
};

/** One waystone, as it drops and as it sits in the grid. */
export function waystoneItem(seed: number, tier: number): Item {
  return { baseId: WAYSTONE_BASE_ID, rarity: "normal", itemLevel: 1, affixes: [], waystone: { seed, tier } };
}

/**
 * The stone every character always owns, and the reason nobody can be locked
 * out of the game.
 *
 * Stones are spent to open a map and only come back off a dead map boss, so a
 * run abandoned on the last one used to end the character: no vendor sells
 * them, no recipe makes them, and the device has nothing to offer. This one is
 * never consumed, so the bottom rung of the Atlas is always open.
 *
 * It is deliberately the *worst* stone in the game and stays that way. Seed 0
 * is not a placeholder: `waystoneRarity(0)` is normal and `waystoneMods(0)` is
 * empty, so it is a white Tier 1 with no modifiers — the least experience, the
 * least quantity, and `waystoneDrops` hands back exactly one stone for a
 * modless run. Currency cannot touch it either. Nothing about it competes with
 * a stone the Atlas actually paid out, which is what keeps it a floor rather
 * than a reward: `docs/09-reward-psychology.md` is about the spike on the way
 * up, and every stone worth wanting is still earned.
 */
export function permanentWaystone(): Item {
  return {
    baseId: WAYSTONE_BASE_ID, rarity: "normal", itemLevel: 1, affixes: [],
    waystone: { seed: 0, tier: 1, permanent: true },
  };
}

export function isPermanentWaystone(item: Item): boolean {
  return item.waystone?.permanent === true;
}

export function isWaystone(item: Item): boolean {
  return item.baseId === WAYSTONE_BASE_ID;
}

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
 *
 * The scroll is by far the most common drop, because the drop table pays for most of
 * the reveal economy on its own: PoE1's stacks and Scroll Fragments are not built.
 * The vendor sells it too (simulation/vendor.ts), so the drops only need to reach
 * about break-even. The guard is `death.test.ts` "pays out roughly one scroll per
 * unidentified item it drops".
 */
export const CURRENCY_DROPS: readonly { baseId: string; weight: number }[] = [
  { baseId: "currency.wisdom", weight: 250 },
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
// "Critical Strike Chance" to match reference-screenshots/item-rare.png and the base-stat block.
//
// itemClasses is PoE's per-class mod pool: armour never rolls on a caster weapon, cast
// speed never on a chest. Resistances, attributes and mana regeneration name no class and
// so roll everywhere. Each class keeps four eligible prefixes and four suffixes at item
// level 1, which is what lets a rare of any base fill its 3+3 at any level; gating a pool
// that was wide only in total would have starved whichever class lost the coin flip.
const AFFIXES: Affix[] = [
  { id: "affix.life", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 40, itemClasses: ["shield", "helmet", "body", "gloves", "boots", "belt", "amulet", "ring"] },
  { id: "affix.mana", kind: "prefix", nameWord: "Beryl", stat: "maxMana", label: "to maximum Mana", minItemLevel: 1, min: 4, max: 30, itemClasses: ["shield", "wand", "focus", "helmet", "body", "gloves", "boots", "belt", "amulet", "ring"] },
  { id: "affix.energy_shield", kind: "prefix", nameWord: "Ghostly", stat: "energyShield", label: "to maximum Energy Shield", minItemLevel: 1, min: 5, max: 35, itemClasses: ["shield", "focus", "helmet", "body", "gloves", "boots", "amulet"] },
  { id: "affix.increased_armour", kind: "prefix", nameWord: "Reinforced", stat: "armourPct", label: "% increased Armour", minItemLevel: 1, min: 10, max: 30, itemClasses: ["shield", "helmet", "body", "gloves", "boots", "belt", "amulet"] },
  { id: "affix.spell_damage", kind: "prefix", nameWord: "Runic", stat: "spellDamagePct", label: "% increased Damage", minItemLevel: 1, min: 10, max: 25, itemClasses: ["wand", "focus", "amulet"] },
  { id: "affix.fire_dmg", kind: "prefix", nameWord: "Smoldering", stat: "fireDamage", label: "to Fire Damage", minItemLevel: 1, min: 2, max: 18, itemClasses: ["wand", "focus", "mace", "sword", "bow"] },
  { id: "affix.cold_dmg", kind: "prefix", nameWord: "Glacial", stat: "coldDamage", label: "to Cold Damage", minItemLevel: 1, min: 2, max: 16, itemClasses: ["wand", "focus", "mace", "sword", "bow"] },
  { id: "affix.armour", kind: "prefix", nameWord: "Plated", stat: "armour", label: "to Armour", minItemLevel: 8, min: 10, max: 60, itemClasses: ["shield", "helmet", "body", "gloves", "boots", "belt"] },
  { id: "affix.increased_es", kind: "prefix", nameWord: "Spectral", stat: "energyShieldPct", label: "% increased Energy Shield", minItemLevel: 8, min: 10, max: 30, itemClasses: ["shield", "focus", "helmet", "body", "gloves", "boots", "amulet"] },
  { id: "affix.fire_res", kind: "suffix", nameWord: "of the Furnace", stat: "fireResPct", label: "% to Fire Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.cold_res", kind: "suffix", nameWord: "of the Yeti", stat: "coldResPct", label: "% to Cold Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.lightning_res", kind: "suffix", nameWord: "of the Squall", stat: "lightningResPct", label: "% to Lightning Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.strength", kind: "suffix", nameWord: "of the Brute", stat: "strength", label: "to Strength", minItemLevel: 1, min: 5, max: 20 },
  { id: "affix.mana_regen", kind: "suffix", nameWord: "of the Spring", stat: "manaRegenPct", label: "% increased Mana Regeneration Rate", minItemLevel: 4, min: 10, max: 35 },
  { id: "affix.crit_chance", kind: "suffix", nameWord: "of Menace", stat: "critChancePct", label: "% increased Critical Strike Chance", minItemLevel: 8, min: 8, max: 25, itemClasses: ["wand", "focus", "mace", "sword", "bow", "amulet"] },
  { id: "affix.cast_speed", kind: "suffix", nameWord: "of Casting", stat: "castSpeedPct", label: "% increased Cast Speed", minItemLevel: 12, min: 3, max: 12, itemClasses: ["wand", "focus", "amulet", "ring"] },
  { id: "affix.chaos_res", kind: "suffix", nameWord: "of the Outcast", stat: "chaosResPct", label: "% to Chaos Resistance", minItemLevel: 15, min: 4, max: 15 },
  // The attack weapons' own prefixes, appended so no earlier roll moves.
  { id: "affix.added_phys", kind: "prefix", nameWord: "Honed", stat: "physicalDamage", label: "to Physical Damage", minItemLevel: 1, min: 1, max: 12, itemClasses: ["mace", "sword", "bow"] },
  { id: "affix.phys_dmg_pct", kind: "prefix", nameWord: "Weighted", stat: "physicalDamagePct", label: "% increased Physical Damage", minItemLevel: 1, min: 15, max: 40, itemClasses: ["mace", "sword", "bow"] },
  // PoE2's ring prefixes, global: every attack takes them, whatever is in hand.
  { id: "affix.attack_fire", kind: "prefix", nameWord: "Heated", stat: "attackFireDamage", label: "Fire Damage to Attacks", minItemLevel: 1, min: 1, max: 9, itemClasses: ["ring"] },
  { id: "affix.attack_cold", kind: "prefix", nameWord: "Frosted", stat: "attackColdDamage", label: "Cold Damage to Attacks", minItemLevel: 1, min: 1, max: 8, itemClasses: ["ring"] },
];

// Named items bound to one base each. Mod ranges are the unique's own and deliberately
// beat the shared affix pool's ranges; flavour is the italic orange line in the tooltip
// (reference-screenshots/item-unique.png).
const UNIQUES: UniqueItem[] = [
  {
    id: "unique.ashmaw",
    name: "Ashmaw",
    baseId: "base.ember_wand",
    flavour: "It was a torch, once, before the ash learned to bite.",
    icon: "/textures/items/unique_ashmaw.webp",
    mods: [
      { affixId: "affix.fire_dmg", min: 22, max: 34 },
      { affixId: "affix.cast_speed", min: 14, max: 20 },
      { affixId: "affix.mana", min: 20, max: 30 },
    ],
  },
  {
    id: "unique.emberchoir",
    name: "Emberchoir",
    baseId: "base.ember_focus",
    flavour: "Every voice it kept is a voice that burned.",
    icon: "/textures/items/unique_emberchoir.webp",
    mods: [
      { affixId: "affix.fire_res", min: 30, max: 45 },
      { affixId: "affix.mana", min: 35, max: 50 },
      { affixId: "affix.life", min: 10, max: 20 },
    ],
  },
  {
    id: "unique.cinderveil",
    name: "Cinderveil",
    baseId: "base.ember_robe",
    flavour: "The fire spared her. Nothing else did.",
    icon: "/textures/items/unique_cinderveil.webp",
    mods: [
      { affixId: "affix.life", min: 45, max: 70 },
      { affixId: "affix.armour", min: 70, max: 110 },
      { affixId: "affix.fire_res", min: 20, max: 30 },
    ],
  },
  // Ironsworn and Stalker mirror Ember's three: the weapon, the off-hand, the body, so
  // no class family has fewer uniques to find than another.
  {
    id: "unique.oathbreaker",
    name: "Oathbreaker",
    baseId: "base.ironsworn_hammer",
    flavour: "Every vow it kept, it kept by force.",
    icon: "/textures/items/unique_oathbreaker.webp",
    mods: [
      { affixId: "affix.added_phys", min: 12, max: 18 },
      { affixId: "affix.phys_dmg_pct", min: 45, max: 60 },
      { affixId: "affix.strength", min: 20, max: 30 },
    ],
  },
  {
    id: "unique.gravewall",
    name: "Gravewall",
    baseId: "base.ironsworn_tower_shield",
    flavour: "They buried the town behind it. The wall held.",
    icon: "/textures/items/unique_gravewall.webp",
    mods: [
      { affixId: "affix.life", min: 40, max: 60 },
      { affixId: "affix.armour", min: 70, max: 110 },
      { affixId: "affix.lightning_res", min: 25, max: 35 },
    ],
  },
  {
    id: "unique.anvilheart",
    name: "Anvilheart",
    baseId: "base.ironsworn_plate",
    flavour: "Struck a thousand times, it only grew harder.",
    icon: "/textures/items/unique_anvilheart.webp",
    mods: [
      { affixId: "affix.life", min: 50, max: 75 },
      { affixId: "affix.increased_armour", min: 35, max: 50 },
      { affixId: "affix.chaos_res", min: 15, max: 25 },
    ],
  },
  {
    id: "unique.quietus",
    name: "Quietus",
    baseId: "base.stalker_bow",
    flavour: "The last thing the herd heard was nothing.",
    icon: "/textures/items/unique_quietus.webp",
    mods: [
      { affixId: "affix.phys_dmg_pct", min: 40, max: 55 },
      { affixId: "affix.crit_chance", min: 28, max: 40 },
      { affixId: "affix.cold_dmg", min: 14, max: 22 },
    ],
  },
  {
    id: "unique.thornward",
    name: "Thornward",
    baseId: "base.stalker_buckler",
    flavour: "A hunter's second skin is patience.",
    icon: "/textures/items/unique_thornward.webp",
    mods: [
      { affixId: "affix.life", min: 30, max: 45 },
      { affixId: "affix.cold_res", min: 30, max: 40 },
      { affixId: "affix.lightning_res", min: 20, max: 30 },
    ],
  },
  {
    id: "unique.mossback",
    name: "Mossback",
    baseId: "base.stalker_leathers",
    flavour: "It smells of rain, and of the thing that waited in it.",
    icon: "/textures/items/unique_mossback.webp",
    mods: [
      { affixId: "affix.life", min: 45, max: 65 },
      { affixId: "affix.cold_res", min: 20, max: 30 },
      { affixId: "affix.chaos_res", min: 15, max: 25 },
    ],
  },
];

// Validate at module load; bad content is a programmer error, fail fast.
for (const b of [...ITEM_BASES, ...CURRENCY_BASES, WAYSTONE_BASE]) {
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

const BASE_BY_ID = new Map([...ITEM_BASES, ...CURRENCY_BASES, WAYSTONE_BASE].map((b) => [b.id, b]));
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
  if (base.stats?.armour) mods.push({ stat: "armour", value: base.stats.armour });
  if (base.implicit) mods.push({ stat: base.implicit.stat, value: base.implicit.value });
  for (const ia of item.affixes) {
    const a = AFFIX_BY_ID.get(ia.affixId);
    if (a) mods.push({ stat: a.stat, value: ia.value });
  }
  return mods;
}

/** A weapon as its attack reads it: PoE's local values, after the weapon's own mods. */
export interface WeaponDamage {
  physMin: number;
  physMax: number;
  fire: number;
  cold: number;
  critPct: number;
  aps: number;
  /** True when a local mod moved any number off the base block (PoE draws it blue). */
  modified: boolean;
}

/** The item classes an attack swings or looses. A wand's or focus's elemental damage is its spells'. */
export const ATTACK_WEAPON_CLASSES: ReadonlySet<string> = new Set(["mace", "sword", "bow"]);

/**
 * What an attack uses with weapon1 empty: PoE1's unarmed 2-6 at 1.2 attacks per
 * second, and the 5% base crit spec 03 gives an unarmed attack.
 */
export const UNARMED: WeaponDamage = { physMin: 2, physMax: 6, fire: 0, cold: 0, critPct: 5, aps: 1.2, modified: false };

/**
 * Local weapon damage (docs/02 "Local and global values"): (base + local added)
 * * (100 + local increased) / 100, each end truncated, so the tooltip range is
 * exactly what the sim divides by. Only this item's own mods count.
 */
export function weaponDamage(item: Item | undefined): WeaponDamage {
  if (!item) return UNARMED;
  const s = baseOf(item.baseId).stats;
  let added = 0;
  let inc = 0;
  let fire = 0;
  let cold = 0;
  for (const ia of item.affixes) {
    const stat = AFFIX_BY_ID.get(ia.affixId)?.stat;
    if (stat === "physicalDamage") added += ia.value;
    else if (stat === "physicalDamagePct") inc += ia.value;
    else if (stat === "fireDamage") fire += ia.value;
    else if (stat === "coldDamage") cold += ia.value;
  }
  if (!ATTACK_WEAPON_CLASSES.has(baseOf(item.baseId).itemClass)) {
    fire = 0;
    cold = 0;
  }
  const local = (v: number) => Math.trunc(((v + added) * (100 + inc)) / 100);
  const physMin = local(s?.physMin ?? 0);
  const physMax = local(s?.physMax ?? 0);
  return {
    physMin, physMax, fire, cold,
    critPct: s?.critPct ?? 0,
    aps: s?.aps ?? 0,
    modified: physMin !== (s?.physMin ?? 0) || physMax !== (s?.physMax ?? 0) || fire > 0 || cold > 0,
  };
}

/** Flat fire and cold a wand or focus adds to spells. Attack weapons give none: theirs is local. */
export function spellAddedDamage(items: readonly (Item | undefined)[]): { fire: number; cold: number } {
  const out = { fire: 0, cold: 0 };
  for (const item of items) {
    if (!item) continue;
    const cls = baseOf(item.baseId).itemClass;
    if (cls !== "wand" && cls !== "focus") continue;
    for (const ia of item.affixes) {
      const stat = AFFIX_BY_ID.get(ia.affixId)?.stat;
      if (stat === "fireDamage") out.fire += ia.value;
      else if (stat === "coldDamage") out.cold += ia.value;
    }
  }
  return out;
}

/** Flat fire and cold every attack takes from worn gear (a ring's prefixes), whatever is in hand. */
export function attackAddedDamage(items: readonly (Item | undefined)[]): { fire: number; cold: number } {
  const out = { fire: 0, cold: 0 };
  for (const item of items) {
    for (const ia of item?.affixes ?? []) {
      const stat = AFFIX_BY_ID.get(ia.affixId)?.stat;
      if (stat === "attackFireDamage") out.fire += ia.value;
      else if (stat === "attackColdDamage") out.cold += ia.value;
    }
  }
  return out;
}

// Render-ready projection: base name + one line per committed affix roll.
export interface ItemDescription {
  /** Display name: the item's generated name (rare/unique) or the base name. */
  name: string;
  /** Base type, always the base name, shown under a generated name for rares. */
  baseName: string;
  rarity: Rarity;
  itemClass: string;
  /** base-stat lines rendered "label: value" (empty for bases without stats); augmented = moved by a local mod */
  statLines: { label: string; value: string; augmented?: true }[];
  reqLevel?: number;
  reqAttrValue?: number;
  reqAttr?: string;
  /** the base's fixed implicit, rendered above the affix lines; absent for bases without one */
  implicit?: string;
  /** affix lines */
  lines: string[];
  /** unique only: italic flavour line below the mods. */
  flavour?: string;
  /** Consumables only: PoE's grey usage line closing the tooltip. */
  help?: string;
  /** Inventory art from the base; absent means the UI falls back to the name. */
  icon?: string;
  /** True while the item is unread: name, mods and flavour are withheld above. */
  unidentified?: boolean;
  /** Waystone only: what the socket and the ACTIVATE gate need from the stone. */
  waystone?: { seed: number; tier: number; permanent?: boolean };
}

/**
 * Affix line exactly as reference-screenshots/item-*.png renders it: a percent label
 * hugs its number ("13% to Fire Resistance", not "13 % ..."), and increased/reduced
 * mods carry no sign, while flat and resistance mods do ("+9 to maximum Life").
 */
function affixLine(value: number, label: string): string {
  const pct = label.startsWith("%");
  const signed = !/^% (increased|reduced)\b/.test(label);
  return `${signed ? "+" : ""}${value}${pct ? "" : " "}${label}`;
}

const applyHelp = (target: string) => `Right click this item then left click ${target} to apply it.`;

/**
 * What each currency does and how it is spent, in poe2db.tw's wording where PoE2
 * has the same orb (Elevation is its Regal, Embers its Exalted). A consumable
 * nobody can work out how to spend is one that sits in the bag forever.
 */
const CURRENCY_TEXT: Record<string, { line: string; help: string }> = {
  [WISDOM_SCROLL_BASE_ID]: { line: "Identifies an item", help: applyHelp("an unidentified item") },
  "currency.transmutation": { line: "Upgrades a Normal item to a Magic item with 1 modifier", help: applyHelp("a normal item") },
  "currency.augmentation": { line: "Augments a Magic item with a new random modifier", help: applyHelp("a magic item") },
  "currency.elevation": { line: "Upgrades a Magic item to a Rare item, adding 1 modifier", help: applyHelp("a magic item") },
  "currency.alchemy": { line: "Upgrades a Normal or Magic item to a Rare item with 4 random modifiers", help: applyHelp("a normal or magic item") },
  "currency.embers": { line: "Augments a Rare item with a new random modifier", help: applyHelp("a rare item") },
  // No key named: the portal key is rebindable (settings.ts), the right click is not.
  [PORTAL_SCROLL_BASE_ID]: { line: "Creates a portal to your hideout", help: "Right click on this item to use it. Only works inside a map." },
};

const WAYSTONE_HELP = "Can be used in a Map Device, allowing you to enter a Map.";

export function describeItem(item: Item): ItemDescription {
  const base = baseOf(item.baseId);
  // A waystone reads nothing like gear: its rarity and its mods are both derived
  // from the seed by `@exiled/rules`, which is also what scales the monsters, so
  // rendering them from anywhere else would let the tooltip drift off the map.
  if (item.waystone) {
    const { seed, tier } = item.waystone;
    // PoE2's base type is the tiered name itself, so it is never a second "Waystone" line.
    const name = `${base.name} (Tier ${tier})`;
    return {
      rarity: waystoneRarity(seed),
      name,
      baseName: name,
      itemClass: base.itemClass,
      // The permanent stone says so on the item, or the one rule that makes it
      // different from the white stone beside it is invisible.
      lines: item.waystone.permanent
        ? ["Not consumed on use", "Cannot be modified"]
        : waystoneMods(seed).map((m) => m.label),
      statLines: [{ label: "Waystone Tier", value: String(tier) }, { label: "Area Level", value: String(areaLevel(tier)) }],
      help: item.waystone.permanent ? WAYSTONE_HELP : `${WAYSTONE_HELP} Waystones can only be used once.`,
      icon: base.icon,
      waystone: { seed, tier },
    };
  }
  const s = base.stats;
  const statLines: { label: string; value: string; augmented?: true }[] = [];
  if (s?.physMin !== undefined && s.physMax !== undefined) {
    // The range the attack uses, after the weapon's local mods; an unread item hides them.
    const w = item.unidentified === true ? undefined : weaponDamage(item);
    if (w && (w.physMin !== s.physMin || w.physMax !== s.physMax)) {
      statLines.push({ label: "Physical Damage", value: `${w.physMin}-${w.physMax}`, augmented: true });
    } else {
      statLines.push({ label: "Physical Damage", value: `${s.physMin}-${s.physMax}` });
    }
    if (w?.fire) statLines.push({ label: "Fire Damage", value: String(w.fire), augmented: true });
    if (w?.cold) statLines.push({ label: "Cold Damage", value: String(w.cold), augmented: true });
  }
  if (s?.critPct !== undefined) statLines.push({ label: "Critical Strike Chance", value: `${s.critPct.toFixed(2)}%` });
  if (s?.aps !== undefined) statLines.push({ label: "Attacks per Second", value: s.aps.toFixed(2) });
  if (s?.armour !== undefined) statLines.push({ label: "Armour", value: String(s.armour) });
  // An unidentified item is a shape, not a promise: its rolled name and mods stay
  // hidden until a Scroll of Wisdom reads them. The base, its stats and its implicit
  // are visible either way, exactly as PoE shows an unread drop.
  const currency = CURRENCY_TEXT[canonicalBaseId(item.baseId)];
  const lines = currency ? [currency.line]
    : (item.unidentified === true ? [] : item.affixes.map((ia) => {
      const a = AFFIX_BY_ID.get(ia.affixId);
      return a ? affixLine(ia.value, a.label) : `+${ia.value} ${ia.affixId}`;
    }));
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
  if (currency) d.help = currency.help;
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
