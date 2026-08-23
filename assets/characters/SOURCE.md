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

## Fauld and tassets (`chest.plate.tassets`)

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
