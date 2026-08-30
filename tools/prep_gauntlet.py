"""Build the gauntlet donor out of the body's own hand.

Three image-to-3D generations each missed a different axis - fingers curled,
thumb in the palm plane, thumb rooted half way up the hand - and a fit cannot
argue with any of them: a rigid piece is placed, not posed. So the donor is not
generated at all. It is the rest hand's own skin, cut at the forearm, pushed out
along its normals and given a wall, which makes parallel fingers, the right
thumb and the right handedness true by construction rather than by luck.

The armour reading is authored on that shell: the cuff is the forearm stretch
flared out to a rolled rim, and the lames are raised bands at the joints the
skeleton already knows the height of. Nothing here is sculpted by eye.

The gates are the fitter's own, unchanged, because construction is a claim and
a measurement is not.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_gauntlet.py
"""

import json
import math
import os
import sys

import bmesh
import bpy
import mathutils
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_wardrobe as W  # noqa: E402  (Blender runs this file directly)

DONOR = "D:/VSC/exiled-casual/assets/props/source/trellis_local/gauntlet-hand-v2.glb"
KEPT = "D:/VSC/exiled-casual/assets/props/source/gauntlet-hand-v2.glb"
REPORT = "D:/VSC/exiled-casual/assets/props/source/gauntlet-hand-v2.json"
REVIEW = "D:/VSC/exiled-casual/review/3d/gauntlets-v1"

# Air between skin and the steel's inner face. The fitter re-scales whatever it
# is handed, so this is the shape's clearance and not the fit's - the sweep
# still has to find a ratio where the gap survives.
SKIN_GAP = 0.003
# The webs between the fingers are millimetres of skin apart, and pushing both
# sides out 3 mm folds them into a mitten. Every offset here is therefore capped
# at this fraction of the room the surface actually has - the distance to the
# nearest piece of itself that is not its own neighbourhood - so the gusset
# closes in exactly where the hand is pinched and nowhere else.
SAFE_SHARE = 0.45
SAFE_RINGS = 2
# One linear split of the cut hand before anything is pushed out: a step is only
# a step where there are edges to carry it, and this hand ships a few hundred.
SUBDIVIDE = 1
REACH = 0.02              # how far a headroom query looks, metres
# What counts as another part of the surface: a triangle FACING back at the
# vertex. Its own neighbourhood lies at any mesh spacing and faces the same way,
# so a ring count alone measures how finely the hand is modelled and nothing
# else - it capped every offset at half an edge length and flattened the cuff.
FACING = 0.0
STEEL = 0.002            # wall thickness, outward from the inner face
# What the wall takes out of the clearance: this many millimetres where there
# are millimetres to spare, and never more than this share of what there is.
WALL_FLOOR = 0.0005
WALL_SHARE = 0.4

# The cuff is the forearm stretch of the same shell, flared: it opens from the
# wrist to a rim standing this many times the forearm's OWN section, measured on
# the shell at the cut plane, and the last of the run rolls over into a lip.
CUFF_UP = 0.055          # how far up the forearm the piece reaches, metres
CUFF_RIM = 1.70          # rim over forearm section where the roll starts
CUFF_ROLL = 1.95         # and at the lip itself
CUFF_LIP_FROM = 0.80     # of the cuff's own run, where the rim starts rolling
CUFF_SECTION = 0.005     # half-thickness of the slice the forearm is measured on

# A lame is a plate, not a bump: it starts over a joint the skeleton already
# knows the height of, stands off the shell by a constant step, overlaps the
# plate behind it and rolls off at its far end alone. The step is the ridge, and
# a cosine bump in its place reads as a bulge in rubber.
LAME = 0.0022            # how far a plate stands out, metres
LAME_OVERLAP = 0.0030    # how far back over the plate behind it each one starts
LAME_ROLL = 0.0020       # the run its far end rolls off over, metres
LAME_SPAN = 1.9          # a plate's reach off its bone, over that limb's own radius
LAME_FACING = 0.35       # plates are the back of the hand and the finger TOPS
# The knuckle bar: one plate across all four metacarpal heads, reaching this far
# back toward the wrist and this far past them into the fingers.
KNUCKLE_BACK = 0.012
KNUCKLE_RUN = 0.006

