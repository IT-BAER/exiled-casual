# Pet sources

The companion cat in `pet.glb` (`pet.cat.v1`), built by `tools/build_pet.py` and
served by `node tools/pack_pet.mjs`. Look reference: PoE1's Celestial Cat Pet, watched
frame by frame in the official video (`https://www.youtube.com/watch?v=w-kx0zWsykM`),
a PoE1 showcase (`https://www.youtube.com/watch?v=cFi5bzlkpi4`, 34-100 s) and a PoE2
hub clip (`https://www.youtube.com/watch?v=03eL8TS3p10`): a black cat with white point
stars dense on the head and back, electric-blue veins on chest and legs, cyan half-moon
eyes, a violet rim glow and nebula. The shape is a real cat; the coat, veins and eyes
are painted by the build.

Motion: PoE1's own. `node tools/extract_poe_pet.mjs "<Path of Exile>/Bundles2"` reads
`art/models/pet/cat/rig.ast` out of a local PoE install into `source/poe/` (gitignored;
needs `npm i --no-save pathofexile-dat@16.0.1`). The build recreates its four floating
clips on our cat's bones, frame for frame: each bone takes the turn of its PoE
counterpart (spine, neck, head) or lies along PoE's joint-to-joint segment (legs,
tail), and the root carries PoE's pelvis path, height above the ground included.
PoE's pet controller (`metadata/pet/cat/celestial.ao`) plays them as the runtime does:

| ours | PoE clip | length | when |
|---|---|---|---|
| hover | idle_floating | 2.0 s loop | standing |
| gallop | run_floating | 1.2 s loop | travelling |
| relaxed | idle_relaxed_floating | 14.67 s once | idle_relaxed_chance 25 per hover cycle |
| emerge | happy_floating | 3.0 s once | on arrival |

One change, the owner's rule that the cat always floats: where a one-shot takes the
body's middle under the hover's lowest (PoE's relaxed swim skims the floor), it is
lifted that far.

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
lengthens the tail, and moves the spine and leg joints onto the mesh's own (where
two bones' weights blend: the source's float up to 0.17 above the back). The
source ships a pose library only; the clips come from PoE as above.
