"""Turn a library recording into a shipped game cue.

Why this exists
---------------
`trim_sfx.py` was written for MOSS renders: 48 kHz 16-bit mono, five seconds, two or
three takes in it. A commercial library file is none of those — the Sonniss masters are
96 kHz 24-bit stereo and run from one second to two minutes — so it cannot be fed to the
trimmer directly (the trimmer exits on anything that is not 16-bit mono or stereo, by
design: a silent format mismatch is how you ship a cue at half speed).

So this is the front half of the same pipeline, keeping the source's channels (a stereo
master ships stereo, a mono one mono):

  source .wav  ->  48 kHz 16-bit  ->  trim_sfx.py (find a take, shape it)  ->  Opus

The mapping from cue name to source file lives in `SOURCES` below, one line per cue,
with the library it came from in the comment: an attribution the licence does not
require but the next person reading this will want.

Run:
  python tools/import_sfx.py --lib "D:/audio-libs/extracted" --out apps/web/public/audio
  python tools/import_sfx.py --lib ... --only monster-death-stone
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

# cue name -> path under the library root, optionally `@start:duration` to pick a
# region out of a long recording. A name absent here keeps whatever is already
# shipped, so this can be filled a few at a time. A LIST is a pool of takes of the
# same event: entry k ships as `<cue>-<k>.webm`, what sfx.ts fetches for a pool. A third field,
# `@start:duration:gain_db`, levels a take against take 1 after shaping. A take may also
# be a dict `{"layers": [(path@start:duration, semitones, gain_db, at_ms), ...], "gain": db}`:
# the layers are mixed (tape-style pitch) before the trimmer, for a library with no sibling.
#
# The six materials come from `MATERIAL` in `apps/web/src/audio/soundscape.ts`, and
# the choices are literal rather than clever: a construct is hit with a hammer on
# stone and dies as a wall coming down; a husk is chitin that trembles and bone that
# snaps; a bog thing gurgles and bursts. Ember is the weak one — these three years of
# the bundle hold fire textures and fireworks but no fire IMPACT, so its death is a
# fire being put out, which is at least the right event.
SOURCES: dict[str, str | dict | list[str | dict]] = {
    # Vaal Construct, Sunbaked Colossus — carved stone.
    "monster-hurt-stone": "BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_015.wav",
    "monster-death-stone": "Justsoundeffects - Stones and Debris/DESTRClpse_Massive Wall Collapsing_JSE_SD.wav",
    # Vaal Husk, Sand Skitterer, Dune Spitter — dry chitin and bone.
    "monster-hurt-husk": "SoundBits - Vox Bestiae - Source Elements/CREAInsc_Insectoid Creature Tremble Attack Long 1_SNDBTS_VB-SE.wav",
    # Not the bone snap from the gore pack: it is a click, and the 170ms the trimmer
    # found came out 15 dB under every other cue because there is no body under the
    # transient to carry loudness. A tile cracking is the same brittle event with a decay.
    "monster-death-husk": "Justsoundeffects - Stones and Debris/CERMBrk_Ceramic Roof Tile Cracking_JSE_SD.wav",
    # Bog Drowned, Rotting Behemoth, Mother Vhal — wet and coming apart.
    "monster-hurt-bog": "SoundBits - Vox Bestiae - Source Elements/CREAAqua_Aquatic Creature Gurgling 2_SNDBTS_VB-SE.wav",
    "monster-death-bog": "Justsoundeffects - Gore Mini Pack/GORESplt_Gore Splatter 01_JSE_GMP.wav",
    # Blood Sentinel, Thornhide Boar, Bramble Whelp, Ghaltrek — meat, some of it armoured.
    "monster-hurt-beast": "Epic Stock Media - Humanoid Creatures Vol 4 - Monstrous and Undead Creature Vocalization Sound Sets/CREAMnstr_Designed Sea Beast Creature Pain Intense Yell Long 04_ESM_HC4.wav",
    "monster-death-beast": "David Dumais Audio - Monster Sound FX Pack 2/MonsterPack2_Monster09_Death02.wav",
    # Fen Wisp, Hoarfrost Spitter — nothing solid; it cracks and disperses.
    "monster-hurt-spirit": "SoundBits - Vox Bestiae - Source Elements/CREAEthr_Ethereal Entity Grim Pain Long 4_SNDBTS_VB-SE.wav",
    "monster-death-spirit": "BluezoneCorp - Ice Cracking/Bluezone_BC0278_ice_crack_break_002.wav",
    # Cinder Imp, Cinder Warden, Sirrath — burning things. These two are vocals with
    # no fire in them, and that is the known gap: the Zombie Specimens takes that read
    # right are field recordings peaking at -20 dBFS, and bringing one to the loudness
    # target asked for +21 dB, which is hiss with a squeal in it. A doused campfire was
    # the other option and it sounds like water, not like something burning stopping.
    # Wants a fire layer under it; nothing in 2023/2024/2026 holds a fire IMPACT.
    "monster-hurt-ember": "Epic Stock Media - Humanoid Creatures Vol 4 - Monstrous and Undead Creature Vocalization Sound Sets/HMNBrth_Construction Kit Male Screeching Breath Inhale Weak Squeal 05_ESM_HC4.wav",
    "monster-death-ember": "Epic Stock Media - Humanoid Creatures Vol 4 - Monstrous and Undead Creature Vocalization Sound Sets/VOXReac_Construction Kit Male Flutter Death Vocal Stuttered Long 05_ESM_HC4.wav",

    # ── The generic pair ────────────────────────────────────────────────────────
    # Only reachable for a species with no MATERIAL, which the test forbids — so
    # these are the safety net and are deliberately non-specific: a body, a throat.
    "monster-hurt": "SoundBits - Vox Bestiae - Source Elements/CREAHmn_Violent Humanoid Creature Exhale Short 4_SNDBTS_VB-SE.wav",
    "monster-death": "David Dumais Audio - Monster Sound FX Pack 2/MonsterPack2_LargeMonster11_Roar03.wav",

    # ── Monster attacks ─────────────────────────────────────────────────────────
    # `monster-melee-hit` is the PLAYER being hit at close range (soundscape.ts), so
    # it is the impact, not the swing: a designed transient with a body under it.
    "monster-melee-hit": "Epic Stock Media - Halloween Game - Haunted House and Horror Audio Scare Kit/GORESplt_Gore Designed Transient Heavy Impact Smash 01_ESM_HALG.wav",
    "monster-spit": "Epic Stock Media - Tower Defense Game/WOODImpt_Hit Blood Spill Splat Wood Impact Light Hit Squelch Small Thump 03_ESM_TDG.wav",
    # The windup has to be heard as *coming*, so it is a low whoosh rather than a
    # riser: a riser has a pitch that promises a downbeat the sim may never deliver.
    "monster-slam-windup": "Justsoundeffects - Transition Whooshes Vol. 1/WHSH_Whoosh Low 07_JSE_TW1.wav",
    "monster-slam-impact": "344 Audio - Epic Impacts Vol. 1/Impact 038.wav",
    # The other half of the same event: a spell landing on the player from range.
    # Takes 2, 3: two sharp gasps of one male voice from another pack.
    "player-hurt": [
        "344 Audio - Screaming/VOXScrm_Male in Shock 4_344 Audio_Screaming.wav",
        "Pole Position Production - The Grunts Library/Male 1 - Breathing - Gasping - Ehrlund M1.wav@13.60:0.60:1.7",
        "Pole Position Production - The Grunts Library/Male 1 - Breathing - Gasping - Ehrlund M1.wav@3.72:0.60:2.1",
    ],

    # ── Skills ──────────────────────────────────────────────────────────────────
    # Takes 2, 3 are built: no other fire whoosh exists. The same growl a tone down over a
    # fire bed, and a burning fireworks launch over the same bed.
    "skill-ember-bolt-cast": [
        "Epic Stock Media - Elemental Mutation Whooshes and Impacts/FIREWhsh_Whoosh Fire Deep Growl Monster Saturated Crisp 03_ESM_EMWI.wav",
        {"layers": [('Epic Stock Media - Elemental Mutation Whooshes and Impacts/FIREWhsh_Whoosh Fire Deep Growl Monster Saturated Crisp 03_ESM_EMWI.wav', -2, 0, 0), ('Epic Stock Media - Synthesized Nature Loops and Sounds/FIREBurn_Loop Elements Fire Crackling Crunchy Flame Burn 03_ESM_SNLS.wav@4.20:1.50', 0, -10, 0)]},
        {"layers": [('InspectorJ - Essentials 03 Fireworks/FRWKComr_InsJ_Fireworks_Launch_Close_01-03.wav@0.00:2.00', 0, 0, 0), ('Epic Stock Media - Synthesized Nature Loops and Sounds/FIREBurn_Loop Elements Fire Crackling Crunchy Flame Burn 03_ESM_SNLS.wav@0.50:1.50', 0, -8, 0)], "gain": 3.9},
    ],
    # Takes 2, 3: other packs' blasts, the mortar with a fireworks crackle for the fire.
    "skill-ember-bolt-impact": [
        "DavidDumais - Explosion SFX Pack/EXPLReal_Medium Realistic Explosion 15_DDUMAIS_NONE.wav",
        "Epic Stock Media - Anime Game/EXPLDsgn_Explosion Small Blast Enemy Death Crunchy Boom Cartoon Noisy Crash Impact Delay 03_ESM_AG.wav",
        {"layers": [('BluezoneCorp - Detonation - Explosion/Bluezone_BC0277_explosion_mortar_002_01.wav', 0, 0, 0), ('InspectorJ - Essentials 03 Fireworks/FRWKComr_InsJ_Fireworks_Multi_Close_01-04-Crackle.wav@1.96:0.60', 0, -10, 30)], "gain": -4.2},
    ],
    # Cinder ground burns for its whole duration, so this one is a fire LOOP cut to
    # its loudest 1.4s rather than a one-shot with a decay.
    "skill-cinder-ground-cast": [
        "Epic Stock Media - Synthesized Nature Loops and Sounds/FIREBurn_Loop Elements Fire Crackling Crunchy Flame Burn 03_ESM_SNLS.wav",
        "Epic Stock Media - Synthesized Nature Loops and Sounds/FIREBurn_Loop Elements Fire Crackling Crunchy Flame Burn 03_ESM_SNLS.wav@0.50:1.00:-4.6",
        "Epic Stock Media - Synthesized Nature Loops and Sounds/FIREBurn_Loop Elements Fire Crackling Crunchy Flame Burn 03_ESM_SNLS.wav@4.20:1.00:-4.6",
    ],
    # Takes 2, 3: other short airy whooshes.
    "skill-blink": [
        "CB Sound Design - Whoosh And Push/W_a_P_Spell_Whoosh_19.wav",
        "Rescopic Sound - Distinct Whooshes/WHSH_Pure SciFi-Whoosh Fast 03_RSCPC_DW.wav@0.30:0.55:-3.4",
        "Justsoundeffects - Transition Whooshes Vol. 1/WHSH_Whoosh Short 06_JSE_TW1.wav@2.80:0.60",
    ],
    # Bows are real recorded looses, the only ones in the bundles: the Nocked sampler
    # and one Super Heroes shot, both GDC 2019 (the 2024 manifest lists them, its zips
    # do not hold them). Model renders and stick swishes never read as a bow.
    # Snap Shot: the Pinaka bow's light, quick loose.
    "skill-bow-release":
        "Eiravaein Works - Nocked/Nocked,archery,firing,loose,Pinakabow,mythic,midflight,wide,hum,sizzle,energy,alt8.wav",
    # A spear shaft striking for the hit. Takes 2, 3: other strikes in the same recording.
    "skill-arrow-impact": [
        "344 Audio - Historical Weapons Vol. 2/WEAPBlnt_Spear And Stick Impact, Wooden MKH 2_344 Audio_Medieval Weapons Vol 2.wav",
        "344 Audio - Historical Weapons Vol. 2/WEAPBlnt_Spear And Stick Impact, Wooden MKH 2_344 Audio_Medieval Weapons Vol 2.wav@4.30:0.60:-3.2",
        "344 Audio - Historical Weapons Vol. 2/WEAPBlnt_Spear And Stick Impact, Wooden MKH 2_344 Audio_Medieval Weapons Vol 2.wav@8.50:0.60",
    ],
    # Melee: one large swing for every weapon skill, and a two-hander biting into a
    # body for the landing, because what it lands on is always flesh or hide.
    # Takes 2, 3: a long-blade swing and a layered sword swish from other packs.
    "skill-strike-swing": [
        "David Dumais Audio - Melee Weapons Sound Effects Pack 1/SWSH_Swing 3 Large 03_DDUMAIS_NONE.wav",
        "David Dumais Audio - Melee Weapons Sound Effects Pack 2/METLFric_SWING SCRAPE Swift Melee Weapon Swing With A Long Blade 14_DDUMAIS_MWP2.wav@0.00:0.30:-1.8",
        "Epic Stock Media - Tower Defense Game/DSGNStngr_Action Deploy Units Sword Slice Special Move Layered Swish 04_ESM_TDG.wav@0.25:0.30:-1.5",
    ],
    # Takes 2, 3: the second and fifth axe hits in the same recording.
    "skill-strike-impact": [
        "Justsoundeffects - Melee Weapons/WEAPAxe_Long Two-Handed Axe Flesh Hit_JSE_MW.wav",
        "Justsoundeffects - Melee Weapons/WEAPAxe_Long Two-Handed Axe Flesh Hit_JSE_MW.wav@2.38:1.20",
        "Justsoundeffects - Melee Weapons/WEAPAxe_Long Two-Handed Axe Flesh Hit_JSE_MW.wav@9.58:1.20",
    ],
    # Heavy Strike: plate and haft through a slow arc. The rattling metal pass, a
    # low double whoosh, and the metal pass a tone down over a slow flabby whoosh.
    "skill-heavy-strike-swing": [
        "344 Audio - Elemental Palette Designed Vol. 1/METLMisc_Metal, Slow Whoosh, Rattle, Pass By x4 01_344 Audio_Elemental Palette Designed Vol 1.wav",
        "InspectorJ - 96 General Library/WHSH_InsJ_Whooshing_Low_Double_01-01.wav",
        {"layers": [('344 Audio - Elemental Palette Designed Vol. 1/METLMisc_Metal, Slow Whoosh, Rattle, Pass By x4 01_344 Audio_Elemental Palette Designed Vol 1.wav', -2, 0, 0), ('Rescopic Sound - Distinct Whooshes/WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav', 0, -8, 0)]},
    ],
    # Ground Slam: the heave overhead before the floor breaks, deeper than any swing.
    "skill-ground-slam-swing": [
        "CB Sound Design - Whoosh And Push/W_a_P_Epic_Whoosh_8.wav",
        "Chupapsound - Essential Scifi/WHOOSH PASS SF LOW.wav",
        {"layers": [('Rescopic Sound - Distinct Whooshes/WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav', -3, 0, 0), ('InspectorJ - 96 General Library/WHSH_InsJ_Whooshing_Low_Double_01-01.wav', -4, -6, 0)]},
    ],
    # Piercing Shot: the Vaeyan bow's sleek loose with the shaft rattling away.
    "skill-piercing-shot-release":
        "Eiravaein Works - Nocked/Nocked,archery,firing,loose,Vaeyanbow,midflight,wide,mythic,sleek,swirl,rattle,alt14.wav",
    # It lands as a blade going through rather than a shaft stopping.
    "skill-piercing-shot-impact": [
        "David Dumais Audio - Melee Weapons Sound Effects Pack 1/SWSH_Sword Slash Impact V2 Assorted 18_DDUMAIS_NONE.wav",
        {"layers": [('David Dumais Audio - Melee Weapons Sound Effects Pack 1/SWSH_Sword Slash Impact V2 Assorted 18_DDUMAIS_NONE.wav', -2, 0, 0), ('344 Audio - Historical Weapons Vol. 2/WEAPBlnt_Spear And Stick Impact, Wooden MKH 2_344 Audio_Medieval Weapons Vol 2.wav@4.30:0.60', 0, -6, 0)]},
        {"layers": [('David Dumais Audio - Melee Weapons Sound Effects Pack 1/SWSH_Sword Slash Impact V2 Assorted 18_DDUMAIS_NONE.wav', 2, 0, 0)]},
    ],
    # Split Arrow: a plain bow-and-arrow shot with its flight.
    "skill-split-arrow-release":
        "2496SoundEffects - Super Heroes Sound Design/Hawk's Arrow Flies Bow and Arrow shoot 2.wav",
    "skill-split-arrow-impact": [
        "David Dumais Audio - Melee Weapons Sound Effects Pack 1/WOODImpt_Impact Wood 23_DDUMAIS_NONE.wav",
        "Cinematic Sound Design - Cartoon Bloopers/Arrow Hit Rattle.wav",
        {"layers": [('David Dumais Audio - Melee Weapons Sound Effects Pack 1/WOODImpt_Impact Wood 23_DDUMAIS_NONE.wav', 3, 0, 0), ('344 Audio - Historical Weapons Vol. 2/WEAPBlnt_Spear And Stick Impact, Wooden MKH 2_344 Audio_Medieval Weapons Vol 2.wav@8.50:0.60', 0, -8, 0)]},
    ],

    # ── Portals and the map device ──────────────────────────────────────────────
    # An airy gust that swells and falls away. The designed sci-fi vortex this
    # replaces carried a sustained partial stack under the noise, the same thing
    # portal-close was already re-picked for: it read as a struck synth string,
    # and the return portal opens at the instant a map arrives, so it was heard
    # as the map's own sound.
    # Takes 2, 3: two more wind gusts that swell and fall.
    "portal-open": [
        "Rescopic Sound - Distinct Whooshes/WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav",
        "344 Audio - Geophonic Design Vol. 2/WHSH_Whoosh 1_344 Audio_Geophonic Design Vol 2.wav@0.50:1.60:1.8",
        "toneglowlibraries - Wind and Rain Interior/Wind, Interior, Rooftop, Soft, Whoosh.wav@83.60:1.60",
    ],
    # Keep crossing distinct from the opening vortex above: a single spell whoosh is
    # the same inward gesture without the glass-shard material the old pick had.
    # Takes 2, 3: other short whooshes.
    "portal-enter": [
        "CB Sound Design - Whoosh And Push/W_a_P_Spell_Whoosh_19.wav",
        "Justsoundeffects - Transition Whooshes Vol. 1/WHSH_Whoosh Short 06_JSE_TW1.wav@5.50:0.60",
        "Marek Klemczak - ARTA Cinematic Sound FX Pack/WHSH_Whoosh_Chef Audio_Cinematic Sound FX_03.wav@0.25:0.60",
    ],
    # Air rushing out, not a power-down: the resonant electric whoosh read as a
    # guitar string; a plain wind rush is the same falling gesture with no synth.
    # Takes 2, 3: the falling half of two other gusts.
    "portal-close": [
        "344 Audio - Elemental Palette Designed Vol. 1/WINDDsgn_Wind, Rush, Whoosh, Long x5 01_344 Audio_Elemental Palette Designed Vol 1.wav",
        "Rescopic Sound - Distinct Whooshes/WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav@1.40:1.20:-3.1",
        "toneglowlibraries - Wind and Rain Interior/Wind, Interior, Rooftop, Soft, Whoosh.wav@107.10:1.20:-1.9",
    ],
    # Takes 2, 3: later rising surges of the same onslaught.
    "waystone-activate": [
        "Alexander Kopeikin - Emotion and Magic/magic, action gesture, evil presence, onslaught-004.wav",
        "Alexander Kopeikin - Emotion and Magic/magic, action gesture, evil presence, onslaught-004.wav@9.60:1.80",
        "Alexander Kopeikin - Emotion and Magic/magic, action gesture, evil presence, onslaught-004.wav@16.20:1.80",
    ],

    # ── Flask, feet, UI ─────────────────────────────────────────────────────────
    # Takes 2, 3: the same bottle a size smaller and a size larger (tape pitch), because
    # the pack holds one glass flask and a different flask was heard as a different drink.
    "flask-drink": [
        "Eiravaein Works - Flask/OBJCont_Flask,glass,figuredbottle,realcork,liquid,remove,squeak,slosh,alt4_EWKR.wav",
        {"layers": [("Eiravaein Works - Flask/OBJCont_Flask,glass,figuredbottle,realcork,liquid,remove,squeak,slosh,alt4_EWKR.wav@0:1.58", 1.5, 0, 0)]},
        {"layers": [("Eiravaein Works - Flask/OBJCont_Flask,glass,figuredbottle,realcork,liquid,remove,squeak,slosh,alt4_EWKR.wav@0:1.58", -1.5, 0, 0)]},
    ],
    # ── Feet, four grounds, three falls each ────────────────────────────────────
    # Every variant of one ground comes out of ONE recording — same ground, same mic,
    # a different fall — because two materials alternating is heard as a limp, not as
    # variety. What varies per play is pitch and level (sfx.ts, soundscape.ts), which
    # is what the ear reads as "another step" rather than "the sample again".
    #
    # The library has human footsteps on exactly four grounds: grass, mud, snow and a
    # wooden floor. No stone, no sand, no gravel — so the two hard/dry grounds this
    # game needs are a HORSE, and that substitution is deliberate rather than lazy:
    # on hard ground the surface makes the sound and the shoe only excites it, so a
    # shod hoof on pavement is the classic Foley stand-in for a boot on flagstone.
    # Falls were chosen by spectral centroid, which is the axis that separates them:
    # the dullest hits of the trot (2.1-2.3 kHz, no ring) read as a boot rather than
    # as a horseshoe, and inside the one grass-and-dirt walk the bright crunches
    # (6.7-8.4 kHz) are the vegetation and the dull thuds (3.1-4.2 kHz) are the bare
    # dirt under it.
    "footstep-stone-1": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Trot On Concrete 03 STEREO_DRCA_HOCA_UsiPro.wav@2.26:0.30",
    "footstep-stone-2": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Trot On Concrete 03 STEREO_DRCA_HOCA_UsiPro.wav@5.39:0.30",
    "footstep-stone-3": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Trot On Concrete 03 STEREO_DRCA_HOCA_UsiPro.wav@5.97:0.30",
    "footstep-grass-1": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Walk On On Grass And Dirt MONO_DRCA_HOCA_MKH416.wav@2.67:0.35",
    # Both of these replaced a quieter fall: the trimmer normalises to a loudness
    # target, so a take 15 dB down is asked for +12 dB and brings the field
    # recording's own noise floor up with it — 22 dB under the peak instead of 40.
    "footstep-grass-2": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Walk On On Grass And Dirt MONO_DRCA_HOCA_MKH416.wav@8.40:0.35",
    "footstep-grass-3": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Walk On On Grass And Dirt MONO_DRCA_HOCA_MKH416.wav@10.37:0.40",
    "footstep-dirt-1": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Walk On On Grass And Dirt MONO_DRCA_HOCA_MKH416.wav@0.94:0.30",
    "footstep-dirt-2": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Walk On On Grass And Dirt MONO_DRCA_HOCA_MKH416.wav@2.11:0.35",
    "footstep-dirt-3": "Dramatic Cat - Horse Carriage - Draft Horse/FEETHors_Draft Horse Walk On On Grass And Dirt MONO_DRCA_HOCA_MKH416.wav@5.62:0.32",
    "footstep-mud-1": "RYK-Sounds - Footstep/mud 1 loop.wav@0.03:0.55",
    "footstep-mud-2": "RYK-Sounds - Footstep/mud 1 loop.wav@0.80:0.55",
    "footstep-mud-3": "RYK-Sounds - Footstep/mud 1 loop.wav@1.56:0.55",
    # NEVER take a UI cue from a pack labelled UI. Every one of them in this bundle is
    # synthesised, so picking on the word "UIClick" and on crest factor got a menu that
    # sounded like a spaceship. These menus are iron: a lock tinkers under the pointer
    # and a latch drops when you commit. Physical foley, one material, two weights.
    # Takes 2, 3: an antique suitcase lock and a small lever, the same iron.
    "ui-click": [
        "Epic Stock Media - HD Lock And Mechanism Sound Design Kit/MECHLtch_Click Deep Mechanism Latch Button Nearfield Thunk 02_ESM_HDLM.wav",
        "344 Audio - Antique Luggage/OBJLug_Suitcase Being Locked, Antique Suitcase 1_344 Audio_Antiques - Luggage.wav@2.18:0.30:-3.5",
        "BluezoneCorp - Industrial Lever Switch/Bluezone_BC0302_industrial_lever_switch_small_003.wav@0.06:0.18:-7.1",
    ],
    # Takes 2, 3: earlier tinkers on the same lock.
    "ui-hover": [
        "344 Audio - Antique Small Metals/METLMvmt_  Tinkering Antique Lock_344 Audio_Antique Small Metals.wav",
        "344 Audio - Antique Small Metals/METLMvmt_  Tinkering Antique Lock_344 Audio_Antique Small Metals.wav@0.10:0.50:1.8",
        "344 Audio - Antique Small Metals/METLMvmt_  Tinkering Antique Lock_344 Audio_Antique Small Metals.wav@2.40:0.40:2.5",
    ],
    # Not the sci-fi window slide: a panel in this game is leather and canvas, and the
    # fantasy kit ships the inventory-open it was recorded for.
    # Takes 2, 3: two cloth movements of another foley pack.
    "ui-panel-open": [
        "Epic Stock Media - Fantasy Game 2 - Sound Kit for Enchanted Realms/CLOTHFlp_Action Inventory Open Flip Cloth Canvas Bag Slide Light 02_ESM_FG2.wav",
        "InMotionAudio - Foley T-Shirt/FOLYClth_ClothMovement24_InMotionAudio_FoleyT-Shirt.wav@1.40:0.45:6.2",
        "InMotionAudio - Foley T-Shirt/FOLYClth_ClothMovement29_InMotionAudio_FoleyT-Shirt.wav@0.70:0.45:-3.4",
    ],

    # ── Items and trade (inventory grid, equipment, sell, buy) ──────────────────────
    # Physical foley only, one recording per cue so the three takes are one event.
    # Takes 2, 3: two more cloth grabs of the same T-shirt foley pack.
    "item-lift": [
        "InMotionAudio - Foley T-Shirt/FOLYClth_ClothMovement24_InMotionAudio_FoleyT-Shirt.wav@0.50:0.30:6.8",
        "InMotionAudio - Foley T-Shirt/FOLYClth_ClothMovement29_InMotionAudio_FoleyT-Shirt.wav@0.78:0.30:-4.7",
        "InMotionAudio - Foley T-Shirt/FOLYClth_ClothMovement24_InMotionAudio_FoleyT-Shirt.wav@1.35:0.30:-4.6",
    ],
    # Metal: a buckler set down on a floor. Leather: an antique suitcase thumped shut.
    # Wood: a tile dropped on wood. Stone: pebbles dropped on pebbles. Takes are other hits of each.
    "item-place-metal": [
        "344 Audio - Historical Weapons Vol. 2/WEAPArmr_Metal Shield Spin On Floor, Buckler MKH_344 Audio_Medieval Weapons Vol 2.wav@2.78:0.35:-2.1",
        "344 Audio - Historical Weapons Vol. 2/WEAPArmr_Metal Shield Spin On Floor, Buckler MKH_344 Audio_Medieval Weapons Vol 2.wav@3.13:0.35:-2.3",
        "344 Audio - Historical Weapons Vol. 2/WEAPArmr_Metal Shield Spin On Floor, Buckler MKH_344 Audio_Medieval Weapons Vol 2.wav@3.45:0.35:-3.4",
    ],
    "item-place-leather": [
        "344 Audio - Antique Luggage/OBJLug_Suitcase Opening and Closing, Antique Suitcase_344 Audio_Antiques - Luggage_01.wav@1.38:0.35:-1.0",
        "344 Audio - Antique Luggage/OBJLug_Suitcase Opening and Closing, Antique Suitcase_344 Audio_Antiques - Luggage_01.wav@5.68:0.35:0.2",
        "344 Audio - Antique Luggage/OBJLug_Suitcase Opening and Closing, Antique Suitcase_344 Audio_Antiques - Luggage_01.wav@6.42:0.35:-3.5",
    ],
    "item-place-wood": [
        "UberDuo - Game Night Audio Props/GAMEBoard_Scrabble, Shotgun, Tiles, Drop_UberDuo_Game.wav@0.22:0.30:-2.8",
        "UberDuo - Game Night Audio Props/GAMEBoard_Scrabble, Shotgun, Tiles, Drop_UberDuo_Game.wav@0.49:0.30:1.0",
        "UberDuo - Game Night Audio Props/GAMEBoard_Scrabble, Shotgun, Tiles, Drop_UberDuo_Game.wav@0.76:0.30:0.8",
    ],
    "item-place-stone": [
        "Pole Position Production - The Stone & Sand Library/Pebbles - DROP - Dense - Mono.wav@12.33:0.30:-1.0",
        "Pole Position Production - The Stone & Sand Library/Pebbles - DROP - Dense - Mono.wav@23.60:0.30:0.0",
        "Pole Position Production - The Stone & Sand Library/Pebbles - DROP - Dense - Mono.wav@38.18:0.30:-2.4",
    ],
    # Equip: the same materials heavier, a belt buckle jingled in under each hit.
    "item-equip-metal": [
        {"layers": [("Justsoundeffects - Melee Weapons/WEAPArmr_Metal Shield Block Hits_JSE_MW.wav@2.40:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -1.6},
        {"layers": [("Justsoundeffects - Melee Weapons/WEAPArmr_Metal Shield Block Hits_JSE_MW.wav@4.78:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -1.2},
        {"layers": [("Justsoundeffects - Melee Weapons/WEAPArmr_Metal Shield Block Hits_JSE_MW.wav@7.25:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -2.1},
    ],
    "item-equip-leather": [
        {"layers": [("344 Audio - Antique Luggage/OBJLug_Suitcase Opening and Closing, Antique Suitcase_344 Audio_Antiques - Luggage_01.wav@1.38:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": 1.0},
        {"layers": [("344 Audio - Antique Luggage/OBJLug_Suitcase Opening and Closing, Antique Suitcase_344 Audio_Antiques - Luggage_01.wav@5.68:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -0.2},
        {"layers": [("344 Audio - Antique Luggage/OBJLug_Suitcase Opening and Closing, Antique Suitcase_344 Audio_Antiques - Luggage_01.wav@6.42:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -3.2},
    ],
    # Take 3 is take 2's box hit a minor third up and a different buckle shake (one box, two hits).
    "item-equip-wood": [
        {"layers": [("Sonic Bat - Videogame Foley Essentials Vol. II/SBvfe2_Shaking Small Wooden Box 030.wav@0.33:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -2.4},
        {"layers": [("Sonic Bat - Videogame Foley Essentials Vol. II/SBvfe2_Shaking Small Wooden Box 030.wav@1.41:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": 0.7},
        {"layers": [("Sonic Bat - Videogame Foley Essentials Vol. II/SBvfe2_Shaking Small Wooden Box 030.wav@1.41:0.60", 3, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": 1.8},
    ],
    "item-equip-stone": [
        {"layers": [("Pole Position Production - The Stone & Sand Library/Pebbles - DROP - Dense - Mono.wav@51.09:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -4.4},
        {"layers": [("Pole Position Production - The Stone & Sand Library/Pebbles - DROP - Dense - Mono.wav@87.34:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": 1.9},
        {"layers": [("Pole Position Production - The Stone & Sand Library/Pebbles - DROP - Dense - Mono.wav@12.33:0.60", 0, 0, 0), ("Sonic Bat - Videogame Foley Essentials Vol. I/SBvfe1_Jiggling Belt Buckle 004.wav@0.70:0.40", 0, -8, 30)], "gain": -2.8},
    ],
    # Disenchant: crushed rock pouring, the first stones landing as the soft tick.
    "trade-sell": [
        "Pole Position Production - The Stone & Sand Library/Crushed Rock - DROP - Thick - Mono.wav@23.40:0.50:1.0",
        "Pole Position Production - The Stone & Sand Library/Crushed Rock - DROP - Thick - Mono.wav@34.45:0.50:2.4",
        "Pole Position Production - The Stone & Sand Library/Crushed Rock - DROP - Thick - Mono.wav@29.00:0.50:-2.6",
    ],
    # Paying coins: a handful of coins set down.
    "trade-buy": [
        "CB Sound Design - Essential Sounds Vol.01 Coins/coins_9.wav@0.20:0.50:-1.6",
        "CB Sound Design - Essential Sounds Vol.01 Coins/coins_9.wav@0.50:0.50:1.2",
        "CB Sound Design - Essential Sounds Vol.01 Coins/handling_coins_7.wav@0.20:0.40:0.9",
    ],

    # ── Ambient details (sfx.ts AMBIENT_DETAIL) ──────────────────────────────────────
    # One-shots dropped around the player over a biome's bed. Cut by event detection
    # (20 ms level against a 3 s rolling median) and kept WHOLE by trim_sfx.py: a drip's
    # cave tail and an owl's second hoot are the sound. Gulls and frogs are ElevenLabs
    # takes (the library has neither), kept beside the library in audio-libs/elevenlabs.
    "ambient-hideout-detail": [
        "InspectorJ - Essentials 04 Chains/CHAINMvmt_InsJ_Chains_Metal_Movement_Distant_Short_01-02.wav",
        "InspectorJ - Essentials 04 Chains/CHAINMvmt_InsJ_Chains_Metal_Movement_Distant_Very-Short_03-01.wav",
        "InspectorJ - Essentials 04 Chains/CHAINMvmt_InsJ_Chains_Metal_Movement_Distant_Moderate_02-01.wav",
        "Ivo Vicic - Campfire - Bonfire FX/24 Campfire, Dropping Fresh Pine Branches in Fire, Crackling, Sizzling Strong, Close 02.wav@42.26:0.56",
        "Ivo Vicic - Campfire - Bonfire FX/24 Campfire, Dropping Fresh Pine Branches in Fire, Crackling, Sizzling Strong, Close 02.wav@115.64:0.56",
    ],
    "ambient-cave-detail": [
        "InMotionAudio - Cave Design/WATRDrip_SingleDripDesign05_InMotionAudio_CaveDesign.wav@0:2.50",
        "InMotionAudio - Cave Design/WATRDrip_SingleDrip03_InMotionAudio_CaveDesign.wav",
        "Justsoundeffects - Stones and Debris/DIRTCrsh_Stone Sand Trickle Reverberant 01_JSE_SD.wav@9.72:1.94",
        "Justsoundeffects - Stones and Debris/DIRTCrsh_Stone Sand Trickle Reverberant 01_JSE_SD.wav@18.86:2.10",
        "Justsoundeffects - Stones and Debris/DIRTCrsh_Stone Sand Trickle Reverberant 01_JSE_SD.wav@3.08:1.26",
        "BluezoneCorp - Annihilation - Mech/Bluezone_BC0287_annihilation_debris_falling_rock_001.wav",
    ],
    "ambient-wind-detail": [
        "Jake Fielding - Red Kite/BIRDPrey_Red Kite Call, Screech, Bird of Prey, Hawk,_Jake Fielding_Red Kite_02.wav@12.82:1.46",
        "Jake Fielding - Red Kite/BIRDPrey_Red Kite Call, Screech, Bird of Prey, Hawk,_Jake Fielding_Red Kite_02.wav@9.20:1.90",
        "Jake Fielding - Red Kite/BIRDPrey_Red Kite Call, Screech, Bird of Prey, Hawk,_Jake Fielding_Red Kite_02.wav@6.82:0.52",
        "Jake Fielding - Red Kite/BIRDPrey_Red Kite Call, Screech, Bird of Prey, Hawk,_Jake Fielding_Red Kite_02.wav@5.40:0.70",
        "Justsoundeffects - Stones and Debris/DIRTCrsh_Stone Sand Trickle Reverberant 01_JSE_SD.wav@27.14:1.06",
    ],
    "ambient-swamp-detail": [
        "../elevenlabs/ambient/frog-1.mp3",
        "../elevenlabs/ambient/frog-2.mp3",
        "../elevenlabs/ambient/frog-3.mp3",
        "../elevenlabs/ambient/frog-4.mp3",
        "Hzandbits - Microbes/LIQMvmt_Liquid Movement Plop Slosh Single 07_HZBIT_Microbes_MKH60.Wav@0:0.58",
        "Epic Stock Media - Synthesized Nature Loops and Sounds/ANMLAmph_Animal Frog Echo Short Squished Frequency Formant 03_ESM_SNLS.wav",
        "Hzandbits - Microbes/CREASmall_ Small Species A Voices Skitter Squeak Phrase 02_HZBIT_Microbes.Wav",
    ],
    "ambient-forest-detail": [
        "Justsoundeffects - Forest Ambiences/BIRDPrey_Spring Night Deciduous Forest Many Tawny Owls Wind Leaves Rustling_JSE_FA.wav@7.24:1.34",
        "Justsoundeffects - Forest Ambiences/BIRDPrey_Spring Night Deciduous Forest Many Tawny Owls Wind Leaves Rustling_JSE_FA.wav@19.78:1.54",
        "Justsoundeffects - Forest Ambiences/BIRDPrey_Spring Night Deciduous Forest Many Tawny Owls Wind Leaves Rustling_JSE_FA.wav@0:1.32",
        "BluezoneCorp - Forest Textures/Bluezone_BC0279_forest_tree_wood_texture_creaking_016.wav",
        "BluezoneCorp - Forest Textures/Bluezone_BC0279_forest_wood_log_debris_falling_3_007.wav",
        "Omar Alvarado - Minimal ambiences/ambience outdoors late night, cold winter air, pack of canine howling into the night and man made water fountain.wav@36.5:4.0",
        "Omar Alvarado - Minimal ambiences/ambience outdoors late night, cold winter air, pack of canine howling into the night and man made water fountain.wav@117.3:3.0",
    ],
    "ambient-shore-detail": [
        "../elevenlabs/ambient/gull-1.mp3",
        "../elevenlabs/ambient/gull-2.mp3",
        "../elevenlabs/ambient/gull-3.mp3",
        "../elevenlabs/ambient/gull-4.mp3",
    ],
}


# cue name -> `path@start:duration`, for the SUSTAINED voices (`startSfxLoop` in
# sfx.ts). These do not go through the trimmer and must not: it finds a take and
# shapes it with fades, which is exactly right for an event and exactly wrong for a
# bed — a fade at each edge is a dip to silence once per cycle, heard as pumping.
#
# `duration` is the loop LENGTH; CROSSFADE seconds beyond it are consumed making the
# seam, so the source has to hold that much more material after the region.
LOOP_SOURCES: dict[str, str | list[str]] = {
    # A fireball in flight is a rocket, the way it has always been done: the middle of
    # a blast-off, after the ignition transient and before it thins out. The bolt's own
    # cast whoosh still fires over the top of this.
    # Takes 2, 3: the same blast-off before and after take 1's region.
    "skill-ember-bolt-flight": [
        "344 Audio - Air Designed/AEROJet_Blast Off Clean_344 Audio_Air Designed.wav@3.10:2.00",
        "344 Audio - Air Designed/AEROJet_Blast Off Clean_344 Audio_Air Designed.wav@1.10:2.00",
        "344 Audio - Air Designed/AEROJet_Blast Off Clean_344 Audio_Air Designed.wav@5.60:2.00",
    ],
    # Not the cast sample looped: that one is cut to its loudest 1.4s, so looping it is
    # the same crackle over and over. Chosen by EVENNESS rather than by the word fire:
    # scored as the spread of 100ms block levels across the region, the woodstove that
    # was here first came out at 0.98 (near-silence with one crack in it, which loops as
    # a pop every 2.4 seconds) against this one's 0.24.
    # Takes 2, 3: regions of the same cauldron as even as take 1 and as poppy (crest 28-29 dB against 29).
    "skill-cinder-ground-loop": [
        "344 Audio - Haunting Ambiences Vol. 5/FIRECrkl_Fire Crackling, Popping, Witch's Cauldron_344 Audio_Haunting Ambiences Vol 5.wav@0.50:2.40",
        "344 Audio - Haunting Ambiences Vol. 5/FIRECrkl_Fire Crackling, Popping, Witch's Cauldron_344 Audio_Haunting Ambiences Vol 5.wav@136.50:2.40",
        "344 Audio - Haunting Ambiences Vol. 5/FIRECrkl_Fire Crackling, Popping, Witch's Cauldron_344 Audio_Haunting Ambiences Vol 5.wav@100.50:2.40:-7.1",
    ],
}

# Seconds of the tail folded back over the head to hide the seam.
CROSSFADE = 0.5


def channels_of(path: str) -> int:
    """1 or 2: the source's own channel count, anything wider folded to stereo."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels",
         "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return 1 if int(out) == 1 else 2


