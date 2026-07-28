import { fp } from "@exiled/fixed-point";
import {
  resBlock,
  validateMonsterDef,
  type BiomeId,
  type MonsterArchetype,
  type MonsterDef,
  type RareModifier,
} from "@exiled/content-schema";

const MONSTER_DEFS: MonsterDef[] = [
  {
    id: "monster.cinder_imp.v1",
    name: "Cinder Imp",
    archetype: "swarm",
    maxLifeFixed: fp(40),
    moveSpeedFixed: fp(2.4),
    attackRangeFixed: fp(1.2),
    attackDamage: { type: "physical", amountFixed: fp(6) },
    attackCooldownTicks: 45,
    radiusFixed: fp(0.5),
    defenses: { resPct: resBlock(), armourFixed: fp(0.5) },
  },
  {
    id: "monster.cinder_warden.v1",
    name: "Cinder Warden",
    archetype: "brute",
    // Life and fire resistance are one budget, because every skill the player
    // owns is fire: 750 life behind 40% res is 1250 effective, which measured at
    // 56s of mana-starved poking (balance.test.ts). The Warden stays
    // fire-flavoured at 25; 40% against the only element in the game is a wall,
    // not a choice.
    //
    // 840 is not a difficulty raise, it is the same 20-second fight bought back
    // after the mana economy doubled what the player spends inside it: at the old
    // 420 the retuned caster cleared this in 10.1s. Fight length is the design
    // intent and life is the knob that holds it, so life follows player damage.
    maxLifeFixed: fp(840),
    moveSpeedFixed: fp(1.8),
    attackRangeFixed: fp(2.2),
    attackDamage: { type: "physical", amountFixed: fp(10) },
    attackCooldownTicks: 60,
    radiusFixed: fp(1.4),
    defenses: { resPct: resBlock({ fire: 25 }), armourFixed: fp(3) },
    boss: {
      phase2AtLifePct: 50,
      slam: { windupTicks: 30, radiusFixed: fp(3.5), damageFixed: fp(28), cooldownTicks: 150, rangeFixed: fp(9) },
      phase2: {
        fireGroundDurationTicks: 120,
        addCount: 2,
        addDefId: "monster.cinder_imp.v1",
        cadenceMulPct: 70,
        // dps is per stack, and the patch reapplies every 6 ticks, so a player
        // standing in it is at maxStacks within a second: the number that matters
        // is 5 x dps = 20/s, not 4. At fp(12) that was 60/s, which burned the base
        // 100 life pool in 1.7s — a patch you cannot react to, only pre-dodge.
        fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(4), durationTicks: 60, maxStacks: 5 },
      },
    },
  },

  // --- Vaal Stone: swarm, brute, heavy. A dead city fields foot soldiers,
  // constructs and one thing that swings something too big for a corridor.
  {
    id: "monster.vaal_husk.v1", name: "Vaal Husk", archetype: "swarm",
    maxLifeFixed: fp(24), moveSpeedFixed: fp(3.0), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: fp(4) },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock(), armourFixed: fp(0) },
  },
  {
    id: "monster.vaal_construct.v1", name: "Vaal Construct", archetype: "brute",
    maxLifeFixed: fp(140), moveSpeedFixed: fp(1.45), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: fp(13) },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock(), armourFixed: fp(4) },
  },
  {
    id: "monster.blood_sentinel.v1", name: "Blood Sentinel", archetype: "heavy",
    maxLifeFixed: fp(88), moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.8),
    attackDamage: { type: "chaos", amountFixed: fp(8) },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ chaos: 30 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Desert: swarm, shooter, heavy. Nothing here holds a line; it circles.
  {
    id: "monster.sand_skitterer.v1", name: "Sand Skitterer", archetype: "swarm",
    maxLifeFixed: fp(24), moveSpeedFixed: fp(3.0), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: fp(4) },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock({ fire: 20 }), armourFixed: fp(0) },
  },
  {
    id: "monster.dune_spitter.v1", name: "Dune Spitter", archetype: "shooter",
    maxLifeFixed: fp(32), moveSpeedFixed: fp(2.15), attackRangeFixed: fp(7.5),
    attackDamage: { type: "chaos", amountFixed: fp(8) },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ chaos: 25 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
  {
    id: "monster.sunbaked_colossus.v1", name: "Sunbaked Colossus", archetype: "heavy",
    maxLifeFixed: fp(88), moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.8),
    // 25 and not 40: fire is the only element the player owns, and 40% against
    // it is a wall rather than a choice — the same reasoning that set the
    // Warden's fire resistance below.
    attackDamage: { type: "fire", amountFixed: fp(8) },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ fire: 25 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Swamp: brute, shooter, heavy. Slow, wet, and nothing you can outrun in a line.
  {
    id: "monster.bog_drowned.v1", name: "Bog Drowned", archetype: "brute",
    maxLifeFixed: fp(140), moveSpeedFixed: fp(1.45), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: fp(13) },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock({ cold: 20 }), armourFixed: fp(3) },
  },
  {
    id: "monster.fen_wisp.v1", name: "Fen Wisp", archetype: "shooter",
    maxLifeFixed: fp(32), moveSpeedFixed: fp(2.15), attackRangeFixed: fp(7.5),
    attackDamage: { type: "lightning", amountFixed: fp(8) },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ lightning: 30 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
  {
    id: "monster.rotting_behemoth.v1", name: "Rotting Behemoth", archetype: "heavy",
    maxLifeFixed: fp(88), moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.8),
    attackDamage: { type: "physical", amountFixed: fp(8) },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ chaos: 20 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Forest: swarm, brute, shooter. The only biome with nothing to dodge,
  // and the only one that never lets you stand still.
  {
    id: "monster.bramble_whelp.v1", name: "Bramble Whelp", archetype: "swarm",
    maxLifeFixed: fp(24), moveSpeedFixed: fp(3.0), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: fp(4) },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock(), armourFixed: fp(0) },
  },
  {
    id: "monster.thornhide_boar.v1", name: "Thornhide Boar", archetype: "brute",
    maxLifeFixed: fp(140), moveSpeedFixed: fp(1.45), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: fp(13) },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock({ cold: 15 }), armourFixed: fp(3) },
  },
  {
    id: "monster.hoarfrost_spitter.v1", name: "Hoarfrost Spitter", archetype: "shooter",
    maxLifeFixed: fp(32), moveSpeedFixed: fp(2.15), attackRangeFixed: fp(7.5),
    attackDamage: { type: "cold", amountFixed: fp(8) },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ cold: 30 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
];

