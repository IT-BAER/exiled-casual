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

# library clip name -> UAL2 take
CLIPS = {
    "Rig|Walk_Fwd_Loop": "Walk_Fwd_Loop",
    "Rig|Walk_Fwd_L_Loop": "Walk_Fwd_L_Loop",
    "Rig|Walk_Fwd_R_Loop": "Walk_Fwd_R_Loop",
    "Rig|Walk_L_Loop": "Walk_L_Loop",
    "Rig|Walk_R_Loop": "Walk_R_Loop",
    "Rig|Walk_Bwd_Loop": "Walk_Bwd_Loop",
    "Rig|Walk_Bwd_L_Loop": "Walk_Bwd_L_Loop",
    "Rig|Walk_Bwd_R_Loop": "Walk_Bwd_R_Loop",
}
# Clips this import supersedes: `build_direction_clips.py`'s generated walks and backpedal.
RETIRED = (
    "Rig|Jog_Back_Loop",
    "Rig|Jog_BackDiag_L_Loop",
    "Rig|Jog_BackDiag_R_Loop",
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
    takes = {a["name"]: a for a in add["animations"]}
    missing = sorted(set(CLIPS.values()) - set(takes))
    assert not missing, f"not in {SOURCE_GLB}: {missing}"
    doc["animations"] = [a for a in doc["animations"] if a.get("name") not in set(CLIPS) | set(RETIRED)]
    blob = bytearray(blob)

    def append(data, accessor):
        blob.extend(b"\0" * (-len(blob) % 4))
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        doc["accessors"].append(dict(accessor, bufferView=len(doc["bufferViews"]) - 1, byteOffset=0))
        return len(doc["accessors"]) - 1

    for name, take in CLIPS.items():
        clip = takes[take]
        out = {"name": name, "channels": [], "samplers": []}
        inputs = {}
        for channel in clip["channels"]:
            bone = add["nodes"][channel["target"]["node"]].get("name")
            path = channel["target"]["path"]
            if bone not in by_name or bone == "root":
                continue
            if not (path == "rotation" or (path == "translation" and bone == "pelvis")):
                continue
            sampler = clip["samplers"][channel["sampler"]]
            if sampler["input"] not in inputs:
                inputs[sampler["input"]] = append(accessor_bytes(add, extra, sampler["input"]), add["accessors"][sampler["input"]])
            values = accessor_bytes(add, extra, sampler["output"])
            source = add["accessors"][sampler["output"]]
            if path == "translation":
                floats = [v * UNIT for v in struct.unpack(f"<{len(values) // 4}f", values)]
                values = struct.pack(f"<{len(floats)}f", *floats)
                source = {k: v for k, v in source.items() if k not in ("min", "max")}
            out["samplers"].append({"input": inputs[sampler["input"]], "output": append(values, source),
                                    "interpolation": sampler.get("interpolation", "LINEAR")})
            out["channels"].append({"sampler": len(out["samplers"]) - 1, "target": {"node": by_name[bone], "path": path}})
        assert any(c["target"]["path"] == "translation" for c in out["channels"]), f"{take}: no pelvis translation"
        doc["animations"].append(out)
        print(f"{name}: {len(out['channels'])} channels")

    doc["buffers"][0]["byteLength"] = len(blob)
    write_glb(ANIMS, doc, compact(doc, bytes(blob)))
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    splice(args[0] if args else SOURCE_ZIP)
    sys.exit(0)
