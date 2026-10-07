# Swamp wall plate

`wall_master_v1.png` is a BlenderKit material, not generated art: the generated
masonry plate read as a brick wall on the faceted cliff mesh.

| master | asset | author | licence |
|---|---|---|---|
| `wall_master_v1.png` | Wet rock (`3de154c5-3191-4d54-9565-139e31a17a3b`) | Mat Karmon | royalty_free |

The source `.blend` is not committed. Reproduce it with:

```
python tools/fetch_blenderkit.py 3de154c5-3191-4d54-9565-139e31a17a3b --asset-type material --type resolution_2K --out <scratch>/swamp.blend
```

The Base Color image comes out by following the material's Principled BSDF Base
Color link to its image node in headless Blender, downscaled to 1536². It is
lifted to the wall luma floor. Then: `python tools/build_tileset_textures.py`.
