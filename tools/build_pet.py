"""Build assets/pets/pet.glb: the companion cat, a floating dark magical cat that
follows the player (PoE1's Celestial Cat Pet, watched frame by frame).

  blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
      --python tools/build_pet.py

then `node tools/pack_pet.mjs` for the served copy.

Source: BlenderKit "Domestic cat (rigged)" (assets/pets/SOURCE.md), a 0.54 m
standing cat with hair particles and an IK posing rig. This strips the hair, the
subsurf and the IK, sizes the tail to PoE's proportion, decimates the body (not the tail) to the
pet budget, paints the coat (true black with white point stars, dense on the
head and back; electric-blue veins on the chest and legs) and cyan half-moon
eyes. Then it rigs the cat after PoE1's Celestial Cat itself: PoE's 29 bones,
names and rest orientations, their joints fitted onto our mesh, the tail bent
into PoE's rest curve, and the weights taken over from PoE's own skin. On that
skeleton PoE's floating clips play as they are, every bone's local turn and
offset frame for frame, as four NLA clips (tools/extract_poe_pet.mjs reads rig,
clips and skin out of a local PoE install):

  hover    idle_floating          loop 2.0 s   nose high at his hip, legs hanging, bobbing
  gallop   run_floating           loop 1.2 s   the run in the air
  relaxed  idle_relaxed_floating  once 14.67 s figure swim, ball chasing its tail, uncurl
  emerge   happy_floating         once 3.0 s   the summon: dropping in somersaulting

The clips carry PoE's root path, height above the ground included, so the
runtime stands the cat on the ground at its spot. One change from PoE: where a
one-shot takes the body under the hover's lowest (the relaxed swim skims the
floor), it is lifted that far, and the build fails if one still dips under the
hover (the cat always floats). Facing: the cat's nose points -Y in Blender, which is where every
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
EYE_COLOR = (0.05, 0.80, 1.00)
EYE_STRENGTH = 2.5
# The crescent, in eye radii: its disc, and where the cut disc sits (toward the nose, up).
EYE_RADIUS = 0.6
EYE_CUT = (0.08, 0.22)

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


def decimate(ob, budget, keep=None):
    """Collapse `ob` to `budget` triangles, sparing the vertex groups in `keep`
    (the rest takes the whole cut)."""
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris <= budget:
        return tris
    mod = ob.modifiers.new("decimate", "DECIMATE")
    spared = 0
    if keep:
        index = {ob.vertex_groups[n].index for n in keep}
        verts = [v.index for v in ob.data.vertices
                 if sum(e.weight for e in v.groups if e.group in index) >= 0.5]
        group = ob.vertex_groups.new(name="decimate.keep")
        group.add(verts, 1.0, "REPLACE")
        mod.vertex_group = group.name
        mod.invert_vertex_group = True
        inside = set(verts)
        spared = sum(len(p.vertices) - 2 for p in ob.data.polygons if inside.issuperset(p.vertices))
    mod.ratio = (budget - spared) / (tris - spared)
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=ob, active_object=ob,
                                   selected_editable_objects=[ob], selected_objects=[ob]):
        bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if keep:
        ob.vertex_groups.remove(ob.vertex_groups["decimate.keep"])
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


def stretch_tail(arm, body, ratio):
    """Bring the tail to `ratio` of the body's length from its root (PoE's
    proportion: PoE's keys sweep the tail through the same turns, so a longer
    tail sweeps a wider swirl) and re-rig it: the sculptor's
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
    ys = numpy.array([v.co.y for v in body.data.vertices if tail_w.get(v.index, 0.0) < 0.05])
    tip0 = max(body.data.vertices[i].co.y for i, w in tail_w.items() if w > 0.5)
    stretch = ratio * float(numpy.ptp(ys)) / (tip0 - y0)
    for i, w in tail_w.items():
        co = body.data.vertices[i].co
        if co.y > y0:
            co.y += w * (co.y - y0) * (stretch - 1)
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
    print("tail: %.3f long (x%.2f), %.2f of the body, %d vertices re-weighted"
          % (tip - y0, stretch, (tip - y0) / float(numpy.ptp(ys)), moved))


# Limbs whose joints sit where two bones' weights blend: (the bone each hangs
# off, the bones in order).
CHAINS = [chain for s in ("_L", "_R") for chain in (
    ("chest", ["paw1" + s, "paw2" + s, "paw3" + s]),
    ("pelvis", ["leg1" + s, "leg2" + s, "leg3" + s, "feet" + s]))]


