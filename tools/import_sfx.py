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

# Library files the class-skill cues (the 18 skills of the 1 Nov 2026 expansion) share,
# named once because most of them are cut into several takes and layers below.
_FIRE_GROWL = "Epic Stock Media - Elemental Mutation Whooshes and Impacts/FIREWhsh_Whoosh Fire Deep Growl Monster Saturated Crisp 03_ESM_EMWI.wav"
_FIRE_BED = "Epic Stock Media - Synthesized Nature Loops and Sounds/FIREBurn_Loop Elements Fire Crackling Crunchy Flame Burn 03_ESM_SNLS.wav"
_SEAR = "Orbital Emitter - Cinematic Transitions for Editors Volume 2/27,Searing.wav"
_FLARE = "BluezoneCorp - Steampunk Weapon And Textures/Bluezone_BC0296_steampunk_weapon_flare_shot_explosion_003.wav"
_URBAN_BLAST = "BluezoneCorp - Detonation - Explosion/Bluezone_BC0277_explosion_urban_004_02.wav"
_FIREWORKS = "Ivo Vicic - Fireworks FX/13 Fireworks_powerful explosions_multiples in a row_near.wav"
_LAUNCH = "InspectorJ - Essentials 03 Fireworks/FRWKComr_InsJ_Fireworks_Launch_Close_01-03.wav"
_WOODSTOVE = "UberDuo - The Wood Stove Audio Prop Set/FIREMisc_Fire Crackling In A Woodstove_UberDuo_WOOD.wav"
_BOILER = "Ivo Vicic - Industrial gas boiler room/23 Industrial Gas  Boiler room_room tone_boiler near_PAN C.wav"
_METEORS = "David Dumais Audio - Magic Sound FX Pack 2/MagicPack2_Earth_MeteorShower003.wav"
_CANNONBALL = "Gladestock Studios - Naval Warfare/GS cannonball impact 005.wav"
_NUKE = "DavidDumais - Explosion SFX Pack/EXPLDsgn_Nuclear Explosion 07_DDUMAIS_NONE.wav"
_WHOOSH_SHORT = "Justsoundeffects - Transition Whooshes Vol. 1/WHSH_Whoosh Short 06_JSE_TW1.wav"
_HEAVY_WHOOSH = "Mechanical Wave - Cinematic Feel/WHSH_Sci-Fi Heavy Whoosh_MWSFX_CF 29.wav"
_JET_WHOOSH = "Pole Position Production - The Cinematic Transformation Library/CINEMATIC - WHOOSH - Upfront Short - 2 Jet Sharp Ricochet Metallic Sliding Whipping.wav"
_GEO_WHOOSH = "344 Audio - Geophonic Design Vol. 2/WHSH_Whoosh 1_344 Audio_Geophonic Design Vol 2.wav"
_SWING_THUD = "David Dumais Audio - Melee Weapons Sound Effects Pack 2/SWSH_SWING IMPACTS Quick Heavy Weapon Swing To Thud Impact Var 01_DDUMAIS_MWP2.wav"
_IMPACT_045 = "344 Audio - Epic Impacts Vol. 1/Impact 045.wav"
_IMPACT_059 = "344 Audio - Epic Impacts Vol. 1/Impact 059.wav"
_PERC_IMPACT = "BluezoneCorp - Modern Cinematic Impact/Bluezone_BC0294_modern_cinematic_impact_percussion_009.wav"
_BOOM_HIT = "Marek Klemczak - ARTA Cinematic Sound FX Pack/DSGNBoom_Impact Hit_Chef Audio_Cinematic Sound FX_10.wav"
_SUB_BOOM = "344 Audio - Geophonic Design Vol. 2/DSGNBoom_Cinematic Hit 2_344 Audio_Geophonic Design Vol 2.wav"
_RUMBLE_BOOM = "Shapeforms Audio - Sci-Fi Weapons Cyberpunk Arsenal/EXPLDsgn_Explosion Rumble Distorted_07_SFRMS_SCIWPNS.wav"
_TRAILER_BOOM_075 = "Federico Soler - Effective Trailer Booms Vol. 2/EffectiveTrailer_Booms_Vol2_075.wav"
_TRAILER_BOOM_214 = "Federico Soler - Effective Trailer Booms Vol. 2/EffectiveTrailer_Booms_Vol2_214.wav"
_STONE_015 = "BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_015.wav"
_STONE_041 = "BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_041.wav"
_STONE_HAMMER = "BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_hammer_015.wav"
_ROCK_FALL = "BluezoneCorp - Annihilation - Mech/Bluezone_BC0287_annihilation_debris_falling_rock_001.wav"
_RUBBLE = "BluezoneCorp - Demolisher - Robot/Bluezone_BC0290_demolisher_debris_rubble_texture_004.wav"
_DEBRIS_HIT = "BluezoneCorp - Invader - Alien Creature/Bluezone_BC0286_invader_debris_impact_011.wav"
_COLLAPSE_ROCK = "BluezoneCorp - Building Collapse/Bluezone_BC0275_building_collapse_debris_falling_rock_008.wav"
_COLLAPSE_RUBBLE = "BluezoneCorp - Building Collapse/Bluezone_BC0275_building_collapse_debris_falling_rock_rubble_008.wav"
_QUAKE = "BluezoneCorp - Alien Tripod/Bluezone_BC0292_alien_tripod_debris_rock_collapse_earthquake_rumble_large_005.wav"
_BODY_CRUNCH = "344 Audio - Flesh, Bones & Gore/Heavy Body Crunch 02.wav"
_PUNCH = "344 Audio - Cinematic Fight Vol. 1/FGHTImpt_4 x Punch, Body 02_344 Audio_Cinematic Fight Vol 1.wav"
_BOX_THUMP = "Mechanical Wave - Cardboard and Paper/OBJPack_Big Cardboard Box Impact_ 02_MWSFX_CDAP.wav"
_AIR_RISER = "344 Audio - Cymbals From Hell/Time Bending Risers 21.wav"
_SHIMMER = "Epic Stock Media - Anime Game/DSGNStngr_Power Up Bright Positive Successful Light Saturation Crash Shimmer 05_ESM_AG.wav"
_GUST = "Rescopic Sound - Distinct Whooshes/WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav"
_DARK_SPELL = "Rogue Waves - Druid Magic/MAGEvil_Dark Spell Dark Energy Attack_RogueWaves_DruidMagic.wav"
_DARK_TONE = "Mechanical Wave - Glass/GLASTonl_Dark Tone Thrill_07_MWSFX_GL.wav"
_NOISEBOX_10 = "InMotionAudio - Sinister Textures 4/DSGNErie_NoiseBoxHit_10_InMotionAudio_SinisterTextures4.wav"
_NOISEBOX_36 = "InMotionAudio - Sinister Textures 4/DSGNErie_NoiseBoxHit_36_InMotionAudio_SinisterTextures4.wav"
_BELL = "Mechanical Wave - Sound Effects Collection/BELLHand_Metallic Bell_ 22_MWSFX_SEC.wav"
_IRON_HIT = "Pole Position - The Metal Hit Sweeteners Library/Iron - Thick - HIT - Hammer.wav"
_PINAKA = "Eiravaein Works - Nocked/Nocked,archery,firing,loose,Pinakabow,mythic,midflight,wide,hum,sizzle,energy,alt8.wav"
_VAEYAN = "Eiravaein Works - Nocked/Nocked,archery,firing,loose,Vaeyanbow,midflight,wide,mythic,sleek,swirl,rattle,alt14.wav"
_CROSSBOW = "Eiravaein Works - Nocked/Nocked,archery,firing,loose,crossbow1,carbonbolt,atbow,snap,buzz,airy,bright,alt.wav"
_HAWK = "2496SoundEffects - Super Heroes Sound Design/Hawk's Arrow Flies Bow and Arrow shoot 2.wav"
_BAMBOO = "Rogue Waves - Druid Magic/SWSH_Dry Bamboo Leaf Swishes 1_RogueWaves_DruidMagic.wav"
_WOOD_DROP = "InMotionAudio - Wood/WOODImpt_Drops20_InMotionAudio_Wood.wav"
_SAIL_HIT = "Gladestock Studios - Naval Warfare/GS sail impact 004.wav"
_FLESH_DROP = "Justsoundeffects - Gore Mini Pack/GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav"
_FREEZE = "Epic Stock Media - Tower Defense Game/ICEBrk_Skill Freeze Whoosh Break Impact Layered Movement Shatter 03_ESM_TDG.wav"
_ICE_SNAP = "Alexander Kopeikin - 100 kHz Designed Ice/ice, crack, ice block snapping-001.wav"
_ICE_FISSURE = "Alexander Kopeikin - 100 kHz Designed Ice/ice, surface cracking, fissure, fast, hard-003.wav"
_ICE_078 = "BluezoneCorp - Ice Cracking/Bluezone_BC0278_ice_crack_break_078.wav"
_ICE_189 = "BluezoneCorp - Ice Cracking/Bluezone_BC0278_ice_crack_break_189.wav"
_ICE_SIZZLE = "Mechanical Wave - Sound Effects Collection/ICEMisc_Ice Sizzle_05_MWSFX_SEC.wav"
_ICE_HAMMER = "Eneas Mentzel - Frozen Farmlands/ICEBrk_FROZEN FARMLAND Ice Crack hammer pull short_Eneas Mentzel_ _13.wav"
_SHARDS = "Epic Stock Media - Elemental Mutation Whooshes and Impacts/GLASMvmt_Whoosh Glass Crystal Fragments Sharp Shards Dry 05_ESM_EMWI.wav"
_ARC = "BluezoneCorp - High Voltage/Bluezone_BC0299_electricity_surge_discharge_electrical_arc_crackling_002_01.wav"
_ELEC_WHOOSH = "Justsoundeffects - VOLT - Electromagnetic Fields/ELECEmf_Electric Whooshes_JSE_VEMF.wav"
_ELEC_IMPACT = "Epic Stock Media - Elemental Mutation Whooshes and Impacts/ELECMisc_Impact Electric Tonal Deep Movement Motion Hiss Glitch 01_ESM_EMWI.wav"
_ELEC_SPELL = "David Dumais Audio - Magic Sound FX Pack 2/MagicPack2_ElectricitySpells_Spell2-002.wav"
_THUNDER = "InspectorJ - Essentials 01 Thunder/THUN_InsJ_Thunder_Extremely-Close_03.wav"
_ZAP = "Rescopic Sound - Parallax/SCIMisc_Zap Short 14_RSCPC_PX.wav"
_BUG_ZAP = "Rogue Waves - Druid Magic/ELECZap_Bug zapper zapping, electricity, crackle,_RogueWaves_DruidMagic_37.wav"


