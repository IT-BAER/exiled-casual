"""Cut one usable game one-shot out of a five-second MOSS render.

Why this exists
---------------
MOSS-SoundEffect v2 is conditioned on the length you ask for, and a short window
does not come back with an event in it. The first audio pass asked each cue for the
length it wanted (0.2s for a UI tick, 0.5s for a body hit) and ten of the twelve
requests under a second returned silence or near-silence -- peak 0.000 for both
`monster-hurt` and `player-hurt`. The nine requests of a second or more all came back
at full scale. Two of those still opened with a second of nothing and were cut off at
the far end, because the model does not put the event at the start either.

So every render is five seconds now, which reliably contains two or three usable
takes, and this picks one:

* find the loudest 20ms window -- that is the take to keep;
* walk back to where that take actually STARTS, so the file opens on the transient
  rather than on the silence in front of it (a one-shot with 300ms of lead is a
  one-shot that fires late, and no gain setting fixes late);
* run forward to where it has decayed into the noise floor, capped at `--max`;
* fade the last 40ms so the cut is not a click, and normalise to -1 dBFS so the
  per-voice gains in `sfx.ts` are the only thing setting level.

Run:
  python tools/trim_sfx.py review/audio/*.wav --out apps/web/public/audio
"""
from __future__ import annotations

import argparse
import array
import glob
import math
import os
import sys
import wave

# Where a take is considered to have started and ended, as a fraction of its own
# peak. Onset is tight because a transient rises in a millisecond; release is loose
# because a tail that fades to a fiftieth is a tail nobody hears the end of.
ONSET_FRACTION = 0.06
# Loose enough that a real tail is kept, tight enough that the walk stops before it
# reaches the NEXT take: a five-second render holds two or three, and at 2% the
# release from one ran straight into the attack of the one after it.
RELEASE_FRACTION = 0.08
# ...and a rise back up to this share of the peak, from below the share under it, is
# the next take starting. Belt and braces, because a long reverberant tail never gets
# quiet enough for the fraction above to fire. Both halves matter: a plain "rose 2.5x
# off the floor" cut `monster-hurt` at 90ms, because the wet slap AFTER the thud is a
# second transient inside ONE hit, not a second hit.
REATTACK_FLOOR = 0.15
REATTACK_PEAK = 0.40
# And nothing is cut shorter than this however the walk goes: below it a one-shot
# stops being a sound and becomes a click.
MIN_RELEASE_MS = 140
# Room in front of the transient. Enough that the attack is not clipped, short
# enough that the cue still lands on the frame it is asked for.
PRE_ROLL_MS = 12
FADE_OUT_MS = 40
# Peak the trimmed file is normalised to. Not 1.0: Opus is lossy and can overshoot
# the sample values it was given, and a clipped encode is audible as a crackle.
TARGET_PEAK = 0.89
# Shortest take worth keeping; below this the render found nothing.
MIN_TAKE_MS = 40

# How long each cue is allowed to be. A design decision, not a technical one: a
# footstep that rings for two seconds is wrong however good the sample is, and a
# cast longer than its own cooldown overlaps itself when the skill is held down.
# Longest prefix wins; anything unlisted takes the default.
MAX_SECONDS: dict[str, float] = {
    "ui-hover": 0.22,
    "ui-click": 0.30,
    "ui-panel-open": 0.60,
    "footstep": 0.35,
    "monster-hurt": 0.55,
    "player-hurt": 0.55,
    "monster-melee-hit": 0.60,
    "monster-spit": 0.70,
    "skill-blink": 0.80,
    "flask-drink": 1.00,
    "skill-ember-bolt-impact": 0.90,
    "skill-ember-bolt-cast": 0.90,
    "portal-enter": 1.20,
    "skill-cinder-ground-cast": 1.40,
    "monster-slam-windup": 1.20,
    "monster-slam-impact": 1.40,
    "portal-close": 1.40,
    "monster-death": 1.60,
    "waystone-activate": 1.80,
    "portal-open": 2.00,
}


def max_for(name: str) -> float:
    best = 0.0
    hit = None
    for prefix, secs in MAX_SECONDS.items():
        if name.startswith(prefix) and len(prefix) > best:
            best, hit = len(prefix), secs
    return hit if hit is not None else 2.0


