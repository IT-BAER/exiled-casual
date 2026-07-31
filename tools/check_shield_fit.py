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
shield_points = {}

for obj in sorted((o for o in bpy.data.objects if o.name.startswith("weapon2.")),
                  key=lambda o: o.name):
    if not ("buckler" in obj.name or "tower" in obj.name):
        continue
    influences = {
        obj.vertex_groups[assignment.group].name
        for vertex in obj.data.vertices
        for assignment in vertex.groups
        if assignment.weight > 0.999
    }
    print(f"{obj.name}: rigid influences={sorted(influences)}")
    if influences != {"lowerarm_l"}:
        failures.append(f"{obj.name}: shield is not rigidly attached to lowerarm_l")
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    world = evaluated.matrix_world
    points = np.array([(world @ vertex.co)[:] for vertex in mesh.vertices])
    evaluated.to_mesh_clear()
    shield_points[obj.name] = points

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

    if "buckler" in obj.name and (abs(normal[1]) < 0.90 or abs(normal[2]) > 0.10):
        failures.append(f"{obj.name}: face is not upright and forward-facing")
    if "tower" in obj.name and (abs(normal[0]) < 0.90 or abs(tall[2]) < 0.90):
        failures.append(f"{obj.name}: plate is not upright and left-facing")
    if abs(hand_local[0]) > 0.12 or abs(hand_local[1]) > 0.12:
        failures.append(f"{obj.name}: hand misses the carried area")
    if "buckler" in obj.name and not 0.15 <= abs(hand_local[2]) <= 0.23:
        failures.append(f"{obj.name}: plate is not against the holding arm")
    if "tower" in obj.name and not 0.025 <= abs(hand_local[2]) <= 0.10:
        failures.append(f"{obj.name}: grip depth misses the holding hand")

tower_name = next(name for name in shield_points if "tower" in name)
tower = shield_points[tower_name]
arm_points = []
for name in ("gloves.bracers.bracers", "body.ranger.hands", "body.ranger.sleeves"):
    obj = bpy.data.objects[name].evaluated_get(deps)
    mesh = obj.to_mesh()
    arm_points.extend((obj.matrix_world @ vertex.co)[:] for vertex in mesh.vertices)
    obj.to_mesh_clear()
arm_points = np.array(arm_points)
delta = tower[:, None, :] - arm_points[None, :, :]
nearest_arm = float(np.sqrt(np.min(np.einsum("ijk,ijk->ij", delta, delta))))
print(f"{tower_name}: nearest arm surface={nearest_arm:.4f}")
if nearest_arm > 0.035:
    failures.append(f"{tower_name}: plate is visibly detached from the holding arm")

centre = tower.mean(axis=0)
values, vectors = np.linalg.eigh(np.cov((tower - centre).T))
normal = vectors[:, np.argmin(values)]
if normal[1] < 0:
    normal *= -1
left_yaw = float(np.degrees(np.arctan2(normal[0], normal[1])))
print(f"{tower_name}: left cant={left_yaw:.2f} degrees")
if not 65.0 <= left_yaw <= 85.0:
    failures.append(f"{tower_name}: face does not point left with a small forward bias")

if failures:
    raise SystemExit("\n".join(failures))
