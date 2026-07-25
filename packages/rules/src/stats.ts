import { fp, type Fixed } from "@exiled/fixed-point";
import { ELEMENTS, resBlock, type Element, type ResBlock } from "@exiled/content-schema";

export interface StatBlock {
  maxLifeFixed: Fixed;
  maxEnergyShieldFixed: Fixed;
  maxManaFixed: Fixed;
  manaRegenPerSecFixed: Fixed;
  moveSpeedFixed: Fixed;   // units per second; systems derive per-tick
  resPct: ResBlock;        // integers, capped at RES_CAP on use, so gear may exceed it
  armourFixed: Fixed;
  spellDamagePct: number;  // integer; skillCast scales a spell hit by it
  castSpeedPct: number;    // integer; skillCast shortens a spell's cast time by it
}

export const RES_CAP = 75;
/** Gear mod id -> the element it resists. One entry per ELEMENTS member. */
const RES_STAT_ELEMENT: Readonly<Record<string, Element | undefined>> = {
  fireResPct: "fire",
  coldResPct: "cold",
  lightningResPct: "lightning",
  chaosResPct: "chaos",
};
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

/**
 * Both PoE games regenerate mana as a percentage of the pool — PoE2 4%/s, PoE1
 * 1.75%/s — and this game does not, deliberately. That percentage only feels
 * playable in PoE because the pool grows all game (level, intelligence, gear)
 * while a skill's cost barely does, so a level-1 PoE2 caster with 34 mana really
 * does regenerate one Fireball every six seconds and really is expected to stand
 * there. Nothing here grows: one character, one pool, one cost. Copying the
 * percentage would copy the act-1 starvation and never the endgame that pays it
 * off, so what is matched is the outcome instead — roughly two casts a second
 * sustained, which is where a PoE2 caster lands once its build comes online.
 *
 * fp(15) is the measured number for that: against the retuned Warden it reads
 * 2.18 casts/s of a 3.75/s ceiling, where fp(6) read 1.05. It also divides
 * exactly by the 30 Hz tick (500 per tick), so the pool grows at the same rate a
 * player computing it on paper would expect. Held by `balance.test.ts`.
 */
export function baseCasterStats(): StatBlock {
  return {
    maxLifeFixed: fp(100),
    // No base energy shield: it is entirely a gear stat, the way PoE2 has it —
    // a character with no ES gear has none, and the pool simply does not exist.
    maxEnergyShieldFixed: fp(0),
    maxManaFixed: fp(60),
    manaRegenPerSecFixed: fp(15),
    moveSpeedFixed: fp(4.2),
    resPct: resBlock(),
    armourFixed: fp(0),
    spellDamagePct: 0,
    castSpeedPct: 0,
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
 * Only the stats the sim actually has a mechanic for are honoured. Attributes,
 * crit and cast speed roll and render but land here as
 * no-ops on purpose: each needs a mechanic that does not exist yet, and
 * silently mapping them onto a neighbouring stat would lie louder than showing
 * an inert line. Unknown ids are ignored, never thrown on, so content can add a
 * mod before the system that reads it.
 */
export function applyItemMods(base: StatBlock, mods: readonly ItemStatMod[]): StatBlock {
  const flat = { maxLife: 0, maxMana: 0, armour: 0, energyShield: 0 };
  const pct = { manaRegen: 0, armour: 0, spellDamage: 0, energyShield: 0, castSpeed: 0 };
  const res = resBlock();
  for (const m of mods) {
    const el = RES_STAT_ELEMENT[m.stat];
    if (el !== undefined) {
      res[el] += m.value;
      continue;
    }
    switch (m.stat) {
      case "maxLife": flat.maxLife += m.value; break;
      case "maxMana": flat.maxMana += m.value; break;
      case "armour": flat.armour += m.value; break;
      case "energyShield": flat.energyShield += m.value; break;
      case "energyShieldPct": pct.energyShield += m.value; break;
      case "manaRegenPct": pct.manaRegen += m.value; break;
      case "armourPct": pct.armour += m.value; break;
      case "spellDamagePct": pct.spellDamage += m.value; break;
      case "castSpeedPct": pct.castSpeed += m.value; break;
    }
  }
  const armourFlat = base.armourFixed + fp(flat.armour);
  const resPct = resBlock();
  for (const el of ELEMENTS) resPct[el] = base.resPct[el] + res[el];
  return {
    ...base,
    resPct,
    maxLifeFixed: base.maxLifeFixed + fp(flat.maxLife),
    maxEnergyShieldFixed: scalePct(base.maxEnergyShieldFixed + fp(flat.energyShield), pct.energyShield),
    maxManaFixed: base.maxManaFixed + fp(flat.maxMana),
    manaRegenPerSecFixed: scalePct(base.manaRegenPerSecFixed, pct.manaRegen),
    armourFixed: scalePct(armourFlat, pct.armour),
    spellDamagePct: base.spellDamagePct + pct.spellDamage,
    castSpeedPct: base.castSpeedPct + pct.castSpeed,
  };
}

/** trunc(v * (100 + pct) / 100). Integer-only, so it is replay-safe. */
export function scalePct(v: Fixed, pct: number): Fixed {
  return Math.trunc((v * (100 + pct)) / 100);
}
