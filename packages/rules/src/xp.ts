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
 * at all. This shape holds the cost at roughly 15 normal-monster equivalents to
 * leave level 1 and 3,400 to leave 99, which is a few minutes against about ten
 * maps. `xp.test.ts` pins that band rather than the constant, so the constant
 * can be retuned without anyone having to guess what it was protecting.
 */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return 30 * level * level;
}

/**
 * What a kill is worth before the level-difference penalty. Area level is the
 * base, so a Tier 15 monster is worth more than a Tier 1 one for the same swing;
 * the multipliers say a rare is eight normals and a boss is forty, which is
 * roughly what their fight lengths are (see the tuning notes in
 * content-runtime/monsters.ts).
 */
const KIND_MULT = { normal: 1, rare: 8, boss: 40 } as const;
export type MonsterXpKind = keyof typeof KIND_MULT;

export function monsterXp(areaLevel: number, kind: MonsterXpKind): number {
  return areaLevel * KIND_MULT[kind];
}

/**
 * PoE's level-difference penalty, in the cheapest honest shape: full value while
 * the fight is roughly your level, then a decay to a floor. It is symmetric on
 * purpose — farming a tier you have outgrown pays as badly as overreaching one —
 * because that symmetry is the whole reason the Atlas has tiers. The floor keeps
 * a wildly mismatched kill worth *something*, so a character that overreached
 * still climbs out.
 */
export function xpPenaltyPct(charLevel: number, areaLevel: number): number {
  const diff = Math.abs(areaLevel - charLevel);
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
