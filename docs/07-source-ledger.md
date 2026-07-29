# Source Ledger, Confidence, and Legal Boundary

Research cut: 2026-07-19. Live baseline: Path of Exile 2 Early Access 0.5.4b, posted 2026-07-02. The Atlas foundation is 0.5.0, Return of the Ancients, posted 2026-05-29.

This ledger records evidence used to understand observable mechanics. It is not a licence to reuse assets, text, data tables, or branding.

## 1. Research method

Source priority:

1. Current official patch notes or official developer documentation.
2. Current official presentation, store page, or first-party public statement.
3. Current community wiki, with page warnings and patch history considered.
4. Community databases, guides, and repeatable observation.
5. Inference needed to design the independent browser implementation.

Conflict policy:

- Newer, directly relevant official source wins.
- A current client tooltip can beat broad older prose, but data acquisition must remain lawful.
- Community formula is labeled secondary even when repeatably tested.
- Unknown internal behavior stays unknown. It becomes an original configurable decision, not a false claim.
- Historical PoE 1 engineering sources can inform architecture only. They do not prove current PoE 2 internals.

No client binary, memory, packet/protocol, undocumented endpoint, or extracted asset inspection was used for this pack.

## 2. Primary current-game sources

| Source | Date / relevance | Supports | Confidence |
|---|---|---|---|
| [0.5.4b Patch Notes](https://www.pathofexile.com/forum/view-thread/3980516) | 2026-07-02, current patch | Current boss, Expedition, endgame, Atlas passive, loot-location, and bug corrections | Primary, current |
| [Content Update 0.5.0](https://www.pathofexile.com/forum/view-thread/3932540) | 2026-05-29, current major foundation | Fortress, fixed hubs, 300+ Atlas tree, Masters, Ancient Modifiers, biome specialization, quest/farm pinnacles, map affix/reward redesign | Primary, current foundation |
| [0.5.3 Patch Notes](https://www.pathofexile.com/forum/view-thread/3968601) | 2026 | Attempted-map XP penalty and current league/endgame adjustments | Primary, current chain |
| [0.4.0, The Last of the Druids](https://www.pathofexile.com/forum/view-thread/3883495) | 2025-12 | Druid, Abyss, Fate of the Vaal, map/effectiveness and other pre-0.5 systems | Primary, superseded where 0.5 differs |
| [0.3.1 Patch Notes](https://www.pathofexile.com/forum/view-thread/3862213) | 2025-10 | Boss on all ordinary maps, boss-kill completion, tablets in Map Device, tablet uses/slots, random map content, tower role | Primary, current structural foundation unless 0.5 changes it |
| [0.3.1 endgame announcement](https://www.pathofexile.com/forum/view-thread/3860076) | 2025-10 | Design explanation for the same endgame transition | Primary context |
| [0.3.0 Patch Notes](https://www.pathofexile.com/forum/view-thread/3826682) | 2025-08 | Sprint, supports across skills, weapon-set and combat changes | Primary, superseded selectively |
| [Steam store page](https://store.steampowered.com/app/2694490/Path_of_Exile_2/) | Live marketing/store snapshot | Planned content scale, co-op, platform requirements | Primary marketing, not a live content database |
| [Terms of Use and Privacy Policy](https://www.pathofexile.com/legal/terms-of-use-and-privacy-policy) | Current legal terms | Rights claimed over game/world elements, personal/noncommercial licence, reverse-engineering and extraction restrictions | Primary legal text, obtain legal advice for interpretation |
| [Developer documentation](https://www.pathofexile.com/developer/docs) | Current API policy | Documented API boundary, identification, OAuth/rate policies, restriction on undocumented endpoint reverse engineering | Primary |
| [API reference](https://www.pathofexile.com/developer/docs/reference) | Current public schema | Item field vocabulary, sockets, flags, modifier categories, public API data shapes | Primary, API projection only |
| [Official item-filter documentation](https://www.pathofexile.com/item-filter/about) | Current | Filter block/condition/action vocabulary | Primary |
| [Asynchronous trade FAQ](https://www.pathofexile.com/forum/view-thread/3828185) | Current-system announcement | Merchant tab, offline sale, Gold fee, purchase/listing flow | Primary, later patches can adjust values |

### What 0.5.0 establishes directly

The 0.5.0 notes are the central current source for:

- Fixed Atlas points of interest.
- Intro/staged quests for major league mechanics.
- Quest and repeatable farm versions of pinnacles.
- Thirty new endgame map areas.
- Fortress creation from the first tower and fortress-driven main Atlas points.
- Main Atlas tree expansion beyond 300 nodes with eventual complete allocation.
- Switchable options at choice nodes.
- Doryani, Hilda, and Jado Atlas Masters.
- Ancient Modifiers and fortress/gateway/citadel progression.
- Tablets stacking and random content from unused slots.
- Identified-Waystone requirement.
- Waystone affix organization and explicit reward channels.
- Biome and league-hub endgame structure.

Where a current community page conflicts with it, 0.5.0 wins unless 0.5.1 through 0.5.4b changed the relevant rule.

## 3. First-party technical references

| Source | What it establishes | Limit |
|---|---|---|
| [Procedural generation presentation](https://youtu.be/EXnoHTqO7TE) | Tile keys, important-location graphs, weighted-grid routes, splines, indoor room constraints, target area/monster budget, server seed and client reproduction/hash, custom tools | High-level design from PoE development, not current private 0.5 parameters or source code |
| [Rendering Path of Exile talk](https://youtu.be/TrHHTQqmAaM) | Proprietary renderer techniques, material/effect and lighting context | Visual research, not a browser requirement or reusable shader code |
| [GDC Vault: Designing Path of Exile to Be Played Forever](https://www.gdcvault.com/play/1025784/Designing-Path-of-Exile-to) | Long-term content/procedural design rationale | Design context, older than current PoE 2 |
| [GGG 2026 hiring post](https://www.pathofexile.com/forum/view-thread/3910113) | Current in-house engine and tools, modern C++, fixed-camera-specific engine goals | Staffing text, not full architecture |
| [Developer Q&A, custom C++ engine](https://www.pathofexile.com/forum/view-thread/1866578/page/1) | Custom engine written in C++, Maya and custom export format at that time | Historical PoE 1 heritage |
| [Developer Q&A, engine rationale](https://www.pathofexile.com/forum/view-thread/1696913/page/1) | Proprietary engine and procedural-generation rationale | Historical PoE 1 heritage |
| [Performance and Stability](https://www.pathofexile.com/forum/view-thread/2645473/filter-account-type/staff) | Historical 33 ms server-side frame reference, instance pressure, client asset pressure, gameplay-vs-engine cost | PoE 1, 2019; does not verify PoE 2 tick rate |
| [Performance Improvements manifesto](https://www.pathofexile.com/forum/view-thread/1642228) | Historical lockstep behavior and client/server synchronization concerns | PoE 1 networking heritage only |
| [Developer Q&A, infrastructure scope](https://www.pathofexile.com/forum/view-thread/1870097/page/1) | Realm, security, logging, engine, tools, support, billing are major product scope | Historical organizational context |

The browser spec's 30 Hz authoritative simulation is an independent design choice informed by action-game constraints and historical evidence. It is not presented as a verified current PoE 2 server cadence.

## 4. Current official platform specification

The current [Steam store page](https://store.steampowered.com/app/2694490/Path_of_Exile_2/) lists:

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 | Windows 10 |
| CPU | Intel i7-7700 or Ryzen 5 2500X | Intel i5-10500 or Ryzen 5 3700X |
| Memory | 8 GB | 16 GB |
| GPU | GTX 960 3 GB, Arc A380, or RX 470 | RTX 2060, Arc A770, or RX 5600 XT |
| API | DirectX 12 | DirectX 12 |
| Storage | 100 GB | 100 GB, SSD recommended |
| Network | Broadband | Broadband |

These describe the native source game, not the browser product's minimums. They show the visual/content scale a full clone would be competing with. The proposed browser slice must set a much smaller initial-download, GPU, and memory budget.

The same store describes the finished-game ambition of 12 classes, 36 Ascendancies, 240 active gems, 200 support types, 1,500 passives, 700 equipment bases, and up to six-player co-op. Those categories do not map cleanly to current Early Access wiki/database row counts.

## 5. Secondary Atlas sources

| Page | Used for | Confidence notes |
|---|---|---|
| [Atlas](https://www.poe2wiki.net/wiki/Atlas) | Personal graph, UI, fog, discovery, node concepts | Current community synthesis; reconcile party/fixed-location details with official 0.5 |
| [Map](https://www.poe2wiki.net/wiki/Map) | Boss completion, current map bases/biomes/special locations, failure behavior | Current but some historical notes coexist |
| [Atlas passive tree](https://www.poe2wiki.net/wiki/Atlas_passive_tree) | Node families, point sources, biome specialization | Patch-sensitive |
| [Waystone](https://www.poe2wiki.net/wiki/Waystone) | Tier/area level, rarity/affix, drop/sustain, revive behavior | Drop details have changed repeatedly |
| [Precursor Tablet](https://www.poe2wiki.net/wiki/Precursor_Tablets) | Uses, types, slots, stacking | Official 0.3.1 confirms foundation; exact current types/effects secondary |
| [Tower](https://www.poe2wiki.net/wiki/Tower) | Current reveal/reward role | Avoid old radius behavior |
| [Death](https://www.poe2wiki.net/wiki/Death) | Campaign/map/pinnacle death and XP behavior | Party and protected-drop edge cases need observation |
| [Coalesced Corruption](https://www.poe2wiki.net/wiki/Coalesced_Corruption) | Nexus, orb, corruption-to-cleansing region state | Current community documentation |
| [Atlas Masters client-derived view](https://poe2db.tw/Atlas_Masters) | Current Master definitions and values | Unofficial database, current-data research only |
| [Ancient Modifiers](https://poe2db.tw/us/Ancient_Modifiers) | Current modifier catalogue and implications | Unofficial/database-derived; do not copy into commercial content |
| [0.5.4 data page](https://poe2db.tw/Version_0.5.4) | Expedition/Runes and current changes | Secondary, useful where official patch page is hard to query |

## 6. Secondary item/economy sources

Core pages:

- [Item](https://www.poe2wiki.net/wiki/Item)
- [Rarity](https://www.poe2wiki.net/wiki/Rarity)
- [Item level](https://www.poe2wiki.net/wiki/Item_level)
- [Modifier](https://www.poe2wiki.net/wiki/Modifier)
- [Quality](https://www.poe2wiki.net/wiki/Quality)
- [Inventory](https://www.poe2wiki.net/wiki/Inventory)
- [Equipment](https://www.poe2wiki.net/wiki/Equipment)
- [Crafting](https://www.poe2wiki.net/wiki/Crafting)
- [Currency](https://www.poe2wiki.net/wiki/Currency)
- [Augment socket](https://www.poe2wiki.net/wiki/Augment_socket)
- [Rune](https://www.poe2wiki.net/wiki/Rune)
- [Omen](https://www.poe2wiki.net/wiki/Omen)
- [Sanctified](https://www.poe2wiki.net/wiki/Sanctified)
- [Corrupted](https://www.poe2wiki.net/wiki/Corrupted)
- [Reforging Bench](https://www.poe2wiki.net/wiki/Reforging_Bench)
- [Runeforging](https://www.poe2wiki.net/wiki/Runeforging)
- [Runic Ward](https://www.poe2wiki.net/wiki/Runic_Ward)
- [Gold](https://www.poe2wiki.net/wiki/Gold)
- [Strongbox](https://www.poe2wiki.net/wiki/Strongbox)
- [Item filter](https://www.poe2wiki.net/wiki/Item_filter)
- [Vendor](https://www.poe2wiki.net/wiki/Vendor)
- [Stash](https://www.poe2wiki.net/wiki/Stash)
- [Trading](https://www.poe2wiki.net/wiki/Trading)
- [Currency exchange](https://www.poe2wiki.net/wiki/Currency_exchange)
- [Asynchronous trade](https://www.poe2wiki.net/wiki/Asynchronous_trade)

These support visible rules and vocabulary. Exact drop weights, tier probabilities, fees, reward values, and some transformation distributions remain secondary or unknown.

## 7. Secondary combat/character sources

Core pages:

- [Character class](https://www.poe2wiki.net/wiki/Character_class)
- [Attribute](https://www.poe2wiki.net/wiki/Attribute)
- [Spirit](https://www.poe2wiki.net/wiki/Spirit)
- [Charge](https://www.poe2wiki.net/wiki/Charge)
- [Rage](https://www.poe2wiki.net/wiki/Rage)
- [Glory](https://www.poe2wiki.net/wiki/Glory)
- [Combo](https://www.poe2wiki.net/wiki/Combo)
- [Energy](https://www.poe2wiki.net/wiki/Energy)
- [Leech](https://www.poe2wiki.net/wiki/Leech)
- [Recoup](https://www.poe2wiki.net/wiki/Recoup)
- [Gem](https://www.poe2wiki.net/wiki/Gem)
- [Skill](https://www.poe2wiki.net/wiki/Skill)
- [Minion](https://www.poe2wiki.net/wiki/Minion)
- [Passive skill tree](https://www.poe2wiki.net/wiki/Passive_skill_tree)
- [Weapon set](https://www.poe2wiki.net/wiki/Weapon_set)
- [Dodge roll](https://www.poe2wiki.net/wiki/Dodge_roll)
- [Sprint](https://www.poe2wiki.net/wiki/Sprint)
- [Damage](https://www.poe2wiki.net/wiki/Damage)
- [Damage conversion](https://www.poe2wiki.net/wiki/Damage_conversion)
- [Critical strike](https://www.poe2wiki.net/wiki/Critical_strike)
- [Evasion](https://www.poe2wiki.net/wiki/Evasion)
- [Armour](https://www.poe2wiki.net/wiki/Armour)
- [Resistance](https://www.poe2wiki.net/wiki/Resistance)
- [Deflection](https://www.poe2wiki.net/wiki/Deflection)
- [Block](https://www.poe2wiki.net/wiki/Block)
- [Recharging](https://www.poe2wiki.net/wiki/Recharging)
- [Elemental Ailments](https://www.poe2wiki.net/wiki/Elemental_Ailments)
- [Stun](https://www.poe2wiki.net/wiki/Stun)
- [Power](https://www.poe2wiki.net/wiki/Power)
- [Party](https://www.poe2wiki.net/wiki/Party)

Formula pages are useful, but some contain visible maintenance warnings or PoE 1-derived sections. Every formula used in code needs a patch-tagged regression fixture and an evidence note.

## 8. Known conflicts and unresolved claims

| Topic | Conflict / gap | Specification treatment |
|---|---|---|
| Dexterity Accuracy | Official 0.3 says +6; some current secondary text/tooltips have shown +8 | Use +6 for 0.5 research baseline, mark live verification required, version coefficient |
| Gem/support counts | General Gem, engravable lists, meta lists, tier/lineage database rows count different units | Never hardcode a headline count; generate categorized counts from pinned manifest |
| Atlas sharing | Atlas described as personal; official 0.5 says fixed-location completion can be shared | Personal graph plus party completion event for qualifying fixed locations |
| Waystone +1 drops | Older patch notes describe final bosses broadly; current client-derived text narrows above-tier drops to Powerful bosses | Use current behavior only after controlled confirmation; table-driven source policy |
| Waystone reforge rarity | Public sources conflict on whether three inputs must match rarity | Keep requirement behind current content data and verify in live UI |
| Tablet slot mapping | Official 0.3.1 confirms up to three and six mods enabling all three; full 0-to-6 mapping is community documented | Version table; UI derives from server result |
| Armour | Community formula well known, but page has update warnings | Use as provisional strategy with current controlled tests |
| Damage receiving order | Wiki explicitly incomplete/partly inherited from PoE 1 | Treat as capture hypothesis; write edge-case packet tests |
| Party reward curves | Current secondary tables and prose conflict | Do not claim exact parity until controlled observation |
| Unidentified item tiers | Community analysis includes stale/caution-marked thresholds | Implement mechanism with original/configurable probabilities |
| Unique tiers/weights | No official probability table | Original weighted tables; calibrate only from lawful observations |
| Vaal/sanctification outcomes | Some distributions community-derived and patch-sensitive | Confidence-tagged, versioned operation tables |
| Atlas/map generation | No current algorithm or weights published | Original deterministic generator matching high-level grammar |
| Server tick | Historical PoE 1 post references 33 ms | Proposed browser 30 Hz, not a PoE 2 factual claim |

## 9. Legal and licensing boundary

GGG's [Terms of Use](https://www.pathofexile.com/legal/terms-of-use-and-privacy-policy) state broad rights over graphics, logos, text, images, gameplay/world elements, in-game names, characters, locations, and virtual items/properties. They grant a limited personal, noncommercial licence and prohibit actions including client/data modification, extraction, and reverse engineering of technical processes or communication protocols without approval.

Practical boundary:

- Do not copy Path of Exile or Path of Exile 2 names/logos into the product title.
- Do not copy icons, UI frames, item art, map art, textures, meshes, animations, sound, music, VFX, dialogue, lore, flavor text, or distinctive labels.
- Do not extract client files/data, inspect memory, or reverse engineer network/protocol behavior.
- Do not reproduce exact map layouts or boss audiovisual expression.
- Do not assume public wiki/database presence means commercial reuse permission.
- Do not copy entire current item, passive, skill, monster, or modifier databases.
- Use public behavior as a mechanics reference, then create independent rules data and tune it.
- Get qualified legal review before public/commercial release.

The official [developer docs](https://www.pathofexile.com/developer/docs) restrict use to documented endpoints and impose authentication, rate, and identification requirements. A product using official APIs needs the required visible non-affiliation notice. An independently hosted game normally does not need those APIs.

### Community-source licences

The PoE 2 Wiki footer states CC BY-NC 3.0 for wiki text, with game media often having separate rights. PoE2DB identifies a CC BY-NC-SA 3.0-style licence for its site data. Noncommercial and share-alike terms are not compatible with silently copying a database into a proprietary commercial game. Treat these as research references unless counsel confirms a specific permitted reuse.

### Shipped third-party assets

Assets that ship inside the product, as opposed to research references. Every row must carry a licence that permits commercial redistribution.

| Asset | Source | Licence | Used as |
|---|---|---|---|
| `apps/web/public/models/anim-library.glb` | [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) by Quaternius (Standard) | CC0 1.0 Universal | 45 humanoid clips on a 65-bone Unreal-named rig. Idle, walk, jog and spell-cast drive the player |
| `assets/characters/Male_Ranger.*`, `Male_Peasant.*`, `T_*.png`, baked into `apps/web/public/models/wardrobe.glb` | [Modular Character Outfits - Fantasy](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) by Quaternius (Standard) | CC0 1.0 Universal | The player character and its swappable outfits, rigged to the same skeleton. The packs themselves are no longer served: `tools/build_wardrobe.py` welds them into one glb, and generates the ranger's coat and the hood cap, which no pack ships |
| `assets/characters/Base_Male.*`, `Hair_SimpleParted.*`, `T_Eye_*.png`, baked into `apps/web/public/models/wardrobe.glb` | [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) by Quaternius (Standard) | CC0 1.0 Universal | The head, neck, eyes and eyebrows, cut out of the base male, plus one hairstyle. The outfit pack above ships no head but references the face painted in `T_Regular_Male_Dark_BaseColor.png`; this is the pack that head belongs to |

Everything else that ships is made for this project: `props.glb` and `rocks.glb` are built in Blender, and every texture in `apps/web/public/textures/` (tilesets, items, interface, menu art, FX) is generated. `apps/web/public/models/` is the only directory with third-party geometry in it.

CC0 is a public-domain dedication, so there is no attribution obligation and no share-alike clause; the credit above is courtesy, not a licence term. Neither pack is derived from any Path of Exile material.

Preparation applied before check-in, reproducible from the untouched downloads:

- The animation pack ships glTF only for Godot, and that export carries a Rigify `DEF-*` skeleton that does not match the outfits' Unreal-named one. The Unreal `AL_Standard.fbx` does match, so it was converted with [FBX2glTF](https://github.com/godotengine/FBX2glTF) v0.13.1 (Apache-2.0, a build tool, not shipped): `FBX2glTF --binary -i AL_Standard.fbx -o anim-library`.
- Source textures are 4K PNGs up to 14 MB each. Downscaled to 512 px for base colour and 256 px for normal and ORM, which is generous for an actor about 150 px tall on screen. Total shipped model payload is ~7 MB, from ~300 MB of source.
- The base-character pack's free tier ships the `Superhero` proportion, and its glTF names `T_Superhero_Male_*.png`. Those image URIs were repointed to the `T_Regular_Male_*` textures already checked in (`Superhero_Male_FullBody.gltf` copied to `Base_Male.gltf`, buffer uri renamed to match). That is a rename, not a re-map: both males share one UV unwrap, so the Regular atlas is the correct texture for this mesh, and it is the reason the head matches the outfits' bare forearms exactly. The hairstyle's `T_Hair_*` uris are repointed the same way and go unused, because `build_wardrobe.py` pins hair and eyebrow uvs to a dark skin texel instead.

### Clean-room classification

| Material | Treatment |
|---|---|
| High-level mechanic such as affix rarity, map risk/reward, passive graph, socketed supports | Reimplement independently with original code, terms, data, and balance |
| Public formula with clear evidence | May inform an original rule, cite internally, version it, verify legal posture |
| Hidden drop/AI/procgen constant | Choose an original constant; optionally calibrate from aggregate ordinary play |
| Game text, art, icon, sound, lore, map, animation, boss presentation | Replace entirely |
| Public API response | Use only under API policy and purpose, do not treat as product licence |
| Wiki/database table | Research only by default; inspect licence and provenance before any import |
| Private client/protocol data | Out of scope |

## 10. Source freshness workflow

For each new patch:

1. Freeze the current rules/content manifest.
2. Read official major and incremental patch notes.
3. Diff every explicit Atlas, map, item, currency, skill, support, passive, monster, boss, party, trade, and API change.
4. Re-check community pages only for details not specified officially.
5. Mark changed, contradicted, deprecated, or still-unknown rules in this ledger.
6. Update content data and explicit migration policy.
7. Run golden replays, item simulation, map generation, sustain, economy, and browser performance suites.
8. Never mutate old saved objects without a declared migration.

Store a source record with URL, retrieval time, game patch, content hash, licence, permitted use, and confidence. Links rot and community pages change silently; a versioned research snapshot is essential for long-lived implementation.

## 11. Research conclusion

Public evidence is sufficient to specify the macro loop, state machines, visible formulas, data boundaries, and a credible browser architecture. It is not sufficient for exact numeric parity or protected content parity. The remaining work falls into three honest categories:

- Implementable now from verified visible rules.
- Calibratable through bounded, ordinary-play observation.
- Necessarily original because it is hidden, proprietary, protected, or continuously changing.

The build should preserve those categories in source metadata instead of allowing inferred behavior to masquerade as fact.

