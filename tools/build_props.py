"""Build the hideout props as one glTF: the map device and the stash chest.

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
import numpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_DIR = os.path.join(ROOT, "assets", "props")
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
TEX_GAIN = {"chest_wood": 1.5, "iron": 1.25, "rug": 0.7, "pillar_stone": 1.15}

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


def dome(name, x0, x1, ry, rz, z0, segments=20):
    """Half-ellipse cross-section swept along X — the chest lid and its straps.

    A full half-circle lid (rise = half the depth) domes so high the chest reads
    as a barrel; the reference chests rise about a third of their depth, so the
    section is an ellipse and `rz` is free.
    """
    section = []
    for i in range(segments + 1):
        a = -math.pi / 2 + math.pi * i / segments
        section.append((ry * math.sin(a), z0 + rz * math.cos(a)))

    verts = [(x0, y, z) for y, z in section] + [(x1, y, z) for y, z in section]
    n = len(section)
    faces = []
    for s in range(n - 1):
        faces.append([s, n + s, n + s + 1, s + 1])
    faces.append(list(range(n)))                      # cap at x0
    faces.append(list(range(2 * n - 1, n - 1, -1)))   # cap at x1
    faces.append([0, n - 1, 2 * n - 1, n])            # flat underside
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


def flat_material(name, rgb, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
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


# The chest keeps the primitives' footprint too: a 1.6 x 1.15 step, a 1.35 x 0.85
# body. Only the lid moved — a half-round lid rises 0.42 and reads as a barrel,
# so it is an ellipse rising 0.26.
CHEST_BODY = (1.35, 0.85, 0.60)
CHEST_BODY_Z = 0.12
CHEST_LID_RISE = 0.30
STRAP_X = (-0.42, 0.42)


def build_stash(mats):
    root = bpy.data.objects.new("stash", None)
    bpy.context.scene.collection.objects.link(root)
    # The chest is built facing -Y, and two axis conversions stand between here
    # and the game: Blender Z-up to glTF Y-up, then glTF right-handed to Babylon
    # left-handed. They land -Y away from the camera, so the lock and hinges swap
    # places and the stash presents its back. Turned once, at the root.
    root.rotation_euler = (0.0, 0.0, math.pi)

    w, d, h = CHEST_BODY
    top = CHEST_BODY_Z + h

    parts = []
    step = box("stash_step", (0, 0, 0.06), (1.60, 1.15, 0.12))
    parts.append((step, mats["stone"], 1.0))

    body = box("stash_body", (0, 0, CHEST_BODY_Z + h / 2), (w, d, h))
    parts.append((body, mats["chest_wood"], 0.62))

    # Sunk 0.02 into the body: a lid resting exactly on the top face gives two
    # coplanar surfaces and a z-fighting seam right along the eye line.
    lid = dome("stash_lid", -w / 2 - 0.02, w / 2 + 0.02, d / 2 + 0.015, CHEST_LID_RISE, top - 0.02)
    parts.append((lid, mats["chest_wood"], 0.62))

    for i, x in enumerate(STRAP_X):
        strap = box(f"stash_strap_{i}", (x, 0, CHEST_BODY_Z + h / 2), (0.10, d + 0.04, h + 0.03))
        parts.append((strap, mats["iron"], 0.45))
        band = dome(f"stash_band_{i}", x - 0.05, x + 0.05, d / 2 + 0.032, CHEST_LID_RISE + 0.017, top - 0.02)
        parts.append((band, mats["iron"], 0.45))
        for z in (CHEST_BODY_Z + 0.12, top - 0.12):
            for y, sign in ((-d / 2 - 0.02, -1), (d / 2 + 0.02, 1)):
                rivet = cone(f"stash_rivet_{i}", (x, y, z), 0.028, 0.020, 0.05 * sign, "y")
                parts.append((rivet, mats["iron"], 0.45))

    # The hasp reads as one piece of iron: a band over the lid's centre coming
    # down into the lock plate. A lock plate on its own reads as a box someone
    # nailed to the front.
    hasp = dome("stash_hasp", -0.06, 0.06, d / 2 + 0.032, CHEST_LID_RISE + 0.017, top - 0.02)
    parts.append((hasp, mats["iron"], 0.45))
    # Wider than the band that lands on it, or the plate is two slivers peeking
    # out from behind the hasp and the chest reads as having no lock at all.
    lock = box("stash_lock", (0, -d / 2 - 0.025, top - 0.13), (0.32, 0.05, 0.22))
    parts.append((lock, mats["iron"], 0.45))
    for x in (-0.18, 0.18):
        hinge = cone("stash_hinge", (x, d / 2 + 0.01, top - 0.03), 0.035, 0.035, 0.16, "x")
        parts.append((hinge, mats["iron"], 0.45))

    for obj, mat, tile in parts:
        bevel(obj)
        obj.data.materials.append(mat)
        uv_box(obj, tile)
        smooth_by_angle(obj, 40)
        obj.parent = root
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


def build_crate(mats):
    """A crate, banded rather than nailed: two irons read at fifty pixels, a
    hundred nail heads do not."""
    root = _root("crate")
    parts = [(box("crate_body", (0, 0, 0.31), (0.62, 0.62, 0.62)), mats["chest_wood"], 0.55)]
    for i, z in enumerate((0.14, 0.48)):
        parts.append((box(f"crate_band_x_{i}", (0, 0, z), (0.66, 0.09, 0.09)), mats["iron"], 0.4))
        parts.append((box(f"crate_band_y_{i}", (0, 0, z), (0.09, 0.66, 0.09)), mats["iron"], 0.4))
    return _finish(parts, root)


def build_barrel(mats):
    """Staved barrel: one lathe for the timber, two short cylinders for the hoops.

    The profile bulges at the waist because a barrel that does not is a bin, and
    the bulge is the whole silhouette from above.
    """
    root = _root("barrel")
    profile = [
        (0.0, 0.80), (0.20, 0.80),
        (0.255, 0.66), (0.285, 0.40), (0.255, 0.14),
        (0.20, 0.0), (0.0, 0.0),
    ]
    staves = mesh_object("barrel_staves", *lathe(profile, 18))
    parts = [(staves, mats["chest_wood"], 0.7)]
    for i, z in enumerate((0.20, 0.60)):
        hoop = cone(f"barrel_hoop_{i}", (0, 0, z), 0.272, 0.272, 0.08, "z")
        parts.append((hoop, mats["iron"], 0.35))
    return _finish(parts, root)


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


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    built = prepare_textures()
    mats = {
        "brass_top": textured_material("brass_top", built["brass_top"], 0.42),
        "brass_side": textured_material("brass_side", built["brass_side"], 0.45),
        "chest_wood": textured_material("chest_wood", built["chest_wood"], 0.85),
        "iron": textured_material("iron", built["iron"], 0.55),
        # glTF base colour is LINEAR, and the Babylon material it becomes gamma
        # corrects it on the way out: the 0.17 the primitive step used renders at
        # 0.45 here, a poured-concrete slab under a chest made of real timber art.
        # 0.023 linear is that same 0.17 on screen.
        "stone": flat_material("stone", (0.023, 0.022, 0.020), 0.95),
        # Cloth and masonry for the decor set. The rug is rougher than the timber
        # (a carpet has no sheen at all) and the stone rougher still.
        "rug": textured_material("rug", built["rug"], 0.96),
        "pillar_stone": textured_material("pillar_stone", built["pillar_stone"], 0.92),
    }

    build_map_device(mats)
    build_stash(mats)
    build_rug(mats)
    build_table(mats)
    build_bench(mats)
    build_crate(mats)
    build_barrel(mats)
    build_pillar(mats)

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
