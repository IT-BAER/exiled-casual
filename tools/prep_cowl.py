"""Build the Ember cowl donor out of the body's own head.

Image-to-3D never produced this piece: TRELLIS crashes in the mesh decode on
the cowl reference at every resolution it offers, twice out of memory and twice
outright, and padding the reference was measured not to be the lever. So the
donor is not generated at all, for the same reason the hands are not
(`tools/prep_gauntlet.py`): a rigid piece is placed, not posed, and a shell
measured off the head's own skin has the right skull by construction.

The shell is an icosphere about the head centre, hung on the low-passed radius
of the skin, so it clears the ears and jaw and cannot fold. The face opening is
a superellipse cut in the head's own normalised frame, whose top edge is set by
the brow mesh the fitter already measures against; the hem is a flat cut below
the jaw, and a tip is drawn up and back off the crown. Radial noise gives the
wool its folds, a BlenderKit weave its surface.

The neck is a second piece, a tube round the neck axis from over the hood's
fitted hem down over the robe's collar, read against the FITTED robe and
gorget out of `wardrobe.glb` (so build that first). The hood cannot reach down
there itself: below the jaw nothing is star-shaped about the head centre, and a
rigid piece that low would cut the robe whenever the head turns. Lining and
trim are vertex colour over one wool material.

The gates are the fitter's own, unchanged, plus one run of `fit_head_shell`
here, because construction is a claim and a measurement is not.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_cowl.py
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_wardrobe as W  # noqa: E402  (Blender runs this file directly)
import prep_gauntlet as G  # noqa: E402  (the shell maths is that file's)

STEM = "cowl-head-v1"
NECK_STEM = "cowl-neck-v1"
KEEP_DIR = "D:/VSC/exiled-casual/assets/props/source"
REPORT = f"{KEEP_DIR}/{STEM}.json"
REVIEW = "D:/VSC/exiled-casual/review/3d/ember-cowl-v1"

# What the cowl is cut from. The neck carries the collar, so it comes along.
REGION = ("Head", "neck_01")
REGION_WEIGHT = 0.35

# Air between scalp and the wool's inner face, and the wall outward from it.
# Both are the wrap's numbers: one wool, one set.
SKIN_GAP = 0.005
WOOL = G.STEEL if G.LOOK == "ember" else 0.0038
# The opening is HEMMED: over this many rings the wall closes to nothing, so the
# two layers share the rim ring and the shell folds over its own edge the way
# cloth does. Only the wall closes. The hood keeps its full standoff to the rim:
# bringing it back onto the skin there brought back the jaw, which no radial
# offset can clear, and every crossing of that version sat on that ramp.
HEM_RINGS = 6
# How many times `thicken` may thin the wall where the outer layer folds.
EASE_STEPS = 50

# The sphere the hood is hung on: Blender's subdivision 5 is 2562 vertices, some 9 mm apart
# on this head, and the cowl comes out near the triangle count of the skin shell
# it replaced.
SPHERE_SUBDIV = 5
# Where the skin rays start, far outside anything the head region holds.
REACH = 1.0

# How hard the head's own radius is low-passed before the wool is hung on it.
# Diffusion reaches about the square root of the pass count in rings, so twenty
# spread some four - past the two an ear spans, far short of the twenty-odd the
# head is wide, which leaves a hood shaped like this skull and not a sphere.
HOOD_PASSES = 20

# The same relaxation along the face opening alone, so the rim is a curve and
# not the head's triangulation.
RIM_PASSES = 16
RIM_FACTOR = 0.5

# The face opening, cut in the head's own normalised frame: u across, v front to
# back with negative forward, w up, each over half the Head group's own bbox.
# The brow mesh tops out at w 0.275 and `HELM_COVER_FROM` makes the fitter
# demand wool above w 0.25, so the front edge runs just under both and the
# forehead stays covered. A superellipse rather than an ellipse because a hood
# opening is wide from the brow to the jaw and narrows only at its two ends,
# where an ellipse is wide at one height alone and clips the outer eye corner.
FACE_TOP = 0.22
FACE_BOTTOM = -1.50      # past the hood's own lower edge, so the two are one hem
FACE_HALF = 0.72         # widest half-opening, over half the head's own width
FACE_POWER = 3.0
FACE_FRONT = 0.0         # only the front half of the head is eligible

# Where the cowl's lower edge runs, in the head's own w. Everything the shell
# is allowed to keep has to be star-shaped about the head centre, because that
# is the one property that makes the radial hood field and its radial wall
# incapable of folding. The jaw's underside and the trapezius are not: two
# points there sit on one ray out of the head centre, and every crossing that
# survived a bridge, a hem and a relaxation sat low on the jaw: 118 at -0.95, 40
# at -0.80, 0 at -0.80 once the standoff stopped returning to the skin (-0.85
# folds the hood field itself). So the hood ends there, and the face opening
# runs down THROUGH that edge, which leaves one continuous hem, not two rings.
HEM_W = -0.80

# What the fitter is asked for once the donor exists. The donor is built ON this
# head, so the width sweep starts at the head's own width instead of the 1.125
# a scanned donor needs, and `back_shift` is MEASURED below: `placed` lands the
# donor's bbox centre on the head's, and a shell with no face in it has its
# centre behind the head's own.
FIT_ARGS = {"width_from": 1.2}

# Folds hung on the hood radius: a few millimetres of Perlin noise, fine across
# the head and coarse down it, so the ridges run the way cloth hangs.
FOLD_AMP = 0.008
FOLD_ACROSS = 5.0
FOLD_DOWN = 1.5
FOLD_OFFSET = Vector((3.7, 1.3, 5.1))   # a fixed slice of the noise field

# The hood's tip: the radius drawn out along one direction up and back off the
# crown, so the shell stays a radial graph. The icon's hood peaks there. The
# profile runs in ANGLE off that direction, so the apex is a cone (a point); in
# the dot product it was quadratic there and ended in a bulb. The base reaches
# further toward the brow than the neck, so the peak grows out of the whole
# crown and leans back.
TIP_DIR = Vector((0.0, 0.85, 0.53)).normalized()
TIP_FRONT = math.radians(55)
TIP_BACK = math.radians(35)
TIP_LEN = 0.08
TIP_POWER = 1.4

# The neck is a tube about the neck axis: columns round the axis, each riding
# the outermost skin or gorget under it, so every horizontal ray out of the axis
# crosses it once. Its top rises NECK_TUCK up the OUTSIDE of the hood's hem and
# dips under the chin at the front, where the hood is open; its foot runs
# NECK_DRAPE down over the robe from the height at which the robe first stands
# out from the neck, lying on the robe's outer face, so a pose that lifts the
# hem shows robe under it and never skin.
GORGET = "chest.ember.gorget"
ROBE = "chest.ember.robe"
NECK_SKIN = ("neck_01", "spine_03", "clavicle_l", "clavicle_r")
NECK_COLUMNS = 72
NECK_ROWS = 24
NECK_STEP = 0.002         # vertical sampling of the skin down each column
NECK_PASSES = 3           # low-pass across columns and rows, per envelope round
NECK_ROUNDS = 8
NECK_HEM_PASSES = 6       # the foot's height, low-passed round the axis
NECK_GAP = 0.003          # off the skin and the gorget
NECK_TUCK = 0.02          # the top rises this far over the hood's fitted hem
NECK_FRONT_HALF = math.radians(60)
NECK_FRONT_DZ = -0.015    # the top at the front, below the hood's fitted hem
NECK_DRAPE = 0.025
# A drape, not a cape: the foot stops where the robe under it stands this far
# outside the wall's top, which on the T-posed trapezius is a centimetre down.
NECK_DRAPE_OUT = 0.05
NECK_ROBE_GAP = 0.002     # the wool's inner face off the robe's outer face
NECK_ROBE_LAYERS = 0.04   # the depth of the robe's rolled collar, out from its inner face
NECK_DRAPE_AIR = 0.008    # the most a foot point may stand off the robe under it
NECK_FLARE = 0.02         # the most the wall stands outside its own top radius
NECK_FOLD_AMP = 0.002
NECK_FOLD_ACROSS = 2.0    # radius of the noise circle round the axis: ~12 folds
NECK_FOLD_DOWN = 3.0      # per metre down the column
NECK_MIN_CLEAR = 0.0005   # p01 clearance off skin and gorget, above the neckline
# How far the robe stands off the skin or gorget where the neck meets it: the
# gap, the wall, the folds, and a gap again.
NECK_ROOM = NECK_GAP + WOOL + NECK_FOLD_AMP + NECK_GAP
# Over the hood both ride Head, so the wool lies almost on it: the two read as
# one garment, and the skin never shows between them.
NECK_HOOD_GAP = 0.001
NECK_HANG_FALLOFF = 0.002  # per column, round the front from the hood's corners

# Lining and trim as vertex colour over the weave; the texture is grey about
# TEX_MEAN, so each colour is the linear albedo it multiplies to.
TEX_MEAN = 0.25
CLOTH = tuple(c / TEX_MEAN for c in G.CLOTH_ALBEDO[:3]) + (1.0,)
LINING = (0.085 / TEX_MEAN, 0.008 / TEX_MEAN, 0.010 / TEX_MEAN, 1.0)
TRIM = (0.100 / TEX_MEAN, 0.062 / TEX_MEAN, 0.025 / TEX_MEAN, 1.0)
TRIM_RINGS = 2


# The wool, BlenderKit "Wool fabric" (d5ca8a6b-dd40-4f0c-a5c7-e030af0912c5,
# royalty free). Its weave and normal are kept; its red is not - the base
# colour is taken to grey and tinted to the wrap's charcoal. One tile spans
# WEAVE metres, box-projected, and ships at TEX_PX to spare the wardrobe.
WOOL_SRC = "D:/VSC/exiled-casual/assets/props/source/wool_fabric.blend"
WEAVE = 0.04
TEX_PX = 512
# Wool read flat at game distance with its own contrast: the weave is doubled
# in the base colour and pressed harder into the normal.
WEAVE_CONTRAST = 1.8
NORMAL_STRENGTH = 1.5

# Authored knowing `matte()` runs over it in the build.
MATERIAL = "MI_Cowl_Cloth"

ROUNDTRIP_TOLERANCE = G.ROUNDTRIP_TOLERANCE
SEAM_CROSSINGS = G.SEAM_CROSSINGS


def face_opening(head_c, head_dims):
    """Is this point inside the cut the face looks out of?"""
    hx, hy, hz = head_dims.x / 2, head_dims.y / 2, head_dims.z / 2
    mid = (FACE_TOP + FACE_BOTTOM) / 2
    reach = (FACE_TOP - FACE_BOTTOM) / 2

    def opened(co):
        v = (co.y - head_c.y) / hy
        w = (co.z - head_c.z) / hz
        if v >= FACE_FRONT or w > FACE_TOP:
            return False
        t = abs((w - mid) / reach)
        if t >= 1.0:
            return False
        half = FACE_HALF * (1.0 - t ** FACE_POWER) ** (1.0 / FACE_POWER)
        return abs((co.x - head_c.x) / hx) <= half

    return opened


def deburr(bm):
    """Take the spikes off a rim cut vertex by vertex.

    Deleting vertices takes every face that touched one, so the opening is left
    along the head's own triangulation: single triangles hang off it by one
    edge, and two rim edges meeting at a spike bridge into a pair of slivers
    that cross each other for ever, whatever the relaxation does afterwards. A
    face carrying two boundary edges IS that spike, and it is the whole defect.
    """
    cut = 0
    while True:
        spikes = [f for f in bm.faces
                  if sum(1 for e in f.edges if len(e.link_faces) < 2) >= 2]
        if not spikes:
            return cut
        bmesh.ops.delete(bm, geom=spikes, context="FACES")
        cut += len(spikes)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")


def smooth_rim(bm, centre, skip):
    """Take the zigzag out of the face opening without pulling it off the head.

    A cut made vertex by vertex leaves the rim on the head's own triangulation,
    so it saws back and forth by about an edge length - which is the same size
    as the wall the stitch is about to bridge across it, and two bridge quads a
    step apart then cut each other. Relaxing the loop along itself is what makes
    the opening a curve; it is also the only reason it reads as a hem.

    The midpoint of two neighbours on a loop wrapped round a head lies INSIDE
    it, so the same clamp the drape uses holds here: the move is taken in the
    tangential part and refused in the radial one. Without it thirty passes cut
    the rim as a chord through the skull and the crossings went from 32 to 80.
    A ring `skip` accepts is left alone; the bisect already cut it flat.
    """
    moved = 0
    for _ in range(RIM_PASSES):
        step = {}
        for v in bm.verts:
            if not v.is_boundary or skip(v.co):
                continue
            near = [e.other_vert(v).co for e in v.link_edges
                    if len(e.link_faces) < 2 and not skip(e.other_vert(v).co)]
            if len(near) != 2:
                continue
            want = v.co.lerp((near[0] + near[1]) / 2, RIM_FACTOR)
            d = want - centre
            keep = (v.co - centre).length
            if d.length < keep and d.length > 1e-9:
                want = centre + d.normalized() * keep
            step[v.index] = want
        for v in bm.verts:
            if v.index in step:
                v.co = step[v.index]
                moved += 1
    bm.normal_update()
    return moved // max(1, RIM_PASSES)


def rim_loops(bm):
    """How many separate openings the shell has; a cowl has the face and the collar."""
    edges = [e for e in bm.edges if len(e.link_faces) < 2]
    seen, loops = set(), 0
    for e in edges:
        if e in seen:
            continue
        loops += 1
        stack = [e]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            for v in cur.verts:
                stack += [o for o in v.link_edges
                          if o not in seen and len(o.link_faces) < 2]
    return loops


def wall_band(depth):
    """The hem ramp for the WALL.

    The two layers have to share the rim ring, so the wall is zero there. It
    must not be nearly zero for the ring behind it as well: a sub-millimetre
    wall between two triangles four millimetres wide is two surfaces that touch,
    and touching is what crossed. Square root lifts it clear in one ring - 1.6
    of 3.8 mm at the first, 2.2 at the second.
    """
    return math.sqrt(min(1.0, depth / HEM_RINGS))


def hem_rings(bm, rim):
    """How many rings each vertex lies from the face opening, capped at the hem."""
    depth = {i: 0 for i in rim}
    frontier = [v for v in bm.verts if v.index in depth]
    for k in range(1, HEM_RINGS + 1):
        nxt = []
        for v in frontier:
            for e in v.link_edges:
                u = e.other_vert(v)
                if u.index not in depth:
                    depth[u.index] = k
                    nxt.append(u)
        frontier = nxt
    return depth


def skin_radius(body, keep, centre, dirs, below):
    """How far out of the head centre the skin lies along each direction.

    Cast from outside inward, so the hit is the OUTERMOST skin on that ray: the
    ear's rim and not the skull behind it, which is what the hood has to clear.
    None where the ray misses the head, falls in the face opening, or lands
    below the hem - `hood_field` fills those from their neighbours so they bend
    the low pass no more than the skin the cowl actually covers.
    """
    me = body.data.copy()
    me.transform(body.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    dl = bm.verts.layers.deform.active
    doomed = [v for v in bm.verts
              if sum(w for gi, w in v[dl].items() if gi in keep) < REGION_WEIGHT]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    out = []
    for d in dirs:
        hit = bvh.ray_cast(centre + d * REACH, -d)[0]
        out.append(None if hit is None or below(hit) else (hit - centre).length)
    return out


def hood_field(bm, r0, passes=HOOD_PASSES):
    """The radius of a smooth hood that stands clear of this head.

    Following the skin is what made the first shell a swim cap: the ear, the
    jaw and the chin came through it one for one. A hood is not an offset of a
    head. It is a LOW-PASS of it: the radius about the head centre, diffused
    over the sphere until a feature a few rings across is gone, and then carried
    out bodily until the worst thing it flattened is back inside it.
    """
    near = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    r = list(r0)
    while any(x is None for x in r):
        r = [x if x is not None else
             (sum(k) / len(k) if (k := [r[j] for j in near[i] if r[j] is not None]) else None)
             for i, x in enumerate(r)]
    filled = list(r)
    for _ in range(passes):
        r = [(r[i] + sum(r[j] for j in near[i])) / (1 + len(near[i])) for i in range(len(r))]
    stand = max(a - b for a, b in zip(r0, r) if a is not None)
    return filled, r, stand


def fold(d, amp=FOLD_AMP):
    """Radial give in the wool: long vertical folds, so the hood is not a lathe part.

    Along the head radius only, so the shell stays a radial graph and cannot fold.
    """
    return amp * noise.noise(Vector((d.x * FOLD_ACROSS, d.y * FOLD_ACROSS,
                                          d.z * FOLD_DOWN)) + FOLD_OFFSET)


def tip(d):
    """How far the hood is drawn out along `d` toward its tip."""
    angle = TIP_DIR.angle(d, 0.0)
    across = d - TIP_DIR * d.dot(TIP_DIR)
    brow = Vector((0, 0, 1)) - TIP_DIR * TIP_DIR.z
    lean = across.normalized().dot(brow.normalized()) if across.length > 1e-9 else 0.0
    base = TIP_BACK + (TIP_FRONT - TIP_BACK) * (1.0 + lean) / 2.0
    s = 1.0 - angle / base
    return TIP_LEN * s ** TIP_POWER if s > 0 else 0.0


def cowl_shell(body, name="cowl"):
    """A sphere about the head centre, hung on the low-passed head radius, cut to a cowl.

    The shell is a radial graph by construction: every direction out of the
    head centre crosses it once. The skin is not - an ear is a flap and the jaw
    tucks under - and a shell moved out from the skin kept both, as an ear
    printed on the wool and slits where the flap folded.
    """
    keep = {body.vertex_groups[b].index for b in REGION if b in body.vertex_groups}
    if len(keep) != len(REGION):
        raise SystemExit(f"the body carries no groups for {REGION}")
    _, _, head_dims, head_c = W.bbox(W.group_points(body, "Head"))
    collar_z = head_c.z + head_dims.z / 2 * HEM_W
    opened = face_opening(head_c, head_dims)

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=SPHERE_SUBDIV, radius=1.0)
    bm.verts.index_update()
    dirs = [v.co.normalized() for v in bm.verts]
    r0 = skin_radius(body, keep, head_c, dirs,
                     lambda p: p.z < collar_z or opened(p))
    filled, smoothed, stand = hood_field(bm, r0)
    print(f"HOOD stands {stand * 1000:.2f} mm off the low-passed skull, "
          f"{sum(1 for x in r0 if x is not None)} of {len(r0)} directions on skin")
    face = []
    for i, v in enumerate(bm.verts):
        v.co = head_c + dirs[i] * (max(smoothed[i] + stand + SKIN_GAP + fold(dirs[i]),
                                       filled[i] + SKIN_GAP) + tip(dirs[i]))
        # Cut on the low-passed radius, never the skin: the skin's jaw bent the
        # opening into a notch at the cheek.
        if opened(head_c + dirs[i] * smoothed[i]):
            face.append(v)
    bmesh.ops.delete(bm, geom=face, context="VERTS")
    # The normal points at the half that is kept; `clear_inner` drops the other.
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                           plane_co=Vector((0, 0, collar_z)), plane_no=Vector((0, 0, 1)),
                           clear_inner=True)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bmesh.ops.triangulate(bm, faces=bm.faces)
    burrs = deburr(bm)
    loops = rim_loops(bm)
    relaxed = smooth_rim(bm, head_c, lambda co: co.z <= collar_z + 1e-4)
    print(f"RIM {burrs} spiked faces cut, {loops} openings left, {relaxed} rim vertices relaxed")
    if loops != 1:
        raise SystemExit(f"a hood has ONE hem, up the front and round the back; this has {loops}")
    bm.verts.index_update()
    face_rim = {v.index for v in bm.verts if v.is_boundary}
    hem = hem_rings(bm, face_rim)
    # Trim along the face only: the flat cut round the back runs on into the
    # neck, and a band there reads as two garments.
    trim = hem_rings(bm, {v.index for v in bm.verts
                          if v.is_boundary and v.co.z > collar_z + 1e-4})
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    left = len(G.crossing_verts(obj))
    print(f"SHELL {len(me.vertices)} verts, {left} crossing")
    if left:
        raise SystemExit(f"the hood folds at {left} vertices")
    return obj, dict(
        shell_vertices=len(me.vertices), stand_mm=round(stand * 1000, 2),
        collar_z=round(collar_z, 5), face_rim=sorted(face_rim), hem=hem, trim=trim,
        head_c=head_c.copy())


def thicken(inner, hem, centre, name="cowl_outer"):
    """The outer face, built FROM the finished inner one rather than beside it.

    Two shells offset from the same skin are two different meshes the moment
    either is relaxed, and each was: 56 crossings on one, 62 on the other, each
    pulled back at its own vertices. The wall between them then varies by
    whatever the two relaxations disagreed about, which is where 337 crossings
    came from with not one bridging face in the mesh. `prep_gauntlet.follow`
    exists to repair exactly that. Not diverging in the first place is cheaper.

    The offset runs along the head RADIUS and not along the surface normal. The
    inner face is a radial graph about that one centre, so a second graph over
    the same directions at a greater radius cannot meet it anywhere - whereas a
    normal offset folds at every crease sharper than the wall, and left 404
    crossings. It costs perpendicular thickness wherever the surface runs edge
    on to the radius, which `wall_profile` measures rather than assumes. The
    offset closes to nothing over the hem, so the two layers still meet on the
    rim.

    Where the surface runs edge on, a wall that grows ring by ring shears one
    triangle over the next. Those vertices take their thinnest neighbour's wall
    until nothing folds; the rim's zero is not offered, so the hem stays a hem.
    """
    outer = inner.copy()
    outer.data = inner.data.copy()
    outer.name = outer.data.name = name
    bpy.context.scene.collection.objects.link(outer)
    # `centre` is a point, or a function of the vertex for a shell graphed
    # about an axis rather than a point.
    origin = [centre(v.co) if callable(centre) else centre for v in inner.data.vertices]
    base = [v.co - o for v, o in zip(inner.data.vertices, origin)]
    wall = [WOOL * wall_band(hem.get(i, HEM_RINGS)) for i in range(len(base))]
    near = [[] for _ in base]
    for e in inner.data.edges:
        a, b = e.vertices
        if hem.get(b, HEM_RINGS):
            near[a].append(b)
        if hem.get(a, HEM_RINGS):
            near[b].append(a)
    for _ in range(EASE_STEPS):
        for i, v in enumerate(outer.data.vertices):
            if base[i].length > 1e-9:
                v.co = origin[i] + base[i].normalized() * (base[i].length + wall[i])
        outer.data.update()
        hurt = G.crossing_verts(outer)
        if not hurt:
            break
        wall = [min([wall[i]] + [wall[j] for j in near[i]]) if i in hurt else wall[i]
                for i in range(len(wall))]
    else:
        raise SystemExit(f"the outer layer still folds at {len(hurt)} vertices")
    print(f"EASE {sum(1 for i, w in enumerate(wall) if w < WOOL * wall_band(hem.get(i, HEM_RINGS)))}"
          f" vertices thinned")
    return outer


def wall_profile(inner, outer):
    """How thick the wool actually came out, measured ACROSS the inner face.

    Not the distance between the two layers: the offset runs along the head
    radius, so that distance is the wall by definition and says nothing. The
    component along the inner surface's own normal is the thickness a renderer
    and a cutting plane both see.

    `prep_gauntlet.follow` is deliberately NOT used here. It exists to pull an
    inner face back under an outer one after the two have been relaxed apart,
    and it pays for that with a share of the clearance - which on a hemmed shell
    is exactly backwards: at the hem the two layers are MEANT to meet, so the
    rule read a 5 mm clearance and a zero wall as a fault and pulled 150
    vertices into a 0.5 mm sliver. Here the outer is the inner plus the wall
    along one shared direction and neither layer needed a single relaxation
    pass, so there is nothing to correct and only something to measure.
    """
    normals = [v.vector for v in inner.data.vertex_normals]
    d = sorted(abs((outer.data.vertices[i].co - inner.data.vertices[i].co)
                   .dot(normals[i]))
               for i in range(len(inner.data.vertices)))
    n = len(d)
    print(f"WALL min {d[0]*1000:.2f} p05 {d[n//20]*1000:.2f} median "
          f"{d[n//2]*1000:.2f} max {d[-1]*1000:.2f} mm over {n} vertices")
    return round(d[0] * 1000, 3), round(d[n // 2] * 1000, 3)


def fold_stitch(inner, outer, folded):
    """One closed shell out of two offsets of the same skin.

    The two layers SHARE the face opening's own ring instead of being bridged
    across it. A bridge is one quad per rim edge, and wherever the rim turns
    tighter than the wall is thick those quads fan into each other: 32 crossing
    vertices that no relaxation could reach, because the outer half of a
    stitched shell has nowhere to be pulled back to. A garment is hemmed, not
    welded to a strip of its own cloth, and the offset is tapered to nothing
    over `HEM_RINGS` so the fold is a hem and not a pinch.

    Both rings are folded, so nothing is bridged at all and the shell is closed.
    """
    n = len(outer.data.vertices)
    if len(inner.data.vertices) != n:
        raise SystemExit(f"the two offsets disagree: {len(inner.data.vertices)} inner "
                         f"vertices against {n} outer")
    bm = bmesh.new()
    # Which layer each face is, for `paint`: 0 outer, 1 inner, 2 bridge.
    side = bm.faces.layers.int.new("side")
    out_v = [bm.verts.new(v.co) for v in outer.data.vertices]
    in_v = [out_v[i] if i in folded else bm.verts.new(v.co)
            for i, v in enumerate(inner.data.vertices)]
    bm.verts.index_update()
    dropped = 0
    for poly in outer.data.polygons:
        try:
            bm.faces.new([out_v[i] for i in poly.vertices])[side] = 0
        except ValueError:
            dropped += 1
    for poly in inner.data.polygons:
        vs = [in_v[i] for i in reversed(poly.vertices)]
        # A triangle lying wholly in the hem ring IS the outer one already.
        if len(set(vs)) < 3:
            dropped += 1
            continue
        try:
            bm.faces.new(vs)[side] = 1
        except ValueError:
            dropped += 1
    bm.faces.index_update()

    rim = bmesh.new()
    rim.from_mesh(inner.data)
    edges = [(e.verts[0].index, e.verts[1].index) for e in rim.edges
             if len(e.link_faces) < 2
             and e.verts[0].index not in folded and e.verts[1].index not in folded]
    rim.free()
    for a, b in edges:
        bm.faces.new((out_v[a], out_v[b], in_v[b], in_v[a]))[side] = 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update()
    creased = 0
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > G.SHARP:
            e.smooth = False
            creased += 1
    bm.to_mesh(outer.data)
    bm.free()
    outer.data.update()
    for poly in outer.data.polygons:
        poly.use_smooth = True
    print(f"HEM {len(folded)} rim vertices shared, {dropped} hem faces dropped, "
          f"{len(edges)} edges bridged, {creased} edges drawn sharp")
    return len(folded), len(edges), [i for i in range(n) if i not in folded]


def box_uvs(obj):
    """Each face projected along its dominant axis, in metres over one weave tile."""
    uv = obj.data.uv_layers.new(name="UVMap")
    for poly in obj.data.polygons:
        a = max(range(3), key=lambda k: abs(poly.normal[k]))
        s, t = [k for k in range(3) if k != a]
        for li in poly.loop_indices:
            co = obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv = (co[s] / WEAVE, co[t] / WEAVE)


def wool_maps():
    """The BlenderKit weave: its normal as is, its base colour as grey about TEX_MEAN."""
    with bpy.data.libraries.load(WOOL_SRC) as (src, dst):
        dst.images = [n for n in src.images if n.endswith(("_BaseColor.jpg", "_Normal.jpg"))]
    if len(dst.images) != 2:
        raise SystemExit(f"{WOOL_SRC} lacks its base colour or normal: {dst.images}")
    base, normal = sorted(dst.images, key=lambda im: im.name.endswith("_Normal.jpg"))
    for im in (base, normal):
        im.scale(TEX_PX, TEX_PX)
    px = np.empty(len(base.pixels), dtype=np.float32)
    base.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lin = np.where(px[:, :3] <= 0.04045, px[:, :3] / 12.92,
                   ((px[:, :3] + 0.055) / 1.055) ** 2.4)
    grey = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    grey = np.clip(1.0 + (grey / grey.mean() - 1.0) * WEAVE_CONTRAST, 0.2, 3.0)
    out = np.clip(np.outer(grey, (TEX_MEAN,) * 3), 0.0, 1.0)
    px[:, :3] = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    base.pixels.foreach_set(px.ravel())
    base.update()
    return base, normal


def paint(obj, trim):
    """Charcoal outside, red lining inside, a trim band `TRIM_RINGS` deep along the hem.

    Per face corner, so the two layers keep their own colour on the vertices
    they share at the fold. `trim` is the ring depth of each outer vertex.
    """
    side = obj.data.attributes["side"]
    col = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    counts = [0, 0, 0]
    for poly in obj.data.polygons:
        if side.data[poly.index].value == 1:
            c, k = LINING, 1
            for li in poly.loop_indices:
                col.data[li].color = c
        else:
            # Per corner, so a face across the band's edge blends it rather than
            # stepping it along the triangulation.
            k = 0
            for li in poly.loop_indices:
                banded = trim.get(obj.data.loops[li].vertex_index, TRIM_RINGS) < TRIM_RINGS
                col.data[li].color = TRIM if banded else CLOTH
                k = 2 if banded else k
        counts[k] += 1
    obj.data.attributes.remove(side)
    print(f"PAINT {obj.name}: {counts[0]} cloth, {counts[1]} lining, {counts[2]} trim faces")
    return counts


_WOOL = {}


def wool(obj):
    """The weave, multiplied by the vertex colour `paint` laid down."""
    box_uvs(obj)
    if MATERIAL in _WOOL:
        obj.data.materials.append(_WOOL[MATERIAL])
        return _WOOL[MATERIAL]
    base, normal = wool_maps()
    mat = bpy.data.materials.new(MATERIAL)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    col = nodes.new("ShaderNodeTexImage")
    col.image = base
    tint = nodes.new("ShaderNodeVertexColor")
    tint.layer_name = "Col"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    links.new(col.outputs["Color"], mix.inputs[6])
    links.new(tint.outputs["Color"], mix.inputs[7])
    links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    nrm = nodes.new("ShaderNodeTexImage")
    nrm.image = normal
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = NORMAL_STRENGTH
    links.new(nrm.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = G.CLOTH_ROUGHNESS
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(mat)
    _WOOL[MATERIAL] = mat
    return mat


def worn_surfaces():
    """The fitted robe and gorget, read back out of the built wardrobe.

    The neck has to sit inside the robe as it is WORN, which only the build
    knows: the robe's own fitter moves and reshapes its donor. Returned as world
    triangles per piece plus the Head joint, so `main` can prove the two builds
    share a rig.
    """
    W.clear_scene()
    bpy.ops.import_scene.gltf(filepath=W.OUT)
    soups = {}
    for name in (ROBE, GORGET):
        o = bpy.data.objects.get(name)
        if o is None:
            raise SystemExit(f"{W.OUT} carries no {name}: build the wardrobe first")
        verts = [(o.matrix_world @ v.co).copy() for v in o.data.vertices]
        tris = []
        for poly in o.data.polygons:
            idx = list(poly.vertices)
            tris += [(idx[0], idx[k], idx[k + 1]) for k in range(1, len(idx) - 1)]
        soups[name] = (verts, tris)
    rig = bpy.data.objects[W.MALE_RIG]
    head = (rig.matrix_world @ rig.data.bones["Head"].head_local).copy()
    W.clear_scene()
    return soups, head


def region_tris(body, groups, verts, tris):
    """Append the body's skin over `groups` to a triangle soup, in world space."""
    keep = {body.vertex_groups[g].index for g in groups}
    me = body.data.copy()
    me.transform(body.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    dl = bm.verts.layers.deform.active
    doomed = [v for v in bm.verts
              if sum(w for gi, w in v[dl].items() if gi in keep) < REGION_WEIGHT]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.verts.index_update()
    base = len(verts)
    verts += [v.co.copy() for v in bm.verts]
    tris += [tuple(base + v.index for v in f.verts) for f in bm.faces]
    bm.free()


def outermost(bvh, far, d, ok):
    """The first surface `ok` accepts, coming in from `far` along -d.

    In the T-pose a ray at shoulder height meets the sleeve half a metre out
    before it meets the shoulder, and the wool rests on the shoulder.
    """
    o = far
    for _ in range(32):
        hit = bvh.ray_cast(o, -d)[0]
        if hit is None:
            return None
        if ok(hit):
            return hit
        o = hit - d * 1e-4
    return None


def neck_shell(body, rig, worn, hood, hem_top, name="neck_inner"):
    """A tube about the neck axis, from over the hood down over the robe.

    Each column rides the outermost skin or gorget under it and is low-passed
    across columns and down itself, never below that floor. Rows run from the
    top, NECK_TUCK over the hood's fitted hem and dipping under the chin at the
    front, down to that column's foot, so both rims are rows and neither is cut
    vertex by vertex. The foot is NECK_DRAPE below the neckline, the first
    height, going down, at which the robe stands out from the neck, and the wall
    lies on the robe's outer face all the way down to it.
    """
    under_v, under_t = list(worn[GORGET][0]), list(worn[GORGET][1])
    region_tris(body, NECK_SKIN, under_v, under_t)
    under = BVHTree.FromPolygons(under_v, under_t)
    robe = BVHTree.FromPolygons(*worn[ROBE])
    M, bones = rig.matrix_world, rig.data.bones
    axis_y = ((M @ bones["neck_01"].head_local).y + (M @ bones["neck_01"].tail_local).y) / 2
    low_z = (M @ bones["spine_03"].head_local).z
    top_z = hem_top + NECK_TUCK

    def top_at(theta):
        """The top at angle theta round the axis, 0 facing front."""
        t = min(1.0, abs(math.remainder(theta, 2 * math.pi)) / NECK_FRONT_HALF)
        return hem_top + NECK_FRONT_DZ + (top_z - hem_top - NECK_FRONT_DZ) * t * t * (3 - 2 * t)

    def radius(bvh, z, d):
        """The outermost surface on this side of the axis; a ray that finds none
        in front of the neck runs on to the robe's back collar behind it."""
        c = Vector((0.0, axis_y, z))
        hit = outermost(bvh, c + d * REACH, d, lambda p: (p - c).dot(d) > 0)
        return None if hit is None else (hit - c).length

    def robe_face(z, d, beyond):
        """The robe's outer face nearest the neck, going out past radius `beyond`.

        Not the outermost robe: at shoulder height that is the T-posed sleeve,
        and a wall on it runs down the arm. The collar's rolled layers lie within
        NECK_ROBE_LAYERS of the first one.
        """
        c = Vector((0.0, axis_y, z))
        o, first, face = c, None, None
        for _ in range(32):
            hit = robe.ray_cast(o, d, REACH)[0]
            if hit is None:
                break
            rr = (hit - c).length
            if rr > beyond:
                if first is None:
                    first = rr
                elif rr > first + NECK_ROBE_LAYERS:
                    break
                face = rr
            o = hit + d * 1e-4
        return face

    n_a = NECK_COLUMNS
    # The robe's vertices by column: the collar's cut rim is a level flange that a
    # level ray only ever meets edge on.
    by_column = [[] for _ in range(n_a)]
    for p in worn[ROBE][0]:
        a = round(math.atan2(p.x, -(p.y - axis_y)) / (2 * math.pi) * n_a) % n_a
        by_column[a].append((p.z, math.hypot(p.x, p.y - axis_y)))
    thetas = [2 * math.pi * a / n_a for a in range(n_a)]
    outs = [Vector((math.sin(t), -math.cos(t), 0.0)) for t in thetas]   # 0 faces front
    tops = [top_at(t) for t in thetas]
    zs = [top_z - NECK_STEP * k for k in range(int((top_z - low_z) / NECK_STEP) + 1)]

    skin, robes, necks, covers = [], [], [], []
    for a, d in enumerate(outs):
        col, robe_col, neck = [], [], None
        for z in zs:
            lo = radius(under, z, d)
            out = None if lo is None else robe_face(z, d, lo - NECK_GAP)
            col.append(lo)
            robe_col.append(out)
            if neck is None and z <= tops[a] and lo is not None:
                if out is not None and out > lo + NECK_ROOM:
                    neck = z
            if neck is not None and z < neck - NECK_DRAPE:
                break
        if neck is None:
            raise SystemExit(f"column {a} never meets the robe outside the neck")
        known = [c for c in col if c is not None]
        if not known:
            raise SystemExit(f"column {a} meets no skin at all")
        # Where a ray misses, the column keeps the nearest radius above it.
        last, filled = known[0], []
        for c in col:
            last = c if c is not None else last
            filled.append(last)
        skin.append(filled)
        robes.append(robe_col)
        necks.append(neck)
        # The robe opens a little under its rim toward the front: the foot ends
        # where the robe under it does, or it hangs over that opening.
        k = zs.index(neck)
        while k + 1 < len(robe_col) and robe_col[k + 1] is not None and zs[k + 1] >= neck - NECK_DRAPE:
            k += 1
        covers.append(zs[k])
    hem = list(covers)
    for _ in range(NECK_HEM_PASSES):
        hem = [(hem[a - 1] + hem[a] * 2 + hem[(a + 1) % n_a]) / 4 for a in range(n_a)]
    # Smoothing may drop a foot past the robe under it.
    hem = [min(max(h, c), max(z - NECK_DRAPE, c)) for h, c, z in zip(hem, covers, necks)]

    def sampled(a, z):
        """The floor radius of column a at height z, read off its samples."""
        col = skin[a]
        k = min(len(col) - 1, max(0.0, (top_z - z) / NECK_STEP))
        lo = int(k)
        hi = min(lo + 1, len(col) - 1)
        return col[lo] + (col[hi] - col[lo]) * (k - lo)

    rows = NECK_ROWS + 1
    # The foot turns in under the robe from the higher neckline of its neighbours:
    # at the side two columns 5 degrees apart read necklines 20 mm apart, one ran
    # out along the shoulder while the next turned in, and the wall sheared.
    held = necks
    for _ in range(2):
        held = [max(held[a - 1], held[a], held[(a + 1) % n_a]) for a in range(n_a)]

    def shape(hem):
        """The wall for feet at these heights, and the flare cap per column."""
        z_at = [[tops[a] - (tops[a] - hem[a]) * u / NECK_ROWS for u in range(rows)]
                for a in range(n_a)]
        # Under the neckline the foot follows the skin in but never out: out ran it
        # flat along the T-posed shoulder, and the two layers crossed on that shelf.
        floor = [[min(sampled(a, z_at[a][u]), sampled(a, max(z_at[a][u], held[a])))
                  for u in range(rows)] for a in range(n_a)]
        # Over the hood the wool lies on its outer face: the shoulder stands up
        # through the hood's hem toward the back, even in idle, so nothing fits inside
        # it. Below the hem the wool hangs straight on, or it tucks in under the hem
        # and cuts its fold. The hood's folds stand out between two columns, so each
        # reads the hood across its whole width and half a row up and down.
        # Past the hood's corners the hang falls off by NECK_HANG_FALLOFF a column,
        # or the wall steps in to the throat and that step folds when the head dips.
        half = math.pi / n_a
        hang, below = [None] * n_a, [rows] * n_a
        for a in range(n_a):
            fan = [Vector((math.sin(thetas[a] + s * half), -math.cos(thetas[a] + s * half), 0.0))
                   for s in (-1, 0, 1)]
            dz = (tops[a] - hem[a]) / NECK_ROWS / 2
            for u in range(rows):
                hits = [h for h in (radius(hood, z_at[a][u] + s * dz, d) for s in (-1, 0, 1) for d in fan)
                        if h is not None]
                if hits:
                    hang[a] = max(hits) + NECK_HOOD_GAP - NECK_GAP
                    floor[a][u] = max(floor[a][u], hang[a])
                    below[a] = u + 1
        spread = [max(h - NECK_HANG_FALLOFF * min(abs(a - b), n_a - abs(a - b))
                      for b, h in enumerate(hang) if h is not None) for a in range(n_a)]
        for a in range(n_a):
            for u in range(below[a] if hang[a] is not None else 0, rows):
                floor[a][u] = max(floor[a][u], spread[a])
        # The robe is read the same way but twice as finely, its roll being folds
        # a few millimetres across, and the wool lies on its outer face; past
        # NECK_DRAPE_OUT outside the top, the robe a ray meets is a sleeve.
        cloth = [[0.0] * rows for _ in range(n_a)]
        steps = (-1, -0.5, 0, 0.5, 1)
        for a in range(n_a):
            fan = [Vector((math.sin(thetas[a] + s * half), -math.cos(thetas[a] + s * half), 0.0))
                   for s in steps]
            dz = (tops[a] - hem[a]) / NECK_ROWS / 2
            for u in range(rows):
                beyond = sampled(a, z_at[a][u]) - NECK_GAP
                on = [h for h in (robe_face(z_at[a][u] + s * dz, d, beyond) for s in steps for d in fan)
                      if h is not None and h <= floor[a][0] + NECK_DRAPE_OUT]
                on += [h for b in (a - 1, a, (a + 1) % n_a) for z, h in by_column[b]
                       if abs(z - z_at[a][u]) <= 2 * dz and beyond < h <= floor[a][0] + NECK_DRAPE_OUT]
                if on:
                    cloth[a][u] = max(on) + NECK_ROBE_GAP - NECK_GAP
                    floor[a][u] = max(floor[a][u], cloth[a][u])
        r = [row[:] for row in floor]
        for _ in range(NECK_ROUNDS):
            r = [[max(r[a][u], floor[a][u]) for u in range(rows)] for a in range(n_a)]
            for _ in range(NECK_PASSES):
                r = [[(r[a - 1][u] + r[a][u] * 2 + r[(a + 1) % n_a][u]) / 4 for u in range(rows)]
                     for a in range(n_a)]
                r = [[(r[a][max(0, u - 1)] + r[a][u] * 2 + r[a][min(rows - 1, u + 1)]) / 4
                      for u in range(rows)] for a in range(n_a)]
        r = [[max(r[a][u], floor[a][u]) for u in range(rows)] for a in range(n_a)]
        # A neck, not a cape: past NECK_FLARE outside its top the wall runs straight
        # down into the gorget and robe instead of out along the T-posed trapezius.
        # The robe is the exception: the wool never passes into it.
        caps = [r[a][0] + NECK_FLARE for a in range(n_a)]
        r = [[max(cloth[a][u], min(r[a][u], caps[a])) for u in range(rows)] for a in range(n_a)]
        return z_at, r, caps

    z_at, r, caps = shape(hem)
    # Where the robe stands NECK_DRAPE_OUT outside the wall's top the foot ends
    # above it: following the robe on out is a cape over the shoulder. Walked
    # from under the hood, not from the neckline: the collar's roll stands that
    # far out AT the neckline at the sides, and a foot there is inside the roll.
    ends = []
    for a in range(n_a):
        k = next(j for j, z in enumerate(zs) if z <= hem_top)
        while k + 1 < len(robes[a]) and zs[k + 1] >= hem[a]:
            out = robes[a][k + 1]
            if out is None and zs[k + 1] < necks[a]:
                break
            if out is not None and out > r[a][0] + NECK_DRAPE_OUT:
                break
            k += 1
        ends.append(zs[k])
    raised = ends
    for _ in range(2):
        raised = [max(raised[a - 1], raised[a], raised[(a + 1) % n_a]) for a in range(n_a)]
    for _ in range(NECK_HEM_PASSES):
        raised = [max(ends[a], (raised[a - 1] + raised[a] * 2 + raised[(a + 1) % n_a]) / 4)
                  for a in range(n_a)]
    short = sum(e > h + 1e-9 for e, h in zip(ends, hem))
    hem = raised
    z_at, r, caps = shape(hem)
    print(f"NECK {short} feet stop short of a full drape")
    print(f"NECK axis y {axis_y:.4f}, top {top_z:.4f}, neckline {min(necks):.4f}..{max(necks):.4f}, "
          f"foot {min(hem):.4f}..{max(hem):.4f}, "
          f"top radius {min(row[0] for row in r) * 1000:.1f}..{max(row[0] for row in r) * 1000:.1f} mm")

    bm = bmesh.new()
    grid = []
    for a in range(n_a):
        ring = []
        for u in range(rows):
            z = z_at[a][u]
            lift = NECK_FOLD_AMP * (1.0 + noise.noise(Vector((
                math.cos(thetas[a]) * NECK_FOLD_ACROSS, math.sin(thetas[a]) * NECK_FOLD_ACROSS,
                z * NECK_FOLD_DOWN)) + FOLD_OFFSET)) / 2
            ring.append(bm.verts.new(Vector((0.0, axis_y, z)) + outs[a] * (r[a][u] + NECK_GAP + lift)))
        grid.append(ring)
    for a in range(n_a):
        b = (a + 1) % n_a
        for u in range(NECK_ROWS):
            bm.faces.new((grid[a][u], grid[a][u + 1], grid[b][u + 1], grid[b][u]))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.verts.index_update()
    loops = rim_loops(bm)
    if loops != 2:
        raise SystemExit(f"a neck has a top and a foot; this has {loops} openings")
    rim = {v.index for v in bm.verts if v.is_boundary}
    hem_d = hem_rings(bm, rim)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    left = len(G.crossing_verts(obj))
    print(f"NECK SHELL {len(me.vertices)} verts, {left} crossing")
    if left:
        raise SystemExit(f"the neck folds at {left} vertices")

    def column(co):
        return round(math.atan2(co.x, -(co.y - axis_y)) / (2 * math.pi) * n_a) % n_a

    return obj, dict(rim=sorted(rim), hem=hem_d, under=under, robe=robe,
                     axis=lambda co: Vector((0.0, axis_y, co.z)),
                     neckline=lambda co: necks[column(co)],
                     held=lambda co: held[column(co)],
                     # Under the flare cap the wall is inside the skin or gorget on purpose.
                     buried=lambda co: sampled(column(co), co.z) + NECK_GAP > caps[column(co)],
                     # Level out of the axis: the tube stands near upright, and an
                     # upward share sheared one row over the next under the chin,
                     # where the rows run 1-2 mm apart.
                     wall_from=lambda co: co - Vector((co.x, co.y - axis_y, 0.0)).normalized(),
                     top_z=round(top_z, 5), neckline_z=[round(min(necks), 5), round(max(necks), 5)],
                     feet_short=short,
                     shell_vertices=len(me.vertices))


def roundtrip(path, tris, woollen):
    """Read one export back and prove the geometry and the colour survived it."""
    back = G.import_one(path)
    tris_back = G.triangles(back)
    if abs(tris_back - tris) > tris * ROUNDTRIP_TOLERANCE:
        raise SystemExit(f"{path} lost geometry: {tris} triangles in Blender, "
                         f"{tris_back} back through the file")
    if woollen:
        maps = sorted({n.image.name: tuple(n.image.size)
                       for n in back.data.materials[0].node_tree.nodes
                       if n.type == "TEX_IMAGE" and n.image}.items())
        cols = [c.name for c in back.data.color_attributes]
        print(f"MAPS {path}: {maps} uv={[u.name for u in back.data.uv_layers]} colour={cols}")
        if len(maps) != 2 or not back.data.uv_layers or not cols:
            raise SystemExit(f"{path}: the weave or the colour did not survive the export")
    return back, tris_back


def main():
    worn, worn_head = worn_surfaces()
    for spec in W.LOOKS:
        W.build_look(spec)
    rig = bpy.data.objects[W.MALE_RIG]
    body = bpy.data.objects["base.male.body"]
    moved = (rig.matrix_world @ rig.data.bones["Head"].head_local - worn_head).length
    if moved > 1e-4:
        raise SystemExit(f"{W.OUT} was built on another rig: its Head is {moved * 1000:.2f} mm away")

    inner, detail = cowl_shell(body, "cowl_inner")
    outer = thicken(inner, detail["hem"], detail["head_c"])
    thinnest, median_wall = wall_profile(inner, outer)
    shared, bridged, _ = fold_stitch(inner, outer, set(detail["face_rim"]))
    donor = outer
    # No relaxation here either. The inner face is a radial graph that measured
    # clean, and the outer is the same graph further out; if the fold of the two
    # crosses, that is a fault to read off the mesh, and pulling vertices about
    # only buried it - the stitched relaxation ran 277 crossings up to 2777.
    W.drop(inner)
    hood_paint = paint(donor, detail["trim"])
    wool(donor)

    tris = G.triangles(donor)
    crossings = G.self_crossings(donor)
    print(f"SHELL {detail['shell_vertices']} verts per layer, {shared} hem shared, "
          f"{len(donor.data.vertices)} verts, {tris} tris, crossings {crossings}")
    if crossings > SEAM_CROSSINGS:
        raise SystemExit(f"the shell folds into itself: {crossings} crossing triangle pairs")

    # `placed` lands the donor's bbox centre on the head's, and a shell with no
    # face in it has its own centre behind that: without this the fitter can only
    # recover the depth by growing the whole cowl.
    _, _, head_dims, head_c = W.bbox(W.group_points(body, "Head"))
    _, _, _, donor_c = W.bbox([v.co for v in donor.data.vertices])
    back_shift = (donor_c.y - head_c.y) / head_dims.y
    print(f"BACK_SHIFT measured {back_shift:+.5f} of head depth "
          f"({(donor_c.y - head_c.y) * 1000:+.2f} mm)")
    fit_args = dict(FIT_ARGS, back_shift=back_shift)
    M_fit, fit = W.fit_head_shell(donor, body, rig, **fit_args)
    print("FIT", json.dumps(fit))
    # The neck is fitted to the hood as the BUILD will place it, not as built.
    hem_top = min((M_fit @ v.co).z for v in donor.data.vertices)

    donor.data.calc_loop_triangles()
    hood_bvh = BVHTree.FromPolygons([(M_fit @ v.co).copy() for v in donor.data.vertices],
                                    [tuple(t.vertices) for t in donor.data.loop_triangles])
    neck_inner, ndet = neck_shell(body, rig, worn, hood_bvh, hem_top)
    neck = thicken(neck_inner, ndet["hem"], ndet["wall_from"], "neck")
    neck_thin, neck_median = wall_profile(neck_inner, neck)
    neck_shared, _, _ = fold_stitch(neck_inner, neck, set(ndet["rim"]))
    W.drop(neck_inner)
    neck_paint = paint(neck, {})
    wool(neck)
    neck_tris = G.triangles(neck)
    neck_crossings = G.self_crossings(neck)
    print(f"NECK {len(neck.data.vertices)} verts, {neck_tris} tris, crossings {neck_crossings}")
    if neck_crossings > SEAM_CROSSINGS:
        raise SystemExit(f"the neck folds into itself: {neck_crossings} crossing triangle pairs")
    pts = [v.co.copy() for v in neck.data.vertices]
    clear01, clear_median = W.gap_profile(ndet["under"],
                                          [p for p in pts if p.z >= ndet["held"](p)
                                           and not ndet["buried"](p)])

    def covered(bvh, p):
        """Does `bvh` stand outside p, level out of the neck axis?"""
        d = (p - ndet["axis"](p)).normalized()
        return bvh.ray_cast(p + d * 1e-4, d)[0] is not None

    # The wool never lies under the hood or the robe nor passes through either;
    # below its neckline it lies on the robe, the outer layer a wall further out.
    top = [p for p in pts if p.z > hem_top - 0.002]
    foot = [p for p in pts if p.z < ndet["neckline"](p) - 0.002]
    over_hood = 1.0 - sum(covered(hood_bvh, p) for p in top) / max(1, len(top))
    over_robe = 1.0 - sum(covered(ndet["robe"], p) for p in foot) / max(1, len(foot))
    # How far the foot point furthest from the robe stands off it.
    lift = max([ndet["robe"].find_nearest(p)[3] for p in foot], default=0.0)
    through = len(hood_bvh.overlap(W.bvh_of(neck)))
    through_robe = len(ndet["robe"].overlap(W.bvh_of(neck)))
    print(f"NECK clearance p01 {clear01 * 1000:.2f} median {clear_median * 1000:.2f} mm, "
          f"over the hood {over_hood:.4f} of {len(top)}, over the robe {over_robe:.4f} of {len(foot)} "
          f"(furthest {lift * 1000:.2f} mm off), {through} triangle pairs through the hood, "
          f"{through_robe} through the robe")
    if clear01 < NECK_MIN_CLEAR:
        raise SystemExit(f"the neck sits in the skin or gorget: p01 clearance {clear01 * 1000:.2f} mm")
    if not top or over_hood < 1.0:
        raise SystemExit(f"the neck slips under the hood: {over_hood:.4f} over it")
    if not foot or over_robe < 1.0:
        raise SystemExit(f"the neck's foot slips under the robe: {over_robe:.4f} over it")
    if lift > NECK_DRAPE_AIR + WOOL:
        raise SystemExit(f"the neck's foot stands {lift * 1000:.2f} mm off the robe")
    if through:
        raise SystemExit(f"the neck passes through the hood at {through} triangle pairs")
    if through_robe:
        raise SystemExit(f"the neck passes through the robe at {through_robe} triangle pairs")

    pieces = [(donor, STEM, tris, True), (neck, NECK_STEM, neck_tris, True)]
    for obj, stem, _, _ in pieces:
        G.export(obj, [os.path.join(W.GEAR_SRC, f"{stem}.glb"), f"{KEEP_DIR}/{stem}.glb"])
    W.clear_scene()
    reloaded = {}
    os.makedirs(REVIEW, exist_ok=True)
    for _, stem, n, woollen in pieces:
        back, reloaded[stem] = roundtrip(os.path.join(W.GEAR_SRC, f"{stem}.glb"), n, woollen)
        G.render(back, {v: os.path.join(REVIEW, f"{stem}-{v}.png")
                        for v in ("front", "quarter", "side", "rear")},
                 views={"front": Vector((0, -1, 0)), "side": Vector((-1, 0, 0)),
                        "rear": Vector((0, 1, 0)),
                        "quarter": Vector((-0.62, -0.66, 0.42)).normalized()})

    report = {
        "built_from": "hood: icosphere hung on the low-passed radius of base.male.body "
                      "Head + neck_01, cut at the hood hem and the face opening, tip drawn "
                      "up and back; neck: a tube about the neck axis on the skin and the "
                      "fitted chest.ember.gorget, over the hood's hem and draped over "
                      "chest.ember.robe out of wardrobe.glb",
        "skin_gap_mm": SKIN_GAP * 1000, "wall_mm": WOOL * 1000,
        "sphere_subdiv": SPHERE_SUBDIV, "hood_passes": HOOD_PASSES, "hood_stand_mm": detail["stand_mm"],
        "hem_rings": HEM_RINGS,
        "face_opening": {"top_w": FACE_TOP, "bottom_w": FACE_BOTTOM,
                         "half_u": FACE_HALF, "power": FACE_POWER, "front_v": FACE_FRONT},
        "tip": {"dir": list(TIP_DIR), "front_deg": math.degrees(TIP_FRONT),
                "back_deg": math.degrees(TIP_BACK), "len": TIP_LEN, "power": TIP_POWER},
        "hem_w": HEM_W, "hem_z": detail["collar_z"],
        "shell_vertices": detail["shell_vertices"],
        "rim_edges": bridged, "hem_shared": shared,
        "thinnest_wall_mm": thinnest, "median_wall_mm": median_wall,
        "triangles": tris, "triangles_reloaded": reloaded[STEM], "self_crossings": crossings,
        "paint_faces": hood_paint,
        "back_shift": round(back_shift, 5), "fit": fit, "fit_args": fit_args,
        "fitted_hem_z": round(hem_top, 5),
        "neck": {
            "shell_vertices": ndet["shell_vertices"], "hem_shared": neck_shared,
            "top_z": ndet["top_z"], "neckline_z": ndet["neckline_z"],
            "thinnest_wall_mm": neck_thin, "median_wall_mm": neck_median,
            "triangles": neck_tris, "triangles_reloaded": reloaded[NECK_STEM],
            "self_crossings": neck_crossings, "paint_faces": neck_paint,
            "clearance_p01_mm": round(clear01 * 1000, 2),
            "clearance_median_mm": round(clear_median * 1000, 2),
            "over_hood": round(over_hood, 4), "over_robe": round(over_robe, 4),
            "foot_lift_mm": round(lift * 1000, 2), "through_robe": through_robe,
            "feet_short": ndet["feet_short"],
            "through_hood": through,
        },
        "look": "ember", "material": MATERIAL,
        "roughness_pre_matte": G.CLOTH_ROUGHNESS,
        "wrote": [f"{KEEP_DIR}/{stem}.glb" for _, stem, _, _ in pieces],
    }
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=1)
    print("PREP", json.dumps(report))


if __name__ == "__main__":
    main()
