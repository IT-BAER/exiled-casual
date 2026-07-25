# Devlog

Screenshots from building Exiled Casual with Claude Code, in order. Each shot is the
visible result of one slice of work. The early days are the sim and character; the later
ones are the HUD and items. Also posted as a running "Day N" series on
[r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1v4nqeh).

For the design behind each step see [`../docs/specs/`](../docs/specs/) and the
implementation plans in [`../docs/plans/`](../docs/plans/).

## 2026-07-20 - a character that moves

The box actor becomes a real rigged humanoid, animated and lit.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-20-rigged-player.jpeg" alt="Rigged player" width="100%"><br><sub><b>Rigged player</b> - a CC0 Quaternius character replaces the primitive box actor.</sub></td>
<td width="33%"><img src="screenshots/2026-07-20-walk-cycle.jpeg" alt="Walk cycle" width="100%"><br><sub><b>Walk cycle</b> - animation clips from the Universal Animation Library retargeted onto the rig by bone name.</sub></td>
<td width="33%"><img src="screenshots/2026-07-20-skinned-actors-lighting-zoom.jpeg" alt="Skinned actors, lighting" width="100%"><br><sub><b>Skinned actors under lighting</b> - multiple skinned actors, zoomed in to check shading.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-20-cast-shadows.jpeg" alt="Cast shadows" width="100%"><br><sub><b>Cast shadows</b> - real-time shadows grounding the actors in the scene.</sub></td>
<td width="33%"><img src="screenshots/2026-07-20-run-loop-portals.jpeg" alt="Run loop, portals" width="100%"><br><sub><b>Run loop and portals</b> - the map run loop with entry/exit portals.</sub></td>
<td width="33%"><img src="screenshots/2026-07-20-boss-telegraph.jpeg" alt="Boss telegraph" width="100%"><br><sub><b>Boss telegraph</b> - a readable ground telegraph before a boss attack lands.</sub></td>
</tr>
</table>

## 2026-07-21 - maps and a boss fight

Procedural interiors get walls and textures, and the Warden encounter takes shape.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-21-indoor-mapgen-wired.jpeg" alt="Indoor mapgen" width="100%"><br><sub><b>Indoor mapgen wired in</b> - procedural indoor generation connected to the client.</sub></td>
<td width="33%"><img src="screenshots/2026-07-21-textured-dungeon-walls.jpeg" alt="Textured dungeon walls" width="100%"><br><sub><b>Textured dungeon walls</b> - the boundary walls get color and normal maps.</sub></td>
<td width="33%"><img src="screenshots/2026-07-21-cast-slows-movement.jpeg" alt="Cast slows movement" width="100%"><br><sub><b>Casting slows movement</b> - casting applies a per-skill movement penalty instead of freezing the legs.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-21-warden-phase2-burning-slam.jpeg" alt="Warden burning slam" width="100%"><br><sub><b>Warden phase 2, burning slam</b> - the Warden boss in its second phase.</sub></td>
<td width="33%"></td>
<td width="33%"></td>
</tr>
</table>

## 2026-07-22 - loot and preparation

Items start dropping, and the pre-map screen appears.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-22-first-loot.jpeg" alt="First loot" width="100%"><br><sub><b>First loot</b> - item drops as server-authored world entities.</sub></td>
<td width="33%"><img src="screenshots/2026-07-22-preparation-panel.jpeg" alt="Preparation panel" width="100%"><br><sub><b>Preparation panel</b> - the pre-run panel for setting up a map.</sub></td>
<td width="33%"></td>
</tr>
</table>

## 2026-07-23 - the HUD comes together

Matching the Path of Exile 2 HUD against the reference screenshots.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-23-hud-orbs.jpeg" alt="HUD orbs" width="100%"><br><sub><b>Life and mana orbs</b> - glossy framed orbs beside the skill bar.</sub></td>
<td width="33%"><img src="screenshots/2026-07-23-hud-flasks.jpeg" alt="HUD flasks" width="100%"><br><sub><b>Flask row</b> - 3 life and 2 mana flasks next to the life orb, keys 1-5.</sub></td>
<td width="33%"><img src="screenshots/2026-07-23-orb-frames.jpeg" alt="Orb frames" width="100%"><br><sub><b>Ornate orb frames</b> - generated gold filigree frames replacing the CSS bevel.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-23-item-tooltip.png" alt="Item tooltip" width="100%"><br><sub><b>Item tooltip</b> - a full item tooltip with base stats and requirements.</sub></td>
<td width="33%"></td>
<td width="33%"></td>
</tr>
</table>

## 2026-07-24 - uniques and item art

