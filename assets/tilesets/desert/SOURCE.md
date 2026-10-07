# Desert wall plate

`wall_master_v1.png` is a BlenderKit material, not generated art: the generated
masonry plate read as a brick wall on the faceted cliff mesh.

| master | asset | author | licence |
|---|---|---|---|
| `wall_master_v1.png` | Sandstone rock (`0ad23a8f-a17c-44f3-8108-fcb44fe71f57`) | Nikhil G krishnan | royalty_free |

The source `.blend` is not committed. Reproduce it with:

```
python tools/fetch_blenderkit.py 0ad23a8f-a17c-44f3-8108-fcb44fe71f57 --asset-type material --type resolution_2K --out <scratch>/desert.blend
```

The Base Color image comes out by following the material's Principled BSDF Base
Color link to its image node in headless Blender, downscaled to 1536². It is
graded toward the sand (WALL_GRADE in tools/build_tileset_textures.py). Then: `python tools/build_tileset_textures.py`.
