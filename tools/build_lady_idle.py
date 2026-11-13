"""Add Maren's standing idle to `anim-library.glb` as `Rig|Idle_Lady_Loop`.

`Idle_Loop` rests her hands inside her thighs and `Idle_Talking_Loop` gestures with
her head bent to her hands, which the steep game camera reads as a scowl. This take
keeps `Idle_Loop`'s breathing body (pelvis, spine, clavicles, legs) and replaces the
arms, hands, fingers, neck and head: her hands folded in front of her at the waist,
the right laid over the back of the left, and her gaze lifted level. The runtime
gaze turns the head toward the player on top of it.

Authored on `wardrobe-female.glb`'s own skeleton, like `build_bow_clip.py` on the
male one: the runtime writes node-local rotations by bone name, so authoring on her
nodes is authoring what plays. `Idle_Loop` is grafted onto a copy of the wardrobe and
imported, so frame N in Blender is her body as the runtime plays it (pelvis
translation left out: it only moves her whole). Per frame the wrists are held fixed
on her belly (`spine_01`'s frame) by two-bone IK from wherever the breathing
clavicles put the shoulders. Before writing, every Nth frame is measured: no hand
vertex may sit deeper than `GATE` behind her gown, lace, cuffs, legs or other hand.

The clip spliced in shares `Idle_Loop`'s keys for every bone it does not replace.
Idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_lady_idle.py
"""

import json
import math
import os
import struct
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_bow_clip import ANIMS, basis, knuckles, turn, unroll  # noqa: E402
from build_cast_mirror import read_glb, write_glb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WARDROBE = os.path.join(ROOT, "assets/characters/wardrobe-female.glb")
POSED = os.path.join(tempfile.gettempdir(), "exiled-lady-idle-posed.glb")
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-lady-idle.glb")

SOURCE = "Rig|Idle_Loop"
CLIP = "Rig|Idle_Lady_Loop"
SKELETON = "Armature_female"
FPS = 30
FINGERS = ("thumb", "index", "middle", "ring", "pinky")
ARM_BONES = {side: (f"upperarm_{side}", f"lowerarm_{side}", f"hand_{side}") for side in ("l", "r")}
FINGER_BONES = {side: tuple(f"{f}_{i:02d}_{side}" for f in FINGERS for i in (1, 2, 3)) for side in ("l", "r")}
KEYED = ("neck_01", "Head") + tuple(b for s in ("l", "r") for b in ARM_BONES[s] + FINGER_BONES[s])

# Where the hands rest, in her bind frame (metres; she faces -Y, her left is +X, up +Z).
# The palm centre of the under (left) hand sits below the navel, clear of the gown's
# front; the right hand lies over its fingers, a hand's thickness and a little more out.
CLASP_Z = 1.02
CLASP_OFF_GOWN = 0.042
TOP_OUT = 0.07
TOP_UP = 0.012
# Sideways (+X her left) of each palm centre: the top hand covers the under hand's fingers, not its cuffed wrist.
UNDER_X = 0.03
TOP_X = -0.035
# Fingers of each hand point across her and down toward the opposite hip.
FINGER_DROP = 1.0
# ...and out from her body, so the fingertips stand off the belly.
FINGER_OUT = 0.3
# Elbows out to the side and a little back, never tucked into the waist.
POLE = Vector((0.75, 0.55, -0.15))
# Curl, degrees per joint (01, 02, 03). The under palm faces her, so its fingers stay near
# straight or they curl into her belly; the top hand drapes a little over them.
CURL = {
    "l": {"index": (2.0, 5.0, 4.0), "middle": (2.0, 5.0, 4.0), "ring": (3.0, 6.0, 5.0), "pinky": (4.0, 8.0, 6.0)},
    "r": {"index": (4.0, 10.0, 8.0), "middle": (4.0, 10.0, 8.0), "ring": (5.0, 12.0, 9.0), "pinky": (6.0, 14.0, 10.0)},
}
# The bind thumb hangs on the palm side, into her belly and the other hand: turned this far
# about the hand's length, its tip comes up beside the index finger.
THUMB_TUCK = math.radians(60.0)
# Head and neck share the lift; the face ends this far above level (radians), which
# reads open rather than looking down at the player under a steep camera.
GAZE_PITCH = 0.04
NECK_SHARE = 0.4
# Penetration gate (metres) and how often a frame is measured.
GATE = 0.002
MEASURE_EVERY = 5
HANDS = ("base.female.hand_l", "base.female.hand_r")
OBSTACLES = (
    "chest.maren.gown", "chest.maren.backing", "chest.maren.gorget", "chest.maren.lace",
    "chest.maren.cuffs", "base.female.leg_l", "base.female.leg_r", "base.female.torso",
)
SLEEVES = ("chest.maren.lace", "chest.maren.cuffs")


