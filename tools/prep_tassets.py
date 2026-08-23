"""Build the fauld-and-tassets donor procedurally.

Image-to-3D returns flakes for a plate skirt: the lames are thin, parallel and
self-occluding, and the decoder reads the stack as noise. A fauld is not a
sculpt though - it is a lathe and a stack, every band a cone of revolution and
every lame an arc of one - so it is authored from those numbers instead, which
makes the overlaps, the laps and the hem radius true by construction.

Metres, Z up, front is -Y, centred on X=0. The wardrobe fitter rescales it.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_tassets.py
"""

import json
import math
import os

import bmesh
import bpy
import numpy
from mathutils import Matrix, Vector

ROOT = "D:/VSC/exiled-casual"
OUT_GLB = ROOT + "/assets/props/source/trellis_local/fauld-proc-v3.glb"
OUT_JSON = ROOT + "/assets/props/source/trellis_local/fauld-proc-v3.json"
REVIEW = ROOT + "/review/3d/fauld-proc-v3"
CUIRASS_GLB = ROOT + "/assets/props/source/trellis_local/plate-cuirass-15k-v2.glb"
MAT_BLEND = ROOT + "/assets/props/source/mat-aged-black-steel.blend"
BLENDERKIT_ID = "8352b3b2-edb7-4700-a9d6-055ab6ec9233"
BLENDERKIT_NAME = "Aged Black Steel"

OBJ_NAME = "fauld"
MAT_NAME = "fauld_steel"

# --- fauld -------------------------------------------------------------------
WAIST_Z = 0.42
WAIST_R = 0.17
# A fauld hangs, it does not stand out: the hem clears the waist by an eighth of
# its own radius, and every flare below is a share of that one number rather
# than a figure of its own, so the skirt cannot drift into a bell by arithmetic.
# At 1.33 it did - 6 cm of air off the thigh all the way down, which the
# wardrobe's median-gap gate reads as a garment that is not being worn.
HEM_RATIO = 1.12
HEM_R = WAIST_R * HEM_RATIO
FLARE = HEM_R - WAIST_R
BAND_H = 0.06
BAND_OVERLAP = 0.012      # a band's top edge sits this far under the one above
BAND_FLARE = FLARE * 0.17   # each band ends this much further out than it starts
# The top band is riveted OUTSIDE the breastplate, the way a real fauld is, so
# it stands proud of the ring below it and the cuirass's bottom rim tucks into
# the shadow of that lip. Without it the two pieces meet edge to edge and a
# strip of hip shows between them from every angle.
TOP_BAND_PROUD = 0.015
BANDS = 3
RING_SEGS = 24
OVAL_X = 1.08             # x radius over y radius

# --- tassets -----------------------------------------------------------------
HEM_Z = 0.0
LAMES = 5
LAME_H = 0.07
LAME_OVERLAP = 0.015
LAME_STEP = FLARE * 0.071   # each lower lame stands this much proud of the one above
LAME_SEGS = 4
LAME_ROWS = 1
# Eight panels on a 45-degree pitch, so one is centred on the front and one on
# the back and the seams fall on the diagonals. At 45 degrees of pitch an arc of
# 75 leaves each panel lapping its neighbour by 15 degrees of plan on either
# side, which is what closes the skirt: a ray out of either thigh meets steel in
# every direction, the crotch included. There is no front, back or side slit -
# the stride is taken up by the laps sliding over one another.
STACK_CENTRES = tuple(45.0 * i for i in range(8))
LAME_ARC_TOP = 75.0       # degrees; the stack widens downward
LAME_ARC_BOTTOM = 81.0
# Neighbouring panels cannot occupy the same shell or they interpenetrate along
# every lap, so alternate ones ride this far out and the rest this far in - the
# over-and-under a real lame skirt is riveted with. It has to beat the plate's
# own thickness by a clear margin: at 4.5 mm the skinning pushed the under
# panel's corners back out through the over panel on every bend, which reads as
# a torn lame rather than a lap.
LAME_ALTERNATE = 0.009

# --- plate -------------------------------------------------------------------
THICKNESS = 0.004
BEVEL_W = 0.0007
BEVEL_SEGS = 1

