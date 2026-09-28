"""Add a backhand slash clip to `anim-library.glb`.

RETIRED: the runtime plays UAL2's sword chain (`tools/import_ual2_clips.py`, which
removes this clip). Do not run it; other tools still import its glb helpers.

The pack ships exactly one sword swing, `Rig|Sword_Attack`, a forehand. This
authors `Rig|Sword_Attack_Back`, the return stroke: it winds up into the
forehand's contact pose and swings back to the forehand's raised pose, so the
two alternate as a slash and its backhand.

Every phase lands at the same share of the clip as the source's, because the
runtime paces both takes with one set of fractions (`STRIKE_DROP`,
`STRIKE_CONTACT` in `apps/web/src/render/rig.ts`):
  raise   0 .. DROP        ease from the source's first pose into its contact pose
  drop    DROP .. CONTACT  the source's drop run backwards, re-timed to ACCELERATE
                           into contact (reversed as-is it would be fastest first)
  follow  CONTACT .. end   ease from the source's drop-start pose back to its first

Same splice as `tools/build_cast_mirror.py`, and its `compact` drops the keys of
the clip it replaces. Re-running replaces the clip it added last time, so this
is idempotent.

    blender --background --factory-startup --disable-autoexec         --python-exit-code 1 --python tools/build_slash_variant.py
"""

import json
import os
import struct
import sys
import tempfile

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cast_mirror import compact  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "apps/web/public/models/anim-library.glb")
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-slash-variant.glb")

SOURCE_CLIP = "Rig|Sword_Attack"
VARIANT_CLIP = "Rig|Sword_Attack_Back"
# Clips this tool authored before; the splice removes them.
RETIRED = ("Rig|Sword_Attack_Down",)

# Keep in step with STRIKE_DROP / STRIKE_CONTACT in apps/web/src/render/rig.ts.
DROP = 0.2
CONTACT = 0.345
# The hand the drop is re-timed by: its path length, not the frame count.
HAND = "hand_r"


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


def smooth(u):
    return u * u * (3.0 - 2.0 * u)


def blend(a, b, u):
    """Per-bone local pose between two sampled poses."""
    return {n: (a[n][0].lerp(b[n][0], u), a[n][1].slerp(b[n][1], u)) for n in a}


def build_variant():
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    source = bpy.data.actions[SOURCE_CLIP]

    anim = arm.animation_data_create()
    anim.action = source
    anim.action_slot = source.slots[0]

    scene = bpy.context.scene
    start, end = (int(round(v)) for v in source.frame_range)
    names = [b.name for b in arm.pose.bones]
    for b in arm.pose.bones:
        b.rotation_mode = "QUATERNION"

    poses, hand = [], []
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        poses.append({b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in arm.pose.bones})
        hand.append(arm.pose.bones[HAND].head.copy())
    last = len(poses) - 1

    def pose_at(x):
        i = min(int(x), last - 1)
        return blend(poses[i], poses[i + 1], x - i)

    drop_at, contact_at = DROP * last, CONTACT * last
    # Path length of the hand along the source drop, sampled finely, so the
    # reversed drop can be re-timed by distance travelled.
    steps = 200
    xs = [drop_at + (contact_at - drop_at) * k / steps for k in range(steps + 1)]
    def hand_at(x):
        i = min(int(x), last - 1)
        return hand[i].lerp(hand[i + 1], x - i)
    arc = [0.0]
    for k in range(1, steps + 1):
        arc.append(arc[-1] + (hand_at(xs[k]) - hand_at(xs[k - 1])).length)
    total = arc[-1]

    def reversed_drop(s):
        """Source frame for share s of the backhand drop: ease-in by hand distance."""
        want = total * (1.0 - s * s)  # distance from the source drop START
        k = next((k for k in range(1, steps + 1) if arc[k] >= want), steps)
        f = (want - arc[k - 1]) / max(1e-9, arc[k] - arc[k - 1])
        return xs[k - 1] + (xs[k] - xs[k - 1]) * f

    first, top, hit = poses[0], pose_at(drop_at), pose_at(contact_at)
    # The backhand's own phase edges sit ON frames, or the hit pose falls between
    # two keys and the blade is still moving on the frame after contact.
    b_drop, b_contact = round(drop_at), int(contact_at)

    anim.action = None
    for name in (VARIANT_CLIP,) + RETIRED:
        stale = bpy.data.actions.get(name)
        if stale is not None:
            bpy.data.actions.remove(stale)
    variant = bpy.data.actions.new(VARIANT_CLIP)
    arm.animation_data.action = variant

    for index in range(last + 1):
        frame = start + index
        if index <= b_drop:
            pose = blend(first, hit, smooth(index / b_drop))
        elif index <= b_contact:
            pose = pose_at(reversed_drop((index - b_drop) / (b_contact - b_drop)))
        else:
            pose = blend(top, first, smooth((index - b_contact) / (last - b_contact)))
        for name in names:
            bone = arm.pose.bones[name]
            bone.location, bone.rotation_quaternion = pose[name]
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

    doc["animations"] = [a for a in doc.get("animations", []) if a.get("name") not in (VARIANT_CLIP,) + RETIRED]

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
    write_glb(ANIMS, doc, compact(doc, blob))
    os.remove(SCRATCH)
    return len(kept)


def main():
    build_variant()
    channels = splice()
    print(f"{VARIANT_CLIP}: {channels} channels, {os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
