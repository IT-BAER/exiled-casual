"""Rig and animate a generated humanoid monster mesh for review.

  blender --background --factory-startup --python-exit-code 1 --python tools/rig_humanoid.py -- \
      --input in.glb --output out.glb --id monster.vaal_husk.v1 --height 1.75 [--flip 0|1]

The mesh is taken as an A-pose humanoid facing -Y after import (--flip 1 turns it
half round first). Bones are placed from measured landmarks, weights come from
bone heat with a nearest-segment fallback, and walk/idle/attack are keyed as NLA
tracks named `<id>|<clip>` exactly as tools/build_monsters.py names them.
"""
import math
import sys

import bpy
import numpy
from mathutils import Quaternion, Vector

FPS = 30


def args():
    tail = sys.argv[sys.argv.index("--") + 1:]
    out = {"flip": "0", "height": "1.75"}
    for i in range(0, len(tail) - 1, 2):
        out[tail[i].lstrip("-")] = tail[i + 1]
    return out


def load_mesh(path, height, flip):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    for o in imported:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes):
            bpy.ops.object.join()
    mesh = meshes[0]
    mesh.parent = None
    if flip:
        mesh.rotation_euler.z += math.pi
    bpy.context.view_layer.objects.active = mesh
    with bpy.context.temp_override(active_object=mesh, selected_editable_objects=[mesh]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    v = verts(mesh)
    k = height / (v[:, 2].max() - v[:, 2].min())
    z0 = v[:, 2].min()
    mid = v[(v[:, 2] - z0 > 0.4 * (v[:, 2].max() - z0)) & (v[:, 2] - z0 < 0.6 * (v[:, 2].max() - z0))]
    cx, cy = numpy.median(mid[:, 0]), numpy.median(mid[:, 1])
    for vert in mesh.data.vertices:
        vert.co = Vector(((vert.co.x - cx) * k, (vert.co.y - cy) * k, (vert.co.z - z0) * k))
    mesh.data.update()
    return mesh


def verts(mesh):
    a = numpy.empty(len(mesh.data.vertices) * 3, dtype=numpy.float64)
    mesh.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def landmarks(mesh, H):
    """Joint positions, measured where the mesh says and proportioned where it cannot."""
    v = verts(mesh)
    band = lambda lo, hi: v[(v[:, 2] > lo * H) & (v[:, 2] < hi * H)]

    def column_y(lo, hi):
        b = band(lo, hi)
        b = b[numpy.abs(b[:, 0]) < 0.06 * H]
        return float(numpy.median(b[:, 1])) if len(b) else 0.0

    j = {}
    j["hips"] = Vector((0, column_y(0.48, 0.54), 0.51 * H))
    j["spine"] = Vector((0, column_y(0.58, 0.64), 0.61 * H))
    j["chest"] = Vector((0, column_y(0.68, 0.74), 0.71 * H))
    j["neck"] = Vector((0, column_y(0.80, 0.84), 0.82 * H))
    j["head"] = Vector((0, column_y(0.86, 0.90), 0.87 * H))
    j["top"] = Vector((0, j["head"].y, H))
    for side, s in (("l", 1), ("r", -1)):
        # Hand tip: the far end of the arm, among the vertices above the knee.
        upper = v[(v[:, 2] > 0.3 * H) & (s * v[:, 0] > 0)]
        far = upper[numpy.argsort(-s * upper[:, 0])[:max(5, len(upper) // 400)]]
        tip = Vector(far.mean(axis=0))
        shoulder = Vector((s * 0.105 * H, j["chest"].y, 0.80 * H))
        j["clav_" + side] = Vector((s * 0.02 * H, j["chest"].y, 0.79 * H))
        j["shoulder_" + side] = shoulder
        j["elbow_" + side] = shoulder.lerp(tip, 0.42) + Vector((0, 0.012 * H, 0))
        j["wrist_" + side] = shoulder.lerp(tip, 0.76)
        j["tip_" + side] = tip
        feet = v[(v[:, 2] < 0.06 * H) & (s * v[:, 0] > 0)]
        ankle = Vector((float(numpy.median(feet[:, 0])), float(numpy.percentile(feet[:, 1], 75)), 0.05 * H))
        toe = Vector((ankle.x, float(feet[:, 1].min()), 0.015 * H))
        hip = Vector((s * 0.055 * H, j["hips"].y, 0.49 * H))
        j["hip_" + side] = hip
        j["knee_" + side] = hip.lerp(ankle, 0.52) - Vector((0, 0.015 * H, 0))
        j["ankle_" + side] = ankle
        j["toe_" + side] = toe
    return j


BONES = [  # name, head, tail, parent
    ("hips", "hips", "spine", None),
    ("spine", "spine", "chest", "hips"),
    ("chest", "chest", "neck", "spine"),
    ("neck", "neck", "head", "chest"),
    ("head", "head", "top", "neck"),
]
for _s in ("l", "r"):
    _S = _s.upper()
    BONES += [
        ("clavicle_" + _s, "clav_" + _s, "shoulder_" + _s, "chest"),
        ("arm_upper_" + _s, "shoulder_" + _s, "elbow_" + _s, "clavicle_" + _s),
        ("arm_lower_" + _s, "elbow_" + _s, "wrist_" + _s, "arm_upper_" + _s),
        ("hand_" + _s, "wrist_" + _s, "tip_" + _s, "arm_lower_" + _s),
        ("leg%s_hip" % _S, "hip_" + _s, "knee_" + _s, "hips"),
        ("leg%s_knee" % _S, "knee_" + _s, "ankle_" + _s, "leg%s_hip" % _S),
        ("leg%s_ankle" % _S, "ankle_" + _s, "toe_" + _s, "leg%s_knee" % _S),
    ]


def build_armature(name, j):
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    with bpy.context.temp_override(active_object=arm, object=arm, selected_objects=[arm]):
        bpy.ops.object.mode_set(mode="EDIT")
        for bname, h, t, parent in BONES:
            eb = data.edit_bones.new(bname)
            eb.head, eb.tail = j[h], j[t]
            # Roll so every bone's local Z faces forward (-Y): keys stay readable.
            eb.align_roll(Vector((0, -1, 0)))
            if parent:
                eb.parent = data.edit_bones[parent]
                eb.use_connect = (eb.head - eb.parent.tail).length < 1e-4
        bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def seg_dist(p, a, b):
    ab = b - a
    t = numpy.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return numpy.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def skin(mesh, arm):
    """Nearest-bone weights, restricted to that bone and its direct neighbours.

    Bone heat fails on these generated shells, even on a watertight voxel copy.
    Limiting a vertex to one joint's bones keeps a skirt off the arms and a hand
    off the thigh it hangs beside; the smoothing pass softens the seams.
    """
    H = arm.data.bones["head"].tail_local.z
    mesh.parent = arm
    mod = mesh.modifiers.new("armature", "ARMATURE")
    mod.object = arm
    bones = list(arm.data.bones)
    index = {b.name: i for i, b in enumerate(bones)}
    v = verts(mesh)
    d = numpy.stack([seg_dist(v, numpy.array(b.head_local), numpy.array(b.tail_local)) for b in bones], 1)
    for i, b in enumerate(bones):
        side = 1 if b.name.endswith("_l") or b.name.startswith("legL") else -1 if b.name.endswith("_r") or b.name.startswith("legR") else 0
        if side:
            d[side * v[:, 0] < -0.01 * H, i] *= 3.0
        # An arm hanging beside a belly is nearer to the belly's flank than the
        # spine is: an arm bone never claims what lies medial of it by more than
        # an arm's radius, or raising the arm tears the belly open.
        if b.name.startswith(("arm_", "hand_")):
            a, c = numpy.array(b.head_local), numpy.array(b.tail_local)
            t = numpy.clip(((v - a) @ (c - a)) / max((c - a) @ (c - a), 1e-12), 0, 1)
            medial = side * (v[:, 0] - (a[0] + t * (c[0] - a[0])))
            d[medial < -0.05 * H, i] *= 3.0
    # Below the wrist, outside the empty gap beside the thigh, is whatever hangs
    # from the hand (net, chain): the widest run of empty 1%-of-H columns.
    for s, t in ((1, "l"), (-1, "r")):
        wrist = bones[index["hand_" + t]].head_local
        low = v[(v[:, 2] > 0.25 * H) & (v[:, 2] < wrist.z)]
        full = numpy.bincount((s * low[:, 0] / (0.01 * H)).clip(0).astype(int), minlength=100)
        run, best = 0, None
        for c in range(8, int(abs(wrist.x) / (0.01 * H))):
            run = run + 1 if full[c] == 0 else 0
            if run and (best is None or run > best[0]):
                best = (run, c)
        if best is None:
            continue
        gap = (best[1] - best[0] / 2 + 0.5) * 0.01 * H
        print("hand %s: hanging beyond x %.3f" % (t, gap))
        hangs = (s * v[:, 0] > gap) & (v[:, 2] < wrist.z)
        for i, b in enumerate(bones):
            if b.name not in ("hand_" + t, "arm_lower_" + t):
                d[hangs, i] *= 3.0
    W = numpy.zeros_like(d)
    nearest = d.argmin(axis=1)
    for vi, b0 in enumerate(nearest):
        bone = bones[b0]
        cand = {b0} | {index[c.name] for c in bone.children}
        if bone.parent:
            cand.add(index[bone.parent.name])
        cand = sorted(cand)
        w = 1.0 / numpy.maximum(d[vi, cand], 1e-3) ** 4
        W[vi, cand] = w / w.sum()
    # Four passes of neighbour averaging along the edges soften the joint seams.
    e = numpy.empty(len(mesh.data.edges) * 2, dtype=numpy.int64)
    mesh.data.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    deg = numpy.bincount(e.ravel(), minlength=len(v)).astype(float)[:, None]
    for _ in range(4):
        acc = numpy.zeros_like(W)
        numpy.add.at(acc, e[:, 0], W[e[:, 1]])
        numpy.add.at(acc, e[:, 1], W[e[:, 0]])
        W = 0.5 * W + 0.5 * numpy.where(deg > 0, acc / numpy.maximum(deg, 1), W)
    # A UV seam splits one surface point into several vertices the edge pass
    # never joins: give coincident vertices one weight, or the seam cracks open.
    _, weld = numpy.unique(numpy.round(v / (1e-4 * H)), axis=0, return_inverse=True)
    weld = weld.ravel()
    acc = numpy.zeros((weld.max() + 1, W.shape[1]))
    numpy.add.at(acc, weld, W)
    W = acc[weld] / numpy.bincount(weld)[weld, None]
    keep = numpy.argsort(-W, axis=1)[:, :4]
    groups = [mesh.vertex_groups.new(name=b.name) for b in bones]
    for vi in range(len(v)):
        ws = W[vi, keep[vi]]
        ws = ws / ws.sum()
        for bi, wt in zip(keep[vi], ws):
            if wt > 0.01:
                groups[bi].add([vi], float(wt), "REPLACE")
    print("weights: %d vertices, %d bones" % (len(v), len(bones)))


class Keyer:
    """Keys rotations given in ARMATURE-space axes about each bone's own head."""

    def __init__(self, arm, H):
        self.arm, self.H = arm, H
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}

    def pose(self, frame, rot, move=None):
        for pb in self.arm.pose.bones:
            r = rot.get(pb.name)
            q = Quaternion()
            if r is not None:
                for axis, angle in r:
                    q = Quaternion(axis, angle) @ q
            b = self.rest[pb.name]
            pb.rotation_quaternion = b.inverted() @ q @ b
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        hips = self.arm.pose.bones["hips"]
        hips.location = self.rest["hips"].inverted() @ Vector(move or (0, 0, 0))
        hips.keyframe_insert("location", frame=frame)


X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
HUNCH = 0.22


def clip_walk(k, n=36):
    for f in range(n + 1):
        p = 2 * math.pi * (f % n) / n
        rot, H = {}, k.H
        for side, s, ph in (("L", 1, p), ("R", -1, p + math.pi)):
            swing = -0.42 * math.sin(ph)                      # forward is -X rotation
            knee = 0.12 + 0.75 * max(0.0, math.cos(ph)) ** 1.4  # folds on the swing through
            rot["leg%s_hip" % side] = [(X, swing)]
            rot["leg%s_knee" % side] = [(X, knee)]
            rot["leg%s_ankle" % side] = [(X, -0.5 * (swing + knee) + 0.1)]
            a = side.lower()
            rot["arm_upper_" + a] = [(X, 0.30 * math.sin(ph) - 0.15)]
            rot["arm_lower_" + a] = [(X, -0.35 - 0.25 * max(0.0, -math.sin(ph)))]
        rot["hips"] = [(Z, 0.10 * math.sin(p)), (Y, 0.05 * math.cos(p))]
        rot["spine"] = [(X, HUNCH), (Z, -0.08 * math.sin(p))]
        rot["chest"] = [(X, 0.10), (Z, -0.10 * math.sin(p))]
        rot["neck"] = [(X, -0.15)]
        rot["head"] = [(X, -0.10 + 0.05 * math.sin(2 * p)), (Y, 0.06 * math.sin(p))]
        bob = -0.018 * H * math.cos(2 * p) - 0.02 * H
        k.pose(f + 1, rot, (0.012 * H * math.sin(p), 0, bob))
    return n


def clip_idle(k, n=48):
    for f in range(n + 1):
        p = 2 * math.pi * (f % n) / n
        breath = math.sin(p)
        rot = {
            "spine": [(X, HUNCH + 0.02 * breath)],
            "chest": [(X, 0.10 - 0.04 * breath)],
            "neck": [(X, -0.15)],
            "head": [(X, -0.08 + 0.04 * math.sin(p + 1.0)), (Z, 0.08 * math.sin(p))],
            "arm_upper_l": [(X, -0.12 + 0.03 * breath)],
            "arm_upper_r": [(X, -0.12 + 0.03 * math.sin(p + 0.7))],
            "arm_lower_l": [(X, -0.40)], "arm_lower_r": [(X, -0.45)],
            "legL_hip": [(X, -0.05)], "legL_knee": [(X, 0.12)], "legL_ankle": [(X, -0.04)],
            "legR_hip": [(X, 0.03)], "legR_knee": [(X, 0.10)], "legR_ankle": [(X, -0.06)],
            "hips": [(Y, 0.03 * math.sin(p))],
        }
        k.pose(f + 1, rot, (0.008 * k.H * math.sin(p), 0, -0.02 * k.H))
    return n


# Attack key poses, per bone (x, y, z) radians about armature axes, applied Y, X, then Z.
# Facing -Y: +X rotation tips a bone back, +Z turns him to his left (+X).
ATTACK_REST = {"spine": (HUNCH, 0, 0), "chest": (0.10, 0, 0), "neck": (-0.15, 0, 0), "head": (-0.08, 0, 0),
               "arm_upper_l": (-0.12, 0, 0), "arm_upper_r": (-0.12, 0, 0),
               "arm_lower_l": (-0.40, 0, 0), "arm_lower_r": (-0.45, 0, 0),
               "legL_knee": (0.12, 0, 0), "legR_knee": (0.12, 0, 0)}
ATTACK_RAISE = {**ATTACK_REST, "spine": (HUNCH - 0.12, 0, -0.30), "chest": (0.0, 0, -0.20),
                "arm_upper_r": (0.55, 2.3, 0.0), "arm_lower_r": (-1.1, 0, 0), "hand_r": (0.3, 0, 0),
                "arm_upper_l": (-0.30, -0.35, 0), "legL_hip": (-0.15, 0, 0), "legR_hip": (0.10, 0, 0)}
ATTACK_STRIKE = {**ATTACK_REST, "spine": (HUNCH + 0.40, 0, 0.35), "chest": (0.20, 0, 0.25), "neck": (-0.30, 0, 0),
                 "arm_upper_r": (-1.35, 0.35, 0.45), "arm_lower_r": (-0.25, 0, 0), "hand_r": (-0.35, 0, 0),
                 "arm_upper_l": (0.25, 0, 0), "legL_hip": (-0.45, 0, 0), "legL_knee": (0.50, 0, 0),
                 "legR_hip": (0.20, 0, 0), "legR_knee": (0.25, 0, 0), "legR_ankle": (-0.15, 0, 0)}
# (frame, pose, hips move as fractions of H): coil, hold, rake, recover.
ATTACK_KEYS = [(0, ATTACK_REST, (0, 0, -0.02)), (7, ATTACK_RAISE, (0, 0.02, -0.01)),
               (9, ATTACK_RAISE, (0, 0.02, -0.01)), (12, ATTACK_STRIKE, (0, -0.07, -0.05)),
               (15, ATTACK_STRIKE, (0, -0.06, -0.05)), (22, ATTACK_REST, (0, 0, -0.02))]


def ease(t):
    return t * t * (3 - 2 * t)


def clip_attack(k):
    n = ATTACK_KEYS[-1][0]
    for f in range(n + 1):
        i = max(j for j in range(len(ATTACK_KEYS) - 1) if ATTACK_KEYS[j][0] <= f)
        (f0, p0, m0), (f1, p1, m1) = ATTACK_KEYS[i], ATTACK_KEYS[min(i + 1, len(ATTACK_KEYS) - 1)]
        t = ease((f - f0) / (f1 - f0)) if f1 > f0 else 0.0
        rot = {}
        for bone in set(p0) | set(p1):
            a, b = p0.get(bone, (0, 0, 0)), p1.get(bone, (0, 0, 0))
            x, y, z = (a[c] + (b[c] - a[c]) * t for c in range(3))
            rot[bone] = [(Y, y), (X, x), (Z, z)]
        m = [(m0[c] + (m1[c] - m0[c]) * t) * k.H for c in range(3)]
        k.pose(f + 1, rot, m)
    return n


def author(arm, H):
    k = Keyer(arm, H)
    arm.animation_data_create()
    for clip, fn in (("walk", clip_walk), ("idle", clip_idle), ("attack", clip_attack)):
        action = bpy.data.actions.new("%s|%s" % (arm.name, clip))
        action.use_fake_user = True
        slot = action.slots.new("OBJECT", arm.name)
        layer = action.layers.new("base")
        layer.strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
        arm.animation_data.action = action
        arm.animation_data.action_slot = slot
        fn(k)
        track = arm.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, 1, action)
        if hasattr(strip, "action_slot"):
            strip.action_slot = slot
        arm.animation_data.action = None


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    o = args()
    bpy.context.scene.render.fps = FPS
    H = float(o["height"])
    mesh = load_mesh(o["input"], H, o["flip"] == "1")
    j = landmarks(mesh, H)
    arm = build_armature(o["id"], j)
    mesh.name = mesh.data.name = o["id"] + ".mesh"
    skin(mesh, arm)
    layer = mesh.data.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    layer.data.foreach_set("color", numpy.ones(len(mesh.data.loops) * 4, dtype=numpy.float32))
    mesh.data.color_attributes.active_color = layer
    author(arm, H)
    bpy.ops.export_scene.gltf(
        filepath=o["output"], export_format="GLB", export_apply=False, export_yup=True,
        export_skins=True, export_influence_nb=4, export_animations=True,
        export_animation_mode="NLA_TRACKS", export_nla_strips=True,
        export_vertex_color="ACTIVE", export_cameras=False, export_lights=False)
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    print("wrote", o["output"], "tris", tris, "bones", len(arm.data.bones))


if __name__ == "__main__":
    main()
