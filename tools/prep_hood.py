"""Build both class hoods off Quaternius' CC0 Ranger hood, run on into a capelet.

The hood is `Male_Ranger_Head_Hood` from the Modular Character Outfits - Fantasy
pack: modelled on this very head and skinned to the same 65-joint skeleton (rest
poses agree at neck_01, Head, spine_03 and both clavicles), so its crown takes no
fitter and keeps its own weights. Only its outer shell is kept. It was made to
sit on a bare neck and ships closed by a lid there, so it is cut level at CUT_Z,
its neck band is pushed out over the class's collar and gorget, and the cut ring
runs on down over the shoulders as a capelet closed across the throat. One
solidify then gives crown, neck and capelet one lining and one hem: a single
closed surface with nothing meeting at a seam.

The capelet is a radial graph about one point on the neck axis: one column per
vertex of the cut ring, rows down it at the outermost coat, gorget or skin on
that ray plus a gap, never moving back in, so it hangs off the hood instead of
into the collar. Its weights run from the ring's own into the surface's under it.

Reads chest.<look>.* out of `wardrobe.glb`, so build that first.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_hood.py
"""

import json
import math
import os
import sys

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_wardrobe as W  # noqa: E402  (Blender runs this file directly)
import prep_cowl as C  # noqa: E402
import prep_gauntlet as G  # noqa: E402

PACK = "D:/VSC/exiled-casual/assets/props/source/quaternius-fantasy/Male_Ranger_Head_Hood.gltf"
KEEP_DIR = C.KEEP_DIR
REVIEW = "D:/VSC/exiled-casual/review/3d/hood-v2"
SKIN_SKIP = ("eyes", "brows", "hair")   # body parts that are not a surface to lie on
LOOKS = {
    "stalker": {"stem": "hood-stalker-v2", "worn": ("chest.stalker.coat", "chest.stalker.gorget")},
    "ember": {"stem": "hood-ember-v2", "worn": ("chest.ember.robe", "chest.ember.gorget")},
}
BONES = W.HOOD_BONES

CUT_Z = 1.545             # the pack's lid and its ragged edge lie below this
CENTRE_DZ = 0.03          # the neck axis point azimuths are read about, over the neck's base
WALL = 0.004              # solidified inward: the lining's depth under the shell
GAP = 0.006               # the lining's face off coat, gorget and skin
CLEAR = GAP + WALL        # so the shell's own face stands this far off
BAND_TOP = 0.05           # the neck band cleared runs this far over the centre
SPREAD_KEEP = 0.85        # how much of a neighbour's push a vertex takes per pass
COLLAR = 0.025            # a surface this far outside the band is a collar it goes over
NUDGE_ROUNDS = 6          # bounded clearance rounds over band and capelet
BAND_RELAX = 4            # smoothing passes over the pushed band
# Each column is the taut outer hull of what lies in a wedge this wide round its
# azimuth, so nothing between two columns is missed.
WEDGE = math.radians(4.0)
LEVEL = 0.002             # heights the silhouette is read at, down each column
SILHOUETTE = 0.5          # rays start this far out, past the T-posed hands
DISC = [math.radians(a) for a in (-90, -45, 0, 45, 90)]
ROWS = 18
# Capelet length down the surface at the front, the sides and the back, and the
# furthest its hem reaches off the neck axis, short of the shoulder caps.
LEN_FRONT = 0.17
LEN_SIDE = 0.14
LEN_BACK = 0.20
HEM_RADIUS = 0.20
THROAT_BLEND = math.radians(25)   # the throat's top eases from the ring's ends over this
SMOOTH_PASSES = 3         # across columns, row by row
HEM_PASSES = 12           # the hem line's own low-pass round the neck
FOLDS = 13                # soft folds round the capelet, outward only
FOLD_AMP = 0.008
# Below the cut everything rides what it lies on; the pack's own weights take
# back over by RIDE_TOP above it, under the jaw. A band on the pack's weights
# alone let a raised shoulder come up through it.
RIDE_TOP = 0.06
MIN_CLEAR = 0.0015        # p01 clearance of the capelet's lining off what it lies on

