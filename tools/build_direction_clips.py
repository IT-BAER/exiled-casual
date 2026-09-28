"""Add directional locomotion to `anim-library.glb`: the walk and jog run off the hips.

The free pack has forward locomotion only. A run-and-gun body faces the cursor
while the keys carry it any way, so the legs need a clip per direction. Every
one here is the forward walk or jog with each foot's track turned about its own
mean offset from the hip, thigh and calf re-solved by two-bone IK onto it. The
source's timing is kept, never reversed, so every clip of a gait shares one
stride phase and the runtime can blend any two neighbours frame for frame.

Directions are yaw off the hips (`DIRECTIONS`); the rig turns the hips the rest
of the way toward the move. Past a sidestep the clip turns into a backpedal by
its share of backwardness b = max(0, -cos(yaw)):
  - landing and push-off on the ball of the foot, never the heel;
  - the source's forward trunk lean taken out, a little back lean put in;
  - shorter steps (`STRIDE_CUT`), hips lower, so the knees bend more;
  - at a full backpedal the chest and arms run half a cycle on, so the
    shoulders still turn and swing against the legs.

Keep DIRECTIONS and STRIDE_CUT in step with `DIRECTIONS` in apps/web/src/render/rig.ts.
Re-running replaces the clips it added last time, so this is idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_direction_clips.py
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
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-direction-clips.glb")

# name part -> yaw of the travel off the hips, degrees, positive toward the body's LEFT.
DIRECTIONS = {
    "Strafe_L": 55,
    "Strafe_R": -55,
    "BackDiag_L": 110,
    "BackDiag_R": -110,
    "Back": 180,
}
GAITS = {"Walk": "Rig|Walk_Loop", "Jog": "Rig|Jog_Fwd_Loop"}
# Clips this tool's predecessors wrote and nothing reads any more.
RETIRED = ()
# Share of the track's line the knee and foot follow; the rest is the hip's.
KNEE_FOLLOW = 0.4
# Each foot set out this far (rig units, 0.0003 = 3 cm) from the midline at a
# sidestep, up to three times that on a back diagonal: the source's narrow jog
# brings the diagonal tracks within 2-5 cm, boot on boot.
WIDEN = 0.0003
# At a full backpedal: steps this much shorter, hips this much lower (rig
# units), trunk leaning back this far past upright, foot pitched toe-down.
STRIDE_CUT = 0.25
HIPS_DROP = 0.0004
BACK_LEAN = math.radians(4)
# Share of the jog's 22 cm hip bounce a full backpedal loses: it shuffles, it does not bound.
BOUNCE_CUT = 0.4
# A backpedal's swing: a low arc front to back (ankle lift, rig units), the
# foot pointed a little toe-down through it and onto the ball at each end of
# the stance. A forward jog's swing kicks the heel 50 cm up behind him; turned
# round, that is a knee raised in front, which reads as sitting.
SWING_ARC = 0.0012
SWING_PITCH = math.radians(8)
BALL_PITCH = math.radians(12)
# An ankle within this of its lowest (rig units) is on the ground.
STANCE_BAND = 0.0003
# The pack is authored at 30 fps: importing at 30 lands every key on a frame.
FPS = 30
LEGS = (("thigh_l", "calf_l", "foot_l", "foot_end_l"), ("thigh_r", "calf_r", "foot_r", "foot_end_r"))
# The body above the waist: its twist and arm swing run against the legs.
UPPER_PARTS = ("spine_03", "neck_01", "Head", "clavicle", "upperarm", "lowerarm", "hand", "index", "middle", "pinky", "ring", "thumb")


def clip_name(gait, direction):
    return f"Rig|{gait}_{direction}_Loop"


def horizontal(v, up):
    return v - up * v.dot(up)


def about(point, rot):
    """4x4 turning by 3x3 `rot` about `point`."""
    return Matrix.Translation(point) @ rot.to_4x4() @ Matrix.Translation(-point)


def turn_onto(a, b):
    """3x3 turning direction `a` onto direction `b` by the shortest arc."""
    return a.rotation_difference(b).to_matrix()


def solve_leg(arm, leg, target, foot_rot):
    """Ankle onto `target`, knee in the plane `foot_rot` swings the old knee into, foot turned by `foot_rot`."""
    thigh, calf, foot = (arm.pose.bones[n] for n in leg[:3])
    hip, knee, ankle = thigh.head.copy(), calf.head.copy(), foot.head.copy()
    upper, lower = (knee - hip).length, (ankle - knee).length
    foot_before = foot.matrix.copy()

    reach = target - hip
    span = min(reach.length, (upper + lower) * 0.999)
    aim = reach.normalized()
    straight = (ankle - hip).normalized()
    bend = foot_rot @ ((knee - hip) - straight * (knee - hip).dot(straight))
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
    calf.matrix = about(calf.head.copy(), turn_onto(foot.head - calf.head, reached - calf.head)) @ calf.matrix
    bpy.context.view_layer.update()
    foot.matrix = Matrix.Translation(foot.head.copy()) @ foot_rot.to_4x4() @ Matrix.Translation(-ankle) @ foot_before
    bpy.context.view_layer.update()
    return reached


def sample(arm, action, start, end):
    """Local pose per frame, plus each leg's hip, ankle and toe in armature space."""
    # The source does not key every bone (spine_01, spine_02): start each at rest,
    # or the last clip's pose leaks into this one.
    for bone in arm.pose.bones:
        bone.location, bone.rotation_quaternion = Vector(), (1, 0, 0, 0)
    anim = arm.animation_data
    anim.action = action
    anim.action_slot = action.slots[0]
    frames = []
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        bones = arm.pose.bones
        pose = {b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in bones}
        legs = [(bones[t].head.copy(), bones[f].head.copy(), bones[e].head.copy()) for t, _c, f, e in LEGS]
        trunk = bones["Head"].head - bones["spine_01"].head
        frames.append((pose, legs, trunk))
    anim.action = None
    return frames


