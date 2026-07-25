# Exiled Casual

Browser ARPG drawing on both Path of Exile 1 and 2, not a strict PoE2 clone: take the best of
either where they differ, and say which one a borrowed mechanic or look comes from. TypeScript,
npm workspaces. ECS sim (30 Hz, fixed-point) in `packages/`, React + Babylon client in `apps/web`.
Tests: Vitest.

## Visual reference — ALWAYS CHECK BEFORE UI/RENDER/ART WORK

Real Path of Exile 2 screenshots live in `poe2-screenshots/`. They are the look source-of-truth.
Consult the relevant one BEFORE any UI, render, HUD, panel, or art change, and re-check while
iterating so the result matches the original game exactly. Do not design from memory.

- `hideout.jpg`, `closeup-hideout-zoom.jpg` — hideout look/camera
- `portals-map-device.webp` — map device + portal ring
- `inside-map.jpg`, `inside-map-battle.webp` — in-map areas + combat
- `boss-fight.png` — boss encounter
- `atlas-maps.webp` — Atlas / waystone map screen
- `item-normal.png`, `item-magic.png`, `item-rare.png`, `item-unique.png` — item hover/tooltip look per rarity (colors, header, stat lines)
- `inventory+equipment.png` — full inventory screen: equipment paper-doll, flasks, currency, backpack grid
- `inventory.png` — PoE1 inventory: full-height pane, 12x5 grid edge to edge, currency strip at its foot
- `poe1-lower-bar.png` — PoE1 bottom bar: flask panel, and the skill panel's mouse row above its numbered row

## Itemization & rarity — RESEARCH BEFORE ITEM/LOOT WORK

Before designing or changing item generation, rarity, affixes, or item tooltips, research how
PoE2 itemization actually works — do not invent mechanics or colors from memory. Sources:
`https://poe2db.tw/` (up-to-date PoE2 bases/affixes/mods) and `https://www.poewiki.net/`
(mechanics). Match the tooltip look (rarity colors, name header, affix line format) to the
`item-*.png` screenshots above.

## Build / test

- Test: `npx vitest run [scope]` from repo root.
- Typecheck: `npm run typecheck` (tsc --noEmit; vitest strips types so this is mandatory).
- Web build: `npm run build -w apps/web`.

## Devlog — SCREENSHOT EACH VISIBLE STEP

- After any step with a visible result, screenshot the running app into `devlog/screenshots/` named
  `YYYY-MM-DD-<slug>.jpeg` (JPEG q75-80; use a small PNG only when transparency/fine detail needs it).
- Add that shot to `devlog/README.md` under its date with a one-line caption. Chronological, one entry per slice.
- Frame-accurate capture needs in-page timing plus a render freeze, not a loose sleep.

## Conventions

- Sim math is deterministic fixed-point integers; keep replay checksums stable.
- `@exiled/rules` is a pure leaf: no imports from other `@exiled` packages.
- Commit workflow: direct-to-main, one commit per task. No attribution trailers, no emdashes in messages.
