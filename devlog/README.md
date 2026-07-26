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
</tr>
</table>

## 2026-07-22 - loot and preparation

Items start dropping, and the pre-map screen appears.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-22-first-loot.jpeg" alt="First loot" width="100%"><br><sub><b>First loot</b> - item drops as server-authored world entities.</sub></td>
<td width="33%"><img src="screenshots/2026-07-22-preparation-panel.jpeg" alt="Preparation panel" width="100%"><br><sub><b>Preparation panel</b> - the pre-run panel for setting up a map.</sub></td>
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
</tr>
</table>

## 2026-07-24 - uniques and item art

Named pool items land, and every base gets painted inventory art.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-24-unique-item.jpeg" alt="Unique item" width="100%"><br><sub><b>Unique items</b> - Ashmaw, a named pool item with its own mods and flavour line.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-item-icons.jpeg" alt="Item icons" width="100%"><br><sub><b>Item art</b> - every base carries painted inventory art, sized to its grid footprint.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-drag-equip.jpeg" alt="Drag to equip" width="100%"><br><sub><b>Drag to equip</b> - mid-drag: legal slots glow gold and the rest fade back.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-24-flasks-qe-skills.jpeg" alt="Flasks on Q and E" width="100%"><br><sub><b>Flasks on Q and E</b> - two painted flasks instead of five vials, and the skill bar becomes six icon slots on keys 1-6.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-corner-hud.jpeg" alt="Corner HUD" width="100%"><br><sub><b>The corners close up</b> - orbs sink into the screen corners behind new gargoyle ring frames.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-orbs-poe2-parity.jpeg" alt="Orbs measured against PoE2" width="100%"><br><sub><b>Orbs, measured</b> - sphere size, corner margin and liquid colours read straight off floor#2.webp: 8.4% of the screen wide.</sub></td>
</tr>
</table>

## 2026-07-25 - painted globes, and a game underneath them

