# Exiled Casual — Slice: "First Loot"

Design spec. Status: approved for planning, 2026-07-22.
Baseline research: `docs/` pack (PoE 2 EA 0.5.4b clean-room reconstruction).
Position: opens **Phase 4** (item & crafting loop, `docs/06:138`). Follows the
"Waystones + Tier Scaling" slice (`docs/specs/2026-07-21-waystones-tier-scaling-design.md`,
integrated on `main` at `c1dd39e`).

## Product thesis

Kills that matter drop loot. The map boss and rare monsters (already spawned:
`areas.ts:83-85` flags the last imp `rare:1` via `makeRare`, and the boss) drop an item
on the ground where they die. The player walks over, picks it up, and it lands in a 12×5
grid inventory whose tooltips read straight from the rolls the sim committed **at drop
time**. Higher area tier means a higher item level and better rarity odds, tying loot to
the waystone difficulty dial shipped last slice.

## Constraints (locked this slice)

| Decision | Value |
|---|---|
| Drop source | Map **boss** + monsters flagged `rare===1`. Ordinary monsters do not drop (deferred). One item per qualifying death. |
| Item depth | **Normal + Magic** only. Magic rolls 1–2 affixes from a small hand-authored pool. Rare/Unique + the 6-affix engine + 8:3:1 ratio deferred. |
| Inventory | **Full 12×5 grid** (60 cells, `docs/02:214`). Per-base integer `w×h`. Auto **first-fit** placement, row-bitset collision. No drag/reorder this slice. |
| Item level | `ilvl = areaLevel(areaTier) = 64 + tier` (reuses `@exiled/rules` `areaLevel`). |
| Tier → rarity | Magic-vs-Normal odds shift up with `ilvl` + `monsterRarity`. One centralized calibration knob (`ponytail:` comment). |
| Identification | Items drop **identified** (fully visible). Unidentified state + Scroll of Wisdom deferred (`docs/02:53`). |
| Persistence | In-memory session only. `InventoryC` on the session singleton; not saved across reload (matches current slices). |

## In scope

- `@exiled/content-schema` (types only): `Rarity`, `ItemBase`, `Affix`, `Item`.
- `@exiled/content-runtime`: a tiny authored pool — ~4 bases (each `w×h`, item class), ~6 affixes
  (e.g. `+maxLife`, `+fire dmg`, `+fire res`), each with `minItemLevel` + integer roll range.
- `@exiled/rules` (pure leaf): `rollItem(pools, seed, ilvl, monsterRarity) → Item`. Deterministic:
  pick base, roll rarity (weighted by `ilvl` + `monsterRarity`), for Magic roll 1–2 eligible affixes
  (gated by `minItemLevel`), roll integer values. Item authored **complete** at drop.
- `packages/simulation`: boss/rare death spawns a ground-item entity; new `pickupItem` handler
  validates range + first-fit placement and moves ownership into inventory.
- Two new components: `ItemC` (committed `Item` + base dims, on a ground entity with `Position`);
  `InventoryC` (on the session singleton: placed items `[{x,y,w,h,item}]` + per-row bitset).
- Protocol: `pickupItem { entityId }` intent; snapshot gains `groundItems[]` + `inventory`.
- Client HUD: ground-item markers tinted by rarity; a toggle inventory panel (12×5 grid, rarity
  colors, hover tooltip from committed rolls).

## Out of scope (each a later spec)

Rare/Unique rarity + the full 6-affix modifier engine + 8:3:1 count ratio; identification /
Scroll of Wisdom; equipping / equipment slots / gear-derived stats; stash; currencies & crafting;
loot filter; drops from ordinary monsters; drag-to-reorder / manual placement; quality; sockets /
runes; disenchant / salvage; cross-reload persistence; ground allocation / labels beyond a single
local player.

## 1. The loop (this slice)

```
Map (tier T)
  → kill map boss OR a rare monster
  → sim rolls an Item (ilvl = 64+T, rarity weighted by ilvl+monsterRarity),
     spawns a ground-item entity at the corpse
  → walk into range, press pickup → pickupItem intent
  → sim re-checks range + finds legal first-fit slot in the 12×5 grid
       success → move item into InventoryC, destroy ground entity, commit
       failure (out of range / no room) → no-op, no ownership change
  → open inventory panel → item shown at its w×h footprint, tooltip = committed rolls
```

## 2. Data model deltas

`@exiled/content-schema` (type-only, importable by `@exiled/rules`):

```ts
export type Rarity = "normal" | "magic";               // this slice
export interface ItemBase { id: string; name: string; itemClass: string; w: number; h: number }
export interface Affix { id: string; stat: string; minItemLevel: number; min: number; max: number }
export interface ItemAffix { affixId: string; value: number }
export interface Item {
  baseId: string;
  rarity: Rarity;
  itemLevel: number;
  affixes: ItemAffix[];   // committed integer rolls, empty for normal
}
export interface ItemPools { bases: ItemBase[]; affixes: Affix[] }
```

