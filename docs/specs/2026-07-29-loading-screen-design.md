# Exiled Casual — Slice: "Loading screen"

Design spec. Status: **built, verified 2026-08-05.** Owner picked all three forks
(full scope, pre-rendered animation, one wallpaper per biome) on the plan of the same date.
Follows the options-panel slice at HEAD `cbedccd`.

Reference plate: **the owner's own layout sketch** — full-bleed wallpaper, a hairline rule near
the foot, then a footer band carrying TIPS bottom-left, the loading animation centred, and the
area name bottom-right. That sketch is the layout contract.

## As built

All three covers shipped: static markup in `index.html` for first boot, a React Suspense plate while
the lazy game chunk arrives, and a `GameView` plate for area transitions. The area plate stays up
until the worker area message arrived, the level and biome were built, the rig is ready for the
active scene, and a frame from the new area painted. `GameView` raises its plate on mount, so the
Suspense and world-build waits read as one continuous transition.

Biome wallpapers, a small boot plate, the rendered spinner sheet, tips, area names, vignette, and
fade shipped. The proposed determinate progress bar did not, because the synchronous level build
still has no honest countable progress. Texture compression and visible chunk-load failure remain
open.

> **Reference gap, stated up front.** `reference-screenshots/` holds no PoE loading screen.
> CLAUDE.md forbids designing UI from memory, so the *layout* comes from the sketch and the
> *material* comes from furniture we already have on disk and have already measured: the gilt of
> `menu/frames.tsx`, the carved stone of the bottom bar, the serif of the HUD. Nothing here is
> recalled from a PoE screen. If a real loading plate lands in `reference-screenshots/` later,
> the footer band is the part to re-check against it.

## Product thesis

The world pops in today. `GameView`'s worker `onmessage` handler builds the whole level
synchronously the moment the `area` message arrives (`GameView.tsx:173`), and until then the
player looks at whatever the last frame was. There is no loading state anywhere in the client.

Meanwhile the client is **one 5.5 MB JavaScript chunk**: `App.tsx` imports `GameView` statically,
so Babylon, the renderer and the sim client download before the main menu can paint its title.
The public tree adds ~40 MB on top (`wardrobe.glb` 5.0 MB, `textures/ui` 5.3 MB, `tilesets`
3.6 MB, `anim-library.glb` 3.0 MB).

Those two facts are one slice, not two. A loading screen is the only honest place to put a wait,
and a lazy chunk is what gives the loading screen something real to wait for. Shipping either
alone is worse than shipping neither: a loading screen over an instant transition is a fake, and
a lazy chunk with no cover is a white page.

## The rule this slice answers to

`docs/09-reward-psychology.md` rule 8: **latency is a dopamine tax.** A loading screen does not
get to lengthen the gap because it looks nice. Three consequences, all binding:

1. **It ends on a signal, never on a timer.** Every gate below is a real readiness fact.
2. **No fake progress.** We show a determinate bar only where we can count what we await.
   Everywhere else it is an indeterminate animation, which is the honest shape.
3. **The only permitted delay is anti-flash**, capped at `MIN_SHOW_MS` (400), and only so a
   sub-frame load does not strobe. It is a floor on an already-started screen, never a hold on a
   finished one.

The counterweight is anticipation, which the same document says is the whole mechanism: the
screen shows **the biome you are entering**. That is the reason for five wallpapers rather than
one, and it is why the area name is on the plate at all.

## Layout

