# Character sources

## Universal Base Characters (Quaternius)

- Origin: https://quaternius.com/packs/universalbasecharacters.html
- Tier: Standard, the free release. The paid Source tier adds more bodies,
  rigged `.blend` files and engine projects; nothing here depends on it.
- Licence: CC0 1.0 Universal, public domain dedication. No attribution required.

Two bodies, one bone vocabulary. The male and female skeletons name all 65
joints identically but sit at different rest poses - her head is 30 mm lower and
her hands 111 mm closer in - so each body keeps its own armature and one clip
library drives both through the shared names.

Files taken from the pack, all from its glTF (Godot - Unreal Engine) variants:

| File | Pack path |
|---|---|
| `Base_Male.gltf` / `.bin` | `Base Characters/Godot - UE/Superhero_Male_FullBody` |
| `Superhero_Female_FullBody.gltf` / `.bin` | `Base Characters/Godot - UE/` |
| `Hair_SimpleParted.gltf` / `.bin` | `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/` |
| `Hair_Buns.gltf` / `.bin` | `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/` |
| `T_Superhero_Male_*` | `Base Characters/Godot - UE/` (`T_Superhero_Male_Dark.png` -> `..._Dark_BaseColor.png`) |
| `T_Superhero_Female_*` | `Base Characters/Textures/` |
| `T_Hair_1_*`, `T_Hair_2_*` | `Hairstyles/Textures/` |
| `T_Eye_Brown.png`, `T_Eye_Normal.png` | `Base Characters/Textures/` |

Each body's glTF already carries its body, eyes and eyebrows; only hair is a
separate file. Every file in the pack also ships a 42-vertex materialless
`Icosphere` helper, which `tools/build_wardrobe.py` discards.

Edits made on import:

- Textures are downscaled to the repository's convention - 512 px base colour,
  256 px normal and roughness - from the pack's 2048 px masters.
- `Superhero_Female_FullBody.gltf` shipped pointing at `T_Eye_Normal_png.png`,
  a filename the pack does not contain. It is repointed at `T_Eye_Normal.png`.

**Each body wears its own pack's atlas and no other.** The male was briefly
wired to `T_Regular_Male_*` from the Modular Character Outfits pack, on the
belief that both Quaternius males share one unwrap. They do not. Nine tenths of
the body looked correct, and the tenth painted the underwear down an inner
thigh, across the left foot and into the trapezius - a fault the JSON tests
cannot see, because the asset, the bones and the fetch are all fine. Judge a
texture swap by rendering it: `tools/preview_wardrobe.py`.

The hair atlases are greyscale masks, not coloured art. Untinted they render
bone white, so `HAIR_TINT` in the builder multiplies them; the female's eyebrows
sample the same mask and take the same tint, while the male's are painted into
his body atlas and are left alone.

## Plate suit (`chest.plate.cuirass`)

Locally generated (TRELLIS.2), stripped of fourteen sliver shells by
`tools/prep_plate_suit.py` into `assets/props/source/trellis_local/plate-suit-15k-v1.glb`
(14 847 tris, 3 shells): cuirass, layered pauldrons, half sleeves, belt and a
short fauld in one piece, worn over the leather trousers. It replaced the
separate `chest.plate.tassets` skirt, whose donor and fitter are parked.

The suit is worn as `plate-suit-15k-v6.glb`, a fresh generation off a dead-front
reference: 14 860 tris, one mesh, one material, and ONE vertex-connected island,
where v5 is two. It carries real value range, edge wear and a steel-versus-
leather separation v5 never had. `review/3d/plate-suit/README.md` records how it
was made and is the authority on that pipeline. It cost `PLATE_WIDTH_FROM`
1.06 -> 0.98: at 1.06 its median skin-to-steel gap is 49.81 mm against a 40 mm
limit and the fitter rejected it outright.

Its SHOULDER is worse than v5's. From a side camera the deltoid is a stack of
ragged thin lames with holes that show skin behind them, and rendering the
cuirass with both caps hidden reproduces it, so it is the donor's own geometry
and no rigging change reaches it. v5's shoulder is one clean dome. A v7 aimed at
the shoulder is the standing plan; `review/plate-v6/side-v5.png` against
`side-fixed-v6.png` is the comparison that decided it.

v5 is `plate-suit-15k-v5.glb`, v3 with one shell deleted. v3 kept
a 1 067-triangle shell floating over the LEFT shoulder with no counterpart on the
right, and `split_arm_plates` cut it apart: 998 triangles into the cap, rigid on
`upperarm_l`, and a 540- and a 40-triangle fragment into the cuirass, deforming
with the spine. The pieces swung apart on every pose and tore through the real
cap, which is the black wreckage the left shoulder showed in `?viewer`.
`repair_donor.py --keep-largest` cannot remove it, because the junk shell is
larger than the fauld it would have to keep.