def layout(channels: int) -> str:
    return "mono" if channels == 1 else "stereo"


def to_loop(src: str, dst: str, start: float, duration: float) -> None:
    """Cut a seamless loop of exactly `duration` seconds.

    The tail is crossfaded over the head rather than butt-joined: two points of one
    recording never match sample for sample, and the step between them is a click at
    the loop rate. Taking the body from `start + CROSSFADE` and fading the material
    at `start` back in under it means the end of the output runs into what its own
    beginning already is.
    """
    body_from = start + CROSSFADE
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src,
        "-filter_complex",
        f"[0:a]atrim={body_from:.3f}:{body_from + duration:.3f},asetpts=PTS-STARTPTS[a];"
        f"[0:a]atrim={start:.3f}:{start + CROSSFADE:.3f},asetpts=PTS-STARTPTS[b];"
        f"[a][b]acrossfade=d={CROSSFADE}:c1=tri:c2=tri,"
        # One-pass loudnorm: a bed is held for seconds under one-shots, so it is
        # levelled well below the trimmer's target for events and trimmed of peaks.
        f"loudnorm=I=-23:TP=-3.0,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts={layout(channels_of(src))}",
        "-c:a", "pcm_s16le", dst,
    ]
    subprocess.run(cmd, check=True)


def to_48k(src: str, dst: str, start: float, duration: float) -> None:
    """Resample the window we care about, in the source's channels, without touching level.

    `start`/`duration` pick a region out of a long recording BEFORE the trimmer looks
    for a transient: on a 60-second pebble drop the loudest take is not necessarily the
    one that sounds like a monster, and this is the only place to say which.
    """
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", src]
    if duration > 0:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-ac", str(channels_of(src)), "-ar", "48000", "-c:a", "pcm_s16le", dst]
    subprocess.run(cmd, check=True)