# --- graft Idle_Loop onto the wardrobe ----------------------------------------

def write_raw_glb(path, doc, blob):
    """A glb as-is: the wardrobe keeps its images in buffer views, which `compact` does not track."""
    text = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    blob += b"\0" * (-len(blob) % 4)
    body = struct.pack("<II", len(text), 0x4E4F534A) + text + struct.pack("<II", len(blob), 0x004E4942) + blob
    with open(path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)


def copy_accessor(src_doc, src_blob, index, dst_doc, blob):
    """Append accessor `index` of the source to the destination; returns (new index, grown blob)."""
    accessor = dict(src_doc["accessors"][index])
    view = dict(src_doc["bufferViews"][accessor["bufferView"]])
    start = view.get("byteOffset", 0)
    chunk = src_blob[start:start + view["byteLength"]]
    blob += b"\0" * (-len(blob) % 4)
    view["byteOffset"] = len(blob)
    view["buffer"] = 0
    view.pop("byteStride", None)
    blob += chunk
    accessor["bufferView"] = len(dst_doc["bufferViews"])
    dst_doc["bufferViews"].append(view)
    dst_doc["accessors"].append(accessor)
    return len(dst_doc["accessors"]) - 1, blob


def graft_idle():
    """Write the wardrobe with `SOURCE`'s rotations on its own joints to `POSED`."""
    lib, lib_blob = read_glb(ANIMS)
    doc, blob = read_glb(WARDROBE)
    source = next(a for a in lib["animations"] if a["name"] == SOURCE)
    joints = {doc["nodes"][j]["name"]: j for skin in doc["skins"] for j in skin["joints"]}
    channels, samplers, remap = [], [], {}
    for channel in source["channels"]:
        name = lib["nodes"][channel["target"]["node"]]["name"]
        if channel["target"]["path"] != "rotation":
            continue
        assert name in joints, f"wardrobe lacks {name}"
        sampler = dict(source["samplers"][channel["sampler"]])
        for key in ("input", "output"):
            if sampler[key] not in remap:
                remap[sampler[key]], blob = copy_accessor(lib, lib_blob, sampler[key], doc, blob)
            sampler[key] = remap[sampler[key]]
        samplers.append(sampler)
        channels.append({"sampler": len(samplers) - 1, "target": {"node": joints[name], "path": "rotation"}})
    doc["animations"] = [{"name": SOURCE, "channels": channels, "samplers": samplers}]
    doc["buffers"][0]["byteLength"] = len(blob) + (-len(blob) % 4)
    write_raw_glb(POSED, doc, blob)
    return len(channels)


# --- posing -------------------------------------------------------------------

def swing(rest, direction):
    """World rotation turning a bone's rest axis onto `direction` by the shortest arc."""
    return (rest @ Vector((0.0, 1.0, 0.0))).rotation_difference(direction).to_matrix() @ rest


def palm_normal(head_of, side):
    """Unit normal out of the palm: across the knuckles, on the side the thumb hangs."""
    wrist = head_of(f"hand_{side}")
    along = (head_of(f"middle_01_{side}") - wrist).normalized()
    normal = along.cross(knuckles(head_of, side)).normalized()
    return normal if normal.dot(head_of(f"thumb_02_{side}") - wrist) > 0 else -normal


def elbow_at(shoulder, wrist, upper, fore, pole):
    """Two-bone IK: the elbow between `shoulder` and `wrist`, bent toward `pole`."""
    span = min((wrist - shoulder).length, 0.999 * (upper + fore))
    n = (wrist - shoulder).normalized()
    along = (upper * upper - fore * fore + span * span) / (2.0 * span)
    out = pole - n * pole.dot(n)
    return shoulder + n * along + out.normalized() * math.sqrt(max(upper * upper - along * along, 0.0))


