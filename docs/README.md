# Exiled Casual Research and Implementation Pack

Version lock: Path of Exile 2 Early Access 0.5.4b, researched 2026-07-19  
Primary rules baseline: Content Update 0.5.0, Return of the Ancients  
Purpose: research baseline plus implementation specifications for an original browser-native action RPG

Scope note: this pack is version-locked to PoE2 because that is what was researched here, but the
game it feeds draws on Path of Exile 1 and 2 both, taking the better of the two where they differ
(PoE1's inventory pane and bottom bar, for instance). Where a mechanic or look is borrowed, the
spec that borrows it names which game it came from.

The numbered chapters are the researched target and future architecture, not a claim that every
system is already shipped. The current repository contract is
[`specs/2026-08-05-current-implementation-contract.md`](specs/2026-08-05-current-implementation-contract.md).
Current code and contract tests take precedence when a historical slice records an older decision.

## Read this first

A literal "perfect clone" is neither technically knowable from public information nor a safe product target. Hidden drop weights, proprietary map-generation parameters, server tick details, internal AI, exact collision shapes, unreleased content, assets, names, lore, audio, and source code are not public. Grinding Gear Games' terms also prohibit modifying or reverse engineering the client, its data, technical processes, and communications protocols, and claim broad rights over the game's audiovisual and world content.

This pack therefore specifies the strongest defensible target:

1. Reproduce the observable design grammar and moment-to-moment loop.
2. Rebuild every rule from independent, versioned data and original code.
3. Create original names, lore, maps, art, audio, icons, monsters, items, and numeric balance.
4. Treat undocumented constants as explicit product decisions, then tune them through telemetry and playtests.
5. Keep an evidence ledger so patch changes and uncertain claims do not silently become code.

This is a clean-room mechanics and architecture document, not copied game data and not legal advice. A public or commercial release needs an intellectual-property review before production art or marketing begins.

## What is in the pack

| Document | What it answers |
|---|---|
| [01-atlas-and-map-running.md](01-atlas-and-map-running.md) | How the current Atlas, Waystones, map lifecycle, deaths, tablets, fortresses, masters, league content, and procedural areas work |
| [02-items-loot-crafting-economy.md](02-items-loot-crafting-economy.md) | How item generation, rarity, affixes, currency crafting, loot presentation, inventory, stash, vendors, filters, and trade fit together |
| [03-combat-skills-character.md](03-combat-skills-character.md) | How input, movement, dodge, attacks, spells, damage, defenses, ailments, gems, supports, resources, passives, weapon sets, monsters, and bosses interact |
| [04-browser-architecture.md](04-browser-architecture.md) | A browser-native client/server architecture, deterministic simulation, rendering, networking, persistence, security, and performance budgets |
| [05-data-model-and-rules-engine.md](05-data-model-and-rules-engine.md) | Canonical domain model, schemas, modifier algebra, effect graphs, event ordering, seeded RNG, saves, and transaction boundaries |
| [06-build-plan-and-validation.md](06-build-plan-and-validation.md) | Vertical slices, sequencing, staffing reality, acceptance criteria, tests, balance telemetry, content tools, and release gates |
| [07-source-ledger.md](07-source-ledger.md) | Official and community sources, version relevance, confidence, conflicts, and unanswered questions |
| [08-product-ui-and-api-contracts.md](08-product-ui-and-api-contracts.md) | Desktop product surfaces, input and accessibility rules, HTTP/real-time contracts, reconnects, errors, admin, and telemetry |
| [09-reward-psychology.md](09-reward-psychology.md) | Reward anticipation, variance, audiovisual payoff, and the constraints every loot or progression feature answers to |

## Implementation specifications

| Specification | Current status |
|---|---|
| [Current implementation contract](specs/2026-08-05-current-implementation-contract.md) | Living as-built truth, verified 2026-08-05 |
| [First Descent](specs/2026-07-19-first-descent-design.md) | Built and substantially surpassed |
| [Waystones and tier scaling](specs/2026-07-21-waystones-tier-scaling-design.md) | Built; inventory stones, modifiers, sustain, and 15-node Atlas added later |
| [First Loot](specs/2026-07-22-first-loot-design.md) | Built; full rarity, crafting, stash, vendor, and equipment loop added later |
| [Accounts and online mode](specs/2026-07-28-accounts-and-online-mode-design.md) | Local roster/migration/import built; online authority remains design-only |
| [Biomes and layout grammar](specs/2026-07-28-biome-mapgen-design.md) | Built; later expanded with Coast and a dedicated shoreline generator |
| [Per-biome monster pools](specs/2026-07-28-monster-pools-design.md) | Built, including authored species rigs and strike clips |
| [Loading screen](specs/2026-07-29-loading-screen-design.md) | Built across boot, lazy chunk, and area transitions |
| [Options panel](specs/2026-07-29-options-panel-design.md) | Built and expanded; damage numbers remain deferred |

## Evidence vocabulary

Every consequential rule should carry one of these statuses in code comments, content metadata, or the source ledger:

| Status | Meaning | How to use it |
|---|---|---|
| `verified-primary` | Current official patch notes, official docs, official presentation, or first-party store text | Safe baseline until a newer first-party source changes it |
| `verified-secondary` | Current community wiki or repeatable gameplay observation | Implement, but add regression capture and re-check on patches |
| `conflicted` | Current sources disagree | Put behind a content-version switch and resolve with controlled observation |
| `inferred` | Proposed design needed to reproduce the feel, not a claim about GGG internals | Tune as our own design |
| `unknown` | Cannot be responsibly established from public evidence | Do not fabricate a PoE-accurate claim; choose and document an original constant |

## The product in one loop

The endgame browser product is a session-based action RPG with a persistent meta-map:

```text
Build character
    -> inspect reachable Atlas nodes
    -> choose and craft a Waystone
    -> combine risk modifiers and optional content
    -> generate a deterministic combat area
    -> traverse, fight packs, interact with encounters, kill the boss
    -> evaluate and filter loot
    -> equip, craft, stash, sell, or trade
    -> unlock adjacent Atlas nodes and passive choices
    -> raise difficulty, specialization, and reward density
    -> repeat
```

The loop works because five systems multiply each other rather than operating independently:

| System | Player decision | Immediate consequence | Long-term consequence |
|---|---|---|---|
| Build | skill, support, passive, equipment, weapon-set choices | action vocabulary and survivability | which content and modifiers are efficient or dangerous |
| Waystone | tier, rarity, affixes, corruption, tablet inputs | map difficulty and reward multipliers | sustain and access to higher tiers |
| Atlas | route, fortress, master, league specialization | next encounters and objectives | permanent account-wide endgame identity |
| Combat | positioning, timing, target priority, resource use | survival and clear speed | XP, death cost, boss access |
| Economy | pick up, filter, identify, craft, keep, sell, trade | power gained per minute | market liquidity and build progression |

Removing any one of these feedback paths produces a shallow imitation. The browser clone must preserve the coupling, even if its first release has fewer skills, bases, bosses, and leagues.

## Recommended fidelity target

### Tier A: interaction fidelity

This is non-negotiable for the vertical slice:

- Direct click-to-move and WASD movement, aim independent of travel direction.
- Low-latency skill execution with animation commitment, buffering, cancellation rules, and readable recovery.
- Dodge roll with projectile and melee avoidance at the start, but no general immunity.
- Moving attacks and spells where the skill permits them, with per-skill movement penalties.
- Dense packs with distinct normal, magic, rare, and boss behavior.
- Telegraphs that survive screen clutter, including shape, delay, color, audio, and ground-state cues.
- Item drops as server-authored world entities, followed by deterministic filter evaluation.
- A six-mod risk/reward map object, limited map revives, boss reset behavior, completion, failure, and stripped re-entry.
- Deterministic map and combat seeds that can be replayed from telemetry.

### Tier B: systems fidelity

Required before early access:

- Data-driven skill gems, support gems, persistent Spirit reservations, two weapon sets, passive tree, and item-granted skills.
- Normal, magic, rare, and unique item states with prefix/suffix capacity and currency transformations.
- Tiered Waystones, map sustain, Atlas graph exploration, fog of war, points of interest, towers, fortresses, tablets, and masters.
- Several encounter archetypes that stress different builds: timed expansion, escalating arena, risk selection, multi-map chain, and pinnacle boss key.
- Stash, vendors, gold, filters, crafting, account progression, and auditable economy transactions.
- Solo server authority first, then party ownership, independent revives, area migration, and allocation rules.

### Tier C: content breadth

Content count is not the first milestone. The official store describes a finished-game ambition of 12 classes, 36 Ascendancies, 240 active gems, 200 supports, 1,500 passive skills, 700 equipment bases, and six-player co-op. The live Early Access game and community databases do not map cleanly to those marketing categories. For example, support counts differ when tiers, lineage variants, or database rows are counted separately.

A practical first public build should instead target:

- 3 character archetypes with cross-class skill access.
- 24 active skills and 36 supports, selected to exercise every effect-graph primitive.
- 60 passive nodes plus 3 keystones.
- 45 equipment bases, 120 affix families, 20 currencies, and 15 original uniques.
- 8 map tilesets, 20 bosses, 25 monster families, and 2 encounter systems.
- 3 Waystone tiers for the slice, then the complete 15-tier progression once sustain is balanced.
- 1 fortress path and 1 pinnacle chain.

Those counts are proposed production targets, not claims about PoE 2.

## Version rules that invalidate older clone guides

Many public PoE 2 guides describe launch-era endgame and are wrong for 0.5.x. The implementation must not inherit these obsolete assumptions:

| Obsolete assumption | Current 0.5.x baseline |
|---|---|
| Map completion means killing every rare monster | Current map completion centers on a unique map boss, with some areas adding another objective |
| Tablets are applied through tower radius | Tablets are selected in the Map Device and consumed by uses; towers retain discovery/reward functions |
| All portals are consumable entry charges | Current portals represent map revives. Players can normally leave and re-enter without spending one |
| Atlas points come from a small early quest chain | Fortress completion drives the greatly expanded main Atlas tree, with more than 300 nodes and eventual full allocation |
| Pinnacle bosses are single-progression events | Quest versions lead into repeatable, infinitely farmable versions |
| League systems are random side rooms only | Major systems have Atlas hubs, staged quests, their own passive progression, keys, and pinnacle paths |
| Support gems are account-global one-copy constraints | Since 0.3, ordinary supports can be used across multiple skills; duplicate support categories still cannot stack inside one skill |

## Core design invariants

These invariants prevent individual features from drifting into an unrelated ARPG:

1. **Risk must be legible before entry.** A player can inspect area tier, modifiers, content, objective, expected revival budget, and warnings before consuming the map item.
2. **Power is compositional.** Skills, supports, passives, items, buffs, ailments, and encounter modifiers pass through one stat and effect system. No separate combat math per feature.
3. **Difficulty pays.** Harder modifiers increase reward through explicit pack, rarity, effectiveness, and drop channels. No hidden blanket multiplier that cannot be explained in the UI.
4. **Drops are objects, not a score fountain.** Items have bases, requirements, sockets, affixes, state, identity, provenance, and inventory geometry.
5. **Deaths have scoped consequences.** Campaign-style area reset, map revival, XP penalty, boss reset, and hard-core migration are separate policies selected by area type.
6. **Content is versioned.** A saved item, Atlas node, or replay records the content build that authored it.
7. **The server owns outcomes.** Movement tolerance can be client-predicted, but damage, item creation, crafting, map consumption, rewards, XP, trade, and persistence are authoritative.
8. **All randomness is reproducible.** Every roll consumes a named deterministic stream with a recorded seed and ordinal.
9. **A map is a bounded transaction.** Inputs are reserved atomically, the run has a unique identity, and completion/failure can be recovered after a process crash without duplicating rewards.
10. **Content tools are part of the game.** Designers need validation, simulation, preview, diff, and migration tools before content volume grows.

## Scope boundary

This pack deeply specifies the repeatable endgame and all foundations it depends on. It does not attempt to reproduce PoE 2's proprietary campaign, narrative, exact passive tree, exact skill catalogue, exact item database, cash shop, social moderation operation, regional infrastructure, or anti-cheat implementation. Those are separate products or protected content.

The intended original browser game can support:

- Desktop Chromium, Firefox, and Safari, with progressive WebGPU and WebGL2 fallback.
- Keyboard/mouse first, controller after the input abstraction is stable.
- Installable PWA shell, but an online authoritative game session.
- Solo at vertical-slice launch, then parties up to four or six after server migration and encounter scaling are proven.
- Seasonal content versions with explicit migration rather than in-place mutation of old objects.

Mobile browser play is not a baseline requirement. Dense ARPG input, labels, inventory management, heat, memory, and GPU pressure need a separately designed touch client.

## The minimum convincing vertical slice

The first slice should prove one complete economic run, not merely combat in an arena:

1. Sign in and load an account, character, stash, inventory, build, and Atlas seed.
2. Inspect three reachable Atlas nodes.
3. Select a tiered Waystone, apply two currency operations, and view resulting risk and rewards.
4. Insert an optional encounter modifier into the Map Device.
5. Atomically consume or escrow map inputs and create a run.
6. Generate a seeded indoor or outdoor map with a known monster budget.
7. Fight normal, magic, and rare packs using six active skills across two weapon sets.
8. Trigger one timed league-style encounter and defeat a multi-phase boss.
9. Die once, revive, observe boss reset, and retain the remaining revival budget.
10. Complete the map, unlock an adjacent node, gain one Atlas point, and receive deterministic loot.
11. Run the item filter, compare drops, identify, craft, equip, stash, and sell.
12. Reconnect after a forced client refresh without duplicating inputs or rewards.
13. Replay the run from its seed and command log on a developer build, producing the same authoritative checksum.

If that sequence is not satisfying and recoverable, adding hundreds of skills or maps will make the project larger, not better.

## Practical conclusion

Treat PoE 2 as three related engineering products:

- A deterministic real-time combat simulation.
- A content compiler and authoring environment.
- A persistent economy and progression service.

The browser renderer is important, but it is not the hardest part. The hard part is keeping thousands of data-authored interactions deterministic, explainable, migratable, secure, and fast while designers continuously add content. The rest of this pack is organized around that reality.
