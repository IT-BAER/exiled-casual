# Exiled Casual — Slice: "Biomes & Layout Grammar"

Design spec. Status: **built and expanded, verified 2026-08-05.** See "As built" at the foot for where the
implementation departed from this document and what it turned up.
Baseline research: `docs/01-atlas-and-map-running.md` §5 (biomes, layout families, `MapBase`)
and §6 (generation pipeline).
Position: follows "First Loot" (`docs/specs/2026-07-22-first-loot-design.md`). Replaces the
single hard-coded area generator with per-base, per-biome procedural assembly.

## Product thesis

Running the same map base twice should feel like the same *place* and a different *route*.
Today it feels like neither: `generateArea` is one generator for every map — a wobbly disc
(`carveOpenField`, `mapgen.ts:278`), one plus-shaped ruin (`carveRuin`, `mapgen.ts:296`),
three anchors on a mid-radius ring at a random angle, six spawns on a 216° arc.

**It already randomises and the randomness is invisible.** The angle `theta` spins the anchor
ring inside a near-symmetric disc, so nothing the player can see moves. Variation has to come
from asymmetric parts, not from an angle. This slice replaces the disc with an assembled grid
of authored chunks, and gives each map base a biome whose art says which place you are in.

## Constraints (locked this slice)

| Decision | Value |
|---|---|
| Biomes | **4**: Vaal Stone (city identity), Desert, Swamp, Forest. |
| Grammars | **2**: `loop` (Vaal Stone, Swamp) and `open-field` (Desert, Forest). |
| Grammar = data | A grammar is **a chunk library plus a branch count**, never a second code path. |
| Area extent | **7×7 tiles of 16 cells = 112×112 cells = 56×56 world units**, fixed for every base. `GRID_CELLS` 80 → 112. |
| Chunk library | 5 edge-mask classes (cap, straight, corner, T, cross) × **3 variants = 15 chunks per grammar**, authored as 16×16 ASCII in TS. |
| Boss chunk | The **one 2×2-tile exception** (32×32 cells). A single tile is 8×8 world units and the camera alone sees 19×9.5, so a 1-tile boss room is not a room. |
| Variation ops | Per-tile 90° rotation + mirror, plus **one whole-area rotation**. |
| Route | A **loop with rewarded dead ends**. Entrance on the rim, boss farthest by *route* distance, exit inside the boss chunk. |
| Textures | **Generated** per biome via `/codex-imagegen`, not sourced CC0 (user's call, 2026-07-28). Each set needs an explicit seam pass and derived normal/roughness — see §6. |
| Ships alongside | **Minimap**, second in the slice order, because it is the instrument that makes the variation legible. |

## In scope

- `packages/mapgen`: tile assembler, chunk libraries, five-stage pipeline, `ALGORITHM_VERSION` 3.
- `@exiled/content-runtime`: `MapBase` definitions (biome, tileset, grammar) + the chunk libraries.
- `@exiled/rules` (pure leaf): map-base **id strings only**. No definitions — it may not import
  `content-runtime`, and a test guards the two lists agreeing, the way `GEAR_TEXTURE` is guarded.
- `apps/web/src/render/level.ts`: a material set per `tilesetId` instead of one stone material.
- Minimap HUD from the walkable grid, with explored fog.
- Atlas + Preparation panel show the biome of the node you are about to run.

## Out of scope (each a later spec)

The other four layout families (corridor, multi-floor, gated, arena sequence); base specialties;
special-location archetypes; height/occlusion; per-biome monster pools (see the risk in §8);
props and decals as placed entities; destructible geometry; per-biome ambient audio beyond a tint.

## 1. Why a tile grid, and why it is not a greybox

The vocabulary stays constant and the arrangement changes. A player learns what a Vaal Stone
colonnade chunk means — where cover is, where a pack usually stands — and never learns the route
through it. That is the PoE promise: recognisable pieces, unlearnable maps.

The chunks are authored, so every piece is hand-checked for readability; only the assembly is
procedural. That is cheaper and better-looking than fully procedural carving, which is what the
current disc is and why it reads as a blob.

## 2. The five stages

Each stage draws from its **own named RNG sub-stream** (`createStream(masterSeed, name)`,
`rng.ts:20`, already takes a label). Named streams mean adding a chunk to stage 2 does not shift
the boss position chosen in stage 3.

| # | Stage | Stream | Output |
|---|---|---|---|
| 1 | Skeleton | `layout.skeleton` | A route graph on the 7×7 tile lattice: a closed loop plus `branchCount` dead-end spurs. Yields each tile's 4-bit **edge mask** (N/E/S/W open). |
| 2 | Chunks | `layout.chunks` | Per tile: filter the library by the mask's class, pick a variant, rotate (and optionally mirror) it onto the exact mask. |
| 3 | Anchors | `layout.anchors` | Entrance on a rim tile; boss 2×2 placed at the greatest BFS route distance from the entrance; exit inside the boss chunk. |
| 4 | Spawns | `layout.spawns` | Spawn sockets from the `s` cells of placed chunks, thinned to `SPAWN_TARGET`, with a safe wedge around the entrance. |
| 5 | Dressing | `layout.dressing` | Rewards from `r` cells (dead-end spurs get priority), then the whole-area rotation. |

Stage 1 decides the masks *before* stage 2 selects chunks, so chunk selection is a lookup, not a
constraint solve. Nothing can fail to match.

## 3. Chunk authoring

Chunks are 16×16 ASCII arrays in TypeScript:

```
#  wall      .  floor      s  spawn point      r  reward point
```

**The edge mask is derived from the border, never declared.** A chunk whose north border has
floor in it *is* north-open. Art and mask cannot disagree because there is only one source.

Two invariants make rotation and mirror closed operations on the mask:

- **Openings are centred and symmetric on their edge** — cells 6–9 of 0–15, 4 cells wide.
  A mirrored chunk therefore has the same mask, and a rotated one has the mask rotated by the
  same amount. Off-centre openings would break edge matching the moment a chunk is mirrored.
- Opening width 4 cells = 2 world units, comfortably over `MIN_ROUTE_WIDTH` (1.25) and wider
  than `CORRIDOR_WIDTH_CELLS` (3), so no assembled seam is the narrowest point of a route.

The 15 chunks per grammar are the 5 classes in a canonical orientation; rotation supplies the
rest. Class 0 (no open edges) is not a chunk — it is solid wall filler.

The boss chunk is authored once per grammar at 32×32, with **one** opening, rotated so that
opening faces the incoming route. Its other three sides are sealed, which is what makes the boss
a terminus rather than a corridor.

## 4. Data model deltas

`@exiled/content-schema`:

```ts
export interface MapBase {
  id: string;
  biomeIds: string[];
  tilesetId: string;
  layoutGrammarId: "loop" | "open-field";
  bossId?: string;
}
export interface Chunk {
  id: string;          // e.g. "vaal.corner.2" — this is what lands in chosenVariantIds
  rows: string[];      // 16 (or 32) strings of 16 (or 32) chars
}
export interface Grammar {
  id: string;
  chunks: Chunk[];
  bossChunk: Chunk;
  branchCount: number; // dead-end spurs off the loop
}
```

`AreaLayout.chosenVariantIds` (`mapgen.ts:46`) **already exists** and is today always
`["open.field"]` or `["fallback"]` — the spec's `GeneratedAreaProof` hook, present and unused.
It now carries the real per-tile chunk ids with their orientation, which is what makes a run
reproducible and reviewable.

## 5. Minimap

Straight from `WalkableGrid`: walkable cells drawn to an offscreen canvas once per area, revealed
by an explored mask the client updates from player position. Anchors (entrance, boss, exit) and
rewards as icons. **Check `reference-screenshots/inside-map.jpg` before building it**, per the
workspace visual-reference rule.

It is second in the slice order on purpose: layout variation the player cannot perceive is
layout variation that did not happen.

## 6. Per-biome art

Four tileset ids, one material set each: wall, floor, and an ambient tint. `level.ts` currently
greedy-merges every wall into a single mesh with one CC0 ambientCG stone material; it becomes one
merged mesh **per tileset material**, which for a single-biome area is still one draw.

Textures are generated through `/codex-imagegen` (never hand-authored SVG, per workspace rule).
Because generated art does not tile seamlessly and ships no PBR maps, each set has two mandatory
post steps, and they are part of the stage, not optional polish:

1. **Seam pass** — offset-wrap the master and repair the visible seam, then verify by tiling 3×3.
2. **Derived maps** — normal and roughness from luminance, same as the existing gear-texture path
   in `tools/build_gear_textures.py`.

Masters land in `assets/tilesets/<biome>/`, derived output in a gitignored `build/` beside them,
matching `assets/props/`.

## 7. Determinism / invariants

- `generateArea(seed, contentVersion)` stays pure. Same inputs → same `hash`.
- Chunk selection reads only from its named stream; no wall clock, no entity ids.
- The map seed is already per activation (`mapSeedFor(waystoneSeed, atlasNodeId)`,
  `rules/src/atlas.ts:122`) — unchanged.
- `validationChecks` gains: entrance→boss and boss→exit reachable; every spur reachable; no route
  narrower than `MIN_ROUTE_WIDTH`; the outer rim is solid wall except the entrance.
- The existing fallback path stays. If assembly fails validation, fall back and set `usedFallback`.

## 8. Risks

- **`ALGORITHM_VERSION` 2 → 3.** Golden replay hashes change and must be regenerated. This is the
  one guaranteed-breaking item; regenerate deliberately and verify `packages/replay` explicitly,
  not just the touched package.
- **A tile grid can read as a grid.** Mitigation for `open-field` is reusing the wobbly disc as an
  outer **mask** over assembled tiles, applied only to rim tiles the route does not use — applied
  anywhere else it severs the loop. The risk does not fully go away; the honest answer is that
  `open-field` may need more chunk variants than `loop` to hide its lattice.
- **Layout variation alone would not fix repeat runs.** At design time there were **2 monster
  definitions in the entire game**, so four biomes would have looked different and fought
  identically. The later monster-pool slice closed this gap.
- **Generated textures may not tile.** Accepted with the seam pass above as the mitigation. If a
  set still seams after one repair pass, fall back to a CC0 ambientCG substrate for that biome
  rather than spending a second generation loop on it.
- Boss-chunk placement can collide with the rim or another spur on a 7×7 lattice; the placer needs
  a fallback to the next-farthest legal 2×2, not an assertion.

## 9. Testing

- `packages/mapgen`: every chunk's derived mask matches its class; rotation/mirror preserve the
  mask; assembled areas always validate (fuzz N seeds); entrance→boss→exit connected; boss is the
  route-distance maximum; two different seeds on one base give different `chosenVariantIds` but
  identical tile extent; same seed is byte-identical.
- Edge matching: for N seeds, no assembled tile boundary has a wall facing a floor.
- `@exiled/content-runtime`: every `MapBase.tilesetId` has a material set on disk and every
  `layoutGrammarId` has a library — the `GEAR_TEXTURE`-style guard.
- `@exiled/rules`: its map-base id list matches `content-runtime`'s definitions.
- `packages/replay`: regenerated goldens pass; checksum stable across an area transition.
- `apps/web`: minimap renders from a known grid; explored fog reveals; biome tint applied.

## 10. Slice order

1. Tile assembler + `loop` chunk library — pure, headless, fully tested before anything renders.
2. Minimap from the walkable grid with explored fog.
3. Map bases and biomes through the Atlas and the Preparation panel.
4. Per-biome tilesets, materials, ambient tint.
5. `open-field` chunk library + the organic outer mask.

---

## As built

The authored chunk assembler, derived edge masks, deterministic transform algebra, route-spread
spawns, reward anchors, biome definitions, tilesets, minimap layout, and renderer integration all
shipped. The current area is a 9 by 9 lattice of 16-cell chunks. Vaal Stone uses `loop`, Desert and
Forest use `open-field`, and Swamp uses `sunken-ruins`.

**Departures from the plan above**

- The slice order changed. `generateArea` could not switch to the assembler without the
  open-field grammar existing (the grammar table needs both entries), so slice 5 was pulled
  forward and landed with slice 3. `fallbackLayout` moved to its own `fallback.ts` to break
  the import cycle that created.
- `ALGORITHM_VERSION` went 2 → 3 as predicted, but **no replay golden needed regenerating**:
  `packages/replay` builds its own hand-made grid rather than calling `generateArea`.
- Rewards ride in `objectiveAnchors` as `reward.N`, as planned, so `AreaLayout` is unchanged.

**Things only running it could find**

- **Spawn placement was wrong.** Taking the N farthest tiles by route distance put every
  monster 40-58 units away in a 56-unit map and left the first half of the route empty —
  a balance test caught it ("one bolt is an invitation" had nothing in range). Spawns now
  walk the route in order and take evenly spaced tiles; they run ~10 to ~45 units out.
- **A biome tint is not a dimmer.** Multiplying the ambient by Vaal Stone's [0.62,0.70,0.68]
  took a third out of it, and an assembled map is mostly floor near a wall. Tints are now
  normalised to mean 1.0, so they shift hue and never brightness.
- **Walls must not cast shadows.** At `WALL_HEIGHT` 3.5 under this low sun a wall throws a
  ~9-unit shadow, longer than a room is wide, so at `darkness` 0.12 every room was black.
  The old disc had almost no walls, which is why it never showed. Fixing it also fixed a
  leak: the per-run boxes are disposed by the merge but stayed in the shadow render list
  forever — 817 dead meshes after a single map, growing on every area change.
- **Generated plates ignore the renderer's calibration.** Floors came out 37 (forest) to 162
  (desert) and walls 41 (swamp) to 191, against a renderer tuned for a 57-luma floor and a
  132-luma wall. The build script now lifts anything too dark by gamma; a swamp wall at 41
  was a black void with no masonry in it, and a forest floor at 37 swallowed the character.
- The seam metric in the first draft was wrong: it demanded that opposite edges be *identical*,
  which is mirror symmetry, not seamlessness. The right question is whether the wrap differs
  about as much as any other adjacent column. One master (Vaal Stone) scored a perfect 0.00
  only because the generator had mirrored it.

**Still open**

- The lattice is still legible in the `loop` grammar, where rooms meet on tile boundaries.
  The organic rim helps `open-field` only, exactly as predicted.
- Near-black actors read poorly on the darker biomes even after the luminance lift. The
  floors now match the hideout's own calibrated value, so going further would mean
  re-tuning the character material rather than the ground.

**Expansion after the original slice**

- Five biome-specific monster pools now select among 13 regular species and four bosses.
- Five ambience beds follow the current area, and props now dress the hideout and Coast.
- `coast` is a generator, not a chunk grammar. It emits open sand between a wandering cliff and a
  floating shoreline curve, plus explicit water cells. `render/sea.ts` builds wet sand, surf,
  shallows, swell ranks, and deep water from the curve.
- The Coast renderer excludes sea from the generic rim and rock scatter, then places shells,
  driftwood, weeded rocks, wreck timber, and bones relative to the shoreline.
- Coast became the starting map base, and the content contract now covers five biomes and five map
  bases. The legacy `strand` chunk grammar remains in the accepted id set but no current map base
  selects it.
