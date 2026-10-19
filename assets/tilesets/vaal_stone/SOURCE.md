# Vaal Stone plates

## Wall plate

`wall_master_v1.png` is a BlenderKit material, not generated art: the generated
carved masonry read as a built brick wall on the faceted cliff mesh, the same
read that moved desert, forest and swamp to rock scans.

| master | asset | author | licence |
|---|---|---|---|
| `wall_master_v1.png` | Craggy Grey Rock (`27f79456-45be-4b41-a182-699a6367b740`) | KID | royalty_free |

The source `.blend` is not committed. Reproduce it with:

```
python tools/fetch_blenderkit.py 27f79456-45be-4b41-a182-699a6367b740 --asset-type material --type resolution_2K --out <scratch>/vaal_stone.blend
```

The Base Color image comes out by following the material's Principled BSDF Base
Color link to its image node in headless Blender, downscaled to 1536². At luma 136
it needs no lift. Then: `python tools/build_tileset_textures.py`.

## Patch plate

`patch_master_v1.png` is the second floor plate that `apps/web/src/render/ground-patch.ts`
blends over the floor in world-space blobs. BlenderKit material Ground Moss Dirt (`3fd4d532-bceb-46d5-99bd-94dc5db72752`) by
Nikhil G krishnan, royalty_free, Base Color at 1K, taken out the same way as the wall plate:

```
python tools/fetch_blenderkit.py 3fd4d532-bceb-46d5-99bd-94dc5db72752 --asset-type material --type resolution_1K --out <scratch>/vaal_stone-patch.blend
```
