# Vaal Stone plates

## Patch plate

`patch_master_v1.png` is the second floor plate that `apps/web/src/render/ground-patch.ts`
blends over the floor in world-space blobs. BlenderKit material Ground Moss Dirt (`3fd4d532-bceb-46d5-99bd-94dc5db72752`) by
Nikhil G krishnan, royalty_free, Base Color at 1K, taken out the same way as the wall plate:

```
python tools/fetch_blenderkit.py 3fd4d532-bceb-46d5-99bd-94dc5db72752 --asset-type material --type resolution_1K --out <scratch>/vaal_stone-patch.blend
```
