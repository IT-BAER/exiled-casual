# Pact of Ruin — Vertical Slice 1: "First Descent"

Design spec. Status: approved for planning, 2026-07-19.
Baseline research: `docs/` pack (PoE 2 EA 0.5.4b clean-room reconstruction).

## Product thesis

A browser-native, original-IP action RPG in the Path of Exile 2 mould, aimed at
**PoE players who want to casually run maps from their hideout**. The hub-first
loop is the product, not a placeholder: sign in, stand in your hideout, pick a
map, run it, come back richer. Everything is clean-room — original names, art,
lore, numbers; no extracted assets, data, or protocols.

## Constraints (locked)

| Decision | Value |
|---|---|
| Team | Solo developer + Claude Code |
| Ambition | Aiming to ship; hold load-bearing invariants from day one, no rewrites |
| Presentation | Full 3D (Babylon.js), **greybox primitive actors first**, rigged art later |
| First slice | "Mini map run" as a closed hub loop |
| Archetype | Elemental caster |
| Authority staging | Approach A: authoritative sim in a Web Worker, real intent/snapshot protocol, local persistence adapter; no Node/Postgres/WebSocket yet |
| Language | TypeScript everywhere |
| Browsers | Desktop Chromium first |
| Multiplayer | Out (solo-only slice) |
| IP / numbers | Original clean-room; all PoE constants are our own tuning targets |
| Asset generation | `/codex-imagegen` for images/icons/textures; higgsfield MCP for other assets. Greybox until then. |

## 1. The loop (scope)

Three states, one closed loop, all reachable from the hideout:

```
Hideout (greybox hub, contains a Map Device)
  → Atlas (a tiny map graph, pick 1 of 3 accessible nodes)
  → Mapping (portal into a seeded generated area; fight; kill the boss; complete)
  → Hideout (return with loot; node marked complete; next node unlocked)
```

### In scope

- One elemental caster archetype.
- Three data-driven skills; life + mana resources.
- One normal monster family (packs), one rare (extra modifiers), one two-phase boss.
- One seeded **indoor room-graph** map grammar.
- The run transaction: escrow inputs → create run → complete idempotently.
- Pre-identified loot: drops → ground pickup → minimal inventory → equip → stat recompute.
- Equipment slots for the caster.
- Deterministic 30 Hz simulation with replay checksum.
- Full-3D greybox rendering with authoritative telegraphs.

### Out of scope (each becomes its own later spec)

Waystones, tablets, corruption/cleansing; the real 300+ node Atlas; crafting,
currency, stash, vendors, loot filters, trade; item identification; multiplayer
and parties; additional archetypes and skills beyond the three; real art and
audio; the outdoor map grammar; league/encounter mechanics; Masters; fortress
and pinnacles.

## 2. Architecture (Approach A)

Monorepo, npm workspaces. Boundaries chosen so infra can be added later without
re-architecture.

```
apps/
  web/               React shell + Babylon render host + input (main thread)
                     └ worker: authoritative deterministic sim (packages/simulation)
packages/
  protocol/          intent-command + snapshot schemas and codecs (the real boundary)
  rules/             stat graph, effects, damage, items — pure, framework-free
  simulation/        ECS, fixed-step systems, seeded RNG, canonical checksum
  content-schema/    definition schemas, stable IDs, validators
  content-runtime/   compiled read-only content
  mapgen/            indoor room-graph generator + reachability/budget gates
  replay/            command log, checkpoint, checksum diff tooling
  persistence/       interface + local (IndexedDB) adapter — real API implements it later
content/
  src/               YAML/JSON: skills, monsters, boss, items, affixes, map grammar
  tests/             golden fixtures and encounter scripts
```

**Authority boundary.** The client sends *intent* (move / aim / skill / dodge).
The Web Worker is authoritative for movement, collision, damage, death, loot,
and completion. Messages use the same shapes as the eventual network protocol
(`packages/protocol`); transport is `postMessage` now, WebSocket later.
Prediction/reconciliation code exists but is trivial (local, ~0 latency).

**Persistence.** All account/character/inventory/equipment/Atlas/run state goes
through the `persistence` interface. The slice ships the IndexedDB adapter; a
Node + Postgres adapter implements the same interface in a later phase. Swap the
adapter, not the callers.

## 3. Determinism rules (load-bearing)

From `docs/04` and `docs/05`. These are the invariants that make "aiming to ship"
survive future growth without a rewrite.

- Authoritative spatial, time, resource, and percent values use **fixed-point
  scaled integers** via a small helper library. IEEE floats only in rendering.
  Quantize after every public operation.
- One documented system order per tick. Changing the order is a simulation
  migration (it can alter on-hit, death, trigger, cooldown behavior).
- Every random outcome consumes a **named deterministic RNG stream** with a
  recorded seed and ordinal. Economy/loot streams stay separable.
- Canonical serialization produces a rolling checksum. A run replays from
  `{ seed, contentVersion, commandLog }` to the identical checksum. **This is the
  slice's headline technical proof.**
- No reliance on object-property or map iteration order in authoritative code.

## 4. Combat and the elemental caster

Skills are **data-driven** — assembled from effect-graph primitives, no per-skill
simulation code:

| Skill | Primitive coverage |
|---|---|
| ① Ember Bolt (working name) | projectile |
| ② Cinder Ground | persistent ground area + a stacking/refreshing ailment |
| ③ Blink | movement utility / dodge |