`@exiled/rules` — new `items.ts` (pure, deterministic):

```ts
export function rollItem(pools: ItemPools, seed: number, ilvl: number, monsterRarity: number): Item;
// picks base, rolls rarity (weighted by ilvl+monsterRarity — one calibration knob),
// for magic rolls 1..2 affixes with minItemLevel <= ilvl, rolls integer values.
```

`packages/simulation/src/components.ts`:

```ts
export interface ItemC { item: Item; w: number; h: number }   // on a ground entity + Position
export interface PlacedItem { x: number; y: number; w: number; h: number; item: Item }
export interface InventoryC {                                  // on the session singleton
  cols: number; rows: number;        // 12 × 5
  items: PlacedItem[];
}
```

Grid width/height and first-fit are the only placement logic. Use a per-row bitset for collision;
first-fit scans top-left → bottom-right for the first free `w×h` rectangle (`docs/02:221-230`).

## 3. Protocol delta

`packages/protocol/src/index.ts`:

```ts
| { kind: "pickupItem"; entityId: number }
```

- Extend `validateIntent` + `CommandType`.
- Snapshot gains `groundItems: { id, x, y, rarity, label }[]` and
  `inventory: { cols, rows, items: PlacedItem[] }` for the HUD.
- `pickupItem` handler: verify the target ground entity exists, is in interaction range of the
  player, then first-fit-place into `InventoryC`. On any failure the state is unchanged
  (authoritative; client is untrusted; activation/pickup is never optimistic, `docs/08:75`).

## 4. Drop mechanics (sim)

- Hook in `death.ts`: when a monster with `boss` **or** `rare===1` dies while `session.area === "map"`,
  derive a **replay-stable** drop seed from `mapSeed`, the monster's spawn index, and the kill tick,
  then `rollItem(pools, seed, areaLevel(areaTier), monsterRarity)` and spawn the ground entity at the
  corpse `Position`. `monsterRarity` = 1 for rare, higher for boss.
- Exactly one item per qualifying death. Ground items persist until picked up or the area is left.

## 5. Client UI: inventory + ground

- Ground item: a small labeled marker/beam at its snapshot position, tinted grey/blue by rarity.
- Inventory panel (toggle key, default `I`): draws the 12×5 grid; each item occupies its `w×h`
  footprint, rarity-colored; hover shows a tooltip built from the base name + affix lines derived
  from the committed integer rolls. No drag / no manual placement this slice.
- Consult `reference-screenshots/` for the inventory look before building (per workspace CLAUDE.md).

## 6. Determinism / invariants (hold from day one)

- `rollItem` is a pure function of `(pools, seed, ilvl, monsterRarity)` → same replay, same drops.
  Items are committed at drop time, so replays and the checksum stay stable.
- Drop seed derives only from replay-stable state (`mapSeed`, spawn index, tick) — no wall clock, no
  entity-id churn.
- First-fit placement is deterministic.
- **`checksum.ts` must serialize `ItemC` and `InventoryC`** (nested objects + affix arrays). The
  waystones slice broke `stableValue` on the `completedNodes` array and it was masked because
  verification skipped `packages/replay`. **Verify against `packages/replay` + the full suite, not
  just the touched package.**

## 7. Risks / calibration knobs

- **Rarity weighting numbers are guesses.** Centralize the ilvl/monsterRarity→rarity odds in one place
  in `rollItem` with a `ponytail:` calibration comment so tuning is a single edit.
- **Fixed-point vs plain integers.** Affix values are plain integer rolls (not fixed-point damage math),
  but any value that later feeds combat must convert consistently — keep affix rolls as plain ints this
  slice and mark the boundary.
- **Grid placement failure UX.** A full inventory means pickup silently no-ops; surface a HUD hint
  ("inventory full") so it is not mistaken for a bug. In-memory-only inventory resets on reload — flagged,
  not a bug.
- **Checksum regression** (see §6) is the highest-risk item; a golden-replay test with a boss/rare drop
  guards it.

## 8. Testing

- `@exiled/rules`: `rollItem` determinism (same seed → identical item); rarity weighting rises with
  ilvl/monsterRarity; affix count ≤ 2 for magic, 0 for normal; only `minItemLevel ≤ ilvl` affixes roll.
- `packages/simulation`: boss death and rare-monster death each spawn one ground item; pickup in range
  places into the grid and destroys the ground entity; pickup out of range is a no-op; pickup into a full
  grid fails with no ownership change; golden replay + checksum stable across a boss/rare drop.
- `apps/web`: inventory panel renders the grid + a tooltip from rolls; ground item renders; pickup
  binding sends `pickupItem` for an in-range ground item.
