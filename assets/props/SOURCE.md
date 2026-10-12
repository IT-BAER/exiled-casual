# Desert set sources

The desert dressing props in `props.glb` (`deadTree`, `skull`, `ribcage`,
`ruinWall`, `pot`) are free BlenderKit assets, appended and re-dressed by
`tools/build_props.py`.

| prop | source file | asset | author | licence |
|---|---|---|---|---|
| `deadTree` | `source/stylized_dead_tree.blend` | Stylized Dead Tree (`c48ddfb4-e3f7-46a8-ace5-51aa4bb36474`) | Mr. Naseriyan | royalty_free |
| `skull` | `source/cow_skull.blend` | Cow Skull (`a37f703c-8986-4488-8053-b47422a87175`) | Alexander Handjiev | cc_zero |
| `ribcage` mesh | `source/small_bone_pile_2.blend` | Small Bone Pile 2 (`8e3df5aa-2764-4c3a-b144-267d02b7728e`) | Remnants of Eden Pierre | royalty_free |
| `ribcage` texture | `source/mat-organic-bone.blend` | Organic Bone, material (`d30ab8a2-f57d-4704-89bd-31983517de8a`) | Nikhil G krishnan | royalty_free |
| `ruinWall` | `source/broken_stone_wall.blend` | Broken Stone Wall (`54fdf2fd-ff99-4cc9-8976-89ca9a1c417c`) | Dennis Hafemann | royalty_free |
| `pot` | `source/amphora.blend` | Amphora (`3ba52753-7e43-4d43-b877-0103d580b0ef`) | Nico | royalty_free |

Reproduce a source with:

```
python tools/fetch_blenderkit.py <asset id> --type resolution_1K --out assets/props/source/<file>
```

`small_bone_pile_2` ships only a `blend` file (drop `--type`); the bone material
also needs `--asset-type material`. The ruin wall wears the desert cliff's
sandstone (`apps/web/public/textures/tilesets/desert/wall_color.jpg`) as a
palette, and the dead tree the driftwood's bleached grey.