def regain(path: str, db: float) -> None:
    """Move a shaped take by `db`, under trim_sfx's own -2.5 dBFS limiter."""
    tmp = path + ".gain.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", path, "-af",
         f"volume={db:.2f}dB,alimiter=level_in=1:level_out=1:limit=0.750:level=disabled",
         "-c:a", "pcm_s16le", tmp],
        check=True,
    )
    os.replace(tmp, path)


def to_layered(lib: str, layers: list, dst: str) -> None:
    """Mix `(path@start:duration, semitones, gain_db, at_ms)` layers to 48 kHz 16-bit,
    stereo when any layer is (a mono layer sits centred in it)."""
    cmd, chains = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"], []
    channels = max(channels_of(os.path.join(lib, spec.partition("@")[0])) for spec, *_ in layers)
    for i, (spec, semis, gain, at_ms) in enumerate(layers):
        rel, _, window = spec.partition("@")
        start, _, dur = window.partition(":")
        cmd += ["-ss", start or "0", "-t", dur or "30", "-i", os.path.join(lib, rel)]
        rate = 48000 * 2 ** (semis / 12)
        chains.append(f"[{i}:a]aformat=channel_layouts={layout(channels)},aresample=48000,asetrate={rate:.1f},"
                      f"aresample=48000,volume={gain}dB,adelay={at_ms}[l{i}]")
    mix = "".join(f"[l{i}]" for i in range(len(layers)))
    cmd += ["-filter_complex", ";".join(chains) + f";{mix}amix=inputs={len(layers)}:normalize=0",
            "-ac", str(channels), "-ar", "48000", "-c:a", "pcm_s16le", dst]
    subprocess.run(cmd, check=True)


