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

## Patch plate

`patch_master_v1.png` is the second floor plate that `apps/web/src/render/ground-patch.ts`
blends over the floor in world-space blobs. BlenderKit material Muddy Ground with wet moss (`9df9a31b-4635-4c5f-919b-b704baae0f43`) by
Mohid Tahir, royalty_free, Base Color at 1K, taken out the same way as the wall plate:

```
python tools/fetch_blenderkit.py 9df9a31b-4635-4c5f-919b-b704baae0f43 --asset-type material --type resolution_1K --out <scratch>/swamp-patch.blend
```
