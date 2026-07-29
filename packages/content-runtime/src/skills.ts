import { fp } from "@exiled/fixed-point";
import { validateSkillDef, type SkillDef } from "@exiled/content-schema";

const SKILL_DEFS: SkillDef[] = [
  {
    id: "skill.ember_bolt.v1",
    name: "Ember Bolt",
    description: "Launches a bolt of fire that bursts on the first enemy it strikes.",
    /**
     * Fourteen ticks a cast, not eight: 2.1 casts a second where it used to be
     * 3.75 and read as a hose.
     *
     * The rate is what had to come down, and buying that with the COOLDOWN alone
     * would have been the wrong knob — cast speed shortens a cast and never a
     * cooldown (PoE's rule, kept in skill-cast.ts), so the one number gear can
     * ever give back is the cast time. It carries the change; the cooldown moves
     * to 12 only to stay under the cast, where it has always been, so it never
     * becomes the limiter itself.
     *
     * Damage 25 -> 36 and mana 8 -> 12 hold damage-per-mana at 3.0 against the old
     * 3.1, and the mana pool is what caps sustained damage (balance.test.ts) — so
     * the fight keeps its length while the hands slow down and the hits get 44%
     * heavier. Fewer, bigger hits is docs/09 rule 4, intensity over density, not a
     * compromise with it.
     *
     * Measured against the four archetype bands rather than reasoned about: swarm
     * 2.2s, brute 5.4s, shooter 2.0s, heavy 4.6s, versus 2.2 / 4.8 / 2.1 / 4.3
     * before. Scaling damage by the full 1.75 instead put the shooter pack at 1.8s,
     * under its own floor — a 108-life target wastes whatever a bolt overkills it
     * by, so per-hit damage does not buy time back linearly.
     */
    manaCostFixed: fp(12),
    cooldownTicks: 12,
    castTicks: 14,
    critChancePct: 7,
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(12),
        radiusFixed: fp(0.4),
        maxRangeFixed: fp(20),
        damage: { type: "fire", amountFixed: fp(36) },
      },
    ],
  },
  {
    id: "skill.cinder_ground.v1",
    name: "Cinder Ground",
    description: "Scorches the ground at a location, burning enemies who stand in the cinders.",
    manaCostFixed: fp(20),
    cooldownTicks: 30,
    castTicks: 15,
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
    description: "Teleport a short distance. Shares a cooldown with other movement skills.",
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
