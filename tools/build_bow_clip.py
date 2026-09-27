"""Add a bow draw-and-release clip to `anim-library.glb` as `Rig|Bow_Shoot`, and
the bow arm's carry pose between shots as `Rig|Bow_Carry`.

The pack has no bow take, so this one is keyed by hand. It is authored on the
WARDROBE's male skeleton, not the library's: the bow is skinned to `hand_l`
there, and the runtime plays a clip by writing its node-local rotations onto the
wardrobe's own nodes, so authoring on those nodes is authoring what plays. The
arms are placed by two-bone IK against targets in metres around the real body,
then baked to plain rotation keys.

Real-archer handedness, as the mesh is bound: bow in the LEFT hand held out
along the arrow line, the right hand draws the string to the jaw. The torso
turns the bow shoulder toward the target and the neck turns the head back.

Only ROTATIONS of `KEYED` are spliced. Translations would carry this skeleton's
metre rest lengths into a centimetre library, and the exporter samples every
bone, so an unkeyed finger would otherwise be pinned to the T-pose. The draw
hand and its fingers ARE keyed: the bow leaves that hand empty, and `rig.ts`
lets this one layered clip write the weapon-hand bones.

Same splice as `tools/build_cast_mirror.py`: the library is a vendored FBX2glTF
conversion and re-exporting it would rewrite every clip. Idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_bow_clip.py
"""

import json
import math
import os
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cast_mirror import read_glb, write_glb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "apps/web/public/models/anim-library.glb")
WARDROBE = os.path.join(ROOT, "apps/web/public/models/wardrobe.glb")
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-bow-clip.glb")

CLIP = "Rig|Bow_Shoot"
SKELETON = "Armature"
BOW = "weapon1.stalkerbow.mesh"
FPS = 30
KEYED = (
    "spine_01", "spine_02", "spine_03", "neck_01", "Head",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
    "upperarm_r", "lowerarm_r", "hand_r",
)
# Degrees of curl per joint (01, 02, 03) at full hook. Three fingers take the
# string in their last joints; the pinky and thumb fold out of its way.
HOOK = {
    "index": (15.0, 75.0, 45.0), "middle": (15.0, 75.0, 45.0), "ring": (15.0, 75.0, 45.0),
    "pinky": (55.0, 90.0, 70.0), "thumb": (0.0, 30.0, 30.0),
}
DRAW_FINGERS = tuple(f"{f}_{i:02d}_r" for f in HOOK for i in (1, 2, 3))
KEYED += DRAW_FINGERS
# Between shots: the bow hand alone, laid over idle, walk and run by `rig.ts`.
CARRY = "Rig|Bow_Carry"
CARRY_KEYED = ("hand_l",)
# How far the relaxed bow fist tips toward the thumb (radial deviation, ~25 deg is a wrist's range).
CARRY_DEVIATION = math.radians(20.0)

# The beat, in frames at 30 fps. The runtime stretches the whole clip over the
# skill's repeat interval, so RELEASE is a fraction of it: 40% sits between Snap
# Shot's wind-up (7 of 15 ticks) and Piercing Shot's (9 of 30).
LAST = 30
RELEASE = 12

# Torso yaw, radians about world up. Negative brings the bow shoulder forward.
TWIST_AIM = math.radians(-80.0)
TWIST_EASY = math.radians(-25.0)
# Bow tilt off vertical about the arrow line, top toward the bow-arm side.
CANT = math.radians(10.0)
# The IK target is the WRIST; the string sits in the finger joints ahead of it,
# so the wrist is held this far back for the fingers to anchor at the jaw.
WRIST_BACK = 0.02
# The draw elbow's height at full draw, off the shoulder: level with the draw wrist,
# so the forearm runs back along the arrow as an archer holds it.
DRAW_ELBOW_RISE = 0.0
# Blender's IK bends either arm's elbow toward its pole at -90 degrees, not 0.
DRAW_POLE_ANGLE = math.radians(-90.0)


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def track(keys, frame):
    """Piecewise smoothstep through (frame, value) keys; values are Vectors or floats."""
    if frame <= keys[0][0]:
        return keys[0][1]
    for (f0, v0), (f1, v1) in zip(keys, keys[1:]):
        if frame <= f1:
            t = smooth((frame - f0) / (f1 - f0))
            return v0 + (v1 - v0) * t
    return keys[-1][1]


