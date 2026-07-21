import type { Entity } from "./ecs";
import type { Fixed } from "@pact/fixed-point";

export type AreaKind = "hideout" | "map";

/**
 * Session singleton. Exactly one entity carries this and it survives every
 * area transition, so the run's retry budget outlives the areas it spans.
 */
export interface SessionC {
  area: AreaKind;
  mapSeed: number;
  /** Retry budget for the open map. See MAP_PORTALS in @pact/protocol. */
  portalsLeft: number;
  mapOpen: 0 | 1;
  /** Area to build at the end of this tick; "" means stay put. */
  pendingArea: AreaKind | "";
}

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
export interface MonsterC {
  defId: string;
  moveSpeed: Fixed;
  bodyRadius: Fixed;
  attackRange: Fixed;
  attackCooldownTicks: number;
  /** amountFixed of the attack damage */
  attackDamage: Fixed;
  /** 0 = fire, 1 = physical */
  attackType: 0 | 1;
  attackReadyTick: number;
  state: "idle" | "chase" | "attack";
  /** 1 = rare, 0 = normal */
  rare: 0 | 1;
  /** 1 = boss add, 0 = normal spawn */
  summoned: 0 | 1;
}
export interface DefensesC  { fireResPct: number; armour: Fixed }
export interface ProjectileC {
  dirx: Fixed;
  diry: Fixed;
  remainingRange: Fixed;
  radius: Fixed;
  /** 0 = fire, 1 = physical */
  damageType: 0 | 1;
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
  damage: Fixed; damageType: 0 | 1;
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
  /** 0 = fire, 1 = physical */
  type: 0 | 1;
}
