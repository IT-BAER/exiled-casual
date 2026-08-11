# Skill identity and area music

Two independent pieces in one spec, sharing no code: every skill gets its own look and voice, and
areas get music under the ambience that is already there.

## Part 1: skill identity

### The problem, stated exactly

The renderer cannot tell one skill from another. `SnapshotEntity` (`packages/protocol/src/index.ts`)
carries no skill id on a projectile, and `apps/web/src/render/meshes.ts:1607` chooses FX with
`kind === "projectile" ? attachBoltTrail : attachCinderFX`. Ember Bolt, Ember Spark and Snap Shot are
therefore the same orange trail by construction, not by content shortfall. Sound is half-solved: cast
cues are already per skill in `CAST_SFX`, but flight and impact branch on `kind` the same way
(`apps/web/src/audio/soundscape.ts:194`).

No damage type changes. The Emberbound's kit stays fire; what changes is that each skill reads as a
different fire. Nothing here touches the sim's numbers, so no balance band moves.

### The wire

`SnapshotEntity` gains `skillId?: string`, set on `projectile` and `groundArea` entities. This is the
exact precedent of `species` on monsters, including its rule: a plain string, because the wire
contract must not depend on content. `ProjectileC` already carries `damageType` but not the id, so
the sim keeps the skill id at spawn and the serializer passes it through.

Damage type is deliberately NOT the key. Ember Bolt and Ember Spark are both fire, and the whole
point is that they stop looking alike.

### The profile table

`SKILL_FX: Record<string, FxProfile>` in `apps/web/src/render/skill-fx.ts`. One profile holds:

- core colour and wake colour
- emissive level
- particle rate, size and lifetime
- trail shape
- impact burst
- the flight and impact cue names

`meshes.ts` looks the profile up by `skillId`. An absent or unknown id falls back to today's bolt
trail, so monster projectiles and any future skill keep working rather than throwing.

### The three identities

| skill | reads as |
|---|---|
| Ember Spark (free) | small pale-yellow mote, thin sparse trail, quick and dry — cheap on purpose |
| Ember Bolt | white-hot core with a deep orange wake, heavier and slower, bursting into a ring of embers on impact |
| Cinder Ground | no projectile: smouldering floor glow, slow rising smoke, drifting sparks that outlive the patch |

Blink keeps its existing burst. Strike and Snap Shot get profiles too, since the table costs nothing
once it exists, even though they belong to the other two classes.

### Flashy but soft

Colour and motion carry the identity, never brightness. Emissive cores sit just above the glow
threshold and let the existing global `GlowLayer` (`render/engine.ts:703`) do the softening.

Bloom is a user-toggleable graphics setting (`engine.ts:262`), so **every profile must still read
with bloom off**. That is a hard constraint, not a preference: size, silhouette, speed and particle
density must differ between skills, so colour alone is never the distinction.

### Sound

Flight and impact become tables keyed on `skillId`, in the same shape as `CAST_SFX`, replacing the
`kind === "projectile"` branch. Enemy projectiles keep their existing `monster-spit` path, which is
already selected by `team`.

New masters are curated from the Sonniss bundles through the existing `tools/import_sfx.py` ->
`tools/trim_sfx.py` -> `public/audio/` pipeline, and named in `SOURCES`. Never feed Sonniss audio to
a model: the licence forbids training or conditioning on it.

### Tests

`skill-fx.test.ts` gains two guards, in the idiom of `rig.test.ts`'s look guard:

1. Every skill id in `@exiled/content-runtime` resolves a profile, so adding a skill fails here
   before it can ship as a white slab.
2. An unknown skill id returns the fallback profile rather than throwing.

The wire addition is pinned in the protocol's own tests: a projectile snapshot round-trips its
`skillId`, and one without it still validates.

## Part 2: area music

### What already exists

`SoundCategory` in `apps/web/src/audio/bus.ts` already has `music`, `settings.ts` persists its level
and `OptionsPanel.tsx:241` renders its slider. Nothing plays on it. Meanwhile `sfx.ts:132` routes
every `ambient-*` loop to `music`.

So the slider a player reads as "Music" currently controls the ambience beds. This spec moves
ambience to `environment` and gives `music` to music. **That silently changes what both existing
sliders do for anyone with a saved settings blob** — accepted, because the alternative is a slider
that lies permanently.

### Playback

New `apps/web/src/audio/music.ts`, exposing `setMusicArea(area: BiomeId | "hideout")`.

Streamed through `HTMLAudioElement` + `MediaElementSource` into the existing music gain, not
`decodeAudioData`: a three-minute track decodes to roughly 30 MB of resident PCM, and streaming costs
one node and no preload.

Behaviour:

- looping, 2 second crossfade between tracks
- a call naming the area already playing is a no-op, so re-entering a biome never restarts the track
- driven off the snapshot diff, the same discipline as `audio/soundscape.ts`: the area the sim says
  the player is in, never the intent that asked to go there

### The two gates before anything ships

1. **Licence.** `review/audio/cc0-fantasy-music/manifest.csv` records each track as
   "CC0 (collection listing; verify individual page)". Every OpenGameArt page is verified
   individually; only verified tracks ship, and the verification is recorded in `SOURCES` with the
   observation date. An unverifiable track is dropped, not shipped hopefully.
2. **Selection.** Claude cannot hear audio. The biome mapping is proposed from titles and source
   pages and confirmed by the owner by ear before conversion.

### Delivery

Verified tracks are converted to ogg into `public/audio/music/`, kept out of the service worker's
precache list so the first load does not pull megabytes of music before the game starts.

### Tests

`music.test.ts` pins the crossfade state machine (a second call crossfades, a repeat call is a no-op)
and that every biome plus the hideout resolves a track, so a new biome fails here rather than
entering in silence.

## Out of scope

- New skills. The kit stays as authored; only its presentation changes.
- Damage type changes, and therefore any balance re-measurement.
- Boss music and combat swells. Per-area loops only.
- Music in the menus.
