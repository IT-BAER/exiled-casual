# Exiled Casual — Slice: "Waystones + Tier Scaling"

Design spec. Status: **built and surpassed.** Historical scope approved 2026-07-21; current
behavior verified 2026-08-06. See
[`2026-08-05-current-implementation-contract.md`](2026-08-05-current-implementation-contract.md).
Baseline research: `docs/` pack (PoE 2 EA 0.5.4b clean-room reconstruction).
Position: closes the last **Phase 3** gap in `docs/06` (map item + device activation)
before Phase 4 loot/crafting and Phase 5 full Atlas. Follows Milestone 3 (boss arena,
hideout↔map loop, portals, death-return) at HEAD `b167f4d`.

## As built

The tier formula, deterministic scaling, authoritative activation, and preparation panel shipped.
The temporary offer model in this document no longer describes the game:

- Waystones are 1 by 1 backpack items selected by inventory cell, not regenerated panel offers.
- A permanent, unmodifiable Tier 1 stone prevents an empty inventory from hard-locking progress.
- The Atlas is a seeded 15-node graph with adjacency fog, node lore, biome/map-base identity, and
  minimum tier by graph depth.
- A run seed combines the Waystone seed and node id. The selected stone carries deterministic
  modifiers that affect monsters, player resistance, experience, quantity, and rarity.
- Boss completion persists the node, drops replacement Waystones, and modified stones pay an
  additional stone one tier higher, capped at Tier 15.
- That payout has a floor the tier formula alone does not give. Hopping between Atlas nodes costs
  two tiers while a plain run returns the tier it was opened with, so a cleared map could leave the
  character unable to open anywhere new. `nextNodeTier` names the cheapest tier among the not-yet-run
  routes out of the cleared node and the boss's best drop is raised to it. A stone opens anything at
  or under its tier, so the floor never pays less than the run's own.
- The preparation view is a full-screen Atlas with a node popup and Waystone socket. Activation
  consumes the socketed backpack item only after simulation validation.

The fixed linear tier multipliers remain calibration knobs. Tablets, towers, fortresses, Atlas
passives, and a remote map transaction remain unimplemented.

## Product thesis

Today the Map Device is a light switch: touch it and you are instantly in one fixed
map with 6 portals. This slice makes the run a **choice**. Standing at the device you
pick a destination (an Atlas node) and a Waystone (a seed + a tier), see the resulting
area level and revive budget, and activate. Tier is the difficulty dial: it raises the
area level and scales monster life and damage, so a tier-15 run is a genuinely harder,
more rewarding version of the same fight.

## Constraints (locked this slice)

| Decision | Value |
|---|---|
| Area level formula | `areaLevel = 64 + tier` (docs/01:308). tier ∈ 1..15 this slice; XVI corruption deferred. |
| Tier → monster stats | Simple per-tier multiplier at spawn: `lifeMul = 1 + 0.15*tier`, `dmgMul = 1 + 0.10*tier`. Calibration placeholders (docs/01:780 says empirical), one knob each. |
| Portals / revives | **Fixed at `MAP_PORTALS=6`, unaffected by tier.** Doc-faithful: revives are affix-count-driven (`clamp(6 - max(1,affixCount),0,5)`, docs/01:329-344); no affixes this slice → affixCount 0 → 5 revives → 6 lives at every tier. |
| Node selection | **Kept.** Minimal faithful node: fixed short list, state collapsed to `accessible \| completed`. No fog / graph geometry / discovery (Phase 5). Boss kill marks node `completed`. |
| Preparation panel | **Full** per docs/08:62-73 (subset): node list, waystone list, computed area level, revive count, Activate with consumption summary. No inventory search/sort, no tablets, no Master selector, no provenance grouping. |
| Waystones | `{ id, seed, tier }`, a few generated deterministically from the session seed. No persistent stash/inventory yet — regenerated per device open. |
| Persistence | In-memory session only (matches current slice). Completed-node set lives on the session singleton; not saved across reload. |

## In scope

- `SessionC` gains `areaTier` (0 = no map open); `areaLevel = 64 + areaTier` computed.
- Waystone generation (deterministic from session seed): N=3 offers, each `{ id, seed, tier }`.
- Minimal Atlas node model: fixed list (3–4), each `{ id, name, state }`; completion on boss kill.
- New protocol intent `activateMap { atlasNodeId, waystoneId }` replacing the device auto-open.
- Client **preparation panel** UI: opens when the player interacts with the device; lists nodes +
  waystones; shows area level + revives; Activate sends `activateMap`.
- Sim validation of activation (range, node accessible, waystone valid, map not already open),
  then sets `{ mapSeed = waystone.seed, areaTier, portalsLeft = MAP_PORTALS, mapOpen = 1 }` and
  spawns the portal ring.
