# Skill acquisition and gem levels

Status: design, approved 2026-08-10. Implements the fixed-ratio track `docs/09-reward-psychology.md`
rule 7 asks for: a progression that pays on a dry session, sitting underneath the variable-ratio
loot rather than competing with it.

Today there is no acquisition and no upgrade. `protocol-bridge.ts` walks the whole `SKILLS` map, so
every character sees every skill from creation at numbers that never change.

## 1. The shape

- A skill is **unlocked by character level**. No drop, no choice, no currency.
- An unlocked skill **levels on its own experience**, PoE1's gem levelling.
- Experience is **shared by every skill on the bar**, used or not, so swapping a skill in costs
  nothing but a slot and experimenting stays free.
- A gem level raises damage, raises mana cost, and grants one authored per-skill scalar.
- Two **breakpoints** per skill change behaviour rather than numbers.

The variance this deliberately lacks is not a defect. Rule 7 wants exactly one predictable track
running under the loot; adding drop RNG here would duplicate what Waystones and the Atlas already do.

## 2. Character levels move to 1-100

The current game starts at `START_LEVEL = 65` because `areaLevel(0)` is 64 and there is no campaign.
Levelling from 1 requires level-appropriate areas, so the Atlas rescales rather than growing.

| Rule | Now | Becomes |
|---|---|---|
| `START_LEVEL` (`rules/xp.ts`) | 65 | 1 |
| `areaLevel(tier)` (`rules/atlas.ts`) | `64 + tier` | `2 + 6 * tier`: tier 0 = 2, tier 14 = 86 |
| `xpToNext` | `60_000 + 40_000 * (lv - 65)` | cheap at 1, steep at 90; still pure integer |
| `levelBonus` | 6 life / 2 mana across 35 levels | re-baselined across 99 levels to the same total |
| `monsterTierScale` | `1000 + 150 * tier` | re-measured against the new area levels |

`xpPenaltyPct` is unchanged and does the rest: it is symmetric, so a character who outgrew tier 0
stops being paid for it and is pushed up the Atlas. That is the pacing mechanism, not a new one.

This re-tunes the whole difficulty curve. `balance.test.ts` measures kill and death times against
bands taken from the old numbers, and those bands get **re-measured against the same rig**, never
re-argued. That is a deliverable of the implementation, not a follow-up.

## 3. Data model

A new component on the session entity, beside `ProgressC`:

```ts
export interface SkillsC {
  /** skill id -> its gem. Only unlocked skills appear. */
  gems: Record<string, { level: number; xp: number }>;
  /** The action bar. Moves here out of global settings. */
  bar: (string | null)[];
}
```

The bar is per character from now on. It currently lives in `apps/web/src/settings.ts` as global
roster UI data shared by every character, which cannot survive skills that differ per character and
earn experience from the slot they sit in.

`SkillsC` rides the existing opaque `state` blob into the roster, so `ROSTER_VERSION` (3) is
untouched. `persist.VERSION` also stays at 2: `loadInto` returns false on any version mismatch and
there is no migration path (`persist.ts:107`), so bumping it would silently delete every existing
character. Instead `skills?: SkillsC` is added as an **optional** field, exactly the pattern
`stash`, `progress` and `shards` already use, and `restore` fills it in for a save written without
one — seeding `bar` from the old global setting and granting every skill the level qualifies for.
Unlock is derived from level anyway, so an absent field is not missing data.

Content gains three fields per `SkillDef` (`content-schema`, validated at module load like the rest):

```ts
classId?: string;      // absent = every class
unlockLevel: number;   // character level that grants it
growth: {
  perLevel: {
    damagePct: number;   // compounding
    manaPct: number;     // compounding
    /** One authored scalar, in per-mille of the def's own value, per level. */
    own?: { field: "radiusFixed" | "durationTicks" | "distanceFixed"; perMille: number };
  };
  /** At most two. `patch` is a partial effect merged over the def's effect. */
  breakpoints: { atLevel: number; text: string; patch: Partial<SkillEffect> }[];
};
```

Unlock levels for the skills that exist today, chosen so a character has a kit inside the first
hour and the rest of the climb is gem levels:

| Skill | Unlock |
|---|---|
| the three class default attacks | 1 (already free) |
| Ember Bolt | 1 |
| Blink | 4 |
| Cinder Ground | 8 |
| Portal | 10 |

## 4. Rules (`packages/rules/src/skill-xp.ts`, a pure leaf)

- **Grant** is derived, never stored as a decision: a skill is unlocked when
  `unlockLevel <= charLevel` and its `classId` matches. Recomputing from level on every load means a
  save cannot desync into a missing skill.
- **Cap**: `maxGemLevel = min(20, charLevel)`. A gem holds experience past its cap and pops the
  instant a character level allows it, so a level-up can pay twice. Intensity over density.
- **Award**: the kill's existing `xpAward` value, divided evenly across occupied bar slots,
  truncated per slot. Integer only, so replay checksums hold.
- **Level effect**: damage `+6%` per level compounding (about 3.2x at gem 20), mana cost `+4%`, plus
  the authored per-skill scalar. Mana rising with damage is what keeps mana the cap on sustained
  damage that `balance.test.ts` already assumes.
- **Breakpoints** at gem 5 and 15, authored as an effect patch in the def, applied by the same fold
  that reads the def. Not a code branch per skill: Ember Bolt pierces at 5 and forks at 15 because
  its data says so.

Damage and cost are computed where `describeSkills` already recomputes them, so the tooltip promises
exactly what the cast does.

## 5. Class restriction

`classId` is authored and enforced from day one, but **every skill that exists today is authored as
classless**. There are three non-default skills; splitting them three ways gives no class a kit and
would take away skills characters have now. The field exists, the enforcement path is tested with a
fixture, and the second spec turns it on as it authors the 6 to 9 class skills.

## 6. Feedback

Rule 1 of `docs/09`: a reward the player cannot perceive did not happen.

- A gem level plays a distinct cue and flashes its bar slot. Snapshot diff, never a call at the
  award site, like every other cue.
- A breakpoint plays a louder cue and raises a panel card naming what changed.
- The skill tooltip gains a level line, an experience bar, and the **next breakpoint greyed out**.
  That grey line is where the anticipation lives, and it is the cheapest device in the design.

## 7. Verification

New pins:

- unlock table against `CLASS_IDS` and `SKILLS`, extending the existing `content.test.ts` pin, so a
  renamed skill or a new class cannot leave a hole;
- `maxGemLevel` at character 1, 20 and 100;
- award split across 1, 2 and 5 occupied slots, including the truncation;
- a save written without `skills` restores with the bar seeded and the gems granted, and no
  existing character is dropped;
- `balance.test.ts` re-measured, with gem 1 and gem 20 both inside their bands;
- golden replay checksums unchanged in shape (they will differ in value; regenerate deliberately and
  say so in the commit).

## 8. Out of scope

Support gems, gem quality, a cost to swap, and the class skill kits themselves. Those are the second
spec, written against a system that already runs.
