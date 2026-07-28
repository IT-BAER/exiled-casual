# Exiled Casual

A browser-native action RPG inspired by Path of Exile 1 **and** 2, taking the best of either
where they differ. It is not a clone of one of them: where the two games disagree, the one
that plays better wins, and the source is named in the code and docs so the borrowing stays
honest. Built spec-first with [Claude Code](https://claude.com/claude-code) as a public devlog
experiment: how far a deterministic ARPG can get in a handful of days when the design is
written down before any code is.

This is a work in progress, not a finished game. Running today: a 30 Hz fixed-point combat
sim with skills, ailments and a two-phase boss; procedural biome maps assembled from authored
chunks; an Atlas of nodes opened with waystones you carry as inventory items; items across all
four rarities with affixes, implicits and identification; a paper-doll equipment screen that
feeds real derived stats; stash, vendor and disenchanting; and a 3D character whose gear
changes on the model. There is no skill tree yet, and balance is untuned.

## How it is built

Every slice starts from a written spec, not from a prompt. The [`docs/`](docs/) folder
holds a clean-room research pack (game mechanics reconstructed from public sources) plus
the per-slice specs and plans that were implemented against it:

- [`docs/README.md`](docs/README.md) - the research pack index and design invariants
- [`docs/specs/`](docs/specs/) - per-slice design specs
- [`docs/plans/`](docs/plans/) - the task-by-task implementation plans

Two project rules (see [`CLAUDE.md`](CLAUDE.md)) keep the output faithful instead of
generic: real game screenshots are the visual source of truth and get checked before any
UI or render work, and item/affix mechanics are researched against public databases rather
than invented. Because both games are drawn on, a borrowed mechanic or look says in the
code which of the two it came from.

## Devlog

Screenshots of each step, in order, are in [`devlog/`](devlog/README.md).

## Tech stack

| | |
|---|---|
| Language | TypeScript 5.6, strict, ES modules, npm workspaces monorepo |
| Client | React 18 + Babylon.js 7 (WebGL2), Vite 5 |
| Simulation | Hand-rolled ECS, 30 Hz fixed timestep, runs in a Web Worker |
| Determinism | Fixed-point integers only, named seeded RNG streams, replayable to a checksum |
| Persistence | IndexedDB, versioned save blob |
| Tests | Vitest (+ Testing Library and jsdom for the HUD) |
| Asset pipeline | Blender 5.2 headless via Python (`tools/`) for the rig, props and rocks; Pillow scripts for tilesets and per-base gear textures |
| Art | Generated raster masters, then re-palettized or made tiling offline. No runtime asset generation. |
| CI | GitHub Actions: typecheck, tests, web build on every push |

There is no server. The "server" is the simulation worker, and the client is untrusted by
construction: it sends intents, never outcomes, and the sim re-validates range, tier, cost and
placement on every one.

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
