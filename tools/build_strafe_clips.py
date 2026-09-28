"""Add strafe clips to `anim-library.glb`: the walk and jog with the legs run on a diagonal.

A true sidestep at run pace crosses the legs, and the free pack has none. A
strafing runner turns his hips part of the way toward the move (PoE2) and runs
the legs on a diagonal off the pelvis. This takes the forward walk and jog and
turns each foot's track about its own neutral point by STRAFE_ANGLE, then solves
thigh and calf by two-bone IK onto it. The two tracks stay parallel, a hip width
apart, so the feet never cross; stride and cadence stay the source's.

The rig turns the hips the remaining 90 - STRAFE_ANGLE toward the move and the
chest back onto the target (`STRAFE_ANGLE` in apps/web/src/render/rig.ts).
Re-running replaces the clips it added last time, so this is idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_strafe_clips.py
"""

import json
import math
import os
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cast_mirror import compact  # noqa: E402
from build_slash_variant import read_glb, write_glb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "apps/web/public/models/anim-library.glb")
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-strafe-clips.glb")

# Keep in step with STRAFE_ANGLE and CLIP_NAME in apps/web/src/render/rig.ts.
STRAFE_ANGLE = math.radians(55)
# Share of the track's turn the knee and foot follow; the rest is the hip's.
KNEE_FOLLOW = 0.4
# Each foot set out this far (rig units, 0.0003 = 3 cm) from the midline: the
# source's narrow jog brings the diagonal tracks within 5 cm, boot on boot.
WIDEN = 0.0003
# new clip -> (source clip, +1 toward the body's left, -1 toward its right)
CLIPS = {
    "Rig|Walk_Strafe_L_Loop": ("Rig|Walk_Loop", 1),
    "Rig|Walk_Strafe_R_Loop": ("Rig|Walk_Loop", -1),
    "Rig|Jog_Strafe_L_Loop": ("Rig|Jog_Fwd_Loop", 1),
    "Rig|Jog_Strafe_R_Loop": ("Rig|Jog_Fwd_Loop", -1),
}
# The pack is authored at 30 fps: importing at 30 lands every key on a frame.
FPS = 30
LEGS = (("thigh_l", "calf_l", "foot_l"), ("thigh_r", "calf_r", "foot_r"))


def horizontal(v, up):
    return v - up * v.dot(up)


def about(point, rot):
    """4x4 turning by 3x3 `rot` about `point`."""
    return Matrix.Translation(point) @ rot.to_4x4() @ Matrix.Translation(-point)


def solve_leg(arm, leg, target, turn, up):
    """Put the ankle on `target`, knee and foot yawed by `turn` * KNEE_FOLLOW."""
    thigh, calf, foot = (arm.pose.bones[n] for n in leg)
    hip, knee, ankle = thigh.head.copy(), calf.head.copy(), foot.head.copy()
    upper, lower = (knee - hip).length, (ankle - knee).length
    foot_before = foot.matrix.copy()

    reach = target - hip
    span = min(reach.length, (upper + lower) * 0.999)
    aim = reach.normalized()
    straight = (ankle - hip).normalized()
    bend = (knee - hip) - straight * (knee - hip).dot(straight)
    bend = Matrix.Rotation(turn * KNEE_FOLLOW, 3, up) @ bend
    bend = (bend - aim * bend.dot(aim)).normalized()
    along = (upper * upper - lower * lower + span * span) / (2 * span)
    new_knee = hip + aim * along + bend * math.sqrt(max(0.0, upper * upper - along * along))
    reached = hip + aim * span

    def frame(a, b):
        x = a.normalized()
        y = a.cross(b).normalized()
        return Matrix((x, y, x.cross(y))).transposed()

    turn_thigh = frame(new_knee - hip, reached - hip) @ frame(knee - hip, ankle - hip).transposed()
    thigh.matrix = about(hip, turn_thigh) @ thigh.matrix
    bpy.context.view_layer.update()
    turn_calf = (foot.head - calf.head).rotation_difference(reached - calf.head).to_matrix()
    calf.matrix = about(calf.head.copy(), turn_calf) @ calf.matrix
    bpy.context.view_layer.update()
    yaw = Matrix.Rotation(turn * KNEE_FOLLOW, 3, up)
    foot.matrix = Matrix.Translation(foot.head.copy()) @ yaw.to_4x4() @ Matrix.Translation(-ankle) @ foot_before
    bpy.context.view_layer.update()
    return reached


def sample(arm, action, start, end):
    """Local pose per frame, plus each leg's hip and ankle in armature space."""
    anim = arm.animation_data
    anim.action = action
    anim.action_slot = action.slots[0]
    frames = []
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        pose = {b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in arm.pose.bones}
        legs = [(arm.pose.bones[t].head.copy(), arm.pose.bones[f].head.copy()) for t, _c, f in LEGS]
        frames.append((pose, legs))
    anim.action = None
    return frames


def apply(arm, pose):
    for name, (loc, rot) in pose.items():
        bone = arm.pose.bones[name]
        bone.location, bone.rotation_quaternion = loc, rot
    bpy.context.view_layer.update()


