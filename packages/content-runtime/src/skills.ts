import { fp } from "@pact/fixed-point";
import { validateSkillDef, type SkillDef } from "@pact/content-schema";

const SKILL_DEFS: SkillDef[] = [
  {
    id: "skill.ember_bolt.v1",
    name: "Ember Bolt",
    manaCostFixed: fp(8),
    cooldownTicks: 6,
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(12),
        radiusFixed: fp(0.4),
        maxRangeFixed: fp(20),
        damage: { type: "fire", amountFixed: fp(25) },
      },
    ],
  },
  {
    id: "skill.cinder_ground.v1",
    name: "Cinder Ground",
    manaCostFixed: fp(20),
    cooldownTicks: 30,
    effects: [
      {
        type: "spawnGroundArea",
        radiusFixed: fp(2.5),
        durationTicks: 90,
        ailment: {
          kind: "burning",
          stacksPerApply: 1,
          dpsFixed: fp(8),
          durationTicks: 60,
          maxStacks: 5,
        },
      },
    ],
  },
  {
    id: "skill.blink.v1",
    name: "Blink",
    manaCostFixed: fp(15),
    cooldownTicks: 90,
    effects: [{ type: "teleport", distanceFixed: fp(5) }],
  },
];

// Validate at module load — bad content is a programmer error, fail fast.
for (const def of SKILL_DEFS) {
  const r = validateSkillDef(def);
  if (!r.ok) {
    throw new Error(`[content-runtime] Invalid skill def "${def.id}": ${r.errors.join("; ")}`);
  }
}

export const SKILLS: ReadonlyMap<string, SkillDef> = new Map(
  SKILL_DEFS.map((d) => [d.id, d]),
);
