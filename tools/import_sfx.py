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
    "portal-enter": "Chupapsound - Essential Scifi/DSGN VORTEX IN.wav",
    # A pitch collapsing, not a power-down: every "downer" in the bundle is a trailer
    # synth, and a guitar dive bomb is the same falling gesture with a body to it.
    "portal-close": "Rogue Waves - Metal Tensions/MUSCStngr_Open String Dive Bomb Down, Whammy bar, Low_RogueWaves_MetalTensions_13.wav",
    "waystone-activate": "Alexander Kopeikin - Emotion and Magic/magic, action gesture, evil presence, onslaught-004.wav",

    # ── Flask, feet, UI ─────────────────────────────────────────────────────────
    "flask-drink": "Eiravaein Works - Flask/OBJCont_Flask,glass,figuredbottle,realcork,liquid,remove,squeak,slosh,alt4_EWKR.wav",
    # Two feet, two materials: the maps are earth, and a single step and a step out
    # of a walking loop differ enough that the pair does not read as one sample.
    "footstep-dirt-a": "RYK-Sounds - Footstep/grass 3 single step 3.wav",
    "footstep-dirt-b": "RYK-Sounds - Footstep/mud 1 loop.wav",
    "ui-click": "Cinematic Sound Design - Interface & Infographics/Interface Percussion Snap.wav",
    "ui-hover": "Cinematic Sound Design - Interface & Infographics/Interface Pop High Short.wav",
    # Not the sci-fi window slide: a panel in this game is leather and canvas, and the
    # fantasy kit ships the inventory-open it was recorded for.
    "ui-panel-open": "Epic Stock Media - Fantasy Game 2 - Sound Kit for Enchanted Realms/CLOTHFlp_Action Inventory Open Flip Cloth Canvas Bag Slide Light 02_ESM_FG2.wav",
}


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

    wanted = {c: s for c, s in SOURCES.items() if not args.only or c in args.only}
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