def rejoint(arm, body):
    """Move the leg joints onto the mesh's own, where fit_joints reads them: the
    sculptor's fore elbow sits in front of the leg. A joint is where the two
    bones' weights blend. The rest mesh does not move; a bone's tail goes to the
    next one's head, the last of a chain keeps its length and direction."""
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
        # A few samples per texel, or a triangle wide in UV paints with gaps.
        for _ in range(max(90, int(area[i] * EYE_TEX ** 2 * 4))):
            a, b = rng.random(), rng.random()
            if a + b > 1:
                a, b = 1 - a, 1 - b
            p = pos[i, 0] + a * (pos[i, 1] - pos[i, 0]) + b * (pos[i, 2] - pos[i, 0])
            d = (p - c) / radius
            # PoE's crescent (cateyeglowcelestial): a disc less the same disc
            # shifted up, the cut leaning to the nose so the inner horn sits low.
            inward = -d[0] if c[0] > 0 else d[0]
            cut = (inward - EYE_CUT[0]) ** 2 + (d[2] - EYE_CUT[1]) ** 2
            if inward ** 2 + d[2] ** 2 < EYE_RADIUS ** 2 < cut:
                t = uv[i, 0] + a * (uv[i, 1] - uv[i, 0]) + b * (uv[i, 2] - uv[i, 0])
                pts.append((float(t[0]), float(t[1]), 1.0))
    # Coverage, then colour: summed cyan splats clip every channel to white.
    cover = numpy.zeros_like(img)
    splat(cover, pts, EYE_TEX, (1.0, 1.0, 1.0), 1.2)
    img += numpy.clip(cover, 0, 1) * numpy.asarray(EYE_COLOR, dtype=numpy.float32)
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
# hover's lowest middle, or any body point under the hover's lowest (PoE's
# relaxed swim skims the floor), that dip alone is lifted, and the build fails
# if one still sinks this far under.
FLOAT_SLACK = 0.02
LIFT_WINDOW = 15
# The Celestial's own skin (art/models/pet/cat/armour_celestial_*.smd), read
# by the same tool: its weights are what this cat's are transferred from.
SKIN = os.path.join(POE_DIR, "skin.smd")
# A clip-only helper with no weights and no counterpart on the body.
AUX = "aux_animation_control_ratio"
# Our cat rides PoE's skeleton itself: PoE's 29 bones, names, hierarchy and
# rest orientations, their joints on our mesh. A limb or tail joint goes where
# the source's own weights bend (rejoint, stretch_tail): PoE joint <- (our old
# bone, its "head" or "tail").
MAPPED = {"phys_tail_0%d" % (k + 1): (name, "head") for k, name in enumerate(TAIL)}
for _s in "LR":
    for _poe, _ours in (("hip", ("leg1", "head")), ("knee", ("leg2", "head")),
                        ("ankle", ("leg3", "head")), ("toe", ("feet", "head")),
                        ("toe02", ("feet", "tail")), ("shoulder", ("paw1", "head")),
                        ("elbow", ("paw2", "head")), ("wrist", ("paw3", "head"))):
        MAPPED["%s_%s" % (_s, _poe)] = ("%s_%s" % (_ours[0], _s), _ours[1])
# The back and the head sit on the midline at PoE's place along the body
# (mapped through the nose, shoulders, hips and tail root) and as deep under
# the back line as PoE's.
MIDLINE = ["root", "spine", "spine3", "spine1", "spine4", "spine2", "neck", "head"]
# Of a bone with several children, the one its segment runs to.
SEGMENT = {"root": "spine", "spine2": "neck"}
# The body's middle, where the runtime's clouds are born and the float rule measures.
MIDDLE = "spine1"
BONE_LENGTH = 0.04
# The tail by chain place (tail_profile): how far off the chain a vertex may be,
# and the spread PoE's weights are averaged over, in segments.
TAIL_RADIUS = 0.04
TAIL_SMOOTH = 1.0
# A foreleg's weights fall off as distance to its three bones to the -LEG_POWER
# (foreleg_profile), eased in from the nearest-surface weights across LEG_FROM
# (segments along shoulder-elbow-wrist), where the leg leaves the chest.
LEG_POWER = 3
LEG_FROM = (0.5, 0.8)
# foreleg_seam: where a leg's share of a vertex jumps by more than SEAM_JUMP
# along an edge within SEAM_RADIUS of a shoulder or elbow, SEAM_RINGS rings of
# vertices average their left-leg / right-leg / body shares SEAM_ROUNDS times.
SEAM_JUMP = 0.3
SEAM_RADIUS = 0.12
SEAM_RINGS = 3
SEAM_ROUNDS = 10


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


def poe_rest(rig):
    """PoE's bones at rest in OUR axes: rotations (3x3) and joint positions in
    world units (its rest locals carry no scale)."""
    world = [None] * len(rig["names"])
    for i in rig["order"]:
        p = rig["parent"][i]
        world[i] = rig["rest"][i] if p < 0 else world[p] @ rig["rest"][i]
    return ([FLIP @ w[:3, :3] @ FLIP for w in world],
            numpy.array([POE_UNIT * (FLIP @ w[:3, 3]) for w in world]))


