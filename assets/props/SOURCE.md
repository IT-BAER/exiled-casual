# Ground dressing sources

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

## Forest, swamp and vaal stone sets

Free BlenderKit assets, appended and re-dressed by `tools/build_props.py`
(fetched as `--type resolution_0_5K`).

| prop | source file | asset | author | licence |
|---|---|---|---|---|
| `forestTree`, `bush` | `source/stylized_tree_01.blend` | Stylized Tree 01 (`8778f12b-f199-4af6-8db1-4591480e8d56`) | Phixer Art | royalty_free |
| `forestTree2` | `source/stylized_tree_03.blend` | Stylized Tree 03 (`7f3ced73-f0f0-4773-804e-86866734ffba`) | Phixer Art | royalty_free |
| `stump` | `source/stump_scan.blend` | Stump (`be20abbb-0a8b-48a3-9f2c-d23234a1c571`) | REAL SCANS | royalty_free |
| `mossLog` | `source/large_log.blend` | Large Log (`4de77d24-c88c-4624-9060-250600381406`) | Joshua Whitney | cc_zero |
| `mossRock` | `source/mossy_rock.blend` | Mossy Rock (`805b93a2-72d1-4f27-bcc9-fd241fd2d161`) | Occams Render | royalty_free |
| `toadstools` cap texture | `source/toadstool.blend` | Toadstool (`39c47348-9078-402d-adfa-adf2a999aa72`) | Joachim Bornemann | cc_zero |
| `swampTree` | `source/stylized_dead_tree.blend` | Stylized Dead Tree (as `deadTree`), wet bark and moss tint | Mr. Naseriyan | royalty_free |
| `reeds` | `source/high_grass_clump.blend` | High grass clump (`973a530c-c5bc-4035-80ab-89cf35a83562`) | Slinc_HD Janzen | cc_zero |
| `vaalColumn` | `source/carved_temple_column.blend` | Carved Temple Column (`e4ba1969-8d89-41ba-97b8-835572b0dcd3`) | Brave Heart | royalty_free |
| `vaalIdol` | `source/mesoamerican_statuette.blend` | Mesoamerican Statuette (`7128457e-1a12-416b-ac55-7911db779c35`) | Lucas Vasseur | royalty_free |
| `vaalBlock` | `source/square_stone_block.blend` | Square Shaped Stone Block (`e2d19b20-7f9b-4f0b-999e-b8618139bc9a`) | Dennis Hafemann | royalty_free |
| `vaalUrn` | `source/ancient_stone_bowl.blend` | Ancient Stone Bowl (`0b8e71e5-bfe8-4809-b44a-1f8264db398c`) | REAL SCANS | royalty_free |
| `vaalRuinWall` | `source/broken_stone_wall.blend` | Broken Stone Wall (as `ruinWall`) | Dennis Hafemann | royalty_free |

The stylized crowns are not shipped as leaf cards (they mipped into flat discs at
the game camera): each card cloud is clustered into 6-12 lobes, voxel-remeshed
into one solid crown, AO-baked into COLOR_0 and box-mapped with an opaque leaf
grain painted from the source's leaf mask (`forest_leaves`); `bush` is tree 01's
crown on the ground. The toadstools are
turned in the script and wear only the scan's cap photograph (cut to a few
hundred triangles the scan fell apart). No free reed or cattail model exists on
BlenderKit (searched "reeds", "reed grass", "cattail", "bulrush"), so `reeds` is
the grass clump stretched up, coloured green to tan up each blade in COLOR_0. The log wears tree 01's bark as a
palette (its own lichen is lilac); the vaal set wears
`apps/web/public/textures/tilesets/vaal_stone/wall_color.jpg` as a palette,
except the bowl, which keeps its paint.