def principal_axes(points):
    """Unit axes of a point cloud, longest first (power iteration on the covariance)."""
    centre = sum(points, Vector()) / len(points)
    cov = Matrix.Diagonal((0.0, 0.0, 0.0))
    for p in points:
        d = p - centre
        for i in range(3):
            for j in range(3):
                cov[i][j] += d[i] * d[j]
    axes = []
    for _ in range(2):
        v = Vector((0.577, 0.577, 0.577))
        for _ in range(64):
            for a in axes:
                v -= a * v.dot(a)
            v = (cov @ v).normalized()
        axes.append(v)
    return centre, axes[0], axes[1]


def bow_frame(bow):
    """
    The bow's limb axis and arrow direction at rest, in world space.

    The arrow leaves from the string side through the grip, so it points from
    the limb tips' side of the bow (tips curve back to the string) toward the
    grip's side. Which limb is 'up' is left to `grip_rotation`.
    """
    points = [bow.matrix_world @ v.co for v in bow.data.vertices]
    centre, limb, depth = principal_axes(points)
    along = [(p - centre).dot(limb) for p in points]
    reach = max(abs(a) for a in along)
    tips = [p for p, a in zip(points, along) if abs(a) > 0.9 * reach]
    grip = [p for p, a in zip(points, along) if abs(a) < 0.1 * reach]
    tip_side = sum((p - centre).dot(depth) for p in tips) / len(tips)
    grip_side = sum((p - centre).dot(depth) for p in grip) / len(grip)
    arrow = depth if grip_side > tip_side else -depth
    return centre, limb, arrow


def basis(up, fwd):
    fwd = (fwd - up * fwd.dot(up)).normalized()
    return Matrix((up.cross(fwd), up, fwd)).transposed()


def grip_rotation(hand_rest, limb, arrow, up, fwd, fist):
    """
    World rotation of `hand_l` that stands the bow's upper limb along `up` with
    the arrow side of the grip toward `fwd`.

    The limb on the fist's index side points up, so the index knuckle is on top
    and the thumb wraps over the grip, as an archer holds it.
    """
    sign = 1.0 if limb.dot(fist) > 0 else -1.0
    return basis(up, fwd) @ basis(limb * sign, arrow).inverted() @ hand_rest


def unroll(forearm, grip, wrist_rest):
    """
    Roll of `lowerarm_l` about its own axis that leaves the hand no twist off
    its rest relation to the forearm: the forearm turns, the wrist does not.
    """
    q = (forearm.inverted() @ grip @ wrist_rest.inverted()).to_quaternion()
    return 2.0 * math.atan2(q.y, q.w) if q.w >= 0 else 2.0 * math.atan2(-q.y, -q.w)


def ik(arm, bone, target, pole, pole_angle=0.0):
    con = arm.pose.bones[bone].constraints.new("IK")
    con.target = target
    con.pole_target = pole
    con.pole_angle = pole_angle
    con.chain_count = 2
    return con


def draw_pole(arm, shoulder, wrist, out):
    """
    A pole that puts the draw elbow level with the shoulder at full draw.

    The elbow can only lie on one circle, an upper arm from the shoulder and a
    forearm from the wrist; of its two level points the one further `out` from
    the body is aimed at from twice as far off the circle's centre (the other
    folds the elbow across the chest, behind the neck). None for an arm near straight:
    the circle shrinks to a point and any pole there only spins the elbow.
    """
    bones = arm.data.bones
    upper = (bones["lowerarm_r"].head_local - bones["upperarm_r"].head_local).length
    fore = (bones["hand_r"].head_local - bones["lowerarm_r"].head_local).length
    span = (wrist - shoulder).length
    n = (wrist - shoulder) / span
    d = (upper * upper - fore * fore + span * span) / (2.0 * span)
    r = math.sqrt(max(upper * upper - d * d, 0.0))
    if r < 0.05:
        return None
    centre = shoulder + n * d
    u = (Vector((0.0, 0.0, 1.0)) - n * n.z).normalized()
    v = n.cross(u)
    cos = max(-1.0, min(1.0, (shoulder.z + DRAW_ELBOW_RISE - centre.z) / (r * u.z)))
    sin = math.sqrt(1.0 - cos * cos)
    elbow = max((centre + (u * cos + v * s * sin) * r for s in (1.0, -1.0)), key=lambda e: e.dot(out))
    return elbow * 2.0 - centre


def empty(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rotate_about(bone, angle):
    """Yaw a pose bone about armature up through its head, children following."""
    head = bone.head.copy()
    spin = Matrix.Translation(head) @ Matrix.Rotation(angle, 4, "Z") @ Matrix.Translation(-head)
    bone.matrix = spin @ bone.matrix
    bpy.context.view_layer.update()


def turn(bone, axis, angle, world):
    """Rotate a pose bone about a world axis through its head, children following."""
    head = world @ bone.head
    spin = Matrix.Translation(head) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-head)
    bone.matrix = world.inverted() @ spin @ world @ bone.matrix
    bpy.context.view_layer.update()