def swing(a, b):
    """The shortest rotation taking direction `a` onto `b`, 3x3."""
    return numpy.asarray(Vector(a.tolist()).rotation_difference(Vector(b.tolist())).to_matrix())


def poe_locals(rig, tracks, f):
    """PoE's bones at frame `f` (tracks None: rest) in OUR axes, each in its
    parent's frame: rotations (3x3) and offsets in world units. The clips move
    joints too (the back stretches, the hocks slide), not only turn them."""
    rot, pos = [], []
    for i in range(len(rig["names"])):
        if tracks is None:
            r, t = rig["rest"][i][:3, :3], rig["rest"][i][:3, 3]
        else:
            _, q, t = (sample(k, f) for k in tracks[i])
            r = numpy.asarray(Quaternion((q[3], q[0], q[1], q[2])).to_matrix())
        rot.append(FLIP @ r @ FLIP)
        pos.append(POE_UNIT * (FLIP @ t))
    return rot, pos


def even_tail(rig, frame, offset):
    """`frame` with the tail bent as one even arc on our joints (`offset`, the
    fit's map from PoE's offsets to ours): PoE's keys bend it one way at one
    joint and back at the next (an S its tail physics smooths away). The first
    bone keeps its swing off the body; every later segment turns from the one
    before by the mean of those turns, each bone swung the least way onto it.
    PoE's tail rests unturned, its curve in the offsets alone."""
    rot, pos = frame
    at = {n: i for i, n in enumerate(rig["names"])}
    tail = [at["phys_tail_0%d" % (k + 1)] for k in range(len(TAIL))]
    # Each bone's segment in its own frame: to the next joint, the last one run on.
    seg = [offset[j] @ pos[j] for j in tail[1:]] + [offset[tail[-1]] @ pos[tail[-1]]]
    world = [numpy.eye(3)]
    for j in tail[1:]:
        world.append(world[-1] @ rot[j])
    d = [w @ s / numpy.linalg.norm(s) for w, s in zip(world, seg)]
    turn = numpy.mean([numpy.asarray(Vector(a.tolist()).rotation_difference(Vector(b.tolist())).to_exponential_map())
                       for a, b in zip(d, d[1:])], axis=0)
    step = numpy.asarray(Quaternion(Vector(turn.tolist())).to_matrix())
    rot = list(rot)
    new, want = [world[0]], d[0]
    for k in range(1, len(tail)):
        want = step @ want
        w = swing(world[k] @ seg[k] / numpy.linalg.norm(seg[k]), want) @ world[k]
        rot[tail[k]] = new[-1].T @ w
        new.append(w)
    return rot, pos


def poe_skin():
    """PoE's cat skin in our axes and world units: vertices, triangles, and per
    vertex four PoE bone indices with their weights. A v3 .smd: a 32-byte head
    (bounding box at 8), "DOLm", the shape count at 39, triangle and vertex
    counts at 45, an (offset, count) per shape, u16 indices, then 32-byte
    vertices: position f32x3, normal and tangent i8x4, uv f16x2, bones u8x4,
    weights u8x4 summing to 255."""
    if not os.path.exists(SKIN):
        fail("missing %s: run tools/extract_poe_pet.mjs" % SKIN)
    d = open(SKIN, "rb").read()
    if d[32:36] != b"DOLm":
        fail("%s is not a v3 skinned mesh" % SKIN)
    ntri, nvert = struct.unpack_from("<II", d, 45)
    o = 53 + 8 * d[39]
    tris = numpy.frombuffer(d, "<u2", ntri * 3, o).reshape(-1, 3).astype(numpy.int64)
    rec = numpy.dtype([("p", "<f4", 3), ("nt", "i1", 8), ("uv", "<f2", 2), ("j", "u1", 4), ("w", "u1", 4)])
    v = numpy.frombuffer(d, rec, nvert, o + ntri * 6)
    w = v["w"].astype(numpy.float64)
    return dict(co=POE_UNIT * (v["p"].astype(numpy.float64) @ FLIP), tris=tris,
                joint=v["j"].astype(numpy.int64), weight=w / w.sum(1, keepdims=True))


def poe_tail_ratio(rig, p0, skin):
    """PoE's tail length (root joint to tip, along the chain) over its body's
    length (the vertices off the tail, nose to rump)."""
    at = {n: i for i, n in enumerate(rig["names"])}
    tail = [at["phys_tail_0%d" % (k + 1)] for k in range(len(TAIL))]
    on = (skin["weight"] * numpy.isin(skin["joint"], tail)).sum(1)
    chain = to_tip([p0[i] for i in tail], skin["co"][on > 0.5])
    length = sum(numpy.linalg.norm(b - a) for a, b in zip(chain, chain[1:]))
    return length / float(numpy.ptp(skin["co"][on < 0.05][:, 1]))


