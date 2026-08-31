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

## Fauld and tassets (parked, `SKIRT_PARKED`)

Built procedurally by `tools/prep_tassets.py` (no scan: TRELLIS decodes a plate
skirt into loose flakes). Texture is BlenderKit material
`8352b3b2-edb7-4700-a9d6-055ab6ec9233` "Aged Black Steel" (royalty free, 1K),
baked into the donor `assets/props/source/trellis_local/fauld-proc-v2.glb`.

## Trousers (`chest.plate.legs`)

No donor mesh: `build_trousers` in `tools/build_wardrobe.py` duplicates the male
body's own leg surface and offsets it 4 mm along its vertex normals, so it
carries the body's weights and cannot clip. Texture is BlenderKit material
`d583c044-b586-4ecf-b3a1-12de1d032b3f` "Aged Dark Leather" (royalty free, 1K,
by KID), kept at `assets/props/source/mat-aged-dark-leather.blend` and relinked
into a smart-projected UV set at 3.5 tiles.
