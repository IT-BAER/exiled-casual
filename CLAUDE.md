# Exiled Casual

Browser ARPG drawing on both Path of Exile 1 and 2, not a strict PoE2 clone: take the best of
either where they differ, and say which one a borrowed mechanic or look comes from. TypeScript,
npm workspaces. ECS sim (30 Hz, fixed-point) in `packages/`, React + Babylon client in `apps/web`.
Tests: Vitest.

## NUMBER ONE PRIORITY IS DOPAMINE

`docs/09-reward-psychology.md` outranks every other spec. Read it before any loot, drop, reward,
progression or feedback work, and re-read it when a change would make rewards more predictable.
The short version: the spike fires on *anticipation*, not receipt, so variance is the mechanism and
must never be flattened to be kind; a reward the player cannot hear and see did not happen; and
intensity beats density (one loud moment over six quiet ones). Correctness and determinism still
win where they conflict.

## Visual reference — ALWAYS CHECK BEFORE UI/RENDER/ART WORK

Real Path of Exile 1 and 2 screenshots live in `poe2-screenshots/` (the folder name predates the
PoE1 additions). They are the look source-of-truth, and each entry below says which game it is.
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

## 3D assets

- The character is `wardrobe.glb`: one 65-joint rig carrying every slot's geometry, built offline by
  `tools/build_wardrobe.py` (Blender). Parts are named `slot.look.part`; the runtime dresses the
  character by showing one look per slot and hiding the rest, so gear changes cost visibility only
  and never restart the animation. Rebuild the glb after touching that script.
- The source packs are NOT modular: each welds its sleeves to its own bare forearms, and neither
  ships a head — the ranger only looks finished because his hood is his head. `base.head.*` is
  generated, rigid-weighted to `Head`/`neck_01`, and pinned to a flat skin texel of the hands'
  own material. Bone names are lowercase except `Head`.
- `body.ranger.coat` is generated too: the ranger's body stops at the hip and every body base is
  drawn as a long coat. Its UVs are copied from the nearest tunic vertex by angle and height, never
  projected into a box on the atlas (any box wide enough also clips a boot buckle into the cloth).
- `helmet.hood.helm` is generated from the cowl: its crown is duplicated, cut at the brow and pushed
  outward onto a dome, so it inherits the cloth's skin weights and can only ever cap the head it was
  cut from. Outward-only (the cowl points forward; a shrink-wrap is a hood in iron) and flat-shaded.
- The coat hangs on 8 two-joint `skirt_<i>_<n>` chains the builder adds under `pelvis`, driven at
  runtime by the verlet solver in `skirt.ts` (spring toward the bind pose, no gravity; capsule
  colliders down both legs). Skinning it to the thighs instead makes the hem sweep in phase with
  the knee and reads as two rigid blades. Rebuild the glb after changing `SKIRT_CHAINS`; `rig.ts`
  has the same count.
- All packs export the same 65 joints at the same bind pose, so a mesh from one binds to another's
  skeleton by assignment. `rig.test.ts` guards that and that every look the code asks for exists.
- Blender 5.2 is installed for asset authoring, driven headless:
  `"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python x.py`
  Its glTF importer adds a 42-vert `Icosphere` as the bone display shape; the exporter drops it.
- Raster UI/item art goes through `/codex-imagegen`, never hand-authored SVG: the quality gap is
  large and visible. Generated masters are cropped to their alpha bounds before downscaling.
- Worn armour is textured per item base by `tools/build_gear_textures.py`, which re-palettizes the
  ranger atlas to each base's inventory icon (luminance -> a ramp sampled from that icon). Rerun it
  after adding an armour base or changing an icon, and add the base to `GEAR_TEXTURE` in `rig.ts`;
  `rig.test.ts` fails if the two lists or the files disagree. It is a pixel transform on the real
  atlas, so UVs stay correct. The silhouette stays the ranger's; only geometry can change that.

## Devlog — SCREENSHOT EACH VISIBLE STEP

- After any step with a visible result, screenshot the running app into `devlog/screenshots/` named
  `YYYY-MM-DD-<slug>.jpeg` (JPEG q75-80; use a small PNG only when transparency/fine detail needs it).
- Add that shot to `devlog/README.md` under its date with a one-line caption. Chronological, one entry per slice.
- Frame-accurate capture needs in-page timing plus a render freeze, not a loose sleep.

## Conventions

- Sim math is deterministic fixed-point integers; keep replay checksums stable.
- `@exiled/rules` is a pure leaf: no imports from other `@exiled` packages.
- Commit workflow: direct-to-main, one commit per task. No attribution trailers, no emdashes in messages.
