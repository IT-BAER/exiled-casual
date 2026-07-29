# Main menu and character selection

Status: **delivered**. Written 2026-07-29 against `787ce9c`; see "Delivered" at the foot for
what the plan got wrong and what shipped instead.

Reference: `reference-screenshots/main-menu.png` and `character-selection.png` (both PoE1).
Borrowed from PoE1, not PoE2: the domed hall with the colossal seated statue, the gilt button
column, the right-hand roster panel with per-row portrait, name, `LEVEL n <class>` and league
column, and the `CREATE / DELETE / PLAY` footer. Inspiration only — original wordmark, original
class names, original art, no PoE branding (see `docs/specs/2026-07-28-accounts-and-online-mode-design.md`
§Legal).

Decisions taken with the user before writing this:

- **Multi-character is for online mode. Local mode is capped at one character.** The data model
  holds N; the local cap is a policy check, not a shape.
- **Classes are cosmetic**, one body. The wardrobe is a single male rig.
- **2D matte backdrop + the live Babylon rig standing in front of it.**
- **`PLAY` opens a mode dialog: Local/Offline or Online.** Online is not implemented and says so.

---

## 1. What exists, verified

- `apps/web/src/App.tsx` is the whole client: one `useEffect` builds the Babylon engine, spawns
  the sim worker, and never unmounts. There is no screen concept and no route.
- The save is **one blob, one implicit character**. `packages/simulation/src/persist.ts` writes
  `{version:2, session, inventory, stash, equipment, progress, shards, vendor}` through
  `KvStore`; `loadInto` **discards** any blob whose version differs.
- `packages/persistence` is a leaf that only knows opaque strings (`MemoryKv`, `IndexedDbKv`).
- The wardrobe has exactly **two looks per slot** — `commoner` and one armoured look
  (`rig.ts:227-239`). Armour *variety* is texture-only: `GEAR_TEXTURE` maps 5 item bases to
  palettes baked by `tools/build_gear_textures.py` from each base's inventory icon.
- No class, ascendancy, character-name or league concept anywhere in `packages/`.
- `index.html` sets `user-select: none` globally and states "There is no text input anywhere in
  the client to break". The create-character name field is the first one.

## 2. Shape

```
boot ─▶ MainMenu ─PLAY─▶ ModeDialog ─Local─▶ CharacterSelect ─PLAY─▶ GameView
          │                  └─Online──▶ unavailable notice          │
          │                                    ▲                     │
          └─ OPTIONS / CREDITS                 └── CREATE ─▶ CreateCharacter
                                        CharacterSelect ─LOG OUT─▶ MainMenu
```

`App.tsx` becomes a router over `screen: "menu" | "select" | "create" | "game"`. Everything that
is in `App.tsx` today moves **verbatim** into `GameView.tsx`, which mounts only on `"game"` — so
the Babylon engine and the sim worker never start while the player is in the menu.

New files:

| File | Job |
|---|---|
| `apps/web/src/menu/MainMenu.tsx` | backdrop, logo, button column, atmos layers |
| `apps/web/src/menu/ModeDialog.tsx` | Local vs Online |
| `apps/web/src/menu/CharacterSelect.tsx` | roster panel + footer buttons |
| `apps/web/src/menu/CreateCharacter.tsx` | class picker + name field |
| `apps/web/src/menu/MenuStage.tsx` | React host for the preview scene |
| `apps/web/src/menu/atmos.tsx` | dust canvas, fog layers, parallax, vignette |
| `apps/web/src/menu/frames.ts` | shared plate/frame/button CSS, the way `hud/layout.ts` is shared |
| `apps/web/src/render/menu-scene.ts` | small Babylon scene: rig + torch lights, no sim |
| `apps/web/src/save/roster.ts` | thin client wrapper over the roster API |
| `apps/web/src/GameView.tsx` | today's `App.tsx`, unchanged |

## 3. Data model

### 3.1 Roster blob (persistence stays a leaf)

`packages/persistence/src/roster.ts` — never parses a character's state, so the leaf stays pure:

```ts
export interface CharacterHeader {
  id: string;            // crypto.randomUUID()
  name: string;
  classId: string;
  level: number;         // denormalised for the list; rewritten on every save
  league: string;        // "Local" today; the online league name later
  createdAt: number;
}
export interface CharacterRecord extends CharacterHeader { state: unknown } // opaque sim blob
export interface RosterBlob {
  version: 3;
  characters: CharacterRecord[];
  stash?: unknown;       // shared across characters, as PoE does
  lastPlayedId?: string;
}
export const LOCAL_CHARACTER_CAP = 1;
```

