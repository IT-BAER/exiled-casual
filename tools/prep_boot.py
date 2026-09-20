"""Strip a generated boot down to its outer shell.

An image-to-3D boot arrives with a cavity modelled behind its open top, and the
fitter measures skin against the INNER wall - the nearest surface, and the one
whose normal faces the leg. A decoded cavity is not the boot's inside: it stops
short of the toe, so the foot stands against its floor and ceiling and no ratio
clears them. Nothing inside a worn boot is ever seen, so every face no ray can
escape from is dropped and the wall is rebuilt as a thin, even offset of the
outer shell, which is what the fitter reads a boot to be.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_boot.py -- <in.glb> <out.glb> [yaw_degrees]
"""

import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# Rays leaving each face in every direction: a face is outside when any one of
# them escapes the mesh. A fold on the outer surface still has an open cone
# above it; the walls of a cavity have none. The whole sphere, not the normal's
# hemisphere: a decoded shell does not promise which way its normals point.
RAYS = 96
EPS = 1e-4
# The rebuilt wall, in the donor's own units (a boot is about one unit tall and
# is worn at about half that): three millimetres of leather.
WALL = 0.006
# The floor is the one wall that stays paper-thin: the foot is seated ON the
# outer sole, so a floor one wall up is a surface the toes stand inside, and no
# floor at all lets a ray out of the foot's lower edge leave through the sole.
SOLE_WALL = 0.0005
SOLE_FACING = -0.5


def sphere(count):
    """Evenly spread unit directions, a Fibonacci sphere."""
    golden = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(count):
        z = 1 - 2 * (i + 0.5) / count
        r = math.sqrt(1 - z * z)
        out.append(Vector((math.cos(golden * i) * r, math.sin(golden * i) * r, z)))
    return out


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    src, dst = args[0], args[1]
    yaw = float(args[2]) if len(args) > 2 else 0.0
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    obj = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
    if yaw:
        obj.data.transform(Matrix.Rotation(math.radians(yaw), 4, "Z"))
        obj.data.update()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table()
    verts = [v.co.copy() for v in bm.verts]
    tris = [[v.index for v in f.verts] for f in bm.faces]
    bvh = BVHTree.FromPolygons(verts, tris)
    dirs = sphere(RAYS)
    hidden = []
    inward = []
    for f in bm.faces:
        c = f.calc_center_median()
        escapes = [d for d in dirs if bvh.ray_cast(c + d * EPS, d)[0] is None]
        if not escapes:
            hidden.append(f)
            continue
        # A decoded shell promises nothing about which way a face points, so
        # each one faces the side more of its rays escape from.
        if sum(1 for d in escapes if d.dot(f.normal) < 0) > len(escapes) / 2:
            inward.append(f)
    print(f"faces {len(bm.faces)}, outside {len(bm.faces) - len(hidden)}, interior {len(hidden)}, "
          f"flipped {len(inward)}")
    bmesh.ops.delete(bm, geom=hidden, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.reverse_faces(bm, faces=inward)
    lo_z = min(v.co.z for v in bm.verts)
    height = max(v.co.z for v in bm.verts) - lo_z
    width = max(v.co.x for v in bm.verts) - min(v.co.x for v in bm.verts)
    outer = list(bm.faces)
    # The inner wall is the outer one carried in along UNIT vertex normals, so a
    # sliver face cannot spike it: `bmesh.ops.solidify` grew this shell by half
    # a boot width at either sign.
    bm.normal_update()
    original = set(bm.verts)
    dup = bmesh.ops.duplicate(bm, geom=outer)
    pairs = [(k, v) if k in original else (v, k) for k, v in dup["vert_map"].items()]
    for old, new in pairs:
        new.co = old.co - old.normal * (SOLE_WALL if old.normal.z < SOLE_FACING else WALL)
    inner = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(bm, faces=inner)
    bm.normal_update()
    grew = max(v.co.x for v in bm.verts) - min(v.co.x for v in bm.verts) - width
    if grew > 1e-6:
        xmin = min(old.co.x for old, _ in pairs)
        xmax = max(old.co.x for old, _ in pairs)
        bad = [(old, new) for old, new in pairs if new.co.x < xmin or new.co.x > xmax]
        for old, new in bad[:12]:
            fn = [tuple(round(c, 2) for c in f.normal) for f in old.link_faces]
            print("   spike", tuple(round(c, 3) for c in old.co), "n", tuple(round(c, 2) for c in old.normal), "faces", len(old.link_faces), fn[:4])
        raise SystemExit(f"the inner wall stands outside the shell by {grew:.5f} at {len(bad)} vertices")
    print(f"wall {WALL}: {len(outer)} outer, {len(inner)} inner, {len(bm.faces)} faces")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True,
                              export_apply=True, export_image_format="AUTO")
    print("wrote", dst)


if __name__ == "__main__":
    main()
