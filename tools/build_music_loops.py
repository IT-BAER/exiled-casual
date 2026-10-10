"""Cut Eleven Music masters into seamless 90 s loops.

  python tools/build_music_loops.py            # every master -> review/audio/music/cand/
  python tools/build_music_loops.py --publish  # every master -> apps/web/public/music/ (music.ts rotates them)

A master (audio-libs/elevenlabs/music/<slot>-<n>.mp3, from tools/gen_music.py) is ~95 s.
The loop is the centred 90 s with the 4 s after it folded over its head by an equal-power
crossfade (head and tail are different music, so a linear one dips), then the bed builder's
circular 20 Hz high-pass, one loudness for every track, and Opus 96 kbps stereo.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.signal import butter, lfilter

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "audio-libs" / "elevenlabs" / "music"
CAND = ROOT / "review" / "audio" / "music" / "cand"
PUBLIC = ROOT / "apps" / "web" / "public" / "music"
RATE = 48_000
LOOP_S = 90
FADE_S = 4
TARGET_LUFS = -18.0
PEAK_DB = -1.0


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def loop(x):
    n, f = LOOP_S * RATE, FADE_S * RATE
    if len(x) < n + f:
        sys.exit(f"master is {len(x) / RATE:.1f} s, needs {LOOP_S + FADE_S} s")
    off = (len(x) - n - f) // 2
    seg = x[off:off + n + f]
    out = seg[f:].copy()
    t = (np.arange(f) / f)[:, None]
    # The head folded under the tail ends where the body starts, so the last sample runs into the first.
    out[-f:] = seg[n:n + f] * np.cos(t * np.pi / 2) + seg[:f] * np.sin(t * np.pi / 2)
    return out


def circular_highpass(x, hz=20):
    """Run twice and keep the second pass, so the filter is as settled at the head as at the tail."""
    b, a = butter(2, hz, "highpass", fs=RATE)
    zi = np.zeros((max(len(a), len(b)) - 1, x.shape[1]))
    _, zf = lfilter(b, a, x, axis=0, zi=zi)
    return lfilter(b, a, x, axis=0, zi=zf)[0]


def lufs(wav):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).round().astype("<i2")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "2", "-i", "-", str(path)],
                   input=pcm.tobytes(), check=True)


def build(master, dest):
    x = circular_highpass(loop(decode(master)))
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "loop.wav"
        write_wav(wav, x)
        measured = lufs(wav)
        gain_db = min(TARGET_LUFS - measured, PEAK_DB - 20 * np.log10(np.abs(x).max()))
        write_wav(wav, x * 10 ** (gain_db / 20))
        final = lufs(wav)
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-c:a", "libopus", "-b:a", "96k", "-vbr", "on",
                        "-application", "audio", "-ar", str(RATE), str(dest)], check=True)
    return {"file": dest.name, "lufs_in": measured, "gain_db": round(gain_db, 2), "lufs": final,
            "seconds": len(x) / RATE, "bytes": dest.stat().st_size}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="write to apps/web/public/music instead of review")
    args = ap.parse_args()
    jobs = [(m, (PUBLIC if args.publish else CAND) / f"{m.stem}.webm") for m in sorted(MASTERS.glob("*.mp3"))]
    if not jobs:
        sys.exit(f"no masters in {MASTERS}")
    report = [build(m, d) for m, d in jobs]
    for r in report:
        print(json.dumps(r))


if __name__ == "__main__":
    main()