Functions: `loadRoster`, `saveRoster`, `addCharacter`, `removeCharacter`, `touchLastPlayed`.
`addCharacter` rejects past the cap it is handed, so the cap is the caller's policy (local passes
`LOCAL_CHARACTER_CAP`, online passes `Infinity`).

### 3.2 Simulation side

`persist.ts` gains, alongside today's functions:

- `saveCharacterTo(kv, world, id)` — snapshot the world, write it into that character's `state`,
  and refresh the header's `level` from `ProgressC`.
- `loadCharacterInto(kv, world, id)` — read the roster, `restore()` from that character's state.
- `newCharacterState(classId)` — the starting `PersistedState` for a class: `START_LEVEL`, the
  class's starting equipment.
- **`migrate(raw)`** — this is item 1 of the accounts doc's sequence, and it is free to do now.
  A `version: 2` blob becomes a one-character v3 roster (name `"Exile"`, class = the default,
  level from `progress`). `VERSION` goes to 3. The discard stays only as the fallback for a blob
  older than the oldest migration.

The **stash moves to roster level** (shared), because a shared stash is the PoE behaviour and the
component is already separate. **Gold and shards stay per-character** for now even though
`protocol/index.ts:239` calls gold "account-bound": sharing them means threading roster state
through vendor buy/sell, and with the local cap at one character nothing is observable until
online lands. Flagged, not silently decided.

### 3.3 Classes

Mirrors the maps pattern exactly: `@exiled/rules` is a pure leaf so it holds only the id strings
(`CLASS_IDS`), `content-runtime/classes.ts` holds the display data, and a test fails if the two
lists disagree (`simulation/maps.test.ts` is the template).

| id | name | archetype | starting look |
|---|---|---|---|
| `class.ironsworn` | Ironsworn | strength / melee | plate body, no hood |
| `class.stalker` | Stalker | dexterity / bow | ranger leathers + hood |
| `class.emberbound` | Emberbound | intellect / spell | ember robe + hood |

Cosmetic only: the class id is stored and drives starting equipment and portrait. No stat
difference in this slice — `stats.ts` is untouched, so no balance surface opens.

## 4. Art (all via `/codex-imagegen`, per CLAUDE.md; no hand-authored SVG)

Generated masters go to `assets/menu/`, cropped to alpha bounds, downscaled, and shipped to
`apps/web/public/textures/ui/menu/`. Every generation is staged in `review/` for sign-off before
it is used.

| Asset | Size | Notes |
|---|---|---|
| `menu_backdrop.jpg` | 2560x1440 | domed rotunda, colossal seated statue right of centre, columns, cold blue-grey fog, lit braziers. Left third kept quiet for the promo/news column, centre-top quiet for the logo. |
| `select_backdrop.jpg` | 2560x1440 | same hall, statue centred, **empty foreground floor** — that floor is where the 3D character stands. |
| `logo.png` | 1600x600, alpha | wordmark on a gilt-and-iron banner plate with a hanging tassel band, as the reference's logo sits. |
| `button_idle.png` / `button_hover.png` | 512x96 | stone plate, gilt bevel, dark fill. Pressed state is derived in CSS (inset shadow + 1px shift), not a third generation. |
| `panel_frame.png` | 1024x1024, alpha | ornate frame used with CSS `border-image` + `border-image-slice`, which is 9-slice for free and lets one asset wrap both the button column and the roster panel. |
| `row_idle.png` / `row_selected.png` | 768x96 | roster row band; selected is the gilt-lit variant. |
| `portrait_ironsworn.png` etc. | 256x256 x3 | framed head icons for the rows and the class picker. |
| `fog_sheet.png` | 1024x1024, tileable | two instances panned at different speeds for drifting haze. |
| `divider.png` | 512x24, alpha | filigree rule between panel sections. |

**Class armour textures** (separate, and load-bearing): without it the three classes render
identically, because armour variety is texture-only. One inventory icon per class body base
(`/codex-imagegen`), three new bases in `content-runtime/items.ts`, then rerun
`tools/build_gear_textures.py` and add them to `GEAR_TEXTURE` in `rig.ts`. `rig.test.ts` fails if
the table and the files disagree, so that guard already covers the addition.

## 5. Atmosphere

Layer order, back to front: backdrop → parallax fog x2 → brazier glow → dust canvas → 3D stage →
vignette → grain → UI.

