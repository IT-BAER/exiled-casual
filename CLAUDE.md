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
- `poe2-atlas-node-popup.png` — PoE2 Atlas: the panel one node opens (name band, lore, socket, ACTIVATE)
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
- The coat hangs on `SKIRT_JOINTS`-joint `skirt_<i>_<n>` chains the builder adds under `pelvis`, driven at
  runtime by the verlet solver in `skirt.ts` (spring toward the bind pose, no gravity; capsule
  colliders down both legs, each sized to that limb's *median* half-width). Size a capsule to the
  limb's widest slice and it caged the coat in permanent contact, which reads as stiff cloth that
  never seems to touch the legs. **One chain per coat column — `SKIRT_CHAINS = COAT_SEG` — and the
  ratio is what matters, not the count.** The chains are the only geometry collision touches, so a
  column without its own chain is skinned half to each neighbour, lies on neither, and hangs in the
  gap between the collided lines where no capsule can reach it (0.088 out at the hem, wider than the
  thigh capsule). Raising both rings together, as 8→16 chains with 24→32 columns did, doubles the
  resolution and the blind spot at once. Chains run to the *deepest* hem ring, not the average: cloth
  below the last collided point is cloth a leg walks through. Skinning it to the thighs instead makes
  the hem sweep in phase with the knee and reads as two rigid blades. Rebuild the glb after changing
  `SKIRT_CHAINS` or `SKIRT_JOINTS`; `rig.ts` has both and `rig.test.ts` pins them and the binding.
- The chain also needs joints *down* its length, not just chains around the ring: at two joints each
  bone was 0.464 against a 0.088 thigh, and a bar that long can only pivot, never dent, so a leg
  pressing mid-panel had nowhere to put the cloth. Three halves the penetration; four is worse and
  dearer — the win is having somewhere to fold, not many somewheres.
- `skirt.ts` solves at 240Hz so it outruns the display: collision only happens inside a step, so the
  step rate is how often the coat may notice a leg. At 1/60 against a 165Hz monitor two frames in
  three moved the legs and not the cloth. `DAMPING` and `STIFFNESS` are written as the values tuned
  against a 1/60 step and rescaled by `PER_OLD_STEP`, so the rate can change without restarching it.
- **Measure the rig before tuning the cloth.** `MAX_CONTACT_SPEED` sat at 6 units/s on a comment's
  guess that "a limb tops out around 3"; the instrumented joint runs at 18, so the leg outran the
  only mechanism that moves the coat and went through it. It is the largest term in `skirt.ts`. The
  method that found it: capture anchors, rests and collider positions per frame from the live app,
  replay them through `SkirtSim` headlessly, and score frames showing >1cm and >2cm of leg. Score
  *depth at a visible threshold*, never bare contact count — the latter rises with particle count
  and made a finer chain look worse. `COLLIDE_PASSES` share one push budget on purpose: let each
  pass spend the full cap and iteration silently becomes an 8x speed limit that looks like progress.
  **Score oscillation separately from travel, or rubber ships.** Depth plus mean hem offset cannot
  tell a coat that swings from one that shakes: both rose together and the fix read as "flutters too
  quick, like rubber". The metric that sees it is hem direction *reversals* per chain-frame (rubber
  0.006 vs stiff 0.003). Mean offset from the bind pose is lag as much as swing, so it keeps rising
  as the cloth gets heavier — it is not a "more is better" axis. `DAMPING` is the frequency knob;
  `CONTACT_ABSORB` does nothing measurable anywhere in 0.3-0.6 and is not where to fix ringing.
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
- The hideout props (map device, stash chest) are `props.glb`, built by `tools/build_props.py` from
  the texture masters in `assets/props/` (generated via `/codex-imagegen`; `assets/props/build/` is
  derived and gitignored). Rebuild the glb after touching either. `props.ts` fetches it once and
  `meshes.ts` falls back to its old primitives when it has not loaded, so headless tests still run;
  `props.test.ts` pins the node and material names the runtime looks up. Two traps: glTF base colour
  is linear, so a flat colour needs squaring to look like the Babylon value it replaces, and a prop
  built facing -Y in Blender ends up facing away from the camera after the two axis conversions.

## Devlog — SCREENSHOT EACH VISIBLE STEP

- **Ask the user to confirm the screen before you capture it.** Say what is on it and wait; a devlog
  shot of the wrong state, or of a state the user has not signed off, is worse than no shot.
- After any step with a visible result, screenshot the running app into `devlog/screenshots/` named
  `YYYY-MM-DD-<slug>.jpeg` (JPEG q75-80; use a small PNG only when transparency/fine detail needs it).
- Add that shot to `devlog/README.md` under its date with a one-line caption. Chronological, one entry per slice.
- Frame-accurate capture needs in-page timing plus a render freeze, not a loose sleep.

## Conventions

- Sim math is deterministic fixed-point integers; keep replay checksums stable.
- `@exiled/rules` is a pure leaf: no imports from other `@exiled` packages.
- Commit workflow: direct-to-main, one commit per task. No attribution trailers, no emdashes in messages.