def to_opus(src: str, dst: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src,
         "-c:a", "libopus", "-b:a", "160k", "-vbr", "on", "-application", "audio",
         "-ar", "48000", dst],
        check=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", required=True, help="library root the SOURCES paths are under")
    ap.add_argument("--out", required=True, help="directory for the shipped .webm files")
    ap.add_argument("--only", action="append", default=[], help="cue name; repeatable")
    ap.add_argument("--keep-wav", default="", help="also write the shaped WAV here, for auditioning")
    args = ap.parse_args()

    every = {**SOURCES, **LOOP_SOURCES}
    wanted = {c: s for c, s in every.items() if not args.only or c in args.only}
    if not wanted:
        sys.exit("nothing to do: --only matched no cue in SOURCES")
    os.makedirs(args.out, exist_ok=True)
    if args.keep_wav:
        os.makedirs(args.keep_wav, exist_ok=True)

    trimmer = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trim_sfx.py")
    jobs = []
    for cue, specs in sorted(wanted.items()):
        if isinstance(specs, (str, dict)):
            jobs.append((cue, cue, specs))
        else:
            jobs += [(cue, f"{cue}-{k}", s) for k, s in enumerate(specs, 1)]
    missing = 0
    for cue, name, spec in jobs:
        if isinstance(spec, dict):
            layers, gain = spec["layers"], spec.get("gain", "")
            rels = [layer[0].partition("@")[0] for layer in layers]
        else:
            rel, _, window = spec.partition("@")
            start, _, rest = window.partition(":")
            dur, _, gain = rest.partition(":")
            rels = [rel]
        gone = [r for r in rels if not os.path.exists(os.path.join(args.lib, r))]
        if gone:
            print(f"{name:30} MISSING {gone}")
            missing += 1
            continue
        src = os.path.join(args.lib, rels[0])
        with tempfile.TemporaryDirectory() as tmp:
            if isinstance(spec, dict):
                staged = os.path.join(tmp, cue + ".wav")
                to_layered(args.lib, layers, staged)
                shaped = os.path.join(tmp, "out")
                subprocess.run([sys.executable, trimmer, staged, "--out", shaped], check=True)
                done = os.path.join(shaped, cue + ".wav")
            elif cue in LOOP_SOURCES:
                done = os.path.join(tmp, cue + ".wav")
                to_loop(src, done, float(start or 0), float(dur or 0))
            else:
                staged = os.path.join(tmp, cue + ".wav")
                to_48k(src, staged, float(start or 0), float(dur or 0))
                shaped = os.path.join(tmp, "out")
                subprocess.run([sys.executable, trimmer, staged, "--out", shaped], check=True)
                done = os.path.join(shaped, cue + ".wav")
            if gain:
                regain(done, float(gain))
            to_opus(done, os.path.join(args.out, name + ".webm"))
            if args.keep_wav:
                # shutil, not os.replace: the temp dir is on C: and the repo is on D:.
                shutil.move(done, os.path.join(args.keep_wav, name + ".wav"))
        print(f"{name:30} <- {spec}")
    if missing:
        sys.exit(f"{missing} source file(s) not found under {args.lib}")


if __name__ == "__main__":
    main()
