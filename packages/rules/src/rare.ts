import type { MonsterDef, RareModifier } from "@exiled/content-schema";

/**
 * Apply rare-tier multipliers to a normal MonsterDef. Returns a new object;
 * never mutates the original.
 */
export function makeRare(def: MonsterDef, mods: RareModifier): MonsterDef {
  return {
    ...def,
    name: `${mods.namePrefix} ${def.name}`,
    maxLifeFixed: Math.trunc(def.maxLifeFixed * mods.lifeMulPct / 100),
    moveSpeedFixed: Math.trunc(def.moveSpeedFixed * mods.moveSpeedMulPct / 100),
    // The rare's whole hit converts to its element. PoE splits added elemental
    // damage off the base hit; converting outright is the version a sim with
    // one damage packet per attack can carry, and it is what makes the theme
    // legible: a Storm-Touched pack is answered by lightning resistance, not by
    // armour.
    attackDamage: {
      type: mods.element,
      amountFixed: Math.trunc(def.attackDamage.amountFixed * mods.damageMulPct / 100),
    },
    defenses: {
      ...def.defenses,
      resPct: {
        ...def.defenses.resPct,
        [mods.element]: def.defenses.resPct[mods.element] + mods.addedResPct,
      },
    },
  };
}
