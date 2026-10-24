"""Add the tower shield's braced carry to `anim-library.glb` as `Rig|Shield_Carry`.

The tower shield is skinned rigidly to `lowerarm_l`, strapped along the forearm,
so under the pack's clips it swings with the arm and waves about like a board.
This one-pose clip braces the shield arm: the shoulder at bind, the upper arm
forward, out and a little down, and the forearm turned so the shield stands
nearly upright off the left hip, its face turned 50 deg out and its bottom kicked
forward, clear of the striding knee. `rig.ts` lays it over every clip while the
tower shield is worn and holds the arm in the hips' heading, so the shield rides
with the shoulder and never rocks.

The shield is rigid on the forearm, so the forearm's world rotation is solved
straight from the wanted shield frame; the upper arm only places the elbow, and
the hand keeps its bind relation to the forearm (the wrist does not bend).

Authored on the WARDROBE's male skeleton like `tools/build_bow_clip.py`, whose
helpers and splice it reuses: the runtime writes node-local rotations by bone
name, so authoring on those nodes is authoring what plays. Only the ROTATIONS of
`KEYED` are spliced. Idempotent.

    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python tools/build_shield_clip.py
"""

import math
import os
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_bow_clip import ANIMS, basis, principal_axes, splice  # noqa: E402

WARDROBE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets/characters/wardrobe.glb")
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-shield-clip.glb")

CLIP = "Rig|Shield_Carry"
SKELETON = "Armature"
SHIELD = "weapon2.towershield.mesh"
KEYED = ("clavicle_l", "upperarm_l", "lowerarm_l", "hand_l")

# Upper arm direction off the shoulder: out (+X), forward (-Y), down (-Z).
UPPER = Vector((0.6, -0.8, -0.45)).normalized()
# Shield face turned this far outward from straight ahead.
OUTWARD = math.radians(50.0)
# The shield's bottom kicked forward off vertical.
LEAN = math.radians(12.0)
# Where the left knee travels in the jog, metres off the left shoulder in the hips'
# heading (out, up, forward), measured at `?viewer` and grown by its knee cop's 9 cm.
# No shield vertex may sit inside it, or the knee strides through the shield.
KNEE = ((-0.19, 0.06), (-0.99, -0.54), (-0.60, 0.46))


def shield_frame(shield, elbow, wrist):
    """
    The shield's long axis (signed elbow to wrist, toward its long end) and its
    face normal (signed away from the forearm, toward the face's middle) at rest.
    """
    points = [shield.matrix_world @ v.co for v in shield.data.vertices]
    centre, height, width = principal_axes(points)
    if height.dot(wrist - elbow) < 0:
        height = -height
    depth = height.cross(width).normalized()
    h = max(abs((p - centre).dot(height)) for p in points)
    w = max(abs((p - centre).dot(width)) for p in points)
    middle = [p for p in points if abs((p - centre).dot(height)) < 0.15 * h and abs((p - centre).dot(width)) < 0.15 * w]
    face = sum(middle, Vector()) / len(middle)
    if (face - (elbow + wrist) / 2.0).dot(depth) < 0:
        depth = -depth
    return height, depth


def swing(rest, direction):
    """World rotation turning a bone's rest axis onto `direction` by the shortest arc."""
    return (rest @ Vector((0.0, 1.0, 0.0))).rotation_difference(direction).to_matrix() @ rest


def pose_carry(arm, shield):
    """Pose `KEYED` into the carry and return their pose matrices; the rest of the body stays at bind."""
    world, pb = arm.matrix_world, arm.pose.bones
    head_of = lambda n: world @ pb[n].head
    arm.animation_data_create().action = None
    for bone in pb:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    rest = {n: (world @ pb[n].matrix).to_3x3().normalized() for n in KEYED}
    wrist_rest = rest["lowerarm_l"].inverted() @ rest["hand_l"]
    shoulder, elbow_rest, wrist_at = head_of("upperarm_l"), head_of("lowerarm_l"), head_of("hand_l")
    height, depth = shield_frame(shield, elbow_rest, wrist_at)
    upper_len = (elbow_rest - shoulder).length

    # The long end hangs down, its bottom kicked forward by LEAN; the face turns forward (-Y) and out (+X).
    down = Vector((0.0, -math.sin(LEAN), -math.cos(LEAN)))
    face = Vector((math.sin(OUTWARD), -math.cos(OUTWARD), 0.0))
    forearm = basis(down, face) @ basis(height, depth).inverted() @ rest["lowerarm_l"]
    upper = swing(rest["upperarm_l"], UPPER)
    elbow = shoulder + UPPER * upper_len

    pose = {
        "clavicle_l": pb["clavicle_l"].matrix.copy(),
        "upperarm_l": world.inverted() @ (Matrix.Translation(shoulder) @ upper.to_4x4()),
        "lowerarm_l": world.inverted() @ (Matrix.Translation(elbow) @ forearm.to_4x4()),
    }
    forearm_len = (wrist_at - elbow_rest).length
    wrist = elbow + forearm @ Vector((0.0, 1.0, 0.0)) * forearm_len
    pose["hand_l"] = world.inverted() @ (Matrix.Translation(wrist) @ (forearm @ wrist_rest).to_4x4())

    order = sorted(KEYED, key=lambda n: len(arm.data.bones[n].parent_recursive))
    for name in order:
        pb[name].matrix = pose[name]
        bpy.context.view_layer.update()
    bend = math.degrees((upper @ Vector((0.0, 1.0, 0.0))).angle(forearm @ Vector((0.0, 1.0, 0.0))))
    evaluated = shield.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    rel = [evaluated.matrix_world @ v.co - shoulder for v in mesh.vertices]
    evaluated.to_mesh_clear()
    knocked = sum(1 for p in rel if all(lo <= c <= hi for c, (lo, hi) in zip((p.x, p.z, -p.y), KNEE)))
    print(f"carry: elbow {tuple(round(c, 3) for c in elbow)}, wrist {tuple(round(c, 3) for c in wrist)}, "
          f"elbow bent {bend:.0f} deg, shield {min(p.z for p in rel):.2f}..{max(p.z for p in rel):.2f} m "
          f"off the shoulder, {knocked} vertices in the knee's path")
    assert knocked == 0, f"{knocked} shield vertices in the knee's path"
    return pose


def build():
    bpy.ops.import_scene.gltf(filepath=WARDROBE)
    arm = bpy.data.objects[SKELETON]
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" and obj.animation_data:
            obj.animation_data.action = None
    pose = pose_carry(arm, bpy.data.objects[SHIELD])

    stale = bpy.data.actions.get(CLIP)
    if stale is not None:
        bpy.data.actions.remove(stale)
    arm.animation_data.action = bpy.data.actions.new(CLIP)
    pb = arm.pose.bones
    order = sorted(KEYED, key=lambda n: len(arm.data.bones[n].parent_recursive))
    for frame in (0, 1):
        bpy.context.scene.frame_set(frame)
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


def main():
    build()
    channels = splice(CLIP, KEYED, SCRATCH)
    os.remove(SCRATCH)
    print(f"{CLIP}: {channels} channels; {os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
