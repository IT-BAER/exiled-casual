# Exiled Casual — Slice: "Options panel"

Design spec. Status: approved for planning, 2026-07-29.
Reference plate: `reference-screenshots/options.png` (**PoE 1** — tabbed window, gilt name band,
red X, six tabs, label-left/control-right rows, scrollbar, SAVE+CLOSE footer, drawn over a live
game). Follows the main-menu / character-select slice at HEAD `341c9f3`.

## Product thesis

Options today is a paragraph. `InfoScreen.tsx` prints `OPTIONS_TEXT` prose and nothing in it does
anything. This slice makes it a **window**: the PoE tabbed panel, drawn over whatever is behind it,
with controls that bite the instant you touch them. No SAVE button, because a setting that needs
confirming is a setting you cannot A/B against the room you are standing in — the whole value of a
graphics knob is turning it while looking at the frame it changes.

## Constraints (locked this slice)

| Decision | Value |
|---|---|
| Scope | Panel shell + Graphics + Sound + UI tab + damage numbers, split into three increments |
| Entry points | Main menu **and** the in-game Escape menu, **one** component drawn over what is behind it |
| Saving | Applies live, debounced write, `CLOSE` only. **No SAVE button** |
| Storage | `settings` as a new **optional** field on `RosterBlob`, beside `stash` |
| Save version | **No bump.** `asRoster` (`roster.ts:181`) rejects any blob whose version is not `ROSTER_VERSION`, so 3 → 4 would discard the existing roster to buy nothing. A v3 blob without `settings` reads as defaults |
| Scope of a setting | **Global, not per character.** `InfoScreen.tsx` already promises the save lives "beside the characters, not in a separate file" |
| Trust boundary | `settings.ts` is a **pure leaf**: shape + defaults + `sanitize(raw: unknown)`. The roster treats the field as opaque exactly as it treats `stash`, so the disk is untrusted and `sanitize` is the only thing standing between it and the renderer |
| Controls | **Art, not CSS**: round gem checkbox (on/off), slider track + block handle, active/inactive tab plates. Via `/codex-imagegen` per project rule, launched as background agents |

### Increments

1. **Panel shell + Graphics + Sound + art + both entry points.** The window, the tab strip, the
   three control widgets, the settings model, and two tabs whose every row moves something real.
2. **UI tab.** Minimap and loot-label visibility. Small, because increment 1 built the row kit.
3. **Damage numbers.** A feedback-design task governed by `docs/09-reward-psychology.md`, not a
   settings task — and it needs a protocol change first (§7).

## Out of scope (each a later spec)

Keybinds / an Input tab; a Game tab (loot filter, tooltips); Notifications; language; resolution or
window mode (the browser owns those); per-character settings; a settings sync across devices;
music volume (there is no music — §6); the scrollbar's own art if no tab overflows.

## 1. The window

Taken from the plate, in the order it reads top to bottom:

- **Carved header wing** spanning the panel's top edge, with the gilt **name band** centred on it
  reading `OPTIONS`, and the round **red X** sitting on the wing's right end.
- **Tab strip** below the header: the active tab is a lit, raised plate; inactive tabs are darker
  and sit lower. Three tabs this slice (`GRAPHICS`, `SOUND`, `UI`), not the plate's six.
