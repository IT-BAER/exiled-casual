"""Build the layered reward cues (drops, coins, level-up, container) from library parts.

Each recipe is a list of parts out of the Sonniss library, cut, pitch-shifted (tape-style:
pitch and length move together), filtered, faded and layered at an offset, then peak-set.
The build is deterministic. The result is NOT passed through trim_sfx.py: it would cut
the level-up's lead-in swell and re-EQ the sound.

Run:
  python tools/build_reward_sfx.py --lib "D:/VSC/exiled-casual/audio-libs/extracted" --out apps/web/public/audio
  python tools/build_reward_sfx.py --lib ... --out ... --only drop-unique
"""
from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf
from scipy.signal import resample, resample_poly, butter, sosfilt

# Library root; set from --lib.
LIB = ""
SR = 48000

CLOCK = "Justsoundeffects - Clocks and Mechanics/CLOCKChim_Old Wall Clock 1920 Chimes Ringing_JSE_CM_Stereo.wav"  # F5+22c @41.19
MBOX_A = "Sonic Bat - Music Boxes/SBmb_Music Box A 013.wav"  # A#5+22c @0.06
TING = "Cinematic Sound Design - UI Interaction Elements/Ting Coins.wav"  # E5/E6 @0.07
CHURCH = "Ivo Vicic - Church Bells/04 Church Bells, Near Distance, In Church Tower-3 Different Bell 02.wav"  # D#4 body @15.27
XMAS = "344 Audio - Christmas Vol. 1/MAGMisc_Magic Christmas Bells 2_344 Audio_Christmas.wav"  # 4-5 kHz @13.42
HANDBELL = "Mechanical Wave - Sound Effects Collection/BELLHand_Metallic Bell_ 22_MWSFX_SEC.wav"  # @0.06
IMPACT21 = "344 Audio - Epic Impacts Vol. 1/Impact 021.wav"  # 64 Hz @0.02
BOOM3 = "BluezoneCorp - Modern Cinematic Impact/Bluezone_BC0294_modern_cinematic_impact_boom_003.wav"  # 70 Hz @0.85
IRON = "Pole Position - The Metal Hit Sweeteners Library/Iron - Thick - HIT - Hammer.wav"  # G#7 ping @1.80
SPADE = "Pole Position - The Metal Hit Sweeteners Library/Spade - HIT - Drumstick - Ring - Mute.wav"  # @0.07
GLASS = "Sonic Bat - Videogame Foley Essentials Vol. II/SBvfe2_Glass 114.wav"  # 6 kHz @0.04
COINS9 = "CB Sound Design - Essential Sounds Vol.01 Coins/coins_9.wav"
HANDCOINS = "CB Sound Design - Essential Sounds Vol.01 Coins/handling_coins_7.wav"
FALLCOINS = "CB Sound Design - Essential Sounds Vol.01 Coins/falling_coins_rotation_1.wav"
COINFLIP = "Cinematic Sound Design - Hybrid Game & UI Elements/Foley Coin Flip Single Fast.wav"
LATCH = "Epic Stock Media - HD Lock And Mechanism Sound Design Kit/MECHLtch_Click Deep Mechanism Latch Button Nearfield Thunk 02_ESM_HDLM.wav"
CREAK = "Rogue Waves - Creaking Door/DOORCreak_Wooden Door, Opening and Closing 09_RogueWaves_CreakingDoor.wav"
WOODBOX = "Sonic Bat - Videogame Foley Essentials Vol. II/SBvfe2_Shaking Small Wooden Box 030.wav"
BALLRET = "Soundopolis - Bowling/Bowling_Machinery_Ball Return_Fienup_003.wav"  # clack 188-252 Hz @6.31
CASTLING = "344 Audio - Ultimate Chess SFX/Castling Movements 08.wav"  # low knock @0.31
STONEHAM = "BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_hammer_015.wav"  # 1.37 kHz @0.16
STONE15 = "BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_015.wav"  # 2 kHz tick @0.28
CHESSLATCH = "344 Audio - Ultimate Chess SFX/Closing Latches 4.wav"  # 1.37 kHz click @0.04
WOODHEAVY = "344 Audio - Haunting Ambiences Vol. 3/WOODImpt_Wooden Hit, Dark, Heavy Hit, Vampire's Prison_344 Audio_Haunting Ambiences Vol 3.wav"  # 100 Hz @2.25
SLAM = "Rogue Waves - Creaking Door/DOORCreak_Wooden Door, Door Slams, Impacts, 3_RogueWaves_CreakingDoor.wav"  # 78 Hz @8.50
WOODDROP = "InMotionAudio - Wood/WOODImpt_Drops20_InMotionAudio_Wood.wav"  # 1.24 kHz knock @0.03
GONG = "Orbital Emitter - Cinematic Transitions for Editors Volume 2/80,TheGong.wav"  # 60/360/1121 Hz @0.10
REVGLASS = "Mechanical Wave - Glass/GLASMisc_Reverse Glass Effect_04_MWSFX_GL.wav"  # rises to peak @0.85
STONE41 = "BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_041.wav"  # 1.7 kHz crack @0.09
GLASSBOT = "Mechanical Wave - Glass/GLASMisc_Glass Bottle Open_01_MWSFX_GL.wav"  # glass hit 4.4 kHz @1.34
MANYCOINS = "CB Sound Design - Essential Sounds Vol.01 Coins/many_coins_12.wav"
CLINK = "TheWorkRoom Audio Post - Champagne & Wine Commercials/CWSD002.wav"  # glass clink 3.3 kHz @0.75
GLASSYSNAP = "Cinematic Sound Design - Interface & Infographics/Interface Accept Glassy Snap.wav"  # 932/1862/3725 Hz @0.01
ROCK011 = "Sonic Bat - Videogame Foley Essentials Vol. II/SBvfe2_Medium Rock Dropping 011.wav"  # 621 Hz landing @0.01
REVMETAL = "Mechanical Wave - Torturing Metal/METLTonl_Reversed Metal-28_MWSFX_TM.wav"  # low swell, peak @2.5