One component, `apps/web/src/LoadingScreen.tsx`, absolutely positioned over everything.

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│                  WALLPAPER (cover)                     │  ~87vh
│                                                        │
├────────────────────────────────────────────────────────┤  ← rule
│  TIP text …            (animation)            AREA NAME │  ~13vh
└────────────────────────────────────────────────────────┘
```

- **Wallpaper** fills the plate, `object-fit: cover`, anchored centre. It is a plain `<img>`, not a
  CSS background, so the browser's preload scanner can start it in the same breath as the HTML.
- **The rule** is the bottom bar's own hairline vocabulary, not a new one: a warm 1px line over a
  darker one, the pairing `skill-rail` already uses.
- **Footer band** is the carved stone of `bar-panel-v3.png`, the same material the bottom bar took
  edge-to-edge at `cbedccd`. One material for the game's furniture, not a second invention.
- **Tip** left, in the HUD serif, dim parchment. **Area name** right, same face, gilt, uppercase,
  letterspaced — it is the plate's title and the only bright text down there.
- **Animation** centred on the band, overlapping the rule, exactly as the sketch has it.

## Where it appears

All three, per the owner's pick. They are three different waits and only the first two share a
component.

| Moment | What is actually being waited on | Cover |
|---|---|---|
| **First boot** | the 5.5 MB entry chunk itself | markup in `index.html` |
| **Menu → game** | the lazy `GameView` chunk + Babylon + the wardrobe | `LoadingScreen` as Suspense fallback |
| **Hideout ⇄ map** | the `area` message, `buildLevel`, the tileset | `LoadingScreen` behind the gate |

**First boot cannot be React.** Nothing React renders can cover the download of the bundle that
contains React. So the first-boot cover is static markup and inline CSS in `index.html`, holding
the wallpaper and the animation and nothing else — no tip, no area name, because neither is known
before the roster loads. The React `LoadingScreen` takes over from it and dismisses it, so the two
never both show and the handover is not a flash of nothing.

That constraint pins one asset rule: **the first-boot wallpaper and the animation must not live in
the JS chunk.** They are files the HTML references directly.

## The readiness gate

`LoadingScreen` is shown while *any* required signal is outstanding. The set differs per moment,
so the gate takes the set rather than hard-coding it.

For an area change, all four must land:

1. the worker's `area` message received,
2. `buildLevel` + `applyTilesetFloor` + `applyBiomeTint` returned,
3. the player rig ready for **this scene** (`isRigReady`, which is per-scene on purpose —
   see the cache note in CLAUDE.md),
4. one frame actually rendered with the new area's first snapshot.

Signal 4 is the one that is easy to leave out and the one that matters: the other three can all be
true while the first painted frame is still a black canvas.

**StrictMode double-mounts.** The menu and the game are two scenes in one page's life, three under
StrictMode, and the rig cache is keyed per scene. The gate must key its "ready" facts to the scene
it is gating, or an abandoned scene's readiness dismisses a live scene's screen.

## Content

- **Tips** — a plain array in `apps/web/src/tips.ts`, no content package. They are client copy about
  playing the game, not simulated content, and `@exiled/rules` stays a pure leaf. One is picked per
  load. Rotation while the screen is up is deferred to increment 5, and only if a load is long
  enough to read two.
- **Area name** — the biome's `name` (`Vaal Stone`, `Desert`, `Swamp`, `Forest`), or `Hideout` when
  `mapBaseId` is empty. Map bases carry no display name of their own; the biome does
  (`packages/content-runtime/src/maps.ts`), so the biome is the source and there is no second list
  to drift.

## Art

**Wallpapers — five, `/codex-imagegen`.** `vaal_stone`, `desert`, `swamp`, `forest`, `hideout`.
Authored wide (16:9, oversized), cropped and downscaled by `tools/build_loading_textures.py`, which
also emits the one small first-boot variant `index.html` can afford to block on. Masters live in
`assets/loading/`, the derived tree is gitignored, the shipped files land in
`apps/web/public/textures/loading/`.

**Animation — Blender, not image generation.** The owner picked a pre-rendered frame sequence, and
image generation cannot produce temporally coherent frames: each frame is drawn independently and
a rotation across them jitters. Blender 5.2 headless renders an exact rotation, so the *decision*
stands and the *tool* changes. Built by `tools/build_loading_spinner.py` into one sprite sheet,
played by `steps()` on `background-position` — no per-frame JS, and it keeps running while the main
thread is blocked building the level, which a JS-driven animation would not.

That last point is the real argument for a sprite sheet here and it is worth keeping: `buildLevel`
is synchronous, so anything animated by `requestAnimationFrame` freezes exactly when the player is
most likely to be watching it.

## What this makes harder

- **Five wallpapers is five renders forever.** A new biome is now a biome plus a plate, the same
  standing debt `GEAR_TEXTURE` carries for armour bases. `rig.test.ts`'s pattern applies: the test
  should fail if the biome list and the wallpaper files disagree, rather than shipping a biome
  whose loading screen is a missing image.
- **Lazy chunks make a new failure mode.** A chunk that fails to load leaves the screen up forever.
  The gate needs a visible failure, not an infinite spinner.
- **The anti-flash floor is a latency tax by construction.** 400 ms is the cap and it is a knob;
  it should be measured against real loads before it is believed.

## Increments

1. `LoadingScreen` + the readiness gate for the area change. Placeholder plate.
2. `React.lazy` on `GameView` and `MenuStage`, the screen as the Suspense fallback.
3. The first-boot cover in `index.html` and its handover.
4. The wallpapers and the rendered animation replace the placeholders.
5. Polish: cross-fade, tip picked per load, the `MIN_SHOW_MS` floor, real progress where countable.

## Deliberately out of scope

- **Texture compression.** The 9 MB of monster and cloth PNGs want KTX2 or WebP and would cut
  60-80%, which is a bigger win than everything above. It is its own slice with its own risks
  (loader support, per-platform fallbacks) and folding it in here would hide it.
- **A progress bar over the area build.** `buildLevel` is one synchronous call; splitting it into
  countable stages is a renderer change, not a loading-screen change.
