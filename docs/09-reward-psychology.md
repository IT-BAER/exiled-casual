# 09 - Reward psychology

Research snapshot: 2026-07-26. This document outranks the other specs. Where a rule here and a
rule elsewhere disagree about what to build, this one wins, and the other spec gets a note saying
why. Correctness, determinism and the safety rules in `CLAUDE.md` are not subordinate to it: a
replay that desyncs or a save that corrupts destroys far more reward than any drop ever created.

## 1. What we are actually building for

The loop this genre sells is not loot. It is *anticipation of loot*. The dopamine response in a
reward-schedule game fires ahead of the reward, on the cue that a reward might be coming, and it
fires hardest when the outcome is genuinely uncertain. Receiving the item resolves the tension; it
does not generate it. Every design decision below follows from that one asymmetry.

The schedule that produces this is **variable ratio**: reward after an unpredictable number of
actions. It is the reinforcement schedule that produces the highest and most persistent rate of
behaviour, and, unlike a fixed schedule, it does not produce a post-reward pause - the player does
not stop after a win, because the next pull is equally likely to pay
([FutureLearn](https://www.futurelearn.com/info/courses/game-psychology/0/steps/428456),
[Dot Esports](https://dotesports.com/general/guides/why-are-loot-systems-so-addictive)).

Two consequences we keep getting wrong by instinct:

- **Raising drop rates can lower engagement.** If every kill pays, the schedule stops being
  variable and the anticipation collapses. Scarcity is not a monetisation lever here, it is the
  load-bearing wall.
- **A reward the player cannot perceive did not happen.** An item that drops with no sound, no
  beam and no colour is mechanically a reward and psychologically nothing.

## 2. Where PoE actually puts the triggers

Marked by which game the device is strongest in, per the project's borrowing rule.

| Device | Game | What it does psychologically |
|---|---|---|
| Per-currency drop sound | PoE1 | A conditioned reinforcer. The player learns the Exalted clink before they can read the item. Audio arrives before the eye finds the item, so the spike precedes identification. |
| Loot filter beams and colours | PoE1 | The single largest engineered device in the game. It converts a floor of noise into a small number of high-salience events. GGG shipped built-in filters because the community's (Neversink) had become mandatory equipment. |
| Screen-filling burst encounters | PoE1 | Breach, Legion, Delirium, Ritual: a tension ramp under a timer, resolving in one loot explosion. Reward is *concentrated* rather than spread, which is the same total loot at many times the intensity. |
| Guaranteed boss reward | PoE2 | 0.2.0g moved to loot tiering and guaranteed boss drops, away from leaning on Item Quantity ([poebuilds.net](https://www.poebuilds.net/post/path-of-exile-2-patch-0-2-1-interview)). A fixed payout at the end of a long variable stretch closes the arc so the session ends on a win. |
| Rare-monster density | PoE2 | Rogue Exile frequency and unique chance were tripled in the same era. Small, frequent, individually uncertain pulls between the big ones. |
| Crafting orbs | both | Each application is its own pull, with the item as the slot machine. This is why crafting outperforms buying as a retention device. |
| Atlas completion | both | Fixed-ratio drip (checkboxes, points) interleaved with the variable-ratio loot. The fixed track guarantees the session feels productive even on a dry run. |
| Death penalty | both | Loss aversion. XP loss and portal loss raise the felt value of everything that survives the map. |

## 3. What PoE2 got wrong, and what it cost

PoE2's early access shipped with rewards that players read as too sparse and too flat. GGG's public
position in the January 2025 Q&A was that there was no problem with loot; the patch record
disagrees with the interview. 0.2.0g rewrote how drops are calculated around Monster Item Rarity,
loot tiering and guaranteed boss rewards, and drop rates for valuable items were re-tuned
specifically to create *more impactful reward moments* rather than more items
([poebuilds.net](https://www.poebuilds.net/post/path-of-exile-2-patch-0-2-1-interview)).

The lesson is not "PoE2 was stingy". It is that **reward density and reward intensity are separate
knobs, and PoE2 tuned quantity when the problem was intensity.** More items spread thin reads as
worse than fewer items delivered loudly.

## 4. Rules for this codebase

1. **Every reward gets a perceivable event.** A drop that the client cannot show with a distinct
   sound and a rarity-coloured label is not finished. This is a definition-of-done item, not
   polish to schedule later.
2. **Rarity must be audible before it is legible.** Distinct sound per rarity tier, and a
   separate one for currency. The sound plays on the drop, not on the pickup.
3. **Concentrate, do not spread.** When a budget of loot exists, prefer one loud moment over
   several quiet ones. A boss that drops six items at once beats six monsters dropping one each.
4. **Close every map on a guaranteed payout.** Follow PoE2 0.2.0g: the boss pays out every time.
   The variable schedule lives inside the map; the map itself must not be able to pay zero.
5. **Never flatten the schedule to be kind.** Requests to "make drops more reliable" are requests
   to remove the mechanism. Raise the floor with guaranteed payouts (rule 4), never by narrowing
   the variance of the ordinary drop.
6. **The near miss is a real reward.** A rare that rolls the right base with the wrong affixes is
   a designed outcome, not a failure of generation. It must be legible enough for the player to
   see how close it came.
7. **Keep a fixed-ratio track running underneath.** Levels, atlas nodes, waystone tiers. On a dry
   session this is the only thing that pays, and it is what stops a dry session ending the run.
8. **Latency is a dopamine tax.** The gap between the killing blow and the loot appearing is the
   window the spike lives in. Treat any regression there as a gameplay bug, not a perf nit.

## 5. What this makes harder

Stated up front, because rule 1 is expensive. Tying a definition-of-done to audio and to a
rarity-coloured label means loot work can no longer land sim-side alone, and every new drop source
carries client work with it. That is deliberate: an unperceivable reward is the failure mode this
whole document exists to prevent. The alternative - shipping the sim half and scheduling the
feedback later - is how PoE2's early access arrived at its own loot problem.

## 6. Unknowns and calibration

Not derivable from public material; treat as tuning knobs with telemetry, never as constants to
guess once and forget:

- Drop-rate curves per rarity and per tier. GGG's are server-side and unpublished.
- The interval that makes a dry streak feel tense rather than unfair.
- How much of the response is the sound versus the item. Testable here, and worth testing.
- Whether the guaranteed boss payout should scale with tier or stay flat.
