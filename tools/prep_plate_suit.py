"""Strip the sliver components out of the generated plate-suit donor.

TRELLIS leaves fourteen stray shells of 18 vertices or fewer around the three
real ones (cuirass with its pauldrons and sleeves, and two loose plates). They
carry no silhouette and they poison every measurement the fit makes off the
donor's bbox, so they are deleted here rather than worked around downstream.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_plate_suit.py
"""

import json
import os

import bmesh
import bpy

SRC = "D:/VSC/exiled-casual/review/3d/plate-suit-v1/plate-suit-15k-v1.glb"
OUT = "D:/VSC/exiled-casual/assets/props/source/trellis_local/plate-suit-15k-v1.glb"
# Every real shell of this donor runs to thousands of vertices and every sliver
# to eighteen or fewer, so the line is drawn wide of both.
SLIVER_VERTS = 30


def key_of(point):
    return (round(point.x, 6), round(point.y, 6), round(point.z, 6))


def components(bm):
    seen = set()
    out = []
    for v in bm.verts:
        if v in seen:
            continue
        stack, comp = [v], set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.add(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o not in seen:
                    stack.append(o)
        out.append(comp)
    return out


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"expected one mesh in {SRC}, got {[o.name for o in meshes]}")
    obj = meshes[0]

    # Components are counted on a WELDED copy and the deletion is carried back
    # by position. The exported donor splits a vertex at every UV seam, so its
    # raw connectivity is a thousand fragments and no size threshold separates
    # a sliver from a seam - but the shells themselves stay disjoint under the
    # weld, so the copy answers the question the original cannot.
    probe = bmesh.new()
    probe.from_mesh(obj.data)
    bmesh.ops.remove_doubles(probe, verts=probe.verts, dist=1e-5)
    comps = components(probe)
    sizes = sorted((len(c) for c in comps), reverse=True)
    doomed_at = {key_of(v.co) for c in comps if len(c) <= SLIVER_VERTS for v in c}
    probe.free()
    if sum(1 for s in sizes if s > SLIVER_VERTS) != 3:
        raise SystemExit(f"expected three real shells, found sizes {sizes}")

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    doomed = [v for v in bm.verts if key_of(v.co) in doomed_at]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    check = bmesh.new()
    check.from_mesh(obj.data)
    bmesh.ops.remove_doubles(check, verts=check.verts, dist=1e-5)
    kept = len(components(check))
    check.free()
    if kept != 3:
        raise SystemExit(f"stripping left {kept} shells, not three (sizes {sizes})")

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=False)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(json.dumps({
        "input": SRC, "output": OUT, "bytes": os.path.getsize(OUT),
        "components_in": len(comps), "components_out": kept,
        "component_sizes": sizes[:20], "stripped_vertices": len(doomed),
        "vertices": len(obj.data.vertices), "triangles": tris,
    }, indent=1))


if __name__ == "__main__":
    main()
