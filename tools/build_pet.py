"""Build assets/pets/pet.glb: the companion cat, a floating dark magical cat that
follows the player (PoE1's Celestial Cat Pet, watched frame by frame).

  blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
      --python tools/build_pet.py

then `node tools/pack_pet.mjs` for the served copy.

Source: BlenderKit "Domestic cat (rigged)" (assets/pets/SOURCE.md), a 0.54 m
standing cat with hair particles and an IK posing rig. This strips the hair, the
subsurf and the IK, hangs the fore legs on the chest, lengthens the tail,
decimates to the pet budget, paints the coat (true black with white point stars,
dense on the head and back; electric-blue veins on the chest and legs), paints
cyan half-moon eyes, and authors ten NLA clips on the cat's own bones, each
matched to PoE footage (assets/pets/SOURCE.md):

  hover      loop  held in the air: legs hanging loose, tail hooked under, paddle
  gallop     loop  the rotary gallop it runs in the air beside a moving player
  lie_side   loop  flopped on its side on the floor
  roll_back  once  onto its back, paws in the air, and back
  curl       loop  a ring on the floor, nose to tail
  stretch    once  fore legs long and rump up, then a hind leg kicked back
  rear_up    once  up on the hind legs against the player, patting; ends reared
  spring     once  from the rear to the vertical, driving up
  swim       loop  stretched out high in the air, paddling and twisting
  dive       once  head-first down, levelling off to land on its feet

Floor clips are solved per frame so the lowest point of the body rests on the
floor (root origin = floor); the air clips are lifted by the runtime. Facing: the
cat's nose points -Y in Blender, which is where every monster's nose lands after
its own pi turn (see Creature.emit in build_monsters.py), so the renderer's
`atan2(dx, dz)` yaw convention holds without a root rotation.
"""
import math
import os
import sys

import bpy
import numpy
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PET_DIR = os.path.join(ROOT, "assets", "pets")
SOURCE = os.path.join(PET_DIR, "source", "domestic_cat_1k.blend")
OUT = os.path.join(PET_DIR, "pet.glb")

ID = "pet.cat.v1"
FPS = 30
# Real cat length is 0.54 units; from nineteen units up that is a mouse. Scaled so
# it reads as a cat beside a 1.8-unit character without crowding him.
SCALE = 1.25
# Body triangle budget. The source body is 18k before subsurf; the eyes 3.8k.
BODY_TRIS = 9000
EYE_TRIS = 1200
TEX = 1024
EYE_TEX = 256
# Coat: the fur sheet multiplied down to black, its stripes a bare hint.
COAT_GAIN = (0.035, 0.03, 0.05)
# Stars per square unit of UV, by region (the video's portrait: a dense dusting on
# the head and along the back, sparse on the belly and legs).
STAR_DENSITY = {"head": 9000, "back": 5200, "flank": 1800, "under": 500}
STAR_SEED = 7
# Veins: jagged electric-blue streaks on the chest and the legs.
VEIN_COLOR = (0.22, 0.42, 1.0)
VEIN_COUNT = {"chest": 5, "leg": 7}
EMISSION_STRENGTH = 2.5
EYE_COLOR = (0.30, 0.95, 1.00)
EYE_STRENGTH = 4.0
# Tail length factor from its root (see stretch_tail).
TAIL_STRETCH = 1.7

# Source rig names -> ours. The sculptor numbered the spine.
RENAME = {"Bone.001": "chest", "Bone.002": "neck", "Bone.004": "head",
          "CONTROLLER": "root"}
# Posing helpers and IK poles: no weights, no use once the IK is gone.
DROP_BONES = ["leg3_control_R", "paw_control_R", "paw_control_L",
              "leg2_pole2_R", "leg2_pole2_L", "paw_pole_R", "paw_pole_L"]
# Children of dropped bones, re-hung on the limb they end.
REPARENT = {"feet_R": "leg3_R", "paw3_R": "paw2_R", "paw3_L": "paw2_L",
            "leg3_control_L": "leg3_L"}
# Particle and mask groups the hair used; not bones.
DROP_GROUPS = ["BODY", "FACE", "whiskers", "EYES"]


def fail(msg):
    sys.exit("build_pet: " + msg)


# --------------------------------------------------------------------------
# import and clean
# --------------------------------------------------------------------------

def append_cat():
    if not os.path.exists(SOURCE):
        fail("missing source " + SOURCE)
    with bpy.data.libraries.load(SOURCE, link=False) as (src, dst):
        dst.objects = ["Armature.001", "sculpt.001", "Eye1"]
    objs = {o.name: o for o in dst.objects if o is not None}
    for o in objs.values():
        bpy.context.scene.collection.objects.link(o)
    # A library-loaded object answers matrix_world as IDENTITY until the view
    # layer has been evaluated once; bake_world reads it.
    bpy.context.view_layer.update()
    arm, body, eyes = objs["Armature.001"], objs["sculpt.001"], objs["Eye1"]
    # The parent empty came along as a dependency: the armature is the root now.
    arm.parent = None
    arm.matrix_world = Matrix.Identity(4)
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)
    return arm, body, eyes