# Leather for the stalker, the BlenderKit leather the coat set already uses; wool for
# the ember, prep_cowl's weave. Colours are linear albedo over a map levelled to grey.
HIDE = (0.0296 / C.TEX_MEAN, 0.0196 / C.TEX_MEAN, 0.0105 / C.TEX_MEAN, 1.0)
HIDE_TRIM = (0.0570 / C.TEX_MEAN, 0.0370 / C.TEX_MEAN, 0.0201 / C.TEX_MEAN, 1.0)
HIDE_LINING = (0.0225 / C.TEX_MEAN, 0.0121 / C.TEX_MEAN, 0.0065 / C.TEX_MEAN, 1.0)
GRAIN = 0.12
GRAIN_CONTRAST = 1.4
LEATHER_NORMAL = 1.0
TEX_PX = 512

OUTER, LINING, TRIM = 0, 1, 2


def worn_surfaces(names):
    """World triangles of the worn pieces plus skin, with each vertex's weights."""
    W.clear_scene()
    bpy.ops.import_scene.gltf(filepath=W.OUT)
    objs = []
    for name in names:
        o = bpy.data.objects.get(name)
        if o is None:
            raise SystemExit(f"{W.OUT} carries no {name}: build the wardrobe first")
        objs.append(o)
    objs += [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("base.male.")
             and o.name.split(".")[2] not in SKIN_SKIP]
    verts, tris, weights, owner = [], [], [], []
    for o in objs:
        names_ = {g.index: g.name for g in o.vertex_groups}
        base = len(verts)
        verts += [(o.matrix_world @ v.co).copy() for v in o.data.vertices]
        weights += [{names_[g.group]: g.weight for g in v.groups if names_[g.group] in BONES}
                    for v in o.data.vertices]
        o.data.calc_loop_triangles()
        # The head is the hood's own business: its jaw faces down onto the throat
        # band, and clearing the band off it drove the band into the chest.
        kept = [tuple(base + k for k in t.vertices) for t in o.data.loop_triangles
                if not all(weights[base + k].get("Head", 0.0) > 0.5 for k in t.vertices)]
        tris += kept
        owner += [o.name] * len(kept)
    rig = bpy.data.objects[W.MALE_RIG]
    M, bones = rig.matrix_world, rig.data.bones
    neck, head = M @ bones["neck_01"].head_local, M @ bones["Head"].head_local
    centre = Vector((0.0, (neck.y + head.y) / 2, neck.z + CENTRE_DZ))
    W.clear_scene()
    return {"bvh": BVHTree.FromPolygons(verts, tris), "verts": verts, "tris": tris,
            "weights": weights, "owner": owner, "centre": centre, "head": head.copy()}


def import_hood():
    """The pack hood and its armature; the pack's helper icosphere dropped."""
    bpy.ops.import_scene.gltf(filepath=PACK)
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    hood = [o for o in bpy.data.objects if o.type == "MESH" and o.data.materials]
    for o in [o for o in bpy.data.objects if o.type == "MESH" and o not in hood]:
        W.drop(o)
    if len(arm) != 1 or len(hood) != 1:
        raise SystemExit(f"{PACK}: expected one armature and one hood, got {arm} {hood}")
    return arm[0], hood[0]


def outer_shell(bm, head):
    """Drop the lining and the face trim, the pack's islands facing the head and the
    two small ones, then weld the two halves of what is left down the middle."""
    seen, doomed = set(), []
    for f0 in bm.faces:
        if f0 in seen:
            continue
        island, stack = [], [f0]
        while stack:
            f = stack.pop()
            if f in seen:
                continue
            seen.add(f)
            island.append(f)
            stack += [g for e in f.edges for g in e.link_faces]
        inward = sum(1 for f in island if f.normal.dot(f.calc_center_median() - head) < 0)
        if len(island) < 100 or inward > len(island) / 2:
            doomed += island
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return len(doomed)


def azimuth(p, centre):
    return math.atan2(p.x - centre.x, -(p.y - centre.y))


