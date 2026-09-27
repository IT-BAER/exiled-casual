"""Build the Stalker hood's mantle: leather from over the hood's hem onto the shoulders.

The hood is a rigid shell on Head and stops at the neck, so from any camera
below the shoulder line the gap between its hem and the coat's collar showed the
neck, and from any camera at all the hood never reached the shoulders. The
mantle closes both. It is not generated, for the reason `tools/prep_cowl.py`
gives for the ember neck: a piece that low has to be read off the surfaces it
lies on, and those are only known once the wardrobe is built.

It is a radial graph about one point on the neck axis (`W.mantle_centre`):
columns round the back from under one of the hood's front flaps to under the
other, rows down each column from over the hood's hem to a hem on the
shoulders, every sample the outermost hood, coat, gorget or skin on
that ray within MANTLE_REACH of the centre, so the T-posed sleeve past it is
never read. The floor is low-passed outward only, which hangs the leather from
the hood's hem over the collar instead of into it. Thickness, hem fold and paint
are `prep_cowl`'s, over the BlenderKit leather the trousers already use.

Reads the fitted hood, coat and gorget out of `wardrobe.glb`, so build that first.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python tools/prep_mantle.py
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
import prep_cowl as C  # noqa: E402
import prep_gauntlet as G  # noqa: E402

STEM = "stalker-mantle-v1"
KEEP_DIR = C.KEEP_DIR
REPORT = f"{KEEP_DIR}/{STEM}.json"
REVIEW = "D:/VSC/exiled-casual/review/3d/stalker-mantle-v1"
HOOD = "helmet.stalker.hood"
COAT = "chest.stalker.coat"
GORGET = "chest.stalker.gorget"
SKIN_SKIP = ("eyes", "brows", "hair")   # body parts that are not a surface to lie on

COLUMNS = 80
ROWS = 28
# The front is open: the hood's own flaps close it, so the mantle runs round the
# back from under one flap to under the other.
OPEN = math.radians(60)
# The graph's centre sits this far behind `W.mantle_centre` (+Y is back), which
# carries the whole footprint back off the front of the shoulders.
BACK = 0.03
REACH = 1.0               # where the rays start, outside everything
MANTLE_REACH = 0.25       # past this from the centre a surface is the sleeve
SHOULDER_REACH = 0.20     # past this off the axis a surface is the coat's shoulder cap
PHI_TOP = math.radians(70)
PHI_BOTTOM = math.radians(-80)
PHI_STEP = math.radians(0.5)
GAP = 0.003               # the leather's inner face off coat, gorget and skin
HOOD_GAP = 0.001          # over the hood both ride Head, so it lies almost on it
TUCK = 0.02               # the top rises this far over the hood's visible edge, `hood_edge`
# At the back the hood pinches in under its strap and bulges out above it, a notch in
# the side silhouette: the top climbs this much more there, by `back`, and each
# column's hull holds the rows over the pinch out, by `back` too.
BACK_RISE = 0.05
# The idle pose bows the head forward on a straight back, so a hull in bind pose bends
# inward at the centre's height: the back is pushed out this far there, over BULGE_HALF.
BULGE = 0.03
BULGE_HALF = 0.08
# The hem: this far off the axis, short of the coat's shoulder caps, or these
# depths under the neck's base toward the front and the back, whichever comes first.
# A column whose ray meets a cap first stops there, whatever its depth.
HEM_RADIUS = 0.185
HEM_FRONT_DZ = -0.045
HEM_BACK_DZ = -0.11
HEM_PASSES = 6
PASSES = 3                # low-pass across columns and rows, per envelope round
ROUNDS = 8
TOP_HUG = 6               # rows under the top eased back onto their floor: smoothing lifts the rim off the hood's waist
FAN = (-1, -0.5, 0, 0.5, 1)   # sub-samples across a cell, so a ridge between two is read
LEATHER = 0.003
FOLD_AMP = 0.0015
FOLD_ACROSS = 2.5
FOLD_DOWN = 4.0
MIN_CLEAR = 0.0005        # p01 clearance off coat, gorget and skin

# The hood's own leather, measured off its texture in linear light: the mean
# for the body, its brightest 8% for the trim and its darkest 10% for the lining,
# each divided by the grey the leather map is levelled to.
TEX_MEAN = C.TEX_MEAN
HIDE = (0.0296 / TEX_MEAN, 0.0196 / TEX_MEAN, 0.0105 / TEX_MEAN, 1.0)
TRIM = (0.0570 / TEX_MEAN, 0.0370 / TEX_MEAN, 0.0201 / TEX_MEAN, 1.0)
LINING = (0.0225 / TEX_MEAN, 0.0121 / TEX_MEAN, 0.0065 / TEX_MEAN, 1.0)
GRAIN = 0.12              # metres per tile of the leather map, box-projected
GRAIN_CONTRAST = 1.4
NORMAL_STRENGTH = 1.0
TEX_PX = 512
MATERIAL = "MI_Mantle_Leather"


def worn_surfaces():
    """The fitted hood, coat, gorget and the body, read back out of the built wardrobe."""
    W.clear_scene()
    bpy.ops.import_scene.gltf(filepath=W.OUT)
    soups = {}

    def soup(objs):
        verts, tris = [], []
        for o in objs:
            base = len(verts)
            verts += [(o.matrix_world @ v.co).copy() for v in o.data.vertices]
            o.data.calc_loop_triangles()
            tris += [tuple(base + k for k in t.vertices) for t in o.data.loop_triangles]
        return verts, tris

    for name in (HOOD, COAT, GORGET):
        o = bpy.data.objects.get(name)
        if o is None:
            raise SystemExit(f"{W.OUT} carries no {name}: build the wardrobe first")
        soups[name] = soup([o])
    skin = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("base.male.")
            and o.name.split(".")[2] not in SKIN_SKIP]
    soups["skin"] = soup(skin)
    rig = bpy.data.objects[W.MALE_RIG]
    centre = W.mantle_centre(rig) + Vector((0.0, BACK, 0.0))
    neck_z = (rig.matrix_world @ rig.data.bones["neck_01"].head_local).z
    hem = W.hood_hem(bpy.data.objects[HOOD], centre)
    print(f"SKIN from {sorted(o.name for o in skin)}")
    W.clear_scene()
    return soups, centre, neck_z, hem


def hood_top(hood_hem, theta):
    """The hood's hem at angle theta, the highest of the neighbouring columns, so a
    top TUCK above it is above the hem the hood actually has there."""
    m = len(hood_hem)
    a = round(theta / (2 * math.pi) * m) % m
    return max(hood_hem[(a + k) % m] for k in (-1, 0, 1))


def hood_edge(theta, phis, surface, dress, centre, hem):
    """Where the hood stops being the outside at angle theta: its hem, or higher where
    the coat's collar stands over it, as at the back, where the hem runs inside the collar."""
    for phi in phis:
        r, on_hood, _ = surface(theta, phi)
        if r is None or on_hood:
            continue
        p = centre + direction(theta, phi) * r
        if dress.find_nearest(p)[3] < 1e-5:
            return max(hem, p.z)
    return hem