The orbs stop being CSS, and the sim grows levels, resistances, Waystones and an Atlas.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-xp-and-character-level.jpeg" alt="Experience and character level" width="100%"><br><sub><b>The character starts keeping score</b> - the protocol had no level and no experience in it at all.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-rare-element-aura.jpeg" alt="Rare element aura" width="100%"><br><sub><b>A rare says which resistance it wants</b> - every rare converts its whole hit to one element and resists that element.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-energy-shield.jpeg" alt="Energy shield" width="100%"><br><sub><b>Energy shield stops being a number on a tooltip</b> - two affixes rolled it, the tooltip printed it, the sheet had no row for it and the sim had no idea it existed.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-waystone-modifiers.jpeg" alt="Waystone rarity and map modifiers" width="100%"><br><sub><b>A Waystone stops being a tier number</b> - three stones, distinguishable only by the tier printed on them, and the tier moved monster life and damage and nothing else.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-waystone-sustain.jpeg" alt="Waystone sustain" width="100%"><br><sub><b>Waystones become a resource instead of a menu</b> - the three stones were conjured from the atlas seed every time the device opened, which meant they were infinite.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-atlas-node-tiers.jpeg" alt="Atlas node tiers" width="100%"><br><sub><b>The world gets a shape you have to earn</b> - the map drew twelve places, all equally open once the fog lifted, so a route was a matter of taste: any stone opened any place.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-painted-orbs.jpeg" alt="Painted orbs" width="100%"><br><sub><b>Painted globes</b> - the liquid is generated art now, pinned to the bottom of the well and revealed up to the current life or mana.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-ground-loot-labels.jpeg" alt="Ground loot labels" width="100%"><br><sub><b>Loot has names</b> - every drop wears a persistent plate with its name in its rarity colour, and the beacon under it takes the same tint.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-loot-beams.jpeg" alt="Loot beams" width="100%"><br><sub><b>Beams and a noise</b> - each drop stands a light beam in its rarity colour, dim for junk and bright for a unique.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-magic-item-names.jpeg" alt="Magic item names" width="100%"><br><sub><b>Magic items get their names back</b> - every affix is now a prefix or a suffix, capped per side the way PoE does it (magic 1+1, rare 3+3).</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-poe1-globes.jpeg" alt="PoE1 globes" width="100%"><br><sub><b>Globes rebuilt from PoE 1</b> - this one borrows from PoE1, not PoE2: a sphere 10.3% of the screen wide inside a thin braided rope ring.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-flask-charges.jpeg" alt="Flask charges" width="100%"><br><sub><b>Flasks stop being decoration</b> - Q and E now drink for real: seven charges each, a third of your life or mana back per swig, one charge returned per kill.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-suffix-pool.jpeg" alt="Suffix pool" width="100%"><br><sub><b>The suffix side fills up</b> - a rare was capped at 3+2 because only two suffixes existed.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-bar-behind-globes.jpeg" alt="Bars behind the globes" width="100%"><br><sub><b>The bars join the globes</b> - the flask and skill panels were fixed-pixel boxes parked beside the globes, so they shrank against them as the window widened.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-implicits-and-class-pools.jpeg" alt="Implicits and per-class mod pools" width="100%"><br><sub><b>Bases keep their own line</b> - every wand now carries a fixed implicit above the rolled mods, set off by a gap the way PoE prints it.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-gear-stats-apply.jpeg" alt="Gear stats reach the player" width="100%"><br><sub><b>Mods stop being text</b> - an affix was a tooltip line and nothing else.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-character-sheet.jpeg" alt="Character sheet" width="100%"><br><sub><b>C opens the sheet</b> - armour and resistance totals existed but were invisible: only the two globes were legible.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-equipped-tooltip.jpeg" alt="Equipped item tooltip" width="100%"><br><sub><b>Worn gear can be read</b> - hovering a backpack cell showed a tooltip; hovering the thing you were actually wearing showed nothing.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-armour-curve.jpeg" alt="Armour curve" width="100%"><br><sub><b>Armour stops being a flat 90%</b> - one chest piece was eating 90% of every hit, boss slam included, because the curve had no damage term in it at all.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-resistances.jpeg" alt="All four resistances" width="100%"><br><sub><b>Cold, lightning and chaos start mattering</b> - three of the four resistances rolled on gear, printed on the tooltip, and then did nothing.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-balance-pass.jpeg" alt="Balance pass" width="100%"><br><sub><b>The fight gets measured</b> - two slices had moved difficulty (armour by hit size, then elemental resistances) with nothing watching.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-mana-economy.jpeg" alt="Mana economy" width="100%"><br><sub><b>The fight stops being mostly waiting</b> - the last slice fixed how long a fight lasts and left alone what happens inside it.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-orb-liquid-level.jpeg" alt="Orb liquid level" width="100%"><br><sub><b>The globes stop lying about the level</b> - a half-full life globe read as nearly empty, and the reflex was to go looking for a HUD that had lost track of the number.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-atlas-graph-fog.jpeg" alt="Atlas graph and fog" width="100%"><br><sub><b>The Atlas becomes a place, not a dropdown</b> - three hardcoded node names sat in a list, and the one you picked was written to <code>activeNodeId</code>.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-atlas-world-map.jpeg" alt="Atlas world map" width="100%"><br><sub><b>The graph gets drawn</b> - the world existed but arrived as twelve buttons in a row.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-atlas-fullscreen.jpeg" alt="Atlas fullscreen" width="100%"><br><sub><b>The Atlas takes the whole screen</b> - the world map was drawn inside a 720px card with a 300px field.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-aggro-radius.jpeg" alt="Aggro radius" width="100%"><br><sub><b>A map stops being one fight at the door</b> - opening a map put seven monsters, the rare among them, in contact by <code>4.0s</code>.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-cast-speed.jpeg" alt="Increased cast speed" width="100%"><br><sub><b>Cast speed stops being a word on a wand</b> - <code>of Casting</code> has been rolling on wands and foci since item level 12.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-crit-chance.jpeg" alt="Critical strike chance" width="100%"><br><sub><b>Critical strikes</b> - <code>of Menace</code> was the last combat suffix reading zero.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-hud-bar-ends.jpeg" alt="HUD bar ends" width="100%"><br><sub><b>The bottom bar stops looking cut</b> - the flask and skill panels are 9-sliced from one piece of art, and that art was flush-cut at both image edges.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-inventory-dock-drag.jpeg" alt="Inventory docked and dragging" width="100%"><br><sub><b>The inventory docks and the drag gets a shadow</b> - the panel was a box in the middle of a dimmed screen, which is a web dialog, not <code>inventory+equipment.png</code>.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-inventory-full-height-mouse-slots.jpeg" alt="Full-height inventory and a two-row skill bar" width="100%"><br><sub><b>The inventory takes the whole side, the bar takes the mouse</b> - both halves of this come off two PoE1 screenshots, <code>inventory.png</code> and <code>poe1-lower-bar.png</code>.</sub></td>
</tr>
</table>

## 2026-07-26 - a stash, and somewhere to spend it