def apply(arm, pose):
    for name, (loc, rot) in pose.items():
        bone = arm.pose.bones[name]
        bone.location, bone.rotation_quaternion = loc, rot
    bpy.context.view_layer.update()


def pitch_of(toe, up):
    """Toe's angle above the floor plane, radians."""
    return math.atan2(toe.dot(up), horizontal(toe, up).length)


def smooth(u):
    return u * u * (3.0 - 2.0 * u)


def phases(heights):
    """Per frame of a cycle: (on the ground, share of the way through its stance or swing)."""
    n = len(heights)
    low = min(heights)
    ground = [h < low + STANCE_BAND for h in heights]
    out = []
    for t in range(n):
        back = next(k for k in range(1, n + 1) if ground[(t - k) % n] != ground[t])
        ahead = next(k for k in range(1, n + 1) if ground[(t + k) % n] != ground[t])
        out.append((ground[t], back / (back + ahead)))
    return out


def track(frames, i, cycle, spin, stride, neutral, widen, back, up, rest_pitch):
    """Ankle target (offset from the mid-hip, height) and foot pitch change per frame of leg i."""
    base = []
    for _pose, legs, _t in frames[:cycle]:
        hip_mid = (legs[0][0] + legs[1][0]) / 2
        flat = horizontal(legs[i][1] - hip_mid, up)
        # A forward runner's foot lands toward the midline; turned, that sway
        # becomes travel and pinches the tracks, so each track is a straight line.
        flat.x = neutral.x
        base.append(neutral + spin @ (flat - neutral) * stride + widen)
    heights = [legs[i][1].dot(up) for _p, legs, _t in frames[:cycle]]
    source_pitch = [pitch_of(legs[i][2] - legs[i][1], up) - rest_pitch for _p, legs, _t in frames[:cycle]]
    out = []
    for t, (ground, share) in enumerate(phases(heights)):
        where, height, pitch = base[t], heights[t], source_pitch[t]
        if ground:
            want = -BALL_PITCH * (1 - math.sin(math.pi * share))
        else:
            # Lift-off and touchdown are the stance frames either side.
            a = next(k for k in range(1, cycle) if heights[(t - k) % cycle] < min(heights) + STANCE_BAND)
            c = next(k for k in range(1, cycle) if heights[(t + k) % cycle] < min(heights) + STANCE_BAND)
            u = a / (a + c)
            glide = base[(t - a) % cycle].lerp(base[(t + c) % cycle], smooth(u))
            arc = heights[(t - a) % cycle] + (heights[(t + c) % cycle] - heights[(t - a) % cycle]) * u
            arc += SWING_ARC * math.sin(math.pi * u)
            where = where.lerp(glide, back)
            height += (arc - height) * back
            want = -SWING_PITCH
        out.append((where, height, (want - pitch) * back))
    return out + out[:1]


