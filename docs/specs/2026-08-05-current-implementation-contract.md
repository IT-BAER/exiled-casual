# Exiled Casual: current implementation contract

Status: **as built and verified on 2026-08-06 at `9051f42`.**

This is the living specification for what the repository implements now. Earlier dated specs
preserve the decision and delivery history of individual slices. Where an older proposal differs
from this document, current code and contract tests win, then this document should be updated.

## 1. Product boundary

Exiled Casual is an original browser-native action RPG inspired by Path of Exile 1 and 2. It takes
the stronger interaction or presentation choice from either game when they differ, and records the
source of borrowed design grammar. Names, fiction, code, balance, art, and shipped content are
original or appropriately licensed.

The game is a local work in progress. `https://exiledcasual.com` is a public teaser, not a playable
deployment. There is no account service, remote game server, multiplayer, or public economy.

## 2. Runtime architecture

- TypeScript npm-workspaces monorepo.
- React owns menus and heads-up display (HUD); Babylon.js owns the 3D world.
- The authoritative 30 Hz entity-component-system simulation runs in a Web Worker.
- The main thread sends intents. The simulation re-checks range, cost, placement, tier, and state,
  then emits snapshots. The renderer never authors an outcome.
- Authoritative spatial and combat values use fixed-point integers. Randomness uses named seeded
  streams, and replay/checksum tests guard deterministic behavior.
- `@exiled/rules` remains a pure leaf. Content definitions live in `content-runtime`; validators and
  shared shapes live in `content-schema`.

The current authority boundary is local, but it is the same boundary a future WebSocket transport
must preserve. A remote server must run the same simulation package rather than fork the rules.

## 3. Boot, menus, and saves

`App.tsx` is a screen router for main menu, mode choice, character selection, character creation,
information, and game. `GameView` and the menu character stage are lazy-loaded so the menu does not
pull Babylon and the simulation into the entry bundle.

The local save is a versioned roster in IndexedDB:

- one local character (`LOCAL_CHARACTER_CAP`), with an unlimited shape reserved for online mode;
- three classes: Ironsworn, Stalker, and Emberbound;
- one opaque simulation state per character;
- a shared stash and global settings beside the character records;
- a narrow v2 single-save to v3 roster migration, applied on read and committed on the next write;
- validated JSON export and atomic replacement import.

Local and future online character pools are separate. The online choice is visible but refused
until accounts and server verification exist.

## 4. Current play loop

```text
Create or select character
  -> enter hideout
  -> interact with Map Device
  -> socket an owned Waystone and choose a reachable Atlas node
  -> activate six portals
  -> enter the seeded area
  -> fight biome-specific packs and boss
  -> collect items, currency, and Waystones
  -> complete the node and reveal adjacent routes
  -> return to hideout to equip, craft, stash, buy, sell, or run again
```

The Atlas contains 15 seeded-position nodes. The node supplies place, map base, and reachability;
the Waystone supplies tier, seed, and modifiers. Map activation consumes the selected inventory
stone, except for the unmodifiable permanent Tier 1 floor stone that prevents a hard lock.

Six portals are the run budget. Leaving through a portal or accepting a revive spends one. A map
closes at zero. Map entry and checkpoint revive grant ten seconds of spawn grace, broken by moving
or casting. Boss death completes the active node once and pays the deterministic Waystone return.

That return has a floor. A hop between Atlas nodes costs two tiers while a plain run hands back the
tier it was opened with, so clearing a map could leave a character holding nothing able to open
anywhere new. The boss's best stone is raised to the cheapest tier among the not-yet-run routes out
of the cleared node, and a stone opens anything at or under its tier. The floor never pays less than
the run's own tier, so the Atlas stays a route decision rather than a wait for a lucky roll.

## 5. Combat and characters

The three classes share the core skill set but each has a class-specific free default attack:
melee Strike, Snap Shot, or Ember Spark. Ember Bolt, Cinder Ground, and Blink provide the common
starter vocabulary. Cast wind-up, cooldown, movement penalty, held-input repeat, aim, facing,
resources, critical strikes, ailments, ground effects, flasks, death, and revive are
simulation-owned.

Two of those are worth stating exactly, because the client can only follow them:

- **Facing.** A character standing still turns toward what he casts at, at the same bounded rate the
  movement keys turn him. Running, the cast is ignored and the run keeps the body, which is what
  makes run-and-gun readable. The aim rides on the held-skill component rather than the casting one,
  because an instant skill leaves no cast behind to turn toward between one bolt and the next.
- **Action pacing.** A held button re-fires on the longer of the wind-up and the cooldown, so for
  every shipped skill that is the cooldown. The simulation therefore hands the renderer that repeat
  interval, not the wind-up, and the arm clip is stretched to fill it. Pacing the clip by the
  wind-up alone played it at roughly twice speed and left the arm idle for the rest of the beat.
  The hit still lands on the wind-up tick; only the animation rate moved.

Monster content has four combat archetypes:

- swarms multiply bodies per spawn socket;
- brutes apply direct melee pressure;
- shooters stop at range and create faction-aware projectiles;
- heavies root for a committed ground telegraph.

Five biome pools select among 13 regular species and four bosses. Monsters route around blocked
movement through a body-radius navigation field. Every species has idle, walk, and one-shot strike
clips; the snapshot attack tick, not client timing, triggers the strike.

