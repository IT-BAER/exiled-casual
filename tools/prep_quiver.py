"""Build the back quiver donor, `quiver-3000-v1.glb`, beside the held weapons.

No free BlenderKit quiver exists (searched "quiver", "quiver arrows", "arrow",
"archery": every quiver hit is the quiver TREE), so the tube is lathed off a
profile and dressed in BlenderKit "Aged Dark Leather"
(d583c044-b586-4ecf-b3a1-12de1d032b3f, royalty_free), the arrow shafts in
"Wood Grain" (8903140f-d18e-4536-a2f6-19e8d329e83e, cc_zero, PBRPX).

Donor contract read by `fit_back_quiver` in `tools/build_wardrobe.py`: one mesh,
one material, long axis +Z with the mouth at +Z, the strap side (the side that
lies on the wearer) toward +Y, the tube's foot at z 0. Metres at a 1.8 m body.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_quiver.py
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prep_held_weapons as P  # noqa: E402  (helpers only; its builds are guarded)

STEM = "quiver-3000-v1"
SIDES = 20
TUBE_LEN = 0.42
MOUTH_DEPTH = 0.025          # arrow bed below the rim
LEATHER_TILE = 0.22          # metres of leather per texture repeat
LEATHER_LIFT = 1.8           # the bow wrap's lift: the raw plate is near black
BAND_LIFT = 0.9
INTERIOR = (0.025, 0.018, 0.012)
FEATHER = (0.78, 0.74, 0.66)
COCK_FEATHER = (0.42, 0.07, 0.05)
NOCK = (0.06, 0.05, 0.045)
WOOD_TINT = (0.62, 0.48, 0.34)
SHAFT_R = 0.0045
SHAFT_SIDES = 6

# (z, r, material of the segment that starts here) up the outside, over the rim
# and down to the arrow bed. 0 leather, 1 band, 2 interior.
L = TUBE_LEN
MD = MOUTH_DEPTH
PROFILE = [
    (0.000, 0.000, 1), (0.004, 0.024, 1), (0.012, 0.036, 1), (0.024, 0.041, 1),
    (0.036, 0.042, 1), (0.037, 0.045, 1), (0.078, 0.045, 1), (0.079, 0.042, 0),
    (0.14, 0.043, 0), (0.22, 0.045, 0), (0.30, 0.047, 0), (L - 0.04, 0.049, 1),
    (L - 0.039, 0.053, 1), (L - 0.006, 0.054, 1), (L, 0.054, 1), (L, 0.048, 2),
    (L - MD, 0.048, 2), (L - MD, 0.0, 2),
]

# Arrows: (x, y) in the mouth, height above the rim, splay in degrees and its heading.
ARROWS = [
    (0.000, 0.000, 0.245, 1.0, 0), (0.024, 0.006, 0.225, 3.0, 15),
    (-0.022, 0.010, 0.230, 3.5, 160), (0.006, -0.024, 0.205, 4.0, 265),
    (-0.010, 0.026, 0.238, 2.5, 100), (0.026, -0.016, 0.200, 4.5, 320),
    (-0.026, -0.014, 0.218, 4.0, 210), (0.012, 0.028, 0.212, 3.0, 60),
]
VANE_LEN = 0.085
VANE_H = 0.017
VANE_T = 0.0018
NOCK_LEN = 0.014
# The strap's run down the strap side (+Y), band to band, standing proud of the tube.
STRAP = ((0.06, 0.046), (L - 0.02, 0.055))   # (z, y) at its foot and its head
STRAP_W = 0.036
STRAP_T = 0.004


def lathe(bm, uv):
    rings = []
    for z, r, _ in PROFILE:
        if r == 0.0:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z))
                          for a in (2 * math.pi * s / SIDES for s in range(SIDES))])
    # Arc length down the profile is the texture's v, so the leather runs on.
    arc = [0.0]
    for (z0, r0, _), (z1, r1, _) in zip(PROFILE, PROFILE[1:]):
        arc.append(arc[-1] + math.hypot(z1 - z0, r1 - r0))
    circ = 2 * math.pi * 0.047 / LEATHER_TILE
    for i in range(len(PROFILE) - 1):
        a, b = rings[i], rings[i + 1]
        va, vb = arc[i] / LEATHER_TILE, arc[i + 1] / LEATHER_TILE
        for s in range(SIDES):
            s1 = (s + 1) % SIDES
            u0, u1, um = s / SIDES * circ, (s + 1) / SIDES * circ, (s + 0.5) / SIDES * circ
            if len(a) == 1:
                corners = ((a[0], um, va), (b[s1], u1, vb), (b[s], u0, vb))
            elif len(b) == 1:
                corners = ((a[s], u0, va), (a[s1], u1, va), (b[0], um, vb))
            else:
                corners = ((a[s], u0, va), (a[s1], u1, va), (b[s1], u1, vb), (b[s], u0, vb))
            f = bm.faces.new([c[0] for c in corners])
            f.material_index = PROFILE[i][2]
            for loop, (_, u, v) in zip(f.loops, corners):
                loop[uv].uv = (u, v)


def prism(bm, uv, outline, normal, thickness, mat):
    """Extrude a planar convex outline along `normal` into a closed slab."""
    half = normal * (thickness / 2)
    lo = [bm.verts.new(p - half) for p in outline]
    hi = [bm.verts.new(p + half) for p in outline]
    faces = [bm.faces.new(list(reversed(lo))), bm.faces.new(hi)]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    for f in faces:
        f.material_index = mat
        for loop in f.loops:
            loop[uv].uv = (0.5, 0.5)
    return faces


def arrow(bm, uv, x, y, above, splay, heading, cock):
    h = math.radians(heading)
    lean = Vector((math.cos(h), math.sin(h), 0.0)) * math.sin(math.radians(splay))
    axis = (Vector((0, 0, 1)) + lean).normalized()
    base = Vector((x, y, L - MOUTH_DEPTH - 0.01))
    tip = Vector((x, y, L)) + axis * above
    side = axis.cross(Vector((1, 0, 0))).normalized()
    up = axis.cross(side).normalized()
    # Shaft: a hexagonal tube, base to the nock.
    shaft_top = tip - axis * NOCK_LEN
    rings = []
    for c in (base, shaft_top):
        rings.append([bm.verts.new(c + side * (SHAFT_R * math.cos(a)) + up * (SHAFT_R * math.sin(a)))
                      for a in (2 * math.pi * k / SHAFT_SIDES for k in range(SHAFT_SIDES))])
    length = (shaft_top - base).length
    # Its foot stands in the solid under the arrow bed, so only the top is capped.
    faces = [bm.faces.new(rings[1])]
    for k in range(SHAFT_SIDES):
        k1 = (k + 1) % SHAFT_SIDES
        f = bm.faces.new((rings[0][k], rings[0][k1], rings[1][k1], rings[1][k]))
        for loop, (u, v) in zip(f.loops, ((k, 0), (k + 1, 0), (k + 1, length), (k, length))):
            loop[uv].uv = (u / SHAFT_SIDES * 0.05, v / 0.25)
        f.material_index = 3
        faces.append(f)
    for f in faces[:1]:
        f.material_index = 3
        for loop in f.loops:
            loop[uv].uv = (0.0, 0.0)
    # Nock: a square cap a little wider than the shaft.
    nr = SHAFT_R * 1.25
    outline = [shaft_top + side * (nr * math.cos(a)) + up * (nr * math.sin(a))
               for a in (math.pi / 4 + k * math.pi / 2 for k in range(4))]
    lo = [bm.verts.new(p) for p in outline]
    hi = [bm.verts.new(p + axis * NOCK_LEN) for p in outline]
    # Open underneath: the shaft's cap closes it, and a second face there is hidden.
    for f in [bm.faces.new(hi)] + [
            bm.faces.new((lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i])) for i in range(4)]:
        f.material_index = 6
        for loop in f.loops:
            loop[uv].uv = (0.0, 0.0)
    # Three vanes at 120 degrees, the cock vane dyed.
    top = shaft_top - axis * 0.012
    for k in range(3):
        a = 2 * math.pi * k / 3 + h
        out = side * math.cos(a) + up * math.sin(a)
        normal = axis.cross(out).normalized()
        r0 = SHAFT_R * 0.6
        outline = [
            top + out * r0,
            top + out * (r0 + VANE_H) - axis * 0.012,
            top - axis * VANE_LEN + out * (r0 + VANE_H * 0.45),
            top - axis * (VANE_LEN + 0.006) + out * r0,
        ]
        prism(bm, uv, outline, normal, VANE_T, 5 if (k == 0 and cock) else 4)


def build():
    P.clear()
    leather_lib = P.append("mat-aged-dark-leather.blend", images=["Aged Dark Leather_Color.jpg"])
    leather_img = leather_lib.images[0]
    wood = P.append("mat-wood-grain.blend", materials=["Wood Grain"]).materials[0]

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("src")
    lathe(bm, uv)
    (z0, y0), (z1, y1) = STRAP
    hw = STRAP_W / 2
    for f in prism(bm, uv, [Vector((-hw, y0, z0)), Vector((hw, y0, z0)),
                            Vector((hw, y1, z1)), Vector((-hw, y1, z1))],
                   Vector((0, 1, 0)), STRAP_T, 1):
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = ((co.x + co.y) / LEATHER_TILE, co.z / LEATHER_TILE)
    for i, (x, y, above, splay, heading) in enumerate(ARROWS):
        arrow(bm, uv, x, y, above, splay, heading, cock=i % 3 != 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("quiver")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("quiver", me)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = p.material_index in (0, 1, 3)

    def flat(name):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        return m

    tube, band, inner = flat("quiver_leather"), flat("quiver_band"), flat("quiver_inner")
    feather, cock, nock = flat("quiver_feather"), flat("quiver_cock"), flat("quiver_nock")
    for m in (tube, band, inner, wood, feather, cock, nock):
        me.materials.append(m)
    P.decimate_to(obj, P.BUDGET)

    def leather(mat, lift):
        t = mat.node_tree
        tex = P.node(t, "ShaderNodeTexImage", image=leather_img)
        src = P.node(t, "ShaderNodeUVMap", uv_map="src")
        t.links.new(tex.inputs["Vector"], src.outputs["UV"])
        mul = P.node(t, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        mul.inputs["Factor"].default_value = 1.0
        t.links.new(mul.inputs[6], tex.outputs["Color"])
        mul.inputs[7].default_value = (lift, lift, lift, 1.0)
        P.emit_into(mat, mul.outputs[2])

    def colour(mat, src):
        t = mat.node_tree
        if src is tube:
            leather(mat, LEATHER_LIFT)
        elif src is band:
            leather(mat, BAND_LIFT)
        elif src is wood:
            tint = P.node(t, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
            tint.inputs["Factor"].default_value = 1.0
            t.links.new(tint.inputs[6], t.nodes["Image Texture"].outputs["Color"])
            tint.inputs[7].default_value = WOOD_TINT + (1.0,)
            src_uv = P.node(t, "ShaderNodeUVMap", uv_map="src")
            t.links.new(t.nodes["Mapping"].inputs["Vector"], src_uv.outputs["UV"])
            P.emit_into(mat, tint.outputs[2])
        else:
            P.emit_into(mat, colour={inner.name: INTERIOR, feather.name: FEATHER,
                                     cock.name: COCK_FEATHER, nock.name: NOCK}[src.name])

    def orm(mat, src):
        rough = {tube.name: P.LEATHER_ROUGHNESS, band.name: P.LEATHER_ROUGHNESS,
                 wood.name: 0.6}.get(src.name, 0.9)
        P.emit_into(mat, colour=(1.0, rough, 0.0))

    P.finish(obj, STEM, [("colour", colour, "sRGB"), ("orm", orm, "Non-Color")])


build()
