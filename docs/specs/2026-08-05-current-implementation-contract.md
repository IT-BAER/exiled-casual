# Exiled Casual: current implementation contract

Status: **as built and verified on 2026-08-08 at `1cb32e3`.**

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

- TypeScript npm-workspaces monorepo on Node 22.
- React 19 owns menus and heads-up display (HUD); Babylon.js 9 owns the 3D world.
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

A map left with portals to spare is still standing when the character comes back. Leaving freezes
the area's whole population into a snapshot and returning restores it, so the pack that was thinned
is still thinned, the container that was opened is still open, and the loot that would not fit is
still on the floor. It is a snapshot and not a second world running in the background: nothing about
a cleared corridor changes while the player is in the hideout, so a suspended map costs nothing per
tick. Cooldowns come back holding the time they had left rather than the time spent away, and
transient things - a projectile in flight, burning ground, a wind-up - are moments and do not
survive. The snapshot lives with the simulation instance, not in the save: a reloaded session has no
map standing anywhere, which is the same rule restore already applied to an in-flight run.

There is one way home per area, and opening a new one replaces it. Inside a map every portal leads
to the same hideout, so a second is never a second destination. A dead map boss opens one for free
where it fell, PoE2's rule rather than PoE1's, because the alternative is a walk back across a
cleared map with a full bag. Anywhere else the character opens it: the Portal skill on `Y`, which is
also what right-clicking a Portal Scroll fires, so the hotkey and the icon are one action with one
cost (a scroll), one two-second wind-up and one ten-second cooldown. A cast that opens nothing -
no scroll, or the map closed underneath it - refunds the cooldown rather than charging for nothing.

A completed Atlas node can be run again with another stone, PoE1's rule; completion feeds fog,
tiers and the boss's first-clear reward, and never locks a place out.

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

### The passive tree

The tree is 239 nodes across eight disciplines, generated from authored tables rather than placed
one at a time: the tables carry the design (which disciplines exist, what each cluster is about,
what a keystone costs) and the geometry is a rule, so no link can point at a node that is not there.
Clusters of small nodes ring a notable, cheap travel nodes bridge neighbouring disciplines two rings
in, and four keystones hang past the rim. Each keystone is a trade rather than a bigger notable.

Three class doors open onto the two nearest disciplines each, so no class is born inside one. A
character has 24 points at level 65 and two a level to the cap, which is 94 - enough to walk two
disciplines and a keystone, never enough to walk all eight. Allocation is the PoE rule in one
sentence: a node may be taken when it touches something already allocated, and the door counts as
allocated. Refunding is free and total.

Every node's effect is an `ItemStatMod`, the same currency gear speaks, folded by the same
`applyItemMods`: a passive and a chest piece cannot drift apart. That is also why no keystone
changes a RULE - the simulation has no hook for one, and a keystone whose text lies is worse than
one that trades numbers honestly. The simulation owns both halves of allocation because the client
is untrusted; `P` opens the tree, and an unspent point announces itself over the experience rail.

### Balance

Monster life and hit are per archetype rather than per species: what differs biome to biome is the
element and the flavour. The current numbers are a deliberate casual pass - life down 25 percent and
hit down 30 percent against what `balance.test.ts` had measured - taken because the first map was
too hard for the audience this game is for. Every band in that suite was re-measured against the
same rig rather than re-argued: killing got about a quarter faster, dying about half again slower.

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
inventory, stash, character sheet, passive tree, preparation panel, Atlas, death panel, buff bar,
corner minimap, and a centred Tab overlay map. The map overlay has configurable opacity.

The tree is drawn as SVG from `@exiled/rules` directly, because the tree itself is content the
client already has and only the allocation crosses the wire. It opens on the character's own door
rather than on the whole wheel, pans by drag and zooms by wheel, and a click is a request: nothing
changes until the snapshot says the simulation accepted it.

Loading has three real covers: static first boot, lazy game chunk, and area rebuild. Area loading
stays up until the worker area message has arrived, level and biome art are built, the scene rig is
ready, and a frame from the new area has actually painted.

Everything a run can ask for later is warmed while that plate is up. The whole sound library goes,
not a core subset: fifty-odd Opus cues are 1.2 MB between them, so the split was only ever ordering,
and core still goes first. The textures nothing fetches until it is needed - the fire sheet on the
first cast, an item icon on the first drop, a gear texture on the first piece equipped - are listed
in `render/world-art.ts` and warmed at mount, with a test that walks `public/textures` so the list
cannot rot behind a new asset. Container shaders are compiled behind the plate for the same reason:
an asset container is held out of the scene, so `executeWhenReady` never sees it and its first
instance would otherwise compile as it first drew. The texture warm is deliberately NOT part of the
gate the first frame waits on - a file that 404s or stalls must not be able to hold the door shut.

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
- support gems, weapon-set switching, and broad skill/content progression;
- a public playable deployment;
- damage numbers and their protocol events;
- controller and touch interfaces;
- the production-scale content counts proposed by the research pack.

These remain future specifications. They must not be described as current capability in the README,
website, or dated slice documents.
