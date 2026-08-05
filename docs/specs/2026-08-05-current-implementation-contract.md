# Exiled Casual: current implementation contract

Status: **as built and verified on 2026-08-05 at `c4d801c`.**

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

## 5. Combat and characters

The three classes share the core skill set but each has a class-specific free default attack:
melee Strike, Snap Shot, or Ember Spark. Ember Bolt, Cinder Ground, and Blink provide the common
starter vocabulary. Cast wind-up, cooldown, movement penalty, held-input repeat, aim, resources,
critical strikes, ailments, ground effects, flasks, death, and revive are simulation-owned.

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

Audio is snapshot-diff driven through one bus. Curated cues cover interface, skills, impacts,
movement surfaces, loot, portals, monsters, and environment. Five ambience beds are selected by
area or biome; Coast currently takes the cave fallback until it receives a dedicated bed.

## 9. Verification contract

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

## 10. Deliberately not implemented

- accounts, login, remote persistence, remote authoritative simulation, parties, and trade;
- passive tree, support gems, weapon-set switching, and broad skill/content progression;
- a public playable deployment;
- damage numbers and their protocol events;
- controller and touch interfaces;
- the production-scale content counts proposed by the research pack.

These remain future specifications. They must not be described as current capability in the README,
website, or dated slice documents.
