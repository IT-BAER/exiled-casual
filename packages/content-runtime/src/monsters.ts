import { fp } from "@exiled/fixed-point";
import { resBlock, validateMonsterDef, type MonsterDef, type RareModifier } from "@exiled/content-schema";

const MONSTER_DEFS: MonsterDef[] = [
  {
    id: "monster.cinder_imp.v1",
    name: "Cinder Imp",
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
    maxLifeFixed: fp(750),
    moveSpeedFixed: fp(1.8),
    attackRangeFixed: fp(2.2),
    attackDamage: { type: "physical", amountFixed: fp(10) },
    attackCooldownTicks: 60,
    radiusFixed: fp(1.4),
    defenses: { resPct: resBlock({ fire: 40 }), armourFixed: fp(3) },
    boss: {
      phase2AtLifePct: 50,
      slam: { windupTicks: 30, radiusFixed: fp(3.5), damageFixed: fp(28), cooldownTicks: 150, rangeFixed: fp(9) },
      phase2: {
        fireGroundDurationTicks: 120,
        addCount: 2,
        addDefId: "monster.cinder_imp.v1",
        cadenceMulPct: 70,
        fireGround: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(12), durationTicks: 60, maxStacks: 5 },
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
 */
export const RARE_TEMPLATES: readonly RareModifier[] = (
  [
    ["fire", "Cinder-Touched"],
    ["cold", "Frost-Touched"],
    ["lightning", "Storm-Touched"],
    ["chaos", "Blight-Touched"],
  ] as const
).map(([element, namePrefix]) => ({
  lifeMulPct: 250,
  moveSpeedMulPct: 120,
  damageMulPct: 150,
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
