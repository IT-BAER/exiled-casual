# Armour silhouettes: a body base is a shape, not a palette

## Why

Today every equipped body item maps onto ONE authored geometry look
(`rig.ts:380` `EQUIPPED.body = "ranger"`); only the texture palette changes per
base (`GEAR_TEXTURE`, `rig.ts:300`). A rare plate and a white robe are the same
ranger coat in two colours. `rig.ts:344-362` already diagnoses the fix: *a second
look needs accent **geometry**, not a colour pass*. Ties directly to
`docs/09-reward-psychology.md` — a drop the player cannot see did not happen.

Scope of this plan: the **body slot** first (highest payoff). Helmet/gloves/boots
follow the same pattern in a later plan once this ships.

## How the body look is made (survey result)

`tools/build_wardrobe.py`:
- `build_coat(armature, torso)` (`:925`) lofts a coat from a `(z, radius)` ring
  profile (`COAT_RINGS` `:225`, `COAT_HEM` `:237`), squashed front-to-back
  (`COAT_CY` 0.03, `COAT_DEPTH` 0.88), 32 segments (`COAT_SEG`), emits mesh
  `body.ranger.coat`. UVs borrowed from the torso by nearest (angle,height)
  (`torso_uvs` `:904`). Weights: each vert bound to a SINGLE skirt chain +
  pelvis pin (`:996-1040`).
- Skirt chains (`build_skirt_bones` `:861`) hang from `pelvis`, span
  `SKIRT_TOP_Z..SKIRT_HEM_Z` = `COAT_RINGS[0].z` .. `min(COAT_HEM).z` (`:295`),
  count `SKIRT_CHAINS = COAT_SEG` (`:266`), 3 joints each. The runtime cloth
  solver (`skirt.ts`) collides ONLY these chains.
- `main` (`:1048`) builds one coat: `:1077`.
- The packs already ship `body.ranger.pauldron` (`RENAME` `:322`) — accent-
  geometry precedent.

Invariants pinned by `rig.test.ts`:
- `:353` 65 pack joints + `SKIRT_CHAINS*SKIRT_JOINTS` skirt joints.
- `:366` every skirt bone one segment length (<1% spread).
- `:384` every `body.ranger.coat` vertex binds to a single chain (worst 2nd-chain
  share <0.01) — the collision-reachability guard.
- `:261` `looksForEquipment({body:{baseId}})` returns `${plain}#baseId` with
  `meshLook === plain` — **assumes body geometry is base-independent. This
  assumption is what this plan breaks; the test changes with it.**
- `:247` rarity must NOT change the look (stays true — look varies by base, not
  rarity).

## The looks

All share the 65-joint skeleton, bind pose, and the skirt chains; `ranger` stays
byte-identical (regression guard). Numbers are starting points — judged in-game
at `--view game`, per `CLAUDE.md`, and the owner tests feel.

| look | base(s) | profile intent | hem z | touches skirt span? |
|---|---|---|---|---|
| `ranger` | fallback (unmapped) | unchanged | 0.20 | no (reference) |
| `plate` | ironsworn_plate | bulkier torso (radii ~+0.03), short **stiff tassets**, + pauldron caps | ~0.45 | no (shallower) |
| `leather` | stalker_leathers | slim close-cut (radii ~-0.02), knee-length, minimal flare | ~0.52 | no (shallower) |
| `robe` | emberbound_robe, emberweave_robe | fuller **and floor-length** | ~0.05 | **YES — deepens chains** |

Because plate/leather hems are shallower than ranger's 0.20, the skirt span stays
ranger's and `ranger` output is unchanged. `robe` at 0.05 is DEEPER, so it must
redrive `SKIRT_HEM_Z = min hem over ALL looks` and rebuild the chains — the one
change that touches the pinned cloth invariant. Do robe in its own task, reviewed.

## Tasks

### 1. Parameterize the coat generator; add plate + leather (no invariant change)
`tools/build_wardrobe.py`:
- Add `BODY_LOOKS: dict[str, Profile]` where `ranger` holds today's exact
  `COAT_RINGS/COAT_HEM/COAT_CY/COAT_DEPTH` (byte-identical), plus `plate`,
  `leather` profiles.
