import { fp } from "@exiled/fixed-point";
import { validateSkillDef, type SkillDef } from "@exiled/content-schema";

/*
 * Every skill carries an unlock level and a growth block (docs/superpowers/specs/
 * 2026-08-10-skill-acquisition-design.md). Unlock levels are chosen so a
 * character has a kit inside the first hour and the rest of the climb is gem
 * levels rather than new icons.
 *
 * `own` is the ONE authored scalar a level grows beyond damage and mana, and no
 * breakpoint may patch the same field (the schema refuses it) because the patch
 * lands after the growth and would wipe it.
 *
 * Blink and Portal have no breakpoints on purpose: PoE1 gives its movement and
 * utility gems almost nothing per level either, and inventing two behaviour
 * changes for a teleport would be a rule nobody asked for.
 */
const SKILL_DEFS: SkillDef[] = [
  {
    id: "skill.ember_bolt.v1",
    name: "Ember Bolt",
    description: "Launches a bolt of fire that bursts on the first enemy it strikes.",
    // The fire spells are the Emberbound's kit: a warrior throwing fireballs read wrong.
    classId: "class.emberbound",
    /**
     * Nine ticks keeps the wind-up visible without making the skill feel held
     * back. The cooldown must stay ABOVE it: at eight it never bound, so a held
     * button chained casts nose to tail with a two-tick gap and the wind-up
     * stopped reading as one — the first bolt looked like it cost time and every
     * bolt after it looked free. Thirty is one second at 30 Hz: a held button
     * fires on a beat the ear can count, which is what the cast animation is now
     * paced to. PoE1 Fireball's 0.75 s (23 ticks) put the Emberbound's clear
     * outside balance.test.ts's class band, so this stays until a balance pass.
     */
    manaCostFixed: fp(10),
    cooldownTicks: 30,
    castTicks: 9,
    critChancePct: 7,
    kind: "spell",
    addedDamageEffectivenessPct: 100,
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
        { atLevel: 15, text: "Pierces three enemies", patch: { pierceCount: 3 } },
      ],
    },
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(12),
        radiusFixed: fp(0.4),
        maxRangeFixed: fp(20),
        damage: { type: "fire", amountFixed: fp(36) },
        pierceCount: 0,
      },
    ],
  },
  {
    id: "skill.cinder_ground.v1",
    name: "Cinder Ground",
    description: "Scorches the ground at a location, burning enemies who stand in the cinders.",
    classId: "class.emberbound",
    manaCostFixed: fp(20),
    cooldownTicks: 90,
    castTicks: 9,
    kind: "spell",
    unlockLevel: 8,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "durationTicks", perMille: 25 } },
      breakpoints: [
        { atLevel: 5, text: "Scorches a wider patch", patch: { radiusFixed: fp(3.5) } },
        { atLevel: 15, text: "Scorches a far wider patch", patch: { radiusFixed: fp(4.5) } },
      ],
    },
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
   * The other two classes' Ember Bolt: each class's first mana skill, at Ember
   * Bolt's cost and beat. Heavy Strike hits as hard as Ember Bolt because its
   * wedge takes the whole pack: at 56 the Ironsworn cleared a first map 1.44x
   * faster than the casters (playtest.test.ts). Piercing Shot matches Ember Bolt
   * too: at 30 it dealt less per second than the free Snap Shot (content.test.ts).
   * Heavy Strike is PoE1's;
   * Piercing Shot is a name of our own.
   */
  {
    id: "skill.heavy_strike.v1",
    name: "Heavy Strike",
    description: "A two-handed blow that crushes everything in front of you.",
    classId: "class.ironsworn",
    manaCostFixed: fp(10),
    cooldownTicks: 30,
    // PoE1 Heavy Strike's 0.905 s (85% of a Driftwood Maul's 1.30/s, poedb.tw;
    // 27 ticks) slowed the Ironsworn's clear past balance.test.ts's class band.
    castTicks: 9,
    critChancePct: 5,
    kind: "attack",
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "reachFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "Crushes a wider arc", patch: { arcDegrees: 180 } },
        { atLevel: 15, text: "Crushes a far wider arc", patch: { arcDegrees: 240 } },
      ],
    },
    effects: [
      {
        type: "meleeStrike",
        reachFixed: fp(1.8),
        arcDegrees: 140,
        damage: { type: "physical", amountFixed: fp(36) },
      },
    ],
  },
  {
    id: "skill.piercing_shot.v1",
    name: "Piercing Shot",
    description: "A drawn-back arrow that hits hard and punches on through.",
    classId: "class.stalker",
    manaCostFixed: fp(10),
    cooldownTicks: 30,
    castTicks: 9,
    critChancePct: 7,
    kind: "attack",
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Pierces three enemies", patch: { pierceCount: 3 } },
        { atLevel: 15, text: "Pierces four enemies", patch: { pierceCount: 4 } },
      ],
    },
    bow: true,
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(25),
        radiusFixed: fp(0.35),
        maxRangeFixed: fp(20),
        damage: { type: "physical", amountFixed: fp(36) },
        // The name is a promise: it goes through the first body from gem level 1.
        pierceCount: 1,
      },
    ],
  },
  /*
   * The other two classes' Cinder Ground: each class's level-8 answer to a pack,
   * at its cost and beat. Ground Slam is PoE1/PoE2's; Split Arrow is PoE1's.
   * Split Arrow fires twice as often and hits harder: packs spawn a metre apart,
   * and at level 10 the Stalker cleared 1.46x slower than the Ironsworn without it.
   */
  {
    id: "skill.ground_slam.v1",
    name: "Ground Slam",
    description: "Smashes the ground, sending a shockwave through everything in front of you.",
    classId: "class.ironsworn",
    manaCostFixed: fp(20),
    cooldownTicks: 90,
    // PoE1 Ground Slam: 90% of base attack speed on a Driftwood Maul's 1.30/s
    // (poedb.tw) is 0.855 s, 26 ticks; PoE2 has no Ground Slam. The shockwave
    // leaves on the last tick, the frame the client's slam meets the floor.
    castTicks: 26,
    critChancePct: 5,
    kind: "attack",
    unlockLevel: 8,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "reachFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "Shakes a wider cone", patch: { arcDegrees: 90 } },
        { atLevel: 15, text: "Shakes a far wider cone", patch: { arcDegrees: 120 } },
      ],
    },
    effects: [
      {
        type: "meleeStrike",
        reachFixed: fp(3.5),
        arcDegrees: 70,
        damage: { type: "physical", amountFixed: fp(45) },
      },
    ],
  },
  {
    id: "skill.split_arrow.v1",
    name: "Split Arrow",
    description: "Looses a fan of arrows at once.",
    classId: "class.stalker",
    manaCostFixed: fp(20),
    cooldownTicks: 30,
    castTicks: 9,
    critChancePct: 7,
    kind: "attack",
    unlockLevel: 8,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Looses seven arrows", patch: { count: 7, spreadDegrees: 60 } },
        { atLevel: 15, text: "Every arrow pierces one enemy", patch: { pierceCount: 1 } },
      ],
    },
    bow: true,
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(25),
        radiusFixed: fp(0.3),
        maxRangeFixed: fp(14),
        damage: { type: "physical", amountFixed: fp(40) },
        pierceCount: 0,
        count: 5,
        spreadDegrees: 40,
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
   * The ranged two hit for under half of Ember Bolt's 36, so a default attack is a
   * floor to fall back to and never the better choice. Strike swings slower (21
   * ticks) because a swing hits the whole wedge. It hits for 16, not 10: it is what
   * the Ironsworn fights a long single target with once mana is dry, and at 10 he
   * cleared a first map 1.41x slower than the Stalker once rares stood along the
   * route and boss adds scaled with the map (playtest.ts).
   */
  {
    id: "skill.strike.v1",
    name: "Strike",
    description: "A swing of whatever is in hand. Costs nothing and always available.",
    classId: "class.ironsworn",
    manaCostFixed: 0,
    cooldownTicks: 21,
    castTicks: 7,
    critChancePct: 5,
    kind: "attack",
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "reachFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "Swings a wider arc", patch: { arcDegrees: 200 } },
        { atLevel: 15, text: "Swings all the way around you", patch: { arcDegrees: 360 } },
      ],
    },
    effects: [
      {
        type: "meleeStrike",
        // Reach is to the target's surface, so 1.6 clears a 0.85 brute at arm's
        // length rather than needing the player inside it.
        reachFixed: fp(1.6),
        // Wide enough that two bodies in a doorway both take it, narrow enough
        // that turning around is a real cost.
        arcDegrees: 120,
        damage: { type: "physical", amountFixed: fp(16) },
      },
    ],
  },
  {
    id: "skill.snap_shot.v1",
    name: "Snap Shot",
    description: "A loosed arrow, quick and cheap. Costs nothing and always available.",
    classId: "class.stalker",
    manaCostFixed: 0,
    cooldownTicks: 15,
    castTicks: 7,
    critChancePct: 5,
    kind: "attack",
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
        { atLevel: 15, text: "Pierces two enemies", patch: { pierceCount: 2 } },
      ],
    },
    bow: true,
    effects: [
      {
        type: "spawnProjectile",
        // Faster and thinner than Ember Bolt: an arrow, not a lobbed flame.
        speedPerSecFixed: fp(23),
        radiusFixed: fp(0.3),
        maxRangeFixed: fp(14),
        damage: { type: "physical", amountFixed: fp(16) },
        pierceCount: 0,
      },
    ],
  },
  {
    id: "skill.ember_spark.v1",
    name: "Ember Spark",
    description: "A thrown mote of fire. Costs nothing and always available.",
    classId: "class.emberbound",
    manaCostFixed: 0,
    cooldownTicks: 15,
    castTicks: 7,
    critChancePct: 5,
    kind: "spell",
    addedDamageEffectivenessPct: 60,
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
        { atLevel: 15, text: "Pierces two enemies", patch: { pierceCount: 2 } },
      ],
    },
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(14),
        radiusFixed: fp(0.35),
        maxRangeFixed: fp(16),
        damage: { type: "fire", amountFixed: fp(15) },
        pierceCount: 0,
      },
    ],
  },
  {
    /**
     * The way home, on Y. PoE2's free return inside an open map; the inventory's
     * right-click on a Portal Scroll fires the same skill and spends the scroll,
     * so both obey one cooldown.
     *
     * Two seconds of wind-up and ten of cooldown are the whole answer to "so it
     * doesn't get spammed": long enough that opening one mid-fight is a decision,
     * short enough that a full bag is never a walk back to the entrance.
     */
    id: "skill.town_portal.v1",
    name: "Portal",
    description: "Tears open a doorway back to the hideout. Replaces any other way home already standing in this area.",
    manaCostFixed: 0,
    cooldownTicks: 300,
    castTicks: 60,
    unlockLevel: 10,
    growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
    effects: [{ type: "openPortal" }],
  },
  {
    id: "skill.blink.v1",
    name: "Blink",
    description: "Teleport a short distance. Shares a cooldown with other movement skills.",
    manaCostFixed: fp(15),
    cooldownTicks: 150,
    unlockLevel: 4,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "distanceFixed", perMille: 20 } },
      breakpoints: [],
    },
    effects: [{ type: "teleport", distanceFixed: fp(5) }],
  },
  /*
   * The class-skill expansion (docs/superpowers/specs/2026-11-01-class-skill-expansion.md
   * §1): per class one warcry/curse/mark, one movement skill, one aura and three
   * hitters. A metre in PoE is read as one world unit. Pacing rules every number
   * below obeys: a repeat hitter sits near its class's 36 per one-second beat; a
   * long-cooldown hitter hits harder per cast but less per second over its
   * cooldown; movement costs 10-15 mana on a 60-150 tick cooldown; auras reserve
   * 25%; curses and marks last 4-8 s. Growth and breakpoints patch effects[0], so
   * the effect a level must reach is listed first.
   */
  // ── Ironsworn ──
  {
    id: "skill.infernal_cry.v1",
    name: "Infernal Cry",
    description: "A roar that drags every nearby enemy's attention to you and leaves them scorched, open to fire, while the fury lifts your own damage.",
    classId: "class.ironsworn",
    manaCostFixed: fp(10),
    // PoE2 Infernal Cry's 8 s cooldown (poe2db.tw).
    cooldownTicks: 240,
    // Our own: long enough to read as a roar, short enough not to cost a swing.
    castTicks: 12,
    unlockLevel: 3,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "durationTicks", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Roars across a wider ring", patch: { radiusFixed: fp(5) } },
        { atLevel: 15, text: "Scorched enemies take 30% more fire damage", patch: { damageTakenPct: 30 } },
      ],
    },
    effects: [
      {
        type: "applyStatus",
        at: "self",
        // PoE2's 4 m warcry radius (poe2db.tw).
        radiusFixed: fp(4),
        statusId: "scorched",
        // Our own: four seconds, half the cooldown, so the window is a choice.
        durationTicks: 120,
        // Our own: a fifth more fire taken, felt by a fire weapon or a Herald's burn.
        damageTakenPct: 20,
        damageTakenType: "fire",
        taunt: 1,
      },
      // Our own: five seconds of a quarter more damage, the reward for shouting first.
      { type: "applyBuff", buffId: "infernal_cry", durationTicks: 150, damagePct: 25 },
    ],
  },
  {
    id: "skill.leap_slam.v1",
    name: "Leap Slam",
    description: "Leaps to the target and crashes down, battering everything where you land and throwing it back.",
    classId: "class.ironsworn",
    // Movement band: 15 mana, three seconds between leaps.
    manaCostFixed: fp(15),
    cooldownTicks: 90,
    // Our own: a short crouch; the half-second in the air is the travel's.
    castTicks: 6,
    critChancePct: 5,
    kind: "attack",
    unlockLevel: 6,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "distanceFixed", perMille: 20 } },
      breakpoints: [{ atLevel: 5, text: "Leaps faster", patch: { ticks: 12 } }],
    },
    effects: [
      {
        type: "travel",
        // Our own: Blink's 5 plus two, the leap is the farther and the slower.
        distanceFixed: fp(7),
        ticks: 15,
        direction: "toward",
        arrival: {
          // PoE2 Leap Slam's 2.5 m impact (poe2db.tw).
          radiusFixed: fp(2.5),
          // Our own: 60 every three seconds is 20/s, under Heavy Strike's 36.
          damage: { type: "physical", amountFixed: fp(60) },
          knockbackFixed: fp(1.5),
        },
      },
    ],
  },
  {
    id: "skill.earthquake.v1",
    name: "Earthquake",
    description: "Smashes the ground ahead; a second later the earth erupts around the impact, stunning everything it catches.",
    classId: "class.ironsworn",
    manaCostFixed: fp(20),
    // Our own: 40 + 80 over four seconds is 30/s, under Heavy Strike's 36.
    cooldownTicks: 120,
    // PoE2 Earthquake: 75% of base attack speed (poe2db.tw) on a Driftwood
    // Maul's 1.30/s is 1.03 s, 31 ticks.
    castTicks: 31,
    critChancePct: 5,
    kind: "attack",
    unlockLevel: 12,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "radiusFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "The aftershock stuns for a second and a half", patch: { stunTicks: 45 } },
        { atLevel: 15, text: "A second aftershock erupts half a second later", patch: { count: 2 } },
      ],
    },
    effects: [
      {
        // The aftershock is the class's loudest moment: the biggest single hit it
        // owns, on a whole pack, with a stun. PoE2's is 2.4 m at gem 1 (poe2db.tw);
        // 3 so a pack that walked in during the second is still under it.
        type: "areaHit",
        // PoE2's aftershock erupts where the slam landed, not round the caster.
        at: "target",
        maxRangeFixed: fp(1.5),
        radiusFixed: fp(3),
        damage: { type: "physical", amountFixed: fp(80) },
        // The spec's one second between slam and aftershock.
        delayTicks: 30,
        count: 1,
        intervalTicks: 15,
        // Our own: one second of stun, the aftershock's promise.
        stunTicks: 30,
      },
      {
        // The slam itself: Ground Slam's reach, a narrower 90 degree wedge.
        type: "areaHit",
        at: "self",
        radiusFixed: fp(3.5),
        shape: "cone",
        arcDegrees: 90,
        damage: { type: "physical", amountFixed: fp(40) },
      },
    ],
  },
  {
    id: "skill.determination.v1",
    name: "Determination",
    description: "An aura of iron will: while it holds a quarter of your mana, you take less damage from every hit.",
    classId: "class.ironsworn",
    // An aura costs its reservation, not a cast: PoE1 auras are free to switch on.
    manaCostFixed: 0,
    cooldownTicks: 30,
    castTicks: 9,
    unlockLevel: 14,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4 },
      breakpoints: [{ atLevel: 10, text: "Takes a fifth less damage", patch: { damageTakenPct: -20 } }],
    },
    effects: [
      // PoE1 Determination reserves 50% and grants more armour; ours reserves the
      // spec's 25% and, with no armour multiplier to grant, takes 15% less of every hit.
      { type: "applyBuff", buffId: "determination", durationTicks: 0, reserveManaPct: 25, damageTakenPct: -15 },
    ],
  },
  {
    id: "skill.sunder.v1",
    name: "Sunder",
    description: "Splits the earth in a rolling line of bursts along the aim.",
    classId: "class.ironsworn",
    manaCostFixed: fp(12),
    // A repeat beat (<= 45 ticks), so Blood Rage quickens it.
    cooldownTicks: 45,
    // Our own: between Heavy Strike's 9 and Ground Slam's 26.
    castTicks: 12,
    critChancePct: 5,
    kind: "attack",
    unlockLevel: 18,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "radiusFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "Rolls a sixth burst", patch: { count: 6 } },
        { atLevel: 15, text: "Rolls a seventh burst", patch: { count: 7 } },
      ],
    },
    effects: [
      {
        type: "areaHit",
        // The line starts a radius ahead of him (PoE1's wave leaves the blade), never on him.
        at: "target",
        maxRangeFixed: fp(1.6),
        radiusFixed: fp(1.6),
        // Our own: bursts a radius apart overlap, so a body takes about two:
        // 48 per 1.5 s is 32/s, near Heavy Strike's 36.
        damage: { type: "physical", amountFixed: fp(24) },
        count: 5,
        stepFixed: fp(1.6),
        intervalTicks: 4,
      },
    ],
  },
  {
    id: "skill.blood_rage.v1",
    name: "Blood Rage",
    description: "Eight seconds of frenzy: you swing and run faster while your own blood burns away. It never kills you.",
    classId: "class.ironsworn",
    manaCostFixed: fp(15),
    // Our own: two seconds, so a held key cannot refresh it every beat.
    cooldownTicks: 60,
    castTicks: 9,
    unlockLevel: 24,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "durationTicks", perMille: 20 } },
      breakpoints: [{ atLevel: 10, text: "30% increased attack speed", patch: { speedPct: 30 } }],
    },
    effects: [
      {
        type: "applyBuff",
        buffId: "blood_rage",
        // The spec's eight seconds.
        durationTicks: 240,
        // Our own: a quarter faster swings, a tenth faster feet; PoE1's drain is
        // 4% of life a second, ours a flat 5 so it reads the same on any build.
        speedPct: 25,
        moveSpeedPct: 10,
        lifeDrainPerSecFixed: fp(5),
      },
    ],
  },
  // ── Stalker ──
  {
    id: "skill.escape_shot.v1",
    name: "Escape Shot",
    description: "Hops backwards and looses a freezing arrow at the aim that bursts and chills.",
    classId: "class.stalker",
    manaCostFixed: fp(12),
    cooldownTicks: 90,
    castTicks: 6,
    critChancePct: 5,
    kind: "attack",
    bow: true,
    unlockLevel: 3,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Bursts across 2 metres", patch: { explodeRadiusFixed: fp(2) } },
        { atLevel: 15, text: "Pierces one enemy", patch: { pierceCount: 1 } },
      ],
    },
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(25),
        radiusFixed: fp(0.35),
        maxRangeFixed: fp(14),
        // Our own: a parting shot, below Piercing Shot's 36.
        damage: { type: "cold", amountFixed: fp(28) },
        pierceCount: 0,
        // PoE2's explosion is 2 m (poe2db.tw); the gem grows into it at 5.
        explodeRadiusFixed: fp(1.2),
        // Our own: a 30% slow for two seconds, the room to get away.
        onHit: { statusId: "chilled", durationTicks: 60, slowPct: 30 },
      },
      // PoE2 0.3.0: Escape Shot travels 6 m back (poe2db.tw), here in 0.3 s.
      { type: "travel", distanceFixed: fp(6), ticks: 9, direction: "away" },
    ],
  },
  {
    id: "skill.ice_shot.v1",
    name: "Ice Shot",
    description: "A frozen arrow that shatters on the first enemy, chilling everything around it.",
    classId: "class.stalker",
    manaCostFixed: fp(10),
    cooldownTicks: 30,
    castTicks: 9,
    critChancePct: 7,
    kind: "attack",
    bow: true,
    unlockLevel: 6,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Shatters wider", patch: { explodeRadiusFixed: fp(2.2) } },
        { atLevel: 15, text: "Pierces one enemy", patch: { pierceCount: 1 } },
      ],
    },
    effects: [
      {
        type: "spawnProjectile",
        // PoE2 flies it at 32.6 m/s (poe2db.tw); ours keep the bow's 25.
        speedPerSecFixed: fp(25),
        radiusFixed: fp(0.35),
        maxRangeFixed: fp(20),
        // Our own: 32 a beat beside Piercing Shot's 36; the burst is the trade.
        damage: { type: "cold", amountFixed: fp(32) },
        pierceCount: 0,
        explodeRadiusFixed: fp(1.5),
        onHit: { statusId: "chilled", durationTicks: 60, slowPct: 30 },
      },
    ],
  },
  {
    id: "skill.snipers_mark.v1",
    name: "Sniper's Mark",
    description: "Marks the enemy nearest the aim; it takes far more damage from everything while the mark lasts.",
    classId: "class.stalker",
    manaCostFixed: fp(10),
    // PoE2 Sniper's Mark: 6 s cooldown, 8 s duration (poe2db.tw).
    cooldownTicks: 180,
    castTicks: 7,
    unlockLevel: 12,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4 },
      breakpoints: [{ atLevel: 10, text: "The marked enemy takes 40% more damage", patch: { damageTakenPct: 40 } }],
    },
    effects: [
      {
        type: "applyStatus",
        at: "target",
        // Our own: a three-unit search around the aim, so a moving target is found.
        radiusFixed: fp(3),
        maxRangeFixed: fp(20),
        single: 1,
        statusId: "marked",
        durationTicks: 240,
        // Our own: PoE2's mark raises critical damage taken; ours, with no crit
        // damage stat, raises all damage taken.
        damageTakenPct: 30,
      },
    ],
  },
  {
    id: "skill.lightning_arrow.v1",
    name: "Lightning Arrow",
    description: "A charged arrow that leaps from its target to three more enemies nearby.",
    classId: "class.stalker",
    manaCostFixed: fp(12),
    cooldownTicks: 30,
    castTicks: 9,
    critChancePct: 7,
    kind: "attack",
    bow: true,
    unlockLevel: 14,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Chains to four more enemies", patch: { chainCount: 4 } },
        { atLevel: 15, text: "Chains to five more enemies", patch: { chainCount: 5 } },
      ],
    },
    effects: [
      {
        type: "spawnProjectile",
        // PoE2's flies at 54 m/s (poe2db.tw); 30 is the fastest arrow we draw.
        speedPerSecFixed: fp(30),
        radiusFixed: fp(0.35),
        maxRangeFixed: fp(20),
        // Our own: 30 a beat on one body, under Piercing Shot's 36; the chains
        // are what it buys on a pack.
        damage: { type: "lightning", amountFixed: fp(30) },
        pierceCount: 0,
        // The spec's 3 chains (PoE2 chains 2, poe2db.tw); PoE2's 3.2 m beam
        // radius, rounded up to 4 for our looser packs.
        chainCount: 3,
        chainRangeFixed: fp(4),
      },
    ],
  },
  {
    id: "skill.rain_of_arrows.v1",
    name: "Rain of Arrows",
    description: "Fires a volley skywards; twelve arrows fall scattered across the target area.",
    classId: "class.stalker",
    manaCostFixed: fp(20),
    // Our own: about 70 per body per cast over four seconds, under Split Arrow's beat.
    cooldownTicks: 120,
    // PoE2: 80% of base attack speed (poe2db.tw); 15 ticks is ours, the aim upward.
    castTicks: 15,
    critChancePct: 5,
    kind: "attack",
    bow: true,
    unlockLevel: 18,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "radiusFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "Sixteen arrows fall", patch: { count: 16 } },
        { atLevel: 15, text: "Twenty arrows fall", patch: { count: 20 } },
      ],
    },
    effects: [
      {
        type: "areaHit",
        at: "target",
        // PoE2's arrow impact is 0.7 m (poe2db.tw); 1 for bodies our size.
        radiusFixed: fp(1),
        maxRangeFixed: fp(14),
        damage: { type: "physical", amountFixed: fp(28) },
        // The spec's twelve over 0.8 s: one every two ticks.
        count: 12,
        intervalTicks: 2,
        // Our own: the first arrow lands after 0.27 s, so its landing mark shows first.
        delayTicks: 8,
        // PoE2's 3.6 m rain radius (poe2db.tw), drawn in to 3 so a pack catches most.
        scatterFixed: fp(3),
      },
    ],
  },
  {
    id: "skill.haste.v1",
    name: "Haste",
    description: "An aura of speed: while it holds a quarter of your mana, you attack, cast and move faster.",
    classId: "class.stalker",
    manaCostFixed: 0,
    cooldownTicks: 30,
    castTicks: 9,
    unlockLevel: 24,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4 },
      breakpoints: [{ atLevel: 10, text: "20% increased attack and cast speed", patch: { speedPct: 20 } }],
    },
    effects: [
      // PoE1 Haste reserves 50% (ours the spec's 25%); the speeds are our own,
      // and quicken every repeat-beat skill as well as its wind-up.
      { type: "applyBuff", buffId: "haste", durationTicks: 0, reserveManaPct: 25, speedPct: 15, moveSpeedPct: 10 },
    ],
  },
  // ── Emberbound ──
  {
    id: "skill.flame_dash.v1",
    name: "Flame Dash",
    description: "Dashes to the target in a rush of fire, leaving a trail of burning ground behind you.",
    classId: "class.emberbound",
    manaCostFixed: fp(12),
    cooldownTicks: 90,
    castTicks: 4,
    kind: "spell",
    unlockLevel: 3,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "distanceFixed", perMille: 20 } },
      breakpoints: [],
    },
    effects: [
      {
        type: "travel",
        // Our own: Leap Slam's seven units in under half its time.
        distanceFixed: fp(7),
        ticks: 6,
        direction: "toward",
        trail: {
          spacingFixed: fp(1),
          radiusFixed: fp(1),
          durationTicks: 90,
          // Our own: Cinder Ground's burn, three stacks at most.
          ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(8), durationTicks: 60, maxStacks: 3 },
        },
      },
    ],
  },
  {
    id: "skill.ember_nova.v1",
    name: "Ember Nova",
    description: "A ring of fire bursts out from you, scorching and hurling back everything close.",
    classId: "class.emberbound",
    manaCostFixed: fp(15),
    // A repeat beat; 30 per 1.5 s on every body in reach, Ember Bolt's 36 on one.
    cooldownTicks: 45,
    castTicks: 9,
    critChancePct: 6,
    kind: "spell",
    // Our own: an area spell takes less of a wand's flat fire than a bolt.
    addedDamageEffectivenessPct: 70,
    unlockLevel: 6,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "radiusFixed", perMille: 15 } },
      breakpoints: [{ atLevel: 5, text: "Hurls enemies further", patch: { knockbackFixed: fp(2.5) } }],
    },
    effects: [
      {
        type: "areaHit",
        at: "self",
        radiusFixed: fp(3),
        damage: { type: "fire", amountFixed: fp(30) },
        knockbackFixed: fp(1.5),
      },
    ],
  },
  {
    id: "skill.flammability.v1",
    name: "Flammability",
    description: "Curses an area: enemies in it take more fire damage.",
    classId: "class.emberbound",
    manaCostFixed: fp(15),
    cooldownTicks: 30,
    // PoE2's is 0.7 s (poe2db.tw); half a second so a curse is not a stall.
    castTicks: 15,
    kind: "spell",
    unlockLevel: 12,
    growth: {
      // PoE2's curse grows 1.5 -> 3.1 m over twenty levels (poe2db.tw).
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "radiusFixed", perMille: 20 } },
      breakpoints: [{ atLevel: 10, text: "Cursed enemies take 35% more fire damage", patch: { damageTakenPct: 35 } }],
    },
    effects: [
      {
        type: "applyStatus",
        at: "target",
        // Our own: PoE2 starts at 1.5 m; 3 covers a pack from gem 1.
        radiusFixed: fp(3),
        maxRangeFixed: fp(18),
        statusId: "flammable",
        // PoE2's 6 s curse (poe2db.tw).
        durationTicks: 180,
        // PoE2's -23% fire resistance (poe2db.tw), as fire damage taken.
        damageTakenPct: 25,
        damageTakenType: "fire",
      },
    ],
  },
  {
    id: "skill.solar_orb.v1",
    name: "Solar Orb",
    description: "Throws an orb of fire that hovers in place, pulsing flame through everything around it.",
    classId: "class.emberbound",
    manaCostFixed: fp(20),
    // One orb at a time (PoE2 limits it to one): the cooldown is its lifetime.
    cooldownTicks: 120,
    // PoE2's is 0.8 s (poe2db.tw); ours half a second.
    castTicks: 15,
    critChancePct: 6,
    kind: "spell",
    // Our own: nine pulses each take a share of a wand's flat fire.
    addedDamageEffectivenessPct: 30,
    unlockLevel: 14,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "durationTicks", perMille: 25 } },
      breakpoints: [
        { atLevel: 5, text: "Pulses across a wider ring", patch: { radiusFixed: fp(3) } },
        { atLevel: 15, text: "Pulses across a far wider ring", patch: { radiusFixed: fp(3.5) } },
      ],
    },
    effects: [
      {
        type: "spawnGroundArea",
        // PoE2's 2.5 m explosion radius (poe2db.tw).
        radiusFixed: fp(2.5),
        // The spec's 4 s (PoE2's orb lasts 10).
        durationTicks: 120,
        // Our own: nine pulses of 12 is 108 per body over four seconds, 27/s.
        pulse: { damage: { type: "fire", amountFixed: fp(12) }, everyTicks: 15 },
        ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(4), durationTicks: 30, maxStacks: 2 },
      },
    ],
  },
  {
    id: "skill.firestorm.v1",
    name: "Firestorm",
    description: "Calls down ten meteors that crash at random across the target area.",
    classId: "class.emberbound",
    manaCostFixed: fp(25),
    // Our own: about 130 per body per cast over five seconds, 26/s.
    cooldownTicks: 150,
    // PoE2's is 1.4 s (poe2db.tw); 0.7 s here, a long call that still lets him move.
    castTicks: 21,
    critChancePct: 6,
    kind: "spell",
    addedDamageEffectivenessPct: 50,
    unlockLevel: 18,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "radiusFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "Twelve meteors fall", patch: { count: 12 } },
        { atLevel: 15, text: "Fifteen meteors fall", patch: { count: 15 } },
      ],
    },
    effects: [
      {
        // The class's loudest moment: 40 a meteor, about three on every body in
        // the storm, landing inside a second and a half.
        type: "areaHit",
        at: "target",
        // PoE2's impact is 1 m (poe2db.tw); 1.3 for bodies our size.
        radiusFixed: fp(1.3),
        maxRangeFixed: fp(16),
        damage: { type: "fire", amountFixed: fp(40) },
        // The spec's ten over 1.5 s.
        count: 10,
        intervalTicks: 5,
        // Our own: the first meteor waits 0.4 s, so even it is seen falling before it lands.
        delayTicks: 12,
        // PoE2's 3 m storm radius (poe2db.tw).
        scatterFixed: fp(3),
      },
    ],
  },
  {
    id: "skill.herald_of_ash.v1",
    name: "Herald of Ash",
    description: "An aura of cinders: while it holds a quarter of your mana, you deal more damage and every kill leaves burning ground.",
    classId: "class.emberbound",
    manaCostFixed: 0,
    cooldownTicks: 30,
    castTicks: 9,
    unlockLevel: 24,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4 },
      breakpoints: [{ atLevel: 10, text: "20% increased damage", patch: { damagePct: 20 } }],
    },
    effects: [
      {
        type: "applyBuff",
        buffId: "herald_of_ash",
        durationTicks: 0,
        // PoE1 heralds reserve 25% of mana.
        reserveManaPct: 25,
        // Our own.
        damagePct: 15,
        onKillGround: {
          // PoE2's 1.2 m explosion and 3 s ignite (poe2db.tw), widened to 1.5.
          radiusFixed: fp(1.5),
          durationTicks: 90,
          ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(10), durationTicks: 60, maxStacks: 3 },
        },
      },
    ],
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
 * The way home. Named because two places outside content fire it — the Y key and
 * the right-click on a Portal Scroll — and neither of them should be spelling an
 * id by hand.
 */
export const TOWN_PORTAL_SKILL = "skill.town_portal.v1";

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

/**
 * Every class's free attack. Nothing here was earned, so none of it takes a
 * share of a kill's gem experience and none of it is auto-slotted on a level.
 */
export const FREE_ATTACKS: ReadonlySet<string> = new Set(Object.values(DEFAULT_ATTACK_BY_CLASS));

/**
 * Utility actions, not skill gems. A utility skill never holds a gem and is
 * never granted, slotted, described or paid experience; it casts at def level 1
 * through its `SKILLS` entry.
 */
export const UTILITY_SKILLS: ReadonlySet<string> = new Set([TOWN_PORTAL_SKILL]);