def knuckles(head_of, side):
    """The fist's long axis, pinky to index, from the three joints down each finger."""
    return sum((head_of(f"index_{i:02d}_{side}") - head_of(f"pinky_{i:02d}_{side}") for i in (1, 2, 3)),
               Vector()).normalized()


def draw_grip(pb, world, head_of, hand_r_rest, frame_rest, fwd, weight, curl):
    """
    Stand the draw hand up on the arrow line and hook its fingers.

    Fingers point down the arrow with the index on top, so the palm faces the jaw
    and the back of the hand faces out; `weight` blends from wherever the forearm
    left the hand, `curl` scales the hook.
    """
    goal = basis(Vector((0.0, 0.0, 1.0)), fwd) @ frame_rest.inverted() @ hand_r_rest
    now = (world @ pb["hand_r"].matrix).to_3x3().normalized()
    rot = now.to_quaternion().slerp(goal.to_quaternion(), weight).to_matrix().to_4x4()
    wrist = head_of("hand_r")
    pb["hand_r"].matrix = world.inverted() @ Matrix.Translation(wrist) @ rot
    bpy.context.view_layer.update()
    along = (head_of("middle_01_r") - wrist).normalized()
    palm = along.cross(knuckles(head_of, "r")).normalized()
    if palm.dot(head_of("thumb_03_r") - wrist) < 0:
        palm = -palm
    hinge = along.cross(palm).normalized()
    for finger, angles in HOOK.items():
        for i, angle in enumerate(angles, start=1):
            turn(pb[f"{finger}_{i:02d}_r"], hinge, math.radians(angle) * curl, world)


def key_carry(arm, hand_rest, limb):
    """
    Key `CARRY`: the bow hand between shots, and nothing else of the arm.

    The arm hangs and swings with idle, walk and run like the other one; the
    relaxed fist only tips `CARRY_DEVIATION` toward the thumb, so the bow hangs
    in it with its upper limb forward and up. Two identical frames of `hand_l`
    against its forearm; the runtime reads the pose, not a motion.
    """
    world, pb = arm.matrix_world, arm.pose.bones
    head_of = lambda n: world @ pb[n].head
    arm.animation_data.action = None
    for bone in pb:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    fingers = (head_of("middle_01_l") - head_of("hand_l")).normalized()
    fist = knuckles(head_of, "l")
    stave = limb if limb.dot(fist) > 0 else -limb
    grip = Matrix.Rotation(CARRY_DEVIATION, 3, fingers.cross(stave).normalized()) @ hand_rest
    carried = world.inverted() @ (Matrix.Translation(head_of("hand_l")) @ grip.to_4x4())

    stale = bpy.data.actions.get(CARRY)
    if stale is not None:
        bpy.data.actions.remove(stale)
    arm.animation_data.action = bpy.data.actions.new(CARRY)
    for frame in (0, 1):
        bpy.context.scene.frame_set(frame)
        pb["hand_l"].matrix = carried
        bpy.context.view_layer.update()
        pb["hand_l"].keyframe_insert("rotation_quaternion", frame=frame)
    print(f"carry: fist tipped {math.degrees(CARRY_DEVIATION):.0f} deg toward the thumb, "
          f"stave {math.degrees((grip @ hand_rest.inverted() @ stave).angle(fingers)):.0f} deg off the bind fingers")