def back_line(co, tris, y):
    """Height of the back at `y`: the highest point where the vertical through
    (0, y) meets the mesh."""
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    e1, e2, d = b[:, :2] - a[:, :2], c[:, :2] - a[:, :2], numpy.array((0.0, y)) - a[:, :2]
    den = e1[:, 0] * e2[:, 1] - e2[:, 0] * e1[:, 1]
    ok = numpy.abs(den) > 1e-12
    den = numpy.where(ok, den, 1.0)
    s = (d[:, 0] * e2[:, 1] - e2[:, 0] * d[:, 1]) / den
    t = (e1[:, 0] * d[:, 1] - d[:, 0] * e1[:, 1]) / den
    hit = ok & (s >= 0) & (t >= 0) & (s + t <= 1)
    if not hit.any():
        fail("no body over y %.3f" % y)
    return float((a[:, 2] + s * (b[:, 2] - a[:, 2]) + t * (c[:, 2] - a[:, 2]))[hit].max())


def body_tris(body):
    me = body.data
    me.calc_loop_triangles()
    co = numpy.array([tuple(v.co) for v in me.vertices])
    tris = numpy.empty(len(me.loop_triangles) * 3, dtype=numpy.int64)
    me.loop_triangles.foreach_get("vertices", tris)
    return co, tris.reshape(-1, 3)


def curl_tail(arm, body, rig, p0):
    """Bend our rest tail into PoE's rest curve, each segment keeping its
    length: the sculptor's runs straight back where PoE's rises, and every tail
    pose of PoE's is a turn from that curve. The tail's skin follows its bones;
    the last bone continues PoE's last segment."""
    at = {n: i for i, n in enumerate(rig["names"])}
    poe = [p0[at["phys_tail_0%d" % (k + 1)]] for k in range(len(TAIL))]
    dirs = [(b - a) / numpy.linalg.norm(b - a) for a, b in zip(poe, poe[1:])]
    dirs.append(dirs[-1])
    bones = arm.data.bones
    old = [numpy.asarray(bones[n].head_local) for n in TAIL] + [numpy.asarray(bones[TAIL[-1]].tail_local)]
    new, turns = [old[0]], []
    for k in range(len(TAIL)):
        seg = old[k + 1] - old[k]
        turns.append(swing(seg, dirs[k]))
        new.append(new[k] + dirs[k] * numpy.linalg.norm(seg))
    tail = {body.vertex_groups[n].index: k for k, n in enumerate(TAIL)}
    for v in body.data.vertices:
        co = numpy.asarray(v.co)
        moved, on, total = numpy.zeros(3), 0.0, 0.0
        for e in v.groups:
            total += e.weight
            if e.group in tail:
                k = tail[e.group]
                moved += e.weight * (new[k] + turns[k] @ (co - old[k]))
                on += e.weight
        if on > 0:
            v.co = Vector(((moved + (total - on) * co) / total).tolist())
    body.data.update()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for k, name in enumerate(TAIL):
        eb[name].head = Vector(new[k].tolist())
        eb[name].tail = Vector(new[k + 1].tolist())
    bpy.ops.object.mode_set(mode="OBJECT")


def fit_joints(arm, body, rig, p0, skin):
    """Where each PoE joint goes on our cat (see MAPPED, MIDLINE)."""
    at = {n: i for i, n in enumerate(rig["names"])}
    joints = {}
    for poe, (ours, end) in MAPPED.items():
        b = arm.data.bones[ours]
        joints[poe] = numpy.array(b.head_local if end == "head" else b.tail_local)
    co, tris = body_tris(body)

    def both(src, n):
        return (src("L_" + n)[1] + src("R_" + n)[1]) / 2

    poe = [skin["co"][:, 1].min()] + [both(lambda n: p0[at[n]], n) for n in ("shoulder", "hip")] \
        + [p0[at["phys_tail_01"]][1]]
    ours = [co[:, 1].min()] + [both(joints.get, n) for n in ("shoulder", "hip")] + [joints["phys_tail_01"][1]]
    for n in MIDLINE:
        y0, z0 = p0[at[n]][1], p0[at[n]][2]
        y = float(numpy.interp(y0, poe, ours))
        joints[n] = numpy.array((0.0, y, back_line(co, tris, y) - (back_line(skin["co"], skin["tris"], y0) - z0)))
    return joints


def segments(rig):
    """Per PoE bone (AUX aside) the child its segment runs to, None for a leaf."""
    names = rig["names"]
    out = {}
    for i in rig["order"]:
        if names[i] == AUX:
            continue
        kids = [names[c] for c, p in enumerate(rig["parent"]) if p == i and names[c] != AUX]
        out[names[i]] = SEGMENT.get(names[i]) or (kids[0] if len(kids) == 1 else None)
    return out