- **Body**: group headings in small-caps gold (the plate's `GENERAL`, `MAP`), then rows — label
  left in muted tan serif, control right-aligned in a single column so the controls line up as a
  column and not per-row.
- **Footer strip**: the plate has SAVE (dark) + CLOSE (lit). We ship the lit **CLOSE** alone.
- The panel is **portrait**, taller than wide, and is drawn over the live scene, not instead of it.

Reuse what `apps/web/src/menu/frames.tsx` already has — `FramedPanel`, `MenuButton`, `Divider`,
`Label`, `MENU_ART`, `FRAME_SLICE`, `GOLD`, `SERIF`. New art is the three control widgets and the
two tab plates; the frame, the band and the button are already drawn.

**Consult the plate during the work, not only before it.** Never design from memory.

## 2. The settings model

New pure leaf `apps/web/src/settings.ts`. No imports from the sim, the renderer or React.

```ts
export interface Settings {
  graphics: {
    shadows: "off" | "low" | "high";
    ambientOcclusion: boolean;
    bloom: boolean;
    atmosphere: AtmospherePreset;   // "soft" | "heavy"
    resolutionScale: number;        // 0.5 .. 1.0
  };
  sound: { master: number; muted: boolean };   // master 0 .. 1
  ui: { minimap: boolean; lootLabels: boolean; damageNumbers: boolean };
}

export const DEFAULT_SETTINGS: Settings;
export function sanitize(raw: unknown): Settings;
```

`sanitize` is total: every field falls back to its default rather than throwing, unknown fields are
dropped, numbers are clamped, enums are checked against their member list. It is the only place that
parses the field, so it is the only place a corrupt save can be caught — and a corrupt save must
read as "defaults", never as a black screen, matching how `readBlob` already treats bad JSON.

## 3. Persistence

`RosterBlob` gains one optional field beside `stash`, and `roster.ts` gains one writer mirroring
`putStash` exactly:

```ts
export interface RosterBlob {
  version: number;
  characters: CharacterRecord[];
  stash?: unknown;
  settings?: unknown;   // NEW. Opaque, exactly as stash is opaque.
  lastPlayedId?: string;
}

export function putSettings(roster: RosterBlob, settings: unknown): RosterBlob;
```

`asRoster` is untouched, so `ROSTER_VERSION` stays 3 and every existing save keeps loading.
The client reads `sanitize(roster.settings)` and writes back the whole `Settings` object,
**debounced** (~400 ms) so dragging a slider does not write once per pointer event.

## 4. Applying settings live

One exported function in `apps/web/src/render/engine.ts`, mirroring the `applyAtmosphere` pattern
that is already there:

```ts
export function applyGraphics(scene: Scene, engine: Engine, g: Settings["graphics"]): void;
```

It **looks its targets up off the scene** rather than taking handles, because `createScene` wraps
each piece in its own `try`/`catch` (WebGL1 and NullEngine legitimately have none of them) and
`SceneHandle` deliberately exposes only `scene`, `camera` and the zoom pair. Missing piece → that
row is a no-op, which is also what makes the function testable headless.

| Row | What it drives | Site |
|---|---|---|
| Shadows off/low/high | `light.shadowEnabled`; low also drops the torch generator and takes the sun to `QUALITY_LOW` | `engine.ts:539` (sun, 2048, MEDIUM), `:601` (torch, 1024, LOW) |
| Ambient occlusion | attach/detach the `ssao` pipeline from the camera | `engine.ts:491` |
| Bloom | `GlowLayer.isEnabled` | `engine.ts:507` |
| Atmosphere soft/heavy | `applyAtmosphere` — already exists, already dev-exposed as `__atmos` | `engine.ts:131` |
| Resolution scale | `engine.setHardwareScalingLevel(1 / scale)` | Engine-level; the one knob that buys frames on a weak GPU |

Every row is a property flip on a live scene. Nothing here rebuilds the renderer, which is what
makes "applies live, no SAVE" an honest promise rather than a lie with a reload behind it.

## 5. Entry points

One `<OptionsPanel>` component, two mounts:

- **Main menu** — replaces the `{ kind: "info"; which: "options" }` route in `App.tsx`. The prose
  `OPTIONS_TEXT` in `InfoScreen.tsx` goes away; the other info screens stay.
- **In-game** — from `GameMenu` (`apps/web/src/GameView.tsx:308`). `GameView` deliberately clears
  every overlay before raising the Escape menu, so Options must slot **into that existing ordering**
  rather than opening a second competing layer.

There is no menu scene behind the main-menu mount and no menu scene in game, so the panel must not
assume either — it draws over whatever is there, exactly as the plate does over the live game.

## 6. Sound

`playDropSound` (`apps/web/src/audio/drop-sound.ts:131`) is today the **only** sound in the game —
one synthesised cue per rarity, no music, no ambient bed. Its `dry` and `wet` gains connect
**straight to `ctx.destination`** (`:75-76`), so there is nowhere to put a volume.

The delta is one master `GainNode` inserted between those two and the destination, plus reading its
value from settings. That gives the Sound tab two honest rows: **Master Volume** (slider) and
**Mute** (gem checkbox).

**No Music slider until there is music**, and no Master/Effects split while one bus exists — two
knobs that move the same gain is a control that teaches the player the panel is decorative.

## 7. Damage numbers (increment 3)

`Snapshot` (`packages/protocol/src/index.ts:215`) **carries no damage events**. The client cannot
draw a number it is never told about, so the toggle cannot exist before the protocol does. Increment
3 is therefore: a damage event on the snapshot, a floating-number renderer, and only then the row.

The renderer is a `docs/09-reward-psychology.md` job, not a settings job — a crit that does not
*look* like a crit is a reward the player cannot hear or see, and by that doc it did not happen.
It gets its own spec.

## 8. Tests

- `sanitize` against a table of hostile inputs: `null`, `[]`, a string, wrong-typed fields,
  out-of-range numbers, unknown enum members, extra keys. Every case yields a full valid `Settings`.
- Roster round-trip **with and without** `settings`; explicitly, a hand-written v3 blob that has no
  `settings` key still loads and reads as `DEFAULT_SETTINGS`.
- `applyGraphics` under `NullEngine`: every combination runs without throwing when the scene has no
  SSAO pipeline, no glow layer and no shadow generators.
- `applyGraphics` on a scene that *does* have them: each row flips the property it claims to.
- The debounce writes once for a burst of slider changes, and writes the last value.

## 9. Risks / knobs

- **The debounce window (~400 ms) is a guess.** One constant, named, in the panel.
- **`resolutionScale` is the only setting that can look broken while working**: at 0.5 the frame is
  visibly soft, which is the point, but it is the row most likely to be mistaken for a bug. Label it
  with what it trades.
- **Shadow "off" via `shadowEnabled` is reversible; disposing the generator is not.** Do not dispose
  — the panel must be able to turn it back on without rebuilding the scene.
- **`GameView` clears overlays before the Escape menu.** Slotting Options in wrong yields two
  layers fighting for the same z-order, which is invisible in tests and obvious on screen.
- **Settings are read before the renderer exists** on the main-menu path. `applyGraphics` must be
  safe to call against a scene that has not finished building, or the menu applies to nothing.
- The panel is the first UI in the project with **real form controls**. `index.html`'s "no text
  input anywhere" is already stale (name fields need `user-select`); sliders need pointer capture,
  and the game's own pointer handlers must not eat the drag.
