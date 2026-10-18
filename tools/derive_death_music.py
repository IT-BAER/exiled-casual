"""Derive the death-screen masters from the hideout-2 masters, with no Eleven Music generation.

  python tools/derive_death_music.py            # writes audio-libs/elevenlabs/music/death-<n>.mp3
  python tools/build_music_loops.py --publish   # then cuts them into public/music/death-<n>.webm

Each take is a hideout-2 take (melancholy low strings and choir pad, no lead melody) slowed
like tape, so pitch and tempo drop together with no stretching artefacts, darkened by a
low-pass, and sunk into a long synthetic hall. An existing death master is kept (delete it to
rebuild); a real `gen_music.py --slot death` run skips the slot while these exist. Each
derivation is appended to assets/audio/elevenlabs-provenance.json beside its source.
"""
import datetime
import json
import subprocess
from fractions import Fraction
from pathlib import Path

import numpy as np
from scipy.signal import butter, oaconvolve, resample_poly, sosfilt

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "audio-libs" / "elevenlabs" / "music"
PROVENANCE = ROOT / "assets" / "audio" / "elevenlabs-provenance.json"
RATE = 48_000
# (source master, semitones down): a different drop per take, so the three do not sound alike.
TAKES = [("hideout-2-1", 4), ("hideout-2-2", 5), ("hideout-2-3", 3)]
LOWPASS_HZ = 3_500
RT60_S = 4.5
WET = 0.45
SEED = 7


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def tape_slow(x, semitones):
    """Resample to more samples and play at the same rate: lower and slower by the same ratio."""
    ratio = Fraction(2 ** (semitones / 12)).limit_denominator(1000)
    return resample_poly(x, ratio.numerator, ratio.denominator, axis=0)


def hall(x, rng):
    """Decaying stereo noise as the impulse response; independent channels keep it wide."""
    n = int(RT60_S * 1.2 * RATE)
    t = np.arange(n) / RATE
    ir = rng.standard_normal((n, 2)) * (10 ** (-3 * t / RT60_S))[:, None]
    ir = sosfilt(butter(2, 2_500, "lowpass", fs=RATE, output="sos"), ir, axis=0)
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    wet = np.stack([oaconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], axis=1)
    wet *= np.sqrt((x ** 2).mean()) / max(np.sqrt((wet ** 2).mean()), 1e-12)
    return (1 - WET) * x + WET * wet


def derive(source, semitones, rng):
    x = tape_slow(decode(MASTERS / f"{source}.mp3"), semitones)
    x = sosfilt(butter(4, LOWPASS_HZ, "lowpass", fs=RATE, output="sos"), x, axis=0)
    x = hall(x, rng)
    return x * (10 ** (-1 / 20) / np.abs(x).max())


def write_mp3(path, x):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "-",
                    "-c:a", "libmp3lame", "-b:a", "192k", str(path)], input=x.astype("<f4").tobytes(), check=True)


def main():
    rng = np.random.default_rng(SEED)
    prov = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    for n, (source, semitones) in enumerate(TAKES, 1):
        dest = MASTERS / f"death-{n}.mp3"
        if dest.exists():
            print(f"keep {dest.name}")
            continue
        x = derive(source, semitones, rng)
        write_mp3(dest, x)
        prov["generations"].append({
            "kind": "music-derived", "file": f"audio-libs/elevenlabs/music/{dest.name}", "slot": "death", "take": n,
            "source": f"audio-libs/elevenlabs/music/{source}.mp3", "tool": "tools/derive_death_music.py",
            "processing": f"tape slow -{semitones} st, low-pass {LOWPASS_HZ} Hz, hall RT60 {RT60_S} s wet {WET}",
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "bytes": dest.stat().st_size})
        print(f"ok {dest.name} from {source} -{semitones} st, {len(x) / RATE:.1f} s")
    PROVENANCE.write_text(json.dumps(prov, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