def poe_skeleton(arm, rig, r0, joints):
    """Replace the source's bones with PoE's, each at its fitted joint in PoE's
    own rest orientation, so PoE's local turns and offsets mean the same here."""
    names = rig["names"]
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)
    for i in rig["order"]:
        if names[i] == AUX:
            continue
        b = eb.new(names[i])
        b.head, b.tail = Vector(), Vector((0.0, BONE_LENGTH, 0.0))
        m = Matrix(r0[i].tolist()).to_4x4()
        m.translation = Vector(joints[names[i]].tolist())
        b.matrix = m
        b.use_deform = True
        if rig["parent"][i] >= 0:
            b.parent = eb[names[rig["parent"][i]]]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"


def transfer_weights(body, eyes, rig, p0, joints, skin):
    """Our skin takes PoE's weights. PoE's mesh is first fitted onto ours by its
    own skin, each bone carrying its part by the turn and stretch from PoE's
    segment to ours; then every vertex of ours takes the weights of the nearest
    point of that surface, keeps the four strongest and sums to one. The eyes
    ride the head."""
    names = rig["names"]
    at = {n: i for i, n in enumerate(names)}
    seg = segments(rig)
    S = numpy.repeat(numpy.eye(3)[None], len(names), 0)
    to = numpy.array(p0, dtype=numpy.float64)
    for i in rig["order"]:
        n = names[i]
        if n == AUX:
            continue
        to[i] = joints[n]
        if seg[n] is None:
            S[i] = S[rig["parent"][i]]
        else:
            a, b = p0[at[seg[n]]] - p0[i], joints[seg[n]] - joints[n]
            S[i] = swing(a, b) * numpy.clip(numpy.linalg.norm(b) / numpy.linalg.norm(a), 0.6, 1.6)
    co, j, w = skin["co"], skin["joint"], skin["weight"]
    fitted = numpy.zeros_like(co)
    for k in range(4):
        local = numpy.einsum("nij,nj->ni", S[j[:, k]], co - numpy.asarray(p0)[j[:, k]])
        fitted += w[:, k, None] * (to[j[:, k]] + local)
    me = bpy.data.meshes.new("poe_skin")
    me.from_pydata(fitted.tolist(), [], skin["tris"].tolist())
    ref = bpy.data.objects.new("poe_skin", me)
    bpy.context.scene.collection.objects.link(ref)
    bones = [n for n in names if n != AUX]
    for n in bones:
        ref.vertex_groups.new(name=n)
    for v in range(len(co)):
        for k in range(4):
            if w[v, k] > 0:
                ref.vertex_groups[names[j[v, k]]].add([v], float(w[v, k]), "ADD")
    for ob in (body, eyes):
        for g in list(ob.vertex_groups):
            ob.vertex_groups.remove(g)
        for n in bones:
            ob.vertex_groups.new(name=n)
    eyes.vertex_groups["head"].add([v.index for v in eyes.data.vertices], 1.0, "REPLACE")
    mod = body.modifiers.new("weights", "DATA_TRANSFER")
    mod.object = ref
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"
    mod.layers_vgroup_select_src = "ALL"
    mod.layers_vgroup_select_dst = "NAME"
    with bpy.context.temp_override(object=body, active_object=body,
                                   selected_editable_objects=[body], selected_objects=[body]):
        bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(ref, do_unlink=True)
    bpy.data.meshes.remove(me)
    tail_profile(body, rig, p0, joints, skin)
    for side in "LR":
        foreleg_profile(body, rig, joints, side)
    foreleg_seam(body, rig, joints)
    groups = {g.index: g for g in body.vertex_groups}
    for v in body.data.vertices:
        keep = sorted(((e.weight, e.group) for e in v.groups if e.weight > 0), reverse=True)[:4]
        total = sum(x for x, _ in keep)
        if total <= 0:
            fail("vertex %d took no weight" % v.index)
        for e in list(v.groups):
            groups[e.group].remove([v.index])
        for x, g in keep:
            groups[g].add([v.index], x / total, "REPLACE")
    body.data.update()


def chain_param(co, chain):
    """Per point, how far along the polyline `chain` its nearest point lies (in
    segments: 1.5 is halfway down the second) and how far off it it is."""
    best_s = numpy.zeros(len(co))
    best_d = numpy.full(len(co), numpy.inf)
    for k, (a, b) in enumerate(zip(chain, chain[1:])):
        ab = b - a
        t = numpy.clip(((co - a) @ ab) / (ab @ ab), 0, 1)
        d = numpy.linalg.norm(co - (a + t[:, None] * ab), axis=1)
        closer = d < best_d
        best_s[closer], best_d[closer] = k + t[closer], d[closer]
    return best_s, best_d


