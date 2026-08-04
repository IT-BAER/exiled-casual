import type { Fixed } from "@exiled/fixed-point";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The elemental damage types, in sheet order. Both PoE1 and PoE2 group fire,
 * cold and lightning as "elemental" and keep chaos apart; the sheet shows all
 * four as resistances, so one list drives resistances, the sheet grid and the
 * validators.
 */
export const ELEMENTS = ["fire", "cold", "lightning", "chaos"] as const;
export type Element = (typeof ELEMENTS)[number];

export type DamageType = Element | "physical";

/** One resistance per element, integer percent. Uncapped; RES_CAP applies on use. */
export type ResBlock = Record<Element, number>;

/** A ResBlock with the named elements set and the rest at zero. */
export function resBlock(partial: Partial<ResBlock> = {}): ResBlock {
  return {
    fire: partial.fire ?? 0,
    cold: partial.cold ?? 0,
    lightning: partial.lightning ?? 0,
    chaos: partial.chaos ?? 0,
  };
}

export interface Defenses {
  resPct: ResBlock;
  armourFixed: Fixed;
}

export interface DamageSpec {
  type: DamageType;
  amountFixed: Fixed;
}

export interface AilmentSpec {
  kind: "burning";
  stacksPerApply: number;
  dpsFixed: Fixed;
  durationTicks: number;
  maxStacks: number;
}

export type EffectNode =
  | {
      type: "spawnProjectile";
      speedPerSecFixed: Fixed;
      radiusFixed: Fixed;
      maxRangeFixed: Fixed;
      damage: DamageSpec;
    }
  | {
      type: "spawnGroundArea";
      radiusFixed: Fixed;
      durationTicks: number;
      ailment: AilmentSpec;
    }
  /**
   * A swing that lands the moment it is cast: no entity, no travel, no tick of
   * flight. Everything within `reachFixed` and inside an `arcDegrees` wedge
   * centred on the aim is hit at once, which is why this is the one effect that
   * can hit several targets and the projectile cannot.
   */
  | {
      type: "meleeStrike";
      reachFixed: Fixed;
      /** Full width of the wedge, not the half-angle. 360 hits all round. */
      arcDegrees: number;
      damage: DamageSpec;
    }
  | { type: "teleport"; distanceFixed: Fixed };

export interface SkillDef {
  id: string;
  name: string;
  /** Prose for the tooltip's white block. Authored, never derived from effects. */
  description?: string;
  manaCostFixed: Fixed;
  cooldownTicks: number;
  /** Post-cast movement recovery, in ticks. Omitted/0 = instant, no slow. */
  castTicks?: number;
  /** The skill's own critical strike chance, whole percent. Omitted/0 = never crits. */
  critChancePct?: number;
  effects: EffectNode[];
}

export interface RareModifier {
  lifeMulPct: number;
  moveSpeedMulPct: number;
  damageMulPct: number;
  /**
   * The rare's elemental theme, PoE's way of making one pack demand a different
   * defence: the monster's attack converts to this element and it resists that
   * element by addedResPct. "fire" leaves a fire-themed rare on the element the
   * base already used.
   */
  element: Element;
  addedResPct: number;
  /** Prefixed to the base name, e.g. "Storm-Touched Cinder Imp". */
  namePrefix: string;
}

/**
 * What a monster asks of the player. The number of an archetype is a statement
 * about the monster, so the archetype and not the layout decides how many stand
 * at a socket (see PACK_COUNT in content-runtime).
 *
 * `swarm` punishes fighting one at a time, `brute` punishes trading hits,
 * `shooter` punishes standing still, `heavy` punishes standing close.
 */
export const MONSTER_ARCHETYPES = ["swarm", "brute", "shooter", "heavy"] as const;
export type MonsterArchetype = (typeof MONSTER_ARCHETYPES)[number];

/**
 * A wind-up, a radius, a hit. Extracted verbatim from what BossSpec.slam already
 * was: the boss's slam and a heavy's slam are the same five numbers and must not
 * become two types that drift apart.
 */
export interface SlamSpec {
  windupTicks: number;
  radiusFixed: Fixed;
  damageFixed: Fixed;
  cooldownTicks: number;
  rangeFixed: Fixed;
}

