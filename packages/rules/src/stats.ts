import { fp, type Fixed } from "@pact/fixed-point";

export interface StatBlock {
  maxLifeFixed: Fixed;
  maxManaFixed: Fixed;
  manaRegenPerSecFixed: Fixed;
  moveSpeedFixed: Fixed;   // units per second; systems derive per-tick
  fireResPct: number;      // integer 0..100, capped at RES_CAP on use
  armourFixed: Fixed;
}

export const RES_CAP = 75;
export const ARMOUR_K: Fixed = fp(10); // = 10000; armour == K halves a physical hit

export function baseCasterStats(): StatBlock {
  return {
    maxLifeFixed: fp(100),
    maxManaFixed: fp(60),
    manaRegenPerSecFixed: fp(6),
    moveSpeedFixed: fp(4.2),
    fireResPct: 0,
    armourFixed: fp(0),
  };
}
