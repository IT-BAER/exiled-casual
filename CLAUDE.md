# Exiled Casual

Browser ARPG drawing on both Path of Exile 1 and 2, not a strict PoE2 clone: take the best of
either where they differ, and say which one a borrowed mechanic or look comes from. TypeScript,
npm workspaces. ECS sim (30 Hz, fixed-point) in `packages/`, React + Babylon client in `apps/web`.
Tests: Vitest.

## NUMBER ONE PRIORITY IS DOPAMINE

`docs/09-reward-psychology.md` outranks every other spec. Read it before any loot, drop, reward,
progression or feedback work, and re-read it when a change would make rewards more predictable. The
short version: the spike fires on *anticipation*, not receipt, so variance is the mechanism and must
never be flattened to be kind; a reward the player cannot hear and see did not happen; intensity
beats density. Correctness and determinism still win where they conflict.

## Visual reference — ALWAYS CHECK BEFORE UI/RENDER/ART WORK

Real Path of Exile 1 and 2 screenshots live in `reference-screenshots/`. They are the look
source-of-truth and each entry says which game it is. Consult the relevant one BEFORE any UI, render,
HUD, panel or art change, and re-check while iterating. Never design from memory.

- `hideout.jpg`, `closeup-hideout-zoom.jpg` — hideout look/camera
- `portals-map-device.webp` — map device + portal ring
- `inside-map.jpg`, `inside-map-battle.webp` — in-map areas + combat
- `boss-fight.png` — boss encounter
- `atlas-maps.webp` — Atlas / waystone map screen
- `poe2-atlas-node-popup.png` — PoE2 Atlas: the panel one node opens (name band, lore, socket, ACTIVATE)
- `item-normal.png`, `item-magic.png`, `item-rare.png`, `item-unique.png` — item hover/tooltip look per rarity (colors, header, stat lines)
- `inventory+equipment.png`, `inventory.png` — inventory screens: paper-doll, flasks, currency, and PoE1's full-height 12x5 grid with the currency strip at its foot
- `poe1-lower-bar.png` — PoE1 bottom bar: flask panel, and the skill panel's mouse row above its numbered row
- `main-menu.png`, `character-selection.png` — PoE1 main menu and character select. Borrow the LAYOUT (title emblem, panel, roster rows), never the painting: the first menu backdrop was PoE1's statue hall redrawn and had to be replaced

## Itemization & rarity — RESEARCH BEFORE ITEM/LOOT WORK

Before designing or changing item generation, rarity, affixes, or item tooltips, research how PoE2
itemization actually works — never invent mechanics or colors from memory. Sources: `https://poe2db.tw/`
(bases/affixes/mods) and `https://www.poewiki.net/` (mechanics). Match the tooltip look (rarity
colors, name header, affix line format) to the `item-*.png` screenshots above.

## Build / test

- Test: `npx vitest run [scope]` from repo root. Web build: `npm run build -w apps/web`.
- Typecheck: `npm run typecheck` (tsc --noEmit; vitest strips types so this is mandatory).

## 3D assets

- The character is `wardrobe.glb`: one 65-joint rig carrying every slot's geometry, built offline by
  `tools/build_wardrobe.py` (Blender). Parts are named `slot.look.part`; the runtime dresses the
  character by showing one look per slot and hiding the rest, so gear changes cost visibility only
  and never restart the animation. Rebuild the glb after touching that script.
- The outfit packs are NOT modular: each welds its sleeves to its own bare forearms, and neither
  ships a head — but both ship the *texture* for one, a face painted top-left of
  `T_Regular_Male_Dark_BaseColor.png`. So `base.head.*` is **cut out of the author's separate base
  male** (`Base_Male.gltf`) keeping its own UVs and weights, the only way a painted eye lands on an
  eye. **Never go back to a texel-pinned skull**: a correctly shaped, correctly animated blank
  passes every name test, so `rig.test.ts` pins UV *spread*. Different proportions do not matter —
  one unwrap, and `Head`/`neck_01` have bit-identical inverse binds. Hair and brows stay pinned (the
  pack hair texture is a 2048 greyscale wanting a tint shader we lack). Bones lowercase but `Head`.