def to_tip(chain, co):
    """The tail chain run on past its last joint along its last segment, as far
    as the tail's own vertices (those near that segment) reach."""
    last = (chain[-1] - chain[-2]) / numpy.linalg.norm(chain[-1] - chain[-2])
    # Measured against the last segment run on, or nothing past TAIL_RADIUS beyond the last joint counts.
    reach = float(numpy.linalg.norm(co - chain[-1], axis=1).max())
    s, d = chain_param(co, chain + [chain[-1] + last * reach])
    near = co[(s >= len(chain) - 1.5) & (d < TAIL_RADIUS)]
    return chain + [chain[-1] + last * max(0.0, float(((near - chain[-1]) @ last).max()))]


def poe_chain(rig, p0, skin, chain, own):
    """PoE's vertices carrying more than `own` of their weight on `chain` (PoE
    joints in order): each one's place along it (chain_param) and its weights,
    one column per bone."""
    at = {n: i for i, n in enumerate(rig["names"])}
    co, j, w = skin["co"], skin["joint"], skin["weight"]
    pick = (w * numpy.isin(j, [at[n] for n in chain])).sum(1) > own
    s, _ = chain_param(co[pick], to_tip([p0[at[n]] for n in chain], co[pick]))
    full = numpy.zeros((int(pick.sum()), len(rig["names"])))
    for k in range(4):
        numpy.add.at(full, (numpy.arange(len(full)), j[pick][:, k]), w[pick][:, k])
    return s, full


def our_chain(body, joints, chain, own):
    """Ours along the same chain: place, distance off it, and whether a vertex
    carries at least `own` of its weight on the chain's bones."""
    vco = numpy.array([tuple(v.co) for v in body.data.vertices])
    index = {body.vertex_groups[n].index for n in chain}
    mine = numpy.array([sum(e.weight for e in v.groups if e.group in index) for v in body.data.vertices]) >= own
    s, d = chain_param(vco, to_tip([joints[n] for n in chain], vco[mine]))
    return s, d, mine


def reweight(body, names, i, mix):
    """Vertex `i` takes the weights `mix` (one per PoE bone) and no others."""
    for n in names:
        if n != AUX:
            body.vertex_groups[n].remove([int(i)])
    for b in numpy.nonzero(mix > 1e-3)[0]:
        body.vertex_groups[names[b]].add([int(i)], float(mix[b]), "REPLACE")


def tail_profile(body, rig, p0, joints, skin):
    """The tail past the first half segment takes PoE's tail weights by place
    along the chain, ring by ring: a tube too thin to land on by nearest
    surface, where neighbours round the tail took different bones and every
    turn shredded it. PoE's weights at each of its tail vertices, averaged by
    chain distance, read at each of ours."""
    tail = ["phys_tail_0%d" % (k + 1) for k in range(len(TAIL))]
    s_poe, full = poe_chain(rig, p0, skin, tail, 0.0)
    s, d, _ = our_chain(body, joints, tail, 0.0)
    for i in numpy.nonzero((s >= 0.5) & (d < TAIL_RADIUS))[0]:
        k = numpy.exp(-((s_poe - s[i]) / TAIL_SMOOTH) ** 2)
        reweight(body, rig["names"], i, (full * k[:, None]).sum(0) / k.sum())


def segment_distance(co, a, b):
    ab = b - a
    t = numpy.clip(((co - a) @ ab) / (ab @ ab), 0, 1)
    return numpy.linalg.norm(co - (a + t[:, None] * ab), axis=1)


def foreleg_profile(body, rig, joints, side):
    """A foreleg below the chest weighs its three bones (upper arm, forearm,
    paw) by inverse distance to each, so every ring takes one smooth mix and
    the bones trade over a joint about as wide as the leg is thick. Nearest
    surface off PoE's sparse rings gave each of our dense ones its own mix:
    the forearm skinned into a curve and slit along its length, and any mix
    set by hand along the chain folded where it ended. The paw bone runs from
    the wrist through the middle of the paw: the paw points forward, not on
    down the forearm."""
    names = rig["names"]
    chain = ["%s_%s" % (side, n) for n in ("shoulder", "elbow", "wrist")]
    s, _, mine = our_chain(body, joints, chain, 0.5)
    at = {g.index: names.index(g.name) for g in body.vertex_groups}
    w = numpy.zeros((len(body.data.vertices), len(names)))
    for v in body.data.vertices:
        for e in v.groups:
            w[v.index, at[e.group]] = e.weight
    w[mine] /= w[mine].sum(1, keepdims=True)
    co = numpy.array([tuple(v.co) for v in body.data.vertices])
    j = [numpy.asarray(joints[n], dtype=numpy.float64) for n in chain]
    paw = mine & (s > 1.5) & (w[:, names.index(chain[2])] > 0.5)
    if not paw.any():
        fail("no paw under %s" % chain[2])
    tip = j[2] + 2.0 * (co[paw].mean(0) - j[2])
    d = numpy.stack([segment_distance(co, j[0], j[1]), segment_distance(co, j[1], j[2]),
                     segment_distance(co, j[2], tip)], 1)
    near = numpy.maximum(d, 1e-5) ** -LEG_POWER
    near /= near.sum(1, keepdims=True)
    t = numpy.clip((s - LEG_FROM[0]) / (LEG_FROM[1] - LEG_FROM[0]), 0, 1)
    on = t * t * (3 - 2 * t)
    cols = [names.index(n) for n in chain]
    for i in numpy.nonzero(mine & (s > LEG_FROM[0]))[0]:
        mix = (1 - on[i]) * w[i]
        mix[cols] += on[i] * near[i]
        reweight(body, names, i, mix)