# --- rivets ------------------------------------------------------------------
RIVET_R = 0.0062
RIVET_SEGS = 5
RIVET_STEP = 0.19         # arc length between rivets
RIVET_INSET = 0.010       # above the lower edge
RIVET_SINK = 0.0008       # base pushed into the plate so the open ring is hidden

TEX_TILE = 3.0            # UV repeats of the 1K steel across the smart-projected atlas

RENDER_RES = 900


# --------------------------------------------------------------------------- #
# maths
# --------------------------------------------------------------------------- #
def ring_point(a, r, z):
    """A point on the oval ring of mean radius r."""
    return Vector((math.cos(a) * r * OVAL_X, math.sin(a) * r, z))


def ring_normal(a):
    n = Vector((math.cos(a) / OVAL_X, math.sin(a) * OVAL_X, 0.0))
    n.normalize()
    return n


def band_extent(i):
    """(top_z, bottom_z, top_r, bottom_r) of fauld band i, 0 at the waist."""
    top_z = WAIST_Z - i * (BAND_H - BAND_OVERLAP)
    proud = TOP_BAND_PROUD if i == 0 else 0.0
    return (top_z, top_z - BAND_H,
            WAIST_R + i * BAND_FLARE + proud, WAIST_R + (i + 1) * BAND_FLARE + proud)


FAULD_BOTTOM_Z = band_extent(BANDS - 1)[1]
FAULD_BOTTOM_R = band_extent(BANDS - 1)[3]


def lame_extent(j):
    """(top_z, bottom_z, top_r, bottom_r, arc_top, arc_bottom) of lame j, 0 topmost."""
    pitch = LAME_H - LAME_OVERLAP
    bottom_z = HEM_Z + (LAMES - 1 - j) * pitch
    top_z = bottom_z + LAME_H
    # base cone runs from the hem up to where the fauld's last band ends
    span = (LAMES - 1) * pitch + LAME_H
    base_hem = HEM_R - (LAMES - 1) * LAME_STEP

    def base_r(z):
        t = min(max(z / span, 0.0), 1.0)
        return base_hem + (FAULD_BOTTOM_R - base_hem) * t

    step = (LAMES - 1 - j) * LAME_STEP
    frac_t = 1.0 - top_z / span
    frac_b = 1.0 - bottom_z / span
    arc = lambda f: math.radians(LAME_ARC_TOP + (LAME_ARC_BOTTOM - LAME_ARC_TOP) * f)
    return (top_z, bottom_z, base_r(top_z) + step, base_r(bottom_z) + step,
            arc(frac_t), arc(frac_b))


# --------------------------------------------------------------------------- #
# geometry
# --------------------------------------------------------------------------- #
def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def strip(bm, a0, a1, segs, rows, z_top, z_bot, r_top, r_bot, closed):
    """A conical strip. Angle index runs +theta, row index runs +z, so the
    quad winding gives an outward normal without a recalc."""
    cols = segs if closed else segs + 1
    verts = []
    for i in range(cols):
        f = i / segs
        a = a0 + (a1 - a0) * f
        col = []
        for j in range(rows + 1):
            t = j / rows
            col.append(bm.verts.new(ring_point(a, r_bot + (r_top - r_bot) * t,
                                               z_bot + (z_top - z_bot) * t)))
        verts.append(col)
    for i in range(segs):
        i2 = (i + 1) % cols
        for j in range(rows):
            bm.faces.new((verts[i][j], verts[i2][j], verts[i2][j + 1], verts[i][j + 1]))
    return verts


def plate(name, a0, a1, segs, rows, z_top, z_bot, r_top, r_bot, closed):
    bm = bmesh.new()
    strip(bm, a0, a1, segs, rows, z_top, z_bot, r_top, r_bot, closed)
    ob = new_object(name, bm)
    m = ob.modifiers.new("solid", 'SOLIDIFY')
    m.thickness = THICKNESS
    m.offset = 1.0          # grow inward, keep the authored surface as the outside
    m.use_even_offset = True
    b = ob.modifiers.new("bevel", 'BEVEL')
    b.width = BEVEL_W
    b.segments = BEVEL_SEGS
    b.limit_method = 'ANGLE'
    b.angle_limit = math.radians(30.0)
    return ob


