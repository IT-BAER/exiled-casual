# Changelog

All notable changes to this project are recorded here, in the shape
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) gives it, with versions
following [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The top released section is also what the main menu shows under LATEST. It is
not copied by hand: `node tools/changelog_to_news.mjs` reads this file and
writes `apps/web/src/news.generated.ts`, and a test fails if the two disagree.

## [Unreleased]

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