- **Resources:** life, mana. Dodge is served by Blink (no general immunity).
- **Monsters:** one normal family in packs; one rare with extra modifiers; one
  two-phase boss.
- **Boss telegraphs are authoritative**: each carries start tick, shape ID, target
  basis, and impact tick, so the client renders the same safe/unsafe space under
  jitter. Readability survives clutter (shape + delay + color + ground cue).
- **Defenses (slice subset):** one resistance channel + one mitigation channel +
  ailment build-up. Full defense matrix deferred.
- **Death:** returns the player to a checkpoint; dying during the boss fight
  triggers boss reset (boss to full, adds/side content removed) per `docs/01 §8`.

## 5. Map generation (one grammar)

Indoor **room-graph** grammar — smaller and easier to validate than outdoor:

```
room graph → template placement → overlap/merge solve → doors/corridors
→ boss-arena socket → tile-key selection → navmesh + collision bake
→ encounter/spawn sockets → reachability + spawn-budget validation
```

Each generated area records `{ algorithmVersion, contentVersion, seed,
chosenVariantIds, objectiveAnchors, walkableArea, validationChecks, hash }` so a
developer can reproduce it in a seed inspector. The outdoor grammar is deferred.

**Generation gates:** start / boss / exit / objectives mutually reachable; no
mandatory route narrower than player diameter + safety margin; boss arena has
valid spawn/teleport/safe-zone sockets for every phase; walkable area and monster
budget within ±15%; generation completes under the server time budget with a
deterministic fallback template.

## 6. Content pipeline

Definitions authored as human-reviewable YAML/JSON with **stable namespaced IDs**
(`skill.ember_bolt.v1`, never array indices or display names). Pipeline: schema
validation → ID/reference resolution → semantic validation → compile to
`content-runtime`. Display text is localized data; renaming a label never changes
identity.

Greybox now: primitive meshes (capsules/boxes/spheres) and flat data-authored
VFX. Real assets later via `/codex-imagegen` (icons, textures) and higgsfield MCP
(other assets), dropped in behind the same IDs — no sim or pipeline change, no
extraction.

## 7. Loot and items (slice subset)

- The boss and rares drop a few **pre-identified** items.
- Ground pickup (solo → immediate allocation) → minimal inventory with real grid
  placement (per `docs/02 §6`) → equip into caster equipment slots.
- Equipping recomputes stats through the same `rules` engine that combat uses —
  one stat system, no parallel math.
- No crafting, currency, stash, vendors, filters, or identification in the slice.
- Item instances still carry provenance and immutable identity so they survive
  into later economy phases unchanged.

## 8. Run transaction (integrity proof)

**Activation (Map Device in the hideout):** validate node accessible/incomplete →
escrow inputs under one `operationId` → create `runId` → generate and validate
area → portal in. Generation failure returns escrow.

**Completion:** confirm authoritative boss death (+ any required objective) →
idempotent commit of loot + node-complete + neighbor unlock, keyed by
`{ runId, finalizationRevision }`.

A forced worker restart at any activation or finalization boundary cannot
duplicate or lose inputs, loot, or progression — enforced by fault injection even
against the local IndexedDB adapter. This proves the anti-duplication invariant
before real persistence exists.

## 9. Validation gates (definition of done for the slice)

- Deterministic replay: identical checksum across repeated runs of the same
  `{ seed, contentVersion, commandLog }`.
- Golden combat scenarios: projectile behavior, ailment stack/refresh/expiry,
  mitigation/resistance, death, boss phase transition and reset.
- Map generation: ≥10,000 seeds with reachable boss/exit/objectives inside budget;
  deterministic fallback on failure.
- Run-transaction fault injection: no duplication or loss at any boundary.
- Performance budgets from `docs/04` met at slice density (greybox).
- The full Hideout → Atlas → Mapping → Hideout loop is completable end to end.

## 10. Milestone sequence

The implementation plan expands each into ordered, individually testable steps.

1. **Kernel** — monorepo + CI, fixed-point lib, ECS, named RNG, canonical
   checksum, replay runner, headless test host.
2. **Combat lab** — worker authority + `protocol`, Babylon greybox host,
   click-to-move + WASD + Blink, the three skills, normal pack + rare, combat HUD.
3. **Boss + arena** — indoor mapgen, two-phase boss with authoritative telegraphs,
   death / checkpoint / boss-reset.
4. **Run transaction + loot** — Map Device escrow, idempotent completion, drops /
   pickup / equip / stat recompute, IndexedDB persistence adapter.
5. **Shell loop** — Hideout hub + Atlas 3-node screen wiring the complete
   Hideout → Atlas → Mapping → Hideout loop.

Each milestone ends playable and testable; none depends on infra beyond the
browser.

## 11. Deferred decisions (revisit when their phase arrives)

- Node + Postgres persistence adapter and the WebSocket transport.
- Outdoor map grammar and additional tilesets.
- The real Atlas (chunked deterministic graph, fog, bookmarks, search).
- Waystone/tablet/corruption systems and the affix risk triangle.
- Crafting, currency, stash, vendors, loot filters, trade, identification.
- Additional archetypes, the passive tree, weapon sets, supports beyond the slice.
- Multiplayer, parties, allocation modes.
- Real art, animation, VFX, and audio direction.
- Legal/IP review before any public or commercial release.