def _beats(spec: str, semis: float, period_ms: int, count: int) -> list[tuple[str, float, float, int]]:
    """One thump repeated `count` times `period_ms` apart: a pulse to cut a loop from."""
    return [(spec, semis, 0, k * period_ms) for k in range(count)]


# Takes of one buff differ by a third of a semitone at most: a pool, not a choice of sounds.
_BUFF_TAKE_SEMIS = (0.0, 0.3, -0.3, 0.15)


def _buff_up(semis: float, takes: int = 3) -> list[dict]:
    """Every buff and aura coming up is ONE sound: the last 0.6 s of the air riser with the
    shimmer struck at its top, a few semitones of tape apart per skill. The shimmer's entry
    moves with the tape speed, or a lower take strikes it before the riser has arrived."""
    out = []
    for k in range(takes):
        s = semis + _BUFF_TAKE_SEMIS[k]
        at = round(600 * 2 ** (-s / 12))
        out.append({"layers": [(f"{_AIR_RISER}@5.45:1.05", s, 0, 0), (_SHIMMER, s, -8, at)]})
    return out


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

    # ── Class skill expansion: Ironsworn ──────────────────────────────────────────
    # The five buffs come up on the one `_buff_up` sound, lowest for the heaviest:
    # Iron Resolve -3, Furnace Roar -2, Crimson Fury -1, Mantle of Embers 0, Windstride +2.
    "skill-infernal-cry-cast": _buff_up(-2, takes=4),
    # The cry landing on each enemy: a short fiery blast; the built takes lay crackle or the
    # fire growl under a blast or a designed impact.
    "skill-infernal-cry-impact": [
        _FLARE,
        {"layers": [(f"{_URBAN_BLAST}@0:1.00", 0, -3, 0), (f"{_FIRE_BED}@1.30:0.80", 0, -6, 20)]},
        {"layers": [(_IMPACT_045, 2, -3, 0), (f"{_FIRE_GROWL}@0.30:0.60", 0, -6, 0)]},
    ],
    # Leap Slam: the push-off is a short low whoosh, the flight a heavy pass-by, the
    # landing the loudest Ironsworn hit (a designed impact with rock under it).
    "skill-leap-slam-cast": [
        {"layers": [(f"{_WHOOSH_SHORT}@0.08:0.50", -3, 0, 0)]},
        {"layers": [(f"{_WHOOSH_SHORT}@8.14:0.45", -3, 0, 0)]},
        {"layers": [(f"{_WHOOSH_SHORT}@10.90:0.70", -2, 0, 0)]},
    ],
    "skill-leap-slam-whoosh": [
        f"{_HEAVY_WHOOSH}@2.00:1.30",
        f"{_JET_WHOOSH}@0.30:1.30",
        {"layers": [(f"{_GEO_WHOOSH}@1.10:1.50", -2, 0, 0)]},
    ],
    "skill-leap-slam-impact": [
        {"layers": [(_IMPACT_045, 0, -3, 0), (_DEBRIS_HIT, 0, -9, 30)]},
        {"layers": [(_PERC_IMPACT, 0, -3, 0), (f"{_STONE_015}@0:0.60", 0, -9, 0)], "gain": -3.5},
        {"layers": [(f"{_BOOM_HIT}@0.28:1.50", 0, -3, 0), (_ROCK_FALL, 0, -9, 20)], "gain": -3.5},
    ],
    # Earthquake: the two-hander slammed down (swing into a thud), the ground cracking
    # under the cone, and the aftershock a second later as rumble, boom and falling rock.
    "skill-earthquake-cast": [
        f"{_SWING_THUD}@15.08:0.45",
        f"{_SWING_THUD}@33.06:0.40",
        f"{_SWING_THUD}@42.08:0.40",
    ],
    "skill-earthquake-impact": [
        {"layers": [(f"{_RUBBLE}@0.08:0.95", 0, -3, 0), (f"{_STONE_041}@0:0.70", 0, -9, 0)]},
        {"layers": [(_DEBRIS_HIT, 0, -3, 0), (_STONE_HAMMER, -3, -8, 0)]},
        {"layers": [(f"{_RUBBLE}@0.08:0.95", -3, -3, 0), (_IMPACT_059, 0, -6, 0)]},
    ],
    "skill-earthquake-aftershock": [
        {"layers": [(f"{_QUAKE}@2.80:1.80", 0, -4, 0), (f"{_SUB_BOOM}@0.36:1.80", 0, -4, 0)]},
        {"layers": [(_RUMBLE_BOOM, 0, -3, 0), (f"{_COLLAPSE_ROCK}@0.80:1.80", 0, -6, 60)]},
        {"layers": [(f"{_TRAILER_BOOM_075}@0.24:1.80", 0, -3, 0), (f"{_COLLAPSE_RUBBLE}@0:1.80", 0, -7, 40)]},
    ],
    "skill-determination-cast": _buff_up(-3),
    # Sunder: the same two-hander as Earthquake a tone down, a stone cracking into a body
    # for the hit, and one rock burst per step of the line.
    "skill-sunder-cast": [
        {"layers": [(f"{_SWING_THUD}@3.06:0.55", -2, 0, 0)]},
        {"layers": [(f"{_SWING_THUD}@30.02:0.70", -2, 0, 0)]},
        {"layers": [(f"{_SWING_THUD}@45.04:0.45", -2, 0, 0)]},
    ],
    "skill-sunder-impact": [
        {"layers": [(_STONE_HAMMER, 0, -3, 0), (f"{_BODY_CRUNCH}@0.40:0.40", 0, -6, 0)]},
        {"layers": [(f"{_STONE_015}@0:0.60", -2, -3, 0), (f"{_BODY_CRUNCH}@2.80:0.40", 0, -6, 0)], "gain": -2},
        {"layers": [(f"{_STONE_041}@0:0.70", 0, -3, 0), (f"{_PUNCH}@1.12:0.35", 0, -7, 0)]},
    ],
    "skill-sunder-burst": [
        {"layers": [(f"{_COLLAPSE_ROCK}@2.92:0.75", 0, -3, 0), (_IMPACT_059, -3, -8, 0)]},
        {"layers": [(f"{_COLLAPSE_ROCK}@3.82:0.80", 0, -3, 0), (_IMPACT_059, -5, -8, 0)]},
        {"layers": [(f"{_COLLAPSE_RUBBLE}@3.92:0.45", 0, -3, 0), (_IMPACT_059, -2, -8, 0)], "gain": -3},
        {"layers": [(f"{_COLLAPSE_RUBBLE}@4.52:0.40", 0, -3, 0), (_IMPACT_059, -4, -8, 0)]},
    ],
    "skill-blood-rage-cast": _buff_up(-1),

    # ── Class skill expansion: Stalker ────────────────────────────────────────────
    # Four real looses exist (two Nocked bows, a crossbow, the Super Heroes shot), so a
    # Stalker skill is a loose with its element laid under it. The bows peak 20 dB under
    # the crossbow, hence the +16/+18 on them: the element sits ~6 dB under the loose.
    # Escape Shot: the loose plus the dry swish of the hop back; the hit chills.
    "skill-escape-shot-cast": [
        {"layers": [(_CROSSBOW, 0, -3, 0), (f"{_BAMBOO}@0.02:0.40", 0, -3, 20)], "gain": -3},
        {"layers": [(_PINAKA, 1, 16, 0), (f"{_BAMBOO}@2.04:0.45", 0, -6, 20)]},
        {"layers": [(_VAEYAN, -1, 18, 0), (f"{_BAMBOO}@0.96:0.40", 0, -2, 20)]},
    ],
    "skill-escape-shot-impact": [
        {"layers": [(_WOOD_DROP, 0, -3, 0), (_ICE_078, 0, -8, 20)]},
        {"layers": [(_SAIL_HIT, 0, -3, 0), (f"{_ICE_189}@0:0.90", 0, -9, 20)], "gain": -4},
        {"layers": [(f"{_FLESH_DROP}@4.58:0.30", 0, -3, 0), (f"{_ICE_SNAP}@1.70:0.50", 0, -4, 10)]},
    ],
    # Ice Shot: the loose with crystal shards or frost hiss; the burst a freezing shatter.
    "skill-ice-shot-cast": [
        {"layers": [(_VAEYAN, 0, 18, 0), (f"{_SHARDS}@1.10:0.70", 0, -10, 40)]},
        {"layers": [(_PINAKA, 0, 16, 0), (f"{_ICE_SIZZLE}@0.28:0.70", 0, -14, 30)]},
        {"layers": [(_CROSSBOW, -1, -3, 0), (f"{_SHARDS}@1.30:0.60", 0, -10, 30)], "gain": -4},
    ],
    "skill-ice-shot-impact": [
        _FREEZE,
        f"{_ICE_SNAP}@0.48:1.20",
        f"{_ICE_FISSURE}@0.28:1.40",
    ],
    # Sniper's Mark: a dark spell with a small bell struck as the mark lands.
    "skill-snipers-mark-cast": [
        {"layers": [(f"{_DARK_SPELL}@0.02:0.80", 0, -3, 0), (_BELL, 0, -12, 60)]},
        {"layers": [(f"{_DARK_SPELL}@0.86:0.95", 0, -3, 0), (_BELL, 2, -12, 60)]},
        {"layers": [(_DARK_TONE, 0, -3, 0), (_BELL, -2, -10, 40)]},
    ],
    # Lightning Arrow: the loose wrapped in an electric whoosh or arc; the hit a thunder
    # crack or a designed electric impact; each chain jump a short zap.
    "skill-lightning-arrow-cast": [
        {"layers": [(_CROSSBOW, 0, -3, 0), (f"{_ELEC_WHOOSH}@6.72:0.90", 0, -6, 0)]},
        {"layers": [(_PINAKA, 0, 16, 0), (f"{_ELEC_WHOOSH}@12.28:0.90", 0, -9, 0)], "gain": -5},
        {"layers": [(_VAEYAN, 1, 18, 0), (f"{_ARC}@0:0.70", 0, -15, 0)]},
    ],
    "skill-lightning-arrow-impact": [
        {"layers": [(f"{_THUNDER}@1.16:1.20", 0, -3, 0), (f"{_ARC}@0.40:0.70", 0, -12, 0)]},
        f"{_ELEC_IMPACT}@0:1.30:-3",
        f"{_ELEC_SPELL}@1.00:1.20:-3",
    ],
    "skill-lightning-arrow-chain": [
        f"{_ZAP}@0:0.45",
        f"{_ARC}@1.20:0.40",
        {"layers": [(f"{_BUG_ZAP}@0:0.25", 0, 0, 0), (f"{_ARC}@2.20:0.35", 0, -12, 0)]},
    ],
    # Rain of Arrows: a volley, three looses staggered 50-140 ms; each arrow coming down a
    # dry wooden thunk; a hit a thud into flesh with the shaft's knock on top.
    "skill-rain-of-arrows-cast": [
        {"layers": [(f"{_HAWK}@0.30:1.00", 0, 5, 0), (_PINAKA, 0, 16, 70), (_VAEYAN, 0, 18, 140)]},
        {"layers": [(_CROSSBOW, 0, -3, 0), (f"{_HAWK}@0.30:1.00", 1, 5, 50), (_PINAKA, -1, 16, 110)]},
        {"layers": [(_VAEYAN, 0, 18, 0), (_CROSSBOW, 2, -4, 60), (f"{_HAWK}@0.30:1.00", -1, 5, 120)]},
    ],
    "skill-rain-of-arrows-impact": [
        {"layers": [(f"{_FLESH_DROP}@13.70:0.30", 0, -3, 0), (_WOOD_DROP, 0, -7, 0)]},
        {"layers": [(f"{_FLESH_DROP}@2.22:0.30", 0, -3, 0), (_WOOD_DROP, 2, -7, 0)]},
        {"layers": [(f"{_FLESH_DROP}@22.20:0.25", 0, -3, 0), (_WOOD_DROP, -2, -7, 0)]},
    ],
    # One recording, four falls: the wood drop at three tape speeds and a sail thump.
    "skill-rain-of-arrows-arrow": [
        _WOOD_DROP,
        {"layers": [(_WOOD_DROP, -3, 0, 0)]},
        {"layers": [(_WOOD_DROP, 3, 0, 0)]},
        {"layers": [(f"{_SAIL_HIT}@0:0.40", 3, 0, 0)], "gain": -4},
    ],
    "skill-haste-cast": _buff_up(2),

    # ── Class skill expansion: Emberbound ─────────────────────────────────────────
    # The bundle still holds no designed fire impact, so the fire cues are built: a fire
    # growl, a searing burst, a fireworks launch or blast, each with crackle under it.
    "skill-flame-dash-cast": [
        {"layers": [(_FIRE_GROWL, 3, 0, 0)], "gain": -3},
        {"layers": [(f"{_SEAR}@0:1.00", 0, -3, 0), (f"{_WHOOSH_SHORT}@8.14:0.45", 0, -9, 0)], "gain": -3},
        {"layers": [(f"{_LAUNCH}@0:1.00", 2, -3, 0), (f"{_FIRE_BED}@6.00:0.80", 0, -8, 0)]},
    ],
    "skill-flame-dash-trail": [
        {"layers": [(f"{_SEAR}@0:0.80", 2, 0, 0)]},
        {"layers": [(f"{_FIRE_BED}@1.40:0.60", 0, -3, 0), (f"{_WHOOSH_SHORT}@0.08:0.50", 0, -9, 0)]},
        {"layers": [(f"{_FIRE_BED}@3.00:0.60", 0, -3, 0), (f"{_WHOOSH_SHORT}@10.90:0.60", 2, -9, 0)]},
    ],
    "skill-flame-dash-impact": [
        {"layers": [(f"{_FIRE_GROWL}@0.10:0.90", -3, -3, 0), (_IMPACT_059, 0, -6, 0)], "gain": -4},
        {"layers": [(_FLARE, -3, 0, 0)], "gain": -2},
        {"layers": [(f"{_FIREWORKS}@18.30:0.70", 0, 0, 0), (f"{_FIRE_BED}@8.00:0.80", 0, -10, 20)]},
    ],
    # Ember Nova: a deep whoomp round the caster (a designed blast's front), crackle on top.
    "skill-ember-nova-cast": [
        {"layers": [(f"{_NUKE}@0:1.40", 0, -3, 0), (f"{_FIRE_BED}@4.00:1.20", 0, -6, 0)]},
        {"layers": [(_RUMBLE_BOOM, 2, -3, 0), (f"{_FIRE_BED}@9.00:1.20", 0, -6, 0)]},
        {"layers": [(f"{_SEAR}@0:1.20", -3, -3, 0), (f"{_SUB_BOOM}@0.36:1.20", 0, -8, 0)]},
    ],
    "skill-ember-nova-impact": [
        {"layers": [(f"{_FLARE}@0:0.60", 2, 0, 0)]},
        {"layers": [(f"{_FLARE}@0:0.60", -2, 0, 0)]},
        {"layers": [(f"{_URBAN_BLAST}@0:0.80", 3, -3, 0), (f"{_FIRE_BED}@7.00:0.60", 0, -8, 20)]},
    ],
    # Flammability: a dark designed hit with a long tail, fire catching under it.
    "skill-flammability-cast": [
        {"layers": [(f"{_NOISEBOX_36}@0:1.40", 0, -3, 0), (f"{_FIRE_BED}@2.00:1.20", 0, -8, 100)]},
        {"layers": [(f"{_NOISEBOX_36}@0:1.40", 2, -3, 0), (f"{_FIRE_BED}@5.00:1.20", 0, -8, 100)]},
        {"layers": [(f"{_NOISEBOX_36}@0:1.40", -3, -3, 0), (f"{_SEAR}@0:1.00", 0, -10, 150)]},
    ],
    # Solar Orb: something burning thrown, a gas burner's roar catching under it; each
    # pulse a short sear or crackle with a small knock.
    "skill-solar-orb-cast": [
        {"layers": [(f"{_LAUNCH}@0:1.20", -3, -3, 0), (f"{_BOILER}@10.00:1.20", 0, -10, 0)]},
        {"layers": [(_FIRE_GROWL, 1, -3, 0), (f"{_BOILER}@30.00:1.00", 0, -10, 0)], "gain": -3},
        {"layers": [(f"{_SEAR}@0:1.00", 1, -3, 0), (f"{_BOILER}@50.00:1.00", 0, -8, 0)], "gain": -3},
    ],
    "skill-solar-orb-impact": [
        {"layers": [(f"{_SEAR}@0:0.60", 3, -3, 0), (_IMPACT_059, 2, -10, 0)]},
        {"layers": [(f"{_FIRE_BED}@1.50:0.50", 0, -3, 0), (_IMPACT_059, 0, -8, 0)]},
        {"layers": [(f"{_SEAR}@0.10:0.50", 5, -3, 0), (_IMPACT_059, -2, -10, 0)]},
    ],
    # Firestorm: a designed meteor shower. Its first approach is the call, its densest
    # stretches the storm landing; each meteor a cannonball or a boom with fire on it.
    "skill-firestorm-cast": [
        f"{_METEORS}@1.20:2.00",
        {"layers": [(f"{_LAUNCH}@0:1.40", -5, -3, 0), (f"{_FIRE_BED}@3.00:1.40", 0, -6, 0)]},
        {"layers": [(f"{_METEORS}@1.20:2.00", -2, 0, 0)]},
    ],
    "skill-firestorm-impact": [
        f"{_METEORS}@5.30:1.70",
        f"{_METEORS}@13.90:1.70",
        f"{_METEORS}@18.10:1.70",
    ],
    "skill-firestorm-meteor": [
        _CANNONBALL,
        {"layers": [(_CANNONBALL, -2, -3, 0), (f"{_FIRE_BED}@4.20:0.90", 0, -10, 20)]},
        {"layers": [(f"{_TRAILER_BOOM_214}@0.24:1.40", 0, -3, 0), (f"{_FIRE_BED}@6.50:0.90", 0, -10, 20)]},
        {"layers": [(f"{_FIREWORKS}@12.40:0.60", -4, -3, 0), (f"{_SUB_BOOM}@0.36:1.20", 0, -6, 0)]},
    ],
    # Herald of Ash: a kill igniting is a pop of flame with crackle after.
    "skill-herald-of-ash-cast": _buff_up(0),
    "skill-herald-of-ash-burst": [
        {"layers": [(f"{_FIREWORKS}@15.12:0.50", -3, 0, 0), (f"{_FIRE_BED}@2.20:0.60", 0, -8, 20)], "gain": 2},
        {"layers": [(f"{_LAUNCH}@0:0.70", 3, -3, 0), (f"{_FIRE_BED}@4.60:0.60", 0, -8, 0)]},
        {"layers": [(f"{_FIRE_GROWL}@0.10:0.70", 2, 0, 0)], "gain": -4},
    ],

    # ── Class skill expansion: shared aura and status cues ────────────────────────
    # Any aura switched off: the falling half of a wind gust, low on tape, a breath going out
    # (the anime charge-down it replaced read as sci-fi). Takes a semitone apart.
    "skill-aura-off": [{"layers": [(f"{_GUST}@1.40:1.80", s, 0, 0)]} for s in (-4, -5, -3)],
    "skill-status-chilled": [
        f"{_ICE_SIZZLE}@0.26:0.70:-5",
        f"{_ICE_SIZZLE}@6.30:0.60",
        {"layers": [(f"{_ICE_HAMMER}@0.50:0.50", 0, -3, 0), (f"{_ICE_SIZZLE}@3.00:0.50", 0, -10, 0)]},
    ],
    # A clang that rings: a hand bell tape-slowed under a dead iron hit.
    "skill-status-stunned": [
        {"layers": [(f"{_BELL}@0:1.20", -7, -3, 0), (f"{_IRON_HIT}@1.78:0.30", -5, -8, 0)]},
        {"layers": [(f"{_BELL}@0:1.20", -10, -3, 0), (f"{_IRON_HIT}@5.32:0.30", -5, -8, 0)]},
        {"layers": [(f"{_BELL}@0:1.20", -4, -3, 0), (f"{_IRON_HIT}@10.30:0.30", -7, -8, 0)]},
    ],
    "skill-status-marked": [
        f"{_BELL}@0:0.80",
        {"layers": [(f"{_BELL}@0:0.80", 3, 0, 0)]},
        {"layers": [(f"{_DARK_TONE}@0:0.70", 2, 0, 0)], "gain": -4},
    ],
    "skill-status-flammable": [
        f"{_FIRE_BED}@4.10:0.60:-5",
        {"layers": [(f"{_WOODSTOVE}@2.30:0.40", 0, -3, 0), (f"{_FIRE_BED}@7.40:0.50", 0, -6, 0)]},
        {"layers": [(f"{_FIRE_BED}@11.00:0.60", 2, 0, 0)], "gain": -7},
    ],
    # A searing hiss at three tape speeds. Not the campfire's pine sizzles: crest 27-30 dB,
    # they shaped to 0.1-0.36 s at -34 dB RMS, a tick rather than a burn.
    "skill-status-scorched": [
        {"layers": [(f"{_SEAR}@0:0.70", -2, 0, 0)]},
        {"layers": [(f"{_SEAR}@0:0.70", 1, 0, 0)]},
        {"layers": [(f"{_SEAR}@0.15:0.70", -4, 0, 0)]},
    ],
}


