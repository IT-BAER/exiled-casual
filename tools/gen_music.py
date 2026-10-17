"""Generate music candidates with Eleven Music (POST /v1/music) and record their provenance.

  claude-bw run -- python tools/gen_music.py            # every slot, 3 candidates each
  claude-bw run -- python tools/gen_music.py --slot forest --takes 1

The key comes from ELEVENLABS_API_KEY (a bw:// reference resolved by claude-bw run); it is
never printed. Masters land in audio-libs/elevenlabs/music/<slot>-<n>.mp3 (gitignored); an
existing master is skipped, so a failed run resumes. Every generation is appended to
assets/audio/elevenlabs-provenance.json, because commercial rights follow the plan at
generation time.
"""
import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audio-libs" / "elevenlabs" / "music"
PROVENANCE = ROOT / "assets" / "audio" / "elevenlabs-provenance.json"
API = "https://api.elevenlabs.io/v1/music"
MODEL = "music_v2_5"
FORMAT = "mp3_48000_192"
LENGTH_MS = 95_000
PLAN = "review/audio/music-plan.md"

COMMON = ("Instrumental ambient background score for a dark fantasy action RPG. Passive and steady: "
          "no intro, no ending, no build-up, no climax, no drums, no beat, no percussion, constant "
          "dynamics from the first second to the last, so it can loop. ")
SLOTS = {
    "hideout-1": "A safe hearth by the fire: warm low strings, soft harp, slow, gentle, comforting.",
    "hideout-2": "A quiet refuge at dusk: melancholy low strings and a distant soft choir pad, slow, wistful.",
    "hideout-3": "A mystic sanctum: soft harp arpeggios over a distant choir pad and a low drone, slow, otherworldly.",
    "vaal_stone": "An ancient ruin: low drone, sparse metallic chimes, a faint ritual undertone, cold stone, dread.",
    "desert": "An empty desert: sparse oud and duduk phrases over a dry sustained drone, heat, emptiness.",
    "swamp": "A murky swamp: low murky pads, detuned woodwind, a slow heavy pulse in the pads, oppressive.",
    "forest": "A night forest: soft cello and flute over wide pads, mysterious, wide, still.",
    "coast": "A cold open sea coast: airy pads, a slow low brass swell, lonely, wide, grey.",
    "menu": "The title screen: a slow brooding theme, a lone cello melody over low strings, a distant "
             "choir pad and a deep drone, solemn, ancient, cinematic, embers in the dark.",
    "death": "The death screen: mournful, sparse and dark, very slow at about 65 bpm, low sustained strings "
             "and a distant choir pad, long held notes, silence between them, no melodic hook or repeating "
             "phrase that tires on loop, cold, hollow, grieving, ending where it begins so it loops seamlessly.",
}


def generate(slot, n, key):
    dest = OUT / f"{slot}-{n}.mp3"
    if dest.exists():
        return None
    prompt = COMMON + SLOTS[slot]
    body = {"prompt": prompt, "music_length_ms": LENGTH_MS, "model_id": MODEL, "force_instrumental": True}
    req = urllib.request.Request(f"{API}?output_format={FORMAT}", data=json.dumps(body).encode(),
                                 headers={"xi-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            audio = r.read()
            ids = {k.lower(): v for k, v in r.headers.items() if "id" in k.lower() and "key" not in k.lower()}
    except urllib.error.HTTPError as e:
        return {"slot": slot, "n": n, "error": f"HTTP {e.code}: {e.read()[:300].decode(errors='replace')}"}
    dest.write_bytes(audio)
    return {"kind": "music", "file": f"audio-libs/elevenlabs/music/{dest.name}", "slot": slot, "take": n,
            "response_ids": ids, "model_id": MODEL, "output_format": FORMAT, "music_length_ms": LENGTH_MS,
            "force_instrumental": True, "prompt": prompt, "plan": PLAN,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "bytes": len(audio)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slot", choices=sorted(SLOTS), action="append")
    ap.add_argument("--takes", type=int, default=3)
    ap.add_argument("--jobs", type=int, default=3)
    args = ap.parse_args()
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key or key.startswith("bw://"):
        sys.exit("ELEVENLABS_API_KEY missing: run under claude-bw run with a bw:// reference")
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [(s, n) for s in (args.slot or SLOTS) for n in range(1, args.takes + 1)]
    with ThreadPoolExecutor(args.jobs) as pool:
        results = [r for r in pool.map(lambda j: generate(*j, key), jobs) if r]
    prov = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    for r in results:
        if "error" in r:
            print(f"FAIL {r['slot']}-{r['n']}: {r['error']}")
        else:
            prov["generations"].append(r)
            print(f"ok {r['slot']}-{r['take']} {r['bytes']} B {r['response_ids']}")
    PROVENANCE.write_text(json.dumps(prov, indent=1) + "\n", encoding="utf-8")
    failed = sum("error" in r for r in results)
    print(f"generated {len(results) - failed}, failed {failed}, skipped {len(jobs) - len(results)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