def bake_world(ob, arm):
    """Fold the object's transform into its vertices and hang it on the armature
    with an identity transform, so the armature modifier and the export see the
    same space. Scales by SCALE on the way."""
    m = ob.matrix_world
    for v in ob.data.vertices:
        v.co = (m @ v.co) * SCALE
    ob.data.update()
    ob.parent = arm
    ob.parent_type = "OBJECT"
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.matrix_basis = Matrix.Identity(4)


def strip_modifiers(ob):
    for mod in list(ob.modifiers):
        if mod.type != "ARMATURE":
            ob.modifiers.remove(mod)
    for g in list(ob.vertex_groups):
        if g.name in DROP_GROUPS:
            ob.vertex_groups.remove(g)
    # One UV set: the eyes carry a second, unused "automap" layer.
    while len(ob.data.uv_layers) > 1:
        ob.data.uv_layers.remove(ob.data.uv_layers[-1])
    for p in ob.data.polygons:
        p.use_smooth = True


def decimate(ob, budget):
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris <= budget:
        return tris
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.ratio = budget / tris
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=ob, active_object=ob,
                                   selected_editable_objects=[ob], selected_objects=[ob]):
        bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def clean_rig(arm, meshes):
    """Drop the IK, the helper bones and the numbering, scale the rest pose."""
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.rotation_mode = "QUATERNION"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for child, parent in REPARENT.items():
        eb[child].parent = eb[parent]
        eb[child].use_connect = False
    # The source hangs the fore legs off the pelvis: a chest that bends would tear
    # the shoulders off them. On the chest, the curl and the arch carry them along.
    for side in "LR":
        eb["paw1_" + side].parent = eb["Bone.001"]
    for name in DROP_BONES:
        eb.remove(eb[name])
    for b in eb:
        b.head = b.head * SCALE
        b.tail = b.tail * SCALE
        b.use_deform = True
    for old, new in RENAME.items():
        eb[old].name = new
    bpy.ops.object.mode_set(mode="OBJECT")
    for m in meshes:
        for g in m.vertex_groups:
            if g.name in RENAME:
                g.name = RENAME[g.name]
            elif g.name in DROP_BONES:
                m.vertex_groups.remove(g)


def stretch_tail(arm, body):
    """Lengthen the tail by TAIL_STRETCH from its root (the source's is 0.6 of
    the body, PoE's about the body's own length) and re-rig it: the sculptor's
    tail bones run above the mesh and the last one turns back toward the body,
    so every tail pose sheared the skin into a ribbon. The five bones are laid
    evenly down the mesh's own centreline and the tail beyond its root is
    re-weighted to them as overlapping tents."""
    index = {body.vertex_groups[n].index for n in TAIL}
    tail_w = {}
    for v in body.data.vertices:
        w = min(1.0, sum(g.weight for g in v.groups if g.group in index))
        if w > 0:
            tail_w[v.index] = w
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    base = eb[TAIL[0]].head.copy()
    y0 = base.y
    for i, w in tail_w.items():
        co = body.data.vertices[i].co
        if co.y > y0:
            co.y += w * (co.y - y0) * (TAIL_STRETCH - 1)
    pts = numpy.array([tuple(body.data.vertices[i].co) for i, w in tail_w.items() if w > 0.5 and body.data.vertices[i].co.y > y0])
    tip = float(pts[:, 1].max())
    seg = (tip - y0) / len(TAIL)

    def centre(y):
        near = pts[numpy.abs(pts[:, 1] - y) < seg * 0.35]
        if len(near) == 0:
            return Vector((base.x, y, base.z))
        return Vector((float(near[:, 0].mean()), y, float(near[:, 2].mean())))

    joints = [base] + [centre(y0 + seg * k) for k in range(1, len(TAIL))] + [centre(tip - seg * 0.05)]
    joints[-1].y = tip
    for k, name in enumerate(TAIL):
        b = eb[name]
        b.use_connect = False
        b.head = joints[k]
        b.tail = joints[k + 1]
        b.roll = 0.0
        if k:
            b.parent = eb[TAIL[k - 1]]
            b.use_connect = True
    bpy.ops.object.mode_set(mode="OBJECT")
    deform = {g.index for g in body.vertex_groups if g.name in arm.data.bones}
    groups = {g.index: g for g in body.vertex_groups}
    moved = 0
    for i, w in tail_w.items():
        v = body.data.vertices[i]
        s = (v.co.y - y0) / seg
        if w < 0.5 or s <= 0.5:
            continue  # the root blends into the rump on the source weights
        for g in list(v.groups):
            if g.group in deform:
                groups[g.group].remove([i])
        for k, name in enumerate(TAIL):
            tent = max(0.0, 1.0 - abs(s - (k + 0.5)))
            if k == len(TAIL) - 1 and s > k + 0.5:
                tent = 1.0
            if tent > 0:
                body.vertex_groups[name].add([i], tent, "REPLACE")
        moved += 1
    body.data.update()
    print("tail: %.3f long, %d vertices re-weighted" % (tip - y0, moved))


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------

