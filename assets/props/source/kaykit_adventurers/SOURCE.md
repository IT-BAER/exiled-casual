# KayKit Adventurers 2.0 (FREE) — the character wardrobe

Downloaded 2026-08-16 with `python tools/fetch_itch.py kaylousberg kaykit-adventurers`.

- Source: https://kaylousberg.itch.io/kaykit-adventurers
- Author: Kay Lousberg
- Licence: **CC0 1.0 Universal** (public domain dedication). Free for commercial
  use, no attribution required. See `KayKit_Adventurers_2.0_FREE/License.txt`.
- Everything in this directory is the FREE tier. The paid EXTRA tier adds three
  more characters and alternate textures; nothing here depends on it.

## What the repo uses

`tools/build_wardrobe.py` reads `Characters/gltf/*.glb` and `Assets/gltf/*.gltf`
and emits `apps/web/public/models/wardrobe.glb`.

Six characters (Knight, Barbarian, Mage, Ranger, Rogue, Rogue Hooded), each
already split into `Head`, `Body`, `ArmLeft`, `ArmRight`, `LegLeft`, `LegRight`
plus its own cape and headgear, all on one 23-joint `Rig_Medium` skeleton with
`handslot.l` / `handslot.r` bones for held gear. 5.8k-8.9k tris per character,
one 1K atlas each.

Plus ~30 weapons, shields and props in `Assets/`, authored at the origin in the
hand slot's own frame.

## Animation

`../kaykit_animations_char/` is the separate free **KayKit Character Animations
1.1** pack (https://kaylousberg.itch.io/kaykit-animations, also CC0), 139 clips
on the same `Rig_Medium` skeleton. `tools/build_anim_library.py` ships six of
them as `apps/web/public/models/anim-library.glb`.

## Why this replaced the previous packs

The old wardrobe was cut out of two whole authored outfits in
`assets/characters/` (Quaternius Modular Character Outfits, free tier) that
welded sleeves to forearms and shipped no head. Those two outfits are all the
free tier contains - the advertised "12 outfits, 62 parts" is the $20 Source
tier - so every extra slot had to be generated in Blender. KayKit ships six
outfits already cut into slots for nothing.

`assets/props/source/quaternius_outfits/` and `quaternius_base/` are downloaded
here for the comparison and are not read by any build.