Deleting it did NOT close the seam between the cap and the cuirass - it widened
it, because the stray shell had been covering part of the hole. That seam is
still open and is steel to steel, not skin.

`plate-suit-15k-v4.glb` is a denser decode of the same suit (17 723 tris,
1 416 of them the same stray shoulder shell) that nothing has ever worn. v5
skips it rather than rebasing on it, so what ships stays the shell that was
measured.

v3 is v1 run through `tools/repair_donor.py`. The decode came back UNWELDED - 24 016 vertices over
7 917 positions, so every triangle was its own island and the shell carried
4 327 boundary loops. Most were pinholes five or six edges around, invisible in
a thumbnail and a puncture you could see the void through on the pauldron at
play distance. Welded at 0.1 mm and filled to twelve edges it is 186 loops and
15 362 tris, and the 113 openings a suit is supposed to have are untouched.

**Never recalculate normals over the whole shell to close a decoded surface.**
A recalc re-orients every face from one seed; on this suit it flipped half of
them and the breastplate rendered as black shards with skin between. Only the
new caps get their winding decided, each against the ring it closes.

The suit worn today is `plate-suit-20k-v10.glb`: v9's reference edited through
`/codex-imagegen` so each pauldron is ONE smooth dome instead of 3-4 stacked
lames, padded to v9's 88% frame fill, decoded by local TRELLIS (`--res 512`,
seed 42, 142 860 tris) and optimised to 19 997 tris with a 512 px texture. v9's
lames decoded as torn, concentric shells, so its sleeve cut left 4 ragged rim
loops per armhole; v10's cut leaves 2-3. v9 stays on disk as the rollback.
It is CLEANED in the build
rather than by a repaired copy on disk (`"clean": True` in `RIGID_GEAR`): welded
at 0.5 mm, every boundary loop fanned shut (233 of them, the largest a 36 mm
crack at an ankle - the decode is a solid figure with an inner and an outer
skin 7 mm apart, so it has no intended openings), cut on planes with a bisect
instead of by vertex deletion, given a 6 mm lip along the collar and pauldron
rims, and shaded smooth with edges past 48 degrees kept sharp. Its stored
normals sat a median 26 degrees off the welded surface, and its windings are
random face by face, so each face is turned to look away from the nearest
point of the body - a whole-shell recalc flips at every join between the two
skins. The build reports it under `chest.plate.cuirass` in `gear-fit.json`.

## Fauld and tassets (parked, `SKIRT_PARKED`)

Built procedurally by `tools/prep_tassets.py` (no scan: TRELLIS decodes a plate
skirt into loose flakes). Texture is BlenderKit material
`8352b3b2-edb7-4700-a9d6-055ab6ec9233` "Aged Black Steel" (royalty free, 1K),
baked into the donor `assets/props/source/trellis_local/fauld-proc-v2.glb`.

## Gorget plate (`chest.plate.gorget`)

No donor mesh: the v9 suit carries no steel over the trapezius, so `build_gorget`
in `tools/build_wardrobe.py` duplicates the male body's `collar` region (the
piece `split_body_regions` cuts on the clavicles) and offsets it 5 mm along its
vertex normals, capped by the air measured to the worn cuirass. It carries the
body's own weights, so the `collar` piece is hidden under a plate that deforms
exactly as it would. Texture is BlenderKit material
`8352b3b2-edb7-4700-a9d6-055ab6ec9233` "Aged Black Steel" (royalty free, 1K),
kept at `assets/props/source/mat-aged-black-steel.blend`, relinked into a
smart-projected UV set at 2 tiles with its albedo lifted 1.6x toward the
cuirass grey.

## Trousers (`chest.plate.legs`)

No donor mesh: `build_trousers` in `tools/build_wardrobe.py` duplicates the male
body's own leg surface and offsets it 4 mm along its vertex normals, so it
carries the body's weights and cannot clip. Texture is BlenderKit material
`d583c044-b586-4ecf-b3a1-12de1d032b3f` "Aged Dark Leather" (royalty free, 1K,
by KID), kept at `assets/props/source/mat-aged-dark-leather.blend` and relinked
into a smart-projected UV set at 3.5 tiles.

## Class hoods (`helmet.stalker.hood`, `helmet.ember.cowl`)