def gained(img, gain, size, name):
    """A copy of `img` with RGB multiplied by `gain`, scaled to `size`, packed."""
    out = img.copy()
    out.name = name
    out.scale(size, size)
    px = numpy.empty(size * size * 4, dtype=numpy.float32)
    out.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    px[:, :3] *= numpy.asarray(gain if hasattr(gain, "__len__") else (gain,) * 3, dtype=numpy.float32)
    out.pixels.foreach_set(px.ravel())
    out.pack()
    return out


def packed(name, size, rgb):
    """A new packed image from an (size, size, 3) float array, row 0 at the bottom."""
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    px = numpy.ones((size, size, 4), dtype=numpy.float32)
    px[:, :, :3] = numpy.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def mesh_arrays(ob):
    """Triangles of `ob` as (tri_uv[n,3,2], tri_pos[n,3,3] world, tri_area_uv[n])."""
    me = ob.data
    me.calc_loop_triangles()
    tris = me.loop_triangles
    n = len(tris)
    loops = numpy.empty(n * 3, dtype=numpy.int64)
    tris.foreach_get("loops", loops)
    verts = numpy.empty(n * 3, dtype=numpy.int64)
    tris.foreach_get("vertices", verts)
    uv = numpy.empty(len(me.loops) * 2, dtype=numpy.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)[loops].reshape(n, 3, 2)
    co = numpy.empty(len(me.vertices) * 3, dtype=numpy.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    m = numpy.asarray(ob.matrix_world, dtype=numpy.float32)
    co = co @ m[:3, :3].T + m[:3, 3]
    pos = co[verts].reshape(n, 3, 3)
    e1 = uv[:, 1] - uv[:, 0]
    e2 = uv[:, 2] - uv[:, 0]
    area = 0.5 * numpy.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    return uv, pos, area


def region_of(centre, lo, hi):
    """Which star region a body point sits in, by its place on the standing cat."""
    y = (centre[1] - lo[1]) / (hi[1] - lo[1])   # 0 nose .. 1 tail tip
    z = (centre[2] - lo[2]) / (hi[2] - lo[2])   # 0 soles .. 1 crown
    if y < 0.22 and z > 0.55:
        return "head"
    if z > 0.6:
        return "back"
    if z > 0.3:
        return "flank"
    return "under"


def splat(img, pts, size, rgb, radius):
    """Add `rgb` at each UV point as a soft dot of `radius` pixels."""
    h = int(math.ceil(radius))
    oy, ox = numpy.mgrid[-h:h + 1, -h:h + 1]
    kernel = numpy.clip(1.0 - numpy.hypot(ox, oy) / (radius + 0.5), 0, 1) ** 1.5
    rgb = numpy.asarray(rgb, dtype=numpy.float32)
    xs0 = numpy.arange(-h, h + 1)
    for u, v, gain in pts:
        cx = int(u * size) % size
        cy = int(v * size) % size
        xs = (cx + xs0) % size
        for ky in range(2 * h + 1):
            yy = (cy + ky - h) % size
            img[yy, xs] += kernel[ky][:, None] * rgb * gain


def paint_stars(img, uv, pos, area, rng, lo, hi):
    """Scatter point stars over the coat, the count per triangle by its region."""
    centres = pos.mean(axis=1)
    regions = [region_of(c, lo, hi) for c in centres]
    expected = numpy.array([STAR_DENSITY[r] for r in regions]) * area
    counts = rng.poisson(expected)
    small, big = [], []
    for i in numpy.nonzero(counts)[0]:
        for _ in range(int(counts[i])):
            a, b = rng.random(), rng.random()
            if a + b > 1:
                a, b = 1 - a, 1 - b
            u, v = uv[i, 0] + a * (uv[i, 1] - uv[i, 0]) + b * (uv[i, 2] - uv[i, 0])
            pt = (float(u), float(v), 0.45 + 0.55 * rng.random() ** 2)
            (big if rng.random() < 0.08 else small).append(pt)
    splat(img, small, TEX, (1.0, 1.0, 1.0), 0.9)
    splat(img, big, TEX, (0.9, 0.95, 1.0), 1.8)
    return len(small) + len(big)


def paint_veins(img, uv, pos, area, rng, lo, hi):
    """Jagged glowing streaks: a random walk in UV space that starts on the chest
    (front, below the spine) or down a leg, and crackles a few steps."""
    centres = pos.mean(axis=1)
    y = (centres[:, 1] - lo[1]) / (hi[1] - lo[1])
    z = (centres[:, 2] - lo[2]) / (hi[2] - lo[2])
    chest = numpy.nonzero((y > 0.15) & (y < 0.42) & (z > 0.3) & (z < 0.55))[0]
    leg = numpy.nonzero((z < 0.3) & (area > 1e-7))[0]
    streaks = []
    for group, n in (("chest", VEIN_COUNT["chest"]), ("leg", VEIN_COUNT["leg"])):
        pool = chest if group == "chest" else leg
        for _ in range(n):
            i = pool[rng.integers(len(pool))]
            u, v = (float(c) for c in uv[i].mean(axis=0))
            heading = rng.random() * 2 * math.pi
            pts = [(u, v, 1.0)]
            steps = int(rng.integers(6, 11))
            for step in range(steps):
                heading += rng.normal(0, 0.9)
                length = (3 + 5 * rng.random()) / TEX
                u2, v2 = u + math.cos(heading) * length, v + math.sin(heading) * length
                for k in numpy.linspace(0, 1, 12):
                    pts.append((u + (u2 - u) * k, v + (v2 - v) * k, 1.0 - 0.6 * step / 10))
                u, v = u2, v2
            streaks.extend(pts)
    core = numpy.zeros_like(img)
    splat(core, streaks, TEX, (1, 1, 1), 1.0)
    core = numpy.clip(core, 0, 1)
    # A violet bloom around the core, then the core burns blue-white on top.
    glow = core.copy()
    for _ in range(3):
        glow = (glow + numpy.roll(glow, 1, 0) + numpy.roll(glow, -1, 0)
                + numpy.roll(glow, 1, 1) + numpy.roll(glow, -1, 1)) / 5
    img += glow * 1.6 * numpy.asarray((0.35, 0.2, 1.0), dtype=numpy.float32) \
        + core * numpy.asarray(VEIN_COLOR, dtype=numpy.float32) * 1.2
    return len(streaks)


def principled(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Specular IOR Level"].default_value = 0.2
    return mat, nt, bsdf


def image_node(nt, img, bsdf, socket):
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs[socket])
    return tex


def coat_material(body):
    fur = bpy.data.images.get("CAT_TEX_C.002") or fail("fur texture missing from the source")
    rng = numpy.random.default_rng(STAR_SEED)
    uv, pos, area = mesh_arrays(body)
    lo = pos.reshape(-1, 3).min(axis=0)
    hi = pos.reshape(-1, 3).max(axis=0)
    emit = numpy.zeros((TEX, TEX, 3), dtype=numpy.float32)
    stars = paint_stars(emit, uv, pos, area, rng, lo, hi)
    veins = paint_veins(emit, uv, pos, area, rng, lo, hi)
    print("coat: %d stars, %d vein points" % (stars, veins))
    mat, nt, bsdf = principled(ID + ".coat")
    image_node(nt, gained(fur, COAT_GAIN, TEX, ID + ".coat.png"), bsdf, "Base Color")
    emission = image_node(nt, packed(ID + ".glow.png", TEX, emit), bsdf, "Emission Color")
    emission.image.colorspace_settings.name = "sRGB"
    bsdf.inputs["Emission Strength"].default_value = EMISSION_STRENGTH
    bsdf.inputs["Roughness"].default_value = 0.85
    body.data.materials.clear()
    body.data.materials.append(mat)
    for p in body.data.polygons:
        p.material_index = 0


def paint_eyes(eyes):
    """Cyan crescent slits, horns up, on the front of each eye sphere, painted per
    triangle from the 3D position so the sphere's UV layout is never assumed."""
    uv, pos, area = mesh_arrays(eyes)
    flat = pos.reshape(-1, 3)
    left = flat[flat[:, 0] > 0]
    right = flat[flat[:, 0] <= 0]
    centres = [left.mean(axis=0), right.mean(axis=0)]
    radius = max(numpy.linalg.norm(left - centres[0], axis=1).max(),
                 numpy.linalg.norm(right - centres[1], axis=1).max())
    img = numpy.zeros((EYE_TEX, EYE_TEX, 3), dtype=numpy.float32)
    img[:] = (0.0, 0.015, 0.02)
    rng = numpy.random.default_rng(STAR_SEED)
    pts = []
    for i in range(len(uv)):
        c = centres[0] if pos[i, :, 0].mean() > 0 else centres[1]
        if (pos[i, :, 1] - c[1]).mean() > -0.25 * radius:
            continue  # back of the eyeball
        for _ in range(90):
            a, b = rng.random(), rng.random()
            if a + b > 1:
                a, b = 1 - a, 1 - b
            p = pos[i, 0] + a * (pos[i, 1] - pos[i, 0]) + b * (pos[i, 2] - pos[i, 0])
            d = (p - c) / radius
            inside = (d[0] ** 2 + d[2] ** 2) < 0.62 ** 2
            # PoE's half-moon: the top is a straight lid slanting down to the nose.
            inward = -d[0] if c[0] > 0 else d[0]
            if inside and d[2] < 0.12 - 0.38 * inward:
                t = uv[i, 0] + a * (uv[i, 1] - uv[i, 0]) + b * (uv[i, 2] - uv[i, 0])
                pts.append((float(t[0]), float(t[1]), 1.0))
    splat(img, pts, EYE_TEX, EYE_COLOR, 1.2)
    print("eyes: %d slit points, radius %.4f" % (len(pts), radius))
    return packed(ID + ".eye.png", EYE_TEX, numpy.clip(img, 0, 1))


def eye_material(eyes):
    mat, nt, bsdf = principled(ID + ".eye")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.01, 0.015, 1.0)
    glow = image_node(nt, paint_eyes(eyes), bsdf, "Emission Color")
    glow.image.colorspace_settings.name = "sRGB"
    bsdf.inputs["Emission Strength"].default_value = EYE_STRENGTH
    bsdf.inputs["Roughness"].default_value = 0.2
    eyes.data.materials.clear()
    eyes.data.materials.append(mat)
    for p in eyes.data.polygons:
        p.material_index = 0


