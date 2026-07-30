import { fp, type Fixed } from "@exiled/fixed-point";
import type { AreaLayout } from "@exiled/mapgen";

// ---------------------------------------------------------------------------
// Intent — client-side input, coords are Fixed integers (client calls fp())
// ---------------------------------------------------------------------------

/**
 * Which grid a read addresses. `vendor` is the shop's shelf: it can be read from
 * and bought out of, but never moved into or out of — goods change hands through
 * `buyItem`, which is the only path that charges for them.
 */
export type ContainerId = "backpack" | "stash" | "vendor";

export type Intent =
  | { kind: "moveTo"; x: Fixed; y: Fixed }
  | { kind: "moveDir"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: "useSkill"; skillId: string; tx: Fixed; ty: Fixed }
  | { kind: "stop" }
  /** Activate a clicked interactable (map device, portal). Sim re-checks range. */
  | { kind: "interact"; targetId: number }
  /** Activate the map device with a chosen node and the backpack cell holding the
   *  waystone. Sim re-validates both: a cell is a claim, not a stone. */
  | { kind: "activateMap"; atlasNodeId: string; x: number; y: number }
  /** Pick up a ground item. Sim re-checks range + placement. */
  | { kind: "pickupItem"; entityId: number }
  /** Equip an item whose ORIGIN cell in the backpack grid is (x,y) into the given slot. */
  | { kind: "equipItem"; x: number; y: number; slot: EquipSlotId }
  /** Unequip a slot back into the backpack grid; no-op if empty or no room. */
  | { kind: "unequipItem"; slot: EquipSlotId }
  /** Drop a backpack item (by ORIGIN cell) as a ground entity at the player's feet. */
  | { kind: "dropItem"; x: number; y: number }
  /**
   * Move an item from its (x, y) origin cell to another one. `from`/`to` name the
   * container and both default to the backpack, so a move recorded before the stash
   * existed replays byte-identically.
   */
  | { kind: "moveItem"; x: number; y: number; toX: number; toY: number; from?: ContainerId; to?: ContainerId }
  | { kind: "useFlask"; slot: "life" | "mana" }
  /** Spend one Scroll of Wisdom on the unidentified backpack item at its ORIGIN cell. */
  | { kind: "applyCurrency"; fromX: number; fromY: number; x: number; y: number }
  /**
   * Sell the item whose ORIGIN cell is (x,y) to the disenchanter. `from` defaults
   * to the backpack, matching moveItem's convention so the two share a read path.
   */
  | { kind: "sellItem"; x: number; y: number; from?: ContainerId }
  /**
   * Buy the vendor's stock item whose ORIGIN cell on the shelf is (x,y). The sim
   * re-checks the price against the purse and the backpack for room, so a client
   * that shows a piece it cannot afford can still only ever be told no.
   */
  | { kind: "buyItem"; x: number; y: number }
  /**
   * Answer the death screen. `where` is the only decision death leaves the
   * player: "checkpoint" wakes him at the map's entrance, "hideout" walks him
   * out. Both spend one of the map's portals — see systems/revive.ts — and the
   * sim refuses a checkpoint when spending it would close the map.
   */
  | { kind: "revive"; where: "checkpoint" | "hideout" }
  /**
   * Spend one Portal Scroll to open a way home where the player is standing. Only
   * ever inside an open map; the sim finds the scroll in its own inventory, so the
   * client never names one.
   */
  | { kind: "usePortalScroll" };

export type CommandType = "moveTo" | "moveDir" | "useSkill" | "stop" | "interact" | "activateMap" | "pickupItem" | "equipItem" | "unequipItem" | "dropItem" | "moveItem" | "useFlask" | "applyCurrency" | "sellItem" | "buyItem" | "revive" | "usePortalScroll";

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

/** Where the player currently is. The hideout is the session's home area. */
export type AreaKind = "hideout" | "map";

export const AREA_KINDS: readonly AreaKind[] = ["hideout", "map"];

/**
 * Portals a freshly-opened map grants: the number of times the player may be
 * standing outside it and still get back in.
 *
 * Two things spend one — answering the death screen (systems/revive.ts) and
 * walking out through a portal (systems/interact.ts) — and the map closes at zero,
 * which is PoE1's rule rather than the "deaths only" reading this started with.
 * Entering is free, because the portal you came through is the one already paid
 * for; that is what makes six trips out of six portals instead of three.
 */
export const MAP_PORTALS = 6;