def build():
    bpy.ops.import_scene.gltf(filepath=WARDROBE)
    scene = bpy.context.scene
    scene.render.fps = FPS
    arm = bpy.data.objects[SKELETON]
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" and obj.animation_data:
            obj.animation_data.action = None
    for bone in arm.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    world = arm.matrix_world
    pb = arm.pose.bones
    head_of = lambda n: world @ pb[n].head
    bones = arm.data.bones
    arm_len = (bones["lowerarm_l"].head_local - bones["upperarm_l"].head_local).length + (
        bones["hand_l"].head_local - bones["lowerarm_l"].head_local
    ).length
    hand_rest = (world @ pb["hand_l"].matrix).to_3x3().normalized()
    forearm_rest = (world @ pb["lowerarm_l"].matrix).to_3x3().normalized()
    wrist_rest = forearm_rest.inverted() @ hand_rest
    _, limb, arrow = bow_frame(bpy.data.objects[BOW])
    hand_r_rest = (world @ pb["hand_r"].matrix).to_3x3().normalized()
    frame_rest = basis(knuckles(head_of, "r"), head_of("middle_01_r") - head_of("hand_r"))

    # Targets are laid out off the body at full aim twist, then held there.
    spine = ("spine_01", "spine_02", "spine_03")
    for name in spine:
        rotate_about(pb[name], TWIST_AIM / len(spine))
    shoulder_l, shoulder_r, face = head_of("upperarm_l"), head_of("upperarm_r"), head_of("Head")
    for name in KEYED:
        pb[name].matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    # The arrow line runs under the right eye, a hand above the shoulders.
    line_x = face.x - 0.06
    line_z = shoulder_l.z + 0.05
    dx, dz = line_x - shoulder_l.x, line_z - shoulder_l.z
    reach = math.sqrt(max((0.97 * arm_len) ** 2 - dx * dx - dz * dz, 0.0))
    aim = Vector((line_x, shoulder_l.y - reach, line_z))
    anchor = Vector((line_x - 0.03, face.y - 0.02 + WRIST_BACK, line_z))
    nock = aim + Vector((0.0, 0.14, 0.0))
    # The follow-through slides the hand straight back along the arrow line.
    loosed = anchor + (anchor - aim).normalized() * 0.08
    kick = aim + Vector((0.0, -0.03, -0.02))
    low = Vector((0.0, 0.10, -0.22))

    bow_hand = [(0, aim + low * 0.6), (5, aim), (RELEASE, aim), (RELEASE + 2, kick),
                (22, kick), (LAST, aim + low)]
    draw_hand = [(0, nock + low * 0.6), (5, nock), (RELEASE - 1, anchor), (RELEASE, anchor),
                 (RELEASE + 2, loosed), (22, loosed), (LAST, loosed + low * 1.4)]
    twist = [(0, TWIST_EASY), (5, TWIST_AIM), (22, TWIST_AIM), (LAST, TWIST_EASY)]
    # The draw hand stands up as it reaches the nock, hooks the string, opens at
    # the loose and relaxes back toward the carry's loose fist.
    stand = [(0, 0.0), (4, 1.0), (RELEASE + 2, 1.0), (LAST, 0.0)]
    hook = [(0, 0.5), (4, 1.0), (RELEASE, 1.0), (RELEASE + 2, 0.2), (22, 0.2), (LAST, 0.6)]

    target_l, target_r = empty("bow_target_l"), empty("bow_target_r")
    pole_l, pole_r = empty("bow_pole_l"), empty("bow_pole_r")
    # Bow elbow soft and straight under the arm line: the only turn of the upper arm
    # that holds the fist index-up without twisting the forearm (out-down needs 34-64 deg).
    pole_l.location = (shoulder_l + aim) / 2.0 + Vector((0.0, 0.0, -0.5))
    # Out past the draw shoulder, not back along the arrow: the anchor sits near the
    # midline, so the elbow circle's rear point is behind the neck.
    out = shoulder_r - shoulder_l
    out.z = 0.0
    out.normalize()
    anchor_pole = draw_pole(arm, shoulder_r, anchor, out)
    constraints = [ik(arm, "lowerarm_l", target_l, pole_l, DRAW_POLE_ANGLE), ik(arm, "lowerarm_r", target_r, pole_r, DRAW_POLE_ANGLE)]

    fist = knuckles(head_of, "l")
    frames, rolls = [], []
    for frame in range(LAST + 1):
        for name in KEYED:
            pb[name].matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        yaw = track(twist, frame)
        for name in spine:
            rotate_about(pb[name], yaw / len(spine))
        # Neck and head give the yaw back so the eyes stay on the arrow line.
        for name in ("neck_01", "Head"):
            rotate_about(pb[name], -yaw / 2.0)
        target_l.location = track(bow_hand, frame)
        target_r.location = track(draw_hand, frame)
        # Per frame: a pole solved for one hand position folds the forearm upright at another.
        pole_r.location = draw_pole(arm, shoulder_r, target_r.location, out) or anchor_pole
        bpy.context.view_layer.update()
        fwd = (target_l.location - target_r.location).normalized()
        draw_grip(pb, world, head_of, hand_r_rest, frame_rest, fwd, track(stand, frame), track(hook, frame))
        pose = {n: pb[n].matrix.copy() for n in KEYED}
        up = Matrix.Rotation(-CANT, 3, fwd) @ Vector((0.0, 0.0, 1.0))
        grip = grip_rotation(hand_rest, limb, arrow, up, fwd, fist)
        forearm = (world @ pose["lowerarm_l"]).to_3x3().normalized()
        roll = unroll(forearm, grip, wrist_rest)
        rolls.append(math.degrees(roll))
        pose["lowerarm_l"] = pose["lowerarm_l"] @ Matrix.Rotation(roll, 4, "Y")
        head = pose["hand_l"].to_translation()
        pose["hand_l"] = world.inverted() @ (Matrix.Translation(world @ head) @ grip.to_4x4())
        frames.append(pose)

    anchored = frames[RELEASE]
    shoulder_z = (world @ anchored["upperarm_r"]).to_translation().z
    elbow = (world @ anchored["lowerarm_r"]).to_translation()
    line = (anchor - aim).normalized()
    off = math.degrees((elbow - anchor).angle(line))
    print(f"anchor frame {RELEASE}: draw shoulder z {shoulder_z:.3f}, elbow z {elbow.z:.3f}, "
          f"forearm {off:.0f} deg off the arrow line, bow forearm rolled {rolls[RELEASE]:.0f} deg "
          f"(range {min(rolls):.0f}..{max(rolls):.0f})")

    for name, con in zip(("lowerarm_l", "lowerarm_r"), constraints):
        pb[name].constraints.remove(con)
    for obj in (target_l, target_r, pole_l, pole_r):
        bpy.data.objects.remove(obj)

    stale = bpy.data.actions.get(CLIP)
    if stale is not None:
        bpy.data.actions.remove(stale)
    action = bpy.data.actions.new(CLIP)
    arm.animation_data_create().action = action
    order = sorted(KEYED, key=lambda n: len(bones[n].parent_recursive))
    for frame, pose in enumerate(frames):
        scene.frame_set(frame)
        for name in KEYED:
            pb[name].matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        for name in order:
            pb[name].matrix = pose[name]
            bpy.context.view_layer.update()
        for name in order:
            pb[name].keyframe_insert("rotation_quaternion", frame=frame)

    key_carry(arm, hand_rest, limb)

    for obj in bpy.data.objects:
        obj.select_set(obj is arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=SCRATCH,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        export_optimize_animation_size=False,
        export_apply=False,
    )