class Rest:
    """Her bind pose: world rotations, palm frames, lengths and the clasp targets in `spine_01`'s frame."""

    def __init__(self, arm, fronts):
        world, pb = arm.matrix_world, arm.pose.bones
        head_of = lambda n: world @ pb[n].head
        self.rot = {b.name: (world @ b.matrix).to_3x3().normalized() for b in pb}
        self.belly = (world @ pb["spine_01"].matrix).copy()
        self.len = {s: ((head_of(f"lowerarm_{s}") - head_of(f"upperarm_{s}")).length,
                        (head_of(f"hand_{s}") - head_of(f"lowerarm_{s}")).length) for s in ("l", "r")}
        self.frame, self.palm_off = {}, {}
        for s in ("l", "r"):
            wrist = head_of(f"hand_{s}")
            fingers = (head_of(f"middle_01_{s}") - wrist).normalized()
            self.frame[s] = basis(fingers, palm_normal(head_of, s))
            knuckle = sum((head_of(f"{f}_01_{s}") for f in FINGERS[1:]), Vector()) / 4.0
            self.palm_off[s] = (knuckle + wrist) / 2.0 - wrist
        # The gown parts in front, so its front is wherever gown, backing or torso stands furthest out.
        front = [o.matrix_world @ v.co for o in fronts for v in o.data.vertices]
        self.gown_front = min(p.y for p in front if abs(p.z - CLASP_Z) < 0.02 and abs(p.x) < 0.06)
        under = Vector((UNDER_X, self.gown_front - CLASP_OFF_GOWN, CLASP_Z))
        self.palm_at = {"l": under, "r": under + Vector((TOP_X - UNDER_X, -TOP_OUT, TOP_UP))}
        # Under hand: fingers to her right and down, palm toward her; the top hand mirrors it.
        self.goal = {
            "l": basis(Vector((-1.0, -FINGER_OUT, -FINGER_DROP)).normalized(), Vector((0.0, 1.0, 0.0))),
            "r": basis(Vector((1.0, -FINGER_OUT, -FINGER_DROP)).normalized(), Vector((0.0, 1.0, 0.0))),
        }


def set_world(arm, name, rot, head):
    pb = arm.pose.bones[name]
    pb.matrix = arm.matrix_world.inverted() @ (Matrix.Translation(head) @ rot.to_4x4())
    bpy.context.view_layer.update()


def lift_gaze(arm, rest):
    """Pitch neck and head about her lateral axis until the face points `GAZE_PITCH` above level."""
    world, pb = arm.matrix_world, arm.pose.bones
    now = (world @ pb["Head"].matrix).to_3x3().normalized()
    face = now @ rest.rot["Head"].inverted() @ Vector((0.0, -1.0, 0.0))
    pitch = math.atan2(face.z, math.hypot(face.x, face.y))
    axis = face.cross(Vector((0.0, 0.0, 1.0))).normalized()
    lift = GAZE_PITCH - pitch
    turn(pb["neck_01"], axis, lift * NECK_SHARE, world)
    turn(pb["Head"], axis, lift * (1.0 - NECK_SHARE), world)
    return pitch


