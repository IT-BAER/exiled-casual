"""Turn a library recording into a shipped game cue.

Why this exists
---------------
`trim_sfx.py` was written for MOSS renders: 48 kHz 16-bit mono, five seconds, two or
three takes in it. A commercial library file is none of those — the Sonniss masters are
96 kHz 24-bit stereo and run from one second to two minutes — so it cannot be fed to the
trimmer directly (the trimmer exits on anything that is not 16-bit mono, by design: a
silent format mismatch is how you ship a cue at half speed).

So this is the front half of the same pipeline:

  source .wav  ->  48 kHz 16-bit mono  ->  trim_sfx.py (find a take, shape it)  ->  Opus

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
# shipped, so this can be filled a few at a time.
#
# The six materials come from `MATERIAL` in `apps/web/src/audio/soundscape.ts`, and
# the choices are literal rather than clever: a construct is hit with a hammer on
# stone and dies as a wall coming down; a husk is chitin that trembles and bone that
# snaps; a bog thing gurgles and bursts. Ember is the weak one — these three years of
# the bundle hold fire textures and fireworks but no fire IMPACT, so its death is a
# fire being put out, which is at least the right event.
SOURCES: dict[str, str] = {
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
    "player-hurt": "344 Audio - Screaming/VOXScrm_Male in Shock 4_344 Audio_Screaming.wav",

    # ── Skills ──────────────────────────────────────────────────────────────────
    "skill-ember-bolt-cast": "Epic Stock Media - Elemental Mutation Whooshes and Impacts/FIREWhsh_Whoosh Fire Deep Growl Monster Saturated Crisp 03_ESM_EMWI.wav",
    "skill-ember-bolt-impact": "DavidDumais - Explosion SFX Pack/EXPLReal_Medium Realistic Explosion 15_DDUMAIS_NONE.wav",
    # Cinder ground burns for its whole duration, so this one is a fire LOOP cut to
    # its loudest 1.4s rather than a one-shot with a decay.
    "skill-cinder-ground-cast": "Epic Stock Media - Synthesized Nature Loops and Sounds/FIREBurn_Loop Elements Fire Crackling Crunchy Flame Burn 03_ESM_SNLS.wav",
    "skill-blink": "CB Sound Design - Whoosh And Push/W_a_P_Spell_Whoosh_19.wav",

    # ── Portals and the map device ──────────────────────────────────────────────
    "portal-open": "CB_Sounddesign - Applicable Sounds - Organic UI and Building Games SFX/GAMEMisc_Magic Creation 23_CB Sounddesign_APPlicable Sounds.wav",
    # Same trap as the UI pair: the one file in the bundle actually called a vortex is
    # in a pack called Essential Scifi, and it sounded like one. A whoosh made of glass
    # shards is the same gesture with a material behind it.
    "portal-enter": "Epic Stock Media - Elemental Mutation Whooshes and Impacts/GLASMvmt_Whoosh Glass Crystal Fragments Sharp Shards Dry 05_ESM_EMWI.wav",
    # A pitch collapsing, not a power-down: every "downer" in the bundle is a trailer
    # synth, and a guitar dive bomb is the same falling gesture with a body to it.
    "portal-close": "Rogue Waves - Metal Tensions/MUSCStngr_Open String Dive Bomb Down, Whammy bar, Low_RogueWaves_MetalTensions_13.wav",
    "waystone-activate": "Alexander Kopeikin - Emotion and Magic/magic, action gesture, evil presence, onslaught-004.wav",

    # ── Flask, feet, UI ─────────────────────────────────────────────────────────
    "flask-drink": "Eiravaein Works - Flask/OBJCont_Flask,glass,figuredbottle,realcork,liquid,remove,squeak,slosh,alt4_EWKR.wav",
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
    "ui-click": "Epic Stock Media - HD Lock And Mechanism Sound Design Kit/MECHLtch_Click Deep Mechanism Latch Button Nearfield Thunk 02_ESM_HDLM.wav",
    "ui-hover": "344 Audio - Antique Small Metals/METLMvmt_  Tinkering Antique Lock_344 Audio_Antique Small Metals.wav",
    # Not the sci-fi window slide: a panel in this game is leather and canvas, and the
    # fantasy kit ships the inventory-open it was recorded for.
    "ui-panel-open": "Epic Stock Media - Fantasy Game 2 - Sound Kit for Enchanted Realms/CLOTHFlp_Action Inventory Open Flip Cloth Canvas Bag Slide Light 02_ESM_FG2.wav",
}


# cue name -> `path@start:duration`, for the SUSTAINED voices (`startSfxLoop` in
# sfx.ts). These do not go through the trimmer and must not: it finds a take and
# shapes it with fades, which is exactly right for an event and exactly wrong for a
# bed — a fade at each edge is a dip to silence once per cycle, heard as pumping.
#
# `duration` is the loop LENGTH; CROSSFADE seconds beyond it are consumed making the
# seam, so the source has to hold that much more material after the region.
LOOP_SOURCES: dict[str, str] = {
    # A fireball in flight is a rocket, the way it has always been done: the middle of
    # a blast-off, after the ignition transient and before it thins out. The bolt's own
    # cast whoosh still fires over the top of this.
    "skill-ember-bolt-flight": "344 Audio - Air Designed/AEROJet_Blast Off Clean_344 Audio_Air Designed.wav@3.10:2.00",
    # Not the cast sample looped: that one is cut to its loudest 1.4s, so looping it is
    # the same crackle over and over. Chosen by EVENNESS rather than by the word fire:
    # scored as the spread of 100ms block levels across the region, the woodstove that
    # was here first came out at 0.98 (near-silence with one crack in it, which loops as
    # a pop every 2.4 seconds) against this one's 0.24.
    "skill-cinder-ground-loop": "344 Audio - Haunting Ambiences Vol. 5/FIRECrkl_Fire Crackling, Popping, Witch's Cauldron_344 Audio_Haunting Ambiences Vol 5.wav@0.50:2.40",
}

# Seconds of the tail folded back over the head to hide the seam.
CROSSFADE = 0.5


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
        "loudnorm=I=-23:TP=-3.0,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono",
        "-c:a", "pcm_s16le", dst,
    ]
    subprocess.run(cmd, check=True)


def to_mono48(src: str, dst: str, start: float, duration: float) -> None:
    """Downmix and resample the window we care about, without touching level.

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
    cmd += ["-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", dst]
    subprocess.run(cmd, check=True)