# Blackened steel, authored BEFORE `matte()` runs over it in the build: that
# pass maps roughness r to 0.55 + 0.45r, so 0.22 lands on the cuirass' 0.65 and
# the whole set reads as one metal. The value is dark, not black: under 0.02 the
# lames, the knuckle bar and the cuff roll all fall below the shading's own range
# and the piece reads as one silhouette with no form in it.
ALBEDO = (0.050, 0.050, 0.056, 1.0)
ROUGHNESS = 0.22
METALLIC = 0.85

# The fitter's own two quarter turns, inverted: it rotates a donor whose
# fingers run up +Z and whose thumb is at +X onto the rest hand, so a piece
# built on the hand has to be carried back into that convention first.
DONOR_SPACE = W.HAND_DONOR_SPACE

# Steel creases, skin does not: an edge the shell folds over by more than this
# is drawn as an edge, or every plate step is smoothed back into a bulge.
SHARP = math.radians(28)

CONTAIN_MARGIN = 0.001
CONTAIN_BANDS = 10
ROUNDTRIP_TOLERANCE = 0.02
# A 3 mm push can fold a 2 mm gap. The shell is allowed no crossings it did not
# arrive with, because unlike a scan it arrives with none.
SEAM_CROSSINGS = 0


def bbox(points):
    return W.bbox(points)


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def own_bvh(obj):
    """A BVH over the datablock as it stands.

    Never `FromObject`: editing vertices in place does not retag the evaluated
    object, so a depsgraph BVH answers with whatever the last pass left behind -
    which reads as a relaxation that never converges.
    """
    verts = [v.co.copy() for v in obj.data.vertices]
    tris = []
    for poly in obj.data.polygons:
        idx = list(poly.vertices)
        for i in range(1, len(idx) - 1):
            tris.append((idx[0], idx[i], idx[i + 1]))
    return mathutils.bvhtree.BVHTree.FromPolygons(verts, tris), tris


def self_crossings(obj):
    """Triangle pairs of one mesh that cross, neighbours excluded."""
    bvh, tris = own_bvh(obj)
    sets = [set(t) for t in tris]
    crossing = 0
    for a, b in bvh.overlap(bvh):
        if a == b or (sets[a] & sets[b]):
            continue
        crossing += 1
    return crossing // 2


def headroom(bm):
    """How far each vertex may move before the surface meets itself.

    The distance to the nearest vertex outside its own `SAFE_RINGS` of
    neighbours: across a finger web that is millimetres, over a knuckle it is
    centimetres, and an offset that respects it cannot bridge a gusset.
    """
    bm.verts.index_update()
    bm.faces.index_update()
    rings = []
    for v in bm.verts:
        near = {v}
        for _ in range(SAFE_RINGS):
            near |= {e.other_vert(u) for u in list(near) for e in u.link_edges}
        rings.append({u.index for u in near})
    faces = [[v.index for v in f.verts] for f in bm.faces]
    verts = [v.co.copy() for v in bm.verts]
    tris = []
    for f in faces:
        for i in range(1, len(f) - 1):
            tris.append((f[0], f[i], f[i + 1]))
    bvh = mathutils.bvhtree.BVHTree.FromPolygons(verts, tris)

    room = []
    for i, v in enumerate(bm.verts):
        best = REACH
        # Face-accurate, not vertex to vertex: two sides of a web can pinch
        # between their vertices, and a distance taken off the corners misses it.
        for loc, nrm, index, dist in bvh.find_nearest_range(v.co, REACH):
            if any(x in rings[i] for x in tris[index]):
                continue
            if nrm.dot(v.normal) > FACING:
                continue
            best = min(best, dist)
        room.append(best)
    return room


