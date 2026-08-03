import { fp } from "@exiled/fixed-point";
import { validateSkillDef, type SkillDef } from "@exiled/content-schema";

const SKILL_DEFS: SkillDef[] = [
  {
    id: "skill.ember_bolt.v1",
    name: "Ember Bolt",
    description: "Launches a bolt of fire that bursts on the first enemy it strikes.",
    /**
     * Nine ticks keeps the wind-up visible without making the skill feel held
     * back. The cooldown must stay ABOVE it: at eight it never bound, so a held
     * button chained casts nose to tail with a two-tick gap and the wind-up
     * stopped reading as one — the first bolt looked like it cost time and every
     * bolt after it looked free. Fifteen leaves a beat between bolts, and matches
     * every other attack skill.
     */
    manaCostFixed: fp(10),
    cooldownTicks: 15,
    castTicks: 9,
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
    castTicks: 9,
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
  /*
   * The three default attacks, one per class.
   *
   * PoE keys this off the equipped weapon, not the character. We key it off the
   * class because the only weapon classes that exist here are wand, focus and
   * shield: there is no bow and no melee weapon to read, and no weapon damage
   * stat for one to carry. When those land this map becomes the fallback and the
   * weapon wins, which is why every one of these is a plain content def with no
   * class logic inside it.
   *
   * All three are free: a default attack is what the player still has when the
   * mana pool is dry, and mana is what caps sustained damage (balance.test.ts).
   * 0.5s repeat gate (15 ticks) on top of the 7-tick cast means ~1.4 attacks/sec.
   * Damage sits near a third of Ember Bolt's 36 so it is a floor to fall back to
   * and never the better choice.
   */
  {
    id: "skill.strike.v1",
    name: "Strike",
    description: "A swing of whatever is in hand. Costs nothing and always available.",
    manaCostFixed: 0,
    cooldownTicks: 15,
    castTicks: 7,
    critChancePct: 5,
    effects: [
      {
        type: "meleeStrike",
        // Reach is to the target's surface, so 1.6 clears a 0.85 brute at arm's
        // length rather than needing the player inside it.
        reachFixed: fp(1.6),
        // Wide enough that two bodies in a doorway both take it, narrow enough
        // that turning around is a real cost.
        arcDegrees: 120,
        damage: { type: "physical", amountFixed: fp(14) },
      },
    ],
  },
  {
    id: "skill.snap_shot.v1",
    name: "Snap Shot",
    description: "A loosed arrow, quick and cheap. Costs nothing and always available.",
    manaCostFixed: 0,
    cooldownTicks: 15,
    castTicks: 7,
    critChancePct: 5,
    effects: [
      {
        type: "spawnProjectile",
        // Faster and thinner than Ember Bolt: an arrow, not a lobbed flame.
        speedPerSecFixed: fp(20),
        radiusFixed: fp(0.3),
        maxRangeFixed: fp(14),
        damage: { type: "physical", amountFixed: fp(11) },
      },
    ],
  },
  {
    id: "skill.ember_spark.v1",
    name: "Ember Spark",
    description: "A thrown mote of fire. Costs nothing and always available.",
    manaCostFixed: 0,
    cooldownTicks: 15,
    castTicks: 7,
    critChancePct: 5,
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(14),
        radiusFixed: fp(0.35),
        maxRangeFixed: fp(16),
        damage: { type: "fire", amountFixed: fp(10) },
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

/**
 * Which default attack each class swings. This is the one place a class picks a
 * NUMBER rather than a look, so it is also where "classes are cosmetic" stopped
 * being true — see the note in `@exiled/rules/classes.ts`.
 *
 * `content.test.ts` pins it against `CLASS_IDS` and against `SKILLS`, so neither
 * a new class nor a renamed skill can leave a socket firing nothing.
 */
export const DEFAULT_ATTACK_BY_CLASS: Record<string, string> = {
  "class.ironsworn": "skill.strike.v1",
  "class.stalker": "skill.snap_shot.v1",
  "class.emberbound": "skill.ember_spark.v1",
};

/** The default attack for a class id, falling back rather than throwing mid-run. */
export function defaultAttackFor(classId: string): string {
  return DEFAULT_ATTACK_BY_CLASS[classId] ?? DEFAULT_ATTACK_BY_CLASS["class.stalker"]!;
}
