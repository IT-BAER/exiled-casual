import { fp, type Fixed } from "@exiled/fixed-point";
import type { AreaLayout } from "@exiled/mapgen";

// ---------------------------------------------------------------------------
// Intent — client-side input, coords are Fixed integers (client calls fp())
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: "moveTo"; x: Fixed; y: Fixed }
  | { kind: "moveDir"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: "useSkill"; skillId: string; tx: Fixed; ty: Fixed }
  | { kind: "stop" }
  /** Activate a clicked interactable (map device, portal). Sim re-checks range. */
  | { kind: "interact"; targetId: number }
  /** Activate the map device with a chosen node + waystone. Sim re-validates both. */
  | { kind: "activateMap"; atlasNodeId: string; waystoneId: string }
  /** Pick up a ground item. Sim re-checks range + placement. */
  | { kind: "pickupItem"; entityId: number }
  /** Equip an item whose ORIGIN cell in the backpack grid is (x,y) into the given slot. */
  | { kind: "equipItem"; x: number; y: number; slot: EquipSlotId }
  /** Unequip a slot back into the backpack grid; no-op if empty or no room. */
  | { kind: "unequipItem"; slot: EquipSlotId }
  /** Drop a backpack item (by ORIGIN cell) as a ground entity at the player's feet. */
  | { kind: "dropItem"; x: number; y: number };

export type CommandType = "moveTo" | "moveDir" | "useSkill" | "stop" | "interact" | "activateMap" | "pickupItem" | "equipItem" | "unequipItem" | "dropItem";

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

/** Where the player currently is. The hideout is the session's home area. */
export type AreaKind = "hideout" | "map";

export const AREA_KINDS: readonly AreaKind[] = ["hideout", "map"];

/**
 * Portals a freshly-opened map grants. Per docs/01 §8 this is the retry budget,
 * not an entry charge: entering and leaving is free, each death spends one, and
 * the map closes at zero. Starting at 6 and decrementing on death yields exactly
 * "six total lives including the initial entry".
 */
export const MAP_PORTALS = 6;

/** Rarity tint for a display-ready item. Protocol-local; no content-schema import. */
export type ItemRarity = "normal" | "magic" | "rare" | "unique";

export type EquipSlotId =
  | "weapon1" | "weapon2" | "helmet" | "body" | "gloves" | "boots" | "belt" | "amulet" | "ring1" | "ring2";

/** Display-ready item shape shared by inventory cells and equipped slots. */
export interface DisplayItem {
  rarity: ItemRarity; name: string; baseName?: string; itemClass?: string; lines: string[];
  flavour?: string; icon?: string;
  statLines?: ItemStatLine[]; reqLevel?: number; reqAttrValue?: number; reqAttr?: string;
}

/** Interaction range for picking up a ground item, Fixed-scaled (matches device/portal interact radius fp(2.5)). */
export const PICKUP_RADIUS = fp(2.5);

// ---------------------------------------------------------------------------
// Worker message types (client → worker)
// ---------------------------------------------------------------------------

/** Lab-only spawn control, so a test arena can start empty and be filled on demand. */
export type SpawnKind = "imp" | "pack" | "rare" | "boss" | "clear" | "hurtboss" | "item";

export const SPAWN_KINDS: readonly SpawnKind[] = ["imp", "pack", "rare", "boss", "clear", "hurtboss", "item"];

export interface ToWorker_Init   { type: "init"; seed: number }
export interface ToWorker_Intent { type: "intent"; intent: Intent }
export interface ToWorker_Reset  { type: "reset" }
export interface ToWorker_Spawn  { type: "spawn"; what: SpawnKind }
export type ToWorker = ToWorker_Init | ToWorker_Intent | ToWorker_Reset | ToWorker_Spawn;

// ---------------------------------------------------------------------------
// Snapshot types (worker → client); coords are render floats (worker calls toNumber())
// ---------------------------------------------------------------------------

export interface SnapshotEntity {
  id: number;
  kind: "monster" | "projectile" | "groundArea" | "telegraph" | "portal" | "mapDevice" | "groundItem";
  x: number; y: number;
  radius?: number;
  life?: number; maxLife?: number;
  rare?: boolean;
  remainingSeconds?: number;
  ailmentStacks?: number;
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
  lines?: string[];
  /** groundItem only: unique flavour line, below the mods. */
  flavour?: string;
  /** groundItem only: base item class label ("wand", "focus") for the tooltip. */
  itemClass?: string;
  /** groundItem only: tooltip base-stat block + requirements (poe2-screenshots/item-*.png). */
  statLines?: ItemStatLine[];
  reqLevel?: number;
  reqAttrValue?: number;
  reqAttr?: string;
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
    cooldowns: Record<string, number>;
    alive: boolean;
    /** In post-cast recovery this tick (moving slowed, cast pose held). */
    casting: boolean;
  };
  entities: SnapshotEntity[];
  /** Grid inventory (session singleton), display-ready. Empty when no session. */
  inventory: {
    cols: number; rows: number;
    items: (DisplayItem & { x: number; y: number; w: number; h: number })[];
  };
  /** Equipped gear by slot. Absent keys mean an empty slot. Absent field means no session. */
  equipment: Partial<Record<EquipSlotId, DisplayItem>>;
}

export interface FromWorker_Snapshot { type: "snapshot"; snapshot: Snapshot }
export interface FromWorker_Ready    { type: "ready" }
/** Sent once when an area is built, so the renderer can draw its floor + walls.
 *  Carries the whole layout; the renderer only reads `layout.grid` today. */
export interface FromWorker_Area     { type: "area"; area: AreaKind; layout: AreaLayout }
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
      if (typeof obj["waystoneId"] !== "string" || obj["waystoneId"].length === 0)
        throw new Error("validateIntent activateMap: waystoneId must be a non-empty string");
      return {
        kind: "activateMap",
        atlasNodeId: obj["atlasNodeId"] as string,
        waystoneId: obj["waystoneId"] as string,
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
    case "dropItem": {
      if (!Number.isInteger(obj["x"])) throw new Error("validateIntent dropItem: x must be an integer");
      if (!Number.isInteger(obj["y"])) throw new Error("validateIntent dropItem: y must be an integer");
      return { kind: "dropItem", x: obj["x"] as number, y: obj["y"] as number };
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
    case "init":   return typeof obj["seed"] === "number";
    case "intent": return typeof obj["intent"] === "object" && obj["intent"] !== null;
    case "reset":  return true;
    case "spawn":  return SPAWN_KINDS.includes(obj["what"] as SpawnKind);
    default:       return false;
  }
}
