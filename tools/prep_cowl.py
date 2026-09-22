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
the jaw. Radial noise gives the wool its folds, a BlenderKit weave its surface.

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
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_wardrobe as W  # noqa: E402  (Blender runs this file directly)
import prep_gauntlet as G  # noqa: E402  (the shell maths is that file's)

STEM = "cowl-head-v1"
DONOR = os.path.join(W.GEAR_SRC, f"{STEM}.glb")
KEPT = f"D:/VSC/exiled-casual/assets/props/source/{STEM}.glb"
REPORT = f"D:/VSC/exiled-casual/assets/props/source/{STEM}.json"
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
FIT_ARGS = {"width_from": 1.0}

# Folds hung on the hood radius: a few millimetres of Perlin noise, fine across
# the head and coarse down it, so the ridges run the way cloth hangs.
FOLD_AMP = 0.008
FOLD_ACROSS = 5.0
FOLD_DOWN = 1.5
FOLD_OFFSET = Vector((3.7, 1.3, 5.1))   # a fixed slice of the noise field

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


def smooth_rim(bm, centre, floor_z):
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
    The collar ring is left alone; the bisect already cut it flat.
    """
    moved = 0
    for _ in range(RIM_PASSES):
        step = {}
        for v in bm.verts:
            if not v.is_boundary or v.co.z <= floor_z:
                continue
            near = [e.other_vert(v).co for e in v.link_edges
                    if len(e.link_faces) < 2 and e.other_vert(v).co.z > floor_z]
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


def hood_field(bm, r0):
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
    for _ in range(HOOD_PASSES):
        r = [(r[i] + sum(r[j] for j in near[i])) / (1 + len(near[i])) for i in range(len(r))]
    stand = max(a - b for a, b in zip(r0, r) if a is not None)
    return filled, r, stand


def fold(d):
    """Radial give in the wool: long vertical folds, so the hood is not a lathe part.

    Along the head radius only, so the shell stays a radial graph and cannot fold.
    """
    return FOLD_AMP * noise.noise(Vector((d.x * FOLD_ACROSS, d.y * FOLD_ACROSS,
                                          d.z * FOLD_DOWN)) + FOLD_OFFSET)


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
        v.co = head_c + dirs[i] * max(smoothed[i] + stand + SKIN_GAP + fold(dirs[i]),
                                      filled[i] + SKIN_GAP)
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
    relaxed = smooth_rim(bm, head_c, collar_z + 1e-4)
    print(f"RIM {burrs} spiked faces cut, {loops} openings left, {relaxed} rim vertices relaxed")
    if loops != 1:
        raise SystemExit(f"a hood has ONE hem, up the front and round the back; this has {loops}")
    bm.verts.index_update()
    face_rim = {v.index for v in bm.verts if v.is_boundary}
    hem = hem_rings(bm, face_rim)
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
        collar_z=round(collar_z, 5), face_rim=sorted(face_rim), hem=hem,
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
    base = [v.co - centre for v in inner.data.vertices]
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
                v.co = centre + base[i].normalized() * (base[i].length + wall[i])
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
    out_v = [bm.verts.new(v.co) for v in outer.data.vertices]
    in_v = [out_v[i] if i in folded else bm.verts.new(v.co)
            for i, v in enumerate(inner.data.vertices)]
    bm.verts.index_update()
    dropped = 0
    for poly in outer.data.polygons:
        try:
            bm.faces.new([out_v[i] for i in poly.vertices])
        except ValueError:
            dropped += 1
    for poly in inner.data.polygons:
        vs = [in_v[i] for i in reversed(poly.vertices)]
        # A triangle lying wholly in the hem ring IS the outer one already.
        if len(set(vs)) < 3:
            dropped += 1
            continue
        try:
            bm.faces.new(vs)
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
        bm.faces.new((out_v[a], out_v[b], in_v[b], in_v[a]))
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
    """The BlenderKit weave: its normal as is, its base colour as charcoal."""
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
    out = np.clip(np.outer(grey, G.CLOTH_ALBEDO[:3]), 0.0, 1.0)
    px[:, :3] = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    base.pixels.foreach_set(px.ravel())
    base.update()
    return base, normal


def wool(obj):
    """The robe's charcoal and roughness, over the BlenderKit weave."""
    box_uvs(obj)
    base, normal = wool_maps()
    mat = bpy.data.materials.new(MATERIAL)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    col = nodes.new("ShaderNodeTexImage")
    col.image = base
    links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    nrm = nodes.new("ShaderNodeTexImage")
    nrm.image = normal
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = NORMAL_STRENGTH
    links.new(nrm.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = G.CLOTH_ROUGHNESS
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(mat)
    return mat


def main():
    W.clear_scene()
    for spec in W.LOOKS:
        W.build_look(spec)
    rig = bpy.data.objects[W.MALE_RIG]
    body = bpy.data.objects["base.male.body"]

    inner, detail = cowl_shell(body, "cowl_inner")
    outer = thicken(inner, detail["hem"], detail["head_c"])
    thinnest, median_wall = wall_profile(inner, outer)
    shared, bridged, inner_order = fold_stitch(inner, outer, set(detail["face_rim"]))
    donor = outer
    # No relaxation here either. The inner face is a radial graph that measured
    # clean, and the outer is the same graph further out; if the fold of the two
    # crosses, that is a fault to read off the mesh, and pulling vertices about
    # only buried it - the stitched relaxation ran 277 crossings up to 2777.
    W.drop(inner)
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
    _, fit = W.fit_head_shell(donor, body, rig, **fit_args)
    print("FIT", json.dumps(fit))

    G.export(donor, [DONOR, KEPT])
    W.clear_scene()
    back = G.import_one(DONOR)
    tris_back = G.triangles(back)
    if abs(tris_back - tris) > tris * ROUNDTRIP_TOLERANCE:
        raise SystemExit(f"the export lost geometry: {tris} triangles in Blender, "
                         f"{tris_back} back through the file")
    maps = sorted({n.image.name: tuple(n.image.size) for n in back.data.materials[0].node_tree.nodes
                   if n.type == "TEX_IMAGE" and n.image}.items())
    print(f"MAPS {maps} uv={[u.name for u in back.data.uv_layers]}")
    if len(maps) != 2 or not back.data.uv_layers:
        raise SystemExit(f"the weave did not survive the export: {maps}")
    G.render(back, {"front": os.path.join(REVIEW, "procedural-front.png"),
                    "quarter": os.path.join(REVIEW, "procedural-quarter.png"),
                    "side": os.path.join(REVIEW, "procedural-side.png"),
                    "rear": os.path.join(REVIEW, "procedural-rear.png")},
             views={"front": Vector((0, -1, 0)), "side": Vector((-1, 0, 0)),
                    "rear": Vector((0, 1, 0)),
                    "quarter": Vector((-0.62, -0.66, 0.42)).normalized()})

    report = {
        "built_from": "icosphere hung on the low-passed radius of base.male.body "
                      "Head + neck_01, cut at the hood hem and the face opening",
        "skin_gap_mm": SKIN_GAP * 1000, "wall_mm": WOOL * 1000,
        "sphere_subdiv": SPHERE_SUBDIV, "hood_passes": HOOD_PASSES, "hood_stand_mm": detail["stand_mm"],
        "hem_rings": HEM_RINGS,
        "face_opening": {"top_w": FACE_TOP, "bottom_w": FACE_BOTTOM,
                         "half_u": FACE_HALF, "power": FACE_POWER, "front_v": FACE_FRONT},
        "hem_w": HEM_W, "hem_z": detail["collar_z"],
        "shell_vertices": detail["shell_vertices"],
        "rim_edges": bridged, "hem_shared": shared,
        "thinnest_wall_mm": thinnest, "median_wall_mm": median_wall,
        "vertices": len(back.data.vertices), "triangles": tris,
        "triangles_reloaded": tris_back, "self_crossings": crossings,
        "back_shift": round(back_shift, 5), "fit": fit, "fit_args": fit_args,
        "look": "ember", "material": MATERIAL,
        "roughness_pre_matte": G.CLOTH_ROUGHNESS,
        "wrote": [DONOR, KEPT],
    }
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=1)
    print("PREP", json.dumps(report))


if __name__ == "__main__":
    main()
