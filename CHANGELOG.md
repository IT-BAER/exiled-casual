# Changelog

All notable changes to this project are recorded here, in the shape
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) gives it, with versions
following [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The top released section is also what the main menu shows under LATEST. It is
not copied by hand: `node tools/changelog_to_news.mjs` reads this file and
writes `apps/web/src/news.generated.ts`, and a test fails if the two disagree.

## [Unreleased]

### Added

- Orbs craft waystones. An Orb of Transmutation makes a normal waystone magic,
  an Orb of Alchemy makes a normal or magic one rare, and an Orb of Elevation
  turns a magic waystone rare with all its modifiers rolled anew. A waystone
  with modifiers pays a second waystone one tier higher when you clear its
  map, so you choose when to climb the Atlas instead of waiting for a lucky
  drop.

### Fixed

- An orb that cannot change a waystone no longer plays the craft sound as if
  it had worked.
- On smaller screens the Atlas panel for a map no longer covers the backpack,
  so a waystone in its first column can be dragged again, and the panel moves
  aside so the open inventory no longer hides its socket and Activate button.
- The inventory's tabs no longer draw a line under the tab you switch to.

## [0.5.1] - 2026-10-28

### Added

- The inventory has a Cosmetics page, laid out like PoE1's: a slot for every
  piece of gear, flask skins, a pet and effects. The Celestial Cat goes into
  the Pet slot with a click and comes out with another; the Options switch is
  gone.

### Changed

- A brute's charge shows the path it will run on the floor, from the brute to
  where it lands, instead of a disc at the landing point.
- Ground Slam drives the hammer head into the floor, not just the fist.
- The Wrack Drowned is rebuilt: no glow, an anchor that reads as an anchor,
  and arms that swing free of its body.

### Fixed

- Many sounds at once no longer stack into one loud blast.
- Your shadow shows your arms again, and a shield in your hand no longer
  throws a huge shadow across the room.

## [0.5.0] - 2026-10-26

### Added

- A Celestial Cat companion floats beside you: a black cat with a starry coat
  and cyan crescent eyes that hovers at your side, gallops through the air
  when you run, swims and chases its tail when you stand still, and drops in
  somersaulting when you arrive. Turn it off under Options.
- Ground Slam breaks the floor: rock chunks and dirt fly along the blow and a
  jagged crack stays behind, fading over time.
- Ember Bolt flies as one comet with a white-hot head and a burning tail, and
  Blink smears a violet comet from where you left to where you arrived.
- Loot labels use the NeverSink semi-strict filter's styles: currency by its
  tier, waystones by map tier, and so on.
- The Strand has its own loading screen.

### Changed

- Energy shield is a ring of crystal segments over the life globe, filling and
  draining smoothly, like PoE2's.
- The tower shield is braced low at your flank while you run and attack,
  instead of swinging around with your arm.
- Casting turns the wand onto the target from the shoulder instead of
  stretching the arm wide.
- Tier 1 maps are area level 2, so the first map no longer starts at level 8.
- A hovered loot label rises over the labels that overlap it.
- Walking to a monster, label, portal or the map device routes around
  obstacles.
- Brazier flames sit inside their bowls and are fuller at the bottom.

### Fixed

- Items dropped on the hideout floor stay there across map trips and reloads.
- An orb or Scroll of Wisdom works on a worn piece without taking it off.
- Swapping or taking off gear with a full backpack says Inventory Full instead
  of snapping back silently.
- A stash piece dropped on a paper-doll slot is worn, and the old piece goes
  to the stash.
- A boss killed during its wind-up no longer lands the slam.
- The Ironsworn Tower Shield has its 18 base Armour.
- Rare item names no longer borrow words from base names.
- The Emberbound robe and the Stalker coat no longer show the leg through the
  skirt's slit.
- Cinder Ground no longer draws a black outline.

## [0.4.7] - 2026-10-23

### Added

- The Swamp's fen pools are water you wade through instead of a wall at their
  edge: the minimap shows them as water, and every step stirs rings in them.
- Monsters that have not noticed you yet stroll a few steps around where they
  stand, pausing between, instead of waiting frozen until you pull them.
- "Choose your controls" shows a mouse with its buttons lit and your movement
  keys as keycaps, instead of paragraphs explaining them.
- The skill bar's mouse slots show a small mouse with their own button lit,
  where a bare "L" and "R" looked like keys.

### Changed

- Fen pools are still water with a muddy bank, and you can see the floor
  through them, clearest at the edge.
- Brazier flames are fuller at the bottom and narrow only toward the tip.

### Fixed

- A reward chest no longer stands inside a fen pool.
- The Swamp's floor no longer paints puddles of its own beside the fen pools.

## [0.4.6] - 2026-10-23

### Added

- Wading through the Strand's shallows stirs the sea: waves ring out from every
  step, foam trails behind the legs, and each footfall throws a splash.
- Ground Slam winds up and drives its fist into the floor as the shockwave
  lands, and Heavy Strike and Ground Slam each have their own animation.
- The braziers on the main menu burn the same flame as the braziers in the game.

### Changed

- The Emberbound is a woman, as her class card always showed: she has her own
  body, and every piece of armour is fitted to it.
- Brazier flames burn in visible licks across the coals, with embers rising
  through them.

### Fixed

- Chest armour no longer leaves small loose shards floating beside the arms.
- The surf line no longer shows a straight seam where two stretches of shore
  meet.
- The Strand's rocks look like wet stone at the waterline instead of wet sand.

## [0.4.5] - 2026-10-22

### Fixed

- The character on the select screen is lit from the front by a warm light
  and no longer looks grey and washed out.

## [0.4.4] - 2026-10-22

### Added

- Water is a shader with swash, foam, depth colour, caustics and sky sheen.
- One amulet and one ring per class family, so the jewellery slots can be
  filled.
- Attacks use the main-hand weapon's own damage, speed and crit, and a wand or
  focus adds its fire and cold to spells.
- Loot beams have a hot core in their rarity's colour, and a rare or unique
  drop lights the floor around it.
- Hovering a portal, stash, map device or vendor shows its name over it, as in
  PoE.
- Refund All asks before it clears the passive tree.
- A weapon value that its own mods changed is drawn in the affix blue.
- Brazier flames burn like real fire, with depth, rising from the coals.
- The hideout floor fades to black past the walkable edge.

### Changed

- Uniques drop about eight times as often, roughly one every 35 maps.
- A new character starts with 160 gold, two magic items and two scrolls.
- A volley such as Split Arrow hits each target with one arrow only, as in
  PoE.
- Swarm monsters no longer poison or bleed, and poison lasts 2 s and bleeding
  5 s, as in PoE2.
- Gear above your level cannot be equipped, and its tooltip shows the level in
  red.
- Each new character gets its own Atlas, starting Waystones and vendor stock.
- Slam circles have a thin glowing rim instead of a dark outline.
- The rare monster glow is a deeper gold, so it shows on pale monsters too.

### Fixed

- A save the browser refuses shows on the HUD until a save works, and full
  browser storage no longer leaves a save hanging.
- A character whose save cannot be loaded no longer starts, so an empty world
  cannot overwrite the real one.
- Creating or deleting a character keeps the shared stash and the other
  characters' progress.
- Level, XP, gold, passives, shards and gear are saved as soon as they change.
- The character list shows the level reached, and Export writes the current
  progress.
- Old v2 save files import again, and a save from another version is refused
  instead of half-loaded.
- Corpses no longer fly off or towards the camera.
- Changing area no longer leaves old materials behind, so long sessions stay
  fast.
- The death recap shows how long an ailment ticked, such as Poison 5s.
- A reward that lands while the reward banner is up joins the banner.
- The character sheet scrolls instead of running behind the life globe, keeps
  values on one line, fits the Amulet and Ring labels at 1280x720 and lists
  the fire and cold a wand or focus adds to spells.
- Escape closes the feedback dialog in one press, keys no longer reach the game
  behind it, and a report names the game version.
- The Auto graphics note names the real floor, 45 fps.
- The controls dialog shows your own key bindings.
- Dragging currency onto the same currency stacks it, and a bought scroll joins
  its pile.
- Clicking a portal walks to the portal, not to the floor behind it.
- The area label names the map you are in, and a portal name at the top of the
  view stays on screen.
- Walking away from the hideout furniture can no longer lose the portals.
- Water foam no longer cuts off along a straight line.
- Debug URL switches no longer work in the released game.

## [0.4.3] - 2026-10-20

### Added

- Hovering a monster shows a target frame at the top of the screen and
  outlines the monster in red.
- Every map has a pack of magic monsters, and magic and rare monsters shimmer
  blue and yellow.
- Every currency and waystone says what it does and how to use it.
- Hovering a flask, on the bar or in the inventory, shows its recovery, charge
  cost, current charges and the key that drinks it.

### Changed

- Letting go of Shift after shift-clicking an orb or scroll onto items takes
  it off the cursor, as in PoE.
- Ctrl-click moves an item between backpack and stash, as in PoE. Shift-click
  still works.
- Piercing Shot hits for 36, so it out-damages the Stalker's free attack.
- Vaal Stone cliffs look like grey rock instead of carved masonry.
- Slam warnings and the rings under rare monsters and Cinder Ground are thinner
  and dimmer.

### Fixed

- A Scroll of Wisdom identifies an unidentified unique.
- Waystone tooltips show their name once, plus tier and area level.
- Flask captions in the inventory show your flask keys, 1 and 2.
- The Strand's three monsters have portraits on the death screen, and a death
  by ailment names its element.
- The class screen no longer marks the empty name field as an error, and it
  says that the class decides your skills.
- The third shard pile at the vendor reads Ember Shards.
- The numpad keys no longer spawn monsters and items.

## [0.4.2] - 2026-10-19

### Added

- Hold Ctrl over an item to see what you wear in its slot beside it. Options >
  Keybinds can switch the key to Shift.
- Hold Shift while you click with an orb or scroll on the cursor, and it stays
  there for the next item until the stack runs out.

### Changed

- The dodge roll cooldown is 1 second, down from 1.5.

## [0.4.1] - 2026-10-18

### Fixed

- The death music plays. 0.4.0 announced it but shipped without its tracks, so
  the area music kept playing; now three slow, dark takes fade in when you fall.
- Monster hitboxes match their bodies. Nine species, the Cinder Warden and
  Sirrath most of all, could be hit and could hit you well outside their model.
- Fights no longer stutter when a monster bolt lands on you or many monsters
  stand near the fire bowls.
- A tab left open across an update reloads itself instead of failing to start
  the game.

## [0.4.0] - 2026-10-18

Alpha. A save may not survive an update yet.

### Added

- The Strand has its own monsters. The Brine Scuttler is a hermit crab that
  comes in swarms, the Wrack Drowned a drowned sailor who charges with an anchor
  in his fist, and the Tide Spitter a clam that spits cold from the tide line.
  Only the Rotting Behemoth still washes in from the swamp.
- Vaal Stone, Swamp and Forest maps are dressed: broken columns, a toppled idol,
  urns and ruin walls in the Vaal stone, lobed trees, stumps, mossy logs and
  toadstools in the forest, gnarled dead trees and reeds in the swamp. Swamp
  maps hold standing pools of murky water with duckweed rafts.
- Every class skill looks and sounds like itself. Each melee skill cuts its own
  swing and Ground Slam breaks the floor, the three bow skills loose three
  different arrows on real recorded bow releases, and Ember Bolt sheds flame and
  lands as a fireball.
- Poison and bleeding reach the player too, show on the body and in the debuff
  row, and ignore armour. The Blood Sentinel poisons.
- Drag an item onto the vendor's shelf to sell it. A Buyback page, from Path of
  Exile 2, undoes a sale exactly.
- The Ironsworn Broadsword, a one-handed sword, drops.
- The passive tree has an outer ring of clusters, bridges between the inner
  ones and a keystone at the end of every spoke.
- Dying has its own music, and the area music comes back on revive.
- The game reports how it runs to its own server, without cookies and without
  storing anything on your device, and honours Global Privacy Control and Do
  Not Track. The Privacy page lists exactly what is sent. The main menu can show
  news and maintenance notices from the server.

### Changed

- The monsters of the Vaal Stone, the swamp and the forest, the Cinder Imp, the
  Cinder Warden, Sirrath and Ghaltrek have new, chunkier bodies in the style of
  the desert set.
- Vaal Stone, Swamp and Forest floors mix in a second ground texture in patches,
  wet with standing water in the swamp, and the three are lit brighter.
- The map's edge sinks into black instead of ending on a cut.
- Poison and bleeding hit harder and carry about a fifth of a pack's damage.
- The roll has a 1.5 second cooldown, and the first 80% of it dodges slams too.
- Packs make room for each other and surround the player instead of standing
  in him, and an attacking monster faces you.
- Ambience is quieter and swells, and on the Strand the surf comes from the sea.
- Smoke and impact dust fade out at their edges instead of drawing grey discs.
- Monsters out of view stop animating, and the game downloads about 13 MB less
  art.
- The tower shield's board runs along the forearm.

### Fixed

- Trees no longer stand at the foot of the rock, where they hid the player, and
  forest canopies read as leaves.
- Cliff rock stands where the collision edge is, so maps have no invisible walls.
- A monster no longer freezes in a passage too narrow for it.
- Swamp duckweed no longer draws a staircase along the bank.
- A seated waystone never sticks in the map device.
- A dropped currency stack is picked up whole.
- Name plates stay on their targets below 100% resolution.
- Auto graphics no longer switches presets on 60 Hz vsync jitter.

## [0.3.1] - 2026-10-15

Alpha. A save may not survive an update yet.

### Added

- Space rolls you a short way toward the cursor, or along the held keys in WASD.
  Projectiles and melee swings pass through you early in the roll. It costs
  nothing and can be rebound in Options.
- The desert is dressed with dead trees, ruin walls, ribcages, skulls and pots
  at the foot of the rock, and its rock is warm sandstone.
- A Portal button left of the inventory chest opens the same portal as its key.
- A pickup with no room in the backpack shows an Inventory Full message.
- A ground item's label brightens under the pointer.

### Changed

- Monster packs fight together. One that wakes alerts its neighbours, shooters
  back off and strafe between shots, and brutes charge from a few steps away.
  The Fen Wisp and the Rotting Behemoth's slam hit a little softer to make up
  for it.
- The desert monsters have new bodies. The Sand Skitterer is a scarab, the Dune
  Spitter a sand toad and the Sunbaked Colossus a sandstone golem.
- Rock meets the floor through a soft contact shadow and dust instead of a hard
  line, and cliff feet are rounded curves instead of a staircase.
- Maps have rounder corners and fewer long straight walls. Open desert and
  forest ground has natural edges instead of square mounds.
- Standing still, a sword strike moves the legs with the swing and keeps the
  feet planted.
- The Ironsworn hits less hard: Heavy Strike and Strike lost the bonus that
  made the first maps much faster for him than for the casters.
- The see-through hole behind cliffs is smaller and softer.

### Fixed

- Portal is no longer a skill gem. It never takes a slot on the skill bar.
- The Cinder Warden no longer freezes between pillars on its way home.
- A robe's front panel hangs still while the character breathes.
- A knee no longer whirls around during a strike.
- The Vaal Construct's fist no longer walks with its feet, and the Hoarfrost
  Spitter's antlers are no longer its hands.

## [0.3.0] - 2026-10-11

Alpha. A save may not survive an update yet.

### Added

- Monsters and bosses have real bodies. Thirteen monsters and all four bosses,
  the Cinder Warden, Sirrath, Mother Vhal and Ghaltrek, are full creature meshes
  now instead of stacked shapes, each walking and idling on its own rig, and the
  Fen Wisp floats. The death recap shows the creature that killed you.
- The world has music and sounds like a place. Every area plays its own music,
  picked at random and never the take it played last, and the main menu has its
  own. Sounds come from where they happen and travel the way they would in a
  cave, a swamp or out on the beach, every effect has several takes so nothing
  repeats, items lift and land in their own material, and Varkis speaks.
  Ambience has its own volume slider.
- Maps are different every run. Opening a map rolls a fresh layout every time,
  even from the permanent Waystone, so the same node is never the same walk twice.
- A new character chooses click-to-move or WASD, Path of Exile 2's two control
  schemes, and the keys follow the choice. Options switch it later.
- In click-to-move, clicking a monster out of reach runs to it and swings once
  you get there, the way Path of Exile does it. Shift attacks in place.
- Graphics presets, a medium shadow setting, and Auto, which picks a preset for
  your graphics card and steps down when the game drops under 55 frames a second.
- Shift and right-click on a currency stack spends it on every item in your
  backpack that accepts it, one each, until the stack runs out.
- Energy shield always regenerates 1% of its maximum a second, with the delayed
  recharge on top.

### Changed

- The first maps are kinder. Monsters hit about half as hard, bosses keep their
  own numbers, and every kill heals you 4% of your maximum life.
- A boss stays in its arena. Lead it more than 16 units from where it stood and
  it walks back home, with the life it had left.
- Burning ground catches from its middle outward and burns out from its rim,
  with a glowing edge, instead of popping in and shrinking away.
- Y opens a portal for free in an open map, the way Path of Exile 2 does it.
  Portal Scrolls only come from the vendor, so most characters had none.
- A hit shows: the body flashes, glowing shards fly off the side that was struck,
  a few dark drops fall away from the blow, and the screen shakes by how heavy
  the skill is.
- Desert, forest and swamp cliffs are real rock instead of masonry.
- Panels and dialogs fade in and out, and each menu screen rises out of black.
- Varkis wears the full Ember set instead of the bare body.
- The passive tree pauses the game while it is open.
- Monster health bars are on by default.

### Fixed

- A map can no longer trap you. A chest or a brazier in a narrow doorway could
  close off the room behind it, and a monster could spawn where nothing could
  reach it.
- A held walk or cast no longer keeps going after you let go of the key.
- Melee hits, bolt impacts and arrows land on the body they hit, not on its
  centre or its aura ring.
- First casts and newly spawned monsters no longer stutter: everything compiles
  under the loading screen.
- A waystone dropped onto the map device stays seated.
- Reward chests no longer stand inside cliff rock.
- A brazier keeps its fire light.
- The body holds a cast's direction through the wind-up and no longer leans back
  when you attack while backing away.
- The create screen dresses the class you picked while it was still loading.

## [0.2.0] - 2026-10-02

Alpha. A save may not survive an update yet.

### Added

- Every character has an attack that costs nothing. The Ironsworn swings at what
  is in front of him and catches two of them if they crowd the doorway; the
  Stalker looses an arrow; the Emberbound throws a mote of fire. None of them
  need mana, so running the pool dry no longer leaves you standing there.
- The braziers burn. Every bowl in the hideout and out on the maps now stands a
  real flame in it, built out of geometry rather than painted on a card, with a
  white-hot core, a tongue that tears at the top and sparks that leave it.
- Skills unlock as you level and get stronger on their own kills. Every skill on
  your bar earns a share of the experience a kill pays, hits harder and costs
  more mana as it climbs, and gets a real upgrade at levels 5 and 15: Ember Bolt
  starts piercing, Cinder Ground scorches a wider patch, not just bigger
  numbers. A maxed skill runs a fixed mana pool dry faster than a fresh one, so
  the payoff for levelling one all the way is real but not free. Your free class
  attack levels too, on its own account: it takes nothing from the skills you
  chose, but it does not stay a level-1 stick forever either, and the Ironsworn
  who keeps swinging eventually sweeps the whole circle around him.
- The hideout keeps your life, mana, energy shield and both flasks full, the way
  a town does in Path of Exile.

### Changed

- New characters start at level 1 instead of level 65, and the climb now runs
  the whole way to 100. The Atlas starts at area level 8 and the highest tier
  sits at 92, so the first map is a fair fight for someone just out of
  character creation instead of a shove into the deep end. Life and mana from
  levelling, and points on the passive tree, are spread across the longer
  climb rather than handed out all at once, so a level still feels like
  something happened.
- Ember Bolt pauses between bolts when you hold the button. Its cooldown used to
  sit under its own wind-up, so holding the button chained casts nose to tail and
  only the first bolt ever looked like it cost anything. Each bolt now starts
  from rest, and the DPS on the tooltip quotes the rate you actually get rather
  than the one the wind-up alone implied.
- The fire in the main menu is many small embers instead of a few fat ones, so
  it reads as flame rather than as a lamp behind glass.
- Portals are a tear rather than a lit oval: a ragged cyan arc round a hole that
  goes black in the middle, with broken shards turning slowly inside it.
- Boulders stand at the edge of a map now instead of inland, and the rock is
  darker, so a cave reads as a cave without a cliff growing between you and your
  own character.
- Melee alternates two real slashes now. The second is the first swing carried
  round onto a downward diagonal, so hitting twice reads as two cuts instead of
  a sword swing followed by a punch.
- Character select and creation show each class in its starting kit, standing
  on the painted floor at the angle the hall was painted from, with fire burning
  in the braziers behind him.

### Fixed

- Plate armour is metal again instead of a black cut-out. A metal surface has no
  diffuse colour of its own - all it can show is what is around it to reflect -
  and there was nothing around it, so the steel came out black wherever the sun
  did not land square on it. The scene now carries a sky and a ground for it to
  catch.
- A cast plays at the speed it actually casts at. The clip ran at its authored
  rate whatever the wind-up was, so a quick spell only ever showed the first
  third of the motion and the bolt left a hand that was still lifting; held
  down, it looked like the skill was firing instantly. It now finishes on the
  hit and settles back to idle.
- Skills can be dragged between the numbered slots again. The icon itself was
  being picked up instead of the slot under it.
- The ground no longer flickers black squares where it meets the rocks.
- Pressing R stopped emptying your inventory and your equipment. It was a
  leftover greybox key that replaced the character with an empty one and then
  saved it.
- Keys typed into a text field (a bug report, the vendor's highlight search) no
  longer walk, cast or open panels.
- The skill picker offers only your own class's free attack, not the other
  classes' Strike, Snap Shot and Ember Spark.
- An equipped item can be dropped on the ground by releasing it outside the
  inventory panel.
- The HUD no longer redraws thirty times a second while nothing on it changes.

## [0.1.0] - 2026-07-30

Alpha. A save may not survive an update yet.

### Added

- Bodies fall over when they die: Havok drives a ragdoll off the character and
  creature skeletons, and corpses lie where they land for six seconds.
- A monster shows the hit it just took, and a bolt leaves the casting hand
  rather than the middle of the chest.
- Sound has distance and a room: a far cue is quieter and duller, and how much
  it rings is the biome's, so a Vaal hall answers and open sand does not.
- Report a Bug and Feedback in the pause menu, both filing a pre-filled GitHub
  issue with the build attached.
- The game installs from the browser and keeps what it has downloaded.
- Torch warmth is a slider, the graphics tab has a reset, and the Life and Mana
  numbers can be switched off.
- New characters start with gold, enough to open the shop with.

### Changed

- The game is set in its own typefaces, Cinzel for titles and EB Garamond for
  anything that is a sentence.
- Escape actually stops the world instead of saying "Paused" while a fight
  carries on behind the panel.
- The run keeps its pace through a turn, and a body standing still settles into
  a slower breath.
- The wheel zoom is slower and speed-limited, and every notch still counts.
- Loading plates are vignetted, the minimap fog feathers, and the menu's fire
  burns slower with sparks coming off it.

### Fixed

- Names stay over the heads they belong to at every zoom and while running.
- The item tooltip lets go when the cursor leaves, whatever the sim did to the
  item underneath it.
- The tab title says where you are.
- The life and mana globes lost the hairline across their middle.
- Walking into the hideout no longer plays six portals shut under the plate.
