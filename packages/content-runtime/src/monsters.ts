import { fp } from "@exiled/fixed-point";
import {
  resBlock,
  validateMonsterDef,
  type BiomeId,
  type MonsterArchetype,
  type MonsterDef,
  type RareModifier,
} from "@exiled/content-schema";

// Move speed is per archetype against the player's 4.2 (rules/stats.ts): swarm
// 2.9, brute 2.0, shooter 1.8, heavy 1.7 (~15-18% below their old 3.5/2.4/2.2/2.0,
// eased so a walking player stays in front of a pack rather than getting run down).
// Nothing here used to break 3.0, so a player who kept walking could not be
// touched. Bosses stay slow and telegraph.

/**
 * Life and hit are per ARCHETYPE, not per species: what changes biome to biome is
 * the element and the flavour, so these are one knob each rather than seventeen
 * numbers that drift apart. Every species below reads them; only the Imp and the
 * bosses carry their own, because they are not one of a kind.
 *
 * Casual pass: -25% life, -30% hit against the numbers `balance.test.ts` had
 * measured. His reading is that the first map is too hard for a casual player,
 * and both halves of that are here — a character has 100 life and NO
 * regeneration, so the hit is what kills, and life is what makes a clear a war
 * of attrition. Every band in `balance.test.ts` moved with this and was
 * re-measured against the same rig, not re-argued.
 */
const LIFE = {
  swarm: fp(66),    // was 88
  brute: fp(345),   // was 460
  shooter: fp(81),  // was 108
  heavy: fp(360),   // was 480
  boss: fp(630),    // was 840
} as const;
const HIT = {
  swarm: fp(3),     // was 4
  brute: fp(9),     // was 13
  shooter: fp(6),   // was 8
  heavy: fp(6),     // was 8
} as const;