- `body.ranger.coat` is generated too: the ranger's body stops at the hip and every body base is
  drawn as a long coat. Its UVs are copied from the nearest tunic vertex by angle and height, never
  projected into a box on the atlas (any box wide enough also clips a boot buckle into the cloth).
- `helmet.hood.helm` is generated from the cowl: its crown is duplicated, cut at the brow and pushed
  outward onto a dome, so it inherits the cloth's skin weights and can only ever cap the head it was
  cut from. Outward-only (the cowl points forward; a shrink-wrap is a hood in iron) and flat-shaded.
- The coat hangs on `SKIRT_JOINTS`-joint `skirt_<i>_<n>` chains the builder adds under `pelvis`,
  driven by the verlet solver in `skirt.ts` (spring toward bind pose, no gravity; capsule colliders
  down both legs, each sized to that limb's *median* half-width — size to its widest slice and the
  coat is caged in permanent contact, which reads as stiff cloth that never touches the legs).
  **One chain per coat column — `SKIRT_CHAINS = COAT_SEG` — the ratio matters, not the count.** The
  chains are the only geometry collision touches, so a column without one is skinned half to each
  neighbour and hangs in the gap where no capsule reaches (0.088 at the hem, wider than the thigh
  capsule); raising both rings together doubles resolution and blind spot at once. Chains run to the
  *deepest* hem ring: cloth below the last collided point is cloth a leg walks through. Rebuild the
  glb after changing `SKIRT_CHAINS` or `SKIRT_JOINTS`; `rig.ts` has both, `rig.test.ts` pins them.
- The chain needs joints *down* its length, not just chains around the ring: a 0.464 bone against a
  0.088 thigh can only pivot, never dent. `SKIRT_JOINTS` 3 — four is worse on every measure and dearer.
- `skirt.ts` solves at 240Hz so it outruns the display: collision only happens inside a step, and at
  1/60 against a 165Hz monitor two frames in three moved the legs and not the cloth. `DAMPING` and
  `STIFFNESS` are the 1/60-tuned values rescaled by `PER_OLD_STEP`, so the rate can change freely.
- **Measure the rig before tuning the cloth.** `MAX_CONTACT_SPEED` is the largest term in
  `skirt.ts`; it sat at 6 units/s on a guess while the instrumented joint runs at 18, so the leg
  outran the only mechanism that moves the coat. Method: capture anchors, rests and colliders per
  frame from the live app, replay through `SkirtSim` headlessly, and score *depth at a visible
  threshold* (>1cm, >2cm) — never bare contact count, which rises with particle count and made a
  finer chain look worse. `COLLIDE_PASSES` share one push budget on purpose, or iteration becomes an
  8x speed limit that looks like progress. **Score oscillation separately from travel, or rubber
  ships**: hem direction *reversals* per chain-frame (rubber 0.006 vs stiff 0.003) sees it, where
  mean hem offset is lag as much as swing. `DAMPING` is the frequency knob; `CONTACT_ABSORB` does
  nothing measurable in 0.3-0.6.
- All packs export the same 65 joints at the same bind pose, so a mesh from one binds to another's
  skeleton by assignment; `rig.test.ts` guards that, and that every look the code asks for exists.
- Blender 5.2 is installed, driven headless: `"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python x.py`.
  Its glTF importer adds a 42-vert `Icosphere` as the bone display shape; the exporter drops it.
- Raster UI/item art goes through `/codex-imagegen`, never hand-authored SVG: the quality gap is
  large and visible. Masters are cropped to their alpha bounds before downscaling. Renders run long,
  so launch them as background agents and do other work while they draw.
- Worn armour is textured per item base by `tools/build_gear_textures.py`, which re-palettizes the
  ranger atlas to each base's inventory icon (luminance -> a ramp sampled from that icon). Rerun it
  after adding an armour base or changing an icon, and add the base to `GEAR_TEXTURE` in `rig.ts`;
  `rig.test.ts` fails if the two lists or the files disagree. UVs stay correct (it is a pixel
  transform on the real atlas) but the silhouette stays the ranger's: only geometry changes that.