def cut_ring(bm, centre):
    """Cut level at CUT_Z and return the ring the cut leaves, ordered round the back
    from one side of the face opening to the other."""
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0, 0, CUT_Z), plane_no=(0, 0, 1),
                           clear_inner=True)
    ring = [v for v in bm.verts if abs(v.co.z - CUT_Z) < 1e-5 and v.is_boundary]
    if len(ring) < 16:
        raise SystemExit(f"the cut at z {CUT_Z} left a ring of {len(ring)} vertices")
    on = set(ring)
    nxt = {v: [e.other_vert(v) for e in v.link_edges if e.is_boundary and e.other_vert(v) in on]
           for v in ring}
    ends = [v for v in ring if len(nxt[v]) == 1]
    if len(ends) != 2:
        raise SystemExit(f"the cut ring is not one arc open at the face: {len(ends)} ends")
    path, prev = [ends[0]], None
    while len(path) < len(ring):
        n = [v for v in nxt[path[-1]] if v is not prev]
        if not n:
            break
        prev = path[-1]
        path.append(n[0])
    if len(path) != len(ring):
        raise SystemExit(f"the cut ring is {len(ring)} vertices in more than one arc")
    th = [azimuth(v.co, centre) % (2 * math.pi) for v in path]
    if th[0] > th[-1]:
        path, th = path[::-1], th[::-1]
    if any(b <= a for a, b in zip(th, th[1:])):
        raise SystemExit("the cut ring does not run once round the back")
    return path


def over_collar(bm, surf, only=None):
    """The neck band goes OVER a collar standing up round it, never inside it, or the
    capelet it runs into would have to cross the collar on the way down."""
    c = surf["centre"]
    push = {}
    band = only if only is not None else [v for v in bm.verts if v.co.z <= c.z + BAND_TOP]
    for v in band:
        d = (v.co - c).normalized()
        r = (v.co - c).length
        h = surf["bvh"].ray_cast(c + d * (r + COLLAR), -d, r + COLLAR)[0]
        if h is not None and (h - c).length + CLEAR > r:
            push[v] = (h - c).length + CLEAR - r
    for _ in range(12):
        push = {v: max(push.get(v, 0.0),
                       SPREAD_KEEP * max((push.get(e.other_vert(v), 0.0) for e in v.link_edges), default=0.0))
                for v in (band if only is not None else bm.verts)
                if only is not None or v.co.z <= c.z + BAND_TOP + 0.02}
        push = {v: p for v, p in push.items() if p > 1e-5}
    for v, p in push.items():
        v.co = c + (v.co - c).normalized() * ((v.co - c).length + p)
    return len(push), max(push.values(), default=0.0)


def nudge_clear(bm, surf, only=None):
    """Every vertex under the band ends CLEAR off anything straight below it, level
    toward the axis, toward the centre or between: a probe that meets a surface
    nearer than that pushes the vertex back along itself by the shortfall, so no
    push is ever longer than CLEAR and a stray face winding cannot throw one."""
    c = surf["centre"]
    band = only if only is not None else [v for v in bm.verts if v.co.z <= c.z + BAND_TOP]
    down = Vector((0.0, 0.0, -1.0))
    total = 0
    for _ in range(NUDGE_ROUNDS):
        push = {}
        for v in band:
            inward = Vector((c.x - v.co.x, c.y - v.co.y, 0.0))
            if inward.length < 1e-6:
                continue
            inward.normalize()
            probes = (down, inward, (c - v.co).normalized(), (down + inward).normalized())
            best = None
            for d in probes:
                hit = surf["bvh"].ray_cast(v.co, d, CLEAR)[0]
                if hit is not None:
                    short = CLEAR - (hit - v.co).length
                    if best is None or short > best.length:
                        best = -d * short
            if best is not None and best.length > 1e-5:
                push[v] = best
        if not push:
            break
        total += len(push)
        for _ in range(2):
            spread = dict(push)
            for v in band:
                for e in v.link_edges:
                    w = push.get(e.other_vert(v))
                    if w is not None and w.length * SPREAD_KEEP > spread.get(v, Vector()).length:
                        spread[v] = w * SPREAD_KEEP
            push = spread
        for v, p in push.items():
            v.co += p
    return total


