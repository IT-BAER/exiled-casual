"""Add a second slash clip to `anim-library.glb`.

The pack ships exactly one sword swing, `Rig|Sword_Attack`, so alternating melee
takes had to borrow `Rig|Punch_Cross` — a punch, not a slash. This authors
`Rig|Sword_Attack_Down`: the same swing, rolled about the character's forward
axis so the arc comes down diagonally instead of across.

The roll is applied as a RIGID transform of the whole weapon arm about the
shoulder head, not as a per-channel offset: rotating the chain about its own
pivot keeps the hand attached to the shoulder and keeps elbow and wrist roll
exactly as authored, so the swing still reads as a swing. Everything below the
clavicle moves together; the rest of the body is the source's, so the two clips
blend against the same torso.

Same splice as `tools/build_cast_mirror.py`, for the same reason: the library is
a vendored FBX2glTF conversion and re-exporting it would rewrite all 45 clips.
Re-running replaces the clip it added last time, so this is idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_slash_variant.py
"""

import json
import math
import os
import struct
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "apps/web/public/models/anim-library.glb")
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-slash-variant.glb")

SOURCE_CLIP = "Rig|Sword_Attack"
VARIANT_CLIP = "Rig|Sword_Attack_Down"

# Root of the rigid rotation. Its whole subtree rides along.
ARM_ROOT = "upperarm_r"
# glTF's -Z forward lands on +Y after the importer's axis conversion, so a roll
# about +Y tips the swing plane down toward the floor without turning the body.
ROLL_AXIS = Vector((0.0, 1.0, 0.0))
ROLL_DEGREES = -38.0


def read_glb(path):
    with open(path, "rb") as handle:
        data = handle.read()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, path
    offset, doc, blob = 12, None, b""
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            blob = chunk
        offset += 8 + size
    assert doc is not None, path
    return doc, blob


def write_glb(path, doc, blob):
    text = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    blob += b"\0" * (-len(blob) % 4)
    body = (
        struct.pack("<II", len(text), 0x4E4F534A) + text
        + struct.pack("<II", len(blob), 0x004E4942) + blob
    )
    with open(path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)


def build_variant():
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    source = bpy.data.actions[SOURCE_CLIP]

    anim = arm.animation_data_create()
    anim.action = source
    anim.action_slot = source.slots[0]

    scene = bpy.context.scene
    start, end = (int(round(v)) for v in source.frame_range)
    order = [b.name for b in arm.pose.bones]
    order.sort(key=lambda n: len(arm.data.bones[n].parent_recursive))

    poses = []
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        poses.append({b.name: b.matrix.copy() for b in arm.pose.bones})

    subtree = {ARM_ROOT} | {b.name for b in arm.data.bones[ARM_ROOT].children_recursive}

    anim.action = None
    stale = bpy.data.actions.get(VARIANT_CLIP)
    if stale is not None:
        bpy.data.actions.remove(stale)
    variant = bpy.data.actions.new(VARIANT_CLIP)
    arm.animation_data.action = variant

    # Forward, never reversed: the source lands its hit near the END, so a
    # back-to-front take would strike on frame one and finish with the sword
    # raised. Only the swing PLANE changes.
    for index, pose in enumerate(poses):
        frame = start + index
        scene.frame_set(frame)
        pivot = pose[ARM_ROOT].to_translation()
        roll = (
            Matrix.Translation(pivot)
            @ Matrix.Rotation(math.radians(ROLL_DEGREES), 4, ROLL_AXIS)
            @ Matrix.Translation(-pivot)
        )
        for name in order:
            arm.pose.bones[name].matrix = roll @ pose[name] if name in subtree else pose[name]
            bpy.context.view_layer.update()
        for name in order:
            bone = arm.pose.bones[name]
            bone.keyframe_insert("location", frame=frame)
            bone.keyframe_insert("rotation_quaternion", frame=frame)

    for action in list(bpy.data.actions):
        if action is not variant:
            bpy.data.actions.remove(action)

    bpy.ops.export_scene.gltf(
        filepath=SCRATCH,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        export_optimize_animation_size=False,
        export_apply=False,
    )


def splice():
    doc, blob = read_glb(ANIMS)
    add, extra = read_glb(SCRATCH)

    clips = [a for a in add.get("animations", []) if a.get("name") in (VARIANT_CLIP, "Action")]
    assert len(clips) == 1, [a.get("name") for a in add.get("animations", [])]
    clip = clips[0]

    by_name = {n["name"]: i for i, n in enumerate(doc["nodes"]) if "name" in n}
    from_add = {i: n.get("name") for i, n in enumerate(add["nodes"])}

    doc["animations"] = [a for a in doc.get("animations", []) if a.get("name") != VARIANT_CLIP]

    accessor_base = len(doc["accessors"])
    blob += b"\0" * (-len(blob) % 4)

    used = {s[k] for s in clip["samplers"] for k in ("input", "output")}
    remap = {}
    for index in sorted(used):
        accessor = dict(add["accessors"][index])
        view = dict(add["bufferViews"][accessor["bufferView"]])
        start = view.get("byteOffset", 0)
        chunk = extra[start:start + view["byteLength"]]
        view["byteOffset"] = len(blob)
        view["buffer"] = 0
        blob += chunk + b"\0" * (-len(chunk) % 4)
        accessor["bufferView"] = len(doc["bufferViews"])
        doc["bufferViews"].append(view)
        remap[index] = accessor_base + len(remap)
        doc["accessors"].append(accessor)

    clip = json.loads(json.dumps(clip))
    clip["name"] = VARIANT_CLIP
    for sampler in clip["samplers"]:
        sampler["input"] = remap[sampler["input"]]
        sampler["output"] = remap[sampler["output"]]
    kept = []
    for channel in clip["channels"]:
        name = from_add.get(channel["target"].get("node"))
        if name not in by_name:
            continue
        channel["target"]["node"] = by_name[name]
        kept.append(channel)
    clip["channels"] = kept
    assert kept, "no channel matched a library node by name"

    doc["animations"].append(clip)
    doc["buffers"][0]["byteLength"] = len(blob) + (-len(blob) % 4)
    write_glb(ANIMS, doc, blob)
    os.remove(SCRATCH)
    return len(kept)


def main():
    build_variant()
    channels = splice()
    print(f"{VARIANT_CLIP}: {channels} channels, {os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
