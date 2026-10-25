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
cyan half-moon eyes, and recreates PoE1's Celestial Cat motion on the cat's own
bones as four NLA clips, frame for frame from PoE's own floating clips
(tools/extract_poe_pet.mjs reads them out of a local PoE install):

  hover    idle_floating          loop 2.0 s   nose high at his hip, legs hanging, bobbing
  gallop   run_floating           loop 1.2 s   the run in the air
  relaxed  idle_relaxed_floating  once 14.67 s figure swim, ball chasing its tail, uncurl
  emerge   happy_floating         once 3.0 s   the summon: dropping in somersaulting

The clips carry PoE's root path, height above the ground included, so the
runtime stands the cat on the ground at its spot. One change from PoE: where a
one-shot takes the body's middle under the hover's lowest (the relaxed swim
skims the floor), it is lifted that far, and the build fails if one still dips
under the hover (the cat always floats). Facing: the cat's nose points -Y in Blender, which is where every
monster's nose lands after its own pi turn (see Creature.emit in
build_monsters.py), so the renderer's `atan2(dx, dz)` yaw convention holds
without a root rotation.
"""
import math
import os
import struct
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
# Real cat length is 0.54 units. PoE's cat is 0.43 of its player's height nose to
# tail; this makes ours the same beside a 1.81-unit character.
SCALE = 1.6
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


# Chains whose joints sit where two bones' weights blend: (the bone each hangs
# off, the bones in order). The pelvis itself pivots at the hips.
CHAINS = [("pelvis", ["chest", "neck", "head"])] + [
    chain for s in ("_L", "_R") for chain in (
        ("chest", ["paw1" + s, "paw2" + s, "paw3" + s]),
        ("pelvis", ["leg1" + s, "leg2" + s, "leg3" + s, "feet" + s]))]


def rejoint(arm, body):
    """Move the spine and leg joints onto the mesh's own: the sculptor's bones
    float up to 0.17 above the back and the fore elbow sits in front of the leg,
    so every turn pivoted in the wrong place. A joint is where the two bones'
    weights blend. The rest mesh does not move; a bone's tail goes to the next
    one's head, the last of a chain keeps its length and direction."""
    g = {vg.name: vg.index for vg in body.vertex_groups}
    co = numpy.array([tuple(v.co) for v in body.data.vertices])
    w = numpy.zeros((len(co), len(body.vertex_groups)))
    for v in body.data.vertices:
        for e in v.groups:
            w[v.index, e.group] = e.weight

    def blend(a, b):
        k = w[:, g[a]] * w[:, g[b]]
        if k.sum() < 1e-6:
            fail("no weight blend between %s and %s" % (a, b))
        return Vector(((co * k[:, None]).sum(0) / k.sum()).tolist())

    heads, nxt = {}, {}
    for parent, chain in CHAINS:
        for prev, bone in zip([parent] + chain, chain):
            heads[bone] = blend(prev, bone)
            if prev != parent:
                nxt[prev] = bone
    hips = (heads["leg1_L"] + heads["leg1_R"]) / 2
    heads["pelvis"] = Vector((0.0, hips.y, hips.z))
    nxt["pelvis"] = "chest"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    ends = {n: eb[n].tail - eb[n].head for n in heads}
    for name, head in heads.items():
        eb[name].use_connect = False
        eb[name].head = head
    for name in heads:
        eb[name].tail = heads[nxt[name]] if name in nxt else heads[name] + ends[name]
    # The L hock carries a helper the R one lost: it rides the foot's joint.
    eb["leg3_control_L"].head = heads["feet_L"]
    eb["leg3_control_L"].tail = heads["feet_L"] + Vector((0, 0.05, 0))
    bpy.ops.object.mode_set(mode="OBJECT")


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
# clips: PoE's own motion, retargeted onto this cat's bones
# --------------------------------------------------------------------------

