"""Bake a tangent-space normal map from a TRELLIS source onto its game-budget cut.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python-exit-code 1 --python tools/bake_generated_normal.py -- \
      --high review/3d/x/x-trellis-source-v1.glb --low review/3d/x/x-8k-v1.glb \
      --out assets/monsters/source/x_v1_n.png --size 1024

The decimated mesh keeps TRELLIS's atlas UVs, so the bake lands in the same
layout as the albedo. Both meshes come through the same glTF importer, so they
share one frame; the script refuses to bake if their bounds disagree.
"""
import argparse
import os
import sys

import bpy
from mathutils import Vector


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--high", required=True)
    p.add_argument("--low", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--size", type=int, default=1024)
    return p.parse_args(tail)


def load(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes):
            bpy.ops.object.join()
    obj = meshes[0]
    obj.parent = None
    obj.name = name
    bpy.context.view_layer.update()
    return obj


def bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return (Vector([min(p[k] for p in pts) for k in range(3)]),
            Vector([max(p[k] for p in pts) for k in range(3)]))


def main():
    a = args()
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    high = load(a.high, "high")
    low = load(a.low, "low")

    (hl, hh), (ll, lh) = bounds(high), bounds(low)
    diag = (hh - hl).length
    drift = max((hl - ll).length, (hh - lh).length)
    print("diag %.4f bounds drift %.5f" % (diag, drift))
    if drift > 0.02 * diag:
        sys.exit("high and low do not share a frame")

    img = bpy.data.images.new("baked_normal", a.size, a.size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    mat = low.data.materials[0]
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node
    for m in low.data.materials[1:]:
        if m is not None:
            n = m.node_tree.nodes.new("ShaderNodeTexImage")
            n.image = img
            m.node_tree.nodes.active = n

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 4
    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.use_cage = False
    # Rays start this far outside the low surface and may travel twice that
    # through it: decimation moved the surface by about a percent of the size.
    bake.cage_extrusion = 0.012 * diag
    bake.max_ray_distance = 0.03 * diag
    bake.normal_space = "TANGENT"
    bake.margin = 8

    for o in scene.objects:
        o.select_set(o in (high, low))
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type="NORMAL")
    # Blender resolves a bare relative path against no blend file, not the cwd.
    out = os.path.abspath(a.out)
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    if not os.path.exists(out):
        sys.exit("bake did not write " + out)
    print("wrote", out)


main()