Both start from `Male_Ranger_Head_Hood` in Quaternius' **Modular Character Outfits -
Fantasy** (free Standard version, CC0 1.0, https://quaternius.com/packs/modularcharacteroutfitsfantasy.html,
itch.io `quaternius/modular-character-outfits-fantasy`), kept as glTF + bin in
`assets/props/source/quaternius-fantasy/` with the pack's licence text. It is built
for the Universal Base Characters body and skinned to the same skeleton, so its
crown keeps the pack's own weights. `tools/prep_hood.py` keeps its outer shell, cuts
off the lidded neck, pushes the neck band over the class's collar, runs the cut ring
on into a capelet draped over the fitted `chest.stalker.coat` / `chest.ember.robe`
(closed across the throat), and solidifies the whole piece 4 mm for a lining and hem.
Below the jaw the weights are the coat's, robe's or neck skin's under it. Texture:
stalker the BlenderKit "Aged Dark Leather" (`d583c044-b586-4ecf-b3a1-12de1d032b3f`),
ember the BlenderKit "Wool fabric" (`d5ca8a6b-dd40-4f0c-a5c7-e030af0912c5`), both
levelled to grey, box-projected at 512 px and tinted by vertex colour (shell, lining,
hem). Outputs `hood-stalker-v2.glb`, `hood-ember-v2.glb`.

`prep_hood.py -- female` builds the same two hoods over her wardrobe, into
`hood-stalker-v2-female.glb` and `hood-ember-v2-female.glb`. The pack ships a male
hood only, so `retarget` carries it from the pack's rest onto hers through its own
weights (each vertex moves as its bones move between the two rests) before the cut
and drape run unchanged. Her collar is chest-sized against her neck, so the gorget
ring is held to `SUIT_GORGET_RING_MIN` (0.13 m) in `build_wardrobe.py`; at 2.2 neck
radii it missed her collar and left a horn standing over the hood cut.

## Held weapons (`weapon1.ironswornhammer.mesh`, `weapon1.stalkerbow.mesh`, `weapon1.broadsword.mesh`)