def to_opus(src: str, dst: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src,
         "-c:a", "libopus", "-b:a", "128k", "-vbr", "on", "-application", "audio",
         "-ac", "1", "-ar", "48000", dst],
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
    missing = 0
    for cue, spec in sorted(wanted.items()):
        rel, _, window = spec.partition("@")
        start, _, dur = window.partition(":")
        src = os.path.join(args.lib, rel)
        if not os.path.exists(src):
            print(f"{cue:28} MISSING {rel}")
            missing += 1
            continue
        with tempfile.TemporaryDirectory() as tmp:
            if cue in LOOP_SOURCES:
                done = os.path.join(tmp, cue + ".wav")
                to_loop(src, done, float(start or 0), float(dur or 0))
            else:
                staged = os.path.join(tmp, cue + ".wav")
                to_mono48(src, staged, float(start or 0), float(dur or 0))
                shaped = os.path.join(tmp, "out")
                subprocess.run([sys.executable, trimmer, staged, "--out", shaped], check=True)
                done = os.path.join(shaped, cue + ".wav")
            to_opus(done, os.path.join(args.out, cue + ".webm"))
            if args.keep_wav:
                # shutil, not os.replace: the temp dir is on C: and the repo is on D:.
                shutil.move(done, os.path.join(args.keep_wav, cue + ".wav"))
        print(f"{cue:28} <- {rel}")
    if missing:
        sys.exit(f"{missing} source file(s) not found under {args.lib}")


main()