def back(theta):
    """How much of the back half theta is on: 1 straight back, 0 from the sides forward."""
    return max(0.0, -math.cos(theta)) ** 2


def direction(theta, phi):
    """Out of the centre at angle theta round the axis (0 faces front) and phi above level."""
    return Vector((math.sin(theta) * math.cos(phi), -math.cos(theta) * math.cos(phi), math.sin(phi)))


def mantle_shell(soups, centre, neck_z, hood_hem, name="mantle_inner"):
    """The inner face: a grid of columns round the axis and rows down each one."""
    hood = BVHTree.FromPolygons(*soups[HOOD])
    under_v, under_t = [], []
    for key in (COAT, GORGET, "skin"):
        base = len(under_v)
        under_v += soups[key][0]
        under_t += [tuple(base + k for k in t) for t in soups[key][1]]
    under = BVHTree.FromPolygons(under_v, under_t)
    all_v = under_v + soups[HOOD][0]
    all_t = under_t + [tuple(len(under_v) + k for k in t) for t in soups[HOOD][1]]
    every = BVHTree.FromPolygons(all_v, all_t)

    def surface(theta, phi):
        """(distance, lies on the hood, capped) of the outermost surface near the centre.

        Capped means a surface other than the hood stands past SHOULDER_REACH: the
        shoulder cap, whose wall the mantle must stop short of, not slip under.
        """
        d = direction(theta, phi)
        hit = C.outermost(every, centre + d * REACH, d,
                          lambda p: (p - centre).dot(d) > 0 and (p - centre).length <= MANTLE_REACH)
        if hit is None:
            return None, False, False
        on_hood = hood.find_nearest(hit)[3] < 1e-5
        return (hit - centre).length, on_hood, not on_hood and math.hypot(hit.x, hit.y - centre.y) > SHOULDER_REACH

    n = COLUMNS
    thetas = [OPEN + (2 * math.pi - 2 * OPEN) * a / (n - 1) for a in range(n)]
    hem_z = [neck_z + HEM_FRONT_DZ + (HEM_BACK_DZ - HEM_FRONT_DZ) * (1 - math.cos(t)) / 2
             for t in thetas]

    def nb(a):
        return max(0, a - 1), min(n - 1, a + 1)

    phis = [PHI_TOP - PHI_STEP * k for k in range(int((PHI_TOP - PHI_BOTTOM) / PHI_STEP) + 1)]
    tops, feet = [], []
    dress = BVHTree.FromPolygons(under_v[:len(soups[COAT][0]) + len(soups[GORGET][0])],
                                 under_t[:len(soups[COAT][1]) + len(soups[GORGET][1])])
    for a, t in enumerate(thetas):
        edge = hood_edge(t, phis, surface, dress, centre, hood_top(hood_hem, t)) + TUCK
        want = edge + BACK_RISE * back(t)
        top, foot = None, None
        for phi in phis:
            r, _, capped = surface(t, phi)
            if r is None:
                continue
            p = centre + direction(t, phi) * r
            if top is None and p.z <= edge and not capped:
                top = phi
            if top is not None and (capped or math.hypot(p.x, p.y - centre.y) >= HEM_RADIUS
                                    or p.z <= hem_z[a]):
                foot = phi + PHI_STEP if capped else phi
                break
        if top is None or foot is None:
            raise SystemExit(f"column {a} finds no top or no hem: top {top}, foot {foot}")
        # climbed from the edge, not scanned from above: over the crown the hood is lower than `want`
        for phi in reversed(phis):
            if phi <= top:
                continue
            r, _, capped = surface(t, phi)
            if r is None or capped or (centre + direction(t, phi) * r).z > want:
                break
            top = phi
        tops.append(top)
        feet.append(foot)
    # Smoothed, but never past where its own column stopped: that is the cap's wall.
    raw = feet
    for _ in range(HEM_PASSES):
        feet = [max(raw[a], (feet[nb(a)[0]] + feet[a] * 2 + feet[nb(a)[1]]) / 4) for a in range(n)]

    rows = ROWS + 1
    phi_at = [[tops[a] + (feet[a] - tops[a]) * u / ROWS for u in range(rows)] for a in range(n)]
    floor = [[0.0] * rows for _ in range(n)]
    hooded = 0
    for a in range(n):
        half_t = (math.pi - OPEN) / (n - 1)
        half_p = (tops[a] - feet[a]) / ROWS / 2
        for u in range(rows):
            best = None
            for s in FAN:
                for q in FAN:
                    r, on_hood, capped = surface(thetas[a] + s * half_t, phi_at[a][u] + q * half_p)
                    if r is None or capped:
                        continue
                    r += HOOD_GAP if on_hood else GAP
                    best = r if best is None else max(best, r)
                    hooded += on_hood and s == 0 and q == 0
            if best is None:
                raise SystemExit(f"column {a} row {u} meets nothing")
            floor[a][u] = best
    # Each back column is held out on its own convex hull: no row sits inside the line
    # between two others, so neither the hood's pinch nor the neck-to-back corner is a notch.
    # At the sides the lift fades out, or the mantle stands off the shoulder caps and the neck shows from below.
    bridged = 0
    for a in range(n):
        at = [(floor[a][u] * math.cos(phi_at[a][u]), floor[a][u] * math.sin(phi_at[a][u]))
              for u in range(rows)]
        for u in range(1, rows - 1):
            dx, dz = math.cos(phi_at[a][u]), math.sin(phi_at[a][u])
            lift = floor[a][u]
            for i in range(u):
                hx, hz = at[i]
                for j in range(u + 1, rows):
                    ex, ez = at[j][0] - hx, at[j][1] - hz
                    det = dx * -ez - dz * -ex
                    if abs(det) < 1e-12:
                        continue
                    k = (hx * -ez - hz * -ex) / det
                    s = (dx * hz - dz * hx) / det
                    if 0.0 <= s <= 1.0 and k > lift:
                        lift = k
            if lift > floor[a][u]:
                floor[a][u] += (lift - floor[a][u]) * back(thetas[a])
                bridged += 1
    print(f"BRIDGE lifted {bridged} row samples onto their column's hull")
    r = [row[:] for row in floor]
    for _ in range(ROUNDS):
        r = [[max(r[a][u], floor[a][u]) for u in range(rows)] for a in range(n)]
        for _ in range(PASSES):
            r = [[(r[nb(a)[0]][u] + r[a][u] * 2 + r[nb(a)[1]][u]) / 4 for u in range(rows)]
                 for a in range(n)]
            r = [[(r[a][max(0, u - 1)] + r[a][u] * 2 + r[a][min(rows - 1, u + 1)]) / 4
                  for u in range(rows)] for a in range(n)]
    r = [[max(r[a][u], floor[a][u]) for u in range(rows)] for a in range(n)]
    # Eased onto the highest floor of the row and its neighbours: a collar corner
    # between two rows is under neither vertex, and would cut the edge between them.
    ease = [[min(1.0, u / TOP_HUG) for u in range(rows)] for a in range(n)]
    hug = [[max(floor[a][max(0, u - 1):u + 2]) for u in range(rows)] for a in range(n)]
    r = [[min(r[a][u], hug[a][u] + (r[a][u] - hug[a][u]) * e * e * (3 - 2 * e)) for u, e in enumerate(ease[a])]
         for a in range(n)]
    print(f"TOP stands {max(r[a][0] - floor[a][0] for a in range(n)) * 1000:.1f} mm off its floor at most")

    bm = bmesh.new()
    grid = []
    for a in range(n):
        ring = []
        for u in range(rows):
            d = direction(thetas[a], phi_at[a][u])
            lift = FOLD_AMP * (1.0 + noise.noise(Vector((
                math.cos(thetas[a]) * FOLD_ACROSS, math.sin(thetas[a]) * FOLD_ACROSS,
                phi_at[a][u] * FOLD_DOWN)) + C.FOLD_OFFSET)) / 2
            p = centre + d * (r[a][u] + lift)
            s = max(0.0, 1.0 - abs(p.z - centre.z) / BULGE_HALF)
            o = BULGE * back(thetas[a]) * s * s * (3 - 2 * s)
            ring.append(bm.verts.new(p + Vector((math.sin(thetas[a]), -math.cos(thetas[a]), 0.0)) * o))
        grid.append(ring)
    for a in range(n - 1):
        b = a + 1
        for u in range(ROWS):
            bm.faces.new((grid[a][u], grid[b][u], grid[b][u + 1], grid[a][u + 1]))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()
    loops = C.rim_loops(bm)
    if loops != 1:
        raise SystemExit(f"a mantle open at the front has one edge; this has {loops}")
    rim = {v.index for v in bm.verts if v.is_boundary}
    hem = C.hem_rings(bm, rim)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    left = len(G.crossing_verts(obj))
    feet_z = [(centre + direction(thetas[a], phi_at[a][-1]) * r[a][-1]) for a in range(n)]
    print(f"MANTLE {len(me.vertices)} verts, {left} crossing, {hooded} centre samples on the hood, "
          f"top {min(tops) * 180 / math.pi:.1f}..{max(tops) * 180 / math.pi:.1f} deg, "
          f"hem {min(feet) * 180 / math.pi:.1f}..{max(feet) * 180 / math.pi:.1f} deg, "
          f"hem reach {max(math.hypot(p.x, p.y - centre.y) for p in feet_z) * 1000:.0f} mm, "
          f"hem z {min(p.z for p in feet_z) - neck_z:+.3f}..{max(p.z for p in feet_z) - neck_z:+.3f}")
    if left:
        raise SystemExit(f"the mantle folds at {left} vertices")
    return obj, dict(rim=sorted(rim), hem=hem, hood=hood, under=under,
                     coat=BVHTree.FromPolygons(*soups[COAT]),
                     gorget=BVHTree.FromPolygons(*soups[GORGET]),
                     hood_hem=hood_hem, shell_vertices=len(me.vertices))