# --------------------------------------------------------------------------
# clips
# --------------------------------------------------------------------------

def turn(pb, axis, deg):
    """A rotation about an ARMATURE-space axis, expressed in the bone's local
    frame: +X is the cat's left, -Y its nose, +Z up. Exact at rest; down a chain
    it is the axis as the body carries it, so a leg swings "back" relative to the
    body whichever way the body lies. Signs about +X: a hanging leg swings BACK
    and a backward tail LIFTS for positive degrees, the root tips the nose DOWN.
    About +Y the root rolls the cat onto its LEFT side; about +Z the nose turns left."""
    local = pb.bone.matrix_local.to_3x3().transposed() @ Vector(axis)
    return Quaternion(local, math.radians(deg))


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
TAIL = ["tail1", "tail2", "tail3", "tail4", "tail5"]
SIDES = (("L", 1), ("R", -1))


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def pulse(t, start, end):
    """0 -> 1 -> 0 over [start, end], smooth both ways."""
    if t <= start or t >= end:
        return 0.0
    u = (t - start) / (end - start)
    return ease(u * 2) if u < 0.5 else ease((1 - u) * 2)


def ramp(t, start, end):
    """0 before `start`, 1 after `end`, smooth between."""
    return ease((t - start) / (end - start))


def wave(phase, offset=0.0):
    return math.sin(2 * math.pi * phase + offset)