def rivet(bm, pos, normal):
    """A low dome sitting on the plate, its open base sunk out of sight."""
    up = normal.normalized()
    ref = Vector((0.0, 0.0, 1.0))
    tx = ref.cross(up)
    if tx.length < 1e-6:
        tx = Vector((1.0, 0.0, 0.0))
    tx.normalize()
    ty = up.cross(tx)
    base = pos - up * RIVET_SINK

    def p(rad, h):
        return base + tx * rad.x + ty * rad.y + up * h

    rings = []
    for radius, h in ((RIVET_R, 0.0), (RIVET_R * 0.85, RIVET_R * 0.55)):
        ring = []
        for i in range(RIVET_SEGS):
            a = 2.0 * math.pi * i / RIVET_SEGS
            ring.append(bm.verts.new(p(Vector((math.cos(a) * radius,
                                               math.sin(a) * radius)), h)))
        rings.append(ring)
    apex = bm.verts.new(base + up * (RIVET_R * 0.9))
    lo, hi = rings
    for i in range(RIVET_SEGS):
        k = (i + 1) % RIVET_SEGS
        bm.faces.new((lo[i], lo[k], hi[k], hi[i]))
        bm.faces.new((hi[i], hi[k], apex))


def rivet_run(bm, a0, a1, r, z, closed):
    """Rivets spaced along an arc at height z."""
    span = abs(a1 - a0) * r
    n = max(2, int(round(span / RIVET_STEP)))
    for i in range(n if closed else n + 1):
        f = i / n if not closed else i / n
        a = a0 + (a1 - a0) * f
        rivet(bm, ring_point(a, r, z), ring_normal(a))


def build():
    parts = []

    for i in range(BANDS):
        z_top, z_bot, r_top, r_bot = band_extent(i)
        parts.append(plate("band%d" % i, 0.0, 2.0 * math.pi, RING_SEGS, 1,
                           z_top, z_bot, r_top, r_bot, True))

    for s, centre in enumerate(STACK_CENTRES):
        c = math.radians(centre)
        off = LAME_ALTERNATE if s % 2 == 0 else -LAME_ALTERNATE
        for j in range(LAMES):
            z_top, z_bot, r_top, r_bot, arc_t, arc_b = lame_extent(j)
            arc = max(arc_t, arc_b)
            parts.append(plate("lame%d_%d" % (s, j), c - arc / 2, c + arc / 2,
                               LAME_SEGS, LAME_ROWS, z_top, z_bot,
                               r_top + off, r_bot + off, False))

    bm = bmesh.new()
    for i in range(BANDS):
        z_top, z_bot, r_top, r_bot = band_extent(i)
        r = r_bot + (r_top - r_bot) * (RIVET_INSET / BAND_H)
        rivet_run(bm, 0.0, 2.0 * math.pi, r, z_bot + RIVET_INSET, True)
    for s, centre in enumerate(STACK_CENTRES):
        c = math.radians(centre)
        off = LAME_ALTERNATE if s % 2 == 0 else -LAME_ALTERNATE
        for j in range(LAMES):
            z_top, z_bot, r_top, r_bot, arc_t, arc_b = lame_extent(j)
            arc = max(arc_t, arc_b) * 0.86
            r = r_bot + (r_top - r_bot) * (RIVET_INSET / LAME_H) + off
            rivet_run(bm, c - arc / 2, c + arc / 2, r, z_bot + RIVET_INSET, False)
    parts.append(new_object("rivets", bm))

    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    for ob in parts:
        if ob.modifiers:
            bpy.context.view_layer.objects.active = ob
            for m in list(ob.modifiers):
                bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = OBJ_NAME
    ob.data.name = OBJ_NAME
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    for p in me.polygons:
        p.use_smooth = True
    return ob