- **Parallax.** Backdrop and fog translate on `pointermove`, backdrop ~6px, near fog ~14px. The
  3D stage's camera takes the same offset so the character does not slide off its floor.
- **Dust motes.** One `<canvas>`, ~80 specks, slow upward drift with a per-speck sine sway,
  additive. Procedural — an asset would tile visibly.
- **Brazier flicker.** CSS radial gradients pinned over the baked braziers, opacity driven by two
  sines at incommensurate periods so it never repeats on a beat.
- **Vignette + grain.** CSS radial gradient and a 128px noise tile at ~3% opacity.
- **Torchlight on the 3D character.** Two warm point lights placed to agree with the backdrop's
  braziers, plus a cold fill from the dome. This is the join that sells the composite: if the
  rig's key light disagrees with the painting, the character reads as a sticker.
- **Audio is deferred.** No ambient bed or button clicks in this slice — there is no audio
  generation tool consented for this project, and `audio/` holds only `drop-sound.ts`.

## 6. Behaviour details

- **Buttons.** Hover brightens the gilt and lifts the text shadow; press insets 1px. Focus ring is
  a gilt outline, not the browser default. Keyboard: `Tab`/arrows move, `Enter` activates.
- **Roster.** Arrow keys move the selection, `Enter` plays, `Delete` asks. Selection change swaps
  the 3D character's looks — visibility only, no rebuild, as `rig.ts` already does in game.
- **DELETE** requires typing the character's name, the way PoE does. Deletion is irreversible and
  the blob is atomic; a misclick must not be able to spend a character.
- **CREATE** is disabled at the local cap with the reason on the button's tooltip: "Local mode
  holds one character. Multiple characters arrive with online mode."
- **Online** in the mode dialog is present and visibly unavailable, with one line pointing at what
  it will be. It never pretends to reach a server.
- **No `EXIT`.** The reference has it because PoE is a desktop client; a browser tab cannot close
  itself unless script opened it. `LOG OUT` on character select returns to the main menu instead.
- **Text input.** The name field needs `user-select: text` and an exemption from the global
  `!important` cursor rule in `index.html`, or the field cannot be selected and shows the blade
  over an editable box. Name is validated: 3-20 chars, letters and digits, unique in the roster.

## 7. Tests

Vitest, jsdom for the React screens.

1. `persistence/roster.test.ts` — add/remove/cap, `lastPlayedId` follows the last play, removing
   the last character leaves a valid empty roster.
2. `simulation/persist.test.ts` — **a real captured v2 blob migrates to a one-character v3 roster
   with its level and stash intact**; per-character round-trip; a v1 blob still falls back to
   discard.
3. `menu/MainMenu.test.tsx` — buttons render, `PLAY` opens the dialog, `Online` is disabled.
4. `menu/CharacterSelect.test.tsx` — rows render name/level/class/league, `CREATE` is disabled at
   the cap, `DELETE` needs the typed name, `PLAY` reports the selected id.
5. `menu/CreateCharacter.test.tsx` — name validation, class selection, created character lands in
   the roster.
6. `render/menu-scene.test.ts` — every class's starting looks resolve to meshes that exist, the
   same guard `rig.test.ts` already applies to in-game looks.
7. `App.test.tsx` splits: today's file becomes `GameView.test.tsx` (import swap only), and a new
   `App.test.tsx` covers routing. No test-only prop on `App`.

Then `npx vitest run`, `npm run typecheck`, `npm run build -w apps/web`.

## 8. Sequence and estimates

Estimates are wall-clock for me, at this repo's test density.

| # | Phase | Est. |
|---|---|---|
| 1 | Roster + v2→v3 migration + classes in rules/content-runtime, with tests. No UI. | 60-90 min |
| 2 | Extract `GameView`, add the router and stub screens, split the App test. Game still plays. | 30-45 min |
| 3 | Art batch via `/codex-imagegen`, staged in `review/`. **Sign-off gate.** | 45-75 min + your review |
| 4 | `frames.ts` + `MainMenu` against the real art, plus the atmos layers. | 60-90 min |
| 5 | Mode dialog, and `CharacterSelect`'s roster panel. | 45-60 min |
| 6 | `menu-scene.ts`: rig on the matte, torch lights, looks per selection. | 60-90 min |
| 7 | `CreateCharacter` + class armour textures (icons, bases, `build_gear_textures.py`). | 60-90 min |
| 8 | Wire `PLAY` → worker `init` with the character id; hydrate that character. | 30 min |
| 9 | Screenshots to `review/`, sign-off, `devlog/` entry, commit. | 20 min + your review |

