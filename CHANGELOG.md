# Changelog

All notable changes to this project are recorded here, in the shape
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) gives it, with versions
following [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The top released section is also what the main menu shows under LATEST. It is
not copied by hand: `node tools/changelog_to_news.mjs` reads this file and
writes `apps/web/src/news.generated.ts`, and a test fails if the two disagree.

## [Unreleased]

### Added

- The braziers burn. Every bowl in the hideout and out on the maps now stands a
  real flame in it, built out of geometry rather than painted on a card, with a
  white-hot core, a tongue that tears at the top and sparks that leave it.

### Changed

- The fire in the main menu is many small embers instead of a few fat ones, so
  it reads as flame rather than as a lamp behind glass.
- Portals are a tear rather than a lit oval: a ragged cyan arc round a hole that
  goes black in the middle, with broken shards turning slowly inside it.

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