TAIL = ["tail1", "tail2", "tail3", "tail4", "tail5"]
# GGG's rig and keyframes, read out of a local PoE install by
# tools/extract_poe_pet.mjs (gitignored: only what this build makes of them ships).
POE_DIR = os.path.join(PET_DIR, "source", "poe")
# World units per PoE unit: its cat plays at 90% beside a 190.8-unit Marauder,
# ours beside a 1.81-unit character.
POE_UNIT = 0.9 * 1.81 / 190.8
# PoE axes are -Z up, -Y forward, +X the cat's left; ours +Z up.
FLIP = numpy.diag((1.0, 1.0, -1.0))
# Floats per key after its frame number: scale, rotation xyzw, translation, four unused.
KEY_WIDTH = (3, 4, 3, 3, 4, 3, 3)
# Ours, PoE's, loops. PoE's controller plays idle_floating, run_floating while it
# travels, idle_relaxed_floating at 25% per idle cycle, happy_floating on summon.
CLIPS = [
    ("hover", "idle_floating", True),
    ("gallop", "run_floating", True),
    ("relaxed", "idle_relaxed_floating", False),
    ("emerge", "happy_floating", False),
]
# The cat always floats: where a one-shot takes the body's middle under the
# hover's lowest (PoE's relaxed swim skims the floor), that dip alone is lifted,
# and the build fails if any body point still sinks this far under the hover's.
FLOAT_SLACK = 0.02
LIFT_WINDOW = 15
# Our bone <- (PoE bone it turns with, PoE joint its segment starts at, joint it
# ends at). DELTA: the bone takes the PoE bone's turn, corrected so its segment
# swings exactly as PoE's does (our back is two bones over PoE's five, its rest
# shape the mesh's own). No segment: the bone's own turn alone.
DELTA = {
    "root": ("root", None, None),
    "pelvis": ("spine1", "root", "spine4"),
    "chest": ("spine2", "spine4", "neck"),
    "neck": ("neck", "neck", "head"),
    "head": ("head", None, None),
    "paw3_L": ("L_wrist", None, None),
    "paw3_R": ("R_wrist", None, None),
}
# AIM: the bone lies along PoE's segment, twisting with PoE's bone. The legs
# match PoE's joint for joint (upper arm, forearm; thigh, shin, foot, toe), and
# a tail is a tube that bends anywhere. The tip continues the last segment.
AIM = {name: ("phys_tail_0%d" % (k + 1), "phys_tail_0%d" % (k + 1), "phys_tail_0%d" % (k + 2))
       for k, name in enumerate(TAIL[:-1])}
AIM["tail5"] = ("phys_tail_05", "phys_tail_04", "phys_tail_05")
for _s in "LR":
    for _ours, _poe in (("paw1", ("shoulder", "elbow")), ("paw2", ("elbow", "wrist")),
                        ("leg1", ("hip", "knee")), ("leg2", ("knee", "ankle")),
                        ("leg3", ("ankle", "toe")), ("feet", ("toe", "toe02"))):
        AIM["%s_%s" % (_ours, _s)] = ("%s_%s" % (_s, _poe[0]), "%s_%s" % (_s, _poe[0]), "%s_%s" % (_s, _poe[1]))


def poe_rig():
    """PoE's cat: bone names, parents, rest locals (column-vector 4x4), the
    bones parents-first, its clips (name -> track count, offset), the keyframes."""
    path = os.path.join(POE_DIR, "rig.ast")
    anim = os.path.join(POE_DIR, "anim.bin")
    if not (os.path.exists(path) and os.path.exists(anim)):
        fail("missing %s: run tools/extract_poe_pet.mjs" % POE_DIR)
    d = open(path, "rb").read()
    o = 8
    raw = []
    for _ in range(d[1]):
        n = struct.unpack_from("<H", d, o + 66)[0]
        # Stored row-vector: the transpose is the column-vector local.
        m = numpy.array(struct.unpack_from("<16f", d, o + 2)).reshape(4, 4).T
        raw.append((d[o + 68:o + 68 + n].decode(), d[o], d[o + 1], m))
        o += 68 + n
    parent, order = [-1] * len(raw), []

    def walk(i, p):
        while i != 255:
            parent[i] = p
            order.append(i)
            walk(raw[i][2], i)
            i = raw[i][1]
    walk(0, -1)
    clips = {}
    for _ in range(d[3]):
        n, off = struct.unpack_from("<HI", d, o + 5)
        clips[d[o + 15:o + 15 + n].decode()] = (d[o], off)
        o += 15 + n
    return dict(names=[r[0] for r in raw], parent=parent, order=order,
                rest=[r[3] for r in raw], clips=clips, blob=open(anim, "rb").read())


