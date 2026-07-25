import { fp, type Fixed } from "@exiled/fixed-point";

export interface StatBlock {
  maxLifeFixed: Fixed;
  maxManaFixed: Fixed;
  manaRegenPerSecFixed: Fixed;
  moveSpeedFixed: Fixed;   // units per second; systems derive per-tick
  fireResPct: number;      // integer, capped at RES_CAP on use, so gear may exceed it
  armourFixed: Fixed;
  spellDamagePct: number;  // integer; skillCast scales a spell hit by it
}

export const RES_CAP = 75;
/**
 * Armour's curve, borrowed from PoE2: DR = armour / (armour + MULT * hit). The
 * hit is in the denominator on purpose — armour is a defence against many small
 * hits, not against one large one. PoE1 uses the same shape with MULT = 5, a
 * gentler curve; PoE2's 10 is the one this game takes. Scale-free, so it
 * multiplies a Fixed without needing to be one.
 */
export const ARMOUR_DMG_MULT = 10;
/** Physical damage reduction is hard-capped, at 90% in both PoE1 and PoE2. */
export const PDR_CAP = 90;

export function baseCasterStats(): StatBlock {
  return {
    maxLifeFixed: fp(100),
    maxManaFixed: fp(60),
    manaRegenPerSecFixed: fp(6),
    moveSpeedFixed: fp(4.2),
    fireResPct: 0,
    armourFixed: fp(0),
    spellDamagePct: 0,
  };
}

/** One resolved gear mod: the affix's (or implicit's) `stat` id and its rolled value. */
export interface ItemStatMod {
  stat: string;
  value: number;
}

/**
 * Fold equipped-gear mods into a StatBlock. Flat adds land first and percent
 * increases scale the sum, which is PoE's order: "+60 to Armour" and "30%
 * increased Armour" on the same chest give 78, never 60 + 18-of-nothing.
 *
 * Only the stats the sim actually has a mechanic for are honoured. Energy
 * shield, the non-fire resistances, attributes, crit and cast speed roll and
 * render but land here as no-ops on purpose: each needs a mechanic that does
 * not exist yet, and silently mapping them onto a neighbouring stat would lie
 * louder than showing an inert line. Unknown ids are ignored, never thrown on,
 * so content can add a mod before the system that reads it.
 */
export function applyItemMods(base: StatBlock, mods: readonly ItemStatMod[]): StatBlock {
  const flat = { maxLife: 0, maxMana: 0, armour: 0 };
  const pct = { manaRegen: 0, armour: 0, spellDamage: 0, fireRes: 0 };
  for (const m of mods) {
    switch (m.stat) {
      case "maxLife": flat.maxLife += m.value; break;
      case "maxMana": flat.maxMana += m.value; break;
      case "armour": flat.armour += m.value; break;
      case "manaRegenPct": pct.manaRegen += m.value; break;
      case "armourPct": pct.armour += m.value; break;
      case "spellDamagePct": pct.spellDamage += m.value; break;
      case "fireResPct": pct.fireRes += m.value; break;
    }
  }
  const armourFlat = base.armourFixed + fp(flat.armour);
  return {
    ...base,
    maxLifeFixed: base.maxLifeFixed + fp(flat.maxLife),
    maxManaFixed: base.maxManaFixed + fp(flat.maxMana),
    manaRegenPerSecFixed: scalePct(base.manaRegenPerSecFixed, pct.manaRegen),
    armourFixed: scalePct(armourFlat, pct.armour),
    fireResPct: base.fireResPct + pct.fireRes,
    spellDamagePct: base.spellDamagePct + pct.spellDamage,
  };
}

/** trunc(v * (100 + pct) / 100). Integer-only, so it is replay-safe. */
export function scalePct(v: Fixed, pct: number): Fixed {
  return Math.trunc((v * (100 + pct)) / 100);
}