// Validate at module load — bad content is a programmer error, fail fast.
for (const def of MONSTER_DEFS) {
  const r = validateMonsterDef(def);
  if (!r.ok) {
    throw new Error(
      `[content-runtime] Invalid monster def "${def.id}": ${r.errors.join("; ")}`,
    );
  }
}

export const MONSTERS: ReadonlyMap<string, MonsterDef> = new Map(
  MONSTER_DEFS.map((d) => [d.id, d]),
);

/**
 * One rare template per element. PoE's rares carry rolled modifiers that force
 * a different defence pack to pack; this is the cheapest honest version of
 * that: the rare's hit converts to its element and it resists that element, so
 * every resistance on the character sheet answers a monster that actually
 * exists. The multipliers are shared — only the element, its resistance and the
 * name differ.
 *
 * The life and damage multipliers are set by measurement, not by feel — see
 * `simulation/src/balance.test.ts`. At 250%/150% a rare died in 0.9s, faster
 * than a five-imp pack, and landed one 9-damage hit in its whole life: the
 * resistance it demands could never be felt. Life buys it past the player's
 * opening burst, and 300% damage makes one hit ~18% of a base life pool, which
 * is the size at which halving it is worth a res roll.
 *
 * 900%, up from 600%, is the mana retune reaching the small fights too: at 600 a
 * non-fire rare fell in 1.63s, back under the pack it is supposed to outlast. At
 * 900 it is 3.2s and its fire cousin 6.4s, so resisting the player's only
 * element still roughly doubles the fight.
 */