def length_at(theta):
    mid = ((LEN_FRONT + LEN_BACK) / 2 + LEN_SIDE) / 2
    side = ((LEN_FRONT + LEN_BACK) / 2 - LEN_SIDE) / 2
    return mid + (LEN_FRONT - LEN_BACK) / 2 * math.cos(theta) + side * math.cos(2 * theta)


def reach(p, c):
    """Horizontal distance off the neck axis."""
    return math.hypot(p.x - c.x, p.y - c.y)


def outer_hull(pts):
    """The chain over 2D (reach, z) points sorted top down, bulging away from the axis."""
    chain = []
    for p in pts:
        while len(chain) >= 2 and ((chain[-1][0] - chain[-2][0]) * (p[1] - chain[-2][1])
                                   - (chain[-1][1] - chain[-2][1]) * (p[0] - chain[-2][0])) >= 0:
            chain.pop()
        chain.append(p)
    return chain


def column(surf, theta, h):
    """The chain (reach, z) down from ring point h at azimuth theta, its arc
    lengths, and how much of it the column wants.

    In the half-plane at theta every coat, gorget and skin vertex in the wedge is
    pushed CLEAR off the centre, and the cloth is the chain pulled taut down over
    them from h: onto the upper back where the hood's hem stands behind it, out
    over the chest where the chest stands in front of it. Past the first thing it
    rests on it only hangs, never tucks back in; it stops at HEM_RADIUS, which on
    the T-posed shoulder is the edge of the shoulder, or at the column's length.
    A hull passes over every spike by construction and cannot crumple.
    """
    c = surf["centre"]
    rho0, z0 = reach(h, c), h.z
    want = length_at(theta)
    rz = []
    z = z0 - LEVEL
    while z > z0 - want - 0.05:
        for k in range(-2, 3):
            a = theta + WEDGE * k / 2
            out_a = Vector((math.sin(a), -math.cos(a), 0.0))
            far = Vector((c.x, c.y, z)) + out_a * SILHOUETTE
            hit = surf["bvh"].ray_cast(far, -out_a, SILHOUETTE)[0]
            if hit is not None:
                # A disc of CLEAR round each point, its outer half, so the hull
                # clears a shoulder sloping under it as well as a chest before it.
                rho = reach(hit, c)
                rz += [(rho + CLEAR * math.cos(t), z + CLEAR * math.sin(t)) for t in DISC]
        z -= LEVEL
    rz = [p for p in rz if p[1] < z0]
    chain = outer_hull([(rho0, z0)] + sorted(rz, key=lambda p: (-p[1], -p[0])))
    for k in range(2, len(chain)):
        chain[k] = (max(chain[k][0], chain[k - 1][0]), chain[k][1])
    # Cut at the hem radius.
    for k in range(1, len(chain)):
        if chain[k][0] > HEM_RADIUS:
            a, b = chain[k - 1], chain[k]
            u = (HEM_RADIUS - a[0]) / (b[0] - a[0])
            chain = chain[:k] + [(HEM_RADIUS, a[1] + (b[1] - a[1]) * u)]
            break
    arcs = [0.0]
    for a, b in zip(chain, chain[1:]):
        arcs.append(arcs[-1] + math.dist(a, b))
    out = Vector((math.sin(theta), -math.cos(theta), 0.0))
    base = Vector((c.x, c.y, 0.0))
    if arcs[-1] < want and chain[-1][0] < HEM_RADIUS:
        foot = base + out * chain[-1][0] + Vector((0, 0, chain[-1][1]))
        hit = surf["bvh"].ray_cast(foot, Vector((0, 0, -1)), want - arcs[-1] + CLEAR)[0]
        drop = want - arcs[-1] if hit is None else max(0.0, (foot - hit).length - CLEAR)
        if drop > 1e-4:
            chain.append((chain[-1][0], chain[-1][1] - drop))
            arcs.append(arcs[-1] + drop)
    return chain, arcs, min(arcs[-1], want)