def pose_arm(arm, rest, side):
    """Fold one arm onto her belly; returns the wrist bend off the forearm, degrees."""
    world, pb = arm.matrix_world, arm.pose.bones
    head_of = lambda n: world @ pb[n].head
    upper_n, fore_n, hand_n = ARM_BONES[side]
    belly = (world @ pb["spine_01"].matrix) @ rest.belly.inverted()
    turn3 = belly.to_3x3().normalized()
    hand = turn3 @ rest.goal[side] @ rest.frame[side].inverted() @ rest.rot[hand_n]
    wrist = belly @ rest.palm_at[side] - hand @ rest.rot[hand_n].inverted() @ rest.palm_off[side]
    sign = 1.0 if side == "l" else -1.0
    pole = turn3 @ Vector((POLE.x * sign, POLE.y, POLE.z))
    shoulder = head_of(upper_n)
    upper_len, fore_len = rest.len[side]
    elbow = elbow_at(shoulder, wrist, upper_len, fore_len, pole)

    upper = swing(rest.rot[upper_n], elbow - shoulder)
    fore = swing(upper @ rest.rot[upper_n].inverted() @ rest.rot[fore_n], wrist - elbow)
    wrist_rest = rest.rot[fore_n].inverted() @ rest.rot[hand_n]
    fore = fore @ Matrix.Rotation(unroll(fore, hand, wrist_rest), 3, "Y")
    set_world(arm, upper_n, upper, shoulder)
    set_world(arm, fore_n, fore, head_of(fore_n))
    set_world(arm, hand_n, hand, head_of(hand_n))
    miss = (head_of(hand_n) - wrist).length
    assert miss < 0.002, f"{side} wrist misses its target by {miss * 1000:.1f} mm"

    along = (head_of(f"middle_01_{side}") - head_of(hand_n)).normalized()
    palm = palm_normal(head_of, side)
    hinge = along.cross(palm).normalized()  # a positive turn about it carries a finger toward the palm
    tip = head_of(f"thumb_03_{side}") - head_of(f"thumb_01_{side}")
    tuck = THUMB_TUCK if along.cross(tip).dot(palm) < 0 else -THUMB_TUCK
    turn(pb[f"thumb_01_{side}"], along, tuck, world)
    for finger, angles in CURL[side].items():
        for i, angle in enumerate(angles, start=1):
            turn(pb[f"{finger}_{i:02d}_{side}"], hinge, math.radians(angle), world)
    bend = (fore.inverted() @ hand @ wrist_rest.inverted()).to_quaternion().angle
    return math.degrees(bend)


# --- measuring ----------------------------------------------------------------

def depth_behind(points, tree):
    """Deepest point behind its nearest face within 3 cm, how many sit past `GATE`, and where the deepest is."""
    worst, count, at = 0.0, 0, None
    for p in points:
        hit = tree.find_nearest(p, 0.03)
        if hit[0] is None:
            continue
        loc, normal = hit[0], hit[1]
        inside = (loc - p).dot(normal)
        if inside > worst:
            worst, at = inside, p.copy()
        count += inside > GATE
    return worst, count, at


def arm_faces(obj, side):
    """Indices of `obj`'s faces skinned mostly to `side`'s arm: a sleeve encloses its own wrist by design."""
    arm = {f"{b}_{side}" for b in ("clavicle", "upperarm", "lowerarm", "hand")} | set(FINGER_BONES[side])
    names = {g.index: g.name for g in obj.vertex_groups}
    owned = [bool(v.groups) and names[max(v.groups, key=lambda g: g.weight).group] in arm for v in obj.data.vertices]
    return {p.index for p in obj.data.polygons if sum(owned[i] for i in p.vertices) * 2 > len(p.vertices)}


def measure():
    """Per hand and obstacle, the depth report of `depth_behind`; sleeves without the hand's own arm."""
    graph = bpy.context.evaluated_depsgraph_get()
    pts, polys = {}, {}
    for name in HANDS + OBSTACLES:
        obj = bpy.data.objects[name].evaluated_get(graph)
        mesh = obj.to_mesh()
        pts[name] = [obj.matrix_world @ v.co for v in mesh.vertices]
        polys[name] = [tuple(p.vertices) for p in mesh.polygons]
        obj.to_mesh_clear()
    report = {}
    for hand in HANDS:
        side = hand[-1]
        for other in OBSTACLES + tuple(h for h in HANDS if h != hand):
            faces = polys[other]
            if other in SLEEVES:
                own = arm_faces(bpy.data.objects[other], side)
                faces = [f for i, f in enumerate(faces) if i not in own]
            report[(hand, other)] = depth_behind(pts[hand], BVHTree.FromPolygons(pts[other], faces))
    return report


# --- build --------------------------------------------------------------------

