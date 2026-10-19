import type { MonsterDef, RareModifier } from "@exiled/content-schema";

/** PoE's magic monster carries +30% damage; life is doubled, not PoE's +148%, because a pack here is a handful of bodies. */
const MAGIC_LIFE_MUL_PCT = 200;
const MAGIC_DAMAGE_MUL_PCT = 130;

/**
 * A magic monster: the same creature, tougher and harder-hitting. PoE rolls one
 * modifier per magic monster; this has none yet, only the stat block, so its
 * element and resistances stay the base's.
 */
export function makeMagic(def: MonsterDef): MonsterDef {
  return {
    ...def,
    maxLifeFixed: Math.trunc(def.maxLifeFixed * MAGIC_LIFE_MUL_PCT / 100),
    attackDamage: { ...def.attackDamage, amountFixed: Math.trunc(def.attackDamage.amountFixed * MAGIC_DAMAGE_MUL_PCT / 100) },
  };
}

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