def section(bm, at):
    """The centre and median radius of one slice across the arm."""
    sel = [v.co for v in bm.verts if abs(v.co.x - at) <= CUFF_SECTION]
    if len(sel) < 8:
        raise SystemExit(f"only {len(sel)} shell points on the section at x={at:.4f}")
    centre = sum(sel, Vector((0, 0, 0))) / len(sel)
    radii = sorted(math.hypot(p.y - centre.y, p.z - centre.z) for p in sel)
    return centre, radii[len(radii) // 2]


def room_cap(room_at):
    """The most a vertex may be pushed out, from what `headroom` found.

    `REACH` is how far the query looks, so a vertex that found nothing carries
    no measured limit and the relax pass is what proves its offset instead - a
    cuff standing 27 mm off the arm is capped by nothing but itself.
    """
    if room_at >= REACH - 1e-9:
        return math.inf
    return room_at * SAFE_SHARE


def back_of_hand(rig, side):
    """Which way the back of this hand faces, off the skeleton alone.

    The metacarpal heads and the run out to them span the hand's plane; the rest
    pose folds the thumb under the PALM, so the normal pointing away from the
    thumb is the back.
    """
    heads = [rig.matrix_world @ rig.data.bones[f"{f}_01_{side}"].head_local
             for f in ("index", "middle", "ring", "pinky")]
    wrist = rig.matrix_world @ rig.data.bones[f"hand_{side}"].head_local
    across = (heads[-1] - heads[0]).normalized()
    along = (sum(heads, Vector((0, 0, 0))) / len(heads) - wrist).normalized()
    normal = across.cross(along).normalized()
    thumb = rig.matrix_world @ rig.data.bones[f"thumb_03_{side}"].tail_local
    return -normal if normal.dot(thumb - wrist) > 0 else normal


def relax(obj, origin, spare=frozenset(), tries=14):
    """Pull back whatever still crosses, until nothing does.

    A cap on the offset is a prediction; this is the correction. Each pass takes
    a third of the distance back toward the skin the vertex came from - not along
    a normal, which the edit has already invalidated - so the shell converges on
    the deepest offset that is still a surface, and in the worst case onto the
    source hand itself.
    """
    counts = []
    for step in range(tries):
        # The body's own hand touches itself between the fingers; those vertices
        # are the source's crossings, not the offset's, and no pull-back fixes
        # what was already there.
        crossing = crossing_verts(obj) - set(spare)
        counts.append(len(crossing))
        if not crossing:
            return step, 0, counts
        for i in crossing:
            v = obj.data.vertices[i]
            v.co = v.co.lerp(origin[i], 0.34)
        obj.data.update()
    return tries, len(crossing_verts(obj) - set(spare)), counts


def crossing_verts(obj):
    """Vertices whose triangles cross another part of the same mesh."""
    bvh, tris = own_bvh(obj)
    sets = [set(t) for t in tris]
    hurt = set()
    for a, b in bvh.overlap(bvh):
        if a == b or (sets[a] & sets[b]):
            continue
        hurt |= sets[a] | sets[b]
    return hurt


def hand_shell(body, rig, side, extra=0.0, name="gauntlet"):
    """The hand's own skin, cut up the forearm, pushed out by the clearance.

    Weight decides what the glove covers and a plane decides where it stops:
    a boundary taken from the weights alone is ragged, and a ragged rim is what
    shows at the wrist in every clip. `extra` buys the same surface again
    further out, which is how the steel gets its thickness - a solidify modifier
    folds on every crease a hand has, and relaxing that fold is a fight between
    two layers that both have to move.
    """
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    bpy.context.scene.collection.objects.link(obj)
    obj.data.transform(body.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)
    while obj.data.materials:
        obj.data.materials.pop()

    # The tip caps hang off the twelve terminal `*_end_*` joints, which the
    # deform set leaves out on purpose. Leaving them out HERE cuts the ends off
    # the fingers and the glove comes out as five open tubes.
    bones = (f"hand_{side}", f"lowerarm_{side}") + tuple(
        f"{b}_{side}" for b in W.FINGER_BONES) + tuple(
        f"{f}_04_end_{side}" for f in ("index", "middle", "ring", "pinky", "thumb"))
    keep = {obj.vertex_groups[b].index for b in bones if b in obj.vertex_groups}
    if len(keep) != len(bones):
        raise SystemExit(f"the body carries no groups for {bones}")
    hand = W.group_points(body, f"hand_{side}", 0.35)
    for b in W.FINGER_BONES:
        hand += W.group_points(body, f"{b}_{side}", 0.35)
    _, hand_hi, hand_dims, _ = bbox(hand)
    # The rest arm runs out along -X on the right, so the forearm is +X of the
    # hand and the cut plane faces back down the arm.
    out = -1.0 if side == "r" else 1.0
    cut_x = hand_hi.x - out * CUFF_UP

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.active
    doomed = [v for v in bm.verts if sum(w for gi, w in v[dl].items() if gi in keep) < 0.35]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                           plane_co=Vector((cut_x, 0, 0)), plane_no=Vector((out, 0, 0)),
                           clear_inner=True)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()

    bmesh.ops.triangulate(bm, faces=bm.faces)
    # The body's hand carries a few hundred vertices, and a 2 mm step on an edge
    # a centimetre long is a slope. Linear cuts, so the split shape is the hand's
    # own and both layers stay vertex for vertex the same mesh.
    for _ in range(SUBDIVIDE):
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(obj.data)
    obj.data.update()
    base = crossing_verts(obj)
    bm.free()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()

    room = headroom(bm)
    wrist_x = hand_hi.x
    # The forearm's own section at the cut, so the rim is a ratio to the arm it
    # stands off and not a millimetre count that fits one body.
    cut_c, forearm_r = section(bm, cut_x)
    wrist_c, _ = section(bm, wrist_x)
    flare = forearm_r * (CUFF_RIM - 1.0)
    lip = forearm_r * (CUFF_ROLL - CUFF_RIM)
    print(f"CUFF forearm section {forearm_r * 1000:.2f} mm, flare {flare * 1000:.2f} mm, "
          f"lip {lip * 1000:.2f} mm")
    pinched, origin = 0, [v.co.copy() for v in bm.verts]
    for i, v in enumerate(bm.verts):
        gap = SKIN_GAP
        # Up the forearm the same shell becomes the cuff: it opens out, and the
        # last of it rolls over into a rim. `out` runs down the arm to the
        # fingertips, so the cuff is the stretch AGAINST it.
        along = (wrist_x - v.co.x) * out
        if along > 0.0:
            t = min(1.0, along / CUFF_UP)
            gap = SKIN_GAP + (flare - SKIN_GAP) * t
            if t > CUFF_LIP_FROM:
                gap += lip * (t - CUFF_LIP_FROM) / (1.0 - CUFF_LIP_FROM)
        direction = v.normal
        if along > 0.0:
            # The cuff opens AROUND the arm, not along the skin's normals: a
            # 25 mm normal offset folds wherever the wrist is concave, and a
            # section that is star-shaped about its own centre cannot.
            axis = cut_c.lerp(wrist_c, 1.0 - t)
            radial = Vector((0.0, v.co.y - axis.y, v.co.z - axis.z))
            if radial.length > 1e-6:
                direction = (v.normal * (1.0 - t) + radial.normalized() * t).normalized()
        capped = min(gap + extra, room_cap(room[i]))
        if capped < gap + extra - 1e-6:
            pinched += 1
        v.co += direction * capped
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    passes, left, counts = relax(obj, origin, spare=base)
    print(f"RELAX shell {counts}")
    if left:
        raise SystemExit(f"the offset shell crosses itself at {left} vertices the source "
                         f"hand did not, after {passes} relaxation passes")
    return (obj, hand_hi, hand_dims, len(obj.data.vertices), pinched, passes, len(base),
            origin, forearm_r)


