"""Measure bone-capsule radii from the exported wardrobe geometry."""
import os

import bpy
from mathutils.geometry import intersect_point_line

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, "apps", "web", "public", "models", "wardrobe.glb")

bpy.ops.import_scene.gltf(filepath=GLB)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")

MESHES = {
    "legs": bpy.data.objects["body.ranger.legs"],
    "boots": bpy.data.objects["boots.ranger.boots"],
    "shoes": bpy.data.objects["boots.commoner.shoes"],
}
SEGMENTS = [
    ("thigh_l", "calf_l"), ("thigh_r", "calf_r"),
    ("calf_l", "foot_l"), ("calf_r", "foot_r"),
    ("foot_l", "ball_l"), ("foot_r", "ball_r"),
]

for source, obj in MESHES.items():
    groups = {g.index: g.name for g in obj.vertex_groups}
    print(source)
    for head_name, tail_name in SEGMENTS:
        head = arm.data.bones[head_name].head_local
        tail = arm.data.bones[tail_name].head_local
        radius = 0.0
        count = 0
        bins = [0.0] * 5
        for vertex in obj.data.vertices:
            weights = {groups[g.group]: g.weight for g in vertex.groups}
            if weights.get(head_name, 0.0) < 0.2:
                continue
            point = obj.matrix_world @ vertex.co
            point = arm.matrix_world.inverted() @ point
            near, factor = intersect_point_line(point, head, tail)
            factor = min(1.0, max(0.0, factor))
            near = head.lerp(tail, factor)
            radial = (point - near).length
            radius = max(radius, radial)
            bins[min(4, int(factor * 5))] = max(bins[min(4, int(factor * 5))], radial)
            count += 1
        print(f"  {head_name}->{tail_name}: radius={radius:.5f}, bins="
              f"{','.join(f'{v:.5f}' for v in bins)}, vertices={count}")