# cue name -> `path@start:duration`, for the SUSTAINED voices (`startSfxLoop` in
# sfx.ts). These do not go through the trimmer and must not: it finds a take and
# shapes it with fades, which is exactly right for an event and exactly wrong for a
# bed — a fade at each edge is a dip to silence once per cycle, heard as pumping.
#
# `duration` is the loop LENGTH; CROSSFADE seconds beyond it are consumed making the
# seam, so the source has to hold that much more material after the region.
LOOP_SOURCES: dict[str, str | list[str | dict]] = {
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
    # A take may be a layered dict here too, with `loop` its length: the mix is cut as
    # one source from 0. Solar Orb hovers as a gas burner's steady roar (1 dB of level
    # drift over its first 30 s) with fire crackle 8 dB under it.
    "skill-solar-orb-loop": [
        {"layers": [(f"{_BOILER}@5.00:3.50", 0, 0, 0), (f"{_FIRE_BED}@1.00:3.50", 0, -8, 0)], "loop": 2.40},
        {"layers": [(f"{_BOILER}@20.00:3.50", 0, 0, 0), (f"{_FIRE_BED}@5.00:3.50", 0, -8, 0)], "loop": 2.40},
        {"layers": [(f"{_BOILER}@60.00:3.50", 0, 0, 0), (f"{_FIRE_BED}@8.00:3.50", 0, -8, 0)], "loop": 2.40},
    ],
    # The library holds no heartbeat. Its box impact is two thumps 280 ms apart, the
    # second the stronger: a lub-dub. Tape-slowed and repeated at 80 bpm, four beats to a
    # loop; the period divides the loop, so the crossfaded seam lands on the same beat.
    "skill-blood-rage-heartbeat": [
        {"layers": _beats(f"{_BOX_THUMP}@0:0.66", -5, 750, 6), "loop": 3.00},
        {"layers": _beats(f"{_BOX_THUMP}@0:0.66", -7, 750, 6), "loop": 3.00},
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


def to_loop(src: str, dst: str, start: float, duration: float, dynamic: bool = True) -> None:
    """Cut a seamless loop of exactly `duration` seconds.

    The tail is crossfaded over the head rather than butt-joined: two points of one
    recording never match sample for sample, and the step between them is a click at
    the loop rate. Taking the body from `start + CROSSFADE` and fading the material
    at `start` back in under it means the end of the output runs into what its own
    beginning already is.

    `dynamic=False` levels with one static gain instead of loudnorm: on a pulse,
    loudnorm's gain at the file edges ran 6-8 dB over the middle, a louder beat per cycle.
    """
    body_from = start + CROSSFADE
    # One-pass loudnorm: a bed is held for seconds under one-shots, so it is
    # levelled well below the trimmer's target for events and trimmed of peaks.
    norm = "loudnorm=I=-23:TP=-3.0," if dynamic else ""
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src,
        "-filter_complex",
        f"[0:a]atrim={body_from:.3f}:{body_from + duration:.3f},asetpts=PTS-STARTPTS[a];"
        f"[0:a]atrim={start:.3f}:{start + CROSSFADE:.3f},asetpts=PTS-STARTPTS[b];"
        f"[a][b]acrossfade=d={CROSSFADE}:c1=tri:c2=tri,"
        f"{norm}aformat=sample_fmts=s16:sample_rates=48000:channel_layouts={layout(channels_of(src))}",
        "-c:a", "pcm_s16le", dst,
    ]
    subprocess.run(cmd, check=True)
    if not dynamic:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", "-i", dst, "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True, text=True, errors="ignore",
        ).stderr
        mean = float(out.split("mean_volume:")[1].split("dB")[0])
        regain(dst, -23.0 - mean)


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
                      f"aresample=48000,volume={gain}dB,adelay={at_ms}:all=1[l{i}]")
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
            if isinstance(spec, dict) and cue in LOOP_SOURCES:
                staged = os.path.join(tmp, cue + ".mix.wav")
                to_layered(args.lib, layers, staged)
                done = os.path.join(tmp, cue + ".wav")
                to_loop(staged, done, 0.0, float(spec["loop"]), dynamic=False)
            elif isinstance(spec, dict):
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
