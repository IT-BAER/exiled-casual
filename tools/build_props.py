"""Build the hideout props as one glTF: the map device, the stash chest, the
decor set and the standing brazier that lights a room.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python tools/build_props.py

Why this exists
---------------
Both props were assemblies of Babylon primitives painted with flat colours: a
cylinder stack for the device, a box with two strap boxes for the chest. Flat
colour is what makes a prop read as a greybox no matter how many primitives it
is made of, and the silhouette of a stacked cylinder is a stacked cylinder.

So the shapes are turned and swept here, offline, and the surfaces come from
real texture art (`assets/props/*.png`, generated through /codex-imagegen).

Two decisions worth keeping
---------------------------
* **The device is one lathe.** A profile spun 48 ways gives the plinth, column,
  collar, plate and basin as one watertight turned object, the way the real thing
  would leave a lathe. Faces are sorted to a material by their own normal: the
  flat shelves take the top-down ornament texture, the walls take the fluted band.
* **The ornament lines up because the mapping is the object's own geometry.** The
  shelf faces are planar-mapped from the axis, so a face at radius r lands at
  radius r on a texture that is itself concentric. Nothing is unwrapped by hand
  and nothing can drift: the basin floor sits in the texture's dark centre, the
  plate in its glyph band, the plinth in its rope border. The walls wrap the band
  texture by angle, with v taken from *world* height across the whole prop, so
  the moulding at the texture's foot lands on the plinth and the glyph row at its
  head lands on the plate rim.

Materials are exported metallic-0 on purpose. The scene has a hemispheric fill
and a directional sun and no environment texture, and a metallic glTF material
without an environment to reflect renders as a black hole in Babylon. The metal
lives in the albedo instead. Each material also emits its own albedo at 6%, which
is what keeps a prop readable in a dark map and what the runtime's hover scales.

Textures are downscaled to 512 and re-encoded as JPEG before they go in: the four
1024 PNG masters embed as ~10MB, and no prop on this camera is worth that.
"""
import math
import os
import random
import sys

import bmesh
import bpy
import mathutils
import numpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_DIR = os.path.join(ROOT, "assets", "props")
SOURCE_DIR = os.path.join(TEX_DIR, "source")
BUILD_DIR = os.path.join(TEX_DIR, "build")
OUT = os.path.join(ROOT, "apps", "web", "public", "models", "props.glb")

# Master art -> the material that wears it. Kept as the versioned filenames the
# generator wrote, so a re-render lands as v3 and this line is the switch.
TEXTURES = {
    "brass_top": "brass_top_v2.png",
    "brass_side": "brass_side_v2.png",
    "chest_wood": "chest_wood_v1.png",
    "iron": "iron_band_v2.png",
    # The decor set. The rug master is 2:1 and is squashed to square here like
    # every other texture; the rug quad is 2:1 with a unit UV, so it stretches back
    # to the shape it was painted at.
    "rug": "rug_v1.png",
    "pillar_stone": "pillar_stone_v1.png",
    # The coals in the brazier bowl. The one texture in here that is meant to
    # look lit rather than shaded, so it goes on a material that emits most of
    # its own albedo (see `coal_material`).
    "brazier_coal": "brazier_coal_v1.png",
}
TEX_SIZE = 512
TEX_QUALITY = 88

# Linear gain applied on the way in. The timber and ironwork art is authored as
# dark as the reference chest is, and a dark map lights it with about a tenth of
# the sun a screenshot has: on this floor the chest came out a black blob with a
# chest-shaped outline. The art stays the master; this is the exposure the game
# needs, and it lives here so the reason is written down next to the number.
# The rug goes the other way. At 1.35 it came out a glowing salmon slab on a cold
# grey floor - the brightest thing in the hideout, for a threadbare carpet - and its
# worn patches blew out to white speckle. 0.7 puts it back to the oxblood it was
# painted as, sitting under the floor's value the way cloth on stone does.
TEX_GAIN = {"chest_wood": 1.5, "iron": 1.25, "rug": 0.7, "pillar_stone": 1.15,
            # The coal master is painted with its own glow already; lifting it
            # further just clips the embers to white.
            "brazier_coal": 1.0}

# Albedo emitted back at this fraction, so an unlit corner of a map still shows
# the prop. The runtime multiplies this by its own hover colour.
EMISSION = 0.06


# --------------------------------------------------------------------------
# mesh construction
# --------------------------------------------------------------------------

def mesh_object(name, verts, faces, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    obj = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def lathe(profile, segments):
    """Spin a (radius, z) profile about +Z.

    The profile runs from the top of the axis outward and down to the bottom of
    it, and faces come out wound `[a_s, b_s, b_t, a_t]` so every normal points
    away from the solid. Points at radius 0 collapse to a single pole vertex.
    """
    verts = []
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([len(verts)] * segments)
            verts.append((0.0, 0.0, z))
            continue
        ring = []
        for s in range(segments):
            a = 2.0 * math.pi * s / segments
            ring.append(len(verts))
            verts.append((r * math.cos(a), r * math.sin(a), z))
        rings.append(ring)

    faces = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for s in range(segments):
            t = (s + 1) % segments
            quad = [a[s], b[s], b[t], a[t]]
            uniq = []
            for v in quad:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) >= 3:
                faces.append(uniq)
    return verts, faces


def box(name, center, size):
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [
        (cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
        (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
        (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz),
    ]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [3, 0, 4, 7], [1, 2, 6, 5]]
    return mesh_object(name, verts, faces)


def cone(name, center, r0, r1, length, axis, segments=12):
    """Rivet heads and pins: a truncated cone with caps, along one world axis."""
    cx, cy, cz = center
    ai = {"x": 0, "y": 1, "z": 2}[axis]
    u, v = [i for i in (0, 1, 2) if i != ai]
    verts = []
    rings = []
    for depth, r in ((-length / 2, r0), (length / 2, r1)):
        ring = []
        for s in range(segments):
            a = 2.0 * math.pi * s / segments
            p = [0.0, 0.0, 0.0]
            p[ai] = depth
            p[u] = r * math.cos(a)
            p[v] = r * math.sin(a)
            ring.append(len(verts))
            verts.append((cx + p[0], cy + p[1], cz + p[2]))
        rings.append(ring)
    faces = []
    for s in range(segments):
        t = (s + 1) % segments
        faces.append([rings[0][s], rings[1][s], rings[1][t], rings[0][t]])
    faces.append(list(reversed(rings[0])))
    faces.append(list(rings[1]))
    return mesh_object(name, verts, faces)


# --------------------------------------------------------------------------
# shading
# --------------------------------------------------------------------------

def smooth_by_angle(obj, degrees=40.0):
    """Smooth shading everywhere, sharp where two faces actually meet at a corner.

    Done as mesh data rather than `shade_auto_smooth`, so it does not depend on
    which release moved auto-smooth into a modifier.
    """
    me = obj.data
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    limit = math.cos(math.radians(degrees))
    by_edge = {}
    for poly in me.polygons:
        for key in poly.edge_keys:
            by_edge.setdefault(key, []).append(poly.index)
    keyed = {e.key: e for e in me.edges}
    for key, polys in by_edge.items():
        if len(polys) != 2:
            continue
        a = me.polygons[polys[0]].normal
        b = me.polygons[polys[1]].normal
        if a.dot(b) < limit:
            keyed[key].use_edge_sharp = True
    me.update()


def bevel(obj, width=0.008, segments=2):
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(30)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)


def plane(name, w, d, z):
    """One upward-facing rectangle. The rug, and nothing else so far."""
    hw, hd = w / 2.0, d / 2.0
    verts = [(-hw, -hd, z), (hw, -hd, z), (hw, hd, z), (-hw, hd, z)]
    return mesh_object(name, verts, [[0, 1, 2, 3]])


def uv_unit(obj, w, d):
    """Map the object's XY extent onto the whole texture, once.

    `uv_box` tiles by world size, which is right for timber and masonry and wrong
    for anything whose art IS the object: a rug painted with one medallion and one
    border has to land as one medallion and one border, whatever size the quad is.
    """
    me = obj.data
    uvs = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvs.data[li].uv = (co[0] / w + 0.5, co[1] / d + 0.5)


def uv_box(obj, tile):
    """World-axis projection: each face takes the two axes it does not face."""
    me = obj.data
    uvs = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        u_ax, v_ax = ((1, 2), (0, 2), (0, 1))[ax]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvs.data[li].uv = (co[u_ax] / tile, co[v_ax] / tile)


def uv_lathe(obj, span, height, u_repeat, flat_slot=0, wall_slot=1):
    """Shelves planar from the axis, walls wrapped by angle. See the header."""
    me = obj.data
    uvs = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        flat = abs(poly.normal.z) >= 0.55
        poly.material_index = flat_slot if flat else wall_slot
        if flat:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uvs.data[li].uv = (0.5 + co.x / span, 0.5 + co.y / span)
            continue
        # Unwrap each loop relative to the first one, or the face that straddles
        # angle 0 gets a u running the whole way back around the prop.
        base = None
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = (math.atan2(co.y, co.x) / (2.0 * math.pi)) % 1.0
            if base is None:
                base = u
            elif u - base > 0.5:
                u -= 1.0
            elif base - u > 0.5:
                u += 1.0
            uvs.data[li].uv = (u * u_repeat, co.z / height)


# --------------------------------------------------------------------------
# appended assets
# --------------------------------------------------------------------------
#
# The two chests are not modelled here: they are downloaded source .blends
# (tools/fetch_blenderkit.py) appended in, cut down to game weight and re-dressed
# in this file's material language (base colour only, metallic 0, 6% emission)
# so they sit in the same light as everything built above.


def append_objects(blend_name, names):
    path = os.path.join(SOURCE_DIR, blend_name)
    if not os.path.exists(path):
        sys.exit("missing source asset: " + path + " (run tools/fetch_blenderkit.py)")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        missing = [n for n in names if n not in src.objects]
        if missing:
            sys.exit(f"{blend_name} lacks objects: {', '.join(missing)}")
        dst.objects = list(names)
    out = []
    for obj in dst.objects:
        bpy.context.scene.collection.objects.link(obj)
        out.append(obj)
    # A fresh datablock answers matrix_world as identity until the depsgraph has
    # run once — copying it before this update flattened every part onto the
    # origin (the first export had the lid inside the chest).
    bpy.context.view_layer.update()
    # The source empties are not loaded, so every part is unparented here — and
    # that has to KEEP the pose the depsgraph just computed. Clearing `parent`
    # alone falls back to matrix_basis, which is the object's position BEFORE its
    # parent inverse: the chest's lid authored half a metre up and behind the box
    # it is supposed to close.
    for obj, world in [(o, o.matrix_world.copy()) for o in out]:
        obj.parent = None
        obj.matrix_world = world
    bpy.context.view_layer.update()
    return out


def bounds(objs):
    """Combined world-space min/max corners of the meshes."""
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = -lo
    for obj in objs:
        for corner in obj.bound_box:
            w = obj.matrix_world @ mathutils.Vector(corner)
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


def decimate_to(obj, target):
    """Collapse a sculpt-weight mesh to a game budget in TRIANGLES, UVs kept."""
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > target:
        m = obj.modifiers.new("dec", "DECIMATE")
        m.use_collapse_triangulate = True
        m.ratio = target / tris
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)


LUMA = numpy.array([0.299, 0.587, 0.114], dtype=numpy.float32)
# How much of each end to discard when reading a palette or normalising into it:
# a jpeg's darkest and brightest 2% are compression speckle, and letting them
# define the ends maps the whole texture into the middle of the ramp.
PALETTE_CLIP = 0.02


def _palette_ramp(path, steps=256):
    """256 colours sampled from an image's own pixels by luminance percentile."""
    img = bpy.data.images.load(path)
    px = numpy.empty(len(img.pixels), dtype=numpy.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3].copy()
    bpy.data.images.remove(img)
    order = numpy.argsort(rgb @ LUMA)
    lo = int(len(order) * PALETTE_CLIP)
    pick = numpy.linspace(lo, len(order) - 1 - lo, steps).astype(numpy.int32)
    return rgb[order[pick]]


