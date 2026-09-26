"""Add a bow draw-and-release clip to `anim-library.glb` as `Rig|Bow_Shoot`.

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
bone, so an unkeyed finger would otherwise be pinned to the T-pose. `hand_r` is
left out because layered clips never write the weapon-hand bones (`rig.ts`).

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
    "upperarm_r", "lowerarm_r",
)

# The beat, in frames at 30 fps. The runtime stretches the whole clip over the
# skill's repeat interval, so RELEASE is a fraction of it: 40% sits between Snap
# Shot's wind-up (7 of 15 ticks) and Piercing Shot's (9 of 30).
LAST = 30
RELEASE = 12

# Torso yaw, radians about world up. Negative brings the bow shoulder forward.
TWIST_AIM = math.radians(-40.0)
TWIST_EASY = math.radians(-25.0)
# Bow tilt off vertical about the arrow line, top toward the bow-arm side.
CANT = math.radians(10.0)
# The IK target is the WRIST; the string sits in the finger joints ahead of it,
# so the wrist is held this far back for the fingers to anchor at the jaw.
WRIST_BACK = 0.2
# The draw elbow's height at full draw, off the shoulder: level, as an archer holds it.
DRAW_ELBOW_RISE = 0.0
# Blender's IK bends this arm's elbow toward its pole at -90 degrees, not 0.
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


def grip_rotation(hand_rest, wrist_rest, limb, arrow, fwd, forearm):
    """
    World rotation of `hand_l` that stands the bow up along the arrow line.

    Either limb may point up. The one that leaves the wrist nearer its rest
    relation to the forearm wins, so the hand is never turned palm-out.
    """
    up = Vector((0.0, 0.0, 1.0))
    up = Matrix.Rotation(-CANT, 3, fwd) @ up
    goal = basis(up, fwd)
    best = None
    for sign in (1.0, -1.0):
        align = goal @ basis(limb * sign, arrow).inverted()
        rot = align @ hand_rest
        wrist = (wrist_rest.inverted() @ forearm.inverted() @ rot).to_quaternion().angle
        if best is None or wrist < best[0]:
            best = (wrist, rot)
    return best[1]


def ik(arm, bone, target, pole, pole_angle=0.0):
    con = arm.pose.bones[bone].constraints.new("IK")
    con.target = target
    con.pole_target = pole
    con.pole_angle = pole_angle
    con.chain_count = 2
    return con


def draw_pole(arm, shoulder, wrist):
    """
    A pole that puts the draw elbow level with the shoulder at full draw.

    The elbow can only lie on one circle, an upper arm from the shoulder and a
    forearm from the wrist; the level point on it furthest back (+Y) is aimed
    at from twice as far off the circle's centre.
    """
    bones = arm.data.bones
    upper = (bones["lowerarm_r"].head_local - bones["upperarm_r"].head_local).length
    fore = (bones["hand_r"].head_local - bones["lowerarm_r"].head_local).length
    span = (wrist - shoulder).length
    n = (wrist - shoulder) / span
    d = (upper * upper - fore * fore + span * span) / (2.0 * span)
    r = math.sqrt(max(upper * upper - d * d, 0.0))
    centre = shoulder + n * d
    u = (Vector((0.0, 0.0, 1.0)) - n * n.z).normalized()
    v = n.cross(u)
    cos = max(-1.0, min(1.0, (shoulder.z + DRAW_ELBOW_RISE - centre.z) / (r * u.z)))
    sin = math.sqrt(1.0 - cos * cos)
    elbow = max((centre + (u * cos + v * s * sin) * r for s in (1.0, -1.0)), key=lambda e: e.y)
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
    loosed = anchor + Vector((-0.10, 0.10, 0.02))
    kick = aim + Vector((0.0, -0.03, -0.02))
    low = Vector((0.0, 0.10, -0.22))

    bow_hand = [(0, aim + low * 0.6), (5, aim), (RELEASE, aim), (RELEASE + 2, kick),
                (22, kick), (LAST, aim + low)]
    draw_hand = [(0, nock + low * 0.6), (5, nock), (RELEASE - 1, anchor), (RELEASE, anchor),
                 (RELEASE + 2, loosed), (22, loosed), (LAST, loosed + low * 1.4)]
    twist = [(0, TWIST_EASY), (5, TWIST_AIM), (22, TWIST_AIM), (LAST, TWIST_EASY)]

    target_l, target_r = empty("bow_target_l"), empty("bow_target_r")
    pole_l, pole_r = empty("bow_pole_l"), empty("bow_pole_r")
    # Bow elbow soft and turned out-down; draw elbow level with the shoulder and behind it.
    pole_l.location = shoulder_l + Vector((0.45, -0.1, -0.35))
    pole_r.location = draw_pole(arm, shoulder_r, anchor)
    constraints = [ik(arm, "lowerarm_l", target_l, pole_l), ik(arm, "lowerarm_r", target_r, pole_r, DRAW_POLE_ANGLE)]

    frames = []
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
        bpy.context.view_layer.update()
        pose = {n: pb[n].matrix.copy() for n in KEYED}
        forearm = (world @ pose["lowerarm_l"]).to_3x3().normalized()
        fwd = (target_l.location - target_r.location).normalized()
        grip = grip_rotation(hand_rest, wrist_rest, limb, arrow, fwd, forearm)
        head = pose["hand_l"].to_translation()
        pose["hand_l"] = world.inverted() @ (Matrix.Translation(world @ head) @ grip.to_4x4())
        frames.append(pose)

    anchored = frames[RELEASE]
    shoulder_z = (world @ anchored["upperarm_r"]).to_translation().z
    elbow = (world @ anchored["lowerarm_r"]).to_translation()
    line = (anchor - aim).normalized()
    off = math.degrees((elbow - anchor).angle(line))
    print(f"anchor frame {RELEASE}: draw shoulder z {shoulder_z:.3f}, elbow z {elbow.z:.3f}, "
          f"forearm {off:.0f} deg off the arrow line")

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


def splice():
    doc, blob = read_glb(ANIMS)
    add, extra = read_glb(SCRATCH)

    clips = [a for a in add.get("animations", []) if a.get("name") == CLIP]
    assert len(clips) == 1, [a.get("name") for a in add.get("animations", [])]
    clip = json.loads(json.dumps(clips[0]))

    by_name = {n["name"]: i for i, n in enumerate(doc["nodes"]) if "name" in n}
    from_add = {i: n.get("name") for i, n in enumerate(add["nodes"])}
    channels = [
        c for c in clip["channels"]
        if c["target"].get("path") == "rotation" and from_add.get(c["target"].get("node")) in KEYED
    ]
    found = sorted(from_add[c["target"]["node"]] for c in channels)
    assert found == sorted(KEYED), f"channels {found} != {sorted(KEYED)}"
    missing = [n for n in KEYED if n not in by_name]
    assert not missing, f"library lacks {missing}"

    doc["animations"] = [a for a in doc.get("animations", []) if a.get("name") != CLIP]
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

    doc["animations"].append({"name": CLIP, "channels": channels, "samplers": samplers})
    doc["buffers"][0]["byteLength"] = len(blob) + (-len(blob) % 4)
    write_glb(ANIMS, doc, blob)
    os.remove(SCRATCH)
    return len(channels)


def main():
    build()
    channels = splice()
    print(f"{CLIP}: {channels} channels, {LAST + 1} frames, {os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
