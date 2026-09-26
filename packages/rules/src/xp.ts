// Character experience and level. Pure integers, like every other rule the sim
// reads: a level-up happens inside a tick and has to replay identically.

/**
 * A character starts at 1. The Atlas is rescaled to meet him there
 * (`atlas.ts`: tier 0 is area level 2), so the level-difference penalty is a
 * choice about which tier to run, never a permanent tax for existing.
 */
export const START_LEVEL = 1;
/** Both PoE games stop at 100, and so does this one. */
export const MAX_LEVEL = 100;

/**
 * Experience needed to leave `level`. Zero at the cap: nothing to buy.
 *
 * Quadratic, because a kill's value only grows LINEARLY with area level: a
 * cubic curve outruns what the player can earn and the late game stops paying
 * at all. The flat 60 is for the bottom only: with kills front-loaded (see
 * `monsterXp`) level 1 would otherwise cost one kill, and a level that costs
 * one kill is noise. It is gone in the rounding by level 10. `xp.test.ts` pins that band rather
 * than the constant, so the constant can be retuned without anyone having to
 * guess what it was protecting.
 */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return 30 * level * level + 60;
}

/**
 * What a kill is worth before the level-difference penalty. Area level plus a
 * flat 20 is the base, so a Tier 15 monster is worth more than a Tier 1 one for
 * the same swing, but the first maps pay 3.5x their area level against 1.2x at
 * the top: without it a character was 13 levels under his third map and died
 * there 2-3 times a run (simulation/src/playtest.ts);
 * the multipliers say a rare is eight normals and a boss is forty, which is
 * roughly what their fight lengths are (see the tuning notes in
 * content-runtime/monsters.ts).
 */
const KIND_MULT = { normal: 1, rare: 8, boss: 40 } as const;
const XP_AREA_OFFSET = 20;
export type MonsterXpKind = keyof typeof KIND_MULT;

export function monsterXp(areaLevel: number, kind: MonsterXpKind): number {
  return (areaLevel + XP_AREA_OFFSET) * KIND_MULT[kind];
}

/**
 * PoE's level-difference penalty, in the cheapest honest shape: full value while
 * the fight is roughly your level, then a decay to a floor. Only outlevelling an
 * area is penalised — farming a tier you have outgrown pays badly, which is why
 * the Atlas has tiers — while overreaching pays in full: the danger is its own
 * cost, and a penalty on top kept an under-levelled character stuck (playtest.ts).
 */
export function xpPenaltyPct(charLevel: number, areaLevel: number): number {
  const diff = Math.max(0, charLevel - areaLevel);
  if (diff <= 3) return 100;
  return Math.max(10, 100 - 10 * (diff - 3));
}

/** One kill's experience: its value, penalised, truncated to an integer. */
export function xpAward(charLevel: number, areaLevel: number, kind: MonsterXpKind): number {
  return Math.trunc((monsterXp(areaLevel, kind) * xpPenaltyPct(charLevel, areaLevel)) / 100);
}

/**
 * What levelling itself grants. Deliberately small and flat: gear is where this
 * game's power lives, and a level that handed out a percentage would compound
 * with every affix. The whole-climb total is unchanged from the 65-100 era -
 * 210 life and 70 mana - so spreading it over 99 levels makes each level
 * smaller, never the climb richer. Computed from the total rather than from a
 * per-level rate so it lands exactly on 210/70 at the cap instead of drifting.
 */
export function levelBonus(level: number): { maxLife: number; maxMana: number } {
  const n = Math.min(Math.max(level, START_LEVEL), MAX_LEVEL) - START_LEVEL;
  const span = MAX_LEVEL - START_LEVEL;
  return {
    maxLife: Math.trunc((210 * n) / span),
    maxMana: Math.trunc((70 * n) / span),
  };
}

/** Apply an award. Loops, so one boss can carry a character past two thresholds. */
export function gainXp(level: number, xp: number, amount: number): { level: number; xp: number } {
  if (level >= MAX_LEVEL) return { level: MAX_LEVEL, xp: 0 };
  let lv = level;
  let acc = xp + amount;
  while (lv < MAX_LEVEL && acc >= xpToNext(lv)) {
    acc -= xpToNext(lv);
    lv++;
  }
  return lv >= MAX_LEVEL ? { level: MAX_LEVEL, xp: 0 } : { level: lv, xp: acc };
}