class Pose:
    """Rotations per bone, composed in the order they are added, and a root
    height in ARMATURE space (the ground solve writes it)."""

    def __init__(self, arm):
        self.arm = arm
        self.rot = {}
        self.lift = 0.0

    def add(self, bone, axis, deg):
        if abs(deg) < 1e-6:
            return
        pb = self.arm.pose.bones[bone]
        self.rot[bone] = self.rot.get(bone, Quaternion()) @ turn(pb, axis, deg)

    def legs(self, fore, hind):
        """`fore` / `hind`: per side, (shoulder|hip, elbow|knee, wrist|hock, toes) degrees about X."""
        for side, _ in SIDES:
            for bone, deg in zip(("paw1_", "paw2_", "paw3_"), fore[side][:3]):
                self.add(bone + side, X, deg)
            for bone, deg in zip(("leg2_", "leg3_", "feet_"), hind[side][:3]):
                self.add(bone + side, X, deg)

    def tail(self, pitch, yaw=(0, 0, 0, 0, 0)):
        for name, p, y in zip(TAIL, pitch, yaw):
            self.add(name, X, p)
            self.add(name, Z, y)

    def apply(self):
        root = self.arm.pose.bones["root"]
        for pb in self.arm.pose.bones:
            pb.rotation_quaternion = self.rot.get(pb.name, Quaternion())
            pb.location = Vector()
        # Pose location is in the bone's rest frame; the root has no parent.
        root.location = root.bone.matrix_local.to_3x3().inverted() @ Vector((0, 0, self.lift))


def both(deg):
    return {"L": deg, "R": deg}


def mirror(left, right):
    return {"L": left, "R": right}


# The hover: PoE's cat held in the air beside the player. Body a little nose-up,
# head up, all four legs hanging loose with the toes drooped, the tail hanging
# from the rump and hooking forward under it (bridge frames, cFi5bzlkpi4 34-50 s).
HOVER_PITCH = -20.0
HOVER_FORE = (10.0, -16.0, 62.0)
HOVER_HIND = (6.0, 30.0, 64.0)
HOVER_TAIL = (-78.0, -8.0, -12.0, -16.0, -20.0)


