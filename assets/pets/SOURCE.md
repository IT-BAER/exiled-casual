# Pet sources

The companion cat in `pet.glb` (`pet.cat.v1`), built by `tools/build_pet.py` and
served by `node tools/pack_pet.mjs`. Look and motion reference: PoE1's Celestial Cat
Pet, watched frame by frame in the official video (`https://www.youtube.com/watch?v=w-kx0zWsykM`),
a PoE1 showcase (`https://www.youtube.com/watch?v=cFi5bzlkpi4`, the hover and the
playtime loop on the bridge, 34-100 s) and a PoE2 hub clip
(`https://www.youtube.com/watch?v=03eL8TS3p10`): a black cat that gallops in the air
beside the player, hovers at his hip with its legs hanging loose, and when he stands
lies down, rolls, curls in a ring, stretches, rears up against him, springs over his
head, swims in the air and dives back down. White point stars dense on the head and
back, electric-blue veins on chest and legs, cyan half-moon eyes, a violet rim glow and
nebula. The shape is a real cat; the coat, veins, eyes and the ten clips are authored
by the build.

| part | source file | asset | author | licence |
|---|---|---|---|---|
| body, eyes, rig | `source/domestic_cat_1k.blend` | Domestic cat (rigged) (`6b3bbcc7-db99-4424-9436-8e6678ee9354`) | Paweł Wałasiewicz | royalty_free |
| stars, veins, eye slits | painted by `build_pet.py` (numpy, seeded) | - | - | ours |
| unused | `source/starfield_v1.png` | generated, `/codex-imagegen` (gpt-6.1-sol), 25 October 2026; replaced by the painted stars | - | ours |
| unused backup | `source/lowpoly_cat.glb` | Cat (`3b8e6df1-3478-4150-9df8-0f5a2bf0476f`), rigify, no UVs | ali alipour | royalty_free |

Reproduce the cat with:

```
python tools/fetch_blenderkit.py 6b3bbcc7-db99-4424-9436-8e6678ee9354 --type resolution_1K --out assets/pets/source/domestic_cat_1k.blend
```

The build strips the hair particles, the subsurf and the IK posing rig, decimates
the body to 9k triangles and the eyes to 1.2k, renames the numbered spine bones
(`chest`, `neck`, `head`, `root`), hangs the fore legs on the chest, re-rigs and
lengthens the tail, and authors the ten clips itself (hover, gallop, lie_side,
roll_back, curl, stretch, rear_up, spring, swim, dive): the source ships a pose
library only.
