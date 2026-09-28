"""Copy authored clips from Quaternius' Universal Animation Library 2 into `anim-library.glb`.

UAL2 is drawn on the same 65-bone mannequin as the library, at the same rest
rotations, so a clip transfers as-is: rotations bone for bone, and the pelvis
translation scaled from the pack's metres into the library's rig units (the
library's `Rig` node carries a 100x scale, UAL2's armature none). Everything
else Blender's exporter keys - root, scale, the other translations, the `*_leaf_*`
tips the library names `*_end_*` - holds rest and is left out, because a keyed
channel overrides whatever the runtime layers under it.

Reads `UAL2.glb` straight out of the Source zip (not vendored: 53 MB, CC0).
Re-running replaces the clips it added last time, so this is idempotent. Runs
under Blender's Python only because the shared glb helpers import bpy.

    blender --background --factory-startup --disable-autoexec --python-exit-code 1         --python tools/import_ual2_clips.py [-- path/to/UAL2-Source.zip]
"""

import json
import os
import struct
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cast_mirror import compact, write_glb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "apps/web/public/models/anim-library.glb")
SOURCE_ZIP = "D:/Downloads/Universal Animation Library 2[Source].zip"
SOURCE_GLB = "Unreal-Godot/UAL2.glb"  # the in-place export; UAL2_RM bakes root motion

# library clip name -> UAL2 take, or takes played back to back. A sword attack
# stops on its impact pose and its `_Rec` take starts on it, so a strike is both.
CLIPS = {
    "Rig|Walk_Fwd_Loop": "Walk_Fwd_Loop",
    "Rig|Walk_Fwd_L_Loop": "Walk_Fwd_L_Loop",
    "Rig|Walk_Fwd_R_Loop": "Walk_Fwd_R_Loop",
    "Rig|Walk_L_Loop": "Walk_L_Loop",
    "Rig|Walk_R_Loop": "Walk_R_Loop",
    "Rig|Walk_Bwd_Loop": "Walk_Bwd_Loop",
    "Rig|Walk_Bwd_L_Loop": "Walk_Bwd_L_Loop",
    "Rig|Walk_Bwd_R_Loop": "Walk_Bwd_R_Loop",
    "Rig|Sword_Regular_A": ("Sword_Regular_A", "Sword_Regular_A_Rec"),
    "Rig|Sword_Regular_B": ("Sword_Regular_B", "Sword_Regular_B_Rec"),
    "Rig|Sword_Regular_C": "Sword_Regular_C",  # its recovery is in the take
    "Rig|Hit_Knockback": "Hit_Knockback",
    "Rig|Consume": "Consume",
    "Rig|Chest_Open": "Chest_Open",
}
# Clips this import supersedes: `build_direction_clips.py`'s generated walks and
# `build_slash_variant.py`'s backhand.
RETIRED = (
    "Rig|Sword_Attack_Back",
    "Rig|Walk_Loop",
    "Rig|Walk_Back_Loop",
    "Rig|Walk_BackDiag_L_Loop",
    "Rig|Walk_BackDiag_R_Loop",
    "Rig|Walk_Strafe_L_Loop",
    "Rig|Walk_Strafe_R_Loop",
)
UNIT = 0.01  # UAL2 metres -> library rig units


def parse_glb(data):
    offset, doc, blob = 12, None, b""
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            blob = chunk
        offset += 8 + size
    assert doc is not None
    return doc, blob


def accessor_bytes(doc, blob, index):
    accessor = doc["accessors"][index]
    view = doc["bufferViews"][accessor["bufferView"]]
    assert accessor["componentType"] == 5126 and "byteStride" not in view, "tightly packed floats only"
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[accessor["type"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return blob[start:start + 4 * width * accessor["count"]]


def splice(src_zip):
    with open(ANIMS, "rb") as handle:
        doc, blob = parse_glb(handle.read())
    with zipfile.ZipFile(src_zip) as pack:
        add, extra = parse_glb(pack.read(SOURCE_GLB))

    by_name = {n["name"]: i for i, n in enumerate(doc["nodes"]) if "name" in n}
    sources = {name: (take,) if isinstance(take, str) else take for name, take in CLIPS.items()}
    takes = {a["name"]: a for a in add["animations"]}
    missing = sorted({t for seq in sources.values() for t in seq} - set(takes))
    assert not missing, f"not in {SOURCE_GLB}: {missing}"
    doc["animations"] = [a for a in doc["animations"] if a.get("name") not in set(CLIPS) | set(RETIRED)]
    blob = bytearray(blob)

    def append(data, accessor):
        blob.extend(b"\0" * (-len(blob) % 4))
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        doc["accessors"].append(dict(accessor, bufferView=len(doc["bufferViews"]) - 1, byteOffset=0))
        return len(doc["accessors"]) - 1

    def floats(index):
        data = accessor_bytes(add, extra, index)
        return list(struct.unpack(f"<{len(data) // 4}f", data))

    def kept(clip):
        """(bone, path) -> sampler for the channels the library keeps."""
        out = {}
        for channel in clip["channels"]:
            bone = add["nodes"][channel["target"]["node"]].get("name")
            path = channel["target"]["path"]
            if bone not in by_name or bone == "root":
                continue
            if path == "rotation" or (path == "translation" and bone == "pelvis"):
                out[(bone, path)] = clip["samplers"][channel["sampler"]]
        return out

    for name, seq in sources.items():
        parts = [kept(takes[t]) for t in seq]
        assert all(p.keys() == parts[0].keys() for p in parts), f"{name}: takes key different channels"
        out = {"name": name, "channels": [], "samplers": []}
        inputs = {}
        for (bone, path), first in parts[0].items():
            samplers = [p[(bone, path)] for p in parts]
            key = tuple(s["input"] for s in samplers)
            width = 4 if path == "rotation" else 3
            times, values, offset = [], [], 0.0
            # Each later take starts on the pose the one before it ended on: drop
            # that duplicate key, since glTF times must strictly increase.
            for i, s in enumerate(samplers):
                t, v = floats(s["input"]), floats(s["output"])
                skip = 1 if i else 0
                times += [x + offset for x in t[skip:]]
                values += v[skip * width:]
                offset += t[-1]
            if path == "translation":
                values = [v * UNIT for v in values]
            if key not in inputs:
                inputs[key] = append(struct.pack(f"<{len(times)}f", *times),
                                     {"componentType": 5126, "type": "SCALAR", "count": len(times),
                                      "min": [times[0]], "max": [times[-1]]})
            source = {k: v for k, v in add["accessors"][first["output"]].items() if k not in ("min", "max")}
            source["count"] = len(times)
            out["samplers"].append({"input": inputs[key], "output": append(struct.pack(f"<{len(values)}f", *values), source),
                                    "interpolation": first.get("interpolation", "LINEAR")})
            out["channels"].append({"sampler": len(out["samplers"]) - 1, "target": {"node": by_name[bone], "path": path}})
        assert any(c["target"]["path"] == "translation" for c in out["channels"]), f"{name}: no pelvis translation"
        doc["animations"].append(out)
        print(f"{name}: {len(out['channels'])} channels, {offset:.3f}s")

    doc["buffers"][0]["byteLength"] = len(blob)
    write_glb(ANIMS, doc, compact(doc, bytes(blob)))
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    splice(args[0] if args else SOURCE_ZIP)
    sys.exit(0)
