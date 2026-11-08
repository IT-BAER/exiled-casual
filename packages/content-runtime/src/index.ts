export const CONTENT_VERSION = "slice1.v1";
export { SKILLS, TOWN_PORTAL_SKILL, DEFAULT_ATTACK_BY_CLASS, defaultAttackFor, FREE_ATTACKS, UTILITY_SKILLS } from "./skills.js";
export { MONSTERS, RARE_TEMPLATES, rareTemplate, HARD_RARE_MODIFIERS, hardRareModifier, MONSTER_POOLS, PACK_COUNT, killSharePct, pickPack, BOSSES, bossFor } from "./monsters.js";
export { BIOMES, MAP_BASES, mapBase, biomeOf } from "./maps.js";
export { CLASSES, CLASS_LIST, characterClass } from "./classes.js";
export {
  HIDEOUT_DECOR, HIDEOUT_FLOOR, HIDEOUT_SERVICES, HIDEOUT_SERVICE_IDS, SCREEN_SQUARE, ROT_STEP,
  hideoutFootprints, decorDiscs, decorById, rotTrig, yawToRot, onHideoutFloorWorld,
  type Decor, type DecorKind, type DecorExtra, type DecorExtraKind, type HideoutServiceId, type PiecePlacement,
} from "./hideout.js";
export {
  ITEM_POOLS, UNIQUE_MODS, type UniqueMod, baseOf, describeItem, itemStatMods, wisdomScroll, currencyItem, isCurrency,
  WISDOM_SCROLL_BASE_ID, PORTAL_SCROLL_BASE_ID, isPortalScroll, CURRENCY_DROPS, currencyForRoll, canonicalBaseId, uniqueBaseId,
  WAYSTONE_BASE_ID, waystoneItem, isWaystone, permanentWaystone, isPermanentWaystone, STARTER_BASE_IDS,
  weaponDamage, spellAddedDamage, attackAddedDamage, UNARMED, ATTACK_WEAPON_CLASSES, type WeaponDamage,
} from "./items.js";
