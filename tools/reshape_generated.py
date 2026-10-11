"""Rebuild a generated creature from its volumetric opening (tools/open_volume.py).

Run (Blender 5.2, two stages around the system-Python opening):
  blender -b --factory-startup --python-exit-code 1 --python tools/reshape_generated.py -- \
      export --source x-trellis-source.glb --npz x-soup.npz
  python tools/open_volume.py x-soup.npz x-open.npz --radius 3
  blender ... --python tools/reshape_generated.py -- rebuild --source x-trellis-source.glb \
      --npz x-open.npz --low x-4000.glb --high x-open-high.glb --triangles 4000 --tex 512

`rebuild` decimates the opened surface to the budget, unwraps it, and bakes the
source's albedo onto it selected-to-active, so the sheet keeps TRELLIS's colours on a
shape without flaps. `--high` is the dense opened surface: bake the normal map from
it (tools/bake_generated_normal.py), never from the source, or the flaps return as
shading. Every stage shares the glTF importer's frame with transforms applied.
`--yaw` (degrees, about +Z) turns source and surface together, for a TRELLIS body
built at an angle: GeneratedSkin can only flip a mesh, not turn it.
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

# Never beautify_fill between passes: it folds thin and sharp parts (sentinel
# blade p99 error 0.016 diag with it, 0.0013 without).
DECIMATE_PASSES = 4


def args():
    tail = sys.argv[sys.argv.index("--") + 1:]
    p = argparse.ArgumentParser()
    p.add_argument("stage", choices=("export", "rebuild"))
    p.add_argument("--source", required=True)
    p.add_argument("--npz", required=True)
    p.add_argument("--low")
    p.add_argument("--high")
    p.add_argument("--triangles", type=int, default=4000)
    p.add_argument("--tex", type=int, default=512)
    p.add_argument("--yaw", type=float, default=0.0)
    return p.parse_args(tail)


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def load_source(path):
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
    with bpy.context.temp_override(active_object=obj, selected_editable_objects=[obj]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = "source"
    return obj


def export_stage(a):
    clear()
    src = load_source(a.source)
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    verts = np.array([v.co[:] for v in bm.verts], np.float32)
    faces = np.array([[v.index for v in f.verts] for f in bm.faces], np.int32)
    bm.free()
    np.savez(a.npz, verts=verts, faces=faces)
    print("exported", len(verts), "verts", len(faces), "faces ->", a.npz)


def mesh_from_npz(path, name):
    d = np.load(path)
    me = bpy.data.meshes.new(name)
    me.from_pydata(d["verts"].tolist(), [], d["faces"].tolist())
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    # marching cubes winds the faces inward relative to Blender's convention
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return obj


def decimate(obj, target):
    for _ in range(DECIMATE_PASSES):
        count = len(obj.data.polygons)
        if count <= target:
            break
        m = obj.modifiers.new("budget", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target / count
        m.use_collapse_triangulate = True
        with bpy.context.temp_override(object=obj, active_object=obj):
            bpy.ops.object.modifier_apply(modifier=m.name)
    obj.data.shade_smooth()


def unwrap(obj):
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")


def export_glb(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(path), export_format="GLB",
                              use_selection=True, export_materials="EXPORT",
                              export_cameras=False, export_lights=False, export_animations=False)


def rebuild_stage(a):
    clear()
    src = load_source(a.source)
    dense = mesh_from_npz(a.npz, "opened")
    if a.yaw:
        turn = Matrix.Rotation(math.radians(a.yaw), 4, "Z")
        for o in (src, dense):
            o.data.transform(turn)
            o.data.update()
    if a.high:
        export_glb(dense, a.high)
    low = dense
    decimate(low, a.triangles)
    unwrap(low)

    img = bpy.data.images.new("albedo", a.tex, a.tex, alpha=False)
    mat = bpy.data.materials.new("albedo")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.9
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nodes.active = tex
    low.data.materials.clear()
    low.data.materials.append(mat)

    lo = np.array([min(v.co[k] for v in src.data.vertices) for k in range(3)])
    hi = np.array([max(v.co[k] for v in src.data.vertices) for k in range(3)])
    diag = float(np.linalg.norm(hi - lo))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 4
    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.use_cage = False
    bake.cage_extrusion = 0.03 * diag
    bake.max_ray_distance = 0.08 * diag
    bake.use_pass_direct = False
    bake.use_pass_indirect = False
    bake.use_pass_color = True
    bake.margin = 8
    # A DIFFUSE colour pass reads metal as black, and TRELLIS drives Metallic
    # from a map (the imp's sits near 1.0): bake the base colour as dielectric.
    for m in src.data.materials:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            for link in list(b.inputs["Metallic"].links):
                m.node_tree.links.remove(link)
            b.inputs["Metallic"].default_value = 0.0
    for o in scene.objects:
        o.select_set(o in (src, low))
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type="DIFFUSE")
    img.pack()

    low.name = low.data.name = os.path.splitext(os.path.basename(a.low))[0]
    export_glb(low, a.low)
    print("rebuilt", len(low.data.polygons), "triangles ->", a.low)


a = args()
export_stage(a) if a.stage == "export" else rebuild_stage(a)
