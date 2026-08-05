# Coast plates

(The biome the Atlas calls the Coast; PoE's own screenshots of it are filed
under `strand-*` and `beach-*` in `reference-screenshots/`, which is why those
names appear below.)

Both masters are BlenderKit materials, not generated art: they tile by
construction and carry real photogrammetry, which is why the seam pass barely
moves them (wrap difference is already at the plate's own noise floor).

The source `.blend` files run from 23MB to 268MB, so they are NOT committed.
They are reproducible by asset id, which is the whole point of recording them
here (`--type resolution_2K` is the small variant, and 2K is already twice the
shipped size):

```
python tools/fetch_blenderkit.py 7ad809a6-c5d1-4743-94cc-a9c10d3db075 --out sand.blend
python tools/fetch_blenderkit.py be834a53-dbc6-40d0-897e-8787b2dbe366 \
    --asset-type material --type resolution_2K \
    --out assets/tilesets/coast/source/coast_land_rocks.blend
```

| master | asset | author | licence | source map |
|---|---|---|---|---|
| `floor_master_v1.png` | Sand Beach | Julio Sillet | cc_zero | `Sand Beach_baseColor.png` 2048² |
| `wall_master_v1.png` | Coast Land Rocks 01 | Poly Haven | cc_zero | `coast_land_rocks_01_diff_8k.png` 2048² |

Both plates are CC0 now, and the wall changed because the BRIEF changed. It used
to be `eabd2e31` "Coastal Rock" (royalty_free), chosen when the boundary was
imagined as a sea cliff — pale grey-green granite, which is exactly what came off
the screen and exactly what he rejected ("not fitting to a strand"). The four
Strand and Beach references say the boundary is a low ROCK LEDGE almost entirely
under khaki-olive scrub, so the plate that was rejected for this tileset as "a
top-down ground scan in brown and moss" is the one the reference actually has.
Brown and moss is the answer; it was the question that was wrong.

`floor_master_v1.png` is graded warm at build time (`FLOOR_GRADE` in
`tools/build_tileset_textures.py`): the scan is a real overcast beach and lands
at saturation 0.17, where PoE's sand measures 0.45 in both gameplay references.

The base-colour image is packed inside the `.blend`; it comes out by walking the
material's Principled BSDF Base Color link back to its image node in headless
Blender, then downscaling to 1536² (above the 1024 ship size with room for the
seam pass's 12% crop, and in line with every other biome's master weight).

Then: `python tools/build_tileset_textures.py`.