def leather_maps():
    """The BlenderKit leather: its normal as is, its base colour as grey about TEX_MEAN."""
    with bpy.data.libraries.load(W.LEATHER_BLEND) as (src, dst):
        dst.images = list(src.images)
    base = next((im for im in dst.images if im and "color" in im.name.lower()), None)
    normal = next((im for im in dst.images if im and "normal" in im.name.lower()), None)
    if base is None or normal is None:
        raise SystemExit(f"{W.LEATHER_BLEND} lacks its base colour or normal: "
                         f"{[im.name for im in dst.images if im]}")
    # Before the scale: a colour space set afterwards reloads the file off disk.
    normal.colorspace_settings.name = "Non-Color"
    for im in (base, normal):
        im.scale(TEX_PX, TEX_PX)
    px = np.empty(len(base.pixels), dtype=np.float32)
    base.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lin = np.where(px[:, :3] <= 0.04045, px[:, :3] / 12.92, ((px[:, :3] + 0.055) / 1.055) ** 2.4)
    grey = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    grey = np.clip(1.0 + (grey / grey.mean() - 1.0) * GRAIN_CONTRAST, 0.2, 3.0)
    out = np.clip(np.outer(grey, (TEX_MEAN,) * 3), 0.0, 1.0)
    px[:, :3] = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    base.pixels.foreach_set(px.ravel())
    base.update()
    print(f"LEATHER maps {base.name}, {normal.name}")
    return base, normal