def average_rings(x, edges, degree, zone, rounds):
    """`x` (one row per vertex) with the rows in `zone` averaged half and half
    with their neighbours' `rounds` times."""
    x = x.copy()
    for _ in range(rounds):
        s = numpy.zeros_like(x)
        numpy.add.at(s, edges[:, 0], x[edges[:, 1]])
        numpy.add.at(s, edges[:, 1], x[edges[:, 0]])
        x[zone] = 0.5 * x[zone] + 0.5 * s[zone] / degree[zone, None]
    return x


def foreleg_seam(body, rig, joints):
    """Where a foreleg meets the chest, the throat or the other leg, the
    source mesh joins them edge to edge (the elbows are sculpted against the
    chest), and a vertex all leg beside one all neck is pulled out of the
    skin as a spike when the leg swings. Over a few rings either side of such
    an edge, each vertex's share of left leg, right leg and body is averaged
    with its neighbours'; inside a group it mostly belonged to it keeps its
    own split, so the elbow's shoulder-to-forearm trade stays where
    foreleg_profile put it."""
    names = rig["names"]
    at = {g.index: names.index(g.name) for g in body.vertex_groups}
    w = numpy.zeros((len(body.data.vertices), len(names)))
    for v in body.data.vertices:
        for e in v.groups:
            w[v.index, at[e.group]] = e.weight
    w /= w.sum(1, keepdims=True)
    legs = [[names.index("%s_%s" % (side, n)) for n in ("shoulder", "elbow", "wrist")] for side in "LR"]
    groups = legs + [[i for i in range(len(names)) if i not in legs[0] + legs[1]]]
    share = numpy.stack([w[:, g].sum(1) for g in groups], 1)
    edges = numpy.array([tuple(e.vertices) for e in body.data.edges])
    co = numpy.array([tuple(v.co) for v in body.data.vertices])
    near = numpy.zeros(len(w), dtype=bool)
    for side in "LR":
        for j in ("shoulder", "elbow"):
            near |= numpy.linalg.norm(co - numpy.asarray(joints["%s_%s" % (side, j)]), axis=1) < SEAM_RADIUS
    jump = (numpy.abs(share[edges[:, 0], :2] - share[edges[:, 1], :2]) > SEAM_JUMP).any(1)
    zone = numpy.zeros(len(w), dtype=bool)
    zone[edges[jump].ravel()] = True
    zone &= near
    for _ in range(SEAM_RINGS):
        grow = zone.copy()
        grow[edges[zone[edges[:, 0]], 1]] = True
        grow[edges[zone[edges[:, 1]], 0]] = True
        zone = grow & near
    degree = numpy.zeros(len(w))
    numpy.add.at(degree, edges.ravel(), 1)
    new_share = average_rings(share, edges, degree, zone, SEAM_ROUNDS)
    blur = average_rings(w, edges, degree, zone, SEAM_ROUNDS)
    mix = numpy.zeros_like(w)
    for k, g in enumerate(groups):
        own = w[:, g] / numpy.maximum(share[:, k:k + 1], 1e-9)
        theirs = blur[:, g] / numpy.maximum(blur[:, g].sum(1, keepdims=True), 1e-9)
        mix[:, g] = numpy.where(share[:, k:k + 1] >= 0.5, own, theirs) * new_share[:, k:k + 1]
    for i in numpy.nonzero(zone)[0]:
        reweight(body, names, i, mix[i] / mix[i].sum())


class Fit:
    """What carries PoE's motion onto our skeleton: per PoE bone (AUX aside) its
    parent, and the map taking PoE's local offset onto ours (the turn and
    stretch from PoE's rest offset to our joint's); the root's rest head, ours
    and PoE's."""

    def __init__(self, arm, rig, rest):
        names = rig["names"]
        self.names = names
        self.order = [i for i in rig["order"] if names[i] != AUX]
        self.parent = rig["parent"]
        bones = arm.data.bones
        self.offset = {}
        for i in self.order:
            p = self.parent[i]
            if p < 0:
                continue
            t0 = rest[1][i]
            o = numpy.asarray(bones[names[p]].matrix_local.to_3x3()).T @ numpy.asarray(
                bones[names[i]].head_local - bones[names[p]].head_local)
            self.offset[i] = swing(t0, o) * (numpy.linalg.norm(o) / numpy.linalg.norm(t0))
        self.root = self.order[0]
        self.head0 = numpy.asarray(bones[names[self.root]].head_local)
        self.poe0 = rest[1][self.root]