def hover(arm, t, phase):
    p = Pose(arm)
    p.add("root", X, HOVER_PITCH)
    p.add("root", Z, 3 * wave(phase))
    p.add("chest", X, 2 * wave(phase))
    p.add("neck", X, 2 - wave(phase))
    p.add("head", X, 14 + 3 * wave(phase, 0.8))
    p.add("head", Z, 6 * wave(phase, 1.7))
    # A slow paddle, the fore paws a beat apart.
    p.legs(
        {s: (HOVER_FORE[0] + 9 * k * wave(phase), HOVER_FORE[1] - 10 * k * wave(phase, 0.6), HOVER_FORE[2]) for s, k in SIDES},
        {s: (HOVER_HIND[0] - 5 * k * wave(phase, 1.2), HOVER_HIND[1] + 6 * k * wave(phase, 1.8), HOVER_HIND[2]) for s, k in SIDES},
    )
    p.tail(HOVER_TAIL, [8 * wave(phase, -0.6 * i) for i in range(5)])
    return p


def gallop(arm, t, phase):
    """A cat's rotary gallop, run in the air at the player's shoulder: the fore
    legs reach and sweep a half-beat ahead of the hind, the spine gathers and
    extends, the head stays level, the tail rides up in a long S."""
    p = Pose(arm)
    a = 2 * math.pi * phase
    # Spine: gathered (back round, legs under) at the hind plant, extended after.
    flex = math.sin(a)
    p.add("root", X, -4 + 5 * math.sin(a + 0.6))
    p.add("chest", X, 12 * flex)
    p.add("neck", X, -10 - 9 * flex)
    p.add("head", X, 8 - 4 * flex)
    fore, hind = {}, {}
    for side, k in SIDES:
        lead = 0.0 if side == "L" else 0.55
        f = a + lead
        h = a + math.pi + lead
        # Shoulder swings -50 (reach) .. +40 (swept back); the elbow folds on the
        # way forward; the paw flicks back at the end of the sweep.
        fore[side] = (-5 - 45 * math.cos(f), 10 - 55 * max(0.0, math.sin(f)), 40 + 30 * math.cos(f))
        hind[side] = (5 + 45 * math.cos(h), 15 - 40 * max(0.0, -math.sin(h)), 35 + 25 * math.cos(h))
    p.legs(fore, hind)
    p.tail((28, 12, -8, -16, 18), [6 * math.sin(a - 0.7 * i) for i in range(5)])
    return p


def lie_side(arm, t, phase):
    """Flopped on its left side on the floor, legs out loose, tail lying along
    the boards in a curve, breathing (bridge 57-61 s)."""
    p = Pose(arm)
    p.add("root", Y, 88)
    p.add("chest", X, 1.5 * wave(phase))
    p.add("neck", Y, -14)
    p.add("neck", X, -6)
    p.add("head", X, 6)
    p.legs(mirror((-22, 18, 30), (-10, 14, 26)), mirror((-6, 8, 30), (6, 4, 34)))
    p.tail((-14, -10, -18, -22, -16 + 10 * wave(phase)))
    return p


def roll_back(arm, t, phase):
    """From the side onto its back, paws folded in the air, a twist through the
    spine, and back onto the side (bridge 61-62 s, 89-90 s)."""
    p = Pose(arm)
    r = pulse(t, 0.0, 1.0)
    p.add("root", Y, 88 + 92 * r)
    p.add("chest", Y, -22 * math.sin(math.pi * t) * (1 - 0.4 * r))
    p.add("neck", Y, -14 * (1 - r))
    p.add("head", X, 6 + 14 * r)
    p.legs(
        mirror((-22 - 30 * r, 18 - 80 * r, 30 + 30 * r), (-10 - 36 * r, 14 - 74 * r, 26 + 30 * r)),
        mirror((-6 - 40 * r, 8 + 50 * r, 30), (6 - 44 * r, 4 + 46 * r, 34)),
    )
    p.tail((-14 + 34 * r, -10 + 16 * r, -18 + 22 * r, -22 + 18 * r, -16))
    return p


def curl(arm, t, phase):
    """Curled in a ring on the floor, nose to tail, the tail wrapped round:
    from above, PoE's donut (bridge 62-65 s, 77-80 s). A loaf with every leg
    tucked under and the spine bent sideways; the tail closes the ring."""
    p = Pose(arm)
    p.add("root", Y, 22)
    breath = 1.5 * wave(phase)
    p.add("root", Z, -30)
    p.add("chest", Z, 62)
    p.add("chest", X, breath)
    p.add("neck", Z, 48)
    p.add("neck", X, 16)
    p.add("head", Z, 40)
    p.add("head", X, 30)
    # Hind legs folded flat: thigh forward (leg1 is the thigh), shin back to the
    # hock, foot forward along the floor. Forearms flat under the chest.
    for side, _ in SIDES:
        p.add("leg1_" + side, X, -45)
    p.legs(both((80, -150, 130)), both((82, -112, 75)))
    # The nose turns to the cat's left, so the tail curls to its left to meet it.
    p.tail((-8, -4, -4, -4, -6), (-40, -38, -36, -34, -30 - 4 * wave(phase, 1.0)))
    return p