def st(f_from, f_to):
    return 12 * math.log2(f_to / f_from)


F_CLOCK, F_MBOX, F_TING = 708 * 2 ** (0 / 1200), 944.0, 657.0
F_CHURCH = 310.0

#      src, start, dur, semis, gain, at_ms, fade_ms, hp, lp
RECIPES = {
    "drop-normal": [
        (SPADE, 0.06, 0.25, -3, -2, 0, 120, 300, 0),
        (LATCH, 0.01, 0.12, 0, -10, 0, 60, 80, 0),
    ],
    "drop-magic": [  # 12leveling: A tone ~0.6 s
        (MBOX_A, 0.05, 1.0, st(F_MBOX, 880), 0, 0, 400, 0, 0),
        (CLOCK, 41.18, 0.9, st(F_CLOCK, 440), -6, 0, 450, 0, 0),
        (IRON, 1.79, 0.12, -5, -16, 0, 60, 1500, 0),
    ],
    "drop-rare": [  # 3uniques: 75 Hz thud + G#/C# dyad
        (IMPACT21, 0.01, 0.6, st(64, 75), -3, 0, 350, 0, 400),
        (CLOCK, 41.18, 0.9, st(F_CLOCK, 554.4), -2, 10, 450, 0, 0),
        (MBOX_A, 0.05, 0.9, st(F_MBOX, 830.6), -4, 60, 400, 0, 0),
    ],
    "drop-unique": [  # 6veryvaluable: 65 Hz boom, hits 90/140/210 ms
        (BOOM3, 0.84, 0.9, st(70, 65), 2, 0, 500, 0, 300),
        (IMPACT21, 0.01, 0.4, st(64, 65), -4, 0, 250, 0, 250),
        (CLOCK, 41.18, 1.0, st(F_CLOCK, 554.4), -3, 90, 500, 0, 0),
        (CLOCK, 41.18, 1.0, st(F_CLOCK, 740.0), -3, 140, 500, 0, 0),
        (MBOX_A, 0.05, 1.0, st(F_MBOX, 987.8), -3, 210, 500, 0, 0),
        (XMAS, 13.40, 0.9, 0, -14, 210, 500, 2500, 0),
    ],
    "drop-currency": [  # A: orb landing, glass-led: bottle set down (580 Hz) + rock, short brass-bell ring
        (GLASSBOT, 3.12, 0.12, 0, 0, 0, 70, 120, 0),
        (ROCK011, 0.01, 0.12, 0, -8, 0, 70, 150, 0),
        (HANDBELL, 0.05, 0.24, 0, -9, 10, 80, 2000, 0),
        (CLINK, 0.75, 0.10, 0, -10, 10, 60, 1500, 0),
    ],
    "drop-gold-jackpot": [  # big coin cascade, A5 + G6 bells as a quiet accent
        (CLOCK, 41.18, 1.0, st(F_CLOCK, 880), -14, 0, 600, 0, 0),
        (MBOX_A, 0.05, 1.0, st(F_MBOX, 1568), -15, 0, 500, 0, 0),
        (XMAS, 13.40, 0.6, 0, -16, 0, 350, 3000, 0),
        (MANYCOINS, 0.01, 0.45, 0, 0, 0, 200, 200, 0),
        (COINS9, 0.03, 0.85, 0, -2, 40, 300, 200, 0),
        (FALLCOINS, 0.01, 1.2, 0, -4, 80, 500, 200, 0),
    ],
    "drop-gold": [  # 2-3 coins on stone, dry, < 0.3 s
        (COINS9, 0.03, 0.22, 0, 0, 0, 120, 300, 0),
        (COINFLIP, 0.20, 0.10, 0, -6, 60, 60, 1000, 0),
        (STONE15, 0.28, 0.08, 0, -12, 0, 50, 800, 0),
    ],
    "coin-pickup": [  # drop-gold, shorter and quieter (PEAK_DB)
        (COINS9, 0.03, 0.12, 0, 0, 0, 80, 300, 0),
        (STONE15, 0.28, 0.06, 0, -14, 0, 40, 800, 0),
    ],
    "level-up": [  # reverse-glass swell into one deep gong + bell strike, shimmer tail, no melody
        (REVGLASS, 0.35, 0.50, 0, -6, 0, 40, 1500, 0),
        (REVMETAL, 2.05, 0.50, 0, -10, 0, 40, 0, 0),
        (GONG, 0.10, 2.2, 0, 0, 480, 1400, 0, 0),
        (CHURCH, 15.26, 1.6, 0, -8, 480, 1000, 120, 0),
        (XMAS, 13.40, 1.0, 0, -10, 480, 700, 3000, 0),
    ],
    "container-open": [  # latch, then a tight wooden chest lid: mid knock, little low end
        (CHESSLATCH, 0.04, 0.12, 0, -4, 0, 70, 300, 0),
        (WOODDROP, 0.03, 0.15, 0, 0, 70, 90, 200, 0),
        (CASTLING, 0.31, 0.15, 0, -3, 70, 90, 120, 0),
        (WOODHEAVY, 2.25, 0.20, 0, -12, 70, 120, 150, 0),
    ],
}