The donors are built by `tools/prep_held_weapons.py` into
`assets/props/source/trellis_local/` (`hammer-3000-v1.glb`, `bow-3000-v1.glb`), each one
mesh and one material with its colour and metal/roughness baked into a 512 atlas, and
fitted by `fit_held` in `tools/build_wardrobe.py` (grip at the donor's origin, aimed and
rolled in the idle clip's fist).

- Hammer: BlenderKit "War Hammer" (`87df6fbd-71db-4acb-a3f5-ff32f16938b7`, royalty free,
  by Avishka Induwara), kept at `assets/props/source/war_hammer.blend`. A two-handed maul
  as shipped; the head is shrunk to 0.36 about the haft's mouth and the haft thinned to
  0.8, and the head's 6% black metal is re-lit as iron off its own grunge map.
- Bow: no donor mesh. Neither free BlenderKit bow was a plain hunting bow (the
  "Stylized hand-painted bone bow" carries its spikes in the limb surface, the "Elvan
  Bow" is horns and crystals), so the stave is swept off a braced-bow centreline. Wood is
  BlenderKit material "Wood Grain" (`8903140f-d18e-4536-a2f6-19e8d329e83e`, CC0, by
  PBRPX, `assets/props/source/mat-wood-grain.blend`), the grip wrap the "Aged Dark
  Leather" above.
- Sword (`weapon1.broadsword.mesh`, `sword-3000-v1.glb`): BlenderKit "Stylized Sword"
  (`bd139cc8-a102-4e1f-ade9-0d155cdafc8d`, royalty free, by Sebastian Villanueva), kept at
  `assets/props/source/stylized_sword.blend`. Its twisted grip is thinned to 0.45 and
  lengthened 1.3 to take a fist, the pommel thinned to 0.6; it keeps its own UV and its
  1K colour, metallic and roughness are baked to the 512 atlas.

## Back quiver (`weapon2.quiver.mesh`)

No donor mesh: BlenderKit has no free quiver (searched "quiver", "quiver arrows", "arrow",
"archery" on 2026-11-06; every quiver hit is the quiver tree). The donor
`assets/props/source/trellis_local/quiver-3000-v1.glb` (1148 tris, one mesh, one material,
512 colour + metal/roughness atlas) is built headless with the `prep_held_weapons.py`
helpers: a leather tube lathed off a profile with a band at the mouth and the foot, a strap
down the side that lies on the wearer, and eight fletched arrows standing out of the mouth.
Leather is the BlenderKit "Aged Dark Leather" above (`d583c044-b586-4ecf-b3a1-12de1d032b3f`,
royalty free), the shafts the "Wood Grain" above (`8903140f-d18e-4536-a2f6-19e8d329e83e`,
CC0, PBRPX); the feathers and nocks are flat colours. Fitted by `fit_back_quiver` in
`tools/build_wardrobe.py`: rigid on `spine_03`, foot over the left kidney level with
`spine_02`, mouth behind the right shoulder, cleared against every chest and helmet in both
the rest pose and the idle clip.

## Maren's look (`chest.maren.*`, `helmet.maren.*`)

Her own look, on the female body only (`"bodies": ("female",)` in `RIGID_GEAR`):
no item base maps to it, so the male wardrobe does not carry it. The gown and
the head are local TRELLIS.2 decodes (`--res 512`, seed 42, about two minutes
each) of references made with `/codex-imagegen` from her concept; the lace is a
BlenderKit material; the hair is grown in the build with no donor. Job folder
`review/3d/maren-zana/` (gitignored, BM-PC only): references, prep scripts and
the completion ledger. Every Maren material is dulled to a tenth of a
dielectric's specular (`MAREN_SPECULAR`, `KHR_materials_specular` 0.1): at full
strength the hideout's fires wash her black gown grey-brown and her hair pale.

- `maren-dress-v3.glb`: a sleeveless dress with a two-tier caped collar and an
  overskirt split in front, decoded from the ghost-mannequin reference
  `review/3d/maren-zana/maren-garment-reference-v1.png` and decimated to 36k
  (fidelity p99 0.0014, normal p5 0.912; 30k failed). The decode's skirt was
  several thin closed slabs with creases, which the leg clearance pushed through
  each other as facets and a slit, so `prep_dress_v3.py` rebuilds everything
  under the waist from its OUTERMOST surface (overskirt, dress panel and the
  curtains at the split, zipped to the bodice at the waist), 15 071 triangles.
  TRELLIS's atlas lost the print, so it is re-textured by projection:
  `retex_unwrap.py` (smart UV), `retex_bake.py` (front, back and +x side
  references registered per image row, weighted by normal^4, faces seen only at
  a grazing angle filled from their neighbours, metal buttons off the front
  placket) and `retex_apply.py`, a 2048 base and ORM. Those scripts and the
  references live in the gitignored job folder on BM-PC only. Fitted by
  `fit_soft_suit` seated on her waist, its +x half mirrored. Her boots are the
  Stalker's knee boots, shaded black on her own material clones (`meshes.ts`).
  The map's median luma was 0.154 against the concept's 0.10-0.12, so the base
  colour is raised to the power 1.5 (`"tone"`). `clear_shoulders` stands the
  capelet 4 mm off the lace round each upper arm and `blur_shoulder_weights`
  blurs its weights over 30 mm there: the tiers lay closer than the lace and
  folded where the arm drops from the T-pose.
- `chest.maren.lace` and `chest.maren.cuffs` (`build_lace`): her own arm and leg
  regions pushed 2 mm off the skin with cylindrical UVs, alpha-blended and
  single-sided, plus opaque grey cuffs over the last 25 mm before each wrist.
  The lace is BlenderKit "Elegant Black Floral Lace Embroidery"
  (`ae5d9a16-d846-4def-a1a2-a2cbe92bc8c2`, royalty free, 1K), kept as
  `assets/props/source/mat-black-floral-lace.blend`; it ships no opacity map, so
  alpha is taken from its height map (`LACE_ALPHA` 0.65 net, 0.97 motif).
- `maren-head-v1.glb` -> `helmet.maren.face` (`build_face`): her own head, face,
  ears and neck in one piece, so the pack's head, eyes, brows and neck are
  hidden while she wears it (`COVERED_BY_LOOK` in `render/rig.ts`). Decoded from
  a bald bust reference of her concept. The decode is opened as a WHOLE bust
  (`tools/open_volume.py --res 384 --radius 1`) and cropped afterwards with
  caps: cropped first, the opening's flood fill entered through the cuts and
  left a hollow double-walled shell. Rebuilt at 12 000 triangles (fidelity p99
  0.00040, normal p5 0.984), no normal map. TRELLIS's own texture was washed
  out, so the atlas (repacked, coverage 0.60) is the front reference projected
  with one smoothed scale and offset per image row, and the decode's
  gain-matched albedo wherever the reference does not see. `build_face` scales
  it crown to chin onto the pack's head (0.3646 m per donor unit), collapses
  the folded slivers the decimation left (one was a white fleck on her forehead
  under the game's sun), pushes her skull just inside the pack's where hair
  grows so the scalp cap covers it, eases her neck onto the pack's under the
  collar, both smoothed over the mesh, and skins it by transfer over
  `FACE_BONES`. The base colour is taken down to 0.45 linear (`FACE_GAIN`): the
  reference was drawn lit and burnt out to white in the hideout. Her drawn
  hands, arms and legs are tinted to match on material clones
  (`CARTOGRAPHER_SKIN`, `render/meshes.ts`).
- `helmet.maren.tresses` and `helmet.maren.scalp` (`build_hair`): strand cards in
  three layers over an opaque cap cut from the pack's own scalp, one guide
  strand per card combed from a side part, hung under gravity against her
  body, gown, collar and face, waved per lock, alpha-tested at 0.3 and
  two-sided. A procedural 1024 atlas, colours measured off the concept. The cap
  is cut off the pack's ears (`bare_ears`), which are not drawn under her own
  head. Skinned by transfer over `HAIR_BONES`, head-rigid above the jaw.
