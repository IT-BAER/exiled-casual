import { fp } from "@pact/fixed-point";
import { validateMonsterDef, type MonsterDef, type RareModifier } from "@pact/content-schema";

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
    defenses: { fireResPct: 0, armourFixed: fp(0.5) },
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
    defenses: { fireResPct: 40, armourFixed: fp(3) },
    boss: {
      phase2AtLifePct: 50,
      slam: { windupTicks: 30, radiusFixed: fp(3.5), damageFixed: fp(28), cooldownTicks: 150, rangeFixed: fp(9) },
      phase2: { fireGroundDurationTicks: 120, addCount: 2, addDefId: "monster.cinder_imp.v1", cadenceMulPct: 70 },
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

export const RARE_TEMPLATE: RareModifier = {
  lifeMulPct: 250,
  moveSpeedMulPct: 120,
  damageMulPct: 150,
  addedFireResPct: 30,
};
