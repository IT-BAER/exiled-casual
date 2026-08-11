# Changelog

All notable changes to this project are recorded here, in the shape
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) gives it, with versions
following [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The top released section is also what the main menu shows under LATEST. It is
not copied by hand: `node tools/changelog_to_news.mjs` reads this file and
writes `apps/web/src/news.generated.ts`, and a test fails if the two disagree.

## [Unreleased]

### Changed

- New characters start at level 1 instead of level 65, and the climb now runs
  the whole way to 100. The Atlas starts at area level 8 and the highest tier
  sits at 92, so the first map is a fair fight for someone just out of
  character creation instead of a shove into the deep end. Life and mana from
  levelling, and points on the passive tree, are spread across the longer
  climb rather than handed out all at once, so a level still feels like
  something happened.

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

### Changed

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

### Changed (animation)

- Melee alternates two real slashes now. The second is the first swing carried
  round onto a downward diagonal, so hitting twice reads as two cuts instead of
  a sword swing followed by a punch.

### Fixed

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
