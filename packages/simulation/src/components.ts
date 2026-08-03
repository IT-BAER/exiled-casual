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
  /**
   * The stones the character owns, in the order they were acquired. Activating a
   * map SPENDS one; clearing a map hands back one or two. This is the durable
   * stock — it is what makes tiers a resource rather than a menu.
   */
  /** Retry budget for the open map. See MAP_PORTALS in @exiled/protocol. */
  portalsLeft: number;
  mapOpen: 0 | 1;
  /**
   * The player is down and the death screen is up. Nothing has been healed and no
   * portal has been spent yet, because WHERE he comes back is his choice: the
   * revive system spends and places on his answer, not on the hit that killed him.
   * A world with no session never sees this, so golden replays keep their old
   * respawn-at-origin path.
   *
   * Optional, like every other field added to a shape that is written to disk and
   * hashed: absent and 0 are the same state to a reader, and absent is what an
   * older save and an older checksum both already say.
   */
  dead?: 0 | 1;
  /**
   * Where "resurrect at checkpoint" puts him: the entrance of the open map,
   * recorded when the area was built. Absent outside a map.
   */
  checkpointX?: Fixed;
  checkpointY?: Fixed;
  /** Area to build at the end of this tick; "" means stay put. */
  pendingArea: AreaKind | "";
}

/**
 * Character progression. Lives on the session singleton beside inventory and
 * equipment because it is durable in exactly the same way: it survives an area
 * transition, and an abandoned map run does not roll it back.
 */
/**
 * `gold` lives here rather than in a component of its own because docs/02 says it
 * is account-bound and never occupies inventory: it is something the character has
 * accumulated, exactly like the level and the xp beside it.
 */
export interface ProgressC { level: number; xp: number; gold: number }

/** Something the player can activate with the `interact` intent. */
export interface InteractableC {
  kind: "mapDevice" | "portal" | "stash" | "vendor";
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
/**
 * dx/dy are each -1 | 0 | 1: the direction the keys are ASKING for.
 *
 * hx/hy are where the player is actually going, a unit vector in Fixed that
 * steers toward dx/dy a bounded amount per tick — the keys are a request, the
 * heading is the answer. Zero while standing still, which is also what makes
 * the first step off a standstill instant instead of a curve out of nowhere.
 */
export interface MoveDir    { dx: number; dy: number; hx: Fixed; hy: Fixed }
/** keys are skillId strings; values are the tick at which the skill becomes ready */
export interface Cooldowns  { [skillId: string]: number }
/**
 * A cast wind-up. The optional payload is present only while a non-instant skill
 * is waiting to resolve, so the effect and its aim stay authoritative in the sim
 * instead of being re-read from a later input repeat.
 */
export interface CastingC {
  untilTick: number;
  skillId?: string;
  tx?: Fixed;
  ty?: Fixed;
  /** Snapshot of the offensive values at cast start. */
  spellDamagePct?: number;
  didCrit?: 0 | 1;
  team?: number;
  action?: "spell" | "melee";
  /** Full length of this wind-up in ticks, cast speed already applied. The
   *  renderer paces the clip by it so the release pose lands on the hit. */
  ticks?: number;
}
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
  /**
   * Cooldown for the heavy-slam ability, separate from `attackReadyTick` so
   * the auto-attack timer is unaffected by a slam and fires in the gap.
   * Non-heavy monsters carry this as 0 and never read it.
   */
  slamReadyTick: number;
  /**
   * Rooted through a heavy's wind-up: no move, no melee. Trash reads this;
   * a boss reads BossC.rootedUntilTick and the two systems never cross.
   */
  rootedUntilTick: number;
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
export interface OffenseC   { spellDamagePct: number; castSpeedPct: number; critChancePct: number }
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
export interface PlacedItem {
  x: number; y: number; w: number; h: number; item: Item;
  /** Currency only: how many sit in this one cell. Absent on equipment, which never stacks. */
  count?: number;
}
/** Grid inventory on the session singleton. In-memory only this slice. */
export interface InventoryC { cols: number; rows: number; items: PlacedItem[] }
/**
 * Persistent hideout storage. Same grid shape as the backpack, so every placement
 * helper works on both; it is a separate component only so the two never share cells.
 */
export type StashC = InventoryC;
/**
 * The vendor's shelf. Same grid shape again, so the placement helpers and the
 * client's grid renderer both work on it unchanged; it is a container rather than
 * a derived list because buying has to take a piece off it and leave a hole.
 */
export type VendorC = InventoryC;
/** Equipped gear on the session singleton, keyed by slot id. */
export interface EquipmentC { slots: Partial<Record<string, Item>> }
/**
 * Loose disenchant shards on the session singleton. Ten matching shards convert
 * to their orb (SHARDS_PER_ORB from @exiled/rules). Kept separate from inventory
 * so the count can accumulate silently without occupying a grid cell.
 */
export interface ShardsC { counts: Record<string, number> }