def asset_material(name, image_name, gain, roughness, palette=None, tint=None, sat=1.0):
    """A textured_material built from an image PACKED in an appended .blend.

    `palette` re-dresses the texture in another one's colours: the source is
    normalised across its own luminance span and looked up in a ramp sampled
    from the palette image, so it keeps every plank, nail and scratch it was
    authored with and wears the other asset's tone and saturation. A flat gain
    cannot do this job — two assets
    downloaded from different authors differ in how saturated and how bright
    their wood is, and scaling one until it is dark enough leaves it a
    washed-out version of the other's colour.
    """
    img = bpy.data.images.get(image_name)
    if img is None:
        sys.exit("appended asset carries no image named " + image_name)
    img.scale(TEX_SIZE, TEX_SIZE)
    if gain != 1.0 or palette or tint or sat != 1.0:
        px = numpy.empty(len(img.pixels), dtype=numpy.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(-1, 4)[:, :3]
        if palette:
            ramp = _palette_ramp(palette)
            lum = rgb @ LUMA
            span = numpy.quantile(lum, (PALETTE_CLIP, 1.0 - PALETTE_CLIP))
            t = numpy.clip((lum - span[0]) / max(span[1] - span[0], 1e-6), 0.0, 1.0)
            rgb[:] = ramp[(t * (len(ramp) - 1)).astype(numpy.int32)]
        if sat != 1.0:
            lum = (rgb @ LUMA)[:, None]
            rgb[:] = lum + (rgb - lum) * sat
        # After the palette, so a palettized texture can still be exposed for its scene.
        numpy.clip(rgb * gain * numpy.asarray(tint or (1.0, 1.0, 1.0), dtype=numpy.float32), 0.0, 1.0, out=rgb)
        img.pixels.foreach_set(px)
    dst = os.path.join(BUILD_DIR, name + ".jpg")
    img.save_render(filepath=dst, scene=bpy.context.scene)
    return textured_material(name, dst, roughness)


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------

def prepare_textures():
    """Downscale and re-encode the masters, and hand back the built file paths."""
    os.makedirs(BUILD_DIR, exist_ok=True)
    settings = bpy.context.scene.render.image_settings
    settings.file_format = "JPEG"
    settings.quality = TEX_QUALITY
    settings.color_mode = "RGB"
    # Save the texels, not a photograph of them: the default view transform is a
    # film curve, and it was quietly pulling every master a stop darker.
    bpy.context.scene.view_settings.view_transform = "Standard"
    out = {}
    for name, src in TEXTURES.items():
        path = os.path.join(TEX_DIR, src)
        if not os.path.exists(path):
            sys.exit("missing texture: " + path)
        img = bpy.data.images.load(path)
        img.scale(TEX_SIZE, TEX_SIZE)
        gain = TEX_GAIN.get(name, 1.0)
        if gain != 1.0:
            px = numpy.empty(len(img.pixels), dtype=numpy.float32)
            img.pixels.foreach_get(px)
            rgb = px.reshape(-1, 4)[:, :3]  # linear here; leave alpha alone
            numpy.clip(rgb * gain, 0.0, 1.0, out=rgb)
            img.pixels.foreach_set(px)
        dst = os.path.join(BUILD_DIR, name + ".jpg")
        img.save_render(filepath=dst, scene=bpy.context.scene)
        bpy.data.images.remove(img)
        out[name] = dst
    return out


def textured_material(name, path, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path)
    mat.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
    mat.node_tree.links.new(bsdf.inputs["Emission Color"], tex.outputs["Color"])
    bsdf.inputs["Emission Strength"].default_value = EMISSION
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def coal_material(name, path):
    """Burning coals: albedo-as-emission, at nearly full strength.

    Everything else in this file emits 6% of its albedo so a prop stays readable
    in an unlit corner. Coals are the opposite case — they ARE the light source,
    and the renderer puts a real point light in the same bowl, so the surface has
    to be brighter than anything that light falls on or the fire looks painted on
    a cold dish.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path)
    mat.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
    mat.node_tree.links.new(bsdf.inputs["Emission Color"], tex.outputs["Color"])
    # 0.3, not the 1.6 this started at. The scene tone-maps at 1.15 exposure, and
    # a coal texture that is already painted glowing came back off the screen as
    # a flat white saucer sitting in an iron ring — the fire read as a lamp shade.
    # This is the value at which the embers are the brightest thing in the frame
    # while still being embers.
    bsdf.inputs["Emission Strength"].default_value = 0.3
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.9
    return mat


# --------------------------------------------------------------------------
# the props
# --------------------------------------------------------------------------

# (radius, z), from the centre of the basin outward and down to the ground.
# The footprint is the one the Babylon primitives had — 1.61 across, 0.71 tall —
# so nothing about placement, pick radius or the interact prompt has to move.
DEVICE_PROFILE = [
    (0.000, 0.878),  # basin floor, centre
    (0.230, 0.878),
    (0.275, 0.938),  # basin wall, flared
    (0.295, 0.950),
    (0.620, 0.950),  # plate: the face the camera actually looks at
    (0.660, 0.926),
    (0.660, 0.866),  # plate rim
    (0.600, 0.836),
    (0.530, 0.810),  # collar under the plate
    (0.500, 0.770),
    (0.505, 0.330),  # column: a drum, not a stem — see below
    (0.560, 0.280),  # foot flare
    (0.680, 0.240),  # step
    (0.700, 0.165),
    (0.800, 0.130),  # plinth
    (0.805, 0.028),
    (0.775, 0.000),
    (0.000, 0.000),  # ground cap
]

# The span is the *plinth's* width, because that is what makes the outermost
# shelf land on the texture's rope border. It also fixes how narrow the plate may
# get: below about radius 0.55 its top face falls inside the texture's dark
# centre, and the ornament the whole prop is for disappears under the basin.
#
# Which leaves the column carrying the silhouette, and on this camera a narrow
# one between two wide discs reads as a cotton reel however well it is textured.
# It is a drum just under the plate's width instead, and the prop is 0.95 tall so
# it stands at the player's waist rather than their knee.
DEVICE_SPAN = 1.61
DEVICE_HEIGHT = 0.950
DEVICE_U_REPEAT = 3  # 24 flutes around the column, ~10cm each


def build_map_device(mats):
    root = bpy.data.objects.new("mapDevice", None)
    bpy.context.scene.collection.objects.link(root)

    verts, faces = lathe(DEVICE_PROFILE, 48)
    obj = mesh_object("mapDevice_body", verts, faces)
    obj.data.materials.append(mats["brass_top"])
    obj.data.materials.append(mats["brass_side"])
    uv_lathe(obj, DEVICE_SPAN, DEVICE_HEIGHT, DEVICE_U_REPEAT)
    smooth_by_angle(obj, 35)
    obj.parent = root
    return root


# The stash is Poly Haven's Treasure Chest (cc_zero, fetched by
# tools/fetch_blenderkit.py), standing straight on the ground — the old stone
# step is gone on his call. 1.20 across, a shade under the primitives' 1.35.
STASH_CHEST_W = 1.20

# Per-mesh triangle budgets for the appended chests. The sources are render
# assets (the stash bottom alone is 26k polys); at this camera a chest is maybe
# 150px across and these numbers keep every silhouette edge that survives that.
STASH_BUDGET = {
    "treasure_chest_bottom": 1400, "treasure_chest_lid": 1000,
    "treasure_chest_lock": 300, "treasure_chest_handle_left": 150,
    "treasure_chest_handle_right": 150,
}


def build_appended(name, mat_name, blend_name, budgets, image, gain, roughness, width, renames=None, palette=None):
    """Append a downloaded asset, cut it to budget, re-dress it and stand it up.

    One carrier scales the whole asset to `width` across its LONGEST horizontal
    axis and stands it on the floor, so the source meshes keep their own
    transforms and the parts keep their pose relative to each other. Scaling by x
    alone made the crate — half again as deep as it is wide — the biggest thing
    in the room.
    """
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    # These assets put their front (lock, staves seam, brand) at -Y, and two axis
    # conversions stand between here and the game: Blender Z-up to glTF Y-up,
    # then glTF right-handed to Babylon left-handed. They land -Y away from the
    # camera, so a prop presents its back. Turned once, at the root.
    root.rotation_euler = (0.0, 0.0, math.pi)

    parts = append_objects(blend_name, list(budgets))
    mat = asset_material(mat_name, image, gain=gain, roughness=roughness, palette=palette)
    for obj in parts:
        decimate_to(obj, budgets[obj.name])
        # glTF multiplies COLOR_0 into the albedo; a source's paint-mask layers are not colour.
        for attr in list(obj.data.color_attributes):
            obj.data.color_attributes.remove(attr)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        smooth_by_angle(obj, 40)
    for obj in parts:
        obj.name = (renames or {}).get(obj.name, obj.name)
    _carry(name, parts, width).parent = root
    return root


def _carry(name, parts, width):
    """An empty that scales `parts` to `width` across and stands them centred on the floor."""
    carrier = bpy.data.objects.new(name + "_scale", None)
    bpy.context.scene.collection.objects.link(carrier)
    lo, hi = bounds(parts)
    scale = width / max(hi.x - lo.x, hi.y - lo.y)
    carrier.scale = (scale, scale, scale)
    carrier.location = (-(lo.x + hi.x) / 2 * scale, -(lo.y + hi.y) / 2 * scale, -lo.z * scale)
    for obj in parts:
        obj.parent = carrier
    return carrier


def build_stash():
    # Poly Haven's diff is exposure-correct already; lifting it read as pale
    # pink pine against the reference's dark timber.
    return build_appended(
        "stash", "stash_chest", "treasure_chest.blend", STASH_BUDGET,
        "treasure_chest_diff.png", gain=0.88, roughness=0.75, width=STASH_CHEST_W,
    )


# The map reward chest: Mutanzom3D's Wooden Chest (royalty_free). The lid is a
# separate mesh whose origin sits on the hinge line, so the runtime opens it by
# sliding the `lootChest_lid` node back off the box.
#
# The reward containers are all deliberately smaller than the stash: the stash is
# furniture you walk up to, these are things you find on the floor of a map, and
# at this camera a metre-wide box beside a 1.8-metre character read as a wardrobe.
LOOT_CHEST_W = 0.82
LOOT_BUDGET = {"Wooden Chest": 1800, "Wooden Chest Door": 500}


def build_loot_chest():
    return build_appended(
        "lootChest", "loot_chest", "wooden_chest.blend", LOOT_BUDGET,
        "Props_Wooden Chest_BaseColor.jpg", gain=0.85, roughness=0.8, width=LOOT_CHEST_W,
        renames={"Wooden Chest": "lootChest_body", "Wooden Chest Door": "lootChest_lid"},
    )


# --------------------------------------------------------------------------
# the beach set
# --------------------------------------------------------------------------
#
# What a shore has on it that a dungeon does not. Both are photoscans from
# BlenderKit (royalty_free), cut hard: they are background dressing seen from
# nine metres up, and the sources ship 128k and 51k polys respectively — about
# two hundred times what the silhouette survives at this camera.
#
# Scaled to real-world sizes rather than to the source's: the driftwood scan is
# authored at nine metres long, which is a fallen tree, not a log on a beach.
DRIFTWOOD_W = 2.1
SHELL_W = 0.34
DRIFTWOOD_BUDGET = {"3DModel_Custom": 520}
SHELL_BUDGET = {"seashell": 160}
# Poly Haven's coast rock (cc_zero): ochre stone with wet hollows and green
# algae in the cracks, which is the one thing the biome's grey wall plate cannot
# give a WATERLINE — `reference-screenshots/strand-map-layout.jpg` fringes its
# whole coast in that colour. LOD3 is the smallest the pack ships and still
# ninety-six thousand polys.
COAST_ROCK_W = 1.9
# 1500, not 700: at 700 a three-metre scan collapses into a faceted plate,
# and a flat top under a 2.4x beach sun blows to white.
COAST_ROCK_BUDGET = {"coast_rocks_05_LOD3": 1500}


def build_driftwood():
    return build_appended(
        "driftwood", "driftwood", "driftwood_log.blend", DRIFTWOOD_BUDGET,
        # Bleached: a log that has been in salt water is grey, not bark-brown,
        # and the scan was lit warm.
        "3DModel_Custom.jpg", gain=1.05, roughness=0.85, width=DRIFTWOOD_W,
        renames={"3DModel_Custom": "driftwood_log"},
    )


def build_coast_rock():
    return build_appended(
        "coastRock", "coast_rock", "coast_rocks_05.blend", COAST_ROCK_BUDGET,
        # Gain well under 1: every other prop here is lit by torches, this one
        # stands in open daylight at 2.4x, and the scan was already exposed for
        # a bright day.
        "coast_rocks_05_diff.png", gain=0.5, roughness=0.85, width=COAST_ROCK_W,
        renames={"coast_rocks_05_LOD3": "coastRock_body"},
    )


def build_shell():
    return build_appended(
        "shell", "shell", "seashell_scan.blend", SHELL_BUDGET,
        "Shell_diffuse.jpeg", gain=1.0, roughness=0.55, width=SHELL_W,
        renames={"seashell": "shell_body"},
    )


# The wreck debris both beach references are thick with: broken hull planks
# half-buried in sand, and clusters of sun-bleached bone. Crazy0_0Cat's Broken
# Wooden Planks (royalty_free, 66e40f0e-22d9-474f-929d-cb477fb78055) is five
# loose boards already lying as a heap; danes_dysfunction's Human Skull
# (royalty_free, 139ba285-470c-4f35-8139-d41af8b9a319) anchors each bone cluster and
# its diffuse also dresses the generated long bones — box-projected, because
# the texture is bone-coloured everywhere and a 30cm prop at a nine-metre
# camera never shows the seam.
WRECK_TIMBER_W = 1.7
WRECK_TIMBER_BUDGET = {
    "Куб": 32, "Куб.001": 32, "Куб.002": 32, "Куб.003": 32, "Куб.004": 32,
}
BONES_SKULL_W = 0.32
BONES_BUDGET = {"Human Skull": 600}


def build_wreck_timber():
    return build_appended(
        "wreckTimber", "wreck_timber", "wreck_planks.blend", WRECK_TIMBER_BUDGET,
        # Wreck wood is dark: soaked, tarred and weathered. The source is already
        # near black, so this LIFTS it (built luma ~61; 0.55 gave ~18, flat black
        # boards with no grain under the beach's 2.4x sun).
        "Материал_BaseColor.jpg.001", gain=1.9, roughness=0.9, width=WRECK_TIMBER_W,
        renames={
            "Куб": "wreckTimber_0", "Куб.001": "wreckTimber_1",
            "Куб.002": "wreckTimber_2", "Куб.003": "wreckTimber_3",
            "Куб.004": "wreckTimber_4",
        },
    )


def _long_bone(name, length, shaft_r):
    """A long bone lying flat on the ground: knobbed ends, thin shaft."""
    h = length / 2
    k = shaft_r * 2.1  # knob radius
    verts, faces = lathe([
        (0.0, h), (k * 0.85, h * 0.94), (k, h * 0.86), (shaft_r * 1.3, h * 0.7),
        (shaft_r, h * 0.4), (shaft_r * 0.9, 0.0), (shaft_r, -h * 0.4),
        (shaft_r * 1.3, -h * 0.7), (k, -h * 0.86), (k * 0.85, -h * 0.94), (0.0, -h),
    ], 8)
    return mesh_object(name, verts, faces)


def build_bones():
    root = build_appended(
        "bones", "bones", "human_skull.blend", BONES_BUDGET,
        # Bleached bone in open daylight, same exposure logic as the coast rock:
        # the scan is already bright, and the beach sun runs at 2.4x.
        "ML_HumanSkull_Diffuse.jpg", gain=0.62, roughness=0.6, width=BONES_SKULL_W,
        renames={"Human Skull": "bones_skull"},
    )
    mat = bpy.data.materials["bones"]
    # Three long bones scattered around the skull, the cluster the reference
    # lays out: never a tidy skeleton, just what the tide left.
    for i, (length, dx, dy, yaw) in enumerate([
        (0.62, 0.34, 0.10, 0.4),
        (0.55, -0.28, 0.24, 2.3),
        (0.48, 0.02, -0.30, 1.1),
    ]):
        bone = _long_bone(f"bones_long_{i}", length, 0.024)
        uv_box(bone, 0.3)
        bone.data.materials.append(mat)
        smooth_by_angle(bone, 40)
        # Lathe spins about Z; lay it down, then yaw it. It rests on its knobs.
        bone.rotation_euler = (math.pi / 2, 0.0, yaw)
        bone.location = (dx, dy, 0.024 * 2.1)
        bone.parent = root
    return root


# --------------------------------------------------------------------------
# the desert set
# --------------------------------------------------------------------------
#
# What PoE2's Vastiri has lying on its sand and an empty dune does not: dead
# trees, beast bones, broken sandstone and pottery. All BlenderKit downloads
# (ids and licences in assets/props/SOURCE.md), placed by render/level.ts.
# Every texture is exposed to come out DARKER than the sand: the desert floor
# plate averages luma ~162, and a prop that bright under the same sun is a
# white cut-out with no shading left in it.
#
# Mr. Naseriyan's Stylized Dead Tree, 3.05 tall at its own scale. Its bark is
# painted salmon and blue; it wears the driftwood's bleached grey instead.
DEAD_TREE_W = 1.97
DEAD_TREE_BUDGET = {"stylized dead tree": 2800}
# Alexander Handjiev's Cow Skull scan, lying on its palate with the nose at -Y.
SKULL_W = 0.72
SKULL_BUDGET = {"Cow Skull": 1600}
# Remnants of Eden Pierre's Small Bone Pile 2 at four times its size: spine,
# ribs and the long bones. The hand, jaw and teeth stay behind, because a
# human hand that size reads as a giant's, not a beast's.
RIBCAGE_W = 2.5
RIBCAGE_BUDGET = {
    "vertebrae.013": 900, "vertebrae.011": 220, "vertebrae.009": 150,
    "vertebrae.010": 150, "vertebrae.012": 150, "humerus.004": 180,
    "humerus.005": 180, "radius.002": 120, "ulna.002": 100,
}
# Box-projection tile for the ribcage's bone material, in SOURCE units (x4 in game).
RIBCAGE_UV_TILE = 0.12
# Dennis Hafemann's Broken Stone Wall: a stepped course of blocks with its
# rubble spilled at -Y. Two atlases, so two materials, both re-dressed in the
# desert cliff's own sandstone.
RUIN_WALL_W = 3.0
RUIN_WALL_BUDGET = {"Wall": 1600, "Pieces": 900}
DESERT_SANDSTONE = os.path.join(ROOT, "apps", "web", "public", "textures", "tilesets", "desert", "wall_color.jpg")
# Nico's Amphora. Its iron stand is cut away and the pointed foot is pushed
# into the sand at a lean: abandoned, not displayed.
POT_W = 0.5
POT_BUDGET = {"Amphora": 1200}
POT_SINK = 0.12
POT_LEAN = math.radians(9.0)


def build_dead_tree():
    return build_appended(
        "deadTree", "desert_tree", "stylized_dead_tree.blend", DEAD_TREE_BUDGET,
        "Material.002_BaseColor.jpg", gain=0.72, roughness=0.9, width=DEAD_TREE_W,
        renames={"stylized dead tree": "deadTree_body"},
        palette=os.path.join(BUILD_DIR, "driftwood.jpg"),
    )


def build_skull():
    return build_appended(
        "skull", "desert_skull", "cow_skull.blend", SKULL_BUDGET,
        "CowSkull_diffuse", gain=0.6, roughness=0.7, width=SKULL_W,
        renames={"Cow Skull": "skull_body"},
    )


def _keep_largest_island(obj):
    """Delete every loose part but the one with the most faces."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen, islands = set(), []
    for face in bm.faces:
        if face in seen:
            continue
        seen.add(face)
        stack, island = [face], []
        while stack:
            f = stack.pop()
            island.append(f)
            for edge in f.edges:
                for g in edge.link_faces:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        islands.append(island)
    islands.sort(key=len)
    bmesh.ops.delete(bm, geom=[f for island in islands[:-1] for f in island], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def build_pot():
    root = _root("pot")
    root.rotation_euler = (0.0, 0.0, math.pi)  # front at -Y, see build_appended
    body, = append_objects("amphora.blend", list(POT_BUDGET))
    _keep_largest_island(body)
    decimate_to(body, POT_BUDGET["Amphora"])
    body.data.materials.clear()
    # Terracotta, a shade under the sand: the scan's clay is the sand's own beige.
    body.data.materials.append(asset_material(
        "desert_pot", "Amphore_Material_BaseColor.jpg", gain=0.9, roughness=0.85, tint=(1.0, 0.74, 0.58)))
    smooth_by_angle(body, 40)
    body.name = "pot_body"
    carrier = _carry("pot", [body], POT_W)
    carrier.location.z -= POT_SINK
    carrier.rotation_euler = (POT_LEAN, 0.0, 0.0)
    carrier.parent = root
    return root


def build_ribcage():
    root = _root("ribcage")
    root.rotation_euler = (0.0, 0.0, math.pi)
    path = os.path.join(SOURCE_DIR, "mat-organic-bone.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.images = ["Organic Bone_BaseColor.jpg"]
    mat = asset_material("desert_bone", dst.images[0].name, gain=0.66, roughness=0.65, tint=(1.0, 0.95, 0.86))
    parts = append_objects("small_bone_pile_2.blend", list(RIBCAGE_BUDGET))
    for i, obj in enumerate(parts):
        decimate_to(obj, RIBCAGE_BUDGET[obj.name])
        # The pile ships a procedural bone shader; a tiling scan goes on by box projection.
        while obj.data.uv_layers:
            obj.data.uv_layers.remove(obj.data.uv_layers[0])
        uv_box(obj, RIBCAGE_UV_TILE)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        smooth_by_angle(obj, 40)
        obj.name = f"ribcage_{i}"
    carrier = _carry("ribcage", parts, RIBCAGE_W)
    # The source's own z=0 is its ground: the spine dips under it, half-buried.
    carrier.location.z = 0.0
    carrier.parent = root
    return root


def build_ruin_wall():
    root = _root("ruinWall")
    root.rotation_euler = (0.0, 0.0, math.pi)
    parts = append_objects("broken_stone_wall.blend", list(RUIN_WALL_BUDGET))
    images = {"Wall": ("desert_ruin", "wall_diffuse.jpg"), "Pieces": ("desert_ruin_rubble", "pieces_diffuse.jpg")}
    for obj in parts:
        decimate_to(obj, RUIN_WALL_BUDGET[obj.name])
        name, image = images[obj.name]
        obj.data.materials.clear()
        obj.data.materials.append(asset_material(
            name, image, gain=0.72, roughness=0.92, palette=DESERT_SANDSTONE))
        smooth_by_angle(obj, 40)
    for obj in parts:
        obj.name = {"Wall": "ruinWall_wall", "Pieces": "ruinWall_rubble"}[obj.name]
    _carry("ruinWall", parts, RUIN_WALL_W).parent = root
    return root


# --------------------------------------------------------------------------
# the forest, swamp and vaal stone sets
# --------------------------------------------------------------------------
#
# Free BlenderKit downloads (ids and licences in assets/props/SOURCE.md), placed
# by render/level.ts at the rock foot and, for the trees, on the wall mass itself.
# Every scan is cut to a game budget; the stylized trees already sit under one.

TILESETS = os.path.join(ROOT, "apps", "web", "public", "textures", "tilesets")
VAAL_STONE = os.path.join(TILESETS, "vaal_stone", "wall_color.jpg")


def _apply_shape_mods(obj):
    """Bake geometry-nodes and bevel stacks into the mesh, drop subdivision.

    `decimate_to` clears every modifier, which is right for a subsurf over a
    sculpt but deletes the leaves a geometry-nodes stack scatters over a crown.
    """
    for m in list(obj.modifiers):
        if m.type in ("SUBSURF", "MULTIRES"):
            obj.modifiers.remove(m)
    if obj.modifiers:
        deps = bpy.context.evaluated_depsgraph_get()
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
        obj.modifiers.clear()
        obj.data = mesh


def _image_of(obj, hint):
    """The image node in `obj`'s materials whose image name contains `hint`."""
    for slot in obj.material_slots:
        if slot.material and slot.material.node_tree:
            for n in slot.material.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and hint in n.image.name:
                    return n.image.name
    sys.exit(f"{obj.name} has no image matching {hint!r}")


def _scan(name, blend, budgets, hint, width, gain, roughness, palette=None, tint=None, mat_name=None):
    """build_appended for sources whose image names collide or whose shape lives in modifiers."""
    root = _root(name)
    root.rotation_euler = (0.0, 0.0, math.pi)  # front at -Y, see build_appended
    parts = append_objects(blend, list(budgets))
    image = _image_of(parts[0], hint)
    mat = asset_material(mat_name or name, image, gain=gain, roughness=roughness, palette=palette, tint=tint)
    for obj, budget in zip(parts, budgets.values()):
        _apply_shape_mods(obj)
        decimate_to(obj, budget)
        for attr in list(obj.data.color_attributes):
            obj.data.color_attributes.remove(attr)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        smooth_by_angle(obj, 40)
    for i, obj in enumerate(parts):
        obj.name = f"{name}_{i}"
    carrier = _carry(name, parts, width)
    carrier.parent = root
    return root, carrier, parts


# Crowns are SOLID lobes, not leaf cards. Hundreds of small cards on a 256px cut-
# out mip down at this camera into one feathered disc with no shading; masses
# with ambient occlusion between them read as a canopy (PoE's). A dozen smooth
# lobes of one size read as melons, and the cards baked onto them as stripes, so
# each lobe buds smaller clumps and wears leaf clusters painted in 3D, not cards.
LEAF_LIGHT = (0.34, 0.42, 0.19)  # sRGB, the lit heart of a leaf cluster
LEAF_DARK = (0.10, 0.15, 0.07)   # sRGB, the shadow between clusters
LEAF_VARY = 0.35                 # +-17% brightness per cluster, so no two match
LEAF_CELLS = 16.0                # leaf clusters across a crown's width
LEAF_RELIEF = 0.012              # bump depth of a cluster dome, as a fraction of crown width
CROWN_TRIS = 2600
CROWN_BAKE = 512                 # px per crown, colour and normal map each
CROWN_RAGGED = 0.22              # noise amplitude as a fraction of a lobe radius
CROWN_CLUMPS = 7                 # clumps budded off each lobe, mostly upward and out


def _vertex_shaded(mat):
    """Multiply the material's base colour by COLOR_0 ("Col"): baked shade or tint."""
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    src = bsdf.inputs["Base Color"].links[0].from_socket
    shade = nt.nodes.new("ShaderNodeVertexColor")
    shade.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(mul.inputs["A"], src)
    nt.links.new(mul.inputs["B"], shade.outputs["Color"])
    nt.links.new(bsdf.inputs["Base Color"], mul.outputs["Result"])
    return mat


def _leaf_graph(nt, span):
    """(height, per-cluster random) sockets of leaf clusters laid in object space.

    A Voronoi cell is a leaf cluster, a dome at its heart falling to a crease at
    its rim, with a finer cell grid over it for single leaves. Object space, not
    UV: a pattern laid in UVs breaks at every seam and stretches across islands.
    """
    coord = nt.nodes.new("ShaderNodeTexCoord")
    domes = []
    for scale, reach in ((LEAF_CELLS / span, 0.7), (LEAF_CELLS * 2.6 / span, 0.6)):
        cells = nt.nodes.new("ShaderNodeTexVoronoi")
        cells.inputs["Scale"].default_value = scale
        nt.links.new(cells.inputs["Vector"], coord.outputs["Object"])
        dome = nt.nodes.new("ShaderNodeMapRange")
        dome.interpolation_type = "SMOOTHSTEP"
        dome.inputs["From Min"].default_value = 0.0
        dome.inputs["From Max"].default_value = reach
        dome.inputs["To Min"].default_value = 1.0
        dome.inputs["To Max"].default_value = 0.0
        nt.links.new(dome.inputs["Value"], cells.outputs["Distance"])
        domes.append((cells, dome))
    small = nt.nodes.new("ShaderNodeMath")
    small.operation = "MULTIPLY"
    small.inputs[1].default_value = 0.35
    nt.links.new(small.inputs[0], domes[1][1].outputs["Result"])
    height = nt.nodes.new("ShaderNodeMath")
    height.operation = "MULTIPLY_ADD"  # big * 0.65 + small * 0.35
    height.inputs[1].default_value = 0.65
    nt.links.new(height.inputs[0], domes[0][1].outputs["Result"])
    nt.links.new(height.inputs[2], small.outputs["Value"])
    grey = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(grey.inputs["Color"], domes[0][0].outputs["Color"])
    return height.outputs["Value"], grey.outputs["Val"]


def _bake_pass(obj, mat, image, kind):
    """Bake `kind` of `mat` on `obj` into `image` through Cycles, then drop `mat`."""
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    mat.node_tree.nodes.active = node
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    scene = bpy.context.scene
    engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 4
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type=kind, normal_space="TANGENT", margin=4, margin_type="EXTEND",
                        use_clear=True, target="IMAGE_TEXTURES")
    scene.render.engine = engine
    obj.data.materials.clear()
    bpy.data.materials.remove(mat)


def _save_jpeg(img, path):
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save()
    bpy.data.images.remove(img)


def _bake_leaves(obj, name, span):
    """Bake the leaf clusters onto `obj`'s UVs: the crown's own sRGB colour and normal map.

    The normal map is what makes a cluster a leaf cluster: each one turns its own
    face to the sun, where colour alone only spotted a smooth lobe.
    """
    mat = bpy.data.materials.new(name + "_leafcolour")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    height, rand = _leaf_graph(nt, span)
    comb = nt.nodes.new("ShaderNodeCombineColor")
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(comb.inputs["Red"], height)
    nt.links.new(comb.inputs["Green"], rand)
    nt.links.new(emit.inputs["Color"], comb.outputs["Color"])
    nt.links.new(nt.nodes["Material Output"].inputs["Surface"], emit.outputs["Emission"])
    target = bpy.data.images.new(name + "_bake", CROWN_BAKE, CROWN_BAKE, float_buffer=True)
    _bake_pass(obj, mat, target, "EMIT")
    px = numpy.empty(CROWN_BAKE * CROWN_BAKE * 4, dtype=numpy.float32)
    target.pixels.foreach_get(px)
    bpy.data.images.remove(target)
    rgba = px.reshape(-1, 4)
    mask = numpy.clip(rgba[:, 0:1], 0.0, 1.0)
    vary = 1.0 - LEAF_VARY / 2 + LEAF_VARY * numpy.clip(rgba[:, 1:2], 0.0, 1.0)
    lo, hi = numpy.asarray(LEAF_DARK, numpy.float32), numpy.asarray(LEAF_LIGHT, numpy.float32)
    out = numpy.ones_like(rgba)
    out[:, :3] = numpy.clip((lo + (hi - lo) * mask) * vary, 0.0, 1.0)  # sRGB, stored as written
    img = bpy.data.images.new(name, CROWN_BAKE, CROWN_BAKE)
    img.pixels.foreach_set(out.ravel())
    path = os.path.join(BUILD_DIR, name + ".jpg")
    _save_jpeg(img, path)

    mat = bpy.data.materials.new(name + "_leafbump")
    mat.use_nodes = True
    nt = mat.node_tree
    height, _ = _leaf_graph(nt, span)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = span * LEAF_RELIEF
    nt.links.new(bump.inputs["Height"], height)
    nt.links.new(nt.nodes["Principled BSDF"].inputs["Normal"], bump.outputs["Normal"])
    normals = bpy.data.images.new(name + "_n", CROWN_BAKE, CROWN_BAKE)
    normals.colorspace_settings.name = "Non-Color"
    _bake_pass(obj, mat, normals, "NORMAL")
    npath = os.path.join(BUILD_DIR, name + "_n.jpg")
    _save_jpeg(normals, npath)

    mat = textured_material(name, path, 0.9)
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(npath)
    tex.image.colorspace_settings.name = "Non-Color"
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nmap.inputs["Color"], tex.outputs["Color"])
    nt.links.new(nt.nodes["Principled BSDF"].inputs["Normal"], nmap.outputs["Normal"])
    nt.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = EMISSION * 0.5
    return _vertex_shaded(mat)


def _kmeans(points, k, iters=16):
    """Deterministic k-means: seeds spread along the points sorted by height."""
    order = numpy.lexsort((points[:, 0], points[:, 2]))
    centres = points[order[numpy.linspace(0, len(points) - 1, k).astype(int)]].copy()
    for _ in range(iters):
        label = ((points[:, None, :] - centres[None]) ** 2).sum(-1).argmin(1)
        for i in range(k):
            if (label == i).any():
                centres[i] = points[label == i].mean(0)
    return centres, label


def _bake_ao(obj, distance):
    """Cycles ambient occlusion into the "Col" point colours, scene cleared around it."""
    scene = bpy.context.scene
    hidden = [o for o in scene.objects if o.type == "MESH" and o is not obj and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.device = "CPU"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake")
    scene.world.light_settings.distance = distance
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    scene.render.engine = engine
    for o in hidden:
        o.hide_render = False


def _ragged(verts, centre, r):
    """Push a lobe's surface in and out with two octaves of noise, so it is leafy, not a sphere."""
    shift = mathutils.Vector((7.3, 1.9, 4.1))
    for v in verts:
        n = v.co.normalized()
        p = v.co + centre
        d = mathutils.noise.noise(p * (3.2 / r)) + 0.5 * mathutils.noise.noise(p * (7.0 / r) + shift)
        v.co += n * (CROWN_RAGGED * r * d)


def _blob(bm, centre, r, squash=0.85):
    geom = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r)
    _ragged(geom["verts"], centre, r)
    bmesh.ops.scale(bm, vec=(1.0, 1.0, squash), verts=geom["verts"])
    bmesh.ops.translate(bm, vec=centre, verts=geom["verts"])


def lobe_crown(cards, lobes, name):
    """Replace a leaf-card cloud with `lobes` fused ragged masses, leaf clusters baked on, AO in COLOR_0.

    k-means over the cards' vertices puts each lobe where the leaves are dense;
    each lobe buds CROWN_CLUMPS smaller clumps, mostly up and out, so the outline
    is a cloud of mixed sizes rather than a few equal spheres. All of it is
    voxel-remeshed into one closed surface, cut to budget, unwrapped and baked.
    """
    _apply_shape_mods(cards)
    pts = numpy.array([tuple(cards.matrix_world @ v.co) for v in cards.data.vertices], dtype=numpy.float32)
    centres, label = _kmeans(pts, lobes)
    span = float(max(numpy.ptp(pts[:, 0]), numpy.ptp(pts[:, 1])))
    mid = mathutils.Vector(pts.mean(0).tolist())
    rng = random.Random(name)
    bm = bmesh.new()
    for i, c in enumerate(centres):
        member = pts[label == i]
        r = max(float(numpy.percentile(numpy.linalg.norm(member - c, axis=1), 70)), span * 0.13)
        centre = mathutils.Vector(c.tolist())
        _blob(bm, centre, r * 0.9)
        out = centre - mid
        out.z = 0.0
        out = out.normalized() if out.length > 1e-6 else mathutils.Vector((1.0, 0.0, 0.0))
        for _ in range(CROWN_CLUMPS):
            phi = rng.uniform(0.0, 2.0 * math.pi)
            z = rng.uniform(-0.3, 1.0)
            d = mathutils.Vector((math.cos(phi), math.sin(phi), 0.0)) * math.sqrt(1.0 - z * z)
            d.z = z
            d = (d + out * 0.6).normalized()  # bud away from the trunk, never into the crown
            _blob(bm, centre + d * r * rng.uniform(0.7, 0.95), r * rng.uniform(0.32, 0.55), 0.9)
    me = bpy.data.meshes.new(cards.name + "_lobes")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(cards.name + "_lobes", me)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    rm = obj.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = span / 90.0
    sm = obj.modifiers.new("smooth", "SMOOTH")
    sm.factor = 0.4
    sm.iterations = 1
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    decimate_to(obj, CROWN_TRIS)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    mat = _bake_leaves(obj, name, span)
    bpy.data.objects.remove(cards, do_unlink=True)
    obj.data.materials.append(mat)
    attr = obj.data.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    obj.data.color_attributes.active_color = attr
    _bake_ao(obj, span * 0.35)
    # Contrast: the gaps between clumps go dark, and the underside of the crown
    # darker still, so the top is the one lit face this camera sees.
    zs = [v.co.z for v in obj.data.vertices]
    lo, hi = min(zs), max(zs)
    for v, d in zip(obj.data.vertices, obj.data.color_attributes["Col"].data):
        k = (0.28 + 0.72 * d.color[0] ** 1.6) * (0.55 + 0.45 * (v.co.z - lo) / (hi - lo))
        d.color = (k, k, k, 1.0)
    obj.name = name
    return obj


def _stylized_tree(name, blend, trunk, leaves, trunk_hint, width, gain, lobes):
    """A Phixer Art stylized tree: its own bark, its crown remade as solid lobes."""
    root = _root(name)
    root.rotation_euler = (0.0, 0.0, math.pi)
    body, cards = append_objects(blend, [trunk, leaves])
    # Desaturated: the painted bark is orange, and a brazier lights it red-hot.
    bark = asset_material(name + "_bark", _image_of(body, trunk_hint), gain=gain, roughness=0.9, sat=0.4)
    _apply_shape_mods(body)
    for attr in list(body.data.color_attributes):
        body.data.color_attributes.remove(attr)
    body.data.materials.clear()
    body.data.materials.append(bark)
    smooth_by_angle(body, 60)
    crown = lobe_crown(cards, lobes, name + "_crown")
    body.name = name + "_trunk"
    _carry(name, [body, crown], width).parent = root
    return root


# The forest. Phixer Art's Stylized Tree 01 (broad, 3.8 wide) and 03 (slender);
# 03's crown is painted magenta at source and wears 01's green here. In game a
# tree stands 3.5-4.5 tall: two players, which only the wall mass and the rock
# foot with rock behind it can afford.
FOREST_TREE_W = 3.6
FOREST_TREE2_W = 2.7
BUSH_W = 1.5
STUMP_W = 0.95
STUMP_BUDGET = {"3DModel_Custom": 900}
MOSS_LOG_W = 2.3
MOSS_LOG_BUDGET = {"log": 900}
MOSS_ROCK_W = 1.35
MOSS_ROCK_BUDGET = {"Mossy Rock": 1000}
# (x, y, scale, lean) of each cap in the cluster, in cluster units.
TOADSTOOLS = ((0.0, 0.0, 1.0, 0.05), (0.32, 0.12, 0.7, 0.2), (-0.2, 0.28, 0.55, -0.15),
              (0.1, -0.3, 0.45, 0.25), (-0.3, -0.12, 0.35, -0.3))
TOADSTOOL_H = 0.42


def build_forest():
    _stylized_tree("forestTree", "stylized_tree_01.blend", "SM_Trunk01", "SM_Trunk01_Leaves02",
                   "T_SM_Trunk01_WithMoss_A.png", FOREST_TREE_W, gain=0.6, lobes=12)
    _stylized_tree("forestTree2", "stylized_tree_03.blend", "SM_Trunk02", "SM_Trunk02_Leaves01",
                   "SM_Trunk02_basecolor", FOREST_TREE2_W, gain=0.6, lobes=9)
    # A bush is tree 01's crown on the ground in six lobes: squashed, half sunk.
    root = _root("bush")
    cards, = append_objects("stylized_tree_01.blend", ["SM_Trunk01_Leaves02"])
    crown = lobe_crown(cards, 6, "bush_crown")
    carrier = _carry("bush", [crown], BUSH_W)
    carrier.scale.z *= 0.7
    carrier.location.z -= 0.15
    carrier.parent = root
    _scan("stump", "stump_scan.blend", STUMP_BUDGET, "3DModel_Custom", STUMP_W, gain=0.75, roughness=0.9)
    # The scan's lichen is lilac; it wears tree 01's bark instead, and a fatter
    # cross-section, or at this camera it is a branch rather than a fallen trunk.
    _, carrier, _ = _scan("mossLog", "large_log.blend", MOSS_LOG_BUDGET, "Log_COL", MOSS_LOG_W, gain=1.0,
                          roughness=0.9, palette=os.path.join(BUILD_DIR, "forestTree_bark.jpg"))
    carrier.scale.y *= 1.4
    carrier.scale.z *= 1.4
    _scan("mossRock", "mossy_rock.blend", MOSS_ROCK_BUDGET, "Base_color", MOSS_ROCK_W, gain=0.7, roughness=0.88)
    build_toadstools()


def _toadstool_profile(h, cap_r, stem_r):
    """Amanita in (radius, z), top pole first: domed cap, gill shelf, swollen foot."""
    return [(0.0, h), (cap_r * 0.5, h - cap_r * 0.12), (cap_r * 0.85, h - cap_r * 0.32),
            (cap_r, h - cap_r * 0.55), (cap_r * 0.92, h - cap_r * 0.68), (stem_r * 1.3, h - cap_r * 0.6),
            (stem_r, h - cap_r * 0.62), (stem_r * 1.05, h * 0.45), (stem_r * 1.45, 0.03), (0.0, 0.0)]


def build_toadstools():
    """Five amanitas of falling size as one prop: a cluster reads, one cap is a dot.

    Turned here, not decimated: the scan is 270k triangles and cut to a few
    hundred it fell apart into floating flakes. Its cap photograph is kept,
    planar-mapped from above, which is the only side this camera sees.
    """
    root = _root("toadstools")
    src, = append_objects("toadstool.blend", ["toadstool."])
    cap = asset_material("toadstool_cap", _image_of(src, "rot.jpg"), gain=0.85, roughness=0.6)
    bpy.data.objects.remove(src, do_unlink=True)
    stem = flat_material("toadstool_stem", (0.80, 0.76, 0.66), 0.8)
    for i, (x, y, s, lean) in enumerate(TOADSTOOLS):
        h = TOADSTOOL_H * s
        verts, faces = lathe(_toadstool_profile(h, 0.17 * s, 0.035 * s), 10)
        obj = mesh_object(f"toadstools_{i}", verts, faces)
        _outward(obj)
        uv_unit(obj, 0.34 * s, 0.34 * s)
        obj.data.materials.append(cap)
        obj.data.materials.append(stem)
        for poly in obj.data.polygons:
            # The cap is everything above the gill shelf that faces up or out.
            poly.material_index = 0 if poly.center.z > h - 0.17 * s * 0.6 and poly.normal.z > -0.3 else 1
        smooth_by_angle(obj, 50)
        obj.location = (x, y, -0.02)
        obj.rotation_euler = (lean, 0.0, i * 1.3)
        obj.parent = root
    return root


# The swamp: a drowned dead tree and reeds, with the forest's stump, log and
# toadstools. The tree is the desert's chunky stylized snag again (a thin-twig
# scan read as grey wire mesh at this camera), in dark wet bark with moss
# climbing from the waterline, carried as a COLOR_0 tint.
SWAMP_TREE_W = 2.9  # ~4.5 tall
SWAMP_MOSS = (0.50, 0.68, 0.40)  # sRGB multiplier at the foot, fading out by 45% up
REEDS_W = 0.9
REEDS_H = 1.25
# sRGB along a blade: green at the root, olive, tan at the tip.
REEDS_RAMP = ((0.0, (0.16, 0.24, 0.10)), (0.55, (0.34, 0.40, 0.18)), (1.0, (0.62, 0.55, 0.33)))


def _height_colours(obj, fn):
    """A "Col" point colour from each vertex's height fraction, through `fn`."""
    me = obj.data
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    attr = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    for v, d in zip(me.vertices, attr.data):
        d.color_srgb = (*fn((v.co.z - lo) / max(hi - lo, 1e-6)), 1.0)
    me.color_attributes.active_color = attr


def _lerp3(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def build_swamp():
    root = _root("swampTree")
    root.rotation_euler = (0.0, 0.0, math.pi)
    body, = append_objects("stylized_dead_tree.blend", list(DEAD_TREE_BUDGET))
    bark = asset_material("swamp_bark", _image_of(body, "Material.002_BaseColor"), gain=0.7, roughness=0.7,
                          palette=os.path.join(BUILD_DIR, "forestTree_bark.jpg"))
    decimate_to(body, DEAD_TREE_BUDGET["stylized dead tree"])
    for attr in list(body.data.color_attributes):
        body.data.color_attributes.remove(attr)
    body.data.materials.clear()
    body.data.materials.append(_vertex_shaded(bark))
    smooth_by_angle(body, 40)
    _height_colours(body, lambda t: _lerp3(SWAMP_MOSS, (1.0, 1.0, 1.0), min(1.0, t / 0.45)))
    body.name = "swampTree_body"
    _carry("swampTree", [body], SWAMP_TREE_W).parent = root
    # Reeds: solid blades coloured root to tip in COLOR_0, no texture needed.
    root = _root("reeds")
    clump, = append_objects("high_grass_clump.blend", ["High grass clump"])
    _apply_shape_mods(clump)
    clump.data.materials.clear()
    mat = bpy.data.materials.new("reeds")
    mat.use_nodes = True
    mat.use_backface_culling = False
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    nt.links.new(bsdf.inputs["Base Color"], col.outputs["Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.85
    clump.data.materials.append(mat)
    smooth_by_angle(clump, 60)

    def ramp(t):
        for (t0, c0), (t1, c1) in zip(REEDS_RAMP, REEDS_RAMP[1:]):
            if t <= t1:
                return _lerp3(c0, c1, (t - t0) / (t1 - t0))
        return REEDS_RAMP[-1][1]
    _height_colours(clump, ramp)
    clump.name = "reeds_blades"
    carrier = _carry("reeds", [clump], REEDS_W)
    lo, hi = bounds([clump])
    carrier.scale.z *= REEDS_H / ((hi.z - lo.z) * carrier.scale.x)
    carrier.parent = root


# Vaal stone: an underground ruin. Everything wears the vaal wall plate as a
# palette so a broken column and the cliff behind it are the same cold stone.
# The upright pieces take a torch square on, and at the block's exposure they came
# out white beside a wall drawn at ROCK_ALBEDO 0.18. This lands them near the
# wall's own value, in the wall material's cold bias (level.ts wallMaterial).
VAAL_TALL_GAIN = 0.5
VAAL_COLD = (0.94, 1.0, 1.1)
VAAL_COLUMN_W = 0.95
VAAL_COLUMN_BUDGET = {"Pillar": 2400}
VAAL_COLUMN_CUT = 0.5   # of the source height, tilted: the column broke, not sawn
VAAL_IDOL_W = 0.8
VAAL_IDOL_BUDGET = {"Mesoamerican Statuette": 3000}
VAAL_BLOCK_W = 0.85
VAAL_BLOCK_BUDGET = {"Square Shaped Stone Block.003": 500}
VAAL_URN_W = 0.55
VAAL_URN_BUDGET = {"Retopo_3DModel": 600}


def _break_top(obj, frac, tilt):
    """Cut a column off at `frac` of its height on a tilted plane, and cap it."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    zs = [v.co.z for v in bm.verts]
    z = min(zs) + (max(zs) - min(zs)) * frac
    normal = mathutils.Vector((math.sin(tilt), 0.0, math.cos(tilt)))
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                                 plane_co=(0.0, 0.0, z), plane_no=normal, clear_outer=True)
    edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()


def build_vaal():
    root = _root("vaalColumn")
    root.rotation_euler = (0.0, 0.0, math.pi)
    col, = append_objects("carved_temple_column.blend", ["Pillar"])
    mat = asset_material("vaal_column", _image_of(col, "Base_color"), gain=VAAL_TALL_GAIN, roughness=0.92,
                         palette=VAAL_STONE, tint=VAAL_COLD)
    _apply_shape_mods(col)
    _break_top(col, VAAL_COLUMN_CUT, math.radians(18))
    decimate_to(col, VAAL_COLUMN_BUDGET["Pillar"])
    col.data.materials.clear()
    col.data.materials.append(mat)
    smooth_by_angle(col, 40)
    col.name = "vaalColumn_body"
    _carry("vaalColumn", [col], VAAL_COLUMN_W).parent = root
    _scan("vaalIdol", "mesoamerican_statuette.blend", VAAL_IDOL_BUDGET, "Color", VAAL_IDOL_W,
          gain=VAAL_TALL_GAIN, roughness=0.9, palette=VAAL_STONE, tint=VAAL_COLD)
    _scan("vaalBlock", "square_stone_block.blend", VAAL_BLOCK_BUDGET, "3DModel", VAAL_BLOCK_W,
          gain=0.75, roughness=0.92, palette=VAAL_STONE)
    # The bowl keeps its own red and green paint: the one colour in a grey ruin.
    _scan("vaalUrn", "ancient_stone_bowl.blend", VAAL_URN_BUDGET, "3DModel_Custom.jpg", VAAL_URN_W,
          gain=0.7, roughness=0.85)
    # The desert's broken wall in the vaal plate's stone.
    root = _root("vaalRuinWall")
    root.rotation_euler = (0.0, 0.0, math.pi)
    parts = append_objects("broken_stone_wall.blend", list(RUIN_WALL_BUDGET))
    for obj in parts:
        hint = "wall_diffuse" if obj.name.startswith("Wall") else "pieces_diffuse"
        image = _image_of(obj, hint)
        decimate_to(obj, RUIN_WALL_BUDGET["Wall" if hint == "wall_diffuse" else "Pieces"])
        obj.data.materials.clear()
        obj.data.materials.append(asset_material(
            "vaal_ruin" if hint == "wall_diffuse" else "vaal_ruin_rubble", image,
            gain=0.72, roughness=0.92, palette=VAAL_STONE))
        smooth_by_angle(obj, 40)
    for obj in parts:
        obj.name = "vaalRuinWall_wall" if obj.name.startswith("Wall") else "vaalRuinWall_rubble"
    _carry("vaalRuinWall", parts, RUIN_WALL_W).parent = root


# --------------------------------------------------------------------------
# the decor set
# --------------------------------------------------------------------------
#
# Six pieces of furniture, placed by the client (render/hideout.ts) rather than by
# the sim: none of them is interactable and the hideout carries no collision, so
# they are scenery in the strict sense.
#
# Every one of them is capped at roughly a metre. The wall pass already paid for
# this lesson: the camera sits about 49 degrees above the horizon, so anything of
# height h hides ~0.87h of world behind it, and the 1.8-unit box wall was hiding
# the character whenever he walked south of one. A hideout you cannot see yourself
# in is worse than an empty one, so the tallest thing here is a broken column at
# 1.12 and the table tops out at 0.83.


def _finish(parts, root, smooth=40):
    for obj, mat, tile in parts:
        bevel(obj)
        obj.data.materials.append(mat)
        uv_box(obj, tile)
        smooth_by_angle(obj, smooth)
        obj.parent = root
    return root


def _root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root


RUG_W, RUG_D = 2.6, 1.3


def build_rug(mats):
    """A worn carpet, and the one prop that is only its texture.

    Lifted 12mm off the floor rather than laid on it: the ground plate is at y=0
    and two coplanar surfaces at this camera z-fight in a band right across the
    middle of the frame.
    """
    root = _root("rug")
    face = plane("rug_face", RUG_W, RUG_D, 0.012)
    face.data.materials.append(mats["rug"])
    uv_unit(face, RUG_W, RUG_D)
    face.parent = root
    return root


def build_table(mats):
    """Trestle table: a plank top on two solid ends, tied by a stretcher."""
    root = _root("table")
    parts = []
    parts.append((box("table_top", (0, 0, 0.79), (2.2, 0.95, 0.08)), mats["chest_wood"], 0.9))
    for i, x in enumerate((-0.82, 0.82)):
        parts.append((box(f"table_leg_{i}", (x, 0, 0.375), (0.14, 0.82, 0.75)), mats["chest_wood"], 0.7))
        # A foot under each end, so the table stands on timber rather than ending
        # in a cut edge where it meets the floor.
        parts.append((box(f"table_foot_{i}", (x, 0, 0.035), (0.24, 0.92, 0.07)), mats["chest_wood"], 0.7))
    parts.append((box("table_rail", (0, 0, 0.24), (1.7, 0.12, 0.09)), mats["chest_wood"], 0.7))
    return _finish(parts, root)


def build_bench(mats):
    root = _root("bench")
    parts = [
        (box("bench_seat", (0, 0, 0.44), (1.15, 0.36, 0.07)), mats["chest_wood"], 0.7),
    ]
    for i, x in enumerate((-0.42, 0.42)):
        parts.append((box(f"bench_leg_{i}", (x, 0, 0.205), (0.10, 0.30, 0.41)), mats["chest_wood"], 0.6))
    return _finish(parts, root)


# The other two reward containers, downloaded like the chests rather than turned
# here: ydd 3D's "Wooden old barrel" and Crazy0_0Cat's "Antique Wooden Crate"
# (both royalty_free). A lathe and a banded box were honest greyboxes, but they
# stood next to a photoscanned chest and lost. The crate ships as six plank
# meshes and needs no decimation at all (272 tris the lot).
BARREL_W = 0.56
BARREL_BUDGET = {"Wooden old barrel": 1200}
CRATE_W = 0.80
CRATE_BUDGET = {
    "Куб.001": 400, "Cube.009": 400, "Cube.008": 400,
    "Cube.007": 400, "Cube.006": 400, "Cube.005": 400,
}


def build_crate():
    # Both of these are authored for a lit studio render, so they arrive far
    # brighter than the chests: at the chests' 1.35 the crate was bare pine and
    # the barrel's head was clipped to flat white.
    #
    # Dimming alone did not save the crate: at 0.62 it still measured twice the
    # barrel's brightness at 1.7x its saturation, and stood in the hideout as
    # blond pine beside stained oak. It wears the barrel's palette instead — the
    # two stand together on the same reward anchors, so the barrel is the
    # reference, and BUILD_DIR holds its finished texture because main() builds
    # it first.
    return build_appended(
        "crate", "crate_wood", "crate.blend", CRATE_BUDGET,
        "Low_BaseColor.jpg", gain=1.0, roughness=0.85, width=CRATE_W,
        palette=os.path.join(BUILD_DIR, "barrel_wood.jpg"),
    )


def build_barrel():
    return build_appended(
        "barrel", "barrel_wood", "barrel.blend", BARREL_BUDGET,
        "barrel_basecolor.jpg", gain=0.8, roughness=0.8, width=BARREL_W,
    )


def build_pillar(mats):
    """A broken column, not a whole one.

    A standing pillar tall enough to read as architecture is tall enough to hide
    the player, and a short whole one reads as a bollard. Snapped off at chest
    height it is both: masonry in the silhouette and nothing in the way. The break
    is a slab set at an angle across the top, because a lathe is rotationally
    symmetric and a symmetric break is a machined cut.
    """
    root = _root("pillar")
    parts = [(box("pillar_plinth", (0, 0, 0.09), (0.74, 0.74, 0.18)), mats["pillar_stone"], 1.0)]
    drum = mesh_object("pillar_drum", *lathe([
        (0.0, 1.00), (0.255, 1.00),
        (0.265, 0.62), (0.285, 0.24), (0.30, 0.18),
        (0.0, 0.18),
    ], 20))
    parts.append((drum, mats["pillar_stone"], 1.0))
    break_slab = box("pillar_break", (0.03, -0.02, 1.04), (0.50, 0.46, 0.12))
    break_slab.rotation_euler = (math.radians(7.0), math.radians(-5.0), math.radians(12.0))
    parts.append((break_slab, mats["pillar_stone"], 1.0))
    return _finish(parts, root)


# How tall the bowl's rim stands. The renderer hangs the point light CLEAR above
# this (level with the lip, the bowl shadows the whole floor), so the number is
# shared: `BRAZIER_RIM_Y` and `BRAZIER_FLAME_Y` in render/lights.ts. The rim's
# RADIUS is shared too, as `BRAZIER_RIM_R` — the two together are the size of the
# shadow the bowl throws on the floor, which is most of how a brazier reads.
BRAZIER_RIM_Z = 1.02

# Where the legs stand under the bowl, and how far they lean out doing it. The
# foot lands at LEG_RING + half a leg-length of tan(splay) ~= 0.36, just inside
# the bowl's 0.40 rim: a tripod whose feet are narrower than what it carries
# reads as a stool someone balanced a dish on.
LEG_RING = 0.24
LEG_SPLAY = math.radians(16.0)


def build_brazier(mats):
    """A standing iron brazier: three splayed legs, a ring, a bowl of coals.

    The one prop in here built to be a LIGHT rather than furniture. Two things
    follow from that. The bowl is shallow and wide so the coals are visible from
    the game camera, which looks down at 45 degrees and would otherwise see an
    iron rim and a shadow. And the coal disc sits a little proud of the rim, so
    the glow reads from every side instead of only from above.

    Legs lean rather than stand: a tripod of vertical posts is a stool, and the
    splay is most of what says "iron" at this size.
    """
    root = _root("brazier")
    parts = []

    # Bowl: a lathe from the rim down to the foot it sits on.
    bowl = mesh_object("brazier_bowl", *lathe([
        (0.000, BRAZIER_RIM_Z - 0.10),   # inner floor
        (0.300, BRAZIER_RIM_Z - 0.12),
        (0.380, BRAZIER_RIM_Z),          # rim
        (0.400, BRAZIER_RIM_Z),
        (0.330, BRAZIER_RIM_Z - 0.16),   # outer wall, back under itself
        (0.150, BRAZIER_RIM_Z - 0.26),
        (0.000, BRAZIER_RIM_Z - 0.28),
    ], 20))
    parts.append((bowl, mats["iron"], 0.5))

    # Three legs, splayed out and down from under the bowl.
    #
    # The lean is ONE tilt turned to the leg's own bearing, and the order those
    # two happen in is the whole thing. Blender's default euler is XYZ, which
    # composes as Rz @ Ry @ Rx — the Z term rotates the tilt that the X and Y
    # terms already applied. Feeding it a tilt that was itself built out of
    # sin(a) and cos(a) therefore turned each leg through TWICE its own bearing:
    # the three legs leaned in three directions unrelated to where they stood,
    # one of them straight through the middle. A tripod of crossed wire.
    #
    # So: tip once about Y, negative, which drops the foot outward and tucks the
    # head in under the bowl, and let the Z term carry that single lean round to
    # the bearing. Nothing to cancel and nothing to compose.
    for i in range(3):
        a = 2.0 * math.pi * i / 3 + math.radians(20)
        leg = box(f"brazier_leg_{i}", (0, 0, 0), (0.07, 0.07, BRAZIER_RIM_Z - 0.18))
        leg.location = (
            math.cos(a) * LEG_RING,
            math.sin(a) * LEG_RING,
            (BRAZIER_RIM_Z - 0.18) / 2,
        )
        leg.rotation_euler = (0.0, -LEG_SPLAY, a)
        parts.append((leg, mats["iron"], 0.3))

    # A ring tying the legs together, the way a real one is braced. Its radius is
    # DERIVED from where the legs actually are at its own height: a hand-typed
    # ring is a hoop floating beside the iron the moment the splay changes.
    brace_z = 0.27
    brace_r = LEG_RING + ((BRAZIER_RIM_Z - 0.18) / 2 - brace_z) * math.tan(LEG_SPLAY)
    brace = mesh_object("brazier_brace", *lathe([
        (brace_r - 0.022, brace_z + 0.03), (brace_r + 0.022, brace_z + 0.03),
        (brace_r + 0.022, brace_z - 0.03), (brace_r - 0.022, brace_z - 0.03),
        (brace_r - 0.022, brace_z + 0.03),
    ], 16))
    parts.append((brace, mats["iron"], 0.4))

    root = _finish(parts, root)

    # The coals, added after `_finish` because they must NOT be bevelled,
    # box-mapped or smoothed: it is a flat disc showing one painted texture, and
    # every one of those steps would either round its edge into the bowl or
    # replace the painting with a projection of it.
    # Domed, not flat: coals heap up in the middle, and a disc reads as a plate.
    coals = mesh_object("brazier_coals", *lathe([
        (0.000, BRAZIER_RIM_Z - 0.030),
        (0.170, BRAZIER_RIM_Z - 0.055),
        (0.315, BRAZIER_RIM_Z - 0.090),
    ], 20))
    _disc_uv(coals, 0.315)
    coals.data.materials.append(mats["brazier_coal"])
    coals.parent = root
    return root


def _disc_uv(obj, radius):
    """Map a disc so the texture lands on it as a disc, centre to centre."""
    me = obj.data
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        x, y, _ = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (0.5 + x / (2 * radius), 0.5 + y / (2 * radius))


# --------------------------------------------------------------------------
# the ground drops
# --------------------------------------------------------------------------
#
# What a belt, the focus, currency and a waystone look like lying on the floor
# (render/ground-looks.ts; gear drops are cut from the wardrobe instead). Built
# at the size they lie at, a token of the item rather than its real size, and
# shaped after the item's inventory icon: at this camera an orb is some twenty
# pixels across, so silhouette and colour are the whole read. Glass, gold and
# runes emit well past the 6% floor so currency catches the eye (docs/09).
#
# Two are downloads: Chpndl _'s Stylized Scroll with Skull (royalty_free,
# e1746236-dfff-468f-8181-397d452ec3f2) for both scrolls, glow cards cut, and
# Klo Works' Potion Stylized LowPoly (royalty_free,
# a442ac26-01a8-4288-bdcd-61fad3dcd328) for alchemy. BlenderKit has no belt,
# focus, gem or waystone that reads as the icon, so those are built here.
SCROLL_W = 0.36
SCROLL_TRIS = 900
FLASK_W = 0.17
FLASK_BUDGET = {"Potion_low": 700, "Cap_low": 150}
# The oval a dropped belt lies in, and its strap.
BELT_A, BELT_B = 0.19, 0.12
BELT_T = 0.012


def flat_material(name, srgb, roughness, emit=EMISSION):
    """One colour, given as sRGB and squared into the linear value glTF stores."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    lin = tuple(c * c for c in srgb) + (1.0,)
    bsdf.inputs["Base Color"].default_value = lin
    bsdf.inputs["Emission Color"].default_value = lin
    bsdf.inputs["Emission Strength"].default_value = emit
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def _outward(obj):
    """Weld the lathe's seam and point every face out, whatever the profile's winding."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


def _dress(root, parts, smooth=40):
    """`_finish` without the bevel: a 1cm buckle bar bevelled at 8mm is a bead."""
    for obj, mat, tile in parts:
        _outward(obj)
        obj.data.materials.append(mat)
        if tile:
            uv_box(obj, tile)
        smooth_by_angle(obj, smooth)
        obj.parent = root
    return root


def _ball(r, steps=8, squash=1.0):
    """Profile of a sphere of radius r resting on z=0, top pole first."""
    return [(r * math.sin(math.pi * i / steps), squash * r * (1 + math.cos(math.pi * i / steps)))
            for i in range(steps + 1)]


def _hoop(r_in, r_out, z0, z1):
    return [(r_in, z1), (r_out, z1), (r_out, z0), (r_in, z0), (r_in, z1)]


def _strap_t(gap, s, segments):
    """Angle of step s along a strap that leaves `gap` radians open at the front."""
    return -math.pi / 2 + gap / 2 + (2 * math.pi - gap) * s / segments


def _strap(name, width, gap=0.0, thick=BELT_T, across=0.0, segments=40):
    """A strap lying flat round the BELT oval, seen from above as the belt's face.

    Stood on its edge it read as a hoop, and whatever hung on its far side faced
    away from the camera.
    """
    closed = gap == 0.0
    rings = segments if closed else segments + 1
    verts, faces = [], []
    for s in range(rings):
        t = _strap_t(gap, s, segments)
        nx, ny = _oval_normal(t)
        x, y = BELT_A * math.cos(t), BELT_B * math.sin(t)
        for off in (across - width / 2, across + width / 2):
            for z in (0.0, thick):
                verts.append((x + nx * off, y + ny * off, z))
    for s in range(segments):
        i, j = 4 * s, 4 * ((s + 1) % rings)
        faces += [[i + 2, j + 2, j + 3, i + 3], [i, i + 1, j + 1, j],
                  [i + 1, i + 3, j + 3, j + 1], [i, j, j + 2, i + 2]]
    if not closed:
        end = 4 * segments
        faces += [[0, 1, 3, 2], [end, end + 2, end + 3, end + 1]]
    return mesh_object(name, verts, faces)


def _oval_normal(t):
    nx, ny = math.cos(t) / BELT_A, math.sin(t) / BELT_B
    k = math.hypot(nx, ny)
    return nx / k, ny / k


def _on_strap(obj, t, z, along=0.0, across=0.0):
    """Lay a box built at the origin on the strap at angle t: x across it, y along it."""
    nx, ny = _oval_normal(t)
    obj.location = (BELT_A * math.cos(t) + nx * across - ny * along,
                    BELT_B * math.sin(t) + ny * across + nx * along, z)
    obj.rotation_euler = (0.0, 0.0, math.atan2(ny, nx))
    return obj


def _buckle(name, width, gap, mat):
    """A square frame lying past the strap's free end."""
    t = _strap_t(gap, 1, 1)
    w = width + 0.02
    pieces = [((w, 0.012, 0.012), 0.012, 0.0), ((w, 0.012, 0.012), 0.058, 0.0),
              ((0.012, 0.058, 0.012), 0.035, -w / 2 + 0.006), ((0.012, 0.058, 0.012), 0.035, w / 2 - 0.006)]
    return [(_on_strap(box(f"{name}_{i}", (0, 0, 0), size), t, 0.006, along, across), mat, 0)
            for i, (size, along, across) in enumerate(pieces)]


def leather_materials():
    """The wardrobe's BlenderKit leather, once dark (plate belt) and once brown (hunter's)."""
    path = os.path.join(SOURCE_DIR, "mat-aged-dark-leather.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.images = ["Aged Dark Leather_Color.jpg"]
    img = dst.images[0]
    # asset_material rewrites the pixels in place, so the second tone needs its own copy.
    twin = img.copy()
    twin.name = "leather_brown_src"
    return (asset_material("drop_leather_dark", img.name, gain=1.3, roughness=0.8),
            asset_material("drop_leather_brown", twin.name, gain=2.4, roughness=0.8))


def build_belts(mats):
    dark, brown = leather_materials()
    steel = mats["drop_steel"]

    # Ironsworn Girdle: wide dark leather under a row of iron plates.
    w, gap = 0.07, 0.55
    parts = [(_strap("beltIronsworn_strap", w, gap), dark, 0.12)] + _buckle("beltIronsworn_buckle", w, gap, steel)
    for i in range(6):
        t = _strap_t(gap, i + 0.5, 6)
        parts.append((_on_strap(box(f"beltIronsworn_plate_{i}", (0, 0, 0), (w - 0.016, 0.04, 0.008)),
                                t, BELT_T + 0.004), steel, 0))
    _dress(_root("beltIronsworn"), parts)

    # Stalker Strap: narrower brown leather carrying two pouches.
    w, gap = 0.05, 0.55
    parts = [(_strap("beltStalker_strap", w, gap), brown, 0.12)] + _buckle("beltStalker_buckle", w, gap, steel)
    for i, s in enumerate((0.3, 0.7)):
        parts.append((_on_strap(box(f"beltStalker_pouch_{i}", (0, 0, 0), (0.055, 0.065, 0.035)),
                                _strap_t(gap, s, 1), BELT_T + 0.0175), brown, 0.12))
    _dress(_root("beltStalker"), parts)

    # Ember Sash: charcoal cloth edged in red, knotted at the front, tails lying out.
    w = 0.075
    cloth, trim = mats["drop_sash"], mats["drop_sash_trim"]
    parts = [(_strap("beltEmber_cloth", w), cloth, 0)]
    for i, side in enumerate((-1, 1)):
        parts.append((_strap(f"beltEmber_trim_{i}", 0.012, thick=BELT_T + 0.004,
                             across=side * (w / 2 - 0.006)), trim, 0))
    knot = mesh_object("beltEmber_knot", *lathe(_ball(0.032, 6, 0.8), 10))
    knot.location = (0.0, -BELT_B - 0.03, 0.0)
    parts.append((knot, trim, 0))
    for i, side in enumerate((-1, 1)):
        tail = box(f"beltEmber_tail_{i}", (0, 0, 0), (0.05, 0.15, 0.01))
        tail.location = (side * 0.045, -BELT_B - 0.1, 0.005)
        tail.rotation_euler = (0.0, 0.0, side * 0.4)
        parts.append((tail, trim, 0))
    _dress(_root("beltEmber"), parts)


def build_focus(mats):
    """Ember Focus: a burning dome in an iron ring with four spikes, lying face up."""
    iron, coal = mats["drop_steel"], mats["brazier_coal"]
    parts = [
        (mesh_object("focusEmber_ring", *lathe(_hoop(0.105, 0.135, 0.0, 0.04), 20)), iron, 0),
        (mesh_object("focusEmber_back", *lathe([(0.0, 0.012), (0.11, 0.012), (0.11, 0.0), (0.0, 0.0)], 20)), iron, 0),
    ]
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        spike = cone(f"focusEmber_spike_{i}", (0, 0, 0), 0.022, 0.0, 0.06, "x", 8)
        spike.location = (math.cos(a) * 0.16, math.sin(a) * 0.16, 0.02)
        spike.rotation_euler = (0.0, 0.0, a)
        parts.append((spike, iron, 0))
    root = _dress(_root("focusEmber"), parts)
    dome = mesh_object("focusEmber_dome", *lathe(
        [(0.1 * math.sin(a), 0.012 + 0.07 * math.cos(a)) for a in (i * math.pi / 8 for i in range(5))]
        + [(0.0, 0.012)], 20))
    _outward(dome)
    _disc_uv(dome, 0.1)
    dome.data.materials.append(coal)
    smooth_by_angle(dome, 60)
    dome.parent = root


def build_orbs(mats):
    # Orb of Embers: a ball of the brazier's own coals.
    orb = mesh_object("orbEmbers_body", *lathe(_ball(0.1, 10), 20))
    _outward(orb)
    _disc_uv(orb, 0.1)
    orb.data.materials.append(mats["brazier_coal"])
    smooth_by_angle(orb, 60)
    orb.parent = _root("orbEmbers")

    # Orb of Transmutation: pale glass on a steel equator.
    _dress(_root("orbTransmutation"), [
        (mesh_object("orbTransmutation_glass", *lathe(_ball(0.1, 10), 20)), mats["drop_glass_blue"], 0),
        (mesh_object("orbTransmutation_band", *lathe(_hoop(0.097, 0.108, 0.088, 0.112), 20)), mats["drop_steel"], 0),
    ], smooth=60)

    # Orb of Augmentation: a violet teardrop vial, corked, lying on its side.
    lie = _root("orbAugmentation_lie")
    _dress(lie, [
        (mesh_object("orbAugmentation_glass", *lathe([
            (0.0, 0.2), (0.02, 0.2), (0.02, 0.175), (0.045, 0.14), (0.065, 0.09),
            (0.06, 0.05), (0.035, 0.018), (0.0, 0.0)], 16)), mats["drop_glass_violet"], 0),
        (mesh_object("orbAugmentation_cork", *lathe([
            (0.0, 0.245), (0.022, 0.245), (0.024, 0.198), (0.0, 0.198)], 12)), mats["drop_cork"], 0),
        (mesh_object("orbAugmentation_band", *lathe(_hoop(0.019, 0.027, 0.175, 0.19), 12)), mats["drop_vial_band"], 0),
    ], smooth=60)
    lie.rotation_euler = (math.pi / 2, 0.0, 0.0)
    lie.location = (0.0, 0.12, 0.065)
    lie.parent = _root("orbAugmentation")

    # Orb of Elevation: a faceted gold crystal banded at the waist.
    _dress(_root("orbElevation"), [
        (mesh_object("orbElevation_gem", *lathe([
            (0.0, 0.19), (0.05, 0.17), (0.085, 0.12), (0.085, 0.07), (0.05, 0.02), (0.0, 0.0)], 6)),
         mats["drop_gold"], 0),
        (mesh_object("orbElevation_band", *lathe(_hoop(0.083, 0.094, 0.085, 0.105), 6)), mats["drop_gold_dark"], 0),
    ], smooth=20)

    # Orb of Alchemy: the downloaded flask, lit from inside.
    build_appended(
        "orbAlchemy", "drop_alchemy", "potion_stylized_lowpoly.blend", FLASK_BUDGET,
        "Potion_Base_color.jpg", gain=1.4, roughness=0.4, width=FLASK_W,
        renames={"Potion_low": "orbAlchemy_flask", "Cap_low": "orbAlchemy_cap"},
    )
    bpy.data.materials["drop_alchemy"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.3


def _torus(name, major, tube, steps=12, segments=24):
    """A band lying flat on the floor: a circle profile spun about +Z."""
    prof = [(major + tube * math.cos(a), tube + tube * math.sin(a))
            for a in (math.pi / 2 - 2 * math.pi * i / steps for i in range(steps + 1))]
    return mesh_object(name, *lathe(prof, segments))


def _gem(name, r, at, segments=8):
    """A faceted stone sitting at `at`; eight sides keep the cut visible from above."""
    gem = mesh_object(name, *lathe(_ball(r, 4, 0.75), segments))
    gem.location = at
    return gem


def build_jewellery(mats):
    """One ring and one amulet per class family, after their icons.

    BlenderKit's only free match (0b99f826, a single "Fantasy Ring") would bring
    one texture for three families; at this camera the read is the band and the
    stone's colour, so these are flat colours like the belts.
    """
    steel, rune = mats["drop_steel"], mats["drop_rune"]
    ruby = flat_material("jewel_ruby", (0.9, 0.1, 0.12), 0.25, emit=0.6)
    amber = flat_material("jewel_amber", (1.0, 0.62, 0.15), 0.3, emit=0.5)
    sapphire = flat_material("jewel_sapphire", (0.2, 0.42, 1.0), 0.25, emit=0.6)
    pearl = flat_material("jewel_pearl", (0.95, 0.92, 1.0), 0.3, emit=0.35)
    bone = flat_material("jewel_bone", (0.85, 0.8, 0.66), 0.7)
    cord = flat_material("jewel_cord", (0.45, 0.3, 0.18), 0.9)
    iron = flat_material("jewel_iron", (0.27, 0.25, 0.24), 0.5)

    def ring(name, band, gem_mat, tube, gem_r, bezel):
        major = 0.08
        parts = [(_torus(f"{name}_band", major, tube), band, 0),
                 (_gem(f"{name}_gem", gem_r, (0.0, -major, tube * 1.6)), gem_mat, 0)]
        if bezel:
            parts.append((mesh_object(f"{name}_bezel", *lathe(_hoop(gem_r * 0.6, gem_r * 1.25, 0.0, tube * 2.0), 8)),
                          band, 0))
            parts[-1][0].location = (0.0, -major, 0.0)
        _dress(_root(name), parts, smooth=20)

    ring("ringIronsworn", steel, ruby, 0.024, 0.038, True)
    ring("ringStalker", bone, sapphire, 0.02, 0.03, True)
    ring("ringEmber", iron, rune, 0.024, 0.042, False)

    def amulet(name, chain, tube, pendant):
        major = 0.12
        loop = _torus(f"{name}_chain", major, tube, steps=8, segments=28)
        loop.location = (0.0, 0.05, 0.0)
        parts = [(loop, chain, 0)]
        for obj, mat in pendant(name, 0.05 - major):
            parts.append((obj, mat, 0))
        _dress(_root(name), parts, smooth=20)

    def torc(name, y):
        disc = mesh_object(f"{name}_mount", *lathe([(0.0, 0.022), (0.055, 0.022), (0.055, 0.0), (0.0, 0.0)], 16))
        disc.location = (0.0, y - 0.03, 0.0)
        return [(disc, steel), (_gem(f"{name}_gem", 0.04, (0.0, y - 0.03, 0.02)), amber)]

    def talisman(name, y):
        claw = cone(f"{name}_claw", (0.0, y - 0.08, 0.03), 0.004, 0.03, 0.12, "y", 8)
        return [(claw, bone), (_gem(f"{name}_pearl", 0.03, (0.0, y - 0.005, 0.0)), pearl)]

    def shard(name, y):
        fang = cone(f"{name}_shard", (0.0, y - 0.085, 0.04), 0.004, 0.045, 0.13, "y", 6)
        return [(fang, bone), (_gem(f"{name}_ember", 0.026, (0.0, y - 0.035, 0.06)), rune)]

    amulet("amuletIronsworn", steel, 0.016, torc)
    amulet("amuletStalker", cord, 0.008, talisman)
    amulet("amuletEmber", iron, 0.01, shard)


def build_scrolls():
    """Wisdom and Portal share one scroll mesh; the portal adds a violet glow in each end."""
    body, = append_objects("srylized_scroll_with_skull.blend", ["Prop_Scroll"])
    bm = bmesh.new()
    bm.from_mesh(body.data)
    # The glow cards flaring past each end are the second slot.
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == 1], context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    decimate_to(body, SCROLL_TRIS)
    art = bpy.data.images["PropT_Scroll_Base_color.jpg"]
    art_portal = art.copy()  # asset_material rewrites pixels in place
    art_portal.name = "scroll_portal_src"
    body.data.materials.clear()
    body.data.materials.append(asset_material("drop_scroll", art.name, gain=1.0, roughness=0.85))
    smooth_by_angle(body, 40)
    body.name = "scrollWisdom_body"
    twin = body.copy()
    twin.data = body.data.copy()
    twin.name = "scrollPortal_body"
    bpy.context.scene.collection.objects.link(twin)
    # The icon's portal sits in the roll's end, which faces sideways from this
    # camera; the whole scroll glowing violet is what reads from above.
    portal = asset_material("drop_scroll_portal", art_portal.name, gain=1.0, roughness=0.85, tint=(0.55, 0.6, 1.6))
    portal.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.35
    twin.data.materials[0] = portal
    bpy.context.view_layer.update()
    for name, part in (("scrollWisdom", body), ("scrollPortal", twin)):
        _carry(name, [part], SCROLL_W).parent = _root(name)


def build_waystone(mats):
    """A hexagonal slab lying flat, a brass band across it and a burning rune on top."""
    parts = [
        (mesh_object("waystone_slab", *lathe([(0.0, 0.06), (0.15, 0.06), (0.15, 0.0), (0.0, 0.0)], 6)),
         mats["pillar_stone"], 0.3),
        (box("waystone_band", (0.0, 0.0, 0.032), (0.045, 0.262, 0.066)), mats["drop_brass"], 0),
    ]
    for i, deg in enumerate((90, 210, 330)):
        a = math.radians(deg)
        bar = box(f"waystone_rune_{i}", (0, 0, 0), (0.085, 0.018, 0.006))
        bar.location = (math.cos(a) * 0.045, math.sin(a) * 0.045, 0.068)
        bar.rotation_euler = (0.0, 0.0, a)
        parts.append((bar, mats["drop_rune"], 0))
    _dress(_root("waystone"), parts, smooth=30)


# Gold on the floor: Kin Chen's Gold coin (BlenderKit 33cac94b-32f4-4ce1-8a36-a0d9713523f7,
# cc_zero) copied into a small heap. The scan is a 20k-triangle relief a 7 cm coin
# at this camera never shows, and collapsing the relief itself leaves ragged
# wafers, so both faces are pressed flat first and only the disc is cut to budget.
# Its own gold, not `drop_gold`: that one is the Elevation crystal's.
GOLD_COIN_W = 0.12          # a heap about half a unit across is the smallest that reads at game distance
GOLD_COIN_THICK = 1.4        # the scan's 12% of a diameter reads as foil from nine metres
GOLD_COIN_TRIS = 36
GOLD_COIN_SRGB = (0.93, 0.66, 0.16)   # the source's linear (0.887, 0.413, 0.024), unsquared
# (ring radius in diameters, angle deg, layer, outward slope deg) per coin: a
# scattered floor ring, two shoulders sloping off the middle, a top coin and one
# leaning on the heap. Authored, not seeded, so the heap is one shape everywhere.
GOLD_PILE = (
    (0.0, 0, 0, 3), (1.55, 10, 0, 6), (1.6, 62, 0, -4), (1.45, 118, 0, 8), (1.65, 170, 0, 5),
    (1.5, 222, 0, -6), (1.6, 275, 0, 7), (1.5, 322, 0, 4),
    (0.85, 35, 1, 16), (0.8, 105, 1, 18), (0.9, 180, 1, 14), (0.8, 250, 1, 17), (0.85, 310, 1, 15),
    (0.35, 70, 2, 12), (0.4, 200, 2, 10), (0.3, 320, 2, 13),
    (0.05, 150, 3, 7),
    (1.2, 140, 1, 62),
)


def build_gold_pile():
    coin, = append_objects("gold_coin.blend", ["goldcoin"])
    # Its parent stood it face-up; the mesh itself is authored on edge.
    coin.data.transform(coin.matrix_world)
    coin.matrix_world = mathutils.Matrix.Identity(4)
    bpy.context.view_layer.update()
    lo, hi = bounds([coin])
    size = hi - lo
    # Flat on the floor, one diameter across, its own centre at the origin.
    coin.data.transform(mathutils.Matrix.Translation(-(lo + hi) / 2))
    k = GOLD_COIN_W / max(size.x, size.y)
    coin.data.transform(mathutils.Matrix.Diagonal((k, k, k * GOLD_COIN_THICK, 1.0)))
    half = size.z * k * GOLD_COIN_THICK / 2
    for v in coin.data.vertices:
        if abs(v.co.z) > half * 0.4:
            v.co.z = math.copysign(half, v.co.z)
    decimate_to(coin, GOLD_COIN_TRIS)
    coin.data.materials.clear()
    coin.data.materials.append(flat_material("gold_coin", GOLD_COIN_SRGB, 0.35, emit=0.5))
    smooth_by_angle(coin, 40)
    bm = bmesh.new()
    for r, deg, layer, slope in GOLD_PILE:
        a = math.radians(deg)
        # Outer rim down: turned to face its ring angle, then tipped about the tangent.
        lift = half + layer * 2.2 * half + GOLD_COIN_W / 2 * math.sin(math.radians(abs(slope)))
        m = (mathutils.Matrix.Translation((r * GOLD_COIN_W * math.cos(a), r * GOLD_COIN_W * math.sin(a), lift))
             @ mathutils.Matrix.Rotation(a, 4, "Z")
             @ mathutils.Matrix.Rotation(math.radians(slope), 4, "Y"))
        piece = coin.data.copy()
        piece.transform(m)
        bm.from_mesh(piece)
        bpy.data.meshes.remove(piece)
    bm.to_mesh(coin.data)
    bm.free()
    coin.name = coin.data.name = "goldPile_coins"
    coin.parent = _root("goldPile")
    print(f"goldPile: {len(GOLD_PILE)} coins, {sum(len(p.vertices) - 2 for p in coin.data.polygons)} tris")


def build_drops(mats):
    mats = dict(mats, **{
        "drop_steel": flat_material("drop_steel", (0.6, 0.6, 0.63), 0.4),
        "drop_brass": flat_material("drop_brass", (0.75, 0.58, 0.25), 0.4),
        "drop_glass_blue": flat_material("drop_glass_blue", (0.62, 0.85, 1.0), 0.2, emit=0.25),
        "drop_glass_violet": flat_material("drop_glass_violet", (0.45, 0.25, 0.95), 0.2, emit=0.5),
        "drop_gold": flat_material("drop_gold", (1.0, 0.78, 0.25), 0.3, emit=0.35),
        "drop_gold_dark": flat_material("drop_gold_dark", (0.62, 0.45, 0.12), 0.4, emit=0.1),
        "drop_cork": flat_material("drop_cork", (0.6, 0.42, 0.25), 0.9),
        "drop_vial_band": flat_material("drop_vial_band", (0.55, 0.1, 0.12), 0.6),
        "drop_rune": flat_material("drop_rune", (1.0, 0.45, 0.1), 0.5, emit=0.9),
        "drop_sash": flat_material("drop_sash", (0.32, 0.29, 0.29), 0.95),
        "drop_sash_trim": flat_material("drop_sash_trim", (0.6, 0.1, 0.08), 0.9),
    })
    build_belts(mats)
    build_focus(mats)
    build_jewellery(mats)
    build_orbs(mats)
    build_scrolls()
    build_waystone(mats)
    build_gold_pile()


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    built = prepare_textures()
    mats = {
        "brass_top": textured_material("brass_top", built["brass_top"], 0.42),
        "brass_side": textured_material("brass_side", built["brass_side"], 0.45),
        "chest_wood": textured_material("chest_wood", built["chest_wood"], 0.85),
        "iron": textured_material("iron", built["iron"], 0.55),
        # Cloth and masonry for the decor set. The rug is rougher than the timber
        # (a carpet has no sheen at all) and the stone rougher still.
        "rug": textured_material("rug", built["rug"], 0.96),
        "pillar_stone": textured_material("pillar_stone", built["pillar_stone"], 0.92),
        "brazier_coal": coal_material("brazier_coal", built["brazier_coal"]),
    }

    build_map_device(mats)
    build_stash()
    build_loot_chest()
    build_driftwood()
    build_shell()
    build_coast_rock()
    build_wreck_timber()
    build_bones()
    build_dead_tree()  # after the driftwood: it is palettized onto its texture
    build_skull()
    build_ribcage()
    build_ruin_wall()
    build_pot()
    build_forest()
    build_swamp()
    build_vaal()  # after the ruin wall: it re-dresses the same source
    build_rug(mats)
    build_table(mats)
    build_bench(mats)
    build_barrel()  # before the crate: the crate is palettized onto its texture
    build_crate()
    build_pillar(mats)
    build_brazier(mats)
    build_drops(mats)

    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",  # the built textures are already JPEG
        export_cameras=False,
        export_lights=False,
    )
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


main()
