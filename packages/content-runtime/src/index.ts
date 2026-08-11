export const CONTENT_VERSION = "slice1.v1";
export { SKILLS, TOWN_PORTAL_SKILL, DEFAULT_ATTACK_BY_CLASS, defaultAttackFor, FREE_ATTACKS } from "./skills.js";
export { MONSTERS, RARE_TEMPLATES, rareTemplate, MONSTER_POOLS, PACK_COUNT, pickPack, BOSSES, bossFor } from "./monsters.js";
export { BIOMES, MAP_BASES, mapBase, biomeOf } from "./maps.js";
export { CLASSES, CLASS_LIST, characterClass } from "./classes.js";
export { HIDEOUT_DECOR, SCREEN_SQUARE, hideoutFootprints, type Decor, type DecorKind } from "./hideout.js";
export {
  ITEM_POOLS, baseOf, describeItem, itemStatMods, wisdomScroll, currencyItem, isCurrency,
  WISDOM_SCROLL_BASE_ID, PORTAL_SCROLL_BASE_ID, isPortalScroll, CURRENCY_DROPS, currencyForRoll, canonicalBaseId,
  WAYSTONE_BASE_ID, waystoneItem, isWaystone, permanentWaystone, isPermanentWaystone, STARTER_BASE_IDS,
} from "./items.js";
