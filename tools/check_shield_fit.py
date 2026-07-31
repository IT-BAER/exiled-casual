"""Validate exported shield placement against the animated carry pose.

Run with Blender, after ``tools/build_wardrobe.py``:

  blender --background --factory-startup --python tools/check_shield_fit.py
"""

from pathlib import Path

import bpy
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
WARDROBE = ROOT / "apps/web/public/models/wardrobe.glb"
ANIMS = ROOT / "apps/web/public/models/anim-library.glb"
FRAME = 35


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(WARDROBE))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(ANIMS))
action = next(a for a in bpy.data.actions if a.name.endswith("|Idle_Loop"))
for obj in set(bpy.data.objects) - before:
    bpy.data.objects.remove(obj, do_unlink=True)

arm.animation_data_create()
arm.animation_data.action = action
if hasattr(arm.animation_data, "action_slot") and action.slots:
    arm.animation_data.action_slot = action.slots[0]
bpy.context.scene.frame_set(FRAME)
bpy.context.view_layer.update()

hand = arm.matrix_world @ arm.pose.bones["hand_l"].matrix
hand_at = np.array(hand.translation[:])
deps = bpy.context.evaluated_depsgraph_get()
failures = []

for obj in sorted((o for o in bpy.data.objects if o.name.startswith("weapon2.")),
                  key=lambda o: o.name):
    if not ("buckler" in obj.name or "tower" in obj.name):
        continue
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    world = evaluated.matrix_world
    points = np.array([(world @ vertex.co)[:] for vertex in mesh.vertices])
    evaluated.to_mesh_clear()

    centre = points.mean(axis=0)
    covariance = np.cov((points - centre).T)
    values, vectors = np.linalg.eigh(covariance)
    order = np.argsort(values)
    normal = vectors[:, order[0]]
    tall = vectors[:, order[-1]]
    wide = vectors[:, order[-2]]
    hand_local = [float(np.dot(hand_at - centre, axis))
                  for axis in (wide, tall, normal)]

    print(
        f"{obj.name}: centre={centre.round(4)}, "
        f"up={abs(tall[2]):.4f}, forward={abs(normal[1]):.4f}, "
        f"hand={np.abs(hand_local).round(4)}",
    )

    if abs(normal[1]) < 0.90 or abs(normal[2]) > 0.10:
        failures.append(f"{obj.name}: face is not upright and forward-facing")
    if "tower" in obj.name and abs(tall[2]) < 0.90:
        failures.append(f"{obj.name}: long axis is not vertical")
    if abs(hand_local[0]) > 0.12 or abs(hand_local[1]) > 0.12:
        failures.append(f"{obj.name}: hand misses the carried area")
    if not 0.15 <= abs(hand_local[2]) <= 0.23:
        failures.append(f"{obj.name}: plate is not against the holding arm")

if failures:
    raise SystemExit("\n".join(failures))
