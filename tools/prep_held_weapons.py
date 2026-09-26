"""Build the two starter held weapons' donors: the Ironsworn hammer and the Stalker bow.

Both land in `assets/props/source/trellis_local/` beside the wand, in the donor
contract `fit_held` in `tools/build_wardrobe.py` reads: one mesh, one material,
long axis +Z with the business end at +Z, the face that has a direction (the
hammer's striking face, the bow's string) toward +X, and the point the fist
closes on at the origin.

* Hammer: BlenderKit "War Hammer" (87df6fbd-71db-4acb-a3f5-ff32f16938b7,
  royalty_free, Avishka Induwara). It ships as a two-handed maul, a 66 cm iron
  block on a 41 cm haft, so the head is shrunk about the haft's mouth and the
  haft thinned to a fist: a one-handed forge hammer, PoE1's Stone Hammer shape.
* Bow: built here. Neither BlenderKit bow is a plain hunting bow (the bone bow's
  spikes and vertebra flares are part of its limb surface, the Elvan bow is horns
  and crystals), so the stave is swept off a braced-bow centreline and dressed
  in BlenderKit "Wood Grain" (8903140f-d18e-4536-a2f6-19e8d329e83e, cc_zero,
  PBRPX), with a grip wrap in the wardrobe's "Aged Dark Leather"
  (d583c044-b586-4ecf-b3a1-12de1d032b3f, royalty_free).

Every source surface is baked, colour and metal/roughness, into one 512 atlas
over a smart-projected UV, so each weapon is a single glTF primitive.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_held_weapons.py
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

SOURCE = "D:/VSC/exiled-casual/assets/props/source/"
OUT_DIR = SOURCE + "trellis_local/"
BUDGET = 3000            # triangles, the wand's class
ATLAS = 512
BAKE_MARGIN = 4          # pixels of island bleed

# The maul's own measurements (source metres): the haft's leather runs from the
# head's mouth at z 0.344 to 0.758 and is 36 mm across.
HAMMER_MOUTH_Z = 0.344
HAMMER_HEAD_SCALE = 0.36     # 66 cm head -> 24 cm, ~0.4 of the whole length
HAMMER_HAFT_THIN = 0.8       # 36 mm haft -> 29 mm, the fist the wand is sized for
HAMMER_GRIP_AT = 0.2         # fist centre, fraction of the length up from the butt
# Linear albedo the head's grunge map is ramped between: forged iron, not the
# source's 6% black that renders as a hole without an environment to reflect.
IRON_DARK = (0.07, 0.07, 0.075)
IRON_LIGHT = (0.22, 0.21, 0.2)
IRON_METALLIC = 0.6
LEATHER_ROUGHNESS = 0.8

# The stave, in metres at a 1.8 m body (the fitter rescales to its own ratio).
BOW_LEN = 1.15
BOW_BRACE = 0.15             # grip to string
BOW_RECURVE = 0.035          # how far the last of each limb curls away from the string
BOW_RISER = 0.12             # |t| under this is the straight riser
BOW_WRAP = 0.085             # |t| under this is leather
BOW_RINGS = 30               # per limb
BOW_SIDES = 8
BOW_STRING_R = 0.0025
WOOD_TINT = (0.55, 0.42, 0.32)   # light oak -> a worn brown stave
WOOD_TILE = 0.25             # metres of stave per texture repeat along the grain
STRING_COLOUR = (0.55, 0.5, 0.4)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def append(blend, names=None, images=None, materials=None):
    with bpy.data.libraries.load(SOURCE + blend, link=False) as (src, dst):
        dst.objects = list(names) if names is not None else []
        dst.images = list(images or [])
        dst.materials = list(materials or [])
    for obj in dst.objects:
        bpy.context.scene.collection.objects.link(obj)
    # A library-loaded object answers matrix_world as identity until this.
    bpy.context.view_layer.update()
    return dst


def evaluated_copy(obj, name):
    """The mesh with its modifiers applied and its world transform baked in."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True,
                                         depsgraph=dg)
    me.transform(obj.matrix_world)
    out = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(out)
    return out