const MONSTER_DEFS: MonsterDef[] = [
  {
    id: "monster.cinder_imp.v1",
    name: "Cinder Imp",
    archetype: "swarm",
    // The Imp keeps its own numbers: it is in no biome pool, only the Warden's
    // phase-2 brood and the test lab. Its life stays where it was — one Ember
    // Bolt is 36, and an imp that dies to a single bolt takes the mitigation
    // arithmetic out of every golden replay that measures a hit on one. Only
    // what it HITS for follows the casual pass.
    maxLifeFixed: fp(40),
    moveSpeedFixed: fp(2.6),
    attackRangeFixed: fp(1.2),
    attackDamage: { type: "physical", amountFixed: fp(4) },
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
    maxLifeFixed: LIFE.boss,
    moveSpeedFixed: fp(1.35),
    attackRangeFixed: fp(2.2),
    attackDamage: { type: "physical", amountFixed: fp(7) },
    attackCooldownTicks: 60,
    radiusFixed: fp(1.4),
    defenses: { resPct: resBlock({ fire: 25 }), armourFixed: fp(3) },
    boss: {
      phase2AtLifePct: 50,
      slam: { windupTicks: 30, radiusFixed: fp(3.5), damageFixed: fp(20), cooldownTicks: 150, rangeFixed: fp(9) },
      phase2: {
        fireGroundDurationTicks: 120,
        addCount: 2,
        addDefId: "monster.cinder_imp.v1",
        cadenceMulPct: 70,
        // dps is per stack, and the patch reapplies every 6 ticks, so a player
        // standing in it is at maxStacks within a second: the number that matters
        // is 5 x dps = 20/s, not 4. At fp(12) that was 60/s, which burned the base
        // 100 life pool in 1.7s — a patch you cannot react to, only pre-dodge.
        fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(3), durationTicks: 60, maxStacks: 5 },
      },
    },
  },

  // --- One boss per map base. Every ordinary map ends on a boss kill, so until
  // now every map in the game ended on the SAME fight: the Warden, whichever
  // biome you were standing in. These three are the other biomes' own.
  //
  // They share the Warden's life budget on purpose — a map boss is a ~20 second
  // fight and that is the design intent, not a per-species number — and differ
  // in the shape of the question they ask. `balance.test.ts` measures all four
  // against the same band, and the numbers below are what it measured.
  {
    id: "monster.sirrath.v1",
    name: "Sirrath, Sun-Priest of the Kiln",
    archetype: "brute",
    // Desert. Asks: can you close? It never stops dropping motes, but each one
    // is small and slow to land. The long range is the whole fight — standing
    // where you killed the last pack is not a plan.
    maxLifeFixed: LIFE.boss,
    moveSpeedFixed: fp(1.15),
    attackRangeFixed: fp(2.0),
    attackDamage: { type: "fire", amountFixed: fp(6) },
    attackCooldownTicks: 60,
    radiusFixed: fp(1.4),
    defenses: { resPct: resBlock({ fire: 25 }), armourFixed: fp(2) },
    boss: {
      phase2AtLifePct: 50,
      // Half the Warden's radius at nearly twice its cadence and range: the same
      // pressure spread thinner, so it punishes standing rather than misreading.
      slam: { windupTicks: 26, radiusFixed: fp(2.3), damageFixed: fp(14), cooldownTicks: 96, rangeFixed: fp(12) },
      phase2: {
        fireGroundDurationTicks: 150,
        addCount: 4,
        addDefId: "monster.sand_skitterer.v1",
        cadenceMulPct: 62,
        fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(2), durationTicks: 60, maxStacks: 5 },
      },
    },
  },
  {
    id: "monster.mother_vhal.v1",
    name: "Mother Vhal, the Drowned",
    archetype: "brute",
    // Swamp. Asks: do you kill the adds or the mother? One enormous, slow,
    // unmissable circle, and a brood that keeps arriving while you decide.
    maxLifeFixed: LIFE.boss,
    moveSpeedFixed: fp(1.0),
    attackRangeFixed: fp(2.6),
    attackDamage: { type: "chaos", amountFixed: fp(8) },
    attackCooldownTicks: 66,
    radiusFixed: fp(1.4),
    defenses: { resPct: resBlock({ chaos: 30 }), armourFixed: fp(3) },
    boss: {
      phase2AtLifePct: 55,
      // 5 units across with a 48-tick wind-up: it cannot be dodged by reaction
      // and does not need to be. It is a question about where you were standing
      // a second and a half ago.
      slam: { windupTicks: 48, radiusFixed: fp(5.0), damageFixed: fp(22), cooldownTicks: 186, rangeFixed: fp(8) },
      phase2: {
        fireGroundDurationTicks: 180,
        addCount: 3,
        addDefId: "monster.fen_wisp.v1",
        cadenceMulPct: 80,
        fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(3), durationTicks: 60, maxStacks: 5 },
      },
    },
  },
  {
    id: "monster.ghaltrek.v1",
    name: "Ghaltrek, the Bramble King",
    archetype: "brute",
    // Forest. Asks: can you keep moving? The fastest thing with a boss bar in
    // the game, on the shortest wind-up, and it does not leave ground you can
    // read — the danger is where it IS, not where it was.
    maxLifeFixed: LIFE.boss,
    moveSpeedFixed: fp(2.0),
    attackRangeFixed: fp(2.4),
    attackDamage: { type: "physical", amountFixed: fp(8) },
    attackCooldownTicks: 52,
    radiusFixed: fp(1.4),
    defenses: { resPct: resBlock({ cold: 20 }), armourFixed: fp(4) },
    boss: {
      phase2AtLifePct: 45,
      slam: { windupTicks: 21, radiusFixed: fp(3.0), damageFixed: fp(16), cooldownTicks: 108, rangeFixed: fp(7) },
      phase2: {
        fireGroundDurationTicks: 90,
        addCount: 3,
        addDefId: "monster.bramble_whelp.v1",
        cadenceMulPct: 70,
        fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(3), durationTicks: 60, maxStacks: 5 },
      },
    },
  },

  // --- Vaal Stone: swarm, brute, heavy. A dead city fields foot soldiers,
  // constructs and one thing that swings something too big for a corridor.
  {
    id: "monster.vaal_husk.v1", name: "Vaal Husk", archetype: "swarm",
    maxLifeFixed: LIFE.swarm, moveSpeedFixed: fp(2.6), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: HIT.swarm },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock(), armourFixed: fp(0) },
  },
  {
    id: "monster.vaal_construct.v1", name: "Vaal Construct", archetype: "brute",
    maxLifeFixed: LIFE.brute, moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: HIT.brute },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock(), armourFixed: fp(4) },
  },
  {
    id: "monster.blood_sentinel.v1", name: "Blood Sentinel", archetype: "heavy",
    maxLifeFixed: LIFE.heavy, moveSpeedFixed: fp(1.55), attackRangeFixed: fp(1.8),
    attackDamage: { type: "chaos", amountFixed: HIT.heavy },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ chaos: 30 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(15), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Desert: swarm, shooter, heavy. Nothing here holds a line; it circles.
  {
    id: "monster.sand_skitterer.v1", name: "Sand Skitterer", archetype: "swarm",
    maxLifeFixed: LIFE.swarm, moveSpeedFixed: fp(2.6), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: HIT.swarm },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock({ fire: 20 }), armourFixed: fp(0) },
  },
  {
    id: "monster.dune_spitter.v1", name: "Dune Spitter", archetype: "shooter",
    maxLifeFixed: LIFE.shooter, moveSpeedFixed: fp(1.6), attackRangeFixed: fp(7.5),
    attackDamage: { type: "chaos", amountFixed: HIT.shooter },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ chaos: 25 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
  {
    id: "monster.sunbaked_colossus.v1", name: "Sunbaked Colossus", archetype: "heavy",
    // 25% fire res not 40% for the same reason as the Warden: fire is the only
    // element the player owns.
    maxLifeFixed: LIFE.heavy, moveSpeedFixed: fp(1.55), attackRangeFixed: fp(1.8),
    attackDamage: { type: "fire", amountFixed: HIT.heavy },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ fire: 25 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(15), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Swamp: brute, shooter, heavy. Slow, wet, and nothing you can outrun in a line.
  {
    id: "monster.bog_drowned.v1", name: "Bog Drowned", archetype: "brute",
    maxLifeFixed: LIFE.brute, moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: HIT.brute },
    // 0.55, not the brute archetype's 0.85: the drowned is a slim humanoid
    // (mesh reach 0.58) and the copied radius detonated bolts on empty air.
    attackCooldownTicks: 75, radiusFixed: fp(0.55),
    defenses: { resPct: resBlock({ cold: 20 }), armourFixed: fp(3) },
  },
  {
    id: "monster.fen_wisp.v1", name: "Fen Wisp", archetype: "shooter",
    maxLifeFixed: LIFE.shooter, moveSpeedFixed: fp(1.6), attackRangeFixed: fp(7.5),
    attackDamage: { type: "lightning", amountFixed: HIT.shooter },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ lightning: 30 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
  {
    id: "monster.rotting_behemoth.v1", name: "Rotting Behemoth", archetype: "heavy",
    maxLifeFixed: LIFE.heavy, moveSpeedFixed: fp(1.55), attackRangeFixed: fp(1.8),
    attackDamage: { type: "physical", amountFixed: HIT.heavy },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ chaos: 20 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(15), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Forest: swarm, brute, shooter. The only biome with nothing to dodge,
  // and the only one that never lets you stand still.
  {
    id: "monster.bramble_whelp.v1", name: "Bramble Whelp", archetype: "swarm",
    maxLifeFixed: LIFE.swarm, moveSpeedFixed: fp(2.6), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: HIT.swarm },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock(), armourFixed: fp(0) },
  },
  {
    id: "monster.thornhide_boar.v1", name: "Thornhide Boar", archetype: "brute",
    maxLifeFixed: LIFE.brute, moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: HIT.brute },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock({ cold: 15 }), armourFixed: fp(3) },
  },
  {
    id: "monster.hoarfrost_spitter.v1", name: "Hoarfrost Spitter", archetype: "shooter",
    maxLifeFixed: LIFE.shooter, moveSpeedFixed: fp(1.6), attackRangeFixed: fp(7.5),
    attackDamage: { type: "cold", amountFixed: HIT.shooter },
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
 * A different mix of archetypes per biome, so no two biomes ask the same
 * question. A heavy is the rarest roll in any pool because it is the loudest:
 * three in a map is a fight, ten is a chore.
 *
 * Four biomes took the four distinct three-of-four mixes and exhausted them, so
 * the strand fields all FOUR archetypes rather than a fifth three that would
 * have to repeat one. That is the right shape for it anyway: it is the first map
 * anyone runs, and meeting one of each is how a player learns there are kinds.
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
  // Borrowed rather than newly modelled, and all four are things that belong in
  // wet sand: what lives in it, what wades out of it, what burns over it, and
  // what came in on the last storm and did not go back out.
  coast: [
    { defId: "monster.sand_skitterer.v1", weight: 3 },
    { defId: "monster.bog_drowned.v1", weight: 2 },
    { defId: "monster.fen_wisp.v1", weight: 2 },
    { defId: "monster.rotting_behemoth.v1", weight: 1 },
  ],
};

