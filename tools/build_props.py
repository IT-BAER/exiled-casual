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
import sys

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


def asset_material(name, image_name, gain, roughness, palette=None):
    """A textured_material built from an image PACKED in an appended .blend.

    `palette` re-dresses the texture in another one's colours: the source is
    normalised across its own luminance span and looked up in a ramp sampled
    from the palette image, so it keeps every plank, nail and scratch it was
    authored with and wears the other asset's tone and saturation. Same trick as
    tools/build_gear_textures.py. A flat gain cannot do this job — two assets
    downloaded from different authors differ in how saturated and how bright
    their wood is, and scaling one until it is dark enough leaves it a
    washed-out version of the other's colour.
    """
    img = bpy.data.images.get(image_name)
    if img is None:
        sys.exit("appended asset carries no image named " + image_name)
    img.scale(TEX_SIZE, TEX_SIZE)
    if gain != 1.0 or palette:
        px = numpy.empty(len(img.pixels), dtype=numpy.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(-1, 4)[:, :3]
        numpy.clip(rgb * gain, 0.0, 1.0, out=rgb)
        if palette:
            ramp = _palette_ramp(palette)
            lum = rgb @ LUMA
            span = numpy.quantile(lum, (PALETTE_CLIP, 1.0 - PALETTE_CLIP))
            t = numpy.clip((lum - span[0]) / max(span[1] - span[0], 1e-6), 0.0, 1.0)
            rgb[:] = ramp[(t * (len(ramp) - 1)).astype(numpy.int32)]
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
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        smooth_by_angle(obj, 40)
    for obj in parts:
        obj.name = (renames or {}).get(obj.name, obj.name)

    carrier = bpy.data.objects.new(name + "_scale", None)
    bpy.context.scene.collection.objects.link(carrier)
    lo, hi = bounds(parts)
    scale = width / max(hi.x - lo.x, hi.y - lo.y)
    carrier.scale = (scale, scale, scale)
    carrier.location = (-(lo.x + hi.x) / 2 * scale, -(lo.y + hi.y) / 2 * scale, -lo.z * scale)
    for obj in parts:
        obj.parent = carrier
    carrier.parent = root
    return root


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
        # Wreck wood is dark: soaked, tarred and weathered, and the reference
        # timbers read nearly black against the sand under the beach's 2.4x sun.
        "Материал_BaseColor.jpg.001", gain=0.55, roughness=0.9, width=WRECK_TIMBER_W,
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
    build_rug(mats)
    build_table(mats)
    build_bench(mats)
    build_barrel()  # before the crate: the crate is palettized onto its texture
    build_crate()
    build_pillar(mats)
    build_brazier(mats)

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
