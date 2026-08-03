"""Add a right-handed cast clip to `anim-library.glb`.

`Rig|Spell_Simple_Shoot` raises the LEFT hand, but `weapon1.*` skins to `hand_r`
and the bolt leaves `castPoint()` = `hand_r`, so the pack's own clip casts from
the empty hand. This mirrors it about the rig's X plane and appends the result as
`Rig|Spell_Simple_Shoot_R`.

The mirror is done on pose MATRICES (`M' = S M S`, `S = diag(-1,1,1)`), not on
local quaternion channels: bone roll is not perfectly mirrored on this rig (the
thumb tips are 6% off), and a channel-level flip inherits that error. Imposing
the mirrored pose does not. It is imposed PARENT-RELATIVE (see `mirrored_pose`),
because the runtime layers this clip's upper body over another clip's hips.

The library glb is patched, never re-exported: the file is a vendored FBX2glTF
conversion of the Quaternius pack and re-encoding all 44 clips through Blender's
exporter would rewrite every one of them. Blender only authors the new clip into
a scratch glb, whose animation is then spliced into the library by node name.
Re-running replaces the clip it added last time, so this is idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_cast_mirror.py
"""

import json
import os
import struct
import tempfile
import sys


import bpy
from mathutils import Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "apps/web/public/models/anim-library.glb")
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-cast-mirror.glb")

SOURCE_CLIP = "Rig|Spell_Simple_Shoot"
MIRROR_CLIP = "Rig|Spell_Simple_Shoot_R"

MIRROR = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))


def flipped(name):
    """The bone on the other side, or the bone itself when it is on the midline."""
    if name.endswith("_l"):
        return name[:-2] + "_r"
    if name.endswith("_r"):
        return name[:-2] + "_l"
    return name


# --- glb container -----------------------------------------------------------

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


def mirrored_pose(arm, pose):
    """
    One frame of the source pose, reflected, in PARENT-RELATIVE terms.

    The cast is an UPPER-BODY clip: `rig.ts` keeps root and pelvis on whatever
    locomotion clip is playing and takes only the spine and arms from this one.
    So what has to be mirrored is each bone against its own parent, never its
    armature-space matrix: reflecting the latter folds the source clip's own
    global hip yaw into the answer, and the hips the result lands on at runtime
    are a different clip's. That is what made the torso twist to one side
    whatever he cast at.

    Reflected relative to the parent, chest-against-hips is the exact negation
    of the original whatever pelvis it is layered over, which is the definition
    of a mirrored upper body.
    """
    flat = {name: MIRROR @ pose[flipped(name)] @ MIRROR for name in pose}
    out = {}
    for name in sorted(flat, key=lambda n: len(arm.data.bones[n].parent_recursive)):
        parent = arm.data.bones[name].parent
        # The root keeps the source's own placement: only the pose below it is a
        # mirror, and the runtime overrides root and pelvis anyway.
        out[name] = pose[name] if parent is None else (
            out[parent.name] @ flat[parent.name].inverted() @ flat[name]
        )
    return out


# --- authoring ---------------------------------------------------------------

def build_mirror():
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    source = bpy.data.actions[SOURCE_CLIP]

    anim = arm.animation_data_create()
    anim.action = source
    anim.action_slot = source.slots[0]

    scene = bpy.context.scene
    start, end = (int(round(v)) for v in source.frame_range)
    # Parents first: `pose_bone.matrix` is set through the parent's evaluated
    # matrix, so a child written before its parent is written against a stale one.
    order = [b.name for b in arm.pose.bones]
    order.sort(key=lambda n: len(arm.data.bones[n].parent_recursive))

    poses = []
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        poses.append({b.name: b.matrix.copy() for b in arm.pose.bones})

    anim.action = None
    # The library already carries last run's clip, and a name collision would
    # export as `<name>.001`, which the splice below does not recognise.
    stale = bpy.data.actions.get(MIRROR_CLIP)
    if stale is not None:
        bpy.data.actions.remove(stale)
    mirror = bpy.data.actions.new(MIRROR_CLIP)
    arm.animation_data.action = mirror

    for index, pose in enumerate(poses):
        scene.frame_set(start + index)
        target = mirrored_pose(arm, pose)
        for name in order:
            arm.pose.bones[name].matrix = target[name]
            bpy.context.view_layer.update()
        for name in order:
            bone = arm.pose.bones[name]
            bone.keyframe_insert("location", frame=start + index)
            bone.keyframe_insert("rotation_quaternion", frame=start + index)

    for action in list(bpy.data.actions):
        if action is not mirror:
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
    return arm


# --- splice ------------------------------------------------------------------

def splice():
    doc, blob = read_glb(ANIMS)
    add, extra = read_glb(SCRATCH)

    clips = [a for a in add.get("animations", []) if a.get("name") in (MIRROR_CLIP, "Action")]
    assert len(clips) == 1, [a.get("name") for a in add.get("animations", [])]
    clip = clips[0]

    by_name = {n["name"]: i for i, n in enumerate(doc["nodes"]) if "name" in n}
    from_add = {i: n.get("name") for i, n in enumerate(add["nodes"])}

    doc["animations"] = [a for a in doc.get("animations", []) if a.get("name") != MIRROR_CLIP]

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
    clip["name"] = MIRROR_CLIP
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
    build_mirror()
    channels = splice()
    print(f"{MIRROR_CLIP}: {channels} channels, {os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