def leather(obj):
    """The grain, multiplied by the vertex colour `paint` laid down."""
    C.box_uvs(obj, GRAIN)
    base, normal = leather_maps()
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
    bsdf.inputs["Roughness"].default_value = W.LEATHER_ROUGHNESS
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(mat)
    return mat


def main():
    soups, centre, neck_z, hood_hem = worn_surfaces()
    print(f"CENTRE {tuple(round(c, 4) for c in centre)}, neck base z {neck_z:.4f}, "
          f"hood hem {min(hood_hem) - neck_z:+.3f}..{max(hood_hem) - neck_z:+.3f}")
    inner, det = mantle_shell(soups, centre, neck_z, hood_hem)
    outer = C.thicken(inner, det["hem"], centre, "mantle", wall=LEATHER)
    thin, median = C.wall_profile(inner, outer)
    shared, bridged, _ = C.fold_stitch(inner, outer, set(det["rim"]))
    W.drop(inner)
    mantle = outer
    painted = C.paint(mantle, det["hem"], (HIDE, LINING, TRIM))
    leather(mantle)
    tris = G.triangles(mantle)
    crossings = G.self_crossings(mantle)
    print(f"MANTLE {len(mantle.data.vertices)} verts, {tris} tris, crossings {crossings}")
    if crossings > C.SEAM_CROSSINGS:
        raise SystemExit(f"the mantle folds into itself: {crossings} crossing triangle pairs")

    pts = [v.co.copy() for v in mantle.data.vertices]
    clear01, clear_median = W.gap_profile(det["under"], pts)
    mine = W.bvh_of(mantle)
    through = {k: len(det[k].overlap(mine)) for k in ("hood", "coat", "gorget", "under")}
    # Over the hood's hem the leather lies on the hood's outer face, never under it.
    top = [p for p in pts if p.z > hood_top(hood_hem, math.atan2(p.x, -(p.y - centre.y))) + 0.002]
    def under_hood(p):
        d = (p - centre).normalized()
        return C.outermost(det["hood"], p + d * REACH, d,
                           lambda h: (h - p).dot(d) > 0) is not None

    over_hood = 1.0 - sum(under_hood(p) for p in top) / max(1, len(top))
    print(f"MANTLE clearance p01 {clear01 * 1000:.2f} median {clear_median * 1000:.2f} mm, "
          f"through {through}, over the hood {over_hood:.4f} of {len(top)}")
    if clear01 < MIN_CLEAR:
        raise SystemExit(f"the mantle sits in the coat or skin: p01 clearance {clear01 * 1000:.2f} mm")
    if any(through.values()):
        raise SystemExit(f"the mantle passes through what it lies on: {through}")
    if not top or over_hood < 1.0:
        raise SystemExit(f"the mantle slips under the hood: {over_hood:.4f} over it")

    G.export(mantle, [os.path.join(W.GEAR_SRC, f"{STEM}.glb"), f"{KEEP_DIR}/{STEM}.glb"])
    W.clear_scene()
    back, tris_back = C.roundtrip(os.path.join(W.GEAR_SRC, f"{STEM}.glb"), tris, True)
    os.makedirs(REVIEW, exist_ok=True)
    G.render(back, {v: os.path.join(REVIEW, f"{STEM}-{v}.png") for v in ("front", "quarter", "side", "rear")},
             views={"front": Vector((0, -1, 0)), "side": Vector((-1, 0, 0)), "rear": Vector((0, 1, 0)),
                    "quarter": Vector((-0.62, -0.66, 0.42)).normalized()})
    report = {
        "built_from": "a radial graph about W.mantle_centre over the fitted helmet.stalker.hood, "
                      "chest.stalker.coat, chest.stalker.gorget and base.male skin out of wardrobe.glb",
        "centre": [round(c, 5) for c in centre], "back_m": BACK, "columns": COLUMNS, "rows": ROWS,
        "hem_radius_m": HEM_RADIUS, "hem_front_dz": HEM_FRONT_DZ, "hem_back_dz": HEM_BACK_DZ,
        "tuck_m": TUCK, "top_hug_rows": TOP_HUG, "open_deg": math.degrees(OPEN), "gap_mm": GAP * 1000, "hood_gap_mm": HOOD_GAP * 1000,
        "wall_mm": LEATHER * 1000, "thinnest_wall_mm": thin, "median_wall_mm": median,
        "hem_shared": shared, "rim_edges": bridged, "paint_faces": painted,
        "triangles": tris, "triangles_reloaded": tris_back, "self_crossings": crossings,
        "clearance_p01_mm": round(clear01 * 1000, 2), "clearance_median_mm": round(clear_median * 1000, 2),
        "through": through, "over_hood": round(over_hood, 4),
        "material": MATERIAL, "leather": W.LEATHER_ID,
        "wrote": [f"{KEEP_DIR}/{STEM}.glb"],
    }
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=1)
    print("PREP", json.dumps(report))


if __name__ == "__main__":
    main()