def resample(c, theta, h, chain, arcs, total):
    """ROWS + 1 points evenly along the first `total` of a column's chain."""
    out = Vector((math.sin(theta), -math.cos(theta), 0.0))
    base = Vector((c.x, c.y, 0.0))
    rows, j = [], 0
    for k in range(ROWS + 1):
        t = total * k / ROWS
        while j < len(chain) - 2 and arcs[j + 1] < t:
            j += 1
        if len(chain) == 1:
            p = chain[0]
        else:
            u = 0.0 if arcs[j + 1] <= arcs[j] else min(1.0, (t - arcs[j]) / (arcs[j + 1] - arcs[j]))
            p = (chain[j][0] + (chain[j + 1][0] - chain[j][0]) * u,
                 chain[j][1] + (chain[j + 1][1] - chain[j][1]) * u)
        rows.append(base + out * p[0] + Vector((0, 0, p[1])))
    rows[0] = h.copy()
    return rows


def throat(surf, ring, deform, bm):
    """New top-row vertices across the face opening's foot, from one end of the
    ring to the other through the front, over the collar there: the hood closes
    under the chin instead of leaving the throat open to the coat."""
    c = surf["centre"]
    a, b = ring[-1], ring[0]
    ta = azimuth(a.co, c) % (2 * math.pi)
    tb = azimuth(b.co, c) % (2 * math.pi) + 2 * math.pi
    spacing = sum((u.co - v.co).length for u, v in zip(ring, ring[1:])) / (len(ring) - 1)
    ra, rb = reach(a.co, c), reach(b.co, c)
    n = max(2, round((tb - ta) * (ra + rb) / 2 / spacing))
    axis = Vector((c.x, c.y, CUT_Z))
    made = []
    for k in range(1, n):
        u = k / n
        theta = ta + (tb - ta) * u
        out = Vector((math.sin(theta), -math.cos(theta), 0.0))
        # The collar at this azimuth, read in from outside, then CLEAR off it.
        hit = surf["bvh"].ray_cast(axis + out * 0.3, -out, 0.3)[0]
        r_in = (reach(hit, c) if hit is not None else 0.06) + CLEAR
        w = min(1.0, min(theta - ta, tb - theta) / THROAT_BLEND)
        w = w * w * (3 - 2 * w)
        r = (ra * (1 - u) + rb * u) * (1 - w) + r_in * w
        v = bm.verts.new(axis + out * r)
        # Its weights are the two ends', by azimuth.
        dv = v[deform]
        for src, f in ((a, 1 - u), (b, u)):
            for g, wt in src[deform].items():
                dv[g] = dv.get(g, 0.0) + wt * f
        made.append(v)
    return made


def surface_weights(surf, hit, tri):
    t = surf["tris"][tri]
    bary = mathutils.interpolate.poly_3d_calc([surf["verts"][k] for k in t], hit)
    mix = {}
    for k, b in zip(t, bary):
        for name, w in surf["weights"][k].items():
            mix[name] = mix.get(name, 0.0) + w * b
    total = sum(mix.values())
    return {g: w / total for g, w in mix.items()} if total > 0 else {}