export const RARE_TEMPLATES: readonly RareModifier[] = (
  [
    ["fire", "Cinder-Touched"],
    ["cold", "Frost-Touched"],
    ["lightning", "Storm-Touched"],
    ["chaos", "Blight-Touched"],
  ] as const
).map(([element, namePrefix]) => ({
  lifeMulPct: 900,
  moveSpeedMulPct: 120,
  damageMulPct: 300,
  element,
  addedResPct: 30,
  namePrefix,
}));

/**
 * Pick a rare's elemental theme from any integer (a seed, a hash). Deterministic
 * and total, so a replay picks the same rare twice; hashing is the caller's job
 * because content must not depend on the sim's rng.
 */
export function rareTemplate(n: number): RareModifier {
  const i = Math.abs(Math.trunc(n)) % RARE_TEMPLATES.length;
  return RARE_TEMPLATES[i]!;
}

/**
 * How many of an archetype stand at one spawn socket. Content's number, not the
 * generator's: "a swarm is four" is a fact about the monster. The layout still
 * owns *where* a fight may stand — a modifier must never be able to put a
 * monster inside a wall.
 */
export const PACK_COUNT: Record<MonsterArchetype, number> = {
  swarm: 4, brute: 1, shooter: 2, heavy: 1,
};

export interface PoolEntry { defId: string; weight: number }

/**
 * Three species per biome, and each biome a different three-of-four, so no two
 * biomes ask the same question. A heavy is the rarest roll in any pool because
 * it is the loudest: three in a map is a fight, ten is a chore.
 */
export const MONSTER_POOLS: Record<BiomeId, readonly PoolEntry[]> = {
  vaal_stone: [
    { defId: "monster.vaal_husk.v1", weight: 3 },
    { defId: "monster.vaal_construct.v1", weight: 2 },
    { defId: "monster.blood_sentinel.v1", weight: 1 },
  ],
  desert: [
    { defId: "monster.sand_skitterer.v1", weight: 3 },
    { defId: "monster.dune_spitter.v1", weight: 2 },
    { defId: "monster.sunbaked_colossus.v1", weight: 1 },
  ],
  swamp: [
    { defId: "monster.bog_drowned.v1", weight: 2 },
    { defId: "monster.fen_wisp.v1", weight: 2 },
    { defId: "monster.rotting_behemoth.v1", weight: 1 },
  ],
  forest: [
    { defId: "monster.bramble_whelp.v1", weight: 3 },
    { defId: "monster.thornhide_boar.v1", weight: 2 },
    { defId: "monster.hoarfrost_spitter.v1", weight: 2 },
  ],
};

// Referential integrity at module load, beside the def validation above: a pool
// naming a monster that does not exist is a programmer error, not a runtime one.
for (const [biome, pool] of Object.entries(MONSTER_POOLS)) {
  for (const entry of pool) {
    if (!MONSTERS.has(entry.defId)) {
      throw new Error(`[content-runtime] Pool "${biome}" names unknown monster "${entry.defId}"`);
    }
  }
}

/**
 * Which species fills one spawn socket. Total and deterministic; the caller
 * supplies the randomness, exactly as `rareTemplate` takes an integer, so
 * content never depends on the sim's rng. `roll` is clamped, so an out-of-range
 * value picks an end of the pool rather than throwing mid-run.
 */
export function pickPack(biomeId: BiomeId, roll: number): MonsterDef {
  const pool = MONSTER_POOLS[biomeId];
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  const clamped = roll < 0 ? 0 : roll >= 1 ? 0.999999 : roll;
  let n = clamped * total;
  for (const entry of pool) {
    n -= entry.weight;
    if (n < 0) return MONSTERS.get(entry.defId)!;
  }
  return MONSTERS.get(pool[pool.length - 1]!.defId)!;
}
