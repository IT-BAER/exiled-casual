# Exiled Casual — Slice: "Per-biome monster pools" (P1, the fight layer)

Design spec. Status: **built and expanded, verified 2026-08-05.**
Position: follows "Biomes & Layout Grammar" (`docs/specs/2026-07-28-biome-mapgen-design.md`),
which listed per-biome monster pools in its §8 risks and deferred them to this document.
Baseline: `docs/09-reward-psychology.md` §4 (rules 3, 4 and 8 constrain the kill→loot path).

This spec covers **P1 only**: the fight. The art it needs is real and is specced separately —
see "Decomposition" below. P1 ships playable on the existing imp primitive, and is fully
verifiable by tests without a single new model.

## As built

P1 shipped with the four archetypes, weighted biome pools, pack counts, faction-generic
projectiles, committed heavy telegraphs, and deterministic species in snapshots. The content now
has five biome pools: the original four use distinct three-archetype mixes, while Coast teaches all
four using species borrowed from the matching wet-sand biomes.

The presentation layer also shipped. `monsters.glb` contains one skinned mesh per species and
shared per-species idle, walk, and attack clips. A simulation-owned `attackTick` triggers the strike
once; locomotion resumes after the clip. Monsters use direct movement on open ground and consult a
body-radius navigation field only after collision blocks the direct step.

The known line-of-sight ceiling remains: aggro does not require visibility. Projectiles now stop at
level collision, but full perception and line-of-sight behavior is still a separate design problem.

## Product thesis

At the time this slice was written, four biomes looked different and fought identically. Every map, in every biome, at every tier,
spawns `monster.cinder_imp.v1` at each socket and `monster.cinder_warden.v1` in the boss room
(`simulation/src/areas.ts:146-169`), and every one of them runs the same behaviour: walk at the
player, swing at `attackRangeFixed` (`systems/monster-ai.ts`). A player who has learned one map
has learned all four.

**The biome must change what the fight asks of you, not just what it costs.** More life is a
longer fight, not a different one. The difference has to be positional: something that punishes
standing still, something that punishes standing close, and something that punishes fighting one
at a time.

## Decomposition (agreed 2026-07-28)

| | Scope | Ships |
|---|---|---|
| **P1** — this spec | Archetypes, per-biome pools, monster projectiles, telegraphed heavy. Sim + content + one protocol field. | Playable on existing art. |
| **P2** — later spec | The creature pipeline end to end for **one** creature: `tools/build_monsters.py` → `monsters.glb`, `/codex-imagegen` masters → re-palettizer, `MonsterActor` in the renderer. | One real monster, and a proven chain. |
| **P3** — later spec | The other 11, in biome batches of 3, reusing P2's builder primitives. | The full bestiary. |

P1 first because it defines the species ids P2's renderer keys off, it lets the numbers be tuned
before any model exists, and it is the half that can be proven by `vitest` alone.

## Constraints (locked this slice)