def read_wav(path: str) -> tuple[array.array, int]:
    with wave.open(path) as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            sys.exit(f"{path}: expected 16-bit mono, got {w.getsampwidth()*8}-bit x{w.getnchannels()}")
        a = array.array("h")
        a.frombytes(w.readframes(w.getnframes()))
        return a, w.getframerate()


def write_wav(path: str, samples: array.array, rate: int) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())


def envelope(a: array.array, win: int) -> list[float]:
    """Peak amplitude per `win` samples, 0..1. Cheap and enough to find a take."""
    out = []
    for i in range(0, len(a), win):
        seg = a[i:i + win]
        out.append((max(abs(x) for x in seg) / 32768.0) if seg else 0.0)
    return out


def trim(a: array.array, rate: int, max_s: float) -> tuple[array.array, dict]:
    win = max(1, rate // 50)  # 20 ms
    env = envelope(a, win)
    peak = max(env) if env else 0.0
    if peak <= 0.0:
        return array.array("h"), {"peak": 0.0, "start": 0.0, "len": 0.0}

    loudest = env.index(peak)
    # Back off to the start of THIS take: the last window before it that was quiet.
    onset = loudest
    while onset > 0 and env[onset - 1] > peak * ONSET_FRACTION:
        onset -= 1
    # And forward to where it has died away.
    end = loudest
    floor = env[loudest]
    hold = loudest + int(math.ceil(rate * MIN_RELEASE_MS / 1000 / win))
    while end + 1 < len(env):
        nxt = env[end + 1]
        if end >= hold:
            if nxt <= peak * RELEASE_FRACTION:
                break
            # Fallen away and come back: that is the next take, not this one's tail.
            if floor <= peak * REATTACK_FLOOR and nxt >= peak * REATTACK_PEAK:
                break
        floor = min(floor, nxt)
        end += 1

    start_i = max(0, onset * win - int(rate * PRE_ROLL_MS / 1000))
    end_i = min(len(a), (end + 1) * win)
    end_i = min(end_i, start_i + int(rate * max_s))
    cut = a[start_i:end_i]
    if len(cut) < rate * MIN_TAKE_MS / 1000:
        return array.array("h"), {"peak": peak, "start": start_i / rate, "len": len(cut) / rate}

    # Fade the tail, so a cut mid-decay is not a click.
    fade = min(int(rate * FADE_OUT_MS / 1000), len(cut))
    for i in range(fade):
        cut[len(cut) - fade + i] = int(cut[len(cut) - fade + i] * (1.0 - i / fade))
    # And the first two milliseconds, for the same reason at the other end.
    lead = min(int(rate * 0.002), len(cut))
    for i in range(lead):
        cut[i] = int(cut[i] * (i / lead))

    loud = max(abs(x) for x in cut) / 32768.0
    if loud > 0:
        g = TARGET_PEAK / loud
        for i, x in enumerate(cut):
            cut[i] = max(-32768, min(32767, int(x * g)))
    return cut, {"peak": peak, "start": start_i / rate, "len": len(cut) / rate}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", required=True, help="directory for the trimmed WAVs")
    ap.add_argument("--max", type=float, default=0.0,
                    help="override the per-cue cap in MAX_SECONDS, seconds")
    args = ap.parse_args()

    paths: list[str] = []
    for pattern in args.inputs:
        paths.extend(sorted(glob.glob(pattern)))
    os.makedirs(args.out, exist_ok=True)

    bad = 0
    for path in paths:
        name = os.path.basename(path)
        a, rate = read_wav(path)
        cut, info = trim(a, rate, args.max or max_for(name[:-4]))
        if not len(cut):
            print(f"{name:30} EMPTY (peak {info['peak']:.3f}) -- regenerate this one")
            bad += 1
            continue
        write_wav(os.path.join(args.out, name), cut, rate)
        print(f"{name:30} take at {info['start']:5.2f}s, {info['len']:4.2f}s, source peak {info['peak']:.3f}")
    if bad:
        sys.exit(f"{bad} render(s) had nothing in them")


main()