PEAK_DB = {"coin-pickup": -9.0}  # default -2.5 dBFS

_cache = {}


def seg(src, start, dur):
    key = (src, start, dur)
    if key not in _cache:
        info = sf.info(os.path.join(LIB, src))
        a = int(start * info.samplerate)
        x, sr = sf.read(os.path.join(LIB, src), start=a, frames=int(dur * info.samplerate) + 1,
                        always_2d=True, dtype="float64")
        x = x.mean(axis=1)
        g = math.gcd(int(sr), SR)
        _cache[key] = resample_poly(x, SR // g, int(sr) // g)
    return _cache[key].copy()


def build(layers, peak_db=-2.5):
    parts = []
    for src, start, dur, semis, gain, at_ms, fade_ms, hp, lp in layers:
        x = seg(src, start, dur)
        rate = 2 ** (semis / 12)
        if abs(semis) > 1e-3:
            x = resample(x, max(1, int(round(len(x) / rate))))
        if hp:
            x = sosfilt(butter(2, hp, "highpass", fs=SR, output="sos"), x)
        if lp:
            x = sosfilt(butter(2, lp, "lowpass", fs=SR, output="sos"), x)
        x[:48] *= np.linspace(0, 1, 48)  # 1 ms de-click
        nf = min(len(x), int(fade_ms * SR / 1000))
        x[len(x) - nf:] *= np.linspace(1, 0, nf) ** 2
        x /= max(1e-9, np.abs(x).max())
        parts.append((int(at_ms * SR / 1000), x * 10 ** (gain / 20)))
    n = max(o + len(x) for o, x in parts)
    out = np.zeros(n)
    for o, x in parts:
        out[o:o + len(x)] += x
    return out * (10 ** (peak_db / 20) / np.abs(out).max())


def to_opus(src: str, dst: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src,
         "-c:a", "libopus", "-b:a", "128k", "-vbr", "on", "-application", "audio",
         "-ac", "1", "-ar", "48000", dst],
        check=True,
    )


def main() -> None:
    global LIB
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", required=True, help="library root the recipe paths are under")
    ap.add_argument("--out", required=True, help="directory for the shipped .webm files")
    ap.add_argument("--only", action="append", default=[], help="cue name; repeatable")
    args = ap.parse_args()
    LIB = args.lib

    wanted = {c: r for c, r in RECIPES.items() if not args.only or c in args.only}
    if not wanted:
        sys.exit("nothing to do: --only matched no cue in RECIPES")
    os.makedirs(args.out, exist_ok=True)
    for cue, layers in wanted.items():
        for src, *_ in layers:
            if not os.path.exists(os.path.join(LIB, src)):
                sys.exit(f"{cue}: MISSING {src}")
        y = build(layers, PEAK_DB.get(cue, -2.5))
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, cue + ".wav")
            sf.write(wav, y.astype(np.float32), SR, subtype="PCM_16")
            to_opus(wav, os.path.join(args.out, cue + ".webm"))
        print(f"{cue:18} {len(y) / SR:4.2f}s")


if __name__ == "__main__":
    main()