def poe_tracks(rig, clip):
    """Per bone index: its scale, rotation and translation keys, each an array of
    rows (frame, values...)."""
    count, o = rig["clips"][clip]
    blob, out = rig["blob"], {}
    for _ in range(count):
        bone = struct.unpack_from("<I", blob, o + 1)[0]
        counts = struct.unpack_from("<7I", blob, o + 5)
        o += 33
        keys = []
        for c, w in zip(counts, KEY_WIDTH):
            keys.append(numpy.frombuffer(blob, "<f4", c * (w + 1), o).reshape(c, w + 1))
            o += 4 * c * (w + 1)
        out[bone] = keys[:3]
    return out


def sample(keys, f):
    """Linear between keys (rotations normalised the short way round), held past the ends."""
    i = min(max(int(numpy.searchsorted(keys[:, 0], f, side="right")) - 1, 0), len(keys) - 1)
    a = keys[i, 1:].astype(numpy.float64)
    if i < len(keys) - 1 and f > keys[i, 0]:
        b = keys[i + 1, 1:].astype(numpy.float64)
        if len(a) == 4 and a.dot(b) < 0:
            b = -b
        a = a + (b - a) * (f - keys[i, 0]) / (keys[i + 1, 0] - keys[i, 0])
    return a / numpy.linalg.norm(a) if len(a) == 4 else a


def poe_pose(rig, tracks, f):
    """PoE's bones at frame `f` (tracks None: rest) in OUR axes: rotations (3x3,
    scale removed) and joint positions in world units."""
    world = [None] * len(rig["names"])
    for i in rig["order"]:
        if tracks is None:
            local = rig["rest"][i]
        else:
            s, q, t = (sample(k, f) for k in tracks[i])
            local = numpy.eye(4)
            local[:3, :3] = numpy.asarray(Quaternion((q[3], q[0], q[1], q[2])).to_matrix()) * s
            local[:3, 3] = t
        p = rig["parent"][i]
        world[i] = local if p < 0 else world[p] @ local
    rot, pos = [], []
    for w in world:
        u, _, vt = numpy.linalg.svd(FLIP @ w[:3, :3] @ FLIP)
        rot.append(u @ vt)
        pos.append(POE_UNIT * (FLIP @ w[:3, 3]))
    return rot, numpy.array(pos)


def swing(a, b):
    """The shortest rotation taking direction `a` onto `b`, 3x3."""
    return numpy.asarray(Vector(a.tolist()).rotation_difference(Vector(b.tolist())).to_matrix())


def unit(v):
    return v / numpy.linalg.norm(v)


class Pose:
    """Local rotations per bone and the root's location, ready to key."""

    def __init__(self, arm):
        self.arm = arm
        self.rot = {}
        self.root = Vector()

    def apply(self):
        for pb in self.arm.pose.bones:
            pb.rotation_quaternion = self.rot.get(pb.name, Quaternion())
            pb.location = Vector()
        self.arm.pose.bones["root"].location = self.root


def retarget(arm, rig, rest, posed, lift):
    """Our cat in PoE's pose. Each bone's armature-space orientation is PoE's turn
    of its bone (DELTA) or segment direction (AIM) applied to our rest; heads
    follow their parents, and the root carries PoE's pelvis path, `lift` higher."""
    idx = {n: i for i, n in enumerate(rig["names"])}
    r0, p0 = rest
    r1, p1 = posed
    want = {}
    pose = Pose(arm)
    bones = [b for b in arm.data.bones if b.parent is None]
    while bones:
        b = bones.pop(0)
        bones.extend(b.children)
        rest_m = b.matrix_local
        rest_r = numpy.asarray(rest_m.to_3x3())
        spec = DELTA.get(b.name) or AIM.get(b.name)
        if spec is None:
            # A helper PoE has no counterpart for rides its parent.
            rot = numpy.asarray(want[b.parent.name].to_3x3()) @ numpy.asarray(
                (b.parent.matrix_local.inverted() @ rest_m).to_3x3())
        else:
            ref, a, e = (idx.get(n) for n in spec)
            turn = r1[ref] @ r0[ref].T
            if b.name in AIM:
                seg = p1[e] - p1[a] if b.name != "tail5" else turn @ (p0[e] - p0[a])
                turn = swing(turn @ rest_r[:, 1], unit(seg)) @ turn
            elif a is not None:
                turn = swing(turn @ unit(p0[e] - p0[a]), unit(p1[e] - p1[a])) @ turn
            rot = turn @ rest_r
        m = Matrix(rot.tolist()).to_4x4()
        if b.parent is None:
            # Where PoE's pelvis is, our pelvis head goes; the root is placed to put it there.
            offset = numpy.asarray(arm.data.bones["pelvis"].head_local - b.head_local)
            head = p1[idx["root"]] + numpy.array((0.0, 0.0, lift)) - turn @ offset
            m.translation = Vector(head.tolist())
            basis = rest_m.inverted() @ m
            pose.root = basis.translation
        else:
            parent = want[b.parent.name]
            m.translation = parent @ (b.parent.matrix_local.inverted() @ rest_m).translation
            basis = rest_m.inverted() @ b.parent.matrix_local @ parent.inverted() @ m
        want[b.name] = m
        pose.rot[b.name] = basis.to_quaternion()
    return pose