/**
 * Resistances by element, integer percent. Protocol-local and structural, like
 * ItemRarity: the sim's ResBlock assigns to it without the wire contract taking
 * a dependency on content.
 */
export interface Resistances { fire: number; cold: number; lightning: number; chaos: number }

/**
 * What a monster's hit is made of. Protocol-local for the same reason
 * Resistances is: the wire contract must not depend on content.
 */
export type MonsterElement = "fire" | "cold" | "lightning" | "chaos" | "physical";

/** Rarity tint for a display-ready item. Protocol-local; no content-schema import. */
export type ItemRarity = "normal" | "magic" | "rare" | "unique";

export type EquipSlotId =
  | "weapon1" | "weapon2" | "helmet" | "body" | "gloves" | "boots" | "belt" | "amulet" | "ring1" | "ring2";

/** Display-ready item shape shared by inventory cells and equipped slots. */
export interface DisplayItem {
  rarity: ItemRarity; name: string; baseName?: string; itemClass?: string; implicit?: string; lines: string[];
  flavour?: string; icon?: string; unidentified?: boolean;
  /** Which base this is. The client needs it to tell one currency from another. */
  baseId?: string;
  statLines?: ItemStatLine[]; reqLevel?: number; reqAttrValue?: number; reqAttr?: string;
  /** Present only on map.waystone items: the client sockets one into an Atlas node. */
  waystone?: { seed: number; tier: number };
}

/** Interaction range for picking up a ground item, Fixed-scaled (matches device/portal interact radius fp(2.5)). */
export const PICKUP_RADIUS = fp(2.5);

// ---------------------------------------------------------------------------
// Worker message types (client → worker)
// ---------------------------------------------------------------------------

/** Lab-only spawn control, so a test arena can start empty and be filled on demand. */
export type SpawnKind = "imp" | "pack" | "rare" | "boss" | "clear" | "hurtboss" | "item";

export const SPAWN_KINDS: readonly SpawnKind[] = ["imp", "pack", "rare", "boss", "clear", "hurtboss", "item"];

/**
 * `characterId` names the roster entry this session plays. Optional so the lab
 * (and every test that drives WorkerCore directly) can still boot a bare world
 * with no roster behind it; when it IS present the worker loads and saves that
 * character rather than the single pre-roster blob.
 */
export interface ToWorker_Init   { type: "init"; seed: number; characterId?: string }
export interface ToWorker_Intent { type: "intent"; intent: Intent }
export interface ToWorker_Reset  { type: "reset" }
export interface ToWorker_Spawn  { type: "spawn"; what: SpawnKind }
export type ToWorker = ToWorker_Init | ToWorker_Intent | ToWorker_Reset | ToWorker_Spawn;

// ---------------------------------------------------------------------------
// Snapshot types (worker → client); coords are render floats (worker calls toNumber())
// ---------------------------------------------------------------------------

export interface SnapshotEntity {
  id: number;
  kind: "monster" | "projectile" | "groundArea" | "telegraph" | "portal" | "mapDevice" | "stash" | "vendor" | "groundItem";
  x: number; y: number;
  radius?: number;
  life?: number; maxLife?: number;
  rare?: boolean;
  /**
   * A rare's elemental theme, so the renderer can say which resistance it is
   * about to demand. Present only on rares; normals and bosses hit with what
   * their content def says and have no theme to advertise.
   */
  element?: MonsterElement;
  /**
   * Which monster def this is, so the renderer can pick a mesh. A plain string:
   * the wire contract must not depend on content, the same reason `element` and
   * `rarity` are protocol-local types.
   */
  species?: string;
  remainingSeconds?: number;
  ailmentStacks?: number;
  /**
   * Which side owns this entity: 0 is the player's, anything else is not. Present
   * on projectiles, where nothing else in the snapshot says whose a bolt is — the
   * client needs it to tell the player's own cast from a spitter's answer, for the
   * sound if nothing else.
   */
  team?: number;
  /** true for the boss monster; kind stays "monster" so existing consumers keep working */
  boss?: boolean;
  /** boss phase, present only when boss === true */
  bossPhase?: 1 | 2;
  /** telegraph wind-up progress: 0 at cast → 1 at impact, for fill animation */
  progress?: number;
  /** portal/mapDevice only: the player is close enough to activate it */
  inRange?: boolean;
  /** portal/mapDevice only: fixed yaw in radians, so the renderer angles it consistently */
  yaw?: number;
  /** groundItem only: rarity tint, display name, and affix lines for hover. */
  rarity?: ItemRarity;
  name?: string;
  /** groundItem only: base type, shown under a generated name for rares. */
  baseName?: string;
  /** groundItem only: the base's fixed implicit, above the rolled mods. */
  implicit?: string;
  lines?: string[];
  /** groundItem only: unique flavour line, below the mods. */
  flavour?: string;
  /** groundItem only: true while the drop is unread, so name and mods stay hidden. */
  unidentified?: boolean;
  /** groundItem only: base item class label ("wand", "focus") for the tooltip. */
  itemClass?: string;
  /** groundItem only: tooltip base-stat block + requirements (reference-screenshots/item-*.png). */
  statLines?: ItemStatLine[];
  reqLevel?: number;
  reqAttrValue?: number;
  reqAttr?: string;
}