The hideout gets storage, quick transfer, and a bench that turns leftovers into currency.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-26-bar-width-matches-panel.jpeg" alt="Skill bar squared off with the inventory panel" width="100%"><br><sub><b>The bar and the panel share one left edge</b> - the inventory dropped further left than the skill panel below it.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-skill-tooltip.jpeg" alt="Skill tooltip above the bar" width="100%"><br><sub><b>A skill says what it costs</b> - hovering a socket now opens the PoE1 gem tooltip above the bar: name in gold on the left.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-skill-tiles-fill-the-bar.jpeg" alt="Skill bar rebuilt against the PoE1 reference" width="100%"><br><sub><b>The bar goes back to the reference</b> - side by side with <code>poe1-lower-bar.png</code> ours had three things wrong.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-26-panel-and-bar-wider.jpeg" alt="Inventory and skill bar on a wider shared edge" width="100%"><br><sub><b>Both pieces move out to the same line</b> - the shared left edge was where a red line drawn over a screenshot said it should not be, so the whole right-hand column grew.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-bars-lose-height.jpeg" alt="Shorter flask and skill panels" width="100%"><br><sub><b>Both bars sit lower</b> - <code>poe1-lower-bar.png</code> turns out to be a 16:9 fullscreen grab 2558px wide, so its pixels convert straight into vw.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-bar-rail.jpeg" alt="Recessed rail between the two skill rows" width="100%"><br><sub><b>A rail where there was a gap</b> - the reference closes its mouse row on a warm hairline, drops 18px of shadow, then opens the numbered row on a brighter one.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-26-bar-runs-flush.jpeg" alt="Numbered skill row flush to the frame, narrower inventory panel" width="100%"><br><sub><b>The right column stops being pixels</b> - that leftover gap was not the price of sharing an edge, it was the last fixed-px number in the corner.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-boss-bar-waits-for-the-fight.jpeg" alt="Map entry with no boss bar at the top of the screen" width="100%"><br><sub><b>The boss bar waits for the boss</b> - stepping through a portal used to raise the Warden's health bar immediately, with the Warden itself somewhere off in the dark.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-boss-holds-its-room.jpeg" alt="Forty-six seconds standing at a map entrance, nothing has walked in" width="100%"><br><sub><b>The Warden holds its room</b> - the separate defect above, closed.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-26-strength-buys-life.jpeg" alt="Character sheet reading 134 life beside a robe rolling +17 Strength" width="100%"><br><sub><b>Strength stops being decoration</b> - <code>affix.strength</code> has been rolling on gear since first loot and <code>applyItemMods</code> dropped it on the floor.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-boss-pays-a-burst.jpeg" alt="Five item plates scattered around a dead boss, two of them on rare beams" width="100%"><br><sub><b>The Warden pays a burst</b> - the first change made under <code>docs/09-reward-psychology.md</code>, which now outranks every other spec.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-unread-drop.jpeg" alt="Inventory with a red question mark on two items and a tooltip reading Unidentified" width="100%"><br><sub><b>Magic and better arrive unread</b> - rule 1 of <code>docs/09-reward-psychology.md</code> is that the spike fires on anticipation, not on receipt.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-26-scroll-of-wisdom.jpeg" alt="A revealed rare wand named Dread Weaver beside a scroll stack that has dropped to two" width="100%"><br><sub><b>The Scroll of Wisdom buys the reveal</b> - the wand two cells over was an unread rare a second ago.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-currency-orbs.jpeg" alt="A wand renamed Ember Wand of the Outcast, with orb labels still lying on the stone behind" width="100%"><br><sub><b>Five orbs make the item the slot machine</b> - the wand in the first cell was a plain <b>Ember Wand</b> until an Orb of Transmutation landed on it.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-orbs-get-painted.jpeg" alt="Backpack with five painted currency icons: a banded sphere, a purple bottle, a green flask, a gold gem and a cracked lava sphere" width="100%"><br><sub><b>The orbs stop being vector shapes</b> - the five currencies shipped with hand-authored flat SVGs.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-26-hideout-stash.jpeg" alt="Stash panel open beside the inventory, three items sitting in the stash grid after a page reload" width="100%"><br><sub><b>The hideout keeps what the map paid</b> - a full backpack used to have exactly one remedy, which was throwing something on the floor and watching it stay there.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-shift-click-quick-transfer.jpeg" alt="Stash and inventory open side by side, items sitting in the stash after being shift-clicked across" width="100%"><br><sub><b>Shift-click sends it across</b> - the stash shipped with exactly one way to move an item, which was picking it up and carrying it to a cell.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-disenchanting-bench.jpeg" alt="The hideout with the disenchanting bench, an anvil and a glowing ember crucible, standing right of the stash" width="100%"><br><sub><b>The bench eats the leftovers</b> - ctrl-click a magic, rare or unique at the bench and it becomes currency shards, ten to an orb.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-26-stash-cartouche.jpeg" alt="The stash under a gilt cartouche header, its grid lattice drawn as tiled art" width="100%"><br><sub><b>The stash gets its cartouche</b> - the real stash was sampled pixel by pixel: cell floors near black at luminance 1, a 1px warm lattice, an engraved crest in every empty square.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-stash-full-height.jpeg" alt="The stash pane running from the top of the screen down to the bottom bar" width="100%"><br><sub><b>The stash runs the full height</b> - top of the screen down past the bar, its lower corner sliding behind the life orb and the flask panel.</sub></td>
<td width="33%"><img src="screenshots/2026-07-26-cursor.jpeg" alt="The gilt cursor blade at three sizes and its red-iron refusal variant" width="100%"><br><sub><b>Our own pointer</b> - a gilt blade retires every Windows cursor, cooled to red iron over an item the armed orb cannot touch.</sub></td>
</tr>
</table>
