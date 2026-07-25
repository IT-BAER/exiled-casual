// Character experience and level. Pure integers, like every other rule the sim
// reads: a level-up happens inside a tick and has to replay identically.

/**
 * The character starts where PoE2's endgame does. This game has no campaign —
 * `areaLevel(0)` is already 64 — so a level-1 character would spend its whole
 * life fighting things thirty levels above it and the level-difference penalty
 * below would read as a permanent tax rather than a choice. Starting at 65 puts
 * the character in the same band as the maps it can actually open, which is what
 * makes pushing tier a decision: a higher tier pays more per kill and is worth
 * the risk only once you have the level to collect it.
 */
export const START_LEVEL = 65;
/** Both PoE games stop at 100, and so does this one. */
export const MAX_LEVEL = 100;

/** Experience needed to leave `level`. Zero at the cap: nothing to buy. */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return 60_000 + 40_000 * Math.max(0, level - START_LEVEL);
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
 * with every affix. Six life and two mana a level is 210/70 over the whole
 * climb — about two chest pieces' worth across 35 levels.
 */
export function levelBonus(level: number): { maxLife: number; maxMana: number } {
  const n = Math.max(0, level - START_LEVEL);
  return { maxLife: 6 * n, maxMana: 2 * n };
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