## 6. Areas, biomes, and rendering

Chunk-built areas use a 9 by 9 lattice of 16-cell authored tiles. Loop, open-field, and sunken-ruins
grammars share the same assembler and derived edge-mask contract. Vaal Stone uses loop, Desert and
Forest use open-field, and Swamp uses sunken ruins.

Coast is a separate deterministic generator because a beach is open land between one shoreline and
one cliff, not a corridor. It emits explicit water cells plus a floating shoreline curve. The
renderer builds wet sand, surf, shallows, swell bands, and deep water from that curve, then dresses
the beach with shells, driftwood, weeded rock, wreck timber, and bones. Coast is the starting Atlas
biome.

Death is drawn, not simulated: the simulation owns the kill, and the client owns the body. A dead
monster becomes a physics ragdoll thrown by the blow that killed it, aimed at chest height and a
random step off the centre line so the body turns as it goes down. When a projectile was standing on
the body the tick before it vanished, that projectile is the blow, which is the only attribution the
client can actually know. The corpse then lies where it fell for 25 seconds and sinks through the
floor over three, so the disappearance reads as burial rather than a pop. Physics has to be released
before the sink starts, because in ragdoll mode every bone is rewritten from its box each frame and
a lowered root is otherwise cancelled on the same frame.

The player uses one wardrobe glTF containing all supported slot looks on a shared 65-joint rig.
Equipped bases select visible meshes and generated per-base textures without replacing the skeleton.
Monsters use one multi-species glTF. Props and rocks are built offline from sourced or generated
masters, then loaded once and cloned at runtime.

## 7. Items and rewards

Items support normal, magic, rare, and unique rarity; base implicits; prefix/suffix affixes; item
level; identification; inventory geometry; equipment slots; derived character stats; and grounded
loot entities. The 12 by 5 backpack, shared stash, vendor shelf, and equipment paper doll use the
same authoritative item instances.

Current interactions include pickup, drag placement, equip/unequip, ground drop, quick transfer,
vendor buy/sell, disenchanting, flasks, identification, crafting currency, and Portal Scrolls.
Waystones are 1 by 1 inventory items and use their own deterministic modifier rules rather than the
equipment affix pool.

Rewards roll when they become world objects. Loot labels, beams, sounds, boss bursts, containers,
and unread-item presentation make the result visible and audible. Reward anchors create clickable
containers that spill once; every authored reward marker pays outside the spawn-safe radius.

## 8. HUD, loading, settings, and audio

The game shell includes life/mana globes, flasks, two-row skill bar, experience rail, loot labels,
inventory, stash, character sheet, preparation panel, Atlas, death panel, buff bar, corner minimap,
and a centred Tab overlay map. The map overlay has configurable opacity.

Loading has three real covers: static first boot, lazy game chunk, and area rebuild. Area loading
stays up until the worker area message has arrived, level and biome art are built, the scene rig is
ready, and a frame from the new area has actually painted.

Settings are global roster data and apply live. Current controls cover shadows, ambient occlusion,
bloom, atmosphere, resolution scale, torch warmth, master/mute plus music/interface/skills/loot/
environment mix, minimap, loot labels, globe numbers, overlay-map opacity, and skill-bar assignment.

Audio is snapshot-diff driven through one bus, never a call at the dispatch site, so a cue fired on
the press cannot lie when the simulation refuses the cast. The diff carries one rule worth stating:
a first snapshot is not an event. The session's opening area message is a restore rather than a
journey, and in development it arrives on every hot reload, so neither the arrival cue nor the
crossing cue may fire on it.

Curated cues cover interface, skills, impacts,
movement surfaces, loot, portals, monsters, and environment. Five ambience beds are selected by
area or biome; Coast currently takes the cave fallback until it receives a dedicated bed.

## 9. Development affordances

These exist because some of the work cannot be judged from a test, and none of them ship:

- `F3` shows a performance readout. Render-only, and available even on the death screen, so it is
  the one key not gated behind a development build.
- `F4` opens an asset menu that stands one chosen prop or species on the hideout floor at a time,
  which is how a model is inspected without hunting for it in a map. Development builds only.
- `?play&map=<node>&revealed` opens a map with no clicks and un-fogs the minimap, the only way to
  read a layout without walking it. The harness has to let the session settle first, because the
  worker starts its clock and hydrates the save asynchronously and an activation accepted inside
  that window is overwritten by the restore.
- `__sea({...})` rebuilds the coast water in place from a development console, because the surf
  numbers are not guessable and the first pass at them was invisible.

## 10. Verification contract

Every change must pass:

```text
npm run typecheck
npm test
npm run build -w apps/web
```

High-risk contracts also have focused tests: replay checksums, map reachability and edge matching,
content referential integrity, item/equipment consistency, roster migration/import, scene-scoped
asset loading, and UI-art preload coverage. Visual work additionally requires comparison against
the checked-in local reference screenshots and an approved devlog capture for major visible steps.

## 11. Deliberately not implemented

- accounts, login, remote persistence, remote authoritative simulation, parties, and trade;
- passive tree, support gems, weapon-set switching, and broad skill/content progression;
- a public playable deployment;
- damage numbers and their protocol events;
- controller and touch interfaces;
- the production-scale content counts proposed by the research pack.

These remain future specifications. They must not be described as current capability in the README,
website, or dated slice documents.
