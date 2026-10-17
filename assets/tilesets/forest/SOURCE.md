# Forest wall plate

`wall_master_v1.png` is a BlenderKit material, not generated art: the generated
masonry plate read as a brick wall on the faceted cliff mesh.

| master | asset | author | licence |
|---|---|---|---|
| `wall_master_v1.png` | Mossy Rock Surface (`88dc10ee-09fd-4aa1-983e-9b5d56694d11`) | Vaishakh Vinod | royalty_free |

The source `.blend` is not committed. Reproduce it with:

```
python tools/fetch_blenderkit.py 88dc10ee-09fd-4aa1-983e-9b5d56694d11 --asset-type material --type resolution_2K --out <scratch>/forest.blend
```

The Base Color image comes out by following the material's Principled BSDF Base
Color link to its image node in headless Blender, downscaled to 1536². It is
lifted to the wall luma floor. Then: `python tools/build_tileset_textures.py`.

## Patch plate

`patch_master_v1.png` is the second floor plate that `apps/web/src/render/ground-patch.ts`
blends over the floor in world-space blobs. BlenderKit material Forest Ground Leaves (`6a332738-5a26-479e-9750-79bbd8c1ef39`) by
RADHUNANDAN, royalty_free, Base Color at 1K, taken out the same way as the wall plate:

```
python tools/fetch_blenderkit.py 6a332738-5a26-479e-9750-79bbd8c1ef39 --asset-type material --type resolution_1K --out <scratch>/forest-patch.blend
```