def decimate_to(obj, target):
    if tris(obj) <= target:
        return
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.use_collapse_triangulate = True
    mod.ratio = target / tris(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def node(tree, kind, **props):
    n = tree.nodes.new(kind)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def emit_into(mat, colour_socket=None, colour=None):
    """Point the material's output at an emission of `colour_socket` (or a constant)."""
    tree = mat.node_tree
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    em = node(tree, "ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    if colour_socket is not None:
        tree.links.new(em.inputs["Color"], colour_socket)
    else:
        em.inputs["Color"].default_value = tuple(colour) + (1.0,)
    tree.links.new(out.inputs["Surface"], em.outputs["Emission"])


def atlas_uv(obj):
    uv = obj.data.uv_layers.new(name="atlas")
    obj.data.uv_layers.active = uv
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    return uv


def bake(obj, name, passes):
    """Bake each pass (a callable dressing every material for emission) into its own image.

    The source textures read the active RENDER uv layer; the bake writes into the
    active one, which is the atlas.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 4
    scene.render.bake.margin = BAKE_MARGIN
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    originals = [m for m in obj.data.materials]
    images = {}
    for label, dress, colourspace in passes:
        img = bpy.data.images.new(f"{name}_{label}", ATLAS, ATLAS, alpha=False)
        img.colorspace_settings.name = colourspace
        for i, src in enumerate(originals):
            mat = src.copy()
            mat.name = f"{src.name}__{label}"
            dress(mat, src)
            tex = node(mat.node_tree, "ShaderNodeTexImage", image=img)
            mat.node_tree.nodes.active = tex
            tex.select = True
            obj.data.materials[i] = mat
        bpy.ops.object.bake(type="EMIT")
        images[label] = img
    for i, src in enumerate(originals):
        obj.data.materials[i] = src
    return images


def save_jpeg(img, path):
    img.file_format = "JPEG"
    img.save(filepath=path, quality=90)
    return bpy.data.images.load(path)


def final_material(name, colour, orm):
    """One glTF metallic-roughness material over the two baked atlases."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]
    col = node(tree, "ShaderNodeTexImage", image=colour)
    tree.links.new(bsdf.inputs["Base Color"], col.outputs["Color"])
    orm.colorspace_settings.name = "Non-Color"
    rm = node(tree, "ShaderNodeTexImage", image=orm)
    sep = node(tree, "ShaderNodeSeparateColor")
    tree.links.new(sep.inputs["Color"], rm.outputs["Color"])
    tree.links.new(bsdf.inputs["Roughness"], sep.outputs["Green"])
    tree.links.new(bsdf.inputs["Metallic"], sep.outputs["Blue"])
    return mat


def finish(obj, stem, passes):
    """Atlas, bake, collapse to one material, export as a donor."""
    atlas_uv(obj)
    images = bake(obj, stem, passes)
    colour = save_jpeg(images["colour"], OUT_DIR + f"{stem}_colour.jpg")
    orm = save_jpeg(images["orm"], OUT_DIR + f"{stem}_orm.jpg")
    for uv in [u for u in obj.data.uv_layers if u.name != "atlas"]:
        obj.data.uv_layers.remove(uv)
    obj.data.materials.clear()
    obj.data.materials.append(final_material(stem, colour, orm))
    obj.data.name = obj.name = stem
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    path = OUT_DIR + f"{stem}.glb"
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_image_format="AUTO",
                              export_cameras=False, export_lights=False)
    for p in (colour.filepath, orm.filepath):
        os.remove(bpy.path.abspath(p))
    lo = Vector([min(v.co[i] for v in obj.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in obj.data.vertices) for i in range(3)])
    print(f"wrote {path}: {tris(obj)} tris, {len(obj.data.vertices)} verts, "
          f"dims {tuple(round(c, 4) for c in hi - lo)}, {os.path.getsize(path) // 1024} KB")


# --------------------------------------------------------------------------
# hammer

def build_hammer():
    clear()
    dst = append("war_hammer.blend", names=["War Hammer", "Hammer"])
    src = next(o for o in dst.objects if o.type == "MESH")
    obj = evaluated_copy(src, "hammer")
    for o in dst.objects:
        bpy.data.objects.remove(o, do_unlink=True)
    me = obj.data
    leather = me.materials.find("Leather J1")
    metal = me.materials.find("Grunge Metal")
    if leather < 0 or metal < 0:
        raise SystemExit(f"unexpected hammer materials {[m.name for m in me.materials]}")
    haft = {v for p in me.polygons if p.material_index == leather for v in p.vertices}
    mouth = Vector((0.0, 0.0, HAMMER_MOUTH_Z))
    for v in me.vertices:
        if v.index in haft or v.co.z > HAMMER_MOUTH_Z + 0.05:
            # The haft and the butt cap: thinner, not shorter.
            v.co.x *= HAMMER_HAFT_THIN
            v.co.y *= HAMMER_HAFT_THIN
        else:
            v.co = mouth + (v.co - mouth) * HAMMER_HEAD_SCALE
    # Head at +Z: turned over about X, which keeps the head's long axis on X.
    me.transform(Matrix.Rotation(math.pi, 4, "X"))
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    me.transform(Matrix.Translation((0.0, 0.0, -(lo + (hi - lo) * HAMMER_GRIP_AT))))
    me.update()
    decimate_to(obj, BUDGET)

    def colour(mat, src):
        t = mat.node_tree
        if src.name == "Grunge Metal":
            ramp = node(t, "ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].color = IRON_DARK + (1.0,)
            ramp.color_ramp.elements[1].color = IRON_LIGHT + (1.0,)
            t.links.new(ramp.inputs["Fac"], t.nodes["Image Texture.002"].outputs["Color"])
            emit_into(mat, ramp.outputs["Color"])
        else:
            emit_into(mat, t.nodes["Image Texture"].outputs["Color"])

    def orm(mat, src):
        t = mat.node_tree
        if src.name == "Grunge Metal":
            comb = node(t, "ShaderNodeCombineColor")
            comb.inputs["Red"].default_value = 1.0
            comb.inputs["Blue"].default_value = IRON_METALLIC
            t.links.new(comb.inputs["Green"], t.nodes["Map Range"].outputs["Result"])
            emit_into(mat, comb.outputs["Color"])
        else:
            emit_into(mat, colour=(1.0, LEATHER_ROUGHNESS, 0.0))

    finish(obj, f"hammer-{BUDGET}-v1", [("colour", colour, "sRGB"), ("orm", orm, "Non-Color")])


# --------------------------------------------------------------------------
# bow

def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def stave_point(t):
    """Centreline in the XZ plane, t in -1..1; the string side is +X."""
    a = abs(t)
    bend = max(0.0, a - BOW_RISER) / (1 - BOW_RISER)
    x = BOW_BRACE * bend ** 1.6 - BOW_RECURVE * smooth(0.82, 1.0, a) ** 2
    return Vector((x, 0.0, t * BOW_LEN / 2))


def stave_section(t):
    """(half-width across the stave, half-thickness in the bow's plane)."""
    a = abs(t)
    riser = 1 - smooth(BOW_RISER * 0.6, BOW_RISER * 1.6, a)
    limb = 1 - smooth(BOW_RISER, 1.0, a)
    w = 0.009 + 0.013 * limb + 0.004 * riser
    h = 0.0065 + 0.0075 * limb + 0.007 * riser
    if a < BOW_WRAP:
        w, h = w + 0.0015, h + 0.0015
    return w, h


def build_bow():
    clear()
    dst = append("mat-wood-grain.blend", materials=["Wood Grain"])
    wood = dst.materials[0]
    leather_lib = append("mat-aged-dark-leather.blend", images=["Aged Dark Leather_Color.jpg"])
    leather_img = leather_lib.images[0]

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("stave")
    n = BOW_RINGS * 2
    ts = [-1 + 2 * i / n for i in range(n + 1)]
    rings, arc = [], [0.0]
    for i, t in enumerate(ts):
        c = stave_point(t)
        tangent = (stave_point(min(1, t + 1e-3)) - stave_point(max(-1, t - 1e-3))).normalized()
        normal = Vector((tangent.z, 0.0, -tangent.x))
        w, h = stave_section(t)
        ring = []
        for s in range(BOW_SIDES):
            a = 2 * math.pi * s / BOW_SIDES
            ring.append(bm.verts.new(c + normal * (h * math.cos(a)) + Vector((0, 1, 0)) * (w * math.sin(a))))
        rings.append(ring)
        if i:
            arc.append(arc[-1] + (c - stave_point(ts[i - 1])).length)
    faces = []
    for i in range(n):
        wrap = abs((ts[i] + ts[i + 1]) / 2) < BOW_WRAP
        for s in range(BOW_SIDES):
            s1 = (s + 1) % BOW_SIDES
            f = bm.faces.new((rings[i][s], rings[i][s1], rings[i + 1][s1], rings[i + 1][s]))
            f.material_index = 1 if wrap else 0
            # Grain runs down the texture's v, so v follows the stave.
            for loop, (u, v) in zip(f.loops, ((s, arc[i]), (s + 1, arc[i]), (s + 1, arc[i + 1]),
                                             (s, arc[i + 1]))):
                loop[uv_layer].uv = (u / BOW_SIDES * 0.3, v / WOOD_TILE)
            faces.append(f)
    # Nocks: each end closed to a point just past the last ring.
    for end, sign in ((rings[0], -1), (rings[-1], 1)):
        tip = bm.verts.new(stave_point(sign) + Vector((0, 0, sign * 0.012)))
        for s in range(BOW_SIDES):
            a, b = end[s], end[(s + 1) % BOW_SIDES]
            f = bm.faces.new((a, b, tip) if sign > 0 else (b, a, tip))
            for loop in f.loops:
                loop[uv_layer].uv = (0.0, 0.0)
    # The string, a thin square tube from nock to nock on the belly side.
    top, bottom = stave_point(1) + Vector((0.004, 0, 0)), stave_point(-1) + Vector((0.004, 0, 0))
    ends = []
    for p in (bottom, top):
        ends.append([bm.verts.new(p + Vector((BOW_STRING_R * math.cos(a), BOW_STRING_R * math.sin(a), 0)))
                     for a in (i * math.pi / 2 for i in range(4))])
    for s in range(4):
        f = bm.faces.new((ends[0][s], ends[0][(s + 1) % 4], ends[1][(s + 1) % 4], ends[1][s]))
        f.material_index = 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("bow")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("bow", me)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = p.material_index != 2
    wrap_mat = bpy.data.materials.new("bow_wrap")
    wrap_mat.use_nodes = True
    string_mat = bpy.data.materials.new("bow_string")
    string_mat.use_nodes = True
    for m in (wood, wrap_mat, string_mat):
        me.materials.append(m)
    decimate_to(obj, BUDGET)

    def colour(mat, src):
        t = mat.node_tree
        if src is wood:
            tint = node(t, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
            tint.inputs["Factor"].default_value = 1.0
            t.links.new(tint.inputs[6], t.nodes["Image Texture"].outputs["Color"])
            tint.inputs[7].default_value = WOOD_TINT + (1.0,)
            # The material's own mapping reads generated coordinates; the stave's uv is the grain.
            uv = node(t, "ShaderNodeUVMap", uv_map="stave")
            t.links.new(t.nodes["Mapping"].inputs["Vector"], uv.outputs["UV"])
            emit_into(mat, tint.outputs[2])
        elif src is wrap_mat:
            tex = node(t, "ShaderNodeTexImage", image=leather_img)
            uv = node(t, "ShaderNodeUVMap", uv_map="stave")
            mapping = node(t, "ShaderNodeMapping")
            mapping.inputs["Scale"].default_value = (4.0, 0.6, 1.0)
            t.links.new(mapping.inputs["Vector"], uv.outputs["UV"])
            t.links.new(tex.inputs["Vector"], mapping.outputs["Vector"])
            lift = node(t, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
            lift.inputs["Factor"].default_value = 1.0
            t.links.new(lift.inputs[6], tex.outputs["Color"])
            lift.inputs[7].default_value = (1.8, 1.8, 1.8, 1.0)
            emit_into(mat, lift.outputs[2])
        else:
            emit_into(mat, colour=STRING_COLOUR)

    def orm(mat, src):
        rough = {wood.name: 0.6, wrap_mat.name: LEATHER_ROUGHNESS}.get(src.name, 0.9)
        emit_into(mat, colour=(1.0, rough, 0.0))

    finish(obj, f"bow-{BUDGET}-v1", [("colour", colour, "sRGB"), ("orm", orm, "Non-Color")])


if __name__ == "__main__":
    build_hammer()
    build_bow()