/**
 * Everything the character sheet shows that the HUD globes do not already carry.
 * Only stats some equipped mod can actually move live here: attributes, evasion
 * and block have no mechanic yet, and a zero row would
 * advertise a system that does not exist.
 */
export interface PlayerStats {
  /** Raw armour rating, the number gear adds to. */
  armour: number;
  /**
   * Share of a physical hit armour stops, integer percent. Armour's curve
   * depends on the size of the hit, so this is quoted against one reference
   * hit (the bridge's SHEET_REFERENCE_HIT), the way PoE2's sheet does it.
   */
  armourPct: number;
  /** UNCAPPED totals, one per element. The sheet renders them against RES_CAP so overcapping stays visible. */
  res: Resistances;
  /** What the player actually regenerates: the per-tick amount times 30, not the pre-truncation ideal. */
  manaRegenPerSec: number;
  spellDamagePct: number;
  /** Increased cast speed from gear; the sheet prints it beside spell damage. */
  castSpeedPct: number;
  /** Increased critical strike chance from gear; it scales each skill's own base. */
  critChancePct: number;
}

/** One "label: value" row in an item tooltip's base-stat block. */
export interface ItemStatLine {
  label: string;
  value: string;
}

export interface Snapshot {
  tick: number;
  /** Area the player is standing in. Absent session (legacy sim) reports "map". */
  area: AreaKind;
  /** Retry budget left on the open map; 0 when no map is open. */
  portalsLeft: number;
  mapOpen: boolean;
  /** Tier of the open map; 0 when no map is open. areaLevel = 64 + areaTier. */
  areaTier: number;
  /** Stable session seed the client uses to compute the Waystone offers. */
  atlasSeed: number;
  /** Atlas node ids already completed this session. */
  completedNodes: string[];
  player: {
    id: number; x: number; y: number;
    life: number; maxLife: number; mana: number; maxMana: number;
    /** The pool in front of life. Both are 0 when no equipped mod grants any. */
    energyShield: number; maxEnergyShield: number;
    cooldowns: Record<string, number>;
    alive: boolean;
    /** In post-cast recovery this tick (moving slowed, cast pose held). */
    casting: boolean;
    /** Charge state for the two utility flasks (life on Q, mana on E). */
    flasks: { lifeCharges: number; lifeMax: number; manaCharges: number; manaMax: number };
    /** Gear-derived totals for the character sheet. Life and mana stay above, where the HUD reads them. */
    stats: PlayerStats;
    /** Character level. */
    level: number;
    /** Experience banked toward the next level, and what that level costs. `xpToNext` is 0 at the cap. */
    xp: number;
    xpToNext: number;
    /** Gold on hand. Account-bound and never in the grid (docs/02), so it rides here. */
    gold: number;
  };
  entities: SnapshotEntity[];
  /** Grid inventory (session singleton), display-ready. Empty when no session. */
  inventory: {
    cols: number; rows: number;
    items: (DisplayItem & { x: number; y: number; w: number; h: number; /** currency only: stack size */ count?: number })[];
  };
  /** Persistent hideout storage, same display shape as the backpack. */
  stash: {
    cols: number; rows: number;
    items: (DisplayItem & { x: number; y: number; w: number; h: number; /** currency only: stack size */ count?: number })[];
  };
  /**
   * The vendor's shelf, same display shape again. Each entry carries the gold it
   * costs, so the purchase window never has to re-derive a price the sim owns.
   */
  vendor: {
    cols: number; rows: number;
    items: (DisplayItem & { x: number; y: number; w: number; h: number; count?: number; price: number })[];
  };
  /** Equipped gear by slot. Absent keys mean an empty slot. Absent field means no session. */
  equipment: Partial<Record<EquipSlotId, DisplayItem>>;
  /** Loose disenchant shards on the session singleton, orb baseId -> count. Empty when none. */
  shards: Record<string, number>;
  /** Skills as the tooltip shows them. Absent on a sim built without content. */
  skills?: DisplaySkill[];
}