/** A shooter's bolt. `speedFixed` is per second; the sim divides by 30, as it does for moveSpeed. */
export interface RangedSpec {
  speedFixed: Fixed;
  radiusFixed: Fixed;
}

export interface BossSpec {
  phase2AtLifePct: number;
  slam: SlamSpec;
  phase2: {
    fireGroundDurationTicks: number;
    addCount: number;
    addDefId: string;
    cadenceMulPct: number;
    /** Burning patch the phase-2 slam leaves; fireGroundDurationTicks is its lifetime. */
    fireGround: AilmentSpec;
  };
}

export interface MonsterDef {
  id: string;
  name: string;
  maxLifeFixed: Fixed;
  moveSpeedFixed: Fixed;
  attackRangeFixed: Fixed;
  attackDamage: DamageSpec;
  attackCooldownTicks: number;
  radiusFixed: Fixed;
  defenses: Defenses;
  archetype: MonsterArchetype;
  /** Required iff archetype === "shooter", forbidden otherwise. */
  ranged?: RangedSpec;
  /** Required iff archetype === "heavy", forbidden otherwise. Distinct from
   *  BossSpec.slam: `boss` being present is what makes a monster a boss. */
  heavy?: SlamSpec;
  boss?: BossSpec;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ── Validators ────────────────────────────────────────────────────────────────

export const ID_PATTERN: RegExp = /^(skill|monster)\.[a-z0-9_]+\.v\d+$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function validateDamageSpec(v: unknown, path: string, errors: string[]): boolean {
  if (!isObj(v)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  let ok = true;
  if (v["type"] !== "physical" && !ELEMENTS.includes(v["type"] as Element)) {
    errors.push(`${path}.type: must be "physical" or one of ${ELEMENTS.join(", ")}`);
    ok = false;
  }
  if (!isNonNegInt(v["amountFixed"])) {
    errors.push(`${path}.amountFixed: must be a non-negative integer`);
    ok = false;
  }
  return ok;
}

function validateAilmentSpec(v: unknown, path: string, errors: string[]): boolean {
  if (!isObj(v)) {
    errors.push(`${path}: required object`);
    return false;
  }
  let ok = true;
  if (v["kind"] !== "burning") {
    errors.push(`${path}.kind: must be "burning"`);
    ok = false;
  }
  if (!isNonNegInt(v["stacksPerApply"])) {
    errors.push(`${path}.stacksPerApply: must be non-negative integer`);
    ok = false;
  }
  if (!isNonNegInt(v["dpsFixed"])) {
    errors.push(`${path}.dpsFixed: must be a non-negative integer`);
    ok = false;
  }
  if (!isNonNegInt(v["durationTicks"])) {
    errors.push(`${path}.durationTicks: must be non-negative integer`);
    ok = false;
  }
  if (!isNonNegInt(v["maxStacks"])) {
    errors.push(`${path}.maxStacks: must be non-negative integer`);
    ok = false;
  }
  return ok;
}

function validateEffectNode(v: unknown, idx: number, errors: string[]): boolean {
  const path = `effects[${idx}]`;
  if (!isObj(v)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  let ok = true;
  const type = v["type"];
  if (type === "spawnProjectile") {
    if (!isNonNegInt(v["speedPerSecFixed"])) {
      errors.push(`${path}.speedPerSecFixed: must be a non-negative integer`);
      ok = false;
    }
    if (!isNonNegInt(v["radiusFixed"])) {
      errors.push(`${path}.radiusFixed: must be a non-negative integer`);
      ok = false;
    }
    if (!isNonNegInt(v["maxRangeFixed"])) {
      errors.push(`${path}.maxRangeFixed: must be a non-negative integer`);
      ok = false;
    }
    if (!validateDamageSpec(v["damage"], `${path}.damage`, errors)) ok = false;
  } else if (type === "spawnGroundArea") {
    if (!isNonNegInt(v["radiusFixed"])) {
      errors.push(`${path}.radiusFixed: must be a non-negative integer`);
      ok = false;
    }
    if (!isNonNegInt(v["durationTicks"])) {
      errors.push(`${path}.durationTicks: must be a non-negative integer`);
      ok = false;
    }
    if (!validateAilmentSpec(v["ailment"], `${path}.ailment`, errors)) ok = false;
  } else if (type === "meleeStrike") {
    if (!isNonNegInt(v["reachFixed"])) {
      errors.push(`${path}.reachFixed: must be a non-negative integer`);
      ok = false;
    }
    const arc = v["arcDegrees"];
    if (typeof arc !== "number" || !Number.isFinite(arc) || arc <= 0 || arc > 360) {
      errors.push(`${path}.arcDegrees: must be a number in (0, 360]`);
      ok = false;
    }
    if (!validateDamageSpec(v["damage"], `${path}.damage`, errors)) ok = false;
  } else if (type === "teleport") {
    if (!isNonNegInt(v["distanceFixed"])) {
      errors.push(`${path}.distanceFixed: must be a non-negative integer`);
      ok = false;
    }
  } else {
    errors.push(`${path}.type: unknown effect type "${String(type)}"`);
    ok = false;
  }
  return ok;
}

export function validateSkillDef(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || !ID_PATTERN.test(v["id"])) {
    errors.push(`id: must match ID_PATTERN, got "${String(v["id"])}"`);
  }
  if (typeof v["name"] !== "string" || v["name"].length === 0) {
    errors.push("name: must be a non-empty string");
  }
  if (!isNonNegInt(v["manaCostFixed"])) {
    errors.push("manaCostFixed: must be a non-negative integer");
  }
  if (!isNonNegInt(v["cooldownTicks"])) {
    errors.push("cooldownTicks: must be a non-negative integer");
  }
  if (v["description"] !== undefined && typeof v["description"] !== "string") {
    errors.push("description: must be a string");
  }
  if (v["castTicks"] !== undefined && !isNonNegInt(v["castTicks"])) {
    errors.push("castTicks: must be a non-negative integer");
  }
  if (v["critChancePct"] !== undefined && !isNonNegInt(v["critChancePct"])) {
    errors.push("critChancePct: must be a non-negative integer");
  }
  const effects = v["effects"];
  if (!Array.isArray(effects) || effects.length === 0) {
    errors.push("effects: must be a non-empty array");
  } else {
    for (let i = 0; i < effects.length; i++) {
      validateEffectNode(effects[i], i, errors);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateMonsterDef(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || !ID_PATTERN.test(v["id"])) {
    errors.push(`id: must match ID_PATTERN, got "${String(v["id"])}"`);
  }
  if (typeof v["name"] !== "string" || v["name"].length === 0) {
    errors.push("name: must be a non-empty string");
  }
  for (const field of [
    "maxLifeFixed",
    "moveSpeedFixed",
    "attackRangeFixed",
    "attackCooldownTicks",
    "radiusFixed",
  ] as const) {
    if (!isNonNegInt(v[field])) {
      errors.push(`${field}: must be a non-negative integer`);
    }
  }
  if (!isObj(v["defenses"])) {
    errors.push("defenses: required object");
  } else {
    const def = v["defenses"] as Record<string, unknown>;
    if (!isObj(def["resPct"])) {
      errors.push("defenses.resPct: required object");
    } else {
      const res = def["resPct"] as Record<string, unknown>;
      for (const el of ELEMENTS) {
        const r = res[el];
        if (typeof r !== "number" || !Number.isInteger(r) || r < 0 || r > 100) {
          errors.push(`defenses.resPct.${el}: must be an integer 0..100`);
        }
      }
    }
    if (!isNonNegInt(def["armourFixed"])) {
      errors.push("defenses.armourFixed: must be a non-negative integer");
    }
  }
  validateDamageSpec(v["attackDamage"], "attackDamage", errors);
  const archetype = v["archetype"];
  const knownArchetype =
    typeof archetype === "string" &&
    (MONSTER_ARCHETYPES as readonly string[]).includes(archetype);
  if (!knownArchetype) {
    errors.push(
      `archetype: must be one of ${MONSTER_ARCHETYPES.join(", ")}, got "${String(archetype)}"`,
    );
  }
  // A spec and its archetype are one statement, so each implies the other: a
  // shooter with no bolt would silently melee, and a bolt on a brute would never
  // fire. Both are content bugs that only show up in play.
  validateSubSpec(v["ranged"], archetype === "shooter", "ranged",
    ["speedFixed", "radiusFixed"], errors);
  validateSubSpec(v["heavy"], archetype === "heavy", "heavy",
    ["windupTicks", "radiusFixed", "damageFixed", "cooldownTicks", "rangeFixed"], errors);
  if (v["boss"] !== undefined) {
    const b = v["boss"];
    if (!isObj(b)) {
      errors.push("boss: must be an object");
    } else {
      const pct = b["phase2AtLifePct"];
      if (
        typeof pct !== "number" ||
        !Number.isInteger(pct) ||
        pct < 1 ||
        pct > 100
      ) {
        errors.push("boss.phase2AtLifePct: must be an integer in 1..100");
      }
      if (!isObj(b["slam"])) {
        errors.push("boss.slam: must be an object");
      } else {
        const slam = b["slam"] as Record<string, unknown>;
        for (const field of ["windupTicks", "radiusFixed", "damageFixed", "cooldownTicks", "rangeFixed"] as const) {
          if (!isNonNegInt(slam[field])) {
            errors.push(`boss.slam.${field}: must be a non-negative integer`);
          }
        }
      }
      if (!isObj(b["phase2"])) {
        errors.push("boss.phase2: must be an object");
      } else {
        const p2 = b["phase2"] as Record<string, unknown>;
        for (const field of ["fireGroundDurationTicks", "addCount"] as const) {
          if (!isNonNegInt(p2[field])) {
            errors.push(`boss.phase2.${field}: must be a non-negative integer`);
          }
        }
        if (typeof p2["addDefId"] !== "string" || !ID_PATTERN.test(p2["addDefId"])) {
          errors.push("boss.phase2.addDefId: must match ID_PATTERN");
        }
        validateAilmentSpec(p2["fireGround"], "boss.phase2.fireGround", errors);
        const cmp = p2["cadenceMulPct"];
        if (
          typeof cmp !== "number" ||
          !Number.isInteger(cmp) ||
          cmp < 1 ||
          cmp > 100
        ) {
          errors.push("boss.phase2.cadenceMulPct: must be an integer in 1..100");
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Present-iff-required check for an all-non-negative-integer sub-spec. */
function validateSubSpec(
  v: unknown, required: boolean, field: string,
  numericFields: readonly string[], errors: string[],
): void {
  if (v === undefined) {
    if (required) errors.push(`${field}: required for this archetype`);
    return;
  }
  if (!required) {
    errors.push(`${field}: only valid on its own archetype`);
    return;
  }
  if (!isObj(v)) {
    errors.push(`${field}: must be an object`);
    return;
  }
  const o = v as Record<string, unknown>;
  for (const f of numericFields) {
    if (!isNonNegInt(o[f])) errors.push(`${field}.${f}: must be a non-negative integer`);
  }
}

// ── Items (First Loot slice) ────────────────────────────────────────────────
export type Rarity = "normal" | "magic" | "rare" | "unique";

/** Tooltip base-stat block shown between the header and affixes (reference-screenshots/item-*.png). */
export interface ItemStats {
  /** weapon physical damage range (rendered "min-max") */
  physMin?: number;
  physMax?: number;
  /** weapon crit chance percent (8 -> "8.00%") */
  critPct?: number;
  /** weapon attacks per second (1.2 -> "1.20") */
  aps?: number;
  /** requirement level */
  reqLevel?: number;
  /** single attribute requirement, e.g. { value: 29, attr: "Int" } */
  reqAttrValue?: number;
  reqAttr?: "Str" | "Dex" | "Int";
}
export interface ItemBase {
  id: string;
  name: string;
  itemClass: string;
  w: number;
  h: number;
  stats?: ItemStats;
  /**
   * The base's own mod, above the rolled ones in the tooltip. Fixed, not rolled: every
   * copy of the base carries the same value, so it lives here and never on the Item.
   * PoE2 rolls implicits inside a range; ours are a single value. Absent is normal,
   * most PoE2 bases (all helmets) have none.
   */
  implicit?: { stat: string; label: string; value: number };
  /** Inventory art, a client-relative URL. Absent means the UI falls back to the name. */
  icon?: string;
}

export interface Affix {
  id: string;
  /** Which half of the mod pool this belongs to. PoE caps the two sides separately. */
  kind: "prefix" | "suffix";
  /**
   * Name part a magic item borrows from this mod: an adjective for a prefix
   * ("Hale"), an of-phrase for a suffix ("of the Furnace"). PoE names a magic
   * item "[Prefix] [Base] [Suffix]".
   */
  nameWord: string;
  stat: string;
  label: string;
  minItemLevel: number;
  min: number;
  max: number;
  /**
   * Item classes this mod can roll on, PoE's per-class mod pool: a wand never
   * offers body armour's mods. Absent means every class, which is how a pool
   * that does not care about classes stays valid.
   */
  itemClasses?: string[];
}

export interface ItemAffix {
  affixId: string;
  value: number;
}

export interface Item {
  baseId: string;
  rarity: Rarity;
  itemLevel: number;
  affixes: ItemAffix[];
  /** Generated for rares and magic items ("Hale Wand of the Furnace"), fixed for uniques; normal items use the base name. */
  name?: string;
  /**
   * Set on magic/rare/unique drops until a Scroll of Wisdom reveals them. Absent
   * means identified, so normal items and items persisted before the flag existed
   * need no migration. Mods are rolled at drop time either way (docs/02 §2); this
   * only hides them (docs/09 rule 1: the spike fires on anticipation).
   */
  unidentified?: boolean;
  /**
   * Present only on a waystone. The stone's mods are NOT affixes: every
   * monster-scaling call site reads `waystoneMods(seed)` from `@exiled/rules`,
   * so the seed IS the stone and the item only has to carry it. Optional so no
   * other item and no persisted inventory needs migrating.
   *
   * `permanent` marks the one stone every character always owns: it is not
   * consumed when a map opens and currency cannot touch it. Also optional, and
   * for the same reason — a stone persisted before the flag existed is an
   * ordinary stone, which is exactly what it was.
   */
  waystone?: { seed: number; tier: number; permanent?: boolean };
}

/**
 * A named one-off item bound to a single base, with a fixed mod list rolled inside
 * per-unique ranges (reference-screenshots/item-unique.png). Mods reference the shared affix
 * pool for their label, but the ranges are the unique's own and may exceed the affix's.
 */
export interface UniqueItem {
  id: string;
  name: string;
  baseId: string;
  /** Italic orange line under the mods. */
  flavour: string;
  /** Own inventory art, overriding the base's. Absent falls back to the base icon. */
  icon?: string;
  mods: { affixId: string; min: number; max: number }[];
}

export interface ItemPools {
  bases: ItemBase[];
  affixes: Affix[];
  /** Absent means uniques never drop from this pool. */
  uniques?: UniqueItem[];
}

function isPosInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function validateItemBase(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || v["id"].length === 0) {
    errors.push("id: must be a non-empty string");
  }
  if (typeof v["name"] !== "string" || v["name"].length === 0) {
    errors.push("name: must be a non-empty string");
  }
  if (typeof v["itemClass"] !== "string" || v["itemClass"].length === 0) {
    errors.push("itemClass: must be a non-empty string");
  }
  if (!isPosInt(v["w"])) {
    errors.push("w: must be a positive integer");
  }
  if (!isPosInt(v["h"])) {
    errors.push("h: must be a positive integer");
  }
  if (v["stats"] !== undefined && !isObj(v["stats"])) {
    errors.push("stats: must be an object when present");
  }
  const imp = v["implicit"];
  if (imp !== undefined) {
    if (!isObj(imp) || typeof imp["stat"] !== "string" || imp["stat"].length === 0 ||
        typeof imp["label"] !== "string" || imp["label"].length === 0 ||
        typeof imp["value"] !== "number" || !Number.isInteger(imp["value"])) {
      errors.push("implicit: must be { stat, label, value } with non-empty strings and an integer value");
    }
  }
  if (v["icon"] !== undefined && (typeof v["icon"] !== "string" || v["icon"].length === 0)) {
    errors.push("icon: must be a non-empty string when present");
  }
  return { ok: errors.length === 0, errors };
}

export function validateAffix(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || v["id"].length === 0) {
    errors.push("id: must be a non-empty string");
  }
  if (v["kind"] !== "prefix" && v["kind"] !== "suffix") {
    errors.push('kind: must be "prefix" or "suffix"');
  }
  if (typeof v["nameWord"] !== "string" || v["nameWord"].length === 0) {
    errors.push("nameWord: must be a non-empty string");
  }
  if (typeof v["stat"] !== "string" || v["stat"].length === 0) {
    errors.push("stat: must be a non-empty string");
  }
  if (typeof v["label"] !== "string" || v["label"].length === 0) {
    errors.push("label: must be a non-empty string");
  }
  if (!isPosInt(v["minItemLevel"])) {
    errors.push("minItemLevel: must be a positive integer");
  }
  const min = v["min"];
  const max = v["max"];
  if (typeof min !== "number" || !Number.isInteger(min)) {
    errors.push("min: must be an integer");
  }
  if (typeof max !== "number" || !Number.isInteger(max)) {
    errors.push("max: must be an integer");
  }
  if (
    typeof min === "number" &&
    typeof max === "number" &&
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min > max
  ) {
    errors.push("min: must be <= max");
  }
  const classes = v["itemClasses"];
  if (classes !== undefined) {
    // An empty list would mean "rolls on nothing", which is only ever a typo.
    if (!Array.isArray(classes) || classes.length === 0 || classes.some((c) => typeof c !== "string" || c.length === 0)) {
      errors.push("itemClasses: must be a non-empty array of non-empty strings when present");
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Maps: biomes and bases
// ---------------------------------------------------------------------------

/**
 * The four biomes this game ships. PoE2's own list is longer (docs/01 §5) and a
 * map can count as more than one; these are the four we have art and layouts
 * for. Vaal Stone is a city identity rather than a primary biome, and is here
 * because a ruined stone city is the look the Atlas is built around.
 */
export const BIOME_IDS = ["vaal_stone", "desert", "swamp", "forest", "strand"] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

/** Which chunk library and branch count an area is assembled from. */
export const LAYOUT_GRAMMAR_IDS = ["loop", "open-field", "sunken-ruins", "strand"] as const;
export type LayoutGrammarId = (typeof LAYOUT_GRAMMAR_IDS)[number];

export interface Biome {
  id: BiomeId;
  name: string;
  /** Ambient light tint, linear 0..1 RGB. The mood of the place in one triple. */
  tint: readonly [number, number, number];
  /** Flood the void outside the rim with water. A property of the PLACE, like
   *  the tint: the renderer reads it and nothing threads through the layout. */
  sea?: boolean;
}

/**
 * An original map base: what a place is made of. The Atlas node brings the
 * name and the position, the Waystone brings the tier, and this brings the
 * look and the shape. See docs/01-atlas-and-map-running.md:196.
 */
export interface MapBase {
  id: string;
  biomeId: BiomeId;
  /** Material set the renderer dresses the walls and floor with. */
  tilesetId: string;
  layoutGrammarId: LayoutGrammarId;
}

/** The attribute a class leans on. Display-only until stats read it. */
export const CLASS_ARCHETYPES = ["strength", "dexterity", "intellect"] as const;
export type ClassArchetype = (typeof CLASS_ARCHETYPES)[number];

/**
 * A playable class.
 *
 * Cosmetic in this slice: it picks a name, a portrait and an outfit, never a
 * number. The wardrobe is one 65-joint male rig with two looks per slot, so
 * "class" can only ever mean which item bases the character is created wearing
 * — and it is the baked armour texture on those bases (`GEAR_TEXTURE` in the
 * renderer) that makes three characters read as three people rather than one
 * man in three hats.
 *
 * Borrowed from PoE1's character select, where every roster row carries a class
 * name under it. The names and fiction here are original.
 */
export interface CharacterClass {
  id: string;
  name: string;
  /** One line of flavour, shown under the name while creating a character. */
  blurb: string;
  archetype: ClassArchetype;
  /**
   * Item bases the character is created wearing, keyed by equipment slot id.
   * An absent slot means the character starts with that slot empty, which the
   * renderer draws as commoner cloth — a deliberate silhouette choice, not a gap.
   */
  startingGear: Readonly<Record<string, string>>;
  /** Portrait art for the roster row and the class picker. */
  portrait: string;
}