def build():
    grafted = graft_idle()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=POSED)
    arm = bpy.data.objects[SKELETON]
    idle = next(a for a in bpy.data.actions if SOURCE in a.name)
    arm.animation_data_create()
    arm.animation_data.action = None
    pb = arm.pose.bones
    for bone in pb:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    rest = Rest(arm, [bpy.data.objects[n] for n in ("chest.maren.gown", "chest.maren.backing", "base.female.torso")])

    first, last = (int(round(v)) for v in idle.frame_range)
    arm.animation_data.action = idle
    body = {}
    for frame in range(first, last + 1):
        scene.frame_set(frame)
        body[frame] = {b.name: b.matrix_basis.copy() for b in pb}
    print(f"{SOURCE}: {grafted} channels grafted, frames {first}..{last}, gown front {rest.gown_front:.3f} m at z {CLASP_Z}")

    clip = bpy.data.actions.get(CLIP)
    if clip is not None:
        bpy.data.actions.remove(clip)
    arm.animation_data.action = bpy.data.actions.new(CLIP)
    order = sorted(KEYED, key=lambda n: len(arm.data.bones[n].parent_recursive))
    previous, worst = {}, {}
    for frame in range(first, last + 1):
        scene.frame_set(frame)
        for name, basis_m in body[frame].items():
            pb[name].matrix_basis = basis_m
        bpy.context.view_layer.update()
        pitch = lift_gaze(arm, rest)
        bends = {s: pose_arm(arm, rest, s) for s in ("l", "r")}
        if frame == first:
            at = lambda n: tuple(round(c, 3) for c in arm.matrix_world @ pb[n].head)
            print(f"frame {frame}: idle gaze pitch {math.degrees(pitch):+.1f} deg, wrist bend l {bends['l']:.0f} r {bends['r']:.0f} deg")
            for n in ("lowerarm_l", "hand_l", "middle_01_l", "lowerarm_r", "hand_r", "middle_01_r"):
                print(f"  {n} at {at(n)}")
        for name in order:
            q = pb[name].rotation_quaternion
            if name in previous:
                q.make_compatible(previous[name])
            previous[name] = q.copy()
            pb[name].keyframe_insert("rotation_quaternion", frame=frame)
        if (frame - first) % MEASURE_EVERY == 0 or frame == last:
            for key, (depth, count, at) in measure().items():
                if depth > worst.get(key, (0.0,))[0]:
                    worst[key] = (depth, count, frame, at)
    for (hand, other), (depth, count, frame, at) in sorted(worst.items()):
        where = f" at {tuple(round(c, 3) for c in at)}" if at else ""
        print(f"  {hand} behind {other}: {depth * 1000:.1f} mm, {count} vertices past {GATE * 1000:.0f} mm (frame {frame}){where}")
    failed = [k for k, (depth, *_rest) in worst.items() if depth > GATE]
    assert not failed, f"hands deeper than {GATE * 1000:.0f} mm in {failed}"

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
    """`SOURCE`'s channels with `KEYED`'s rotations replaced by the scratch take's, as `CLIP`."""
    doc, blob = read_glb(ANIMS)
    add, extra = read_glb(SCRATCH)
    source = next(a for a in doc["animations"] if a["name"] == SOURCE)
    taken = next(a for a in add["animations"] if a["name"] == CLIP)
    named = lambda d, c: d["nodes"][c["target"]["node"]]["name"]
    fresh = {named(add, c): c for c in taken["channels"] if c["target"]["path"] == "rotation" and named(add, c) in KEYED}
    assert sorted(fresh) == sorted(KEYED), sorted(set(KEYED) - set(fresh))

    channels, samplers = [], []
    for channel in source["channels"]:
        name = named(doc, channel)
        if channel["target"]["path"] == "rotation" and name in fresh:
            sampler = dict(taken["samplers"][fresh.pop(name)["sampler"]])
            for key in ("input", "output"):
                sampler[key], blob = copy_accessor(add, extra, sampler[key], doc, blob)
        else:
            sampler = dict(source["samplers"][channel["sampler"]])
        samplers.append(sampler)
        channels.append({"sampler": len(samplers) - 1, "target": dict(channel["target"])})
    assert not fresh, f"{SOURCE} does not key {sorted(fresh)}"
    doc["animations"] = [a for a in doc["animations"] if a["name"] != CLIP]
    doc["animations"].append({"name": CLIP, "channels": channels, "samplers": samplers})
    doc["buffers"][0]["byteLength"] = len(blob) + (-len(blob) % 4)
    write_glb(ANIMS, doc, blob)
    return len(channels)


def main():
    build()
    channels = splice()
    for path in (POSED, SCRATCH):
        os.remove(path)
    print(f"{CLIP}: {channels} channels, {len(KEYED)} replaced; {os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
