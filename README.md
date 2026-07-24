# Pact of Ruin

A browser-native action RPG in the spirit of Path of Exile 2, built spec-first with
[Claude Code](https://claude.com/claude-code) as a public devlog experiment: how far a
deterministic ARPG can get in a handful of days when the design is written down before
any code is.

This is a work in progress, not a finished game. As of the current devlog entries there
is a running combat simulation, procedural maps, an item/rarity system with tooltips, and
a HUD. There is no skill tree yet, persistence is partial, and balance is unturned.

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
than invented.

## Devlog

Screenshots of each step, in order, are in [`devlog/`](devlog/README.md).

## Layout

npm workspaces, TypeScript throughout.

| Path | What it is |
|---|---|
| `packages/fixed-point` | Deterministic fixed-point integer math |
| `packages/simulation` | ECS combat simulation, 30 Hz fixed timestep |
| `packages/mapgen` | Procedural map generation |
| `packages/rules` | Pure rules engine (a leaf: imports no other `@pact` package) |
| `packages/content-schema`, `packages/content-runtime` | Data-authored content and its loader |
| `packages/protocol` | Client/server message contracts |
| `packages/replay` | Replay a run from its seed and command log |
| `packages/persistence` | Saves |
| `apps/web` | React + Babylon.js client (Vite) |

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
content. The real Path of Exile 2 screenshots used locally as a visual reference are kept
out of this repository (gitignored) and are not distributed.