| Decision | Value |
|---|---|
| Archetypes | **4**: `swarm`, `brute`, `shooter`, `heavy`. |
| Species | **12**: 3 per biome, each biome a *different* 3-of-4 combination, so no two biomes read the same. |
| Bosses | **Unchanged.** `cinder_warden` remains the boss of all four biomes. Per-biome bosses are their own project (4 rigs + 4 phase-2 kits). |
| Geometry source | **Procedural in Blender** (user's call, 2026-07-28), same idiom as `tools/build_props.py`. Not a sourced CC0 pack. |
| New sim systems | **None.** Ranged reuses `projectileMove`, heavy reuses `telegraphResolve`. Both are already faction-generic or one query away from it. |
| Determinism | `mulberry32(mapSeed ^ k)` walked once per socket in socket order — the idiom every other roll in the repo uses (`rules/items.ts`, `rules/waystone.ts`). |
| `CONTENT_VERSION` | **Not bumped.** It seeds `generateArea`; bumping it would reshuffle every layout in the game for a change that touches no layout. |

## In scope

- `@exiled/content-schema`: `archetype` on `MonsterDef`, `RangedSpec`, `SlamSpec` extracted from
  `BossSpec.slam`, validator rules binding archetype to the spec it requires.
- `@exiled/content-runtime`: 12 new `MonsterDef`s, `MONSTER_POOLS`, and a pure `pickPack` selector.
- `@exiled/simulation`: pool-driven spawning in `areas.ts`; ranged and heavy branches in
  `monster-ai.ts`; `projectileMove` collides by faction instead of by "is a monster".
- `@exiled/protocol`: `SnapshotEntity.species?: string`.
- Balance measurement for all four archetypes in `simulation/src/balance.test.ts`.

## Out of scope (each its own spec)

The creature art (P2/P3). Per-biome bosses. Line of sight for projectiles and for aggro — see §7.
Monster affixes beyond the existing rare templates. Per-biome ambient audio. Monster death
animation (P2 — but see §6 for the constraint it must respect when it arrives). Pack-wide
behaviours (leaders, auras, flanking). Biome-specific loot tables.

## 1. The four archetypes

Each one exists to punish a different mistake. That is the whole design; the stats follow from it.

| Archetype | Punishes | Behaviour | Per socket |
|---|---|---|---|
| `swarm` | Fighting one at a time | Existing chase-and-melee, fast, fragile | **4** |
| `brute` | Trading hits | Existing chase-and-melee, slow, armoured, hits hard | **1** |
| `shooter` | Standing still | Stops at a long `attackRange` and fires a projectile | **2** |
| `heavy` | Standing close | Roots, telegraphs, slams a radius | **1** |

`swarm` and `brute` need **no new sim code at all** — they are the existing behaviour with
different numbers. Only `shooter` and `heavy` add branches, and both reuse a system the boss
already proves.

## 2. The twelve

Each biome takes a different 3-of-4 combination. There are exactly four such combinations and
four biomes, so each archetype appears in exactly three biomes and no biome is a subset of another.

| Biome | `swarm` | `brute` | `shooter` | `heavy` |
|---|---|---|---|---|
| Vaal Stone | Vaal Husk (phys) | Vaal Construct (phys) | — | Blood Sentinel (chaos) |
| Desert | Sand Skitterer (phys) | — | Dune Spitter (chaos) | Sunbaked Colossus (fire) |
| Swamp | — | Bog Drowned (phys) | Fen Wisp (lightning) | Rotting Behemoth (phys) |
| Forest | Bramble Whelp (phys) | Thornhide Boar (phys) | Hoarfrost Spitter (cold) | — |

Ids follow the existing convention: `monster.vaal_husk.v1`, and so on.

**Every element is now answered by a monster that exists.** Today the game ships fire skills, fire
resistance on one boss, and rare templates that are the only reason a cold resistance roll means
anything (`content-runtime/monsters.ts:88`). After this, chaos, fire, lightning and cold each have
an ordinary monster behind them, in a biome the player can choose to run or avoid — which is what
makes a resistance roll a decision rather than a number.

## 3. Data model deltas

```ts
// content-schema
export type MonsterArchetype = "swarm" | "brute" | "shooter" | "heavy";

/** A wind-up, a radius, a hit. Extracted verbatim from BossSpec.slam — the boss's
 *  slam and a heavy's slam are the same five numbers, and must not be two types. */
export interface SlamSpec {
  windupTicks: number; radiusFixed: Fixed; damageFixed: Fixed;
  cooldownTicks: number; rangeFixed: Fixed;
}
export interface BossSpec { phase2AtLifePct: number; slam: SlamSpec; phase2: {...} }  // unchanged shape

export interface RangedSpec {
  /** Fixed units per second; monster-ai divides by 30 the way moveSpeed does. */
  speedFixed: Fixed;
  radiusFixed: Fixed;
}

export interface MonsterDef {
  // ...existing fields unchanged...
  archetype: MonsterArchetype;
  ranged?: RangedSpec;   // required iff archetype === "shooter"
  heavy?: SlamSpec;      // required iff archetype === "heavy"
}
```

`validateMonsterDef` gains three rules: `archetype` is one of the four; `shooter` has `ranged` and
nothing else has it; `heavy` has `heavy` and nothing else has it. Bad content stays a load-time
throw, as it is today (`content-runtime/monsters.ts:55-62`).

`archetype` is **required, not optional**. `cinder_imp` becomes `swarm` and `cinder_warden`
becomes `brute`; a def that forgets it should fail to compile, not default silently. A boss takes
the archetype of the trash behaviour it falls back to — `boss` being present is what makes it a
boss, and `BossSpec.slam` stays the boss's own slam, distinct from `heavy`.

```ts
// simulation/components.ts — MonsterC
rootedUntilTick: number;   // new; 0 for everything that is not mid-wind-up
```

`BossC.rootedUntilTick` already exists and stays where it is: the boss reads its own, trash reads
`MonsterC`'s, and neither system touches the other's. Adding a field to `MonsterC` is safe for
replay because `packages/replay` compares run against run and stores **no goldens on disk**
(`replay/src/replay.test.ts`) — nothing to regenerate.

```ts
// protocol
species?: string;   // SnapshotEntity; the def id, so the renderer can pick a mesh in P2
```

A plain string, no content import — the same precedent `name` and `baseName` already set.

## 4. Pools and pack composition

```ts
// content-runtime/monsters.ts
export const MONSTER_POOLS: Record<BiomeId, readonly { defId: string; weight: number }[]>;

/** How many of an archetype stand at one socket. Content's number, not the sim's:
 *  "a swarm is four" is a statement about the monster, not about the layout. */
export const PACK_COUNT: Record<MonsterArchetype, number>;   // swarm 4, brute 1, shooter 2, heavy 1

/** Weighted pick of the species that fills one socket. Total, deterministic, and
 *  content supplies no randomness — the caller passes a 0..1 roll, exactly as
 *  rareTemplate takes an integer. The count is PACK_COUNT[def.archetype]. */
export function pickPack(biomeId: BiomeId, roll: number): MonsterDef;
```

Weights: `swarm` 3, `brute` 2, `shooter` 2, `heavy` 1. A heavy is the rarest thing in the pool
because it is the loudest, and three per map is a fight, ten is a chore.

`buildArea` reaches the biome by the route `area-transition.ts:74` already uses for the grammar:
`mapBaseIdForNode(session.activeNodeId)` → `mapBase(...).biomeId`. No new plumbing, no new session
field.

Per socket: roll an archetype, then spawn **that archetype's count** at the socket, spread by
`PACK_SPREAD`. That constant grows from 3 entries to 8: the largest pack is a swarm of 4, a 100%
pack-size roll doubles it, and at anything under 8 the extras land back on top of the first three
and a doubled swarm reads as four monsters rather than eight.

**The socket contract is unchanged**: the generator owns where a fight may stand, and content may
never place a monster the layout did not sanction. Pack-size from the Waystone keeps working as it
does now, adding passes over the same sockets.

The rare still rides the last of the layout's own sockets (`areas.ts:157`). One change: a rare
`heavy` is a rare that roots and telegraphs — that is a genuinely better rare fight than a rare imp,
and it costs nothing to allow.

## 5. Ranged

`projectileMove` currently iterates `world.query("position", "monster", "faction")` and damages the
first monster it overlaps (`systems/projectile.ts:24`). It already carries `team` and already skips
its own team — it simply cannot see the player, because the player has no `monster` component. The
fix is the query: `world.query("position", "health", "faction")`, keeping the existing team test.
That is the whole change, and it is the root-cause shape of it: every future projectile source,
monster or player, routes through the one loop.

`monster-ai` gains one branch before the melee test: if `def.ranged` and the player is inside
`attackRange`, spawn a projectile aimed at the player and set `attackReadyTick`; do not enqueue
damage. Chase already stops at `attackRange`, so a shooter with `attackRangeFixed` fp(7.5) stands
off and fires without one line of kiting AI.

Shooter range fp(7.5) sits deliberately inside `AGGRO_RADIUS` fp(9): a shooter that wakes must be
able to reach you, or it wakes and does nothing until you walk into it.

## 6. Heavy

`telegraphResolve` is already fully faction-generic — it damages anything with `health` +
`faction` on a different team (`systems/telegraph-resolve.ts:17-26`). A heavy needs no new system,
only the spawn half of what `boss-ai.ts:109-143` does:

1. Off cooldown and player inside `heavy.rangeFixed`: create a `TelegraphC` at the *player's
   current position*, `impactTick = tick + windupTicks`, `leavesGroundTicks: 0` (no burning patch —
   that stays a boss privilege).
2. Set `MonsterC.rootedUntilTick = tick + windupTicks` and `attackReadyTick = tick + cooldown`.
3. While rooted: do not move, do not melee, state `"attack"`.

`windupTicks` **30 (1.0s at 30Hz), matching the boss.** The telegraph is placed where you stand and
resolves where it was placed, so the dodge is real and it is the same dodge the player already
learned on the Warden. A wind-up shorter than ~0.75s is not a decision, it is a reflex test.

Dopamine constraint (`docs/09` §4 rule 8): a heavy dies like anything else — **loot rolls on the
killing blow.** When P2 gives these creatures a death clip, the clip plays over a drop that has
already happened. A death animation that gates the drop is a gameplay bug, not a presentation
choice.

## 7. Known ceilings

**Projectiles pass through walls, and aggro ignores line of sight.** Both are true of the game
today; a shooter makes the first one visible for the first time. The cheap mitigations are already
in the numbers (`attackRange` 7.5 < `AGGRO_RADIUS` 9, and a shooter has to wake before it fires),
but a bolt through a corner will happen in the `loop` grammar. LOS is its own spec, touching
`collision.ts` for both the player's projectiles and the monsters'. Marked with a `ponytail:`
comment at the branch, naming LOS as the upgrade path.

**Entity count.** A swarm socket is 4 monsters where there was 1. A 7×7 map has ~8-12 spawn
sockets, so a swarm-weighted biome roughly triples monster count, and `projectileMove` is
O(projectiles × damageable). Measure before optimising; the fix, if needed, is a broadphase, and
the trigger is a measured frame, not this paragraph.

## 8. Balance

Starting numbers, relative to the `cinder_imp` baseline (40 life, 2.4 speed, 6 damage, 45-tick
cooldown, 0.5 radius). **These are starting points to be measured, not the design.** The repo
tunes monsters by instrumented time-to-kill (`simulation/src/balance.test.ts`) and every number in
`monsters.ts` today carries the measurement that set it; these will too.

| Archetype | Life | Speed | Damage | Cooldown | Radius | Extra |
|---|---|---|---|---|---|---|
| `swarm` | 24 | 3.0 | 4 | 40 | 0.42 | — |
| `brute` | 140 | 1.45 | 13 | 75 | 0.85 | armour fp(3) |
| `shooter` | 32 | 2.15 | 8 | 70 | 0.5 | range 7.5, bolt speed 9/s |
| `heavy` | 88 | 1.8 | 8 melee | 45 | 0.8 | slam 22 @ r2.6, windup 30, cd 150, range 6.5 |

Targets the balance test asserts, at Tier 1 against the reference character:

- A swarm socket (4) clears in **2-4s**; a brute in **4-7s**; a heavy in **3-6s**.
- A full biome pack (3 sockets, one of each of that biome's archetypes) kills a stationary,
  non-flasking reference character in **under 12s** — pressure has to be real, or the positional
  design is decoration.
- A heavy's slam is dodgeable: `windupTicks / 30 ≥ 0.75s`, asserted directly on the content.

Elemental damage is intentionally **not** larger than physical of the same archetype. The element
is there to make a resistance mean something, not to make one biome harder than another.

## 9. Testing

| Test | What it pins |
|---|---|
| `content-runtime/content.test.ts` | 12 defs load and validate; every `MONSTER_POOLS` entry resolves in `MONSTERS`; every biome has exactly 3; the 3-of-4 combinations are all distinct; `shooter`⇔`ranged` and `heavy`⇔`heavy` hold. |
| `content-schema/schema.test.ts` | Validator rejects a shooter without `ranged`, a heavy without `heavy`, an unknown archetype, and a def with a spec its archetype does not own. |
| `simulation/areas.test.ts` | The biome of the active node decides the pool; the same `mapSeed` produces the same species in the same socket order twice; per-archetype counts land at each socket; the rare is still on the last layout socket. |
| `simulation/systems/monster-ai.test.ts` | A shooter in range spawns a projectile and enqueues **no** damage; a heavy spawns a telegraph, does not move while rooted, and does not melee while rooted; swarm and brute take the unchanged path. |
| `simulation/systems/projectile.test.ts` | A monster-team bolt damages the player; a player bolt still damages monsters; neither damages its own team. **This is the regression test for the query change.** |
| `simulation/balance.test.ts` | The §8 bands, and the ≥0.75s wind-up. |
| `replay/scenarios` | An existing scenario's checksum sequence still reproduces run-to-run with the new `MonsterC` field. |

## 10. Slice order

1. Schema + validator + the two spec types, `cinder_imp`/`cinder_warden` given their archetypes.
   Nothing behavioural changes; the suite must stay green on its own.
2. `projectileMove` query change + its regression test. Alone, and green, before anything fires.
3. The 12 defs + `MONSTER_POOLS` + `pickPack`, still unspawned.
4. `areas.ts` pool-driven spawning + `PACK_SPREAD` to 5. Now the game plays differently.
5. `monster-ai` shooter branch, then heavy branch.
6. `protocol.species` + worker bridge (renderer ignores it until P2).
7. Balance pass against §8, in-game, with the numbers rewritten to what was measured.
