// How much a kill pays. PoE1's drop tables are server-side and were never
// shipped, so nothing here is decompiled: the monster stat blocks below are
// datamined and exact, the channel structure is GGG's documented order of
// operations, and the two calibration constants are ours and marked as such.
//
// Pure leaf, integer-only (per-mille), same rules as the rest of the package.

/**
 * PoE's hidden MonsterMagic/MonsterRare/MonsterUnique blocks, indexed by our
 * `monsterRarity` 0..3 = normal, magic, rare, unique. These are the real
 * numbers: a magic monster carries "600% increased Quantity of Items Dropped",
 * a rare 1400%, a unique 2850%.
 */
export const MONSTER_QUANTITY_PCT: readonly number[] = [0, 600, 1400, 2850];
/** The same blocks' "increased Rarity of Items Dropped". */
export const MONSTER_RARITY_PCT: readonly number[] = [0, 200, 1000, 1000];
/** "Monster drops gear N levels above its own level". */
export const MONSTER_ILVL_OFFSET: readonly number[] = [0, 1, 2, 2];

/**
 * Chance a normal monster pays anything, before any modifier. PoE's own figure
 * is ~8%, measured, and it is the one number here that must NOT be copied: it
 * is calibrated against 200-600 monsters per map and we run six. Solving
 * `B * (5 normals + 1 rare + 1 boss) = 7 items` against the multipliers above
 * gives 14%, which lands a map within noise of the two hardcoded counts this
 * replaced while making the payout answer modifiers instead of ignoring them.
 */
export const BASE_DROP_PCT = 14;

/**
 * Diminishing returns on the player channel — the only channel PoE applies
 * them to, which is why map quantity is worth so much more than gear was.
 *
 * GGG has never published the curve. Fitted to the two data points the wiki
 * does give (50% -> 1.35x, 200% -> 1.77x):
 *
 *   DR(x) = 1 + x / (1 + x/1.25),  x = pct/100
 *
 * which returns 1.357x and 1.769x. Two points and one free parameter, so
 * `kPct` is a knob, not a discovery; the shape (hard asymptote at 1 + k, here
 * 2.25x) is the part worth keeping. Patch 0.9.9 says rarity's returns diminish
 * harder for the rarer tiers, so a tier that should saturate sooner passes a
 * smaller `kPct`.
 */
export function playerScaleMilli(pct: number, kPct = 125): number {
  if (pct <= 0) return 1000;
  return 1000 + Math.trunc((pct * 1000) / (100 + Math.trunc((pct * 100) / kPct)));
}

/** Per-mille product of per-mille multipliers. Channels multiply; within a channel, values add. */
function foldMilli(...milli: number[]): number {
  return milli.reduce((acc, m) => Math.trunc((acc * m) / 1000), 1000);
}

function channels(monsterPct: number, areaPct: number, playerPct: number, kPct?: number): number {
  return foldMilli(1000 + monsterPct * 10, 1000 + Math.max(0, areaPct) * 10, playerScaleMilli(playerPct, kPct));
}

/** The kill's quantity multiplier: monster rarity, area modifiers, player gear. */
export function quantityScaleMilli(monsterRarity: number, areaPct: number, playerPct: number): number {
  return channels(MONSTER_QUANTITY_PCT[monsterRarity] ?? 0, areaPct, playerPct);
}

/** The same three channels for rarity. `kPct` lets a rarer tier saturate sooner. */
export function rarityScaleMilli(monsterRarity: number, areaPct: number, playerPct: number, kPct?: number): number {
  return channels(MONSTER_RARITY_PCT[monsterRarity] ?? 0, areaPct, playerPct, kPct);
}

/**
 * Which category a drop belongs to, by weight — PoE's DropPool, minus the
 * categories we do not have. 3.28 shifted it hard toward currency ("Currency
 * Items now account for a significantly larger portion of dropped items ...
 * Non-Unique Equipment items are approximately 6% less common"), and it was
 * the right call: a white Rusted Sword is noise, an orb never is.
 *
 * A boss keeps its own equipment-weighted pool, the way PoE bosses carry their
 * own drop tables. docs/09 rule 3: the burst has to be the loud moment.
 */
export const DROP_POOL = { currency: 60, equipment: 40 } as const;
export const BOSS_DROP_POOL = { currency: 40, equipment: 60 } as const;

export function dropCategory(roll: number, pool: { currency: number; equipment: number }): "currency" | "equipment" {
  return (roll >>> 0) % (pool.currency + pool.equipment) < pool.currency ? "currency" : "equipment";
}

/**
 * How many items one kill drops. PoE's own overflow rule: the whole part is
 * guaranteed and the remainder is one coin flip, so scaling a monster past
 * 100% gives it a chance at a second item rather than a bigger first one.
 *
 * @param roll deterministic hash from the caller; only its low decades are used.
 */
export function dropCount(roll: number, monsterRarity: number, quantityMilli = 1000): number {
  const expected = Math.trunc((BASE_DROP_PCT * 10 * quantityScaleMilli(monsterRarity, 0, 0)) / 1000);
  const scaled = Math.trunc((expected * quantityMilli) / 1000);
  return Math.trunc(scaled / 1000) + ((roll >>> 0) % 1000 < scaled % 1000 ? 1 : 0);
}