def lifts(lows, floor):
    """How far each frame must rise for `lows` to stay at `floor`,
    widened then averaged over LIFT_WINDOW frames so the rise never shows a kink
    and never falls short."""
    need = numpy.maximum(0.0, floor - numpy.asarray(lows))
    n, w = len(need), LIFT_WINDOW
    wide = numpy.array([need[max(0, i - w):i + w + 1].max() for i in range(n)])
    return numpy.array([wide[max(0, i - w):i + w + 1].mean() for i in range(n)])


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


def muted(arm, on):
    """Mute every NLA track: a measured pose must be the one just set, not what
    the clips already authored would evaluate to."""
    for track in arm.animation_data.nla_tracks:
        track.mute = on


def measured(arm, body, poses):
    """Each pose's lowest and highest body point and the height of the body's
    middle (the chest joint), with no action bound and every clip muted."""
    arm.animation_data.action = None
    muted(arm, True)
    out = []
    for pose in poses:
        pose.apply()
        out.append(heights(body) + (arm.pose.bones["chest"].head.z,))
    muted(arm, False)
    return numpy.array(out)


def author_clips(arm, body):
    rig = poe_rig()
    rest = poe_pose(rig, None, 0)
    arm.animation_data_create()
    lows, middles = {}, {}
    for clip, poe_clip, loops in CLIPS:
        tracks = poe_tracks(rig, poe_clip)
        length = int(max(k[-1, 0] for t in tracks.values() for k in t if len(k)))
        posed = [poe_pose(rig, tracks, f) for f in range(length + 1)]
        poses = [retarget(arm, rig, rest, p, 0.0) for p in posed]
        span = measured(arm, body, poses)
        lift = numpy.zeros(length + 1)
        if not loops:
            lift = lifts(span[:, 2], middles["hover"])
            if lift.any():
                poses = [retarget(arm, rig, rest, p, h) for p, h in zip(posed, lift)]
                span = measured(arm, body, poses)
        lows[clip] = float(span[:, 0].min())
        middles[clip] = float(span[:, 2].min())
        print("clip %-8s %3d frames from %s, body %.3f .. %.3f, lifted up to %.3f"
              % (clip, length, poe_clip, lows[clip], float(span[:, 1].max()), float(lift.max())))

        action = bpy.data.actions.new("%s|%s" % (ID, clip))
        action.use_fake_user = True
        slot = action.slots.new("OBJECT", arm.name)
        layer = action.layers.new("base")
        layer.strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
        arm.animation_data.action = action
        arm.animation_data.action_slot = slot
        last = {}
        for frame, pose in enumerate(poses):
            pose.apply()
            for pb in arm.pose.bones:
                # One hemisphere frame to frame, or a key interpolates the long way round.
                if pb.name in last and last[pb.name].dot(pb.rotation_quaternion) < 0:
                    pb.rotation_quaternion = -pb.rotation_quaternion
                last[pb.name] = pb.rotation_quaternion.copy()
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
    for clip in (c for c, _, loops in CLIPS if not loops):
        if lows[clip] < lows["hover"] - FLOAT_SLACK:
            fail("%s dips to %.3f, under the hover's %.3f: the cat always floats" % (clip, lows[clip], lows["hover"]))


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
    rejoint(arm, body)

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