def stretch(arm, t, phase):
    """Up off the floor into a cat's stretch: fore legs long, chest low, rump
    high; then the chest comes up and a hind leg kicks out behind (bridge 65-66 s,
    80-81 s)."""
    p = Pose(arm)
    front = pulse(t, 0.05, 0.6)
    back = pulse(t, 0.5, 0.95)
    p.add("root", X, 22 * front - 8 * back)
    p.add("chest", X, 24 * front)
    p.add("neck", X, -34 * front)
    p.add("head", X, -14 * front)
    p.legs(
        both((-80 * front, 30 * front, -36 * front)),
        mirror((-12 * front + 8 * back, 16 * front, 6 * front), (-12 * front + 58 * back, 16 * front - 34 * back, 6 * front + 30 * back)),
    )
    p.tail((24 * front - 10 * back, 10, 0, -6, 10))
    return p


REAR_PITCH = -68.0


def reared(p, k, pat=0.0):
    """Up on the hind legs against the player, fore paws raised, `k` 0..1."""
    p.add("root", X, REAR_PITCH * k)
    p.add("neck", X, 34 * k)
    p.add("head", X, 18 * k)
    p.legs(
        mirror((-54 * k + pat, 26 * k, 34 * k), (-54 * k - pat, 26 * k, 34 * k)),
        both((-46 * k, 10 * k, -46 * k)),
    )
    p.tail((52 * k, 12 * k, 6, 4, 14))


def rear_up(arm, t, phase):
    """Rears up onto the hind legs against the player's side and pats at him
    (bridge 67-68 s, 82-83 s); ends reared, where the spring starts."""
    p = Pose(arm)
    k = ramp(t, 0.0, 0.35)
    reared(p, k, pat=16 * math.sin(2 * math.pi * 2 * t) * ramp(t, 0.3, 0.45))
    return p


def spring(arm, t, phase):
    """From the rear straight up past the player's head: body to the vertical,
    hind legs driving down, fore legs reaching up (bridge 68.4 s, 83.4 s)."""
    p = Pose(arm)
    k = ramp(t, 0.0, 0.5)
    p.add("root", X, REAR_PITCH - 20 * k)
    p.add("neck", X, 34 - 30 * k)
    p.add("head", X, 18 - 10 * k)
    p.legs(both((-54 - 60 * k, 26 - 26 * k, 34 - 20 * k)), both((-46 + 66 * k, 10 + 10 * k, -46 + 96 * k)))
    p.tail((52 - 60 * k, 12 - 14 * k, 6 - 6 * k, 4 - 4 * k, 14 - 10 * k))
    return p


def swim(arm, t, phase):
    """High over the player: stretched out level, fore legs paddling ahead,
    hind legs streaming behind, slowly twisting as it swims (bridge 69-70 s,
    84-85 s)."""
    p = Pose(arm)
    p.add("root", X, -6)
    p.add("root", Y, 24 * wave(phase))
    p.add("root", Z, 14 * wave(phase, 1.2))
    p.add("chest", X, -6 + 4 * wave(phase * 2))
    p.add("neck", X, -12)
    p.add("head", X, 10)
    p.legs(
        {s: (-62 + 22 * k * wave(phase * 2), 18 - 14 * k * wave(phase * 2, 0.8), 30) for s, k in SIDES},
        {s: (58 + 8 * k * wave(phase * 2, 1.6), -14, 40) for s, k in SIDES},
    )
    p.tail((-4, 0, 6 * wave(phase), -6 * wave(phase, 1), 8 * wave(phase, 2)), [10 * wave(phase, -0.8 * i) for i in range(5)])
    return p


def dive(arm, t, phase):
    """Head-first straight down, fore legs reaching for the floor, hind legs and
    a straight tail trailing up; levels off at the last moment and lands on its
    feet (official 5.6-8.9 s, bridge 70.7 s, 85.4 s)."""
    p = Pose(arm)
    down = ramp(t, 0.0, 0.2) * (1 - ramp(t, 0.6, 0.95))
    p.add("root", X, 82 * down)
    p.add("neck", X, -24 * down)
    p.add("head", X, -12 * down)
    p.legs(both((-58 * down, 14 * down, 20 * down)), both((52 * down, -10 * down, 30 * down)))
    p.tail((22 * down, 4 * down, 0, 0, 6 * down))
    return p


