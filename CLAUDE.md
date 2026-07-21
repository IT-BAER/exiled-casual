# Pact of Ruin

Browser PoE2 clone. TypeScript, npm workspaces. ECS sim (30 Hz, fixed-point) in `packages/`,
React + Babylon client in `apps/web`. Tests: Vitest.

## Visual reference — ALWAYS CHECK BEFORE UI/RENDER/ART WORK

Real Path of Exile 2 screenshots live in `poe2-screenshots/`. They are the look source-of-truth.
Consult the relevant one BEFORE any UI, render, HUD, panel, or art change, and re-check while
iterating so the result matches the original game exactly. Do not design from memory.

- `hideout.jpg`, `closeup-hideout-zoom.jpg` — hideout look/camera
- `portals-map-device.webp` — map device + portal ring
- `inside-map.jpg`, `inside-map-battle.webp` — in-map areas + combat
- `boss-fight.png` — boss encounter
- `atlas-maps.webp` — Atlas / waystone map screen

## Build / test

- Test: `rtk proxy npx vitest run [scope]` from repo root (plain vitest under RTK flakes).
- Typecheck: `npm run typecheck` (tsc --noEmit; vitest strips types so this is mandatory).
- Web build: `npm run build -w apps/web`.

## Conventions

- Sim math is deterministic fixed-point integers; keep replay checksums stable.
- `@pact/rules` is a pure leaf: no imports from other `@pact` packages.
- Commit workflow: direct-to-main, one commit per task. No attribution trailers, no emdashes in messages.