- The hideout props (map device, stash chest) are `props.glb`, built by `tools/build_props.py` from
  masters in `assets/props/` (via `/codex-imagegen`; `assets/props/build/` is derived, gitignored).
  Rebuild the glb after touching either. `props.ts` fetches it once and `meshes.ts` falls back to its
  old primitives when it has not loaded, so headless tests still run; `props.test.ts` pins the node
  and material names the runtime looks up. Two traps: glTF base colour is linear (a flat colour needs
  squaring to match Babylon), and a prop built facing -Y faces away after the two axis conversions.

## Maps & biomes

- An area is **assembled from authored chunks**, not carved: a 7x7 lattice of 16-cell tiles
  (112x112 cells = 56x56 world units). `skeleton.ts` decides a route (loop + dead-end spurs +
  a reserved 2x2 boss block) and hands out a 4-bit open-edge mask per tile; `assemble-area.ts`
  stamps a chunk onto each mask. Masks come first, so chunk choice is a lookup that cannot fail
  to edge-match. Each stage draws from its own named RNG sub-stream.
- Chunks are 16x16 ASCII in `loop-grammar.ts` / `field-grammar.ts` (`#` wall, `.` floor, `s`
  spawn, `r` reward, `b` boss, `e` exit). **The edge mask is DERIVED from the border, never
  declared**, and an open edge is exactly cells 6..9 of that edge — that window is symmetric
  about the tile centre, which is the only reason rotate and mirror are closed operations on the
  mask. Off-centre openings stop matching the moment a chunk is mirrored. `assertAuthored` runs
  at import and reports every bad chunk at once.
- A **grammar is a chunk library plus a branch count**, never a second code path. `loop` (Vaal
  Stone, Swamp) and `open-field` (Desert, Forest), 15 chunks each: 5 mask classes x 3 variants,
  plus one 2x2 boss arena — a single 8x8-unit tile cannot hold a boss when the camera sees 19x9.5.
- **Spawns spread ALONG the route, not at the end of it.** Taking the N farthest tiles put every
  monster 40+ units away in a 56-unit map and left the first half empty.
- Map bases live in `content-runtime/maps.ts`; `@exiled/rules` is a pure leaf so it holds only the
  id strings, and `simulation/maps.test.ts` fails if the two lists disagree. The Atlas node
  picks the base, the base picks the grammar and tileset. **The client must resolve the same
  grammar as the sim** or it draws a different dungeon than the one it collides against.
- Biome textures are generated (`/codex-imagegen`) into `assets/tilesets/<biome>/`, then made
  tiling by `tools/build_tileset_textures.py`; generated art does not tile and has no normal map,
  so that script is not optional. It cross-fades the wrap, derives the normal, and **lifts plates
  too dark to play on** (floors to 55, walls to 95); the renderer is calibrated against a 57-luma
  floor and a 132-luma wall, and engine.ts boosts the floor because actors are near-black. A biome
  tint is a **colour, not a dimmer**: `applyBiomeTint` normalises to mean 1.0.
- **Level walls must never be shadow casters** (`engine.ts` excludes `wallrun-*`). A 3.5-unit wall
  under that low sun throws a ~9-unit shadow, and the per-run boxes stayed in the shadow render
  list after the merge disposed them — 817 dead meshes after one map.

## Devlog — SCREENSHOT EACH VISIBLE STEP