def capelet(bm, surf, ring, deform, groups):
    """Columns down from every ring vertex and every throat vertex, closed round the
    neck; each row's weights run from its top's into the surface's under it."""
    c = surf["centre"]
    made = throat(surf, ring, deform, bm)
    top = ring + made
    thetas = [azimuth(v.co, c) for v in top]
    chains = [column(surf, t, v.co.copy()) for t, v in zip(thetas, top)]
    n = len(chains)
    # The hem line is low-passed round the neck, never past what a column has:
    # a column cut short at the shoulder's edge shortens its neighbours with it.
    lengths = [total for _, _, total in chains]
    for _ in range(HEM_PASSES):
        lengths = [min(chains[i][2], (lengths[i - 1] + lengths[i] * 2 + lengths[(i + 1) % n]) / 4)
                   for i in range(n)]
    cols = [(resample(c, thetas[i], top[i].co.copy(), chains[i][0], chains[i][1], lengths[i]), lengths[i])
            for i in range(n)]
    pts = [rows for rows, _ in cols]
    # Across columns the rows are low-passed, then pushed back out to each
    # column's own hull wherever the average fell inside it.
    for _ in range(SMOOTH_PASSES):
        avg = [[pts[i][k] if k == 0 else (pts[i - 1][k] + pts[i][k] * 2 + pts[(i + 1) % n][k]) / 4
                for k in range(ROWS + 1)] for i in range(n)]
        for i in range(n):
            for k in range(1, ROWS + 1):
                own, a = cols[i][0][k], avg[i][k]
                ra, ro = reach(a, c), reach(own, c)
                if ra < ro:
                    a = a + Vector((math.sin(thetas[i]), -math.cos(thetas[i]), 0.0)) * (ro - ra)
                avg[i][k] = a
        pts = avg
    grid = []
    for i in range(n):
        out = Vector((math.sin(thetas[i]), -math.cos(thetas[i]), 0.0))
        col = [top[i]]
        for k in range(1, ROWS + 1):
            fold = FOLD_AMP * (k / ROWS) ** 1.5 * (1 + math.sin(FOLDS * thetas[i])) / 2
            col.append(bm.verts.new(pts[i][k] + out * fold))
        grid.append(col)
    for i in range(n):
        a = (i + 1) % n
        for k in range(ROWS):
            bm.faces.new((grid[i][k], grid[a][k], grid[a][k + 1], grid[i][k + 1]))
    lengths = [arc for _, arc in cols]
    return made, {"columns": n, "throat_columns": n - len(ring), "rows": ROWS,
            "draped_m": [round(min(lengths), 4), round(sorted(lengths)[n // 2], 4), round(max(lengths), 4)],
            "lengths_m": [round(length_at(t), 4) for t in (0.0, math.pi / 2, math.pi)]}


def ride_worn(bm, surf, deform, groups):
    """Weights from the nearest coat, gorget or neck skin, in full below CUT_Z and
    fading into the vertex's own over RIDE_TOP above it."""
    ridden = 0
    for v in bm.verts:
        if v.co.z >= CUT_Z + RIDE_TOP:
            continue
        loc, _, tri, _ = surf["bvh"].find_nearest(v.co)
        if loc is None:
            continue
        under = surface_weights(surf, loc, tri)
        t = min(1.0, max(0.0, (CUT_Z + RIDE_TOP - v.co.z) / RIDE_TOP))
        t = t * t * (3 - 2 * t)
        mix = {g: w * (1 - t) for g, w in v[deform].items()}
        for name, w in under.items():
            mix[groups[name]] = mix.get(groups[name], 0.0) + w * t
        best = sorted(mix.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in best)
        if total <= 0:
            continue
        dv = v[deform]
        dv.clear()
        for g, w in best:
            if w > 0:
                dv[g] = w / total
        ridden += 1
    return ridden


def solidify(obj):
    """One lining WALL inward and a hem round every open edge, told apart by material
    slot: 0 the shell, 1 the lining, 2 the hem."""
    for _ in range(3):
        obj.data.materials.append(bpy.data.materials.new("part"))
    mod = obj.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = WALL
    mod.offset = -1.0
    mod.use_even_offset = False
    mod.use_rim = True
    mod.use_rim_only = False
    mod.material_offset = 1
    mod.material_offset_rim = 2
    obj.modifiers.move(obj.modifiers.find("Solidify"), 0)
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier="Solidify")


def paint(obj, colours):
    # The pack's own colour layers would export ahead of this one as COLOR_0.
    for layer in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(layer)
    col = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    counts = [0, 0, 0]
    for poly in obj.data.polygons:
        k = min(poly.material_index, 2)
        counts[k] += 1
        for li in poly.loop_indices:
            col.data[li].color = colours[k]
        poly.material_index = 0
    obj.data.materials.clear()
    return counts


def leather(obj):
    """The BlenderKit grain, levelled to grey and multiplied by the vertex colour."""
    C.box_uvs(obj, GRAIN)
    with bpy.data.libraries.load(W.LEATHER_BLEND) as (src, dst):
        dst.images = list(src.images)
    base = next((im for im in dst.images if im and "color" in im.name.lower()), None)
    normal = next((im for im in dst.images if im and "normal" in im.name.lower()), None)
    if base is None or normal is None:
        raise SystemExit(f"{W.LEATHER_BLEND} lacks its base colour or normal")
    normal.colorspace_settings.name = "Non-Color"
    for im in (base, normal):
        im.scale(TEX_PX, TEX_PX)
    px = np.empty(len(base.pixels), dtype=np.float32)
    base.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lin = np.where(px[:, :3] <= 0.04045, px[:, :3] / 12.92, ((px[:, :3] + 0.055) / 1.055) ** 2.4)
    grey = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    grey = np.clip(1.0 + (grey / grey.mean() - 1.0) * GRAIN_CONTRAST, 0.2, 3.0)
    out = np.clip(np.outer(grey, (C.TEX_MEAN,) * 3), 0.0, 1.0)
    px[:, :3] = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    base.pixels.foreach_set(px.ravel())
    base.update()
    mat = bpy.data.materials.new("MI_Hood_Leather")
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
    nmap.inputs["Strength"].default_value = LEATHER_NORMAL
    links.new(nrm.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = W.LEATHER_ROUGHNESS
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(mat)


def build(look, spec):
    surf = worn_surfaces(spec["worn"])
    arm, hood = import_hood()
    head = arm.matrix_world @ arm.data.bones["Head"].head_local
    moved = (head - surf["head"]).length
    if moved > 1e-4:
        raise SystemExit(f"the pack's Head sits {moved * 1000:.2f} mm off the wardrobe's")
    if hood.matrix_world != hood.matrix_world.Identity(4):
        raise SystemExit(f"{hood.name} is not placed at identity")
    groups = {g.name: g.index for g in hood.vertex_groups}
    missing = [b for b in BONES if b not in groups]
    if missing:
        raise SystemExit(f"{hood.name} lacks groups {missing}")
    me = hood.data
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.active
    dropped = outer_shell(bm, head)
    ring = cut_ring(bm, surf["centre"])
    collar, deepest = over_collar(bm, surf)
    # The push bends the band tighter than the lining's wall, which then folds
    # through the shell there; relax it, then settle it clear again.
    band = [v for v in bm.verts if v.co.z <= surf["centre"].z + BAND_TOP + 0.02 and not v.is_boundary]
    for _ in range(BAND_RELAX):
        bmesh.ops.smooth_vert(bm, verts=band, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # The band settles before the capelet hangs from it, or moving the ring after
    # would drag the capelet's top rows up through each other.
    nudged = nudge_clear(bm, surf)
    made, cap = capelet(bm, surf, ring, deform, groups)
    # Again over the throat, whose top row the capelet only just made.
    throat_collar, _ = over_collar(bm, surf, only=made)
    nudged += nudge_clear(bm, surf, only=made)
    ridden = ride_worn(bm, surf, deform, groups)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    for poly in me.polygons:
        poly.use_smooth = True
    me.materials.clear()
    # The shell is what shows; a spike ending inside the wall under it does not.
    shell_through = len(surf["bvh"].overlap(W.bvh_of(hood)))
    solidify(hood)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    if me.has_custom_normals:
        with bpy.context.temp_override(object=hood, active_object=hood):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    if look == "stalker":
        painted = paint(hood, (HIDE, HIDE_LINING, HIDE_TRIM))
        leather(hood)
    else:
        painted = paint(hood, (C.CLOTH, C.LINING, C.TRIM))
        C.wool(hood)
    for g in list(hood.vertex_groups):
        if g.name not in BONES:
            if any(x.group == g.index and x.weight > 1e-4 for v in me.vertices for x in v.groups):
                raise SystemExit(f"{hood.name} leans on {g.name}, outside {BONES}")
            hood.vertex_groups.remove(g)
    short = sum(1 for v in me.vertices if abs(sum(x.weight for x in v.groups) - 1.0) > 1e-3)
    if short:
        raise SystemExit(f"{short} vertices do not carry a full unit of weight")

    tris = G.triangles(hood)
    crossings = G.self_crossings(hood)
    through = len(surf["bvh"].overlap(W.bvh_of(hood)))
    low = [v.co.copy() for v in me.vertices if v.co.z < CUT_Z]
    clear01, clear_median = W.gap_profile(surf["bvh"], low)
    print(f"HOOD {look}: {dropped} lining and trim faces dropped, {collar} over the collar (deepest "
          f"{deepest * 1000:.1f} mm), {nudged} nudges, "
          f"capelet {cap['columns']}x{cap['rows']}, {len(me.vertices)} verts, "
          f"{tris} tris, crossings {crossings}, through shell {shell_through} with lining {through}, "
          f"capelet clearance p01 "
          f"{clear01 * 1000:.2f} median {clear_median * 1000:.2f} mm, paint {painted}")
    if crossings:
        raise SystemExit(f"the hood folds into itself: {crossings} crossing triangle pairs")
    if shell_through:
        raise SystemExit(f"the shell passes through what it lies on: {shell_through} triangle pairs")
    if clear01 < MIN_CLEAR:
        raise SystemExit(f"the capelet sits in what it lies on: p01 {clear01 * 1000:.2f} mm")

    stem = spec["stem"]
    hood.name = me.name = stem
    bpy.ops.object.select_all(action="DESELECT")
    hood.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = hood
    paths = [os.path.join(W.GEAR_SRC, f"{stem}.glb"), f"{KEEP_DIR}/{stem}.glb"]
    for out in paths:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True,
                                  export_animations=False, export_skins=True,
                                  export_yup=True, export_apply=False)
    W.clear_scene()
    bpy.ops.import_scene.gltf(filepath=paths[0])
    back = [o for o in bpy.data.objects if o.type == "MESH" and o.data.materials]
    if len(back) != 1:
        raise SystemExit(f"{paths[0]}: expected one hood, got {[o.name for o in back]}")
    back = back[0]
    for o in [o for o in bpy.data.objects if o is not back]:
        W.drop(o)
    W.bake_transform(back)
    tris_back = G.triangles(back)
    if abs(tris_back - tris) > tris * C.ROUNDTRIP_TOLERANCE or not back.data.color_attributes:
        raise SystemExit(f"{paths[0]} lost geometry or colour: {tris} -> {tris_back}")
    groups_back = sorted(g.name for g in back.vertex_groups)
    verts_back = len(back.data.vertices)
    G.render(back, {v: os.path.join(REVIEW, f"{stem}-{v}.png") for v in ("front", "quarter", "side", "rear")},
             views={"front": Vector((0, -1, 0)), "side": Vector((-1, 0, 0)), "rear": Vector((0, 1, 0)),
                    "quarter": Vector((-0.62, -0.66, 0.42)).normalized()})
    W.clear_scene()
    return {"source": os.path.relpath(PACK, KEEP_DIR), "worn": list(spec["worn"]),
            "cut_z": CUT_Z, "lining_and_trim_faces_dropped": dropped,
            "over_collar": collar, "deepest_collar_push_mm": round(deepest * 1000, 2),
            "throat_over_collar": throat_collar, "nudges": nudged,
            "ride_top_m": RIDE_TOP, "ridden": ridden,
            "capelet": cap, "gap_mm": GAP * 1000, "wall_mm": WALL * 1000, "hem_radius_m": HEM_RADIUS,
            "fold": {"count": FOLDS, "amp_mm": FOLD_AMP * 1000},
            "vertices": verts_back, "triangles": tris, "triangles_reloaded": tris_back,
            "self_crossings": crossings, "shell_through_worn": shell_through,
            "lining_through_worn": through,
            "clearance_p01_mm": round(clear01 * 1000, 2), "clearance_median_mm": round(clear_median * 1000, 2),
            "paint_faces": painted, "groups": groups_back, "wrote": [paths[1]]}


def main():
    report = {look: build(look, spec) for look, spec in LOOKS.items()}
    for look, spec in LOOKS.items():
        with open(f"{KEEP_DIR}/{spec['stem']}.json", "w") as fh:
            json.dump(report[look], fh, indent=1)
    print("PREP", json.dumps(report))


if __name__ == "__main__":
    main()
