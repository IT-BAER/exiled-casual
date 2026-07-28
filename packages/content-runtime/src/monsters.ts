import { fp } from "@exiled/fixed-point";
import { resBlock, validateMonsterDef, type MonsterDef, type RareModifier } from "@exiled/content-schema";

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