# name, poser, seconds, loops, ground: None (runtime height), "floor" (every frame
# rests on the floor), "first" (the first frame's floor offset held: it leaves the
# floor by runtime height), "last" (eases into the last frame's floor offset).
CLIPS = [
    ("hover", hover, 3.2, True, None),
    ("gallop", gallop, 0.5, True, None),
    ("lie_side", lie_side, 3.0, True, "floor"),
    ("roll_back", roll_back, 1.6, False, "floor"),
    ("curl", curl, 4.0, True, "floor"),
    ("stretch", stretch, 1.6, False, "floor"),
    ("rear_up", rear_up, 1.2, False, "floor"),
    ("spring", spring, 0.6, False, "first"),
    ("swim", swim, 2.4, True, None),
    ("dive", dive, 0.8, False, "last"),
]


def heights(body):
    """Lowest and highest point of the posed body, armature space (the armature
    sits at the origin with an identity transform)."""
    bpy.context.view_layer.update()
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    co = numpy.empty(len(me.vertices) * 3, dtype=numpy.float32)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    z = co.reshape(-1, 3)[:, 2]
    return float(z.min()), float(z.max())


def lowest(body):
    return heights(body)[0]


def muted(arm, on):
    """Mute every NLA track: a measured pose must be the one just set, not what
    the clips already authored would evaluate to."""
    for track in arm.animation_data.nla_tracks:
        track.mute = on


def author_clips(arm, body):
    arm.animation_data_create()
    for clip, poser, seconds, loops, ground in CLIPS:
        length = int(round(seconds * FPS))

        def posed(frame):
            u = (frame % length) / length if loops else frame / length
            phase = frame / length if loops else (frame / FPS) / seconds
            return u, poser(arm, u, phase)

        # Measure first, with no action bound and the other clips muted.
        arm.animation_data.action = None
        muted(arm, True)
        poses = []
        for frame in range(length + 1):
            u, pose = posed(frame)
            if ground == "floor":
                pose.apply()
                pose.lift = -lowest(body)
            poses.append((u, pose))
        if ground in ("first", "last"):
            edge = poses[0 if ground == "first" else -1][1]
            edge.apply()
            held = -lowest(body)
            for u, pose in poses:
                pose.lift = held if ground == "first" else held * ramp(u, 0.55, 1.0)
            print("clip %-10s floor lift %.3f" % (clip, held))
        elif ground == "floor":
            lifts = [pose.lift for _, pose in poses]
            print("clip %-10s floor lift %.3f .. %.3f" % (clip, min(lifts), max(lifts)))
        muted(arm, False)

        action = bpy.data.actions.new("%s|%s" % (ID, clip))
        action.use_fake_user = True
        slot = action.slots.new("OBJECT", arm.name)
        layer = action.layers.new("base")
        layer.strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
        arm.animation_data.action = action
        arm.animation_data.action_slot = slot
        # The last frame repeats the first: a loop has no seam.
        for frame, (_, pose) in enumerate(poses):
            pose.apply()
            for pb in arm.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=frame + 1)
            arm.pose.bones["root"].keyframe_insert("location", frame=frame + 1)
        track = arm.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, 1, action)
        if hasattr(strip, "action_slot"):
            strip.action_slot = slot
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.scene.render.fps = FPS

    arm, body, eyes = append_cat()
    for ob in (body, eyes):
        strip_modifiers(ob)
        bake_world(ob, arm)
        for mod in ob.modifiers:
            mod.object = arm
    body_tris = decimate(body, BODY_TRIS)
    eye_tris = decimate(eyes, EYE_TRIS)
    clean_rig(arm, [body, eyes])
    stretch_tail(arm, body)

    arm.name = arm.data.name = ID
    body.name = body.data.name = ID + ".body"
    eyes.name = eyes.data.name = ID + ".eyes"
    coat_material(body)
    eye_material(eyes)

    lo = min((body.matrix_world @ Vector(c)).z for c in body.bound_box)
    hi = max((body.matrix_world @ Vector(c)).z for c in body.bound_box)
    ys = [(body.matrix_world @ Vector(c)).y for c in body.bound_box]
    print("pet %s: body %d tris, eyes %d tris, bones %d, height %.3f, length %.3f"
          % (ID, body_tris, eye_tris, len(arm.data.bones), hi - lo, max(ys) - min(ys)))
    author_clips(arm, body)
    # The hover's extent about the armature origin, for the runtime's HOVER_Y.
    muted(arm, True)
    hover(arm, 0.0, 0.0).apply()
    print("hover extent: lowest %.3f, highest %.3f about the origin" % heights(body))
    muted(arm, False)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_influence_nb=4,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_image_format="AUTO",
        export_vertex_color="NONE",
        export_cameras=False,
        export_lights=False,
    )
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


main()