def build(arm, name, source, degrees, up, forward, rest_pitch):
    start, end = (int(round(v)) for v in source.frame_range)
    frames = sample(arm, source, start, end)
    cycle = len(frames) - 1  # the last frame repeats the first, so the loop closes
    yaw = math.radians(degrees)
    spin = Matrix.Rotation(yaw, 3, up)
    assert degrees == 180 or (spin @ forward).dot(Vector((1, 0, 0))) * degrees > 0, "yaw sign runs the wrong way"
    # The line the feet travel along, as the smaller turn off forward: a backpedal
    # runs the same line as a forward run, so its knees still point ahead.
    line = yaw if abs(yaw) <= math.pi / 2 else yaw - math.copysign(math.pi, yaw)
    knee_rot = Matrix.Rotation(line * KNEE_FOLLOW, 3, up)
    back = max(0.0, -math.cos(yaw))
    stride = 1.0 - STRIDE_CUT * back
    lateral = Vector((1, 0, 0))
    floor = min(legs[i][2].dot(up) for _p, legs, _t in frames for i in range(len(LEGS)))
    lean = sum(math.atan2(t.dot(forward), t.dot(up)) for _p, _l, t in frames) / len(frames)
    hips = [(legs[0][0] + legs[1][0]).dot(up) / 2 for _p, legs, _t in frames]
    mean_hips = sum(hips) / len(hips)

    # Each foot's track turns about its own mean offset from the mid-hip, then
    # steps out. Not from its own hip: the hips swing fore and aft with the
    # pelvis, and turned, that swing pinches one side's tracks together.
    neutral, widen = [], []
    for i in range(len(LEGS)):
        offsets = [horizontal(legs[i][1] - (legs[0][0] + legs[1][0]) / 2, up) for _p, legs, _t in frames]
        neutral.append(sum(offsets, Vector()) / len(offsets))
    # The source rests one foot a little ahead of the other; turned past a
    # sidestep, that lead becomes sideways and pinches one side's tracks.
    ahead = up.cross(lateral).normalized()
    lead = (neutral[0].dot(ahead) - neutral[1].dot(ahead)) / 2
    neutral[0] -= ahead * lead
    neutral[1] += ahead * lead
    # A backpedal turns about the hips, not the mean: the forward swing's long
    # kick behind drags the mean back, and turned round it would leave the feet
    # behind him the whole cycle.
    for n in neutral:
        n -= ahead * n.dot(ahead) * back
    for i in range(len(LEGS)):
        widen.append(lateral * (WIDEN if frames[0][1][i][0].x > 0 else -WIDEN) * math.sin(abs(yaw)) * (1 + 2 * back))
    tracks = [track(frames, i, cycle, spin, stride, neutral[i], widen[i], back, up, rest_pitch) for i in range(len(LEGS))]

    posed, gaps = [], []
    for index, (pose, legs, _trunk) in enumerate(frames):
        pose = dict(pose)
        if back > 0.5:
            shifted = frames[(index + cycle // 2) % cycle][0]
            for bone_name in pose:
                if bone_name.startswith(UPPER_PARTS):
                    pose[bone_name] = shifted[bone_name]
        apply(arm, pose)
        bones = arm.pose.bones
        if back > 0:
            # On the pelvis, the one trunk bone every clip keys: the legs are
            # solved after, so only the body above them leans.
            pelvis = bones["pelvis"]
            tilt = Matrix.Rotation((lean + BACK_LEAN) * back, 3, forward.cross(up).normalized())
            drop = HIPS_DROP * back + (hips[index] - mean_hips) * BOUNCE_CUT * back
            pelvis.matrix = Matrix.Translation(-up * drop) @ about(pelvis.head.copy(), tilt) @ pelvis.matrix
            bpy.context.view_layer.update()
            if index == 0:
                trunk = bones["Head"].head - bones["spine_01"].head
                print(f"  lean {math.degrees(lean):.1f} -> {math.degrees(math.atan2(trunk.dot(forward), trunk.dot(up))):.1f} deg")
        ankles = []
        for i, leg in enumerate(LEGS):
            _hip, ankle, toe = legs[i]
            moved, height, pitch = tracks[i][index]
            foot_rot = knee_rot.copy()
            if abs(pitch) > 1e-6:
                reach = foot_rot @ (toe - ankle)
                side = horizontal(reach, up).cross(up).normalized()
                tip = Matrix.Rotation(pitch, 3, side)
                if (pitch_of(tip @ reach, up) < pitch_of(reach, up)) != (pitch < 0):
                    tip = Matrix.Rotation(-pitch, 3, side)
                foot_rot = tip @ foot_rot
                # On the ball, the heel lifts: never the toe through the floor.
                height += max(0.0, floor - (height + (foot_rot @ (toe - ankle)).dot(up)))
            mid = (bones[LEGS[0][0]].head + bones[LEGS[1][0]].head) / 2
            target = horizontal(mid, up) + moved + up * height
            ankles.append(solve_leg(arm, leg, target, foot_rot))
        gaps.append(horizontal(ankles[0] - ankles[1], up))
        posed.append({b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in bones})

    stale = bpy.data.actions.get(name)
    if stale is not None:
        bpy.data.actions.remove(stale)
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for index, pose in enumerate(posed):
        for bone_name, (loc, rot) in pose.items():
            bone = arm.pose.bones[bone_name]
            bone.location, bone.rotation_quaternion = loc, rot
            bone.keyframe_insert("location", frame=start + index)
            bone.keyframe_insert("rotation_quaternion", frame=start + index)
    arm.animation_data.action = None
    across = (spin @ lateral).normalized()
    # Rig units are hundredths of a world metre (the armature is scaled 100).
    print(f"{name}: {len(posed)} frames, narrowest track gap {min(abs(g.dot(across)) for g in gaps) * 1e4:.1f} cm")
    return action


def build_all():
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.animation_data_create()
    for b in arm.pose.bones:
        b.rotation_mode = "QUATERNION"
    up = (arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1))).normalized()
    rest = arm.data.bones
    forward = horizontal(rest["foot_end_l"].head_local - rest["foot_l"].head_local, up).normalized()
    rest_pitch = pitch_of(rest["foot_end_l"].head_local - rest["foot_l"].head_local, up)
    made = [
        build(arm, clip_name(gait, direction), bpy.data.actions[source], degrees, up, forward, rest_pitch)
        for gait, source in GAITS.items()
        for direction, degrees in DIRECTIONS.items()
    ]
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
    names = {clip_name(g, d): source for g, source in GAITS.items() for d in DIRECTIONS}
    doc, blob = read_glb(ANIMS)
    add, extra = read_glb(SCRATCH)
    clips = [a for a in add.get("animations", []) if a.get("name") in names]
    assert sorted(a["name"] for a in clips) == sorted(names), [a.get("name") for a in add.get("animations", [])]

    by_name = {n["name"]: i for i, n in enumerate(doc["nodes"]) if "name" in n}
    from_add = {i: n.get("name") for i, n in enumerate(add["nodes"])}
    doc["animations"] = [a for a in doc.get("animations", []) if a.get("name") not in set(names) | set(RETIRED)]
    blob += b"\0" * (-len(blob) % 4)

    for clip in clips:
        # Blender keys every bone, root and scale included; a channel the source
        # never keys overrides that node's rest (an identity root tips him over).
        source = next(a for a in doc["animations"] if a.get("name") == names[clip["name"]])
        keyed = {(doc["nodes"][c["target"]["node"]]["name"], c["target"]["path"]) for c in source["channels"]}
        channels = [c for c in clip["channels"] if (from_add.get(c["target"].get("node")), c["target"]["path"]) in keyed]
        used = sorted({c["sampler"] for c in channels})
        samplers = [clip["samplers"][i] for i in used]
        remap = {}
        for index in sorted({s[k] for s in samplers for k in ("input", "output")}):
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
        out = {"name": clip["name"], "channels": [], "samplers": []}
        for sampler in samplers:
            out["samplers"].append(dict(sampler, input=remap[sampler["input"]], output=remap[sampler["output"]]))
        for channel in channels:
            node = by_name[from_add[channel["target"]["node"]]]
            out["channels"].append({"sampler": used.index(channel["sampler"]), "target": dict(channel["target"], node=node)})
        assert out["channels"], f"{clip['name']}: no channel matched a library node by name"
        doc["animations"].append(out)
    write_glb(ANIMS, doc, compact(doc, blob))
    os.remove(SCRATCH)


def main():
    build_all()
    splice()
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