- Monster spawn scaling by `areaTier` in `areas.ts` (life + attack damage).
- Node marked `completed` when the map boss dies.

## Out of scope (each a later spec)

Affixes / map modifiers and affix-driven revive scaling; tablets; corruption/cleansing and
tier XVI; the real Atlas graph, fog, discovery, towers, Masters, bookmarks, search; persistent
Waystone inventory / stash; reward-channel scaling (quantity/rarity/pack size); trade/vendors;
saving nodes or waystones across reload.

## 1. The loop (this slice)

```
Hideout (Map Device)
  → interact with device  → client opens Preparation Panel
  → pick accessible node + pick Waystone → panel shows area level (64+tier) + revives (6)
  → Activate → activateMap intent → sim escrows: mapSeed=waystone.seed, areaTier=tier,
               portalsLeft=6, mapOpen=1; portal ring spawns
  → enter portal → seeded map, monsters scaled by tier
  → kill boss → node marked completed → return portal / death → hideout
```

## 2. Data model deltas

`packages/simulation/src/components.ts` — `SessionC`:

```ts
export interface SessionC {
  area: AreaKind;
  mapSeed: number;      // now CHOSEN from the activated Waystone (was fixed boot seed)
  areaTier: number;     // NEW. 0 = no map open. areaLevel = 64 + areaTier.
  portalsLeft: number;
  mapOpen: 0 | 1;
  pendingArea: AreaKind | "";
  completedNodes: string[];  // NEW. Atlas node ids completed this session.
}
```

Node + Waystone are **not** ECS components — they are plain generated data the sim/client
compute from `mapSeed`. Proposed home: a small pure module `packages/rules` (deterministic,
already the home for `makeRare`, damage, stats) exposing:

```ts
// packages/rules (new file, e.g. atlas.ts)
export interface Waystone { id: string; seed: number; tier: number }
export interface AtlasNode { id: string; name: string }
export function offerWaystones(sessionSeed: number, count: number): Waystone[];
export function atlasNodes(): AtlasNode[];              // fixed list this slice
export function areaLevel(tier: number): number;        // 64 + tier
export function monsterTierScale(tier: number): { lifeMul: number; dmgMul: number };
```

## 3. Protocol delta

`packages/protocol/src/index.ts` — add to `Intent`:

```ts
| { kind: "activateMap"; atlasNodeId: string; waystoneId: string }
```

- Extend `validateIntent` + `CommandType`.
- Device `interact` intent no longer auto-opens the map. Interacting with the device is a
  client signal to open the panel; the sim's `mapDevice` branch becomes a no-op (kept only so
  range re-check still gates a stale click). The state change moves to `activateMap`.
- `activateMap` handler (in interact.ts or a new `map-activate` system): re-derive the offered
  waystones from `mapSeed`, verify `waystoneId` is one of them and `atlasNodeId` is a known,
  not-yet-completed node; on success set the session fields + spawn portals; on failure, no-op
  (authoritative, client untrusted).

## 4. Client UI: Preparation Panel

- Opens on device interaction (client already resolves the `mapDevice` interactable).
- Renders `atlasNodes()` (accessible = not in `completedNodes`) and `offerWaystones(seed,3)`.
- Selecting node + waystone enables Activate; panel shows `areaLevel(tier)` and `MAP_PORTALS`.
- Activate → send `{ kind: "activateMap", atlasNodeId, waystoneId }`; close panel.
- Panel must reflect the authoritative snapshot: portals appear only after the sim opens the map.
  (Consistent with docs/08:75 "activation is never optimistic.")

## 5. Monster scaling

In `areas.ts` `spawnMonster` (or its map-branch callers): multiply `def.maxLifeFixed` by
`lifeMul` and `def.attackDamage.amountFixed` by `dmgMul`, both from `monsterTierScale(areaTier)`,
rounding to fixed-point via existing helpers. The boss uses the same scale. Tier 0 (hideout /
unscaled) → muls of 1.0, a no-op, so existing hideout/tests are unaffected.

## 6. Determinism / invariants (hold from day one)

- Waystone offers and node list are pure functions of `mapSeed` / content version — same seed,
  same offers, so replays and the checksum stay stable.
- Scaling multipliers resolve to fixed-point integers deterministically (fixed rounding rule).
- `activateMap` is idempotent against an already-open map (`mapOpen===1` → no-op), mirroring the
  existing device guard.

## 7. Risks / calibration knobs

- **Scaling numbers are guesses** (docs/01:780). `monsterTierScale` centralizes them so tuning is
  one edit; mark with a `ponytail:` calibration comment.
- **Float muls → fixed-point rounding**: apply the mul in integer space and truncate consistently,
  or life/damage drift between replays. Test a couple of tiers against expected fixed values.
- **Historical slice limit:** node completion initially had no persistence and reload reset
  `completedNodes`. Current character saves persist Atlas completion.