Named pool items land, and every base gets painted inventory art.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-24-unique-item.jpeg" alt="Unique item" width="100%"><br><sub><b>Unique items</b> - Ashmaw, a named pool item with its own mods and flavour line. Numpad6 drops one debug item per press, cycling normal to magic to rare to unique.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-item-icons.jpeg" alt="Item icons" width="100%"><br><sub><b>Item art</b> - every base carries painted inventory art, sized to its grid footprint. The item name stays as the fallback for bases without an icon.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-drag-equip.jpeg" alt="Drag to equip" width="100%"><br><sub><b>Drag to equip</b> - mid-drag: legal slots glow gold and the rest fade back. Releasing over the world behind the panel puts the item back on the floor, where it can be picked up again.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-24-flasks-qe-skills.jpeg" alt="Flasks on Q and E" width="100%"><br><sub><b>Flasks on Q and E</b> - two painted flasks instead of five vials, and the skill bar becomes six icon slots on keys 1-6. PoE2 has it the other way round (flasks on digits, skills on QWERT); this keeps the flasks under the movement hand.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-corner-hud.jpeg" alt="Corner HUD" width="100%"><br><sub><b>The corners close up</b> - orbs sink into the screen corners behind new gargoyle ring frames, and the flask and skill bars run out from under them on a 9-sliced iron panel, each capped by a bronze guardian.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-orbs-poe2-parity.jpeg" alt="Orbs measured against PoE2" width="100%"><br><sub><b>Orbs, measured</b> - sphere size, corner margin and liquid colours read straight off floor#2.webp: 8.4% of the screen wide, ring flush with the bottom edge, deep crimson falling to near-black at the base. The gaudy frame gave way to a slim blackened-bronze one and the guardians went away.</sub></td>
</tr>
</table>

## 2026-07-25 - painted globes

The orbs stop being CSS.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-painted-orbs.jpeg" alt="Painted orbs" width="100%"><br><sub><b>Painted globes</b> - the liquid is generated art now, pinned to the bottom of the well and revealed up to the current life or mana, so draining uncovers the dark glass instead of shrinking a gradient. A CSS ball was never going to read like PoE2's.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-ground-loot-labels.jpeg" alt="Ground loot labels" width="100%"><br><sub><b>Loot has names</b> - every drop wears a persistent plate with its name in its rarity colour, and the beacon under it takes the same tint. Drops that land on one tile stack into a readable column instead of hiding behind each other.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-loot-beams.jpeg" alt="Loot beams" width="100%"><br><sub><b>Beams and a noise</b> - each drop stands a light beam in its rarity colour, dim for junk and bright for a unique, and clicking its plate walks you over and picks it up. The drop chime is tiered the way a NeverSink filter tiers alerts: a struck-metal body over a noise transient, with a sub gong under the good stuff.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-magic-item-names.jpeg" alt="Magic item names" width="100%"><br><sub><b>Magic items get their names back</b> - every affix is now a prefix or a suffix, capped per side the way PoE does it (magic 1+1, rare 3+3), and a magic item borrows a word from each: "Smoldering Emberweave Robe of the Furnace" instead of a bare base name. The name is built once at roll time, so plates, tooltips and the backpack all agree.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-poe1-globes.jpeg" alt="PoE1 globes" width="100%"><br><sub><b>Globes rebuilt from PoE 1</b> - this one borrows from PoE1, not PoE2: a sphere 10.3% of the screen wide inside a thin braided rope ring, a bronze statue leaning on its outer side, and the value as a label above the globe instead of a number floating inside it. Sizes, ring thickness and the liquid's brightness ramp were measured off the reference shot, not eyeballed, and the geometry is in vw so it holds at any resolution.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-flask-charges.jpeg" alt="Flask charges" width="100%"><br><sub><b>Flasks stop being decoration</b> - Q and E now drink for real: seven charges each, a third of your life or mana back per swig, one charge returned per kill, and a full pool refuses the flask instead of wasting it. The spent part of the vial goes dark from the neck down, so the mana flask above is sitting at three charges of seven.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-suffix-pool.jpeg" alt="Suffix pool" width="100%"><br><sub><b>The suffix side fills up</b> - a rare was capped at 3+2 because only two suffixes existed. Six more join them, worded the way poe2db lists PoE2's: cold, lightning and chaos resistance, Strength, mana regeneration rate and critical strike chance. Three are eligible from level 1, so a rare can now actually fill its 3+3, and magic names finally vary: of the Brute, of the Yeti, of Menace, of the Squall.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-bar-behind-globes.jpeg" alt="Bars behind the globes" width="100%"><br><sub><b>The bars join the globes</b> - the flask and skill panels were fixed-pixel boxes parked beside the globes, so they shrank against them as the window widened. Both now run off the screen side and pass behind the braided ring, and their height and slots are fractions of the sphere (0.65 and 0.38 of its diameter) measured off the same PoE1 crop. Hotkeys sit at the vial's foot in the serif face instead of on a label plate.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-implicits-and-class-pools.jpeg" alt="Implicits and per-class mod pools" width="100%"><br><sub><b>Bases keep their own line</b> - every wand now carries a fixed implicit above the rolled mods, set off by a gap the way PoE prints it, and the mod pool is cut per item class: a wand can no longer roll Armour or maximum Life, a chest can no longer roll cast speed. Five new prefixes (energy shield, increased armour and energy shield, spell damage, cold damage) keep every class at four eligible prefixes from level 1, so the 3+3 a rare wants still fits whatever dropped. The wand's implicit is PoE1's Goat's Horn line, since PoE2 wand implicits all grant a skill and nothing here can grant one yet; the robe's is PoE2's Enlightened Robe.</sub></td>
</tr>
</table>