def lames(obj, rig, body, side, spare=frozenset()):
    """Step a plate over every joint the fingers bend at.

    Each plate starts at a joint the skeleton already knows the height of and
    runs down the bone, standing off the shell by a constant step: the edge at
    its start is a real ridge, and the next plate's edge overlaps it the way
    lames do. A smooth bump reads as a bulge in rubber, not as armour.
    The BACK of the hand and the tops of the fingers only - the palm side has to
    stay the fitted surface the gates measure.
    """
    # How far off its own bone a plate reaches: this finger's measured radius,
    # widened for the shell that already stands off the skin.
    reach = {f: W.limb_radius(rig, body, f"{f}_01_{side}", W.GAUNTLET_WEB_ALONG)[1] * LAME_SPAN
             for f in ("index", "middle", "ring", "pinky", "thumb")}
    seats = []
    for finger in ("index", "middle", "ring", "pinky", "thumb"):
        for i in (1, 2, 3):
            bone = rig.data.bones[f"{finger}_{i:02d}_{side}"]
            head = rig.matrix_world @ bone.head_local
            tail = rig.matrix_world @ bone.tail_local
            run = (tail - head)
            seats.append((head - run.normalized() * LAME_OVERLAP,
                          run.normalized(), run.length + LAME_OVERLAP, reach[finger]))
    # The metacarpal heads carry one plate across all four, which is the knuckle
    # bar every gauntlet in the reference has.
    knuckles = [rig.matrix_world @ rig.data.bones[f"{f}_01_{side}"].head_local
                for f in ("index", "middle", "ring", "pinky")]
    hand = rig.data.bones[f"hand_{side}"]
    wrist = rig.matrix_world @ hand.head_local
    across = sum(knuckles, Vector((0, 0, 0))) / len(knuckles)
    # The bar spans the four heads it sits on plus a finger's half-width either
    # side, so its width is the knuckles' own and not a number anybody chose.
    span = max((k - across).length for k in knuckles) + max(reach.values())
    seats.append((across - (across - wrist).normalized() * KNUCKLE_BACK,
                  (across - wrist).normalized(), KNUCKLE_BACK + KNUCKLE_RUN, span))
    back = back_of_hand(rig, side)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    room = headroom(bm)
    bm.free()

    raised, origin = 0, [v.co.copy() for v in obj.data.vertices]
    for i, v in enumerate(obj.data.vertices):
        lift = 0.0
        if v.normal.dot(back) > LAME_FACING:
            # The plate a vertex wears is the one whose bone it sits closest to,
            # so a pinky never takes the ring finger's step: fingers run parallel
            # and every seat's range covers all four.
            near, off = None, None
            for seat in seats:
                start, axis, run, half = seat
                along = (v.co - start).dot(axis)
                if not 0.0 <= along <= run:
                    continue
                perp = ((v.co - start) - axis * along).length
                if perp > half:
                    continue
                if off is None or perp < off:
                    near, off = seat, perp
            if near is not None:
                start, axis, run, _ = near
                along = (v.co - start).dot(axis)
                # Flat over the plate, rolled off over its last stretch, so the
                # step lands at the joint and not at the fingertip.
                lift = LAME * min(1.0, (run - along) / LAME_ROLL)
        lift = min(lift, room_cap(room[i]))
        if lift > 0.0:
            v.co += v.normal * lift
            raised += 1
    obj.data.update()
    passes, left, counts = relax(obj, origin, spare=spare)
    print(f"RELAX lames {counts}")
    if left:
        raise SystemExit(f"the lames crossed the shell at {left} vertices after "
                         f"{passes} relaxation passes")
    return raised, passes