/**
 * Which boss holds the end of a map, by biome. Boss death is what completes an
 * Atlas node, so this is the payoff of every run — and it used to be one hard
 * coded id in `areas.ts`, which meant four biomes with their own monster pools
 * all ended on the same warden.
 *
 * The Warden keeps Vaal Stone rather than moving to a molten biome it would
 * match better: it is the fight every character has already learned.
 *
 * The strand shares Mother Vhal with the swamp, which is the one place two
 * biomes end the same way. It is deliberate and it is temporary: a drowned thing
 * is the right answer for a shoreline, and a wrong-themed boss on the FIRST map
 * anyone runs costs more than a repeated one on the fifth. Swapping it is one
 * line once the strand has a boss of its own.
 */
export const BOSSES: Record<BiomeId, string> = {
  vaal_stone: "monster.cinder_warden.v1",
  desert: "monster.sirrath.v1",
  swamp: "monster.mother_vhal.v1",
  forest: "monster.ghaltrek.v1",
  coast: "monster.mother_vhal.v1",
};

/** The boss for a biome. Total, so an unknown biome cannot end a run bossless. */
export function bossFor(biomeId: BiomeId): MonsterDef {
  return MONSTERS.get(BOSSES[biomeId] ?? BOSSES.vaal_stone)!;
}

// Referential integrity at module load, beside the def validation above: a pool
// naming a monster that does not exist is a programmer error, not a runtime one.
for (const [biome, pool] of Object.entries(MONSTER_POOLS)) {
  for (const entry of pool) {
    if (!MONSTERS.has(entry.defId)) {
      throw new Error(`[content-runtime] Pool "${biome}" names unknown monster "${entry.defId}"`);
    }
  }
}
for (const [biome, defId] of Object.entries(BOSSES)) {
  const def = MONSTERS.get(defId);
  if (!def) throw new Error(`[content-runtime] Biome "${biome}" names unknown boss "${defId}"`);
  if (!def.boss) throw new Error(`[content-runtime] Biome "${biome}" boss "${defId}" has no boss spec`);
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