- **Drive and capture the state yourself, with exact timings.** Anything transient (a skill FX, an
  impact, a projectile in flight) is over before a human can be asked to hold it, so asking the user
  to pose the screen is not a workflow. Script it: dispatch the input, wait a measured delay, then
  `scene.render()` and `drawImage` into an offscreen canvas inside the SAME in-page script (a plain
  full-page capture is fine for anything that holds still). Aim with a canvas `pointermove` first or
  a cast is a no-op (aim defaults to the player's own feet).
- Stage every capture in `review/` (gitignored) under a plain name and get sign-off BEFORE it enters
  `devlog/`. What needs confirming is the frame, not the moment; scratchpad paths are not reviewable.
  Once signed off it goes to `devlog/screenshots/YYYY-MM-DD-<slug>.jpeg` (JPEG q75-80; PNG only for
  transparency or fine detail) with a one-line caption under its date in `devlog/README.md`.

## Menus & characters

- The client is a **screen router** (`App.tsx`): `menu | mode | select | create | info | game`.
  The game lives in `GameView.tsx`, which builds the Babylon engine and spawns the sim worker ON
  MOUNT — keeping it unmounted is the point, and no menu screen may import it.
- The save is a **roster**: `packages/persistence/src/roster.ts` holds a record per character
  (id, name, class, level, league) plus a **shared stash**, and treats each character's save as an
  OPAQUE `state`; that leaf must never learn what a session is. `simulation/roster-io.ts` parses
  the roster without a World — the menu imports THAT, never `characters.ts`, or the whole sim lands
  in the main bundle. Two versions, not one: `persist.VERSION` (2) versions one character's save,
  `ROSTER_VERSION` (3) the blob wrapping them; `migrateSingleSave` upgrades a v2 blob on READ and
  does not commit it, so an untouched menu visit leaves the old save on disk.
- **Local mode holds one character** (`LOCAL_CHARACTER_CAP`), passed in by the caller so online
  passes `Infinity` and no shape changes. `PLAY` asks local-or-online BEFORE the roster: the two
  pools never mix, and that is only fair said in advance.
- **Classes are cosmetic and one body.** Ids in `@exiled/rules/classes.ts`, definitions in
  `content-runtime/classes.ts`, pinned together by `simulation/characters.test.ts`. One male rig and
  two looks per slot, so a class can only change the OUTFIT: each gets its own body base out of
  `STARTER_BASES` (kept out of the drop pool) whose baked `GEAR_TEXTURE` palette is the only thing
  making three classes read as three people.
- Menu art is generated (`/codex-imagegen`) into `assets/menu/`, cropped to alpha and scaled by
  `tools/build_menu_textures.py`, which also MEASURES the frame's `border-image-slice` off the alpha
  (a guessed inset shears a nine-slice). Plates are authored EMPTY; hover and pressed are filters.
- `loadPlayerRig` caches per SCENE, and the menu stage and the game are two scenes in one page's
  life (three under StrictMode). A load in flight for one scene must never be handed to another:
  its containers belong to the first, `isRigReady` answers false, and the character silently fails
  to appear. Same for `resetPlayerRig(scene)` — an abandoned scene must not wipe a live one's cache.
- The menu rig has a FACE now, so `FACING` is staging, not concealment, and `FILL_INTENSITY` (0.15)
  is the knob for how much of it you get — low because the plate is lit by fire, not because the
  head is blank. `index.html`'s "no text input anywhere" is stale too: name fields need `user-select`.
- **Never construct a `Texture` on the menu scene before `loadPlayerRig`.** A texture download
  across the wardrobe's glTF import leaves every wardrobe material sampling flat white: a correctly
  shaped, correctly animated white silhouette, and a green test suite. Bisected to the texture
  alone; the mesh and the material are harmless either side of the load.
- The painted floor is NOT the scene's y=0 (`FLOOR_Y`); `floorScreenY()` says where the soles land
  on the canvas and `menu-scene.test.ts` pins it against the painting. His shadow is cast FORWARD,
  because the plate's one shaft falls from the dome behind.
- **`BrazierSpot` coordinates are fractions of the BACKDROP IMAGE, not the viewport** — the backdrop
  is drawn `cover`, so viewport fractions hold in one window only. `flame: 0` keeps the painting's
  own fire and adds flicker alone; a drawn flame over a painted one is two fires in one bowl, which
  is why `menu_backdrop` is authored with cold coals. Nothing in the menus moves with the pointer.

## Conventions

- Sim math is deterministic fixed-point integers; keep replay checksums stable. `@exiled/rules` is a
  pure leaf: no imports from other `@exiled` packages.
- Commit workflow: direct-to-main, one commit per task. No attribution trailers, no emdashes in messages.