def build(arm, name, source, side, up, forward):
    start, end = (int(round(v)) for v in source.frame_range)
    frames = sample(arm, source, start, end)
    # The source loop's last frame repeats its first; keep it so the loop closes.
    turn = side * STRAFE_ANGLE
    spin = Matrix.Rotation(turn, 3, up)
    assert (spin @ forward).dot(Vector((1, 0, 0))) * side > 0, "turn sign runs the wrong way"
    # Each foot's track turns about its own mean ankle offset, then steps out.
    neutral, widen = [], []
    for i in range(len(LEGS)):
        offsets = [horizontal(legs[i][1] - legs[i][0], up) for _pose, legs in frames]
        neutral.append(sum(offsets, Vector()) / len(offsets))
        widen.append(Vector((WIDEN if frames[0][1][i][0].x > 0 else -WIDEN, 0, 0)))

    posed, gaps = [], []
    for pose, legs in frames:
        apply(arm, pose)
        ankles = []
        for i, leg in enumerate(LEGS):
            hip, ankle = legs[i]
            offset = ankle - hip
            flat = horizontal(offset, up)
            moved = neutral[i] + spin @ (flat - neutral[i]) + widen[i]
            target = arm.pose.bones[leg[0]].head + moved + up * offset.dot(up)
            ankles.append(solve_leg(arm, leg, target, turn, up))
        gaps.append(horizontal(ankles[0] - ankles[1], up))
        posed.append({b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in arm.pose.bones})

    stale = bpy.data.actions.get(name)
    if stale is not None:
        bpy.data.actions.remove(stale)
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for index, pose in enumerate(posed):
        frame = start + index
        for bone_name, (loc, rot) in pose.items():
            bone = arm.pose.bones[bone_name]
            bone.location, bone.rotation_quaternion = loc, rot
            bone.keyframe_insert("location", frame=frame)
            bone.keyframe_insert("rotation_quaternion", frame=frame)
    arm.animation_data.action = None
    across = Vector((1, 0, 0)) - forward * forward.dot(Vector((1, 0, 0)))
    side_gap = min(abs(g.dot(spin @ across.normalized())) for g in gaps)
    # Rig units are hundredths of a world metre (the armature is scaled 100).
    print(f"{name}: {len(posed)} frames, narrowest track gap {side_gap * 1e4:.1f} cm")
    return action


def build_all():
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.animation_data_create()
    for b in arm.pose.bones:
        b.rotation_mode = "QUATERNION"
    apply(arm, {})
    # Armature space: up from the world's +Z, forward along the rest foot.
    up = (arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1))).normalized()
    rest = arm.data.bones
    forward = horizontal(rest["foot_end_l"].head_local - rest["foot_l"].head_local, up).normalized()
    made = [build(arm, name, bpy.data.actions[src], side, up, forward) for name, (src, side) in CLIPS.items()]
    for action in list(bpy.data.actions):
        if action not in made:
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
    clips = [a for a in add.get("animations", []) if a.get("name") in CLIPS]
    assert sorted(a["name"] for a in clips) == sorted(CLIPS), [a.get("name") for a in add.get("animations", [])]

    by_name = {n["name"]: i for i, n in enumerate(doc["nodes"]) if "name" in n}
    from_add = {i: n.get("name") for i, n in enumerate(add["nodes"])}
    doc["animations"] = [a for a in doc.get("animations", []) if a.get("name") not in CLIPS]
    blob += b"\0" * (-len(blob) % 4)

    for clip in clips:
        # Blender keys every bone, root and scale included; a channel the source
        # never keys overrides that node's rest (an identity root tips him over).
        source = next(a for a in doc["animations"] if a.get("name") == CLIPS[clip["name"]][0])
        keyed = {(doc["nodes"][c["target"]["node"]]["name"], c["target"]["path"]) for c in source["channels"]}
        clip = dict(clip, channels=[
            c for c in clip["channels"]
            if (from_add.get(c["target"].get("node")), c["target"]["path"]) in keyed
        ])
        remap = {}
        used = sorted({c["sampler"] for c in clip["channels"]})
        clip["samplers"] = [clip["samplers"][i] for i in used]
        clip["channels"] = [dict(c, sampler=used.index(c["sampler"])) for c in clip["channels"]]
        for index in sorted({s[k] for s in clip["samplers"] for k in ("input", "output")}):
            accessor = dict(add["accessors"][index])
            view = dict(add["bufferViews"][accessor["bufferView"]])
            start = view.get("byteOffset", 0)
            chunk = extra[start:start + view["byteLength"]]
            view["byteOffset"], view["buffer"] = len(blob), 0
            blob += chunk + b"\0" * (-len(chunk) % 4)
            accessor["bufferView"] = len(doc["bufferViews"])
            doc["bufferViews"].append(view)
            remap[index] = len(doc["accessors"])
            doc["accessors"].append(accessor)
        clip = json.loads(json.dumps(clip))
        for sampler in clip["samplers"]:
            sampler["input"], sampler["output"] = remap[sampler["input"]], remap[sampler["output"]]
        kept = []
        for channel in clip["channels"]:
            node = from_add.get(channel["target"].get("node"))
            if node in by_name:
                channel["target"]["node"] = by_name[node]
                kept.append(channel)
        assert kept, f"{clip['name']}: no channel matched a library node by name"
        clip["channels"] = kept
        doc["animations"].append(clip)
    write_glb(ANIMS, doc, compact(doc, blob))
    os.remove(SCRATCH)


def main():
    build_all()
    splice()
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