/**
 * A skill the way its tooltip reads: the gem's own prose plus the numbers this
 * character actually casts at, so the cast time already carries castSpeedPct and
 * the damage lines carry spellDamagePct. PoE shows your numbers, not the gem's,
 * and the client must not recompute any of them: sim math is fixed-point and the
 * client would drift from it.
 */
export interface DisplaySkill {
  id: string;
  name: string;
  description: string;
  /** Mana per cast. */
  manaCost: number;
  /** Seconds of cast recovery after cast speed. 0 = instant. */
  castTimeSec: number;
  /** Seconds. 0 = no cooldown. */
  cooldownSec: number;
  /** Damage per second. Absent for a skill that deals none, which drops the column. */
  dps?: number;
  /** The blue block, one worded line per effect. */
  lines: string[];
}

export interface FromWorker_Snapshot { type: "snapshot"; snapshot: Snapshot }
export interface FromWorker_Ready    { type: "ready" }
/** Sent once when an area is built, so the renderer can draw its floor + walls.
 *  Carries the whole layout, plus the map base being run so the renderer knows
 *  which tileset to dress it in and which biome to tint the light for. Empty
 *  `mapBaseId` means no map (the hideout), which is dressed neutrally. */
export interface FromWorker_Area     { type: "area"; area: AreaKind; layout: AreaLayout; mapBaseId: string }
export type FromWorker = FromWorker_Snapshot | FromWorker_Ready | FromWorker_Area;

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

const EQUIP_SLOT_IDS = new Set<string>([
  "weapon1", "weapon2", "helmet", "body", "gloves", "boots", "belt", "amulet", "ring1", "ring2",
]);