# --------------------------------------------------------------------------- #
# material
# --------------------------------------------------------------------------- #
def uv_unwrap(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    uv = ob.data.uv_layers.active.data
    for d in uv:                       # bake the tiling into the coordinates
        d.uv = (d.uv[0] * TEX_TILE, d.uv[1] * TEX_TILE)


def steel_material(target=None):
    """The BlenderKit plate rebuilt as four image textures straight into the
    BSDF - the donor's own node tree carries mapping and displacement the glTF
    exporter would drop on the floor."""
    imgs = {}
    if os.path.exists(MAT_BLEND):
        with bpy.data.libraries.load(MAT_BLEND) as (df, dt):
            dt.images = list(df.images)
        for im in dt.images:
            if im is None:
                continue
            for key in ("BaseColor", "Roughness", "Metallic", "Normal"):
                if key.lower() in im.name.lower():
                    imgs[key] = im
    mat = bpy.data.materials.new(MAT_NAME)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tone = {}
    if len(imgs) < 4:
        bsdf.inputs["Base Color"].default_value = (0.11, 0.11, 0.115, 1.0)
        bsdf.inputs["Metallic"].default_value = 0.9
        bsdf.inputs["Roughness"].default_value = 0.55
        return mat, None, tone

    def tex(key, y, non_color=True):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = imgs[key]
        n.location = (-700, y)
        if non_color:
            n.image.colorspace_settings.name = 'Non-Color'
        return n

    base = tex("BaseColor", 300, non_color=False)
    base.image.colorspace_settings.name = 'sRGB'
    metal = tex("Metallic", 0)
    rough = tex("Roughness", -300)
    if target:
        base.image, b_before, b_after = retone(base.image, target["cuirass_linear_rgb"])
        metal.image, m_before, m_after = rescale_map(metal.image, target["cuirass_metallic"])
        rough.image, r_before, r_after = rescale_map(rough.image, target["cuirass_roughness"])
        tone = {"fauld_linear_rgb_before": b_before, "fauld_linear_rgb_after": b_after,
                "fauld_metallic_before": round(m_before, 5),
                "fauld_metallic_after": round(m_after, 5),
                "fauld_roughness_before": round(r_before, 5),
                "fauld_roughness_after": round(r_after, 5)}
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(metal.outputs["Color"], bsdf.inputs["Metallic"])
    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.location = (-400, -600)
    nt.links.new(tex("Normal", -600).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat, BLENDERKIT_ID, tone


# --------------------------------------------------------------------------- #
# tone
# --------------------------------------------------------------------------- #
def srgb_to_linear(a):
    return numpy.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    a = numpy.clip(a, 0.0, 1.0)
    return numpy.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1.0 / 2.4) - 0.055)