- `build_coat(armature, torso, look)` reads `BODY_LOOKS[look]`, names mesh
  `body.<look>.coat`. `coat_point` takes `cy, depth`. Weighting still uses the
  SHARED `SKIRT_TOP_Z/SKIRT_HEM_Z` (chain span), unchanged.
- `build_pauldrons(armature, look, mat)`: two dome shells over the shoulders,
  weighted to `clavicle_l/r` + `upperarm_l/r` (NOT the coat chains — they follow
  the arm, not the cloth), emit `body.<look>.pauldron`. Plate only.
- `main`: loop `for look in BODY_LOOKS: generated.add(build_coat(...).name)`;
  add plate pauldrons. Keep `body.ranger.pauldron` from the pack.
- Rebuild: `blender 5.2 --background --factory-startup --python tools/build_wardrobe.py`.
- Verify: ranger coat vertex/UV bytes unchanged vs `git` baseline (diff the
  exported accessor for `body.ranger.coat`); new meshes present.

### 2. Pin the new geometry
`apps/web/src/render/rig.test.ts`:
- Parameterize the single-chain-bind test (`:384`) over ALL `body.*.coat` looks,
  not just ranger — the collision guard must hold for every coat.
- Add the new part names to whatever name-completeness the wardrobe test asserts.

### 3. Wire look-per-base into the runtime
`apps/web/src/render/rig.ts`:
- Add `BODY_LOOK_BY_BASE: Record<string,string>` (ironsworn_plate→plate,
  stalker_leathers→leather, emberbound_robe/emberweave_robe→robe), fallback
  `EQUIPPED.body` ("ranger").
- `looksForEquipment` resolves body look by base BEFORE appending `#baseId`
  texture. Result stays `<look>#<baseId>`; `meshLook` still strips to the look.
- Update `rig.test.ts:257-265`: geared body look is now base-dependent
  (`emberbound_robe → robe#base.emberbound_robe`); keep the unmapped-base
  fallback assertion (→ ranger). Rarity test (`:247`) stays green.

### 4. Gear textures still land
`GEAR_TEXTURE` already has ironsworn_plate/stalker_leathers/emberbound_robe/
emberweave_robe (`rig.ts:300`). Coat UVs are borrowed from the torso atlas, so
the palette bake still samples correctly on the new geometry — confirm in-game
(no white/stretched panels). No `build_gear_textures.py` change expected;
re-verify `rig.test.ts` gear-texture suite (`:274`) stays green.

### 5. Robe: extend the skirt span (separate, review-gated)
- Set `SKIRT_HEM_Z = min hem across BODY_LOOKS` (robe's ~0.05). Rebuild chains.
- Every coat (ranger included) re-weights to the longer chains — ranger is NO
  LONGER byte-identical after this task; re-baseline its pins.
- `rig.test.ts:366` (segment-length) and `:353` (joint count) re-derive from the
  new span; confirm <1% spread still holds at the longer length.
- This is the task most likely to reopen the collision gap (`:384`); the owner
  measures depth-through-coat on a captured run per `CLAUDE.md`'s skirt guidance.

### 6. Verify
- `preview_wardrobe.py --view game` against a **clip** (not bind pose) for each
  look; contact sheet.
- In-game, all sides (memory: verify-3d-in-game-from-all-sides): equip each class
  starter, confirm distinct silhouettes, no animation restart on swap, no clip.
- `npx vitest run` + `npm run typecheck`.

## Risk gate
Tasks 1 and 5 touch skinning/cloth invariants → independent `opus48-risk-reviewer`
pass on the diff after each, per the repo risk gate. Task 5 especially: the skirt
span change is cross-cutting (every coat re-weights).

## Deferred
- Helmet/gloves/boots silhouettes (next plan, same pattern).
- Per-rarity accent geometry (now unblocked: `rig.ts:247` note — once looks carry
  geometry, a rare can add a trim mesh without recolouring the whole silhouette).