// Validates and returns the Intent, or throws a descriptive Error.
export function validateIntent(v: unknown): Intent {
  if (typeof v !== "object" || v === null) {
    throw new Error("validateIntent: expected an object");
  }
  const obj = v as Record<string, unknown>;
  switch (obj["kind"]) {
    case "moveTo": {
      if (!Number.isInteger(obj["x"])) throw new Error("validateIntent moveTo: x must be an integer");
      if (!Number.isInteger(obj["y"])) throw new Error("validateIntent moveTo: y must be an integer");
      return { kind: "moveTo", x: obj["x"] as Fixed, y: obj["y"] as Fixed };
    }
    case "moveDir": {
      const dx = obj["dx"];
      const dy = obj["dy"];
      if (dx !== -1 && dx !== 0 && dx !== 1)
        throw new Error("validateIntent moveDir: dx must be -1, 0, or 1");
      if (dy !== -1 && dy !== 0 && dy !== 1)
        throw new Error("validateIntent moveDir: dy must be -1, 0, or 1");
      return { kind: "moveDir", dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 };
    }
    case "useSkill": {
      if (typeof obj["skillId"] !== "string" || obj["skillId"].length === 0)
        throw new Error("validateIntent useSkill: skillId must be a non-empty string");
      if (!Number.isInteger(obj["tx"])) throw new Error("validateIntent useSkill: tx must be an integer");
      if (!Number.isInteger(obj["ty"])) throw new Error("validateIntent useSkill: ty must be an integer");
      return {
        kind: "useSkill",
        skillId: obj["skillId"] as string,
        tx: obj["tx"] as Fixed,
        ty: obj["ty"] as Fixed,
      };
    }
    case "stop":
      return { kind: "stop" };
    case "interact": {
      if (!Number.isInteger(obj["targetId"]))
        throw new Error("validateIntent interact: targetId must be an integer");
      return { kind: "interact", targetId: obj["targetId"] as number };
    }
    case "activateMap": {
      if (typeof obj["atlasNodeId"] !== "string" || obj["atlasNodeId"].length === 0)
        throw new Error("validateIntent activateMap: atlasNodeId must be a non-empty string");
      if (!Number.isInteger(obj["x"]) || !Number.isInteger(obj["y"]))
        throw new Error("validateIntent activateMap: x and y must be integers");
      return {
        kind: "activateMap",
        atlasNodeId: obj["atlasNodeId"] as string,
        x: obj["x"] as number,
        y: obj["y"] as number,
      };
    }
    case "pickupItem": {
      if (!Number.isInteger(obj["entityId"]))
        throw new Error("validateIntent pickupItem: entityId must be an integer");
      return { kind: "pickupItem", entityId: obj["entityId"] as number };
    }
    case "equipItem": {
      if (!Number.isInteger(obj["x"])) throw new Error("validateIntent equipItem: x must be an integer");
      if (!Number.isInteger(obj["y"])) throw new Error("validateIntent equipItem: y must be an integer");
      if (!EQUIP_SLOT_IDS.has(obj["slot"] as string))
        throw new Error("validateIntent equipItem: slot must be a valid EquipSlotId");
      return { kind: "equipItem", x: obj["x"] as number, y: obj["y"] as number, slot: obj["slot"] as EquipSlotId };
    }
    case "unequipItem": {
      if (!EQUIP_SLOT_IDS.has(obj["slot"] as string))
        throw new Error("validateIntent unequipItem: slot must be a valid EquipSlotId");
      return { kind: "unequipItem", slot: obj["slot"] as EquipSlotId };
    }
    case "applyCurrency": {
      for (const k of ["fromX", "fromY", "x", "y"]) {
        if (!Number.isInteger(obj[k])) throw new Error(`validateIntent applyCurrency: ${k} must be an integer`);
      }
      return {
        kind: "applyCurrency",
        fromX: obj["fromX"] as number, fromY: obj["fromY"] as number,
        x: obj["x"] as number, y: obj["y"] as number,
      };
    }
    case "dropItem": {
      if (!Number.isInteger(obj["x"])) throw new Error("validateIntent dropItem: x must be an integer");
      if (!Number.isInteger(obj["y"])) throw new Error("validateIntent dropItem: y must be an integer");
      return { kind: "dropItem", x: obj["x"] as number, y: obj["y"] as number };
    }
    case "moveItem": {
      for (const k of ["x", "y", "toX", "toY"] as const) {
        if (!Number.isInteger(obj[k])) throw new Error(`validateIntent moveItem: ${k} must be an integer`);
      }
      for (const k of ["from", "to"] as const) {
        if (obj[k] !== undefined && obj[k] !== "backpack" && obj[k] !== "stash")
          throw new Error(`validateIntent moveItem: ${k} must be "backpack" or "stash"`);
      }
      return {
        kind: "moveItem",
        x: obj["x"] as number, y: obj["y"] as number,
        toX: obj["toX"] as number, toY: obj["toY"] as number,
        ...(obj["from"] !== undefined ? { from: obj["from"] as ContainerId } : {}),
        ...(obj["to"] !== undefined ? { to: obj["to"] as ContainerId } : {}),
      };
    }
    case "useFlask": {
      if (obj["slot"] !== "life" && obj["slot"] !== "mana")
        throw new Error("validateIntent useFlask: slot must be \"life\" or \"mana\"");
      return { kind: "useFlask", slot: obj["slot"] as "life" | "mana" };
    }
    case "sellItem": {
      if (!Number.isInteger(obj["x"])) throw new Error("validateIntent sellItem: x must be an integer");
      if (!Number.isInteger(obj["y"])) throw new Error("validateIntent sellItem: y must be an integer");
      if (obj["from"] !== undefined && obj["from"] !== "backpack" && obj["from"] !== "stash")
        throw new Error("validateIntent sellItem: from must be \"backpack\" or \"stash\"");
      return {
        kind: "sellItem",
        x: obj["x"] as number, y: obj["y"] as number,
        ...(obj["from"] !== undefined ? { from: obj["from"] as ContainerId } : {}),
      };
    }
    case "buyItem": {
      if (!Number.isInteger(obj["x"])) throw new Error("validateIntent buyItem: x must be an integer");
      if (!Number.isInteger(obj["y"])) throw new Error("validateIntent buyItem: y must be an integer");
      return { kind: "buyItem", x: obj["x"] as number, y: obj["y"] as number };
    }
    default:
      throw new Error(`validateIntent: unknown kind: ${String(obj["kind"])}`);
  }
}

const TO_WORKER_TYPES = new Set(["init", "intent", "reset", "spawn"]);

// Structural type guard for ToWorker messages.
export function isToWorker(v: unknown): v is ToWorker {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (!TO_WORKER_TYPES.has(obj["type"] as string)) return false;
  switch (obj["type"]) {
    case "init":   return typeof obj["seed"] === "number"
      && (obj["characterId"] === undefined || typeof obj["characterId"] === "string");
    case "intent": return typeof obj["intent"] === "object" && obj["intent"] !== null;
    case "reset":  return true;
    case "spawn":  return SPAWN_KINDS.includes(obj["what"] as SpawnKind);
    default:       return false;
  }
}
