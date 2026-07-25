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
<tr>
<td width="33%"><img src="screenshots/2026-07-25-xp-and-character-level.jpeg" alt="Experience and character level" width="100%"><br><sub><b>The character starts keeping score</b> - the protocol had no level and no experience in it at all, so a kill paid nothing and every map was worth exactly as much as every other one. The character now starts at <code>65</code>, which is where PoE2 opens its endgame and, more to the point, the only level that makes sense in a game whose lowest area is already level 64: a level-1 character here would fight thirty levels above itself forever and the level-difference penalty would read as a permanent tax rather than a choice. A kill is worth its area level, times eight for a rare and forty for a boss, after PoE's penalty for the gap between your level and the area's - symmetric, so farming a tier you have outgrown pays as badly as overreaching one, which is the whole reason the Atlas has tiers. That penalty is what the next slice needs: with sustain and node tiers, pushing deeper becomes the way to keep earning rather than a flavour choice. Levelling itself grants little, six life and two mana, because gear is where this game's power lives and a percentage would compound with every affix; it enters the stat fold as two ordinary flat mods, so a level and a chest piece are added by the same code and cannot drift apart. The bar is the thin trough across the very bottom edge that both PoE games use - the one bar you are never meant to look at directly - with the level printed in the gap between the two panels, and the sheet takes the reference's identity plate (<code>character-stats.png</code>: "Level 80 Invoker"), minus the portrait, the class and the league, since there is one of each.</sub></td>
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
<tr>
<td width="33%"><img src="screenshots/2026-07-25-gear-stats-apply.jpeg" alt="Gear stats reach the player" width="100%"><br><sub><b>Mods stop being text</b> - an affix was a tooltip line and nothing else. Every implicit and affix on an equipped item now folds into the player: maximum life and mana, armour (flat roll first, then the percent increase on the sum, which is PoE's order), fire resistance, mana regeneration rate, and increased spell damage on the hit itself. Cinderveil's +60 life grows the pool without filling it, so the globe reads 100/160 and leaves you to top it up, exactly as PoE does. Energy shield, the other three resistances, attributes, crit and cast speed still roll and still render, but nothing in the sim can honour them yet, so they land as deliberate no-ops instead of being quietly mapped onto whichever stat is nearby.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-character-sheet.jpeg" alt="Character sheet" width="100%"><br><sub><b>C opens the sheet</b> - armour and resistance totals existed but were invisible: only the two globes were legible. The character sheet takes PoE2's shape from the reference shot - carved header band with a gold cartouche, wide arched stone niches, a resistance pill band, then a label/value detail list. The stone, the header relief, the arches and the four stat icons are generated art rather than CSS approximations, because the reference's weight comes almost entirely from that carving and no gradient stack was going to stand in for it. The sheet prints armour the way PoE2 does, as the share of a physical hit it actually stops rather than the raw rating. That number comes from the same curve damage resolution uses, so the sheet cannot drift from the fight. Fire resistance reads "30% (30%)", capped beside uncapped, which is where overcapping past 75 will show up. The identity row, the attribute plate, energy shield, spirit, evasion, block and three of the four resistances are left off: no mechanic backs them, and a row frozen at zero would advertise a system that is not there. Offence is a PoE1 borrow, since PoE2 moved those onto skill tooltips and we have no skill tooltip yet.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-equipped-tooltip.jpeg" alt="Equipped item tooltip" width="100%"><br><sub><b>Worn gear can be read</b> - hovering a backpack cell showed a tooltip; hovering the thing you were actually wearing showed nothing, so the only way to check what a slot was granting was to take it off. Equipped slots now use the same tooltip, which is how the sheet's numbers can be traced back: Cinderveil's +60 life, +89 armour and +30% fire resistance are exactly the 160, 89 and 30% next door.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-armour-curve.jpeg" alt="Armour curve" width="100%"><br><sub><b>Armour stops being a flat 90%</b> - one chest piece was eating 90% of every hit, boss slam included, because the curve had no damage term in it at all: <code>armour/(armour+10)</code> takes the same share whatever lands. PoE2's real curve puts the hit in the denominator, <code>armour / (armour + 10 x hit)</code>, hard-capped at 90%, and that is the whole reason armour is a defence distinct from flat reduction: strong against many small hits, weak against one large one. The same 89 armour now stops 60% of a Cinder Imp's swipe, 47% of the Warden's attack and 24% of its slam. PoE1 uses the identical shape with a multiplier of 5, a gentler curve; the harsher PoE2 number is the one taken here. Since the share now depends on the hit, the sheet's single Armour percent has to name one, so it quotes the Imp's basic attack, the way PoE2 quotes a hit sized to your level (which is why an endgame character there reads 7%).</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-resistances.jpeg" alt="All four resistances" width="100%"><br><sub><b>Cold, lightning and chaos start mattering</b> - three of the four resistances rolled on gear, printed on the tooltip, and then did nothing, because the only damage in the game was fire and physical. Wiring them alone would have been a defence against damage that could not occur, so the damage types and a source for them landed in the same slice. Rares now carry an elemental theme, which is PoE's own answer to pack variety: a rare converts its whole hit to its element and resists that element by 30, so a Storm-Touched pack is answered by lightning resistance and not by armour, and the map's seed fixes which theme it rolls. Each element resists only itself and the 75 cap applies per element rather than to their sum. The sheet takes the reference's 2x2 grid, fire and cold over lightning and chaos, each capped beside uncapped. The cold, lightning and chaos glyphs are drawn rather than sprited - the icon sheet was cut when fire was the only resistance, and three more PNGs for three small marks was not worth the download.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-balance-pass.jpeg" alt="Balance pass" width="100%"><br><sub><b>The fight gets measured</b> - two slices had moved difficulty (armour by hit size, then elemental resistances) with nothing watching, and none of it had been playtested. A headless harness now drives the real sim with real content, player standing still and playing its best rotation, and reports time-to-kill and time-to-death for every encounter, so pacing is a number rather than a feeling. It found three things. A rare died in <code>0.9s</code>, quicker than a five-imp pack, and landed one 9-damage hit in its whole life, so the resistance it demands could never be felt: <code>600%</code> life carries it past the player's opening 60-mana burst and <code>300%</code> damage makes one hit about a sixth of a base pool. The Warden's phase-2 patch was doing <code>60</code> damage a second, not the 12 its content line reads, because dps is per stack and the patch reapplies every 6 ticks, so you sit at 5 stacks within a second: at <code>fp(4)</code> it is 20 a second, a patch you can react to instead of pre-dodge, which is the moment in the shot, 140/160 and standing in it. And the Warden itself needed <code>56s</code> of mana-starved poking, hidden until the harness stopped letting the player die, because death refills mana and was handing the fight a fresh burst every ten seconds; 750 life behind 40% fire resistance is 1250 effective against a kit that is entirely fire, so it drops to 420 behind 25% and dies in <code>20s</code>, PoE2's range for an act boss.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-mana-economy.jpeg" alt="Mana economy" width="100%"><br><sub><b>The fight stops being mostly waiting</b> - the last slice fixed how long a fight lasts and left alone what happens inside it. Measured, the Warden was 20 seconds in which the player got to cast <code>1.05</code> times a second against a ceiling of 3.75: a 60-mana pool spent in the opening two seconds, then a bolt every 1.3s as 6 mana a second trickled back. The harness now counts landed casts as well as ticks, because a fight can be exactly the right length and still be spent watching a bar refill. Regeneration goes to <code>15</code> a second and the reading becomes <code>2.18</code>. Both PoE games regenerate a percentage of the pool instead - PoE2 4% a second, PoE1 1.75% - and that is deliberately not copied: the percentage only works there because the pool grows all game while a skill's cost barely does, so a level-1 PoE2 caster really does earn one spell every six seconds and really is meant to stand there. Nothing here grows, so copying the rate would copy act 1's starvation and never the endgame that pays it off; what is matched is the outcome, roughly two casts a second, which is where a PoE2 caster lands once its build works. Monster life then follows player damage rather than the other way around: the Warden goes to <code>840</code> so the fight is the same 20 seconds it was, and rares to <code>900%</code> because at 600 a non-fire rare fell in 1.63s, back under the pack it is supposed to outlast.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-orb-liquid-level.jpeg" alt="Orb liquid level" width="100%"><br><sub><b>The globes stop lying about the level</b> - a half-full life globe read as nearly empty, and the reflex was to go looking for a HUD that had lost track of the number. It had not: the fill is exactly <code>life/maxLife</code> of the well's height, measured at 40/100 as 164.8px of 412. The lie was in the paint. The liquid is a rendered sphere lit from above, so its lower hemisphere falls to about 0.6 of the equator, and since the fill is pinned to the bottom of the well, draining it uncovers nothing but that shadow: at 90 you see the bright band and the globe reads full, at 68 you see the dark underside and it reads dead. The art now carries a colour-dodge ramp pinned to the same well, identity against the bright half and about 1.7x at the very bottom, so the liquid is one colour at every level and the waterline alone tells you where you stand - which is what PoE1's globes do in the reference crop, where the roundness comes from the gloss over the liquid rather than from the liquid itself. Two orbs at 34/100 and 23/60 in the shot, both legible at a glance.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-atlas-graph-fog.jpeg" alt="Atlas graph and fog" width="100%"><br><sub><b>The Atlas becomes a place, not a dropdown</b> - three hardcoded node names sat in a list, and the one you picked was written to <code>activeNodeId</code>, read back when the boss died to tick it off, and touched nothing else: not the seed, not the monsters, not the loot. Choosing Emberfall over Cinder Vault changed a label. Now the world is generated from the character's <code>atlasSeed</code>: twelve places on a jittered grid, joined by a minimum spanning tree so nothing is ever stranded, plus every remaining short pair so there are loops and a choice of route rather than one forced chain. Fog is the PoE2 rule, one hop at a time: you may run the first node, or anywhere a route leads from somewhere you have cleared, which is what turns a list into a decision. The rule lives in the sim, not in the greyed-out button, because the client is untrusted. And the place is now half the map seed, so the same Waystone taken to two nodes draws two different dungeons while one place keeps its own. What is deliberately not on a node yet is difficulty: the Waystone still brings the tier. Gating a node behind a tier would hard-lock a character today, since the three offers are fixed by the atlas seed forever and nothing drops a replacement. Sustain first, then the tier belongs on the region. The panel is still a wall of tiles; the painted world map from <code>atlas-maps.webp</code> is the next slice.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-atlas-world-map.jpeg" alt="Atlas world map" width="100%"><br><sub><b>The graph gets drawn</b> - the world existed but arrived as twelve buttons in a row, which told you nothing about where anywhere was or which place opens next. The Map Device now draws it the way the reference does: places sit at their own coordinates, routes are drawn between linked ones, and state is read at a glance rather than from a label. Ashen Glade is lit gold because it is the one you can enter; everything else sits in fog at a fraction of the brightness with its route dashed. A route to somewhere cleared turns solid green, so the road already walked separates itself from the one ahead. The field is the carved stone the character sheet uses, tinted and vignetted rather than painted terrain, because a region per node is art that does not exist yet and a bare panel would have read as a form. The <code>NO ROUTE</code> caption is gone with the tiles: fog says it better than a word does.</sub></td>
</tr>
</table>
