"""Add backpedal clips to `anim-library.glb`: the forward walk and jog, reversed.

The pack's free set has no backward locomotion. A walk cycle played backwards
is a man stepping back heel-last, which is what a caster facing his target
while the keys carry him away from it has to show (PoE2's run-and-gun).

Both sources are sampled once per frame, linear, on one time track, so a
reversed clip keeps that track and reverses each channel's values alone.
Re-running replaces the clips it added last time, so this is idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_back_clips.py
"""

import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cast_mirror import read_glb, write_glb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "apps/web/public/models/anim-library.glb")

# source clip -> reversed clip; keep the names in step with CLIP_NAME in rig.ts.
BACK = {
    "Rig|Walk_Loop": "Rig|Walk_Back_Loop",
    "Rig|Jog_Fwd_Loop": "Rig|Jog_Back_Loop",
}
WIDTH = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}
FLOAT = 5126


def reversed_output(doc, blob, index):
    """Append a copy of float accessor `index` with its elements in reverse order."""
    accessor = doc["accessors"][index]
    assert accessor["componentType"] == FLOAT and "sparse" not in accessor, accessor
    view = doc["bufferViews"][accessor["bufferView"]]
    width = WIDTH[accessor["type"]] * 4
    assert view.get("byteStride", width) == width, "interleaved keys are not handled"
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    elements = [blob[start + i * width:start + (i + 1) * width] for i in range(count)]
    chunk = b"".join(reversed(elements))
    blob += b"\0" * (-len(blob) % 4)
    doc["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(chunk)})
    copy = {k: v for k, v in accessor.items() if k not in ("byteOffset", "min", "max")}
    copy["bufferView"] = len(doc["bufferViews"]) - 1
    doc["accessors"].append(copy)
    return blob + chunk, len(doc["accessors"]) - 1


def main():
    doc, blob = read_glb(ANIMS)
    doc["animations"] = [a for a in doc["animations"] if a.get("name") not in BACK.values()]
    for source_name, back_name in BACK.items():
        source = next(a for a in doc["animations"] if a.get("name") == source_name)
        samplers = []
        for sampler in source["samplers"]:
            assert sampler.get("interpolation", "LINEAR") == "LINEAR", sampler
            blob, output = reversed_output(doc, blob, sampler["output"])
            samplers.append({"input": sampler["input"], "interpolation": "LINEAR", "output": output})
        channels = [dict(c, target=dict(c["target"])) for c in source["channels"]]
        doc["animations"].append({"name": back_name, "channels": channels, "samplers": samplers})
        print(f"{back_name}: {len(channels)} channels from {source_name}")
    doc["buffers"][0]["byteLength"] = len(blob)
    write_glb(ANIMS, doc, blob)
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