class Pose:
    """Local rotations and locations per bone, ready to key."""

    def __init__(self, arm):
        self.arm = arm
        self.rot = {}
        self.loc = {}

    def apply(self):
        for pb in self.arm.pose.bones:
            pb.rotation_quaternion = self.rot.get(pb.name, Quaternion())
            pb.location = self.loc.get(pb.name, Vector())


def retarget(arm, fit, frame, lift):
    """Our cat in PoE's pose: every bone takes its PoE bone's local turn and
    its offset through the fit, the root PoE's path from rest, `lift` higher."""
    rot, pos = frame
    world, pose = {}, Pose(arm)
    for i in fit.order:
        n, p = fit.names[i], fit.parent[i]
        b = arm.data.bones[n]
        if p < 0:
            r = rot[i]
            head = fit.head0 + pos[i] - fit.poe0 + numpy.array((0.0, 0.0, lift))
        else:
            pr, ph = world[p]
            r = pr @ rot[i]
            head = ph + pr @ (fit.offset[i] @ pos[i])
        world[i] = (r, head)
        m = Matrix(r.tolist()).to_4x4()
        m.translation = Vector(head.tolist())
        if p < 0:
            basis = b.matrix_local.inverted() @ m
        else:
            pm = Matrix(world[p][0].tolist()).to_4x4()
            pm.translation = Vector(world[p][1].tolist())
            basis = b.matrix_local.inverted() @ b.parent.matrix_local @ pm.inverted() @ m
        pose.rot[n] = basis.to_quaternion()
        pose.loc[n] = basis.translation
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
    middle (the MIDDLE joint), with no action bound and every clip muted."""
    arm.animation_data.action = None
    muted(arm, True)
    out = []
    for pose in poses:
        pose.apply()
        out.append(heights(body) + (arm.pose.bones[MIDDLE].head.z,))
    muted(arm, False)
    return numpy.array(out)


def author_clips(arm, body, rig):
    fit = Fit(arm, rig, poe_locals(rig, None, 0))
    arm.animation_data_create()
    lows, middles = {}, {}
    for clip, poe_clip, loops in CLIPS:
        tracks = poe_tracks(rig, poe_clip)
        length = int(max(k[-1, 0] for t in tracks.values() for k in t if len(k)))
        posed = [even_tail(rig, poe_locals(rig, tracks, f), fit.offset) for f in range(length + 1)]
        poses = [retarget(arm, fit, p, 0.0) for p in posed]
        span = measured(arm, body, poses)
        lift = numpy.zeros(length + 1)
        if not loops:
            lift = numpy.maximum(lifts(span[:, 2], middles["hover"]),
                                 lifts(span[:, 0], lows["hover"]))
            if lift.any():
                poses = [retarget(arm, fit, p, h) for p, h in zip(posed, lift)]
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
                pb.keyframe_insert("location", frame=frame + 1)
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
    # The tail keeps its rings: collapsed, its faces ran lengthwise across two
    # bones and every bend shredded it into strips.
    body_tris = decimate(body, BODY_TRIS, keep=TAIL)
    eye_tris = decimate(eyes, EYE_TRIS)
    clean_rig(arm, [body, eyes])
    rig = poe_rig()
    r0, p0 = poe_rest(rig)
    skin = poe_skin()
    stretch_tail(arm, body, poe_tail_ratio(rig, p0, skin))
    rejoint(arm, body)
    # Painted on the standing cat, before the tail rises: the star regions are
    # fractions of its height.
    coat_material(body)
    eye_material(eyes)
    curl_tail(arm, body, rig, p0)
    joints = fit_joints(arm, body, rig, p0, skin)
    poe_skeleton(arm, rig, r0, joints)
    transfer_weights(body, eyes, rig, p0, joints, skin)

    arm.name = arm.data.name = ID
    body.name = body.data.name = ID + ".body"
    eyes.name = eyes.data.name = ID + ".eyes"

    lo = min((body.matrix_world @ Vector(c)).z for c in body.bound_box)
    hi = max((body.matrix_world @ Vector(c)).z for c in body.bound_box)
    ys = [(body.matrix_world @ Vector(c)).y for c in body.bound_box]
    print("pet %s: body %d tris, eyes %d tris, bones %d, height %.3f, length %.3f"
          % (ID, body_tris, eye_tris, len(arm.data.bones), hi - lo, max(ys) - min(ys)))
    author_clips(arm, body, rig)

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