def follow(inner, outer, skin, floor):
    """Keep the inner face under the outer one, wall thickness everywhere.

    The two offsets are relaxed apart, so wherever a crease made the outer give
    ground the inner can end up outside it - the shell turns inside out over a
    few triangles. The inner gives back the same ground: it is never further out
    than the outer less one thin wall, and never further in than the skin.
    """
    out_at = [(outer.data.vertices[i].co - skin[i]).length
              for i in range(len(skin))]

    pulled, thinnest = 0, None
    for i, v in enumerate(inner.data.vertices):
        base = skin[i]
        d_in = (v.co - base).length
        d_out = out_at[i]
        # The inner face can never pass the outer one, so the wall comes off the
        # clearance - but never all of it. A fixed floor swallows a crease whole
        # and lands the inner face ON the skin, where it reads as steel through
        # the hand for every roomy point around it; a share leaves air wherever
        # there was any.
        want = max(d_out * (1.0 - WALL_SHARE), d_out - floor)
        if d_in > want:
            direction = (v.co - base)
            if direction.length < 1e-9:
                direction = outer.data.vertices[i].co - base
            v.co = base + direction.normalized() * want
            pulled += 1
            d_in = want
        gap = out_at[i] - d_in
        thinnest = gap if thinnest is None else min(thinnest, gap)
    kept = sorted((inner.data.vertices[i].co - skin[i]).length
                  for i in range(len(skin)))
    n = len(kept)
    print(f"CLEARANCE min {kept[0]*1000:.2f} p01 {kept[n//100]*1000:.2f} "
          f"p05 {kept[n//20]*1000:.2f} p25 {kept[n//4]*1000:.2f} "
          f"median {kept[n//2]*1000:.2f} mm over {n} shell vertices")
    inner.data.update()
    # Giving the clearance back can fold the inner face where two fingers pinch,
    # and there the surface gives way rather than the air.
    passes, left, counts = relax(inner, skin)
    print(f"RELAX inner {counts}")
    if left:
        raise SystemExit(f"the inner face crosses itself at {left} vertices after "
                         f"{passes} relaxation passes")
    return pulled, thinnest


