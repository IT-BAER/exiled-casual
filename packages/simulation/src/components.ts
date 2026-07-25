import type { Entity } from "./ecs";
import type { Fixed } from "@exiled/fixed-point";
import type { Item, ResBlock } from "@exiled/content-schema";

export type AreaKind = "hideout" | "map";

/**
 * Session singleton. Exactly one entity carries this and it survives every
 * area transition, so the run's retry budget outlives the areas it spans.
 */
export interface SessionC {
  area: AreaKind;
  /** Stable per-session seed that drives the Waystone offers. Never overwritten. */
  atlasSeed: number;
  mapSeed: number;
  /**
   * Seed of the Waystone the open map was opened with. Everything about the
   * stone — its rarity and its rolled modifiers — derives from this one number,
   * so the run's difficulty never has to be copied into the session and can
   * never drift from what the Map Device showed.
   */
  waystoneSeed: number;
  /** Tier of the open map. 0 = no map open. areaLevel = 64 + areaTier. */
  areaTier: number;
  /** Atlas node the open map belongs to; "" when none. */
  activeNodeId: string;
  /** Atlas node ids completed this session (in-memory only). */
  completedNodes: string[];
  /** Retry budget for the open map. See MAP_PORTALS in @exiled/protocol. */
  portalsLeft: number;
  mapOpen: 0 | 1;
  /** Area to build at the end of this tick; "" means stay put. */
  pendingArea: AreaKind | "";
}

/**
 * Character progression. Lives on the session singleton beside inventory and
 * equipment because it is durable in exactly the same way: it survives an area
 * transition, and an abandoned map run does not roll it back.
 */
export interface ProgressC { level: number; xp: number }

/** Something the player can activate with the `interact` intent. */
export interface InteractableC {
  kind: "mapDevice" | "portal";
  /** Activation range, Fixed. */
  radius: Fixed;
  /** Render-only fixed yaw in radians. A literal constant, never computed. */
  yaw: number;
}

export interface Position   { x: Fixed; y: Fixed }
export interface Health     { life: Fixed; maxLife: Fixed }
/** regen is per-tick Fixed; derived from perSec via Math.trunc(perSecFixed / 30) */
export interface Mana       { mana: Fixed; maxMana: Fixed; regen: Fixed }
export interface Faction    { team: number }
/** moveSpeed is per-tick Fixed; bodyRadius in Fixed units */
export interface PlayerC    { moveSpeed: Fixed; bodyRadius: Fixed }
export interface MoveTarget { x: Fixed; y: Fixed; active: 0 | 1 }
/** dx/dy are each -1 | 0 | 1 (WASD direction) */
export interface MoveDir    { dx: number; dy: number }
/** keys are skillId strings; values are the tick at which the skill becomes ready */
export interface Cooldowns  { [skillId: string]: number }
/** Post-cast recovery: caster is "casting" (and moves slower) while tick < untilTick. */
export interface CastingC   { untilTick: number }
export interface MonsterC {
  defId: string;
  moveSpeed: Fixed;
  bodyRadius: Fixed;
  attackRange: Fixed;
  attackCooldownTicks: number;
  /** amountFixed of the attack damage */
  attackDamage: Fixed;
  /** DAMAGE_TYPES index (see damage-types.ts) */
  attackType: number;
  attackReadyTick: number;
  state: "idle" | "chase" | "attack";
  /** 1 = rare, 0 = normal */
  rare: 0 | 1;
  /** 1 = boss add, 0 = normal spawn */
  summoned: 0 | 1;
}
export interface DefensesC  { res: ResBlock; armour: Fixed }
/**
 * The pool in front of life. Present only while some equipped mod grants it, so
 * an ungeared world serializes exactly as it did before energy shield existed —
 * the same rule OffenseC follows. `rechargeAtTick` is the tick the refill may
 * resume; every hit pushes it out again.
 */
export interface EnergyShieldC { es: Fixed; maxEs: Fixed; rechargeAtTick: number }
/**
 * Gear-derived offence. Only present while some equipped mod grants it, so an
 * ungeared world serializes exactly as it did before gear existed.
 */
export interface OffenseC   { spellDamagePct: number }
export interface ProjectileC {
  dirx: Fixed;
  diry: Fixed;
  remainingRange: Fixed;
  radius: Fixed;
  /** DAMAGE_TYPES index (see damage-types.ts) */
  damageType: number;
  damageAmount: Fixed;
  ownerId: Entity;
  team: number;
}
export interface GroundAreaC {
  radius: Fixed;
  expiryTick: number;
  nextTick: number;
  ailmentKind: string;
  stacksPerApply: number;
  dps: Fixed;
  ailmentDuration: number;
  maxStacks: number;
  /** team that OWNS this area; only entities on a different team are affected */
  team: number;
}
export interface BossC {
  phase: 1 | 2;
  nextAbilityTick: number;
  spawnX: Fixed; spawnY: Fixed;
  rootedUntilTick: number;
}
export interface TelegraphC {
  ownerId: Entity; team: number;
  radius: Fixed;
  startTick: number; impactTick: number;
  damage: Fixed; damageType: number;
  leavesGroundTicks: number;
  /**
   * Burning-patch profile spawned at impact when leavesGroundTicks > 0. Field
   * names mirror GroundAreaC so telegraphResolve can spread it. Absent = no patch.
   */
  ground?: {
    ailmentKind: string;
    stacksPerApply: number;
    dps: Fixed;
    ailmentDuration: number;
    maxStacks: number;
  };
}
export interface AilmentC {
  kind: string;
  stacks: number;
  dps: Fixed;
  expiryTick: number;
}
export interface DamageEvent {
  target: Entity;
  source: Entity;
  amountFixed: Fixed;
  /** DAMAGE_TYPES index (see damage-types.ts) */
  type: number;
}

/** Two utility flasks: life on Q, mana on E. Charges are plain integers, not Fixed. */
export interface FlasksC {
  lifeCharges: number; lifeMax: number;
  manaCharges: number; manaMax: number;
}

/** A committed item lying on the ground; lives on an entity with Position. */
export interface ItemC { item: Item; w: number; h: number }
/** One placed stack in the grid inventory. */
export interface PlacedItem { x: number; y: number; w: number; h: number; item: Item }
/** Grid inventory on the session singleton. In-memory only this slice. */
export interface InventoryC { cols: number; rows: number; items: PlacedItem[] }
/** Equipped gear on the session singleton, keyed by slot id. */
export interface EquipmentC { slots: Partial<Record<string, Item>> }
