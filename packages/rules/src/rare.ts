import type { MonsterDef, RareModifier } from "@exiled/content-schema";

/**
 * Apply rare-tier multipliers to a normal MonsterDef. Returns a new object;
 * never mutates the original.
 */
export function makeRare(def: MonsterDef, mods: RareModifier): MonsterDef {
  return {
    ...def,
    maxLifeFixed: Math.trunc(def.maxLifeFixed * mods.lifeMulPct / 100),
    moveSpeedFixed: Math.trunc(def.moveSpeedFixed * mods.moveSpeedMulPct / 100),
    attackDamage: {
      ...def.attackDamage,
      amountFixed: Math.trunc(def.attackDamage.amountFixed * mods.damageMulPct / 100),
    },
    defenses: {
      ...def.defenses,
      fireResPct: def.defenses.fireResPct + mods.addedFireResPct,
    },
  };
}