def splice(clip_name, keyed):
    doc, blob = read_glb(ANIMS)
    add, extra = read_glb(SCRATCH)

    clips = [a for a in add.get("animations", []) if a.get("name") == clip_name]
    assert len(clips) == 1, [a.get("name") for a in add.get("animations", [])]
    clip = json.loads(json.dumps(clips[0]))

    by_name = {n["name"]: i for i, n in enumerate(doc["nodes"]) if "name" in n}
    from_add = {i: n.get("name") for i, n in enumerate(add["nodes"])}
    channels = [
        c for c in clip["channels"]
        if c["target"].get("path") == "rotation" and from_add.get(c["target"].get("node")) in keyed
    ]
    found = sorted(from_add[c["target"]["node"]] for c in channels)
    assert found == sorted(keyed), f"channels {found} != {sorted(keyed)}"
    missing = [n for n in keyed if n not in by_name]
    assert not missing, f"library lacks {missing}"

    doc["animations"] = [a for a in doc.get("animations", []) if a.get("name") != clip_name]
    blob += b"\0" * (-len(blob) % 4)
    samplers, remap = [], {}
    for channel in channels:
        sampler = dict(clip["samplers"][channel["sampler"]])
        for key in ("input", "output"):
            index = sampler[key]
            if index not in remap:
                accessor = dict(add["accessors"][index])
                view = dict(add["bufferViews"][accessor["bufferView"]])
                start = view.get("byteOffset", 0)
                chunk = extra[start:start + view["byteLength"]]
                view["byteOffset"] = len(blob)
                view["buffer"] = 0
                view.pop("byteStride", None)
                blob += chunk + b"\0" * (-len(chunk) % 4)
                accessor["bufferView"] = len(doc["bufferViews"])
                doc["bufferViews"].append(view)
                remap[index] = len(doc["accessors"])
                doc["accessors"].append(accessor)
            sampler[key] = remap[index]
        channel["sampler"] = len(samplers)
        channel["target"]["node"] = by_name[from_add[channel["target"]["node"]]]
        samplers.append(sampler)

    doc["animations"].append({"name": clip_name, "channels": channels, "samplers": samplers})
    doc["buffers"][0]["byteLength"] = len(blob) + (-len(blob) % 4)
    write_glb(ANIMS, doc, blob)
    return len(channels)


def main():
    build()
    channels = splice(CLIP, KEYED)
    carried = splice(CARRY, CARRY_KEYED)
    os.remove(SCRATCH)
    print(f"{CLIP}: {channels} channels, {LAST + 1} frames; {CARRY}: {carried} channels; "
          f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