Two gates need you: the art in phase 3, and the frames in phase 9.

## 9. Risks

- **The composite join.** A 2D matte with a 3D character in front lives or dies on matched light
  direction, colour temperature, contact shadow and perspective. Budget one iteration on the
  character's lighting after the backdrop exists; do not tune it before.
- **Classes look identical without the texture work** (phase 7). If phase 7 is cut, the three
  classes differ only by portrait and hood, which is worse than having one class.
- **The migration is the first irreversible thing here.** It runs on a real save. It gets its test
  written against a captured v2 blob before the code, not after.
- **Bundle.** The menu importing `@exiled/simulation` for `newCharacterState` pulls the sim into
  the main chunk. Keep the menu's import to the roster module in `@exiled/persistence` and let the
  worker own everything that needs the sim.
- Existing traps that still apply: `indexedDB.deleteDatabase("exiled-casual")` for a clean run,
  and frame capture needs `scene.render()` + `drawImage` in the same script.

## 10. Not in this slice

- Any online mode, login, or server. The dialog names it and stops.
- Class stat differences, ascendancies, skill trees.
- Options and Credits screens beyond a panel with real content and a back button.
- Audio.
- Character-select idle variety: one idle clip, no per-class pose or reaction.

---

## Delivered, 2026-07-29

Status: implemented and verified. `npx vitest run` 1178 passing, `npm run typecheck` clean,
`npm run build -w apps/web` clean. Driven end to end in the browser: menu, world choice, roster,
create, into the game, Escape, back out.

### Where the plan was wrong

- **`persist.VERSION` did not move.** The plan said bump it to 3. One character's save shape did
  not change, so the version that describes it should not change either; `ROSTER_VERSION` (3)
  versions the blob that now wraps those saves. Two numbers, and they mean different things.
- **`characters.ts` had to split.** The menu needs the roster before any world exists, and it runs
  on the main thread. `roster-io.ts` (no ECS import) is what the menu takes; `characters.ts` keeps
  the half that needs a World. Verified from the built bundle: `createCombatSim`, `generateArea`
  and `registerMonsterAI` appear nowhere in the main chunk.
- **The 3D stage is owned by `App`, not by either screen.** React reconciles by tree position, so a
  stage rendered inside the select screen was torn down and rebuilt — new engine, refetched
  wardrobe, restarted idle — the moment `CREATE` swapped one screen for the other. It layers by
  z-index instead of document order.
- **The plan had no way back out of the game.** `GameView` gained an Escape menu (Resume /
  Characters), because a select screen you can only leave forwards is a one-way door.
- **Two states of the button plate were not generated.** One plate, CSS filters for hover and
  pressed. Two renders of the same object are never quite the same object.

### The bug the screenshots caught, and the tests did not

The first live run showed a character select with nobody standing in it, while every test passed.
`loadPlayerRig` cached its containers per scene but shared ONE in-flight promise across scenes, so
the menu's second scene (StrictMode remounts every effect) was handed the first scene's load,
`isRigReady` answered false for the scene actually on screen, and `attachRig` returned null. The
abandoned first mount then called `resetPlayerRig()` and wiped the cache the live one was using.

Both halves are fixed in `rig.ts` and pinned by `rig.test.ts`: `pending` now carries the scene it
belongs to, and `resetPlayerRig(scene)` only clears a cache that is actually that scene's. This is
a real menu-to-game hazard, not a StrictMode artefact — they are two scenes in one page's life
either way.

### Known limitations, not defects

- **The character has no face.** `base.head.*` is generated and pinned to a flat skin texel; it has
  no features at all. Mitigated on the stage by a three-quarter turn, a hood, a weak fill and warm
  light from behind, which is the honest treatment for a head that does not have one. A real face
  needs a new head mesh and a new texture, not a lighting change.
- **Classes are cosmetic.** The id is stored so stats can hang off it later without a save
  migration; nothing in `stats.ts` reads it.
- **Gold and shards stay per-character** while the stash is shared. Flagged in the accounts spec.
- **No audio.** No ambient bed, no button cue.
- **Options holds nothing.** It says so rather than showing sliders that write to nowhere.

### Screenshots

Staged in `review/`, awaiting sign-off before they may enter `devlog/`: `menu-main`,
`menu-mode-dialog`, `menu-character-select`, `menu-create-character`, `menu-create-ironsworn`,
`menu-create-emberbound`, `menu-credits`, `menu-into-game`, `menu-in-game-pause`.
