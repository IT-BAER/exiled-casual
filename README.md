# Exiled Casual

[Website](https://exiledcasual.com) · [Devlog](devlog/README.md)

An original browser-native action RPG inspired by Path of Exile 1 **and** 2, taking the best of
either where they differ. It is not a clone of either game. Borrowed design ideas name their
source in the code and docs, while the implementation, world, art, and content remain original.

The public website is a teaser. The game itself is an active work in progress and currently runs
locally.

## What is playable now

- Deterministic 30 Hz combat with class-specific default attacks, skills, ailments, buffs,
  animated creature strikes, and a two-phase boss.
- A hideout and six-portal run loop, procedural biome maps, and an open coastal Strand with surf,
  wet sand, shells, driftwood, and wreckage.
- An Atlas opened with inventory-held Waystones, including preparation, modifiers, fog, and a
  centred map overlay.
- Normal, magic, rare, and unique items with affixes, implicits, identification, crafting orbs,
  loot beams, stash, vendor, disenchanting, and equipment-derived stats.
- A rigged 3D character with visible equipped gear, animated cloth, positional audio, ambience,
  and a game shell covering menus, character selection, loading, options, and local saves.

There is no skill tree yet, balance is untuned, and no public playable build is available.

## How it is built

Every slice starts from a written spec. The [`docs/`](docs/) folder holds a clean-room research
pack (game mechanics reconstructed from public sources) plus the per-slice specs and plans that
were implemented against it:

- [`docs/README.md`](docs/README.md) - the research pack index and design invariants
- [`docs/specs/`](docs/specs/) - per-slice design specs
- [`docs/plans/`](docs/plans/) - the task-by-task implementation plans

Two project rules keep the output grounded: real game screenshots are checked before UI or render
work, and item and affix mechanics are researched against public databases rather than invented.
Because both games are drawn on, a borrowed mechanic or look says in the code which game it came
from.

## Devlog

Major visible milestones, in screenshots and short notes, are in [`devlog/`](devlog/README.md).

## Tech stack

| | |
|---|---|
| Language | TypeScript 5.6, strict, ES modules, npm workspaces monorepo |
| Client | React 18 + Babylon.js 7 (WebGL2), Vite 5 |
| Simulation | Hand-rolled ECS, 30 Hz fixed timestep, runs in a Web Worker |
| Determinism | Fixed-point integers only, named seeded RNG streams, replayable to a checksum |
| Persistence | IndexedDB, versioned character roster and shared stash; JSON import/export |
| Tests | Vitest (+ Testing Library and jsdom for the HUD) |
| Asset pipeline | Blender 5.2 headless via Python (`tools/`) for the rig, props and rocks; Pillow scripts for tilesets and per-base gear textures |
| Art | Generated raster masters, then re-palettized or made tiling offline. No runtime asset generation. |
| CI | GitHub Actions: typecheck, tests, web build on every push |

The current build has no remote game server. Its authority boundary is the simulation worker: the
client sends intents, never outcomes, and the simulation re-validates range, tier, cost, and
placement.

## Layout

npm workspaces, TypeScript throughout.

| Path | What it is |
|---|---|
| `packages/fixed-point` | Deterministic fixed-point integer math |
| `packages/simulation` | ECS combat simulation, 30 Hz fixed timestep |
| `packages/mapgen` | Procedural map generation |
| `packages/rules` | Pure rules engine (a leaf: imports no other `@exiled` package) |
| `packages/content-schema`, `packages/content-runtime` | Data-authored content and its loader |
| `packages/protocol` | Client/server message contracts |
| `packages/replay` | Replay a run from its seed and command log |
| `packages/persistence` | Saves |
| `apps/web` | React + Babylon.js client (Vite); the sim runs in `src/worker/` |
| `tools/` | Offline asset builders (Blender headless, Pillow). Never run at runtime. |

The simulation is deterministic: fixed-point integers only, every random draw comes from a
named seeded stream, so a run replays to an identical checksum.

## Quick start

```bash
npm install
npm run dev -w apps/web   # http://localhost:5173
```

Other scripts:

```bash
npm test            # Vitest
npm run typecheck   # tsc --noEmit (vitest strips types, so run this too)
npm run build -w apps/web
```

CI runs typecheck, tests, and the web build on every push (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Legal

This is an unofficial fan project. It is not affiliated with, endorsed by, or connected to
Grinding Gear Games. It reproduces observable design and mechanics through original code,
original art, and CC0 (public-domain) third-party assets (see [`CREDITS.md`](CREDITS.md)). It ships none of the game's art, audio, data, or other protected
content. The real Path of Exile 1 and 2 screenshots used locally as a visual reference are kept
out of this repository (gitignored) and are not distributed.