def rgb_of(img):
    """The image's colour channels as an (n, 3) array, still sRGB-encoded."""
    buf = numpy.empty(len(img.pixels), dtype=numpy.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(-1, 4)


def mean_linear(px):
    """(mean linear rgb, mean linear luminance) of an sRGB-encoded pixel block."""
    lin = srgb_to_linear(px[:, :3].astype(numpy.float64))
    rgb = lin.mean(axis=0)
    return rgb, float(rgb @ (0.2126, 0.7152, 0.0722))


def base_colour_image(ob):
    """The image feeding Base Color on this object's first material."""
    for slot in ob.material_slots:
        mat = slot.material
        if mat is None or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            link = node.inputs["Base Color"].links
            if link and link[0].from_node.type == 'TEX_IMAGE':
                return link[0].from_node.image
    return None


def channel_mean(img, index=None):
    """Mean of a non-colour map, or of one of its channels."""
    px = rgb_of(img)
    if index is None:
        return float(px[:, :3].mean())
    return float(px[:, index].mean())


def linked_image(inp):
    """(image, channel index) feeding a shader input, through a channel split."""
    if not inp.links:
        return None, None
    node = inp.links[0].from_node
    if node.type == 'TEX_IMAGE':
        return node.image, None
    if node.type in ('SEPARATE_COLOR', 'SEPARATE_RGB'):
        up = node.inputs[0].links[0].from_node
        idx = {"Red": 0, "Green": 1, "Blue": 2}[inp.links[0].from_socket.name]
        return up.image, idx
    return None, None


def cuirass_tone():
    """What the cuirass donor's own maps average to: base colour in linear
    light, and the metallic and roughness it answers the light with.

    The fauld is riveted to that breastplate, so the two have to be the same
    steel, and base colour alone does not say that: the BlenderKit plate's
    black steel at metallic 0.9 and roughness 0.55 renders four times darker
    than the same mean at the scan's 0.66 and 0.31, because a rough metal has
    no diffuse to show. All three are matched, and the colour per channel, so
    the plate's rust is pulled to the scan's neutral as well as to its value.
    Run in an empty scene BEFORE the fauld is built, so nothing is disturbed.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=CUIRASS_GLB)
    out = {}
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        img = base_colour_image(ob)
        if img is None:
            continue
        rgb, luma = mean_linear(rgb_of(img))
        out = {"cuirass_image": img.name,
               "cuirass_linear_rgb": [round(float(c), 5) for c in rgb],
               "cuirass_luma": round(luma, 5)}
        for slot in ob.material_slots:
            mat = slot.material
            if mat is None or not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type != 'BSDF_PRINCIPLED':
                    continue
                for key in ("Metallic", "Roughness"):
                    m_img, idx = linked_image(node.inputs[key])
                    out["cuirass_" + key.lower()] = (
                        round(channel_mean(m_img, idx), 5) if m_img is not None
                        else round(float(node.inputs[key].default_value), 5))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        return out
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return out


def retone(img, target_rgb):
    """A copy of `img` scaled per channel in linear light onto `target_rgb`.

    A generated copy rather than the loaded one: the exporter hands the original
    file's bytes straight through when the source is a file, so an edit made in
    place ships unchanged.
    """
    px = rgb_of(img)
    before, _ = mean_linear(px)
    scale = numpy.asarray(target_rgb) / numpy.maximum(before, 1e-9)
    lin = srgb_to_linear(px[:, :3].astype(numpy.float64)) * scale
    out = numpy.empty_like(px, dtype=numpy.float32)
    out[:, :3] = linear_to_srgb(lin)
    out[:, 3] = px[:, 3]
    copy = bpy.data.images.new(img.name + "_toned", img.size[0], img.size[1],
                               alpha=True, float_buffer=False)
    copy.colorspace_settings.name = 'sRGB'
    copy.pixels.foreach_set(out.reshape(-1))
    copy.update()
    after, _ = mean_linear(rgb_of(copy))
    return copy, [round(float(v), 5) for v in before], [round(float(v), 5) for v in after]


def rescale_map(img, target):
    """A copy of a non-colour map scaled so its own mean lands on `target`."""
    px = rgb_of(img)
    before = float(px[:, :3].mean())
    if before <= 1e-9 or not target:
        return img, before, before
    out = numpy.empty_like(px, dtype=numpy.float32)
    out[:, :3] = numpy.clip(px[:, :3] * (target / before), 0.0, 1.0)
    out[:, 3] = px[:, 3]
    copy = bpy.data.images.new(img.name + "_matched", img.size[0], img.size[1],
                               alpha=True, float_buffer=False)
    copy.colorspace_settings.name = 'Non-Color'
    copy.pixels.foreach_set(out.reshape(-1))
    copy.update()
    return copy, before, float(rgb_of(copy)[:, :3].mean())


# --------------------------------------------------------------------------- #
# validation + render
# --------------------------------------------------------------------------- #
def components(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    seen = set()
    n = 0
    for v in bm.verts:
        if v.index in seen:
            continue
        n += 1
        stack = [v]
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
    bm.free()
    return n


def cast(ob, origin, direction):
    ok, loc, _n, _i = ob.ray_cast(Vector(origin), Vector(direction), distance=2.0)
    return {"hit": bool(ok), "at": [round(c, 4) for c in loc] if ok else None}


def look_at(cam, target, pos):
    cam.location = pos
    d = (Vector(target) - Vector(pos))
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_render(ob):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = RENDER_RES
    sc.render.resolution_y = RENDER_RES
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.22, 0.22, 0.23, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

    key = bpy.data.objects.new("key", bpy.data.lights.new("key", 'AREA'))
    key.data.energy = 400
    key.data.size = 1.6
    sc.collection.objects.link(key)
    look_at(key, (0, 0, 0.2), (-0.9, -1.2, 1.4))
    rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", 'AREA'))
    rim.data.energy = 200
    rim.data.size = 2.0
    sc.collection.objects.link(rim)
    look_at(rim, (0, 0, 0.2), (1.2, 1.0, 0.9))

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 55
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def render_views(ob, cam, tag):
    lo = Vector((min(v.co.x for v in ob.data.vertices),
                 min(v.co.y for v in ob.data.vertices),
                 min(v.co.z for v in ob.data.vertices)))
    hi = Vector((max(v.co.x for v in ob.data.vertices),
                 max(v.co.y for v in ob.data.vertices),
                 max(v.co.z for v in ob.data.vertices)))
    centre = (lo + hi) * 0.5
    dist = max(hi - lo) * 2.4
    views = {
        "front": Vector((0.0, -1.0, 0.18)),
        "quarter": Vector((-0.78, -0.78, 0.30)),
        "back": Vector((0.0, 1.0, 0.18)),
    }
    for name, d in views.items():
        look_at(cam, centre, centre + d.normalized() * dist)
        path = "%s/render-%s-%s.png" % (REVIEW, name, tag)
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)


def flat_grey(ob):
    m = bpy.data.materials.new("clay")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.52, 0.52, 0.54, 1.0)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.55
    ob.data.materials.clear()
    ob.data.materials.append(m)


# --------------------------------------------------------------------------- #
def main():
    os.makedirs(REVIEW, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    target = cuirass_tone()

    ob = build()
    uv_unwrap(ob)
    mat, bk_id, tone = steel_material(target)
    tone.update(target)
    ob.data.materials.clear()
    ob.data.materials.append(mat)

    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB',
                              use_selection=True, export_yup=True,
                              export_apply=True, export_materials='EXPORT',
                              export_image_format='JPEG', export_jpeg_quality=88)

    # ---- re-import into a clean scene and measure what actually shipped ----
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=OUT_GLB)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    ob = meshes[0]
    me = ob.data
    me.calc_loop_triangles()
    tris = len(me.loop_triangles)
    lo = [min(v.co[i] for v in me.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in me.vertices) for i in range(3)]

    # the import is +Y up, so the authored Z runs along +Y here
    m = ob.matrix_world.inverted()
    rays = {}
    for name, d in (("+X", (1, 0, 0)), ("-X", (-1, 0, 0)),
                    ("+Y", (0, 1, 0)), ("-Y", (0, -1, 0))):
        for z, label in ((0.21, "tassets_z0.21"), (0.35, "fauld_z0.35")):
            o = m @ Vector((0.0, 0.0, z))
            dd = (m.to_3x3() @ Vector(d)).normalized()
            rays["%s@%s" % (name, label)] = cast(ob, o, dd)
    # the same sweep from the two thigh axes, which is what a leg actually sees
    for side, x in (("left", -0.09), ("right", 0.09)):
        for name, d in (("+X", (1, 0, 0)), ("-X", (-1, 0, 0)),
                        ("+Y", (0, 1, 0)), ("-Y", (0, -1, 0))):
            o = m @ Vector((x, 0.0, 0.21))
            dd = (m.to_3x3() @ Vector(d)).normalized()
            rays["thigh_%s %s@z0.21" % (side, name)] = cast(ob, o, dd)

    report = {
        "source": "procedural (tools/prep_tassets.py)",
        "output": OUT_GLB,
        "object": ob.name,
        "mesh_count": len(meshes),
        "triangles": tris,
        "vertices": len(me.vertices),
        "components": components(me),
        "expected_components": {"bands": BANDS, "lames": LAMES * len(STACK_CENTRES),
                                "rivets": "one loose dome each"},
        "bbox_gltf_yup": {"min": [round(v, 4) for v in lo],
                          "max": [round(v, 4) for v in hi]},
        "materials": [s.material.name for s in ob.material_slots if s.material],
        "uv_layers": [l.name for l in me.uv_layers],
        "texture": ({"blenderkit_id": bk_id, "blenderkit_name": BLENDERKIT_NAME}
                    if bk_id else {"fallback": "flat PBR 0.11 / metallic 0.9 / rough 0.55"}),
        "rays": rays,
        "stacks": len(STACK_CENTRES),
        "lames_per_stack": LAMES,
        "stack_pitch_deg": 45.0,
        "lap_deg_per_side": round((LAME_ARC_BOTTOM - 45.0) / 2.0, 2),
        "slits": "none - the panels lap, front and back are closed",
        "alternate_offset_mm": round(LAME_ALTERNATE * 1000, 2),
        "tone": tone,
    }

    cam = setup_render(ob)
    render_views(ob, cam, "mat")
    flat_grey(ob)
    render_views(ob, cam, "solid")

    for path in (OUT_JSON, REVIEW + "/report.json"):
        with open(path, "w") as f:
            json.dump(report, f, indent=2)
    print("REPORT " + json.dumps(report))


main()
