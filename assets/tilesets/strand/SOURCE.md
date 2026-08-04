# Strand plates

Both masters are BlenderKit materials, not generated art: they tile by
construction and carry real photogrammetry, which is why the seam pass barely
moves them (wrap difference is already at the plate's own noise floor).

The source `.blend` files run from 23MB to 268MB, so they are NOT committed.
They are reproducible by asset id, which is the whole point of recording them
here (`--type resolution_2K` is the small variant, and 2K is already twice the
shipped size):

```
python tools/fetch_blenderkit.py 7ad809a6-c5d1-4743-94cc-a9c10d3db075 --out sand.blend
python tools/fetch_blenderkit.py eabd2e31-e17a-41df-954d-dbb9e6351ea8 --type resolution_2K --out rock.blend
```

| master | asset | author | licence | source map |
|---|---|---|---|---|
| `floor_master_v1.png` | Sand Beach | Julio Sillet | cc_zero | `Sand Beach_baseColor.png` 2048² |
| `wall_master_v1.png` | Coastal Rock | EB Adventure Photoscans | **royalty_free** | `Coastalrock2_diffuseOriginal.bmp` 2048² |

The wall is the one non-CC0 plate here and it is a deliberate trade: every
cc_zero coastal rock on BlenderKit is either featureless granite (`1b24c468`,
"Seaside Rock", a countertop even at native 8K) or a top-down ground scan in
brown and moss (`be834a53`, "Coast Land Rocks 01"), and neither reads as a sea
cliff at the game camera. The cc_zero fallback, if the licence has to change,
is `1b24c468-7d57-4f3b-84cc-7c7a81805e1a`.

The base-colour image is packed inside the `.blend`; it comes out by walking the
material's Principled BSDF Base Color link back to its image node in headless
Blender, then downscaling to 1536² (above the 1024 ship size with room for the
seam pass's 12% crop, and in line with every other biome's master weight).

Then: `python tools/build_tileset_textures.py`.