def stitch(inner, outer):
    """One closed shell out of two offsets of the same skin.

    Both layers carry the same topology because they came off the same cut, so
    the outer keeps its winding, the inner is turned to face the hand, and the
    cuff rim is bridged edge for edge. Nothing here can fold that did not fold
    in one of the two surfaces already, and each was relaxed until it did not.
    """
    if len(inner.data.vertices) != len(outer.data.vertices):
        raise SystemExit(f"the two offsets disagree: {len(inner.data.vertices)} inner "
                         f"vertices against {len(outer.data.vertices)} outer")
    bm = bmesh.new()
    out_v = [bm.verts.new(v.co) for v in outer.data.vertices]
    in_v = [bm.verts.new(v.co) for v in inner.data.vertices]
    bm.verts.index_update()
    for poly in outer.data.polygons:
        bm.faces.new([out_v[i] for i in poly.vertices])
    for poly in inner.data.polygons:
        bm.faces.new([in_v[i] for i in reversed(poly.vertices)])
    bm.faces.index_update()

    rim = bmesh.new()
    rim.from_mesh(inner.data)
    edges = [(e.verts[0].index, e.verts[1].index)
             for e in rim.edges if len(e.link_faces) < 2]
    rim.free()
    if not edges:
        raise SystemExit("the shell has no cuff opening to bridge")
    for a, b in edges:
        bm.faces.new((out_v[a], out_v[b], in_v[b], in_v[a]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update()
    creased = 0
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > SHARP:
            e.smooth = False
            creased += 1
    bm.to_mesh(outer.data)
    bm.free()
    outer.data.update()
    for poly in outer.data.polygons:
        poly.use_smooth = True
    print(f"CREASED {creased} edges drawn sharp")
    return len(edges)


def steel(obj):
    """One blackened-steel material, no texture: the set's read is the metal."""
    mat = bpy.data.materials.new("MI_Gauntlet_Plate")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = ALBEDO
    bsdf.inputs["Roughness"].default_value = ROUGHNESS
    bsdf.inputs["Metallic"].default_value = METALLIC
    obj.data.materials.append(mat)
    return mat


def containment(donor, matrix, skin, wrist_z, run):
    """Tightest clearance whose every band holds the hand, and that band's margin."""
    glove = [p for p in (v.co for v in donor.data.vertices) if p.z > wrist_z]
    ratio, tried = W.GAUNTLET_CLEAR_FROM, []
    while ratio <= W.GAUNTLET_CLEAR_TO + 1e-9:
        M = matrix(ratio)
        Minv = M.inverted()
        pts = [Minv @ p for p in skin]
        worst, where = None, None
        for k in range(CONTAIN_BANDS):
            z0 = wrist_z + run * k / CONTAIN_BANDS
            z1 = wrist_z + run * (k + 1) / CONTAIN_BANDS
            hs = [p for p in pts if z0 <= p.z <= z1]
            ds = [p for p in glove if z0 <= p.z <= z1]
            if len(hs) < 8 or len(ds) < 8:
                continue
            m = min(min(p.x for p in hs) - min(p.x for p in ds),
                    max(p.x for p in ds) - max(p.x for p in hs),
                    min(p.y for p in hs) - min(p.y for p in ds),
                    max(p.y for p in ds) - max(p.y for p in hs))
            m *= M.to_3x3().col[0].length
            if worst is None or m < worst:
                worst, where = m, k
        tried.append([round(ratio * 1000, 2), where, round(worst * 1000, 2)])
        if worst >= CONTAIN_MARGIN:
            return ratio, worst, where, tried
        ratio += W.GAUNTLET_CLEAR_STEP
    raise SystemExit(f"no ratio holds the whole hand inside the glove; {tried}")


def export(obj, paths):
    """The donor alone. A scene export takes the bodies with it, and the build
    then reads whichever mesh the importer hands back first."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for out in paths:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True,
                                  export_animations=False, export_skins=False,
                                  export_yup=True, export_apply=False)


def import_one(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    fresh = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in fresh if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"{path}: expected one mesh, got {[m.name for m in meshes]}")
    donor = meshes[0]
    for other in fresh:
        if other is not donor:
            W.drop(other)
    W.bake_transform(donor)
    return donor


def render(obj, paths, shading="SINGLE"):
    """Ortho views of the donor alone, for the eye the gates do not have."""
    scene = bpy.context.scene
    hidden = [o for o in bpy.data.objects if o is not obj and o.type == "MESH"]
    for o in hidden:
        o.hide_render = True
    lo, hi, dims, c = bbox([v.co for v in obj.data.vertices])
    span = max(dims) * 1.35
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = 800
    scene.display.shading.light = "STUDIO"
    # One mid grey, not the material: this steel is authored near black and a
    # lit black shell shows no ridge at all. Colour is judged in the viewer.
    scene.display.shading.color_type = shading
    scene.display.shading.single_color = (0.55, 0.55, 0.55)
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Donor space: the fingers run up +Z, the thumb out at +X and the palm faces
    # -Y, so the back of the hand is seen from +Y and nothing is looked at down
    # the barrel of the fingers.
    views = {"front": Vector((0, 1, 0)),
             "quarter": Vector((0.62, 0.66, -0.42)).normalized()}
    for name, path in paths.items():
        d = views[name]
        cam.location = c + d * span * 3
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("RENDERED", path)
    W.drop(cam)
    for o in hidden:
        o.hide_render = False


def main():
    W.clear_scene()
    for spec in W.LOOKS:
        W.build_look(spec)
    rig = bpy.data.objects[W.MALE_RIG]
    body = bpy.data.objects["base.male.body"]
    pairs, off = W.assert_symmetric(rig)
    print(f"SYMMETRY {pairs} mirrored bone pairs, worst {off * 1000:.4f} mm off centre")

    (inner, hand_hi, hand_dims, shell_verts, pinched_in, in_passes, source_crossings,
     skin, forearm_r) = hand_shell(body, rig, "r", 0.0, "gauntlet_inner")
    outer, _, _, _, pinched_out, out_passes, _, _, _ =         hand_shell(body, rig, "r", STEEL, "gauntlet_outer")
    spare = crossing_verts(outer)
    raised, lame_passes = lames(outer, rig, body, "r", spare=spare)
    pulled, thinnest = follow(inner, outer, skin, WALL_FLOOR)
    print(f"FOLLOW {pulled} inner vertices pulled under the outer face, "
          f"thinnest wall {thinnest * 1000:.2f} mm")
    bridged = stitch(inner, outer)
    donor = outer
    # A vertex that keeps its clearance beside one pinched into a crease can
    # weave the two faces through each other between them; there the inner face
    # gives its air back, and only there.
    n = len(skin)
    passes, left, counts = relax(
        donor, [donor.data.vertices[i].co.copy() for i in range(n)] + list(skin))
    print(f"RELAX stitched {counts}")
    if left:
        raise SystemExit(f"the stitched shell crosses itself at {left} vertices after "
                         f"{passes} relaxation passes")
    # Built in the body's own space; the fitter reads a donor whose fingers run
    # up +Z with the thumb at +X, and turns it back with those same two quarter
    # turns. Handing it body space would rotate the hand off the arm.
    donor.data.transform(DONOR_SPACE)
    donor.data.update()
    W.drop(inner)
    steel(donor)
    tris = triangles(donor)
    crossings = self_crossings(donor)
    print(f"SHELL {shell_verts} verts per layer, pinched in {pinched_in}/{pinched_out}, "
          f"{raised} raised into lames, {bridged} rim edges bridged, "
          f"{len(donor.data.vertices)} verts, {tris} tris, crossings {crossings}, "
          f"relaxed {in_passes}+{out_passes}+{lame_passes} passes")
    if crossings > source_crossings + SEAM_CROSSINGS:
        raise SystemExit(f"the shell folds into itself: {crossings} crossing triangle pairs "
                         f"against the source hand's {source_crossings}")

    matrix, sample, segments, measured = W.hand_plate_seat(donor, body, rig)
    skin = W.group_points(body, "hand_r", 0.35)
    for b in W.FINGER_BONES:
        skin += W.group_points(body, f"{b}_r", 0.35)
    ratio, margin, band, tried = containment(
        donor, matrix, skin, measured["donor_wrist_at"], measured["donor_run"])
    print(f"CONTAIN clearance {ratio * 1000:.2f} mm, worst band {band}, margin "
          f"{margin * 1000:+.2f} mm; {tried}")

    export(donor, [DONOR, KEPT])
    W.clear_scene()
    back = import_one(DONOR)
    tris_back = triangles(back)
    if abs(tris_back - tris) > tris * ROUNDTRIP_TOLERANCE:
        raise SystemExit(f"the export lost geometry: {tris} triangles in Blender, "
                         f"{tris_back} back through the file")
    render(back, {"front": os.path.join(REVIEW, "procedural-front.png"),
                  "quarter": os.path.join(REVIEW, "procedural-quarter.png")})

    report = {
        "built_from": "base.male.body hand + forearm weights, cut at the cuff plane",
        "skin_gap_mm": SKIN_GAP * 1000, "safe_share": SAFE_SHARE,
        "wall_mm": STEEL * 1000, "relax_passes": [in_passes, out_passes, lame_passes], "cuff_up_mm": CUFF_UP * 1000,
        "forearm_section_mm": round(forearm_r * 1000, 2),
        "cuff_rim_ratio": CUFF_RIM, "cuff_roll_ratio": CUFF_ROLL,
        "lame_mm": LAME * 1000, "lame_overlap_mm": LAME_OVERLAP * 1000,
        "shell_vertices": shell_verts, "pinched_vertices": [pinched_in, pinched_out],
        "lame_vertices": raised, "rim_edges": bridged, "inner_pulled": pulled,
        "thinnest_wall_mm": round(thinnest * 1000, 3),
        "vertices": len(back.data.vertices), "triangles": tris,
        "triangles_reloaded": tris_back, "self_crossings": crossings, "source_crossings": source_crossings,
        "contain_clearance_mm": round(ratio * 1000, 2), "contain_margin_mm": round(margin * 1000, 2),
        "contain_band": band, "roughness_pre_matte": ROUGHNESS, "metallic": METALLIC,
        "symmetry_pairs": pairs, "symmetry_worst_mm": round(off * 1000, 5),
        "wrote": [DONOR, KEPT],
    }
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=1)
    print("PREP", json.dumps(report))


if __name__ == "__main__":
    main()
