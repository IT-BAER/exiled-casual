"""Build every creature as one glTF: the thirteen mobs and the four map bosses.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python tools/build_monsters.py

Why this exists
---------------
Thirteen species and a boss all rendered as the SAME quadruped imp built out of
Babylon spheres, separated only by a tint and a scale factor (`buildImp` in
`meshes.ts`). Four biomes with their own monster pools fought four sets of
recolours. On a top-down camera the silhouette is the only thing a player reads
at speed, so a recolour is not a monster: it is the same monster wearing a hat.

How a creature is made here
---------------------------
**Every organic mass is a SKELETON, not a stack of primitives.** A species
declares a graph of nodes with a radius each — spine, neck, skull, snout, tail,
one chain per limb — and the Skin modifier wraps a hull around it, Catmull-Clark
rounds that hull, and a Displace with a Voronoi field crags the result. That is
Blender's own base-mesh workflow, and it is the difference between a creature
and a snowman: a neck that flows out of a shoulder, a haunch that swells and
tapers, a limb that thickens at the joint.

The first pass welded ellipsoids and tubes together and every creature in the
contact sheet came out the same potato, because a sphere unioned with a sphere
is a bigger sphere. Only hard surfaces are still authored directly: armour
plates, horns, tusks, antler racks, glowing eyes and brood sacs. Those are
merged in AFTER the modifiers, so displacement never warps a straight edge.

Four proportion rules the shapes are held to
--------------------------------------------
1. **A trunk swells and tapers.** Shoulder mass, a waist, a lighter haunch. One
   radius the whole way is a sausage at any resolution.
2. **Legs carry at least a third of the height** and are thick enough to survive
   a 320px shot, ending on a foot pad. A leg tapering to a point reads as a
   stick insect at every scale.
3. **A head needs a neck** — a narrower node between skull and shoulder. Welded
   straight on, it merges under smooth shading and the creature loses its front.
4. **One oversized outline feature each**, at least 15% of the height: the rack,
   the mantle, the blade, the crown of sacs. That is the thing a player names the
   monster by from across a room.

Two more decisions worth keeping
--------------------------------
* **The armature comes out of the same node graph.** Every creature is one
  skinned mesh on bones grown from the very chains the hulls were grown around,
  weighted by distance to the bone segment, carrying an authored `walk` and
  `idle`. The first pass shipped each limb as a separate rigid object rotated
  about one hip axis by the runtime, which is a pendulum by construction — no
  knee, no ankle, no weight shift — and looked like a robot, because it was one.
  It costs a skinned draw per creature instead of a GPU instance; a knee is
  worth it. **A leg is four nodes now (hip, knee, ankle, toe)** and the trunk
  drops `CROUCH_K` through the whole walk, because a leg authored straight to
  the floor is already at full extension and cannot take a step without its foot
  leaving the ground.
* **The hide is a tiling swatch, not an unwrap.** Every surface is box-projected
  from world axes at a per-species tile size, so a species needs no UV work and a
  re-generated hide sheet drops straight in. Four sheets dress thirteen species;
  the shapes do the telling apart, which is the point. Each sheet also gets a
  normal map derived from its own luminance — the same trick, and the same
  reason, as `build_tileset_textures.py`: the generator ships no height data and
  a creature with no surface relief is a painted balloon.

Materials are exported metallic-0 and emit their own albedo at 6%, for the same
reason the props do: the scene has no environment texture, and a map is dark
enough that an unlit creature is a hole.

Textures are downscaled to 512 and re-encoded as JPEG on the way in: the 1024
PNG masters embed as ~2.5MB each and no imp on this camera is worth that.
"""
import importlib.util
import math
import os
import sys

import bpy
import numpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_DIR = os.path.join(ROOT, "assets", "monsters")
BUILD_DIR = os.path.join(TEX_DIR, "build")
OUT = os.path.join(ROOT, "assets", "monsters", "monsters.glb")

# Hide sheet per biome family. The cinder sheet is the one the imp already wore,
# so the starting lab fight looks exactly as it did.
TEXTURES = {
    "cinder": os.path.join(ROOT, "apps", "web", "public", "textures", "imp_skin.png"),
    "vaal": os.path.join(TEX_DIR, "vaal_stone_hide_v1.png"),
    "desert": os.path.join(TEX_DIR, "desert_hide_v1.png"),
    "swamp": os.path.join(TEX_DIR, "swamp_hide_v1.png"),
    "forest": os.path.join(TEX_DIR, "forest_hide_v1.png"),
}
TEX_SIZE = 512
TEX_QUALITY = 86

# How hard the derived normal map bites. Same reasoning, and the same number, as
# the tileset builder: luminance stands in for height, and past ~3 the cracks
# start to look inflated rather than recessed.
NORMAL_STRENGTH = 2.2

# The hot accent per family: what the eyes, the veins and the split-open bits
# are lit with. Linear, because glTF base colour is linear (see build_props.py).
GLOW = {
    "cinder": (1.00, 0.28, 0.05),
    "vaal": (0.18, 0.85, 0.55),
    "desert": (1.00, 0.72, 0.22),
    "swamp": (0.32, 0.95, 0.30),
    "forest": (0.45, 0.80, 1.00),
}

# Bone, tusk, claw, antler: the one surface that is neither hide nor lit. Dark,
# because a bright bone turns every horn into the brightest thing on the model
# and the creature reads as a pile of tusks.
BONE = (0.16, 0.15, 0.12)

# **A creature is read as a shape before it is read as a creature, and a shape
# needs to be darker than what it stands on.** Measured, the roster was not:
# a forest whelp's hide came out at 74 luma over a forest floor of 55, so the
# monster was the BRIGHTER object and its outline dissolved into the ground at
# play size. The reference frame (`inside-map-battle.webp`) is the opposite —
# the monsters are the darkest things in it and the lit sand carries the frame.
#
# So each hide is tinted to land at a fixed fraction of the floor it walks on,
# rather than at a colour somebody liked in isolation. Floor values are the mean
# Rec.601 luma of `assets/tilesets/<biome>/floor_master_v1.png` AFTER
# `build_tileset_textures.py` lifts anything below 55 — re-measure there if a
# biome plate is regenerated.
FLOOR_LUMA = {"cinder": 75.0, "vaal": 75.0, "desert": 162.0, "swamp": 55.0, "forest": 55.0,
              "coast": 135.0}
HIDE_RATIO = 0.45
# Swamp and forest floors are themselves at the playable minimum, and 45% of a
# floor that dark is a creature with no readable interior at all — only an
# outline. This is the value below which a hide stops being lit and starts being
# a hole, the same argument `build_tileset_textures.py` makes about its plates.
HIDE_FLOOR = 30.0

EMISSION = 0.06
GLOW_EMISSION = 1.3

# Material slots, in the order every creature mesh declares them.
HIDE, GLOWS, BONES = 0, 1, 2

# The Skin modifier's radius is the half-width of a square cross-section, and
# Catmull-Clark pulls that square in toward its inscribed circle. Declared radii
# are what the creature should MEASURE, so they are opened up on the way in.
SKIN_GAIN = 1.12

# Smooth everywhere, sharp where two faces meet at a real corner. 28 degrees, not
# the props' 40: a creature wants to look carved, and at 40 a shoulder plate melts
# into the shoulder it is bolted to.
SMOOTH_ANGLE = 28.0

# One knob for every leg in the file. The radii each species declares are what
# the leg should look like as a drawn line; the Skin hull plus two levels of
# Catmull-Clark then swell it, and at 1.0 the whole roster stood on sausages.
LEG_TRIM = 0.78

# The profile DOWN a leg, as fractions of the declared hip and foot radii.
# A single taper from hip to foot is a cone, and a cone with a ball on the end
# is a toy limb: it has no knee, no shin and no ankle, only a thickness that
# falls off. Mass belongs at the haunch, the narrowest point is the ankle, and
# the sole stays broad under it — the gap between a thin ankle and a wide foot
# is most of what says the creature is standing on something rather than
# tapering into the floor.
# Measured at play size, not at sculpt size: a shin below about four percent of
# the creature's height is one or two pixels on screen and vanishes into its own
# shadow, so the roster stops reading as standing on anything. Only the ankle is
# genuinely thin, and the sole under it stays broad.
KNEE_K, ANKLE_K, TOE_K = 0.72, 0.72, 0.55
PAD_K = 2.0

# Ambient occlusion, baked per vertex against the whole creature and exported as
# COLOR_0. This is the largest single thing separating a sculpt from a balloon:
# real creatures are dark where a limb meets a flank, under a shoulder plate, in
# the pit of a rib, and a runtime with one sun and a fill light cannot invent
# that. Babylon multiplies COLOR_0 into base colour, so it costs nothing to draw.
AO_RAYS = 24
# Rays only reach this fraction of the creature's height, so what is baked is
# contact shadow between neighbouring parts, not "how deep inside the body am I".
AO_REACH = 0.36
# How black the deepest crease goes. Past ~0.75 the underside of every quadruped
# becomes a hole and the legs stop reading as attached to anything.
AO_STRENGTH = 0.62

# Fraction of the subdivided faces that survive the collapse. 0.45 was measured,
# not guessed: at 1.0 the glb is 5.6MB for seventeen creatures nobody looks at
# closely, and below ~0.3 the antler tines start losing their taper.
DECIMATE = 0.45


# --------------------------------------------------------------------------
# hard-surface generators — pure, each returns (verts, faces)
# --------------------------------------------------------------------------

def ellipsoid(center, radii, segs=12, rings=7):
    """Eyes, brood sacs, foot pads, growths — anything that is a smooth lump."""
    cx, cy, cz = center
    rx, ry, rz = radii
    verts = [(cx, cy, cz + rz)]
    faces = []
    for i in range(1, rings):
        phi = math.pi * i / rings
        for s in range(segs):
            a = 2.0 * math.pi * s / segs
            verts.append((
                cx + rx * math.sin(phi) * math.cos(a),
                cy + ry * math.sin(phi) * math.sin(a),
                cz + rz * math.cos(phi),
            ))
    verts.append((cx, cy, cz - rz))
    bottom = len(verts) - 1

    for s in range(segs):
        t = (s + 1) % segs
        faces.append([0, 1 + t, 1 + s])
    for i in range(rings - 2):
        a0 = 1 + i * segs
        b0 = a0 + segs
        for s in range(segs):
            t = (s + 1) % segs
            faces.append([a0 + s, a0 + t, b0 + t, b0 + s])
    last = 1 + (rings - 2) * segs
    for s in range(segs):
        t = (s + 1) % segs
        faces.append([bottom, last + s, last + t])
    return verts, faces


def horn(points, radii, segs=6):
    """Sweep a shrinking radius along a polyline: horns, tusks, antler beams,
    spines. A final radius of 0 closes to a point."""
    verts = []
    rings = []
    n = len(points)
    for i, (p, r) in enumerate(zip(points, radii)):
        if i < n - 1:
            d = [points[i + 1][k] - p[k] for k in range(3)]
        else:
            d = [p[k] - points[i - 1][k] for k in range(3)]
        length = math.sqrt(sum(c * c for c in d)) or 1.0
        d = [c / length for c in d]
        up = (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)
        u = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]]
        ul = math.sqrt(sum(c * c for c in u)) or 1.0
        u = [c / ul for c in u]
        v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
        if r <= 1e-6:
            rings.append([len(verts)] * segs)
            verts.append(tuple(p))
            continue
        ring = []
        for s in range(segs):
            a = 2.0 * math.pi * s / segs
            c, sn = math.cos(a), math.sin(a)
            ring.append(len(verts))
            verts.append(tuple(p[k] + r * (c * u[k] + sn * v[k]) for k in range(3)))
        rings.append(ring)

    faces = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for s in range(segs):
            t = (s + 1) % segs
            quad = [a[s], b[s], b[t], a[t]]
            uniq = []
            for q in quad:
                if q not in uniq:
                    uniq.append(q)
            if len(uniq) >= 3:
                faces.append(uniq)
    if len(set(rings[0])) > 1:
        faces.append(list(reversed(rings[0])))
    if len(set(rings[-1])) > 1:
        faces.append(list(rings[-1]))
    return verts, faces


def fin(base_a, base_b, tip, thickness, lean=0.0):
    """A flat blade standing on a base edge: a back plate, a crest, a torn ear.

    **The camera sits nineteen units up and a trash monster is about seventy
    pixels tall.** A feature has to be wide as well as long to survive that: the
    round spines `horn` sweeps are three percent of the creature across and go
    to nothing at all, while a blade of the same length reads because it holds
    several pixels of its own value against the floor. `lean` slides the tip
    sideways so a row of these does not read as a comb.
    """
    ax, ay, az = base_a
    bx, by, bz = base_b
    tx, ty, tz = tip
    # Thickness runs along the base's own normal in the ground plane, so a fin
    # on a flank stands out of the flank rather than out of the world.
    dx, dy = bx - ax, by - ay
    length = math.sqrt(dx * dx + dy * dy) or 1.0
    nx, ny = -dy / length * thickness / 2, dx / length * thickness / 2
    tx += lean * dx / length
    ty += lean * dy / length
    verts = [
        (ax + nx, ay + ny, az), (bx + nx, by + ny, bz), (tx + nx, ty + ny, tz),
        (ax - nx, ay - ny, az), (bx - nx, by - ny, bz), (tx - nx, ty - ny, tz),
    ]
    faces = [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]]
    return verts, faces


def slab(center, size, tilt=0.0):
    """An armour plate or a carapace shelf. `tilt` pitches it about x."""
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    corners = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    c, s = math.cos(tilt), math.sin(tilt)
    verts = [(cx + x, cy + y * c - z * s, cz + y * s + z * c) for x, y, z in corners]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [3, 0, 4, 7], [1, 2, 6, 5]]
    return verts, faces


# --------------------------------------------------------------------------
# the skeleton half: skin -> subdivide -> displace, then read the result back
# --------------------------------------------------------------------------

_crags = {}


def crag_texture(scale):
    """The field the Displace modifier reads.

    The wavelength is per creature, not global, and that is the whole trick: at
    one fixed scale the same 22cm bumps that read as stone cell on a boss are
    four lumps on an imp, which is what made the first pass look like potatoes.
    Scale it to the creature and both get the same *relative* crag.
    """
    key = round(scale, 4)
    if key not in _crags:
        tex = bpy.data.textures.new(f"crag_{key}", "VORONOI")
        tex.noise_scale = scale
        tex.noise_intensity = 1.0
        tex.contrast = 1.5
        _crags[key] = tex
    return _crags[key]


def skinned(nodes, radii, edges, subdiv, displace, crag_scale, name="skin"):
    """Wrap a hull around a skeleton and hand back its evaluated geometry.

    Modifiers are evaluated through the dependency graph rather than applied with
    an operator: `--background` has no object mode to poll against, and the
    evaluated mesh is exactly what the exporter would have baked anyway.
    """
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(n) for n in nodes], edges, [])
    me.validate()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)

    # Adding the modifier is what creates the per-vertex skin layer.
    skin = obj.modifiers.new("skin", "SKIN")
    skin.use_smooth_shade = True
    layer = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        # A node may declare one radius or two. **Two is what stops a creature
        # being a bean**: the Skin modifier's pair is (across, up) for a chain
        # running along the ground — probed, not assumed — so a rib cage can be
        # tall and narrow above a pelvis that is wide and flat, and the trunk
        # gets a cross-section that changes down its length instead of one
        # circle swept from nose to tail.
        rx, rz = (r, r) if isinstance(r, (int, float)) else r
        layer[i].radius = (rx * SKIN_GAIN, rz * SKIN_GAIN)
    # Exactly one root per island, or the modifier has nothing to grow from.
    seen = set()
    for a, b in edges:
        if a not in seen and b not in seen:
            layer[a].use_root = True
        seen.add(a)
        seen.add(b)

    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = subdiv
    sub.render_levels = subdiv

    if displace > 0.0:
        disp = obj.modifiers.new("disp", "DISPLACE")
        disp.texture = crag_texture(crag_scale)
        disp.texture_coords = "GLOBAL"
        disp.strength = displace
        disp.mid_level = 0.42

    # Retopo, in one modifier. Two levels of Catmull-Clark is the resolution the
    # DISPLACEMENT needs to have anything to push on; it is roughly twice the
    # resolution the finished silhouette needs. Collapsing afterwards keeps the
    # crags and halves the file — subdividing once instead would keep the file
    # and lose the crags.
    dec = obj.modifiers.new("dec", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = DECIMATE

    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(deps).to_mesh()
    verts = [tuple(v.co) for v in evaluated.vertices]
    faces = [list(p.vertices) for p in evaluated.polygons]
    obj.evaluated_get(deps).to_mesh_clear()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(me, do_unlink=True)
    return verts, faces


def hemisphere(count):
    """A fixed cosine-ish spread of directions on the +Z hemisphere.

    Golden-angle spiral rather than random sampling, so two builds of the same
    creature bake byte-identical occlusion — the asset is checked in, and a
    rebuild that only reshuffles noise is a diff nobody can review.
    """
    out = []
    golden = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(count):
        z = (i + 0.5) / count          # 0..1, weighted toward the horizon
        r = math.sqrt(1.0 - z * z)
        a = golden * i
        out.append(Vector((r * math.cos(a), r * math.sin(a), z)))
    return out


def bake_ao(built, reach):
    """Per-vertex ambient occlusion for one creature, part by part.

    Every part occludes every other, which is the whole point: the top of a leg
    is dark because a flank hangs over it. Rays stop at `reach`, so what comes
    out is contact shadow rather than a thickness map.
    """
    all_verts, all_faces = [], []
    for verts, faces, _ in built:
        base = len(all_verts)
        all_verts.extend(Vector(v) for v in verts)
        # Fan-triangulated on the way in. The tube caps are n-gons, and an n-gon
        # handed to the BVH comes back as geometry that is not where the surface
        # is — which bakes as a creature occluded from every direction at once.
        for f in faces:
            for k in range(1, len(f) - 1):
                all_faces.append([f[0] + base, f[k] + base, f[k + 1] + base])
    if not all_faces:
        return [None] * len(built)
    bvh = BVHTree.FromPolygons(all_verts, all_faces, all_triangles=True, epsilon=0.0)
    dirs = hemisphere(AO_RAYS)

    out = []
    for verts, faces, _ in built:
        # Vertex normals from the faces that touch them — the mesh does not exist
        # yet, so there is nothing to ask.
        normals = [Vector((0.0, 0.0, 0.0)) for _ in verts]
        for f in faces:
            a, b, c = (Vector(verts[f[0]]), Vector(verts[f[1]]), Vector(verts[f[2]]))
            n = (b - a).cross(c - a)
            for i in f:
                normals[i] += n
        shade = []
        for i, v in enumerate(verts):
            n = normals[i]
            if n.length_squared < 1e-12:
                shade.append(1.0)
                continue
            n.normalize()
            # Build a frame around the normal so the spiral lands on ITS
            # hemisphere rather than the world's.
            up = Vector((0.0, 0.0, 1.0)) if abs(n.z) < 0.9 else Vector((1.0, 0.0, 0.0))
            u = n.cross(up).normalized()
            w = n.cross(u)
            origin = Vector(v) + n * (reach * 0.01)
            hits = 0
            for d in dirs:
                ray = u * d.x + w * d.y + n * d.z
                if bvh.ray_cast(origin, ray, reach)[0] is not None:
                    hits += 1
            shade.append(1.0 - AO_STRENGTH * hits / AO_RAYS)
        out.append(shade)
    flat = [s for part in out for s in part]
    print("  ao min %.2f mean %.2f" % (min(flat), sum(flat) / len(flat)))
    return out


class Part:
    """One object in the finished creature: a skeleton, plus hard geometry.

    The two are merged only after the modifiers have run, so a displacement that
    crags a haunch never bends the straight edge of an armour plate.
    """

    def __init__(self, name, origin=(0.0, 0.0, 0.0), subdiv=2, displace=0.03, crag=0.1):
        self.name = name
        self.origin = origin
        self.subdiv = subdiv
        self.displace = displace
        self.crag = crag
        # Cross-section control: the Skin modifier only knows one radius, so a
        # slab-sided construct and a flat carapace are made by scaling the
        # finished part about a pivot rather than by a rounder skeleton.
        self.squash = (1.0, 1.0, 1.0)
        self.pivot = (0.0, 0.0, 0.0)
        self.spine = set()
        self.nodes = []
        self.radii = []
        self.edges = []
        self.verts = []
        self.faces = []
        self.slots = []

    def shape(self, squash, pivot=(0.0, 0.0, 0.0)):
        self.squash = squash
        self.pivot = pivot
        return self

    def shaped(self, i):
        """Node `i` where the finished GEOMETRY put it.

        `build` squashes the evaluated hull about a pivot, so the declared node
        and the mass grown around it are not in the same place on a part that
        was flattened. The rig has to follow the mesh, not the declaration, or a
        flattened abdomen gets a spine standing outside itself.
        """
        sq, pv = self.squash, self.pivot
        n = self.nodes[i]
        return Vector(tuple(pv[k] + (n[k] - pv[k]) * sq[k] for k in range(3)))

    # -- skeleton -----------------------------------------------------------

    def chain(self, points, radii, parent=None):
        """Add a run of skeleton nodes; returns their indices so the next chain
        can branch off one. `parent` welds the first node to an existing one,
        which is what makes a neck grow out of a shoulder instead of beside it."""
        first = len(self.nodes)
        self.nodes.extend(tuple(p) for p in points)
        self.radii.extend(radii)
        idx = list(range(first, first + len(points)))
        # The first chain a part declares is its spine — every species authors
        # the trunk before it branches a neck, a tail or a shoulder off it. The
        # walk cycle drives that run differently from what hangs off it.
        if first == 0:
            self.spine = set(idx)
        if parent is not None:
            self.edges.append((parent, idx[0]))
        for a, b in zip(idx, idx[1:]):
            self.edges.append((a, b))
        return idx

    # -- hard surfaces ------------------------------------------------------

    def add(self, geo, slot=HIDE):
        verts, faces = geo
        base = len(self.verts)
        self.verts.extend(verts)
        for f in faces:
            self.faces.append([i + base for i in f])
            self.slots.append(slot)
        return self

    # -- output -------------------------------------------------------------

    def build(self):
        """Everything this part is made of, in CREATURE space.

        Split out from `object()` because ambient occlusion has to see the whole
        creature at once: a shoulder is dark because of the arm in front of it,
        and the arm is a different object.
        """
        verts, faces, slots = [], [], []
        if self.edges:
            sv, sf = skinned(self.nodes, self.radii, self.edges, self.subdiv,
                             self.displace, self.crag, self.name + "_skin")
            verts.extend(sv)
            faces.extend(sf)
            slots.extend([HIDE] * len(sf))
        base = len(verts)
        verts.extend(self.verts)
        faces.extend([i + base for i in f] for f in self.faces)
        slots.extend(self.slots)
        sq, pv = self.squash, self.pivot
        verts = [tuple(pv[k] + (v[k] - pv[k]) * sq[k] for k in range(3)) for v in verts]
        return verts, faces, slots


def creature_mesh(name, built, shades, mats, tile):
    """Every part of one creature welded into a single skinnable mesh.

    Parts used to be separate objects because the runtime rotated each limb by
    itself. A skinned creature is ONE mesh: the bones move it now, and one mesh
    is one draw call per material instead of one per part.

    Also hands back, per vertex, which part it came from — the weighting needs
    that to forbid a leg the bones of its neighbour.
    """
    verts, faces, slots, owner, colours = [], [], [], [], []
    for pi, ((pv, pf, ps), shade) in enumerate(zip(built, shades)):
        base = len(verts)
        verts.extend(pv)
        faces.extend([i + base for i in f] for f in pf)
        slots.extend(ps)
        owner.extend([pi] * len(pv))
        colours.extend(shade if shade is not None else [1.0] * len(pv))

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    # `owner` and the baked occlusion are both indexed by vertex; validate() is
    # only supposed to drop polygons, and if it ever drops a vertex every weight
    # behind this point lands on the wrong bone.
    if len(me.vertices) != len(verts):
        sys.exit("%s: validate() changed the vertex count" % name)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for mat in mats:
        me.materials.append(mat)
    for poly, slot in zip(me.polygons, slots):
        poly.material_index = slot
    uv_box(obj, tile)

    layer = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    flat = numpy.ones(len(me.loops) * 4, dtype=numpy.float32)
    block = flat.reshape(-1, 4)
    for li, loop in enumerate(me.loops):
        block[li, :3] = colours[loop.vertex_index]
    layer.data.foreach_set("color", flat)

    smooth_by_angle(obj, SMOOTH_ANGLE)
    return obj, owner


def uv_box(obj, tile):
    """World-axis projection: each face takes the two axes it does not face.

    The hides are seamless swatches, so this is the whole of the UV work. `tile`
    is in world units per repeat, set per species so a whelp and a behemoth get
    the same grain size rather than the same number of repeats.
    """
    me = obj.data
    uvs = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        u_ax, v_ax = ((1, 2), (0, 2), (0, 1))[ax]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvs.data[li].uv = (co[u_ax] / tile, co[v_ax] / tile)


def smooth_by_angle(obj, degrees):
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
        if me.polygons[polys[0]].normal.dot(me.polygons[polys[1]].normal) < limit:
            keyed[key].use_edge_sharp = True
    me.update()


# --------------------------------------------------------------------------
# the rig: an armature off the same node graph, weights, and authored clips
# --------------------------------------------------------------------------

FPS = 30

# Stride as a fraction of leg length, how high the foot clears the floor as a
# fraction of that stride, and how much of the cycle a foot spends planted.
# Above 0.5 duty at least one foot of a pair is always down, which is a walk.
STRIDE_K = 0.78
LIFT_K = 0.26
DUTY = 0.62

# **These legs are authored straight, and a straight leg cannot take a step.**
# Every species declares its foot on the floor directly under a hip, so at rest
# the chain is already at full extension and any stride at all puts the target
# past the end of the shin. The solve then hands back a foot short of where it
# was asked for — measured at 14% to 72% of shin length across the roster, which
# is a creature walking with its feet in the air and is invisible in a still.
#
# Two things buy the slack back. The trunk drops by `CROUCH_K` of leg length for
# the whole walk, which is what an animal does anyway and bends the knee into a
# pose that can extend. Then each leg's stride is capped at what it can actually
# reach from there, PER LEG: a splayed foreleg reaching forward has less room
# than a stub behind it, the clip is in place so no two feet have to agree, and
# one shared stride would be the shortest of them for everybody.
CROUCH_K = 0.075
# Never quite straight. A locked knee at the end of the stride is the robot.
REACH_MAX = 0.97
# How far a foot's stance may slide back under its hip to buy a stride, as a
# fraction of that leg's length. See the stance centre in `Gait.__init__`.
STANCE_SHIFT = 0.25

# **The cycle is timed off the creature, not off its move speed.** Step
# frequency in real animals goes as 1/sqrt(leg length), and this roster spans
# 0.85 to 3.1 units of height: timing every clip to plant its feet exactly at
# the def's move speed gives the imp a seven-hertz scrabble, because a 0.44-unit
# leg covering 2.4 units/s genuinely has to. So the cadence is chosen to READ,
# the stride is chosen to read, and the residual foot slide is accepted — it is
# a few centimetres per step on a camera that sees the creature from 19 units up
# and is the same trade every ARPG makes. `WALK_SPEED` in `monsters.ts` is the
# speed at which the runtime plays these back unscaled.
CYCLE_AT = 24.0        # frames for a 1.2-unit creature
CYCLE_RANGE = (16, 40)

# Skin influences per vertex: the glTF export budget and Babylon's default.
INFLUENCES = 4
# How sharply a vertex prefers the nearest bone. Soft smears a shin into the
# flank; hard creases the knee.
WEIGHT_POWER = 4.0
# A body vertex may follow the limb nearest it, but never as strongly as that
# limb's own geometry does. This is the haunch that moves with the leg, and
# without it the hip is a hard seam that opens as the leg swings.
CROSS_PART = 0.55

# How far the trunk travels, as fractions of the creature's height.
BOB = 0.016
SWAY = 0.010

# --- the strike -----------------------------------------------------------
# A lunge, not a limb waved in front of a still body: the feet stay where they
# are standing (the leg IK is solved against a MOVING hip, so a trunk driven
# forward bends the knees by itself) and the whole animal travels. That is why
# nothing here touches `foot_offset` — a strike that stepped would slide.
#
# Timed in three parts over the clip: coil back, drive through, settle. The
# drive is deliberately the shortest of the three; an attack that takes as long
# to land as it does to wind up reads as a stretch, not a hit.
ATTACK_FRAMES = 15          # half a second at 30 fps
ATTACK_COIL = 0.34          # fraction of the clip spent winding up
ATTACK_HIT = 0.52           # where the blow lands
# Travel and dip at full extension, as fractions of the creature's height, plus
# how far it rocks back in the coil (a fraction of the lunge).
LUNGE = 0.13
LUNGE_DIP = 0.05
COIL_BACK = 0.45
# Radians at the hit: the spine folds over the blow, everything hanging off it
# whips harder, and an arm that has one swings through.
STRIKE_SPINE = 0.30
STRIKE_SECONDARY = 0.42
STRIKE_ARM = 1.15
# Radians. The spine's own bend, and what a neck or a tail hanging off it adds.
SPINE_SWING = 0.055
SECONDARY_SWING = 0.085
ARM_SWING = 0.16


def seg_distance(p, a, b):
    """Distance from a point to a bone, treated as the segment head->tail."""
    ab = b - a
    denom = ab.dot(ab)
    t = 0.0 if denom < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return (p - (a + ab * t)).length


class Bone:
    __slots__ = ("name", "head", "tail", "parent", "part", "spine", "depth")

    def __init__(self, name, head, tail, parent, part, spine):
        self.name = name
        self.head = head
        self.tail = tail
        self.parent = parent
        self.part = part
        self.spine = spine
        self.depth = 0


def bone_graph(parts):
    """One bone per skeleton edge, parents always before children.

    There is no second authoring pass here and there must never be one: the node
    graph the hulls were grown from is already a tree — a chain either starts a
    part or is welded to exactly one existing node — so the skeleton the player
    sees and the skeleton that moves it are the same declaration. A limb hangs
    off whichever BODY bone passes nearest its first node, which is what puts a
    leg on the haunch above it instead of on the neck.
    """
    bones = []
    body = []
    for pi, part in enumerate(parts):
        ends = {}
        for k, (a, b) in enumerate(part.edges):
            head, tail = part.shaped(a), part.shaped(b)
            # A zero-length bone is deleted by Blender on leaving edit mode, and
            # takes its children with it.
            if (tail - head).length < 1e-4:
                continue
            parent = ends.get(a)
            if parent is None and pi > 0 and body:
                parent = min(body, key=lambda nb: seg_distance(head, nb.head, nb.tail)).name
            bone = Bone("%s_%d" % (part.name, k), head, tail, parent,
                        pi, a in part.spine and b in part.spine)
            bones.append(bone)
            if pi == 0:
                body.append(bone)
            ends[b] = bone.name

    by_name = {b.name: b for b in bones}
    for bone in bones:
        parent = by_name.get(bone.parent) if bone.parent else None
        bone.depth = 0 if parent is None else parent.depth + 1
    return bones


def make_armature(name, bones):
    """Edit bones are the one thing with no data API, so this is the operator."""
    armd = bpy.data.armatures.new(name + "_rig")
    arm = bpy.data.objects.new(name, armd)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in bones:
        eb = armd.edit_bones.new(bone.name)
        eb.head, eb.tail = bone.head, bone.tail
        if bone.parent:
            eb.parent = armd.edit_bones[bone.parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(False)
    missing = [b.name for b in bones if b.name not in armd.bones]
    if missing:
        sys.exit("armature %s dropped bones: %s" % (name, missing))
    return arm


def skin(obj, bones, owner, height):
    """Weight every vertex by distance to the bones its own part may use.

    Automatic (bone-heat) weights are not used, and not because they are hard to
    call: these meshes are a welded hull plus loose horns, slabs and eyes, and
    heat weighting has no solution for a vertex on a floating tusk. Distance to
    the bone SEGMENT is well defined for all of it, deterministic, and reviewable
    — and because `owner` says which part each vertex came from, a vertex can be
    forbidden the bones of a limb it does not belong to, which is what stops the
    left leg from dragging the right one.
    """
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in bones}
    by_part = {}
    for bone in bones:
        by_part.setdefault(bone.part, []).append(bone)

    # What each part is allowed to be moved by, and how strongly.
    allowed = {}
    for pi, own in by_part.items():
        if pi == 0:
            # The trunk: its own bones, plus the root bone of every limb, so the
            # shoulder and the haunch travel with the limb they carry.
            near = [(b, CROSS_PART) for p, bs in by_part.items() if p > 0 for b in bs[:1]]
            allowed[pi] = [(b, 1.0) for b in own] + near
        else:
            parent = own[0].parent
            up = [(b, CROSS_PART) for b in by_part[0] if b.name == parent]
            allowed[pi] = [(b, 1.0) for b in own] + up

    eps = 0.045 * height
    buckets = {}
    for vi, vert in enumerate(obj.data.vertices):
        co = vert.co
        scored = sorted(
            ((mul / (seg_distance(co, b.head, b.tail) + eps) ** WEIGHT_POWER, b.name)
             for b, mul in allowed[owner[vi]]),
            reverse=True,
        )[:INFLUENCES]
        total = sum(w for w, _ in scored) or 1.0
        for weight, name in scored:
            # Quantised into 1/256 buckets so one `add` call carries hundreds of
            # vertices: per-vertex calls are 240k round trips through RNA, and
            # the rounding is far below what a byte-normalised glTF weight keeps.
            buckets.setdefault((name, round(weight / total * 256)), []).append(vi)
    for (name, step), indices in buckets.items():
        if step:
            groups[name].add(indices, step / 256.0, "REPLACE")

    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = obj.parent
    mod.use_vertex_groups = True


class Poser:
    """Writes an armature-space pose onto the bones as local basis rotations.

    Blender will do this itself through `pose.bone.matrix`, but only one bone at
    a time and only with a dependency-graph update between each, which is tens of
    thousands of round trips for this file. The relation is
    `matrix = parent_pose @ rest_local @ basis`, so with the parents walked first
    the basis is one inverse per bone and no evaluation at all.
    """

    def __init__(self, arm, bones):
        self.arm = arm
        self.rest = {b.name: arm.data.bones[b.name].matrix_local.copy() for b in bones}
        self.parent = {b.name: b.parent for b in bones}
        self.order = [b.name for b in bones]

    def apply(self, dir_for, offset_for):
        posed = {}
        moved = []
        for name in self.order:
            parent = self.parent[name]
            ppose = posed[parent] if parent else Matrix.Identity(4)
            prest = self.rest[parent] if parent else Matrix.Identity(4)
            default = ppose @ prest.inverted() @ self.rest[name]
            head = default.translation.copy()
            offset = offset_for(name)
            if offset is not None:
                head = head + offset
            rot = default.to_3x3()
            aim = dir_for(name, head, posed)
            if isinstance(aim, Matrix):
                # A whole rotation off rest, not a direction: no twist inherited.
                rot = aim @ self.rest[name].to_3x3()
            elif aim is not None and aim.length_squared > 1e-12:
                current = (rot @ Vector((0.0, 1.0, 0.0))).normalized()
                rot = current.rotation_difference(aim.normalized()).to_matrix() @ rot
            mat = Matrix.Translation(head) @ rot.to_4x4()
            posed[name] = mat
            basis = default.inverted() @ mat
            pb = self.arm.pose.bones[name]
            pb.rotation_quaternion = basis.to_quaternion()
            if offset is not None:
                pb.location = basis.translation
                moved.append(name)
        return moved


def solve_ik(hip, target, rest, lengths):
    """Two-bone IK: where the knee goes so the ankle lands on `target`.

    The bend plane comes from the REST pose — each species authored its own knee
    bow with `bend`, and a generic pole vector would throw that away and bend
    every creature's knee the same way.
    """
    l1, l2 = lengths
    to = target - hip
    reach = to.length
    if reach < 1e-6:
        return hip + Vector((0.0, 0.0, l1)), Vector((0.0, 0.0, 1.0))
    span = to / reach
    reach = max(min(reach, l1 + l2 - 1e-4), abs(l1 - l2) + 1e-4)

    axis = (rest[2] - rest[0])
    pole = (rest[1] - rest[0])
    if axis.length_squared > 1e-12:
        pole = pole - axis.normalized() * pole.dot(axis.normalized())
    pole = pole - span * pole.dot(span)
    if pole.length_squared < 1e-12:
        # A straight rest leg has no bow to preserve; break it forward.
        pole = Vector((0.0, 1.0, 0.0)) - span * span.y
        if pole.length_squared < 1e-12:
            pole = Vector((1.0, 0.0, 0.0)) - span * span.x
    pole.normalize()

    cos_a = (reach * reach + l1 * l1 - l2 * l2) / (2.0 * reach * l1)
    angle = math.acos(max(-1.0, min(1.0, cos_a)))
    upper = (span * math.cos(angle) + pole * math.sin(angle)).normalized()
    return hip + upper * l1, upper


def foot_offset(phase, stride, lift):
    """Where a foot is, relative to where it stands, at this point in the cycle.

    Stance is a straight sweep backwards along the ground — that is the plant,
    and it is the whole difference between a walk and a leg waved in the air.
    """
    phase = phase % 1.0
    if phase < DUTY:
        u = phase / DUTY
        return Vector((0.0, stride * (0.5 - u), 0.0))
    u = (phase - DUTY) / (1.0 - DUTY)
    return Vector((0.0, stride * (u - 0.5), lift * math.sin(math.pi * u)))


class Gait:
    """Everything one creature's clips need to know about its own legs."""

    def __init__(self, creature, bones):
        self.height = creature.height
        by_part = {}
        for bone in bones:
            by_part.setdefault(bone.part, []).append(bone)
        parts = [creature.body] + creature.limbs

        self.legs = []
        self.arms = []
        for pi, part in enumerate(parts):
            chain = by_part.get(pi)
            if pi == 0 or not chain or len(chain) < 2:
                continue
            nodes = [part.shaped(i) for i in range(len(part.nodes))]
            entry = {
                "bones": chain,
                "rest": nodes,
                "lengths": ((nodes[1] - nodes[0]).length, (nodes[2] - nodes[1]).length),
            }
            if part.name.startswith("leg"):
                self.legs.append(entry)
            elif part.name.startswith("arm"):
                self.arms.append(entry)

        # Legs are authored front pair first, so this puts front-left with
        # back-right (a trot), turns six legs into an alternating tripod, and
        # splits a biped's two. It is the same rule the primitive imp walked on.
        for i, leg in enumerate(self.legs):
            leg["phase"] = 0.0 if ((i % 2) + (i // 2)) % 2 == 0 else 0.5

        lengths = [(l["rest"][0] - l["rest"][-1]).length for l in self.legs]
        self.leg_length = sum(lengths) / len(lengths) if lengths else self.height * 0.4
        self.crouch = CROUCH_K * self.leg_length
        for leg, span in zip(self.legs, lengths):
            # How far this foot may travel before the shin runs out. Solving
            # |rest + (0, s, 0) - crouched hip| = REACH_MAX * (l1 + l2) for s.
            offset = leg["rest"][2] - leg["rest"][0]
            reach = REACH_MAX * sum(leg["lengths"])
            drop = offset.z + self.crouch
            room = reach * reach - offset.x * offset.x - drop * drop
            arc = math.sqrt(room) if room > 0.0 else 0.0
            want = creature.stride_k * span / 2.0
            # **The stance centre is not automatically where the foot was
            # sculpted.** A foreleg authored planted well ahead of its hip has
            # already spent most of the reach budget on that pose, and taking
            # `arc - |offset.y|` as the room left to step in hands such a leg
            # almost nothing: measured, the husk's forelimbs swung 0.04 units
            # while its hind stubs did all the walking, which is a creature
            # dragging two frozen poles. So the foot steps about a centre slid
            # back under the hip, by as much as the stride needs and no more —
            # a leg with room keeps the stance it was sculpted with — and never
            # further than `STANCE_SHIFT` of its own length, because past that
            # the silhouette stops being the one that was modelled.
            slack = max(arc - want, 0.0)
            limit = STANCE_SHIFT * span
            centre = max(-slack, min(offset.y, slack))
            centre = max(offset.y - limit, min(centre, offset.y + limit))
            leg["shift"] = centre - offset.y
            leg["stride"] = 2.0 * max(0.0, min(want, arc - abs(centre)))
            leg["lift"] = LIFT_K * leg["stride"]
        # The shortest step any of this creature's legs takes, against its own
        # leg. A limb near zero here is planted for the whole cycle while the
        # others walk, and nothing downstream — not a still, not a test — says so.
        self.stride_ratio = min((l["stride"] / s for l, s in zip(self.legs, lengths)),
                                default=0.0)
        self.body_bones = by_part.get(0, [])
        self.root = self.body_bones[0].name if self.body_bones else None
        # A two-legged creature rolls over the planted foot; a six-legged one
        # barely rocks at all.
        self.sway = SWAY * self.height * (1.0 if len(self.legs) <= 2 else 0.35)
        self.reach_error = 0.0

    def frames(self):
        """Cadence from the creature's own size — see `CYCLE_AT`."""
        n = CYCLE_AT * math.sqrt(max(self.height, 0.2) / 1.2)
        return int(max(CYCLE_RANGE[0], min(CYCLE_RANGE[1], round(n))))

    def pose(self, poser, t, moving):
        """Pose the whole creature at normalised cycle position `t`."""
        turn = 2.0 * math.pi * t
        bob = BOB * self.height * (math.sin(2.0 * turn) if moving else math.sin(turn) * 0.35)
        sway = self.sway * math.sin(turn) if moving else 0.0
        offset = Vector((sway, 0.0, bob - (self.crouch if moving else 0.0)))
        swing = 1.0 if moving else 0.28

        solved = {}
        for leg in self.legs:
            solved[leg["bones"][0].name] = leg

        def offset_for(name):
            return offset if name == self.root else None

        def dir_for(name, head, posed):
            leg = solved.get(name)
            if leg is not None:
                self._solve_leg(leg, head, t, moving, posed)
            cached = self._dirs.get(name)
            if cached is not None:
                return cached
            return self._body_dir(name, turn, swing)

        # `_solve_leg` fills the whole chain when the poser reaches its hip, so
        # the shin and the foot are read back out of here behind it.
        self._dirs = {}
        for i, arm in enumerate(self.arms):
            phase = turn + (math.pi if i % 2 == 0 else 0.0)
            for k, bone in enumerate(arm["bones"]):
                rest = (bone.tail - bone.head).normalized()
                amp = ARM_SWING * swing * (1.0 if k == 0 else 0.45)
                self._dirs[bone.name] = Matrix.Rotation(amp * math.sin(phase), 3, "X") @ rest
        return poser.apply(dir_for, offset_for)

    def strike_envelope(self, t):
        """How far through the blow at normalised clip position `t`.

        -1 at the deepest coil, +1 at full extension, 0 at rest. One curve
        drives the trunk, the spine and the arms, so the whole animal commits
        to the same beat instead of three parts arriving separately.
        """
        if t < ATTACK_COIL:
            # Ease into the coil and hold it a moment: the pause is what makes
            # the drive read as released rather than as constant motion.
            return -COIL_BACK * math.sin(math.pi * 0.5 * (t / ATTACK_COIL))
        if t < ATTACK_HIT:
            u = (t - ATTACK_COIL) / (ATTACK_HIT - ATTACK_COIL)
            # Accelerating out of the coil, arriving at full reach.
            return -COIL_BACK * math.cos(math.pi * 0.5 * u) + math.sin(math.pi * 0.5 * u)
        u = (t - ATTACK_HIT) / (1.0 - ATTACK_HIT)
        # Settle back, overshooting slightly under the rest line so the body
        # absorbs the blow instead of snapping to attention.
        return math.cos(math.pi * 0.5 * u) - 0.12 * math.sin(math.pi * u)

    def strike(self, poser, t):
        """Pose the creature mid-attack at normalised clip position `t`.

        The legs are solved in their standing stance, so driving the trunk
        forward bends the knees and the feet stay planted — a lunge. Nothing
        here uses the walk's foot offsets.
        """
        e = self.strike_envelope(t)
        offset = Vector((0.0,
                         LUNGE * self.height * e,
                         -LUNGE_DIP * self.height * max(0.0, e) - self.crouch * 0.5))

        solved = {}
        for leg in self.legs:
            solved[leg["bones"][0].name] = leg

        def offset_for(name):
            return offset if name == self.root else None

        def dir_for(name, head, posed):
            leg = solved.get(name)
            if leg is not None:
                self._solve_leg(leg, head, 0.0, False, posed)
            cached = self._dirs.get(name)
            if cached is not None:
                return cached
            return self._strike_dir(name, e)

        self._dirs = {}
        for arm in self.arms:
            # Both arms swing together: this is a strike, not a stride.
            for k, bone in enumerate(arm["bones"]):
                rest = (bone.tail - bone.head).normalized()
                amp = STRIKE_ARM * (1.0 if k == 0 else 0.5)
                # Same sign as the walk's arm swing: positive is forward. The
                # negative read as raising both arms overhead at the hit, which
                # is a salute, not a claw going through something.
                self._dirs[bone.name] = Matrix.Rotation(amp * e, 3, "X") @ rest
        return poser.apply(dir_for, offset_for)

    def _strike_dir(self, name, e):
        bone = next((b for b in self.body_bones if b.name == name), None)
        if bone is None:
            return None
        rest = (bone.tail - bone.head).normalized()
        # Fold over the blow around X (the pitch axis), unlike the walk's Z
        # yaw: an animal biting leads with its head, it does not turn away.
        amp = (STRIKE_SPINE if bone.spine else STRIKE_SECONDARY) * (0.5 + 0.5 * bone.depth)
        return Matrix.Rotation(-amp * e, 3, "X") @ rest

    def _solve_leg(self, leg, hip, t, moving, posed):
        bones, rest = leg["bones"], leg["rest"]
        # The stance shift rides with the crouch: both are walk posture, and a
        # foot that stood in one place through the idle would slide into the
        # step otherwise.
        delta = (Vector((0.0, leg["shift"], 0.0))
                 + foot_offset(t + leg["phase"], leg["stride"], leg["lift"])
                 if moving else Vector())
        ankle = rest[2] + delta
        knee, upper = solve_ik(hip, ankle, rest, leg["lengths"])
        # A leg that cannot reach its target is a foot hanging in the air or
        # skating along the ground, and neither is visible in a still. The shin
        # is a fixed length, so how far the solve had to stretch it — as a
        # fraction of the shin — is exactly the gap between foot and floor.
        stretch = (ankle - knee).length / max(leg["lengths"][1], 1e-6) - 1.0
        self.reach_error = max(self.reach_error, stretch)
        self._dirs[bones[0].name] = upper
        self._dirs[bones[1].name] = (ankle - knee).normalized()
        if len(bones) > 2 and len(rest) > 3:
            # The foot keeps its rest angle to the ground and rolls at push-off,
            # which is the difference between a step and a stamp. Standing, it
            # is planted: no push-off, no roll.
            angle = -0.30 * math.sin(2.0 * math.pi * (t + leg["phase"])) if moving else 0.0
            # The whole rotation, not an aim: an aim lets the shin twist the paw.
            self._dirs[bones[2].name] = Matrix.Rotation(angle, 3, "X")
            for bone in bones[3:]:
                self._dirs[bone.name] = (bone.tail - bone.head).normalized()

    def _body_dir(self, name, turn, swing):
        bone = next((b for b in self.body_bones if b.name == name), None)
        if bone is None:
            return None
        rest = (bone.tail - bone.head).normalized()
        if bone.spine:
            angle = SPINE_SWING * swing * math.sin(turn - bone.depth * 0.35)
            return Matrix.Rotation(angle, 3, "Z") @ rest
        # A neck, a tail, a horn: it lags what carries it, and the further out
        # it hangs the more it lags.
        lag = 0.55 + 0.35 * bone.depth
        angle = SECONDARY_SWING * swing * min(1.0, 0.4 + 0.25 * bone.depth)
        return (Matrix.Rotation(angle * math.sin(turn - lag), 3, "Z")
                @ Matrix.Rotation(angle * 0.6 * math.sin(2.0 * turn - lag), 3, "X") @ rest)


def author_clips(arm, gait, bones):
    """Write `walk`, `idle` and `attack` onto the armature as NLA tracks.

    One track per clip, named `<species>|<clip>`, because the glTF exporter's
    ACTIONS mode offers every action to every armature in the file and would
    give all seventeen creatures every clip. NLA_TRACKS exports each track
    once, on the armature that owns it, under the track's own name.

    `attack` is the one clip that does NOT loop: the runtime plays it once on
    the sim's swing and hands the body back to locomotion, so its last frame
    still repeats the first — a strike that ended mid-lunge would pop.
    """
    poser = Poser(arm, bones)
    arm.animation_data_create()
    walk = gait.frames()
    # Idle is authored over the same frame count as the walk and played back
    # slow (`IDLE_RATIO` in `monsters.ts`). A breath is one long sine — sampling
    # it three times as densely only costs the download.
    for clip, length, moving in (("walk", walk, True), ("idle", walk, False),
                                 ("attack", ATTACK_FRAMES, None)):
        action = bpy.data.actions.new("%s|%s" % (arm.name, clip))
        action.use_fake_user = True
        slot = action.slots.new("OBJECT", arm.name)
        strip_layer = action.layers.new("base")
        strip_layer.strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
        arm.animation_data.action = action
        arm.animation_data.action_slot = slot

        for frame in range(length + 1):
            # The last frame repeats the first, so the loop has no seam.
            phase = (frame % length) / length
            moved = (gait.strike(poser, phase) if moving is None
                     else gait.pose(poser, phase, moving))
            for bone in bones:
                arm.pose.bones[bone.name].keyframe_insert(
                    "rotation_quaternion", frame=frame + 1)
            for name in moved:
                arm.pose.bones[name].keyframe_insert("location", frame=frame + 1)

        track = arm.animation_data.nla_tracks.new()
        track.name = action.name
        nla = track.strips.new(action.name, 1, action)
        if hasattr(nla, "action_slot"):
            nla.action_slot = slot
        arm.animation_data.action = None


class Creature:
    """One species: a named root, a body, and limbs that swing."""

    def __init__(self, def_id, family, tile, height, subdiv=2):
        # The ARMATURE is the creature root and carries the def id, so the name
        # the runtime looks a species up by is unchanged from when the root was
        # an empty. It is built in `emit`, once the bones are known.
        self.def_id = def_id
        self.root = None
        self.family = family
        self.tile = tile
        self.subdiv = subdiv
        self.height = height
        # Both crag knobs are fractions of the creature's own height, so a whelp
        # and a boss get the same relief rather than the same millimetres.
        self.displace = height * 0.035
        self.crag = height * 0.10
        self.body = Part("body", subdiv=subdiv, displace=self.displace, crag=self.crag)
        self.limbs = []
        # Stride as a fraction of leg span; a splayed six-legged body takes short steps.
        self.stride_k = STRIDE_K

    def limb(self, name, origin):
        # Limbs displace half as hard as the trunk: a crag across a 6cm shin is
        # a broken bone, not a texture.
        part = Part(name, origin, subdiv=self.subdiv,
                    displace=self.displace * 0.5, crag=self.crag * 0.6)
        self.limbs.append(part)
        return part

    def leg(self, index, hip, foot, r_hip, r_foot, bend=0.0, pad=True):
        """Hip, knee, ankle, toe — four nodes, so there are three bones in it.

        `foot` is where the limb MEETS THE FLOOR, which is what every species
        declares. The ankle is lifted off that point and the toe pushed forward
        of it, so the chain ends in a foot rather than in a stump: a leg whose
        last joint is the contact point can only pivot about the floor, which is
        the pendulum every one of these walked with before.

        The pad is not decoration either: it is the sole, and without it the
        contact is a tapering tube and the creature reads as hovering.
        """
        length = max(abs(hip[2] - foot[2]), 1e-4)
        # High enough to be a joint, never so high the shin looks amputated.
        ankle_h = max(0.075 * length, r_foot * LEG_TRIM * 1.4)
        ankle = (foot[0], foot[1], foot[2] + ankle_h)
        toe = (foot[0], foot[1] + ankle_h * 1.5, foot[2] + ankle_h * 0.18)
        knee = [(hip[k] + ankle[k]) / 2 for k in range(3)]
        knee[1] += bend
        r_hip *= LEG_TRIM
        r_foot *= LEG_TRIM
        sole = r_foot * PAD_K
        part = self.limb(f"leg{index}", hip)
        part.chain([hip, tuple(knee), ankle, toe],
                   [r_hip, r_hip * KNEE_K, r_foot * ANKLE_K, r_foot * TOE_K])
        if pad:
            part.add(ellipsoid((foot[0], foot[1] + ankle_h * 0.7, foot[2] + sole * 0.32),
                               (sole * 0.72, ankle_h * 1.5, sole * 0.42), 8, 5))
        return part

    def arm(self, index, points, radii):
        part = self.limb(f"arm{index}", points[0])
        part.chain(points, radii)
        return part

    def emit(self, mats):
        slots = [mats[f"hide_{self.family}"], mats[f"glow_{self.family}"], mats["bone"]]
        parts = [self.body] + self.limbs
        built = [p.build() for p in parts]
        ao = bake_ao(built, self.height * AO_REACH)

        bones = bone_graph(parts)
        arm = make_armature(self.def_id, bones)
        # Every creature is authored facing +Y, and two axis conversions stand
        # between here and the game: Blender Z-up to glTF Y-up, then glTF
        # right-handed to Babylon left-handed. The renderer turns an actor to
        # `atan2(dx, dz)` because "the meshes are authored facing +z", and +Y
        # here lands on -z there — which ships a roster that runs backwards.
        # Turned once, at the root, exactly as the stash chest is in build_props.py.
        arm.rotation_euler = (0.0, 0.0, math.pi)
        self.root = arm

        mesh, owner = creature_mesh(self.def_id + ".mesh", built, ao, slots, self.tile)
        mesh.parent = arm
        skin(mesh, bones, owner, self.height)
        gait = Gait(self, bones)
        author_clips(arm, gait, bones)
        print("  bones %d verts %d legs %d cycle %d frames reach %+.1f%% stride %.2f"
              % (len(bones), len(mesh.data.vertices), len(gait.legs), gait.frames(),
                 gait.reach_error * 100.0, gait.stride_ratio))
        return arm


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------

def normal_from(img, dst):
    """Tangent-space normal from luminance-as-height, wrapping at the edges so
    it tiles as cleanly as the colour it came from. Lifted from
    `tools/build_tileset_textures.py`, which does this to the biome plates for
    exactly the same reason."""
    w, h = img.size
    px = numpy.empty(w * h * 4, dtype=numpy.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(h, w, 4)[:, :, :3]
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    dx = (numpy.roll(lum, -1, axis=1) - numpy.roll(lum, 1, axis=1)) * 0.5
    dy = (numpy.roll(lum, -1, axis=0) - numpy.roll(lum, 1, axis=0)) * 0.5
    nx = -dx * NORMAL_STRENGTH
    ny = -dy * NORMAL_STRENGTH
    nz = numpy.ones_like(nx)
    length = numpy.sqrt(nx * nx + ny * ny + nz * nz)
    out = numpy.stack([nx / length, ny / length, nz / length], axis=-1) * 0.5 + 0.5

    norm = bpy.data.images.new(os.path.basename(dst), w, h, alpha=False)
    flat = numpy.empty(w * h * 4, dtype=numpy.float32)
    flat.reshape(h, w, 4)[:, :, :3] = out
    flat.reshape(h, w, 4)[:, :, 3] = 1.0
    norm.pixels.foreach_set(flat)
    norm.file_format = "JPEG"
    norm.save(filepath=dst, quality=92)
    bpy.data.images.remove(norm)
    return dst


def srgb_luma(img):
    """Mean Rec.601 luma of an image in 0..255 sRGB.

    Deliberately the number `PIL.Image.convert("L")` would report, because the
    floor values in `FLOOR_LUMA` were measured that way against a pipeline that
    lives in another script: two measurements only mean something together if
    they are the same measurement.

    **`pixels` on an 8-bit sRGB image hands back the ENCODED bytes as floats,
    not scene-linear** — applying the transfer function here as well reported the
    cinder sheet at 106 where it measures 40, and every hide was tinted five
    times too dark. Checked against PIL, not against the manual.
    """
    buf = numpy.empty(len(img.pixels), dtype=numpy.float32)
    img.pixels.foreach_get(buf)
    rgb = numpy.clip(buf.reshape(-1, 4)[:, :3], 0.0, 1.0)
    return float((rgb @ numpy.array([0.299, 0.587, 0.114], dtype=numpy.float32)).mean() * 255.0)


def hide_gain(img, target):
    """The tint that lands a sheet's mean luma on `target` after the runtime's
    linear multiply, measured texel by texel: (target / mean) ** 2.2 misses a
    high-contrast sheet by up to a fifth. Down only, never up. Every texel
    counts, as in `srgb_luma`, so a sheet that rule leaves alone stays alone."""
    buf = numpy.empty(len(img.pixels), dtype=numpy.float32)
    img.pixels.foreach_get(buf)
    rgb = numpy.clip(buf.reshape(-1, 4)[:, :3], 0.0, 1.0)
    lin = numpy.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    weights = numpy.array([0.299, 0.587, 0.114], dtype=numpy.float32)

    def luma(gain):
        c = lin * gain
        enc = numpy.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
        return float((enc @ weights).mean() * 255.0)

    if luma(1.0) <= target:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if luma(mid) < target else (lo, mid)
    return (lo + hi) / 2


def prepare_textures():
    """Downscale, re-encode, and derive a normal map for each hide sheet."""
    os.makedirs(BUILD_DIR, exist_ok=True)
    settings = bpy.context.scene.render.image_settings
    settings.file_format = "JPEG"
    settings.quality = TEX_QUALITY
    settings.color_mode = "RGB"
    # Save the texels, not a photograph of them — the default view transform is a
    # film curve and pulls every master a stop darker.
    bpy.context.scene.view_settings.view_transform = "Standard"
    out = {}
    for name, path in TEXTURES.items():
        if not os.path.exists(path):
            sys.exit("missing hide sheet: " + path)
        img = bpy.data.images.load(path)
        img.scale(TEX_SIZE, TEX_SIZE)
        colour = os.path.join(BUILD_DIR, name + ".jpg")
        img.save_render(filepath=colour, scene=bpy.context.scene)
        normal = normal_from(img, os.path.join(BUILD_DIR, name + "_n.jpg"))
        # The sheet is tinted DOWN to the target, never up: a hide already dark
        # enough is left alone rather than lifted to meet a number.
        luma = srgb_luma(img)
        gain = hide_gain(img, max(HIDE_FLOOR, FLOOR_LUMA[name] * HIDE_RATIO))
        print("  hide %-7s luma %5.1f floor %5.1f tint %.3f" % (name, luma, FLOOR_LUMA[name], gain))
        bpy.data.images.remove(img)
        out[name] = (colour, normal, gain)
    return out


def hide_material(name, colour, normal, tint):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(colour)
    shade = tex.outputs["Color"]
    if tint != (1.0, 1.0, 1.0):
        # The Mix node, not legacy MixRGB: only this one does the exporter turn
        # into baseColorFactor. MixRGB exported the raw sheet with no tint at all.
        mix = tree.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (*tint, 1.0)
        tree.links.new(mix.inputs[6], tex.outputs["Color"])
        shade = mix.outputs[2]
    tree.links.new(bsdf.inputs["Base Color"], shade)
    # Emission follows the tint. Left on the raw sheet it re-adds a slice of the
    # brightness the tint just took off, which is the one thing this pass is for.
    tree.links.new(bsdf.inputs["Emission Color"], shade)
    bsdf.inputs["Emission Strength"].default_value = EMISSION

    if normal is not None:
        ntex = tree.nodes.new("ShaderNodeTexImage")
        ntex.image = bpy.data.images.load(normal)
        ntex.image.colorspace_settings.name = "Non-Color"
        nmap = tree.nodes.new("ShaderNodeNormalMap")
        tree.links.new(nmap.inputs["Color"], ntex.outputs["Color"])
        tree.links.new(bsdf.inputs["Normal"], nmap.outputs["Normal"])

    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.78
    return mat


def glow_material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Strength"].default_value = GLOW_EMISSION
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.4
    return mat


def flat_material(name, rgb, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Strength"].default_value = EMISSION
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def build_materials():
    built = prepare_textures()
    mats = {"bone": flat_material("bone", BONE, 0.6)}
    for family, (colour, normal, gain) in built.items():
        mats[f"hide_{family}"] = hide_material(
            f"hide_{family}", colour, normal, (gain, gain, gain)
        )
        mats[f"glow_{family}"] = glow_material(f"glow_{family}", GLOW[family])
        # The bosses wear their family's hide darkened, so the biggest thing in
        # the room is the darkest: a boss lit like its trash is a large imp.
        mats[f"hide_{family}_boss"] = hide_material(
            f"hide_{family}_boss", colour, normal,
            (gain * 0.55, gain * 0.52, gain * 0.52)
        )
        mats[f"glow_{family}_boss"] = mats[f"glow_{family}"]
    return mats


# --------------------------------------------------------------------------
# the swarm: small, low, four-to-six legged, dies in threes
# --------------------------------------------------------------------------

IMP_SOURCE = os.path.join(TEX_DIR, "source", "cinder_imp_v3.glb")
IMP_NORMAL = os.path.join(TEX_DIR, "source", "cinder_imp_v3_n.png")


def cinder_imp():
    """A crouched lump of black lava rock split by glowing cracks, horns swept
    back, a tail that curls up into a burning ball. The one everybody meets.

    Generated (review/3d/cinder-imp-v2, TRELLIS seed 7), volumetric opening res
    240 r 2 band 8, 4k triangles. TRELLIS stood it nose-down, so the rebuild
    levelled it (reshape_generated.py --pitch -7). Height 0.7, not 0.85: the body
    is half again as wide. Joints measured off cinder_imp_v3.glb by
    tools/measure_generated.py --flip 1.
    """
    c = GeneratedSkin("monster.cinder_imp.v1", IMP_SOURCE, IMP_NORMAL,
                      "cinder", 0.7, (0.007, -0.164), tex=512, flip=True)
    spine = c.body.chain([(0, -0.25, 0.40), (0, -0.02, 0.42), (0, 0.18, 0.38)], [0.1] * 3)
    # The head hangs low in front of the shoulders.
    c.body.chain([(0, 0.30, 0.32), (0, 0.42, 0.25)], [0.1] * 2, parent=spine[-1])
    c.body.chain([(0, -0.40, 0.42), (0, -0.55, 0.52), (0, -0.70, 0.58)],
                 [0.05] * 3, parent=spine[0])
    for i, (hip, knee, foot) in enumerate([
        ((-0.168, 0.175, 0.287), (-0.325, 0.237, 0.119), (-0.281, 0.364, 0.000)),
        ((0.155, 0.190, 0.286), (0.306, 0.206, 0.174), (0.297, 0.346, 0.000)),
        ((-0.133, -0.298, 0.304), (-0.269, -0.420, 0.170), (-0.406, -0.385, 0.010)),
        ((0.137, -0.324, 0.316), (0.285, -0.423, 0.115), (0.391, -0.325, 0.011)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


HUSK_SOURCE = os.path.join(TEX_DIR, "source", "vaal_husk_v2.glb")
HUSK_NORMAL = os.path.join(TEX_DIR, "source", "vaal_husk_v2_n.png")


def vaal_husk():
    """A segmented stone shell with one green eye, arched over two long fists.

    Generated (review/3d/vaal-husk-v2), volumetric opening (tools/open_volume.py
    --res 240 --radius 2), 4k triangles. Feet measured off vaal_husk_v2.glb as
    loaded with --flip 1; the rest by hand, see below.
    """
    c = GeneratedSkin("monster.vaal_husk.v1", HUSK_SOURCE, HUSK_NORMAL,
                      "vaal", 0.55, (-0.012, 0.018), tex=512, flip=True)
    spine = c.body.chain([(0, -0.22, 0.30), (0, -0.02, 0.38), (0, 0.12, 0.38)], [0.1] * 3)
    # The eye sits low between the shoulders.
    c.body.chain([(0, 0.20, 0.32), (0, 0.26, 0.28)], [0.1] * 2, parent=spine[-1])
    # measure_generated split a split-fingered forefoot into two feet and lost a
    # hind one; these are cross-section centres, knees pushed back off the chord.
    for i, (hip, knee, foot) in enumerate([
        ((-0.272, 0.058, 0.400), (-0.340, 0.050, 0.210), (-0.344, 0.207, 0.000)),
        ((0.268, 0.078, 0.400), (0.340, 0.050, 0.210), (0.381, 0.157, 0.000)),
        ((-0.122, -0.172, 0.240), (-0.180, -0.200, 0.120), (-0.166, -0.173, 0.004)),
        ((0.098, -0.192, 0.240), (0.160, -0.210, 0.120), (0.130, -0.189, 0.009)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


# Image-to-3D like the Grubling, but six-legged: a /codex-imagegen reference
# through local TRELLIS (review/3d/sand-skitterer-v2), cut to 4k triangles, with a
# normal map baked off the opened TRELLIS source by tools/bake_generated_normal.py.
SKITTERER_SOURCE = os.path.join(TEX_DIR, "source", "sand_skitterer_v2.glb")
SKITTERER_NORMAL = os.path.join(TEX_DIR, "source", "sand_skitterer_v2_n.png")


def sand_skitterer():
    """A scarab: one low bronze dome over six stubby splayed legs.

    Volumetric opening (tools/open_volume.py --res 240 --radius 2), 4k triangles.
    Every joint below is measured off sand_skitterer_v2.glb by
    tools/measure_generated.py --flip 1, so a regenerated mesh needs them measured
    again. The belly rests on the floor and reads as a foot: the six real feet are
    picked by position. TRELLIS did not mirror the legs, so neither do these.
    """
    c = GeneratedSkin("monster.sand_skitterer.v1", SKITTERER_SOURCE, SKITTERER_NORMAL,
                      "desert", 0.36, (0.012, 0.015), tex=512, flip=True)
    spine = c.body.chain([(0, -0.30, 0.17), (0, 0.0, 0.19), (0, 0.26, 0.17)], [0.1] * 3)
    c.body.chain([(0, 0.36, 0.15), (0, 0.46, 0.14)], [0.05] * 2, parent=spine[-1])
    # Front pair first, then mid, then rear: Gait reads that order as a tripod.
    for i, (hip, knee, foot) in enumerate([
        ((-0.147, 0.185, 0.159), (-0.356, 0.346, 0.143), (-0.391, 0.349, 0.012)),
        ((0.169, 0.228, 0.152), (0.333, 0.348, 0.104), (0.345, 0.343, 0.007)),
        ((-0.301, -0.038, 0.138), (-0.491, 0.027, 0.189), (-0.623, 0.026, 0.006)),
        ((0.366, -0.007, 0.142), (0.544, 0.063, 0.185), (0.596, 0.102, 0.012)),
        ((-0.232, -0.308, 0.150), (-0.426, -0.403, 0.185), (-0.520, -0.437, 0.006)),
        ((0.299, -0.306, 0.148), (0.533, -0.382, 0.198), (0.593, -0.384, 0.016)),
    ]):
        c.leg_through(i, hip, knee, foot)
    # At the roster's 0.78 a foot swept a third of the body width.
    c.stride_k = 0.45
    return c


SCUTTLER_SOURCE = os.path.join(TEX_DIR, "source", "brine_scuttler_v1.glb")
SCUTTLER_NORMAL = os.path.join(TEX_DIR, "source", "brine_scuttler_v1_n.png")


def brine_scuttler():
    """A hermit crab under a barnacled whelk shell, two fat claws in front, teal
    eyes on stalks: the Strand's swarm.

    Generated (review/3d/brine-scuttler-v2), volumetric opening res 240 r 2, 4k
    triangles. Joints measured off brine_scuttler_v1.glb by
    tools/measure_generated.py --legs 6 --flip 1, the feet picked by position:
    the claw tips and the shell lip rest on the floor and read as feet too. Each
    side's front and middle feet share one floor patch, so four legs are rigged
    and the middle pair rides the front.
    """
    c = GeneratedSkin("monster.brine_scuttler.v1", SCUTTLER_SOURCE, SCUTTLER_NORMAL,
                      "coast", 0.5, (0.036, 0.093), tex=512, flip=True)
    spine = c.body.chain([(0, -0.30, 0.27), (0, -0.02, 0.29), (0, 0.18, 0.27)], [0.1] * 3)
    # The claws and eye stalks ride the head bone.
    c.body.chain([(0, 0.24, 0.18), (0, 0.32, 0.10)], [0.05] * 2, parent=spine[-1])
    # Front pair first, then rear. The traced knees sat on the clover feet and
    # left no slack, so the lunge stretched the rear legs 8.7% past reach: they
    # sit at the outer bend of the leg instead.
    for i, (hip, knee, foot) in enumerate([
        ((-0.201, 0.078, 0.135), (-0.285, 0.140, 0.110), (-0.294, 0.162, 0.003)),
        ((0.156, -0.001, 0.121), (0.300, 0.090, 0.110), (0.330, 0.121, 0.003)),
        ((-0.251, -0.144, 0.123), (-0.355, -0.143, 0.110), (-0.382, -0.143, 0.000)),
        ((0.201, -0.149, 0.133), (0.350, -0.140, 0.110), (0.375, -0.138, 0.001)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


WHELP_SOURCE = os.path.join(TEX_DIR, "source", "bramble_whelp_v2.glb")
WHELP_NORMAL = os.path.join(TEX_DIR, "source", "bramble_whelp_v2_n.png")


def bramble_whelp():
    """A stocky hound carved from bark, moss down its back, a row of round
    knots for a ridge, amber eyes.

    Generated (review/3d/bramble-whelp-v2), volumetric opening res 240 r 2 band
    8, 4k triangles. Height 0.75, not 0.95: the body is twice as wide. Joints
    measured off bramble_whelp_v2.glb by tools/measure_generated.py --flip 1.
    """
    c = GeneratedSkin("monster.bramble_whelp.v1", WHELP_SOURCE, WHELP_NORMAL,
                      "forest", 0.75, (0.001, -0.125), tex=512, flip=True)
    # Rooted over the fore hips, the near-straight pair: rooted at the rump the
    # lunge stretched a leg past reach.
    spine = c.body.chain([(0, 0.20, 0.45), (0, -0.05, 0.46), (0, -0.32, 0.44)], [0.1] * 3)
    c.body.chain([(0, 0.40, 0.46), (0, 0.56, 0.40)], [0.1] * 2, parent=spine[0])
    c.body.chain([(0, -0.50, 0.33)], [0.05], parent=spine[-1])
    for i, (hip, knee, foot) in enumerate([
        ((-0.156, 0.195, 0.299), (-0.238, 0.206, 0.210), (-0.257, 0.392, 0.000)),
        ((0.162, 0.202, 0.292), (0.220, 0.229, 0.213), (0.238, 0.443, 0.000)),
        ((-0.178, -0.325, 0.366), (-0.310, -0.524, 0.129), (-0.268, -0.410, 0.000)),
        ((0.157, -0.319, 0.371), (0.281, -0.497, 0.133), (0.288, -0.425, 0.000)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


# --------------------------------------------------------------------------
# the shooters: tall, thin, and they keep their distance
# --------------------------------------------------------------------------

SPITTER_SOURCE = os.path.join(TEX_DIR, "source", "dune_spitter_v2.glb")
SPITTER_NORMAL = os.path.join(TEX_DIR, "source", "dune_spitter_v2_n.png")


def dune_spitter():
    """A squat sand toad, mouth open over a swollen violet throat sac.

    Generated (review/3d/dune-spitter-v2), volumetric opening (tools/open_volume.py
    --res 240 --radius 2), 4k triangles. Joints measured off dune_spitter_v2.glb by
    tools/measure_generated.py --flip 1, the four feet picked by position: the belly
    and the sac rest on the floor and read as feet too.
    """
    c = GeneratedSkin("monster.dune_spitter.v1", SPITTER_SOURCE, SPITTER_NORMAL,
                      "desert", 0.6, (-0.009, -0.326), tex=512, flip=True)
    # Rooted over the hind hips, like the other squat bodies.
    spine = c.body.chain([(0, -0.42, 0.33), (0, -0.10, 0.36), (0, 0.18, 0.34)], [0.1] * 3)
    c.body.chain([(0, -0.70, 0.25)], [0.1], parent=spine[0])
    c.body.chain([(0, 0.30, 0.30), (0, 0.40, 0.26)], [0.05] * 2, parent=spine[-1])
    # The front left trace ran into the sac and put its knee at the toes; that
    # knee is set mid-limb and outboard, like the measured front right.
    for i, (hip, knee, foot) in enumerate([
        ((-0.105, 0.077, 0.188), (-0.250, 0.150, 0.110), (-0.228, 0.211, 0.000)),
        ((0.283, 0.112, 0.213), (0.379, 0.260, 0.076), (0.287, 0.380, 0.007)),
        ((-0.342, -0.420, 0.206), (-0.506, -0.381, 0.194), (-0.614, -0.302, 0.018)),
        ((0.242, -0.425, 0.233), (0.456, -0.386, 0.205), (0.555, -0.289, 0.017)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


FEN_WISP_SOURCE = os.path.join(TEX_DIR, "source", "fen_wisp_v2.glb")
FEN_WISP_NORMAL = os.path.join(TEX_DIR, "source", "fen_wisp_v2_n.png")


def fen_wisp():
    """A drowned skull in one thick band of weed that spirals down into a tail,
    the light still on behind the sockets.

    Generated (review/3d/fen-wisp-v2), volumetric opening res 240 r 2 band 8, 4k
    triangles. No legs: a body-only GeneratedSkin lifted 0.15 off the floor, so
    the tail under the skull hangs and never touches. Height 1.75: the shape is
    twice as tall as wide, and below that the sim's 0.5 body sticks out of it.
    """
    c = GeneratedSkin("monster.fen_wisp.v1", FEN_WISP_SOURCE, FEN_WISP_NORMAL,
                      "swamp", 1.75, (0.0, 0.0, 0.15), tex=512, flip=True)
    c.body.chain([(0, 0, 0.38), (0, 0, 0.84), (0, 0, 1.37), (0, 0.03, 1.90)], [0.15] * 4)
    return c


HOARFROST_SPITTER_SOURCE = os.path.join(TEX_DIR, "source", "hoarfrost_spitter_v2.glb")
HOARFROST_SPITTER_NORMAL = os.path.join(TEX_DIR, "source", "hoarfrost_spitter_v2_n.png")


def hoarfrost_spitter():
    """A deer-skulled biped of grey driftwood, ice crystals on the shoulders and
    forearms, frost glowing in the chest, arms long enough to throw with.

    Generated (review/3d/hoarfrost-spitter-v2), volumetric opening res 240 r 2
    band 8, 4k triangles, rig_humanoid. Ankles measured centred within 7 mm.
    The claws hang to 0.15 H and the left hand touches its thigh, whose outer
    edge is 0.17 H: one surface piece, so only the thigh rule keeps it a hand.
    """
    return GeneratedCreature("monster.hoarfrost_spitter.v1", HOARFROST_SPITTER_SOURCE, "forest", 2.0,
                             normal=HOARFROST_SPITTER_NORMAL, thigh=0.17, knee=0.15)


TIDE_SPITTER_SOURCE = os.path.join(TEX_DIR, "source", "tide_spitter_v1.glb")
TIDE_SPITTER_NORMAL = os.path.join(TEX_DIR, "source", "tide_spitter_v1_n.png")


def tide_spitter():
    """A clam on four stubby legs, blue ribbed shell with orange knobs along the
    hinge, a glowing core in the open mouth: the Strand's shooter.

    Generated (review/3d/tide-spitter-v2), volumetric opening res 240 r 2, 4k
    triangles, rebuilt with --pitch -2.9: TRELLIS stood it nose-down, rear feet
    5% H off the floor. Joints measured off tide_spitter_v1.glb by
    tools/measure_generated.py --legs 5 --flip 1: the belly rests on the floor
    and reads as a fifth foot, so it is dropped and the offset centres the four.
    """
    c = GeneratedSkin("monster.tide_spitter.v1", TIDE_SPITTER_SOURCE, TIDE_SPITTER_NORMAL,
                      "coast", 0.65, (-0.024, -0.074), tex=512, flip=True)
    # One spine bone and no head: a shell does not bend, and a three-bone spine
    # or a head on the mouth folded it flat at the hit and pulled the front toes.
    c.body.chain([(0, -0.32, 0.33), (0, 0.20, 0.33)], [0.1] * 2)
    # The traced knees left the stubs nearly straight and the lunge stretched
    # them 28.8% past reach: they sit at the outer bend, 0.9 out, 0.85 hip high.
    for i, (hip, knee, foot) in enumerate([
        ((-0.291, 0.216, 0.162), (-0.342, 0.358, 0.138), (-0.348, 0.374, 0.016)),
        ((0.286, 0.229, 0.207), (0.344, 0.404, 0.176), (0.351, 0.424, 0.029)),
        ((-0.419, -0.320, 0.179), (-0.563, -0.365, 0.152), (-0.579, -0.370, 0.020)),
        ((0.384, -0.329, 0.193), (0.557, -0.418, 0.164), (0.576, -0.428, 0.009)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


# --------------------------------------------------------------------------
# the brutes: mid-sized, slow, and they close on you
# --------------------------------------------------------------------------

VAAL_CONSTRUCT_SOURCE = os.path.join(TEX_DIR, "source", "vaal_construct_v2.glb")
VAAL_CONSTRUCT_NORMAL = os.path.join(TEX_DIR, "source", "vaal_construct_v2_n.png")


def vaal_construct():
    """A blocky stone golem, huge banded forearms and fists, green glyphs, a green
    gem sunk between the shoulders for a head.

    Generated (review/3d/vaal-construct-v2), volumetric opening res 240 r 2,
    4k triangles, rig_humanoid. Ankles measured at x 0.237 and -0.342 as loaded:
    the offset centres the stance. The fists touch the thighs, whose outer edge
    measures 0.22 H: past it the thighs claimed ~80 fist vertices a side.
    """
    return GeneratedCreature("monster.vaal_construct.v1", VAAL_CONSTRUCT_SOURCE, "vaal", 2.0,
                             normal=VAAL_CONSTRUCT_NORMAL, offset=(0.052, 0.0), thigh=0.225)


BOG_DROWNED_SOURCE = os.path.join(TEX_DIR, "source", "bog_drowned_v2.glb")
BOG_DROWNED_NORMAL = os.path.join(TEX_DIR, "source", "bog_drowned_v2_n.png")


def bog_drowned():
    """A bloated grey-green brute, moss cushions on the shoulders, a mud-brown
    waist wrap, huge hands at the knee, small head pushed forward.

    Generated (review/3d/bog-drowned-v2), opened by tools/open_volume.py --res 240
    --radius 2 --band 8, 4k triangles, rig_humanoid. Feet centroid measured at
    x 0.015 as loaded: the offset centres the stance.
    """
    return GeneratedCreature("monster.bog_drowned.v1", BOG_DROWNED_SOURCE, "swamp", 1.7,
                             normal=BOG_DROWNED_NORMAL, offset=(-0.015, 0.0))


WRACK_DROWNED_SOURCE = os.path.join(TEX_DIR, "source", "wrack_drowned_v1.glb")
WRACK_DROWNED_NORMAL = os.path.join(TEX_DIR, "source", "wrack_drowned_v1_n.png")


def wrack_drowned():
    """A drowned sailor gone to bloat, barnacles crusting the shoulders, a
    striped sash, a rusted anchor hanging from the right hand.

    Generated (review/3d/wrack-drowned-v2), volumetric opening res 240 r 2, 4k
    triangles, rig_humanoid. The anchor's flukes hang into the foot band and
    touch the right foot, one piece with it: the foot ends at 0.29 H from the
    midline and the flukes start at 0.32 H, so past 0.31 H it is the anchor.
    Feet midpoint measured at x 0.04 H as loaded: the offset centres the stance.
    The empty left hand hangs to 0.21 H against a thigh whose outer edge is 0.20 H,
    and the shell fused both arms down the flank and thigh: `fused_arms` cuts them.
    """
    return GeneratedCreature("monster.wrack_drowned.v1", WRACK_DROWNED_SOURCE, "coast", 1.8,
                             normal=WRACK_DROWNED_NORMAL, offset=(-0.072, 0.0),
                             carry="r", held=0.31, thigh=0.225, knee=0.20, fused_arms=True)


GRUBLING_SOURCE = os.path.join(TEX_DIR, "source", "drowned_grubling_v2.glb")
GRUBLING_NORMAL = os.path.join(TEX_DIR, "source", "drowned_grubling_v2_n.png")


def generated_hide(mesh, name, family, normal=None, size=TEX_SIZE):
    """Dress a generated mesh in its own albedo by the roster's hide rule.

    TRELLIS ships a metallic-roughness sheet that reads as wet metal with no
    environment map; only its albedo is kept.
    """
    bsdf = next(n for n in mesh.data.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    img = bsdf.inputs["Base Color"].links[0].from_node.image
    if max(img.size) > size:
        img.scale(size, size)
    colour = os.path.join(BUILD_DIR, name + ".jpg")
    img.save_render(filepath=colour, scene=bpy.context.scene)
    luma = srgb_luma(img)
    gain = hide_gain(img, max(HIDE_FLOOR, FLOOR_LUMA[family] * HIDE_RATIO))
    print("  hide %-7s luma %5.1f floor %5.1f tint %.3f" % (name, luma, FLOOR_LUMA[family], gain))
    if normal is not None:
        # Re-encoded like the hide normals: a 1024 PNG embeds at several MB.
        nimg = bpy.data.images.load(normal)
        if max(nimg.size) > size:
            nimg.scale(size, size)
        nimg.file_format = "JPEG"
        normal = os.path.join(BUILD_DIR, name + "_n.jpg")
        nimg.save(filepath=normal, quality=92)
        bpy.data.images.remove(nimg)
    mesh.data.materials.clear()
    mesh.data.materials.append(hide_material("hide_" + name, colour, normal, (gain, gain, gain)))


class GeneratedCreature:
    """A species whose mesh was generated: rigged and animated by
    `rig_humanoid.py`, dressed in its own sheet by the same hide rule as the
    roster. It faces -Y as imported, where a turned node-graph root ends up."""

    def __init__(self, def_id, source, family, height, normal=None, tex=TEX_SIZE,
                 offset=(0.0, 0.0), carry=None, thigh=None, knee=0.25, held=None, fused_arms=False):
        self.def_id, self.source, self.family, self.height = def_id, source, family, height
        # The shell fused the arms down the flank and thigh: cut them free (rig_humanoid.skin).
        self.fused_arms = fused_arms
        # "l"/"r": the hand carrying a long blade, held low through the walk.
        # `held`, a fraction of H: past it from the midline, that side's floor
        # contact is the carried thing standing on the floor, not the foot.
        self.carry, self.held = carry, held
        # Fractions of H: the thighs' outer edge, when the fists hang against
        # them, and how low the fists reach.
        self.thigh, self.knee = thigh, knee
        self.normal, self.tex = normal, tex
        # load_mesh centres on the mid-height vertex median, which moves with
        # vertex density; the hips are placed at x 0, so the stance must be there.
        self.offset = offset

    def emit(self, mats):
        spec = importlib.util.spec_from_file_location(
            "rig_humanoid", os.path.join(ROOT, "tools", "rig_humanoid.py"))
        rig = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rig)
        for path in filter(None, (self.source, self.normal)):
            if not os.path.exists(path):
                sys.exit("missing generated creature: " + path)
        mesh = rig.load_mesh(self.source, self.height, False)
        dx, dy = self.offset
        for vert in mesh.data.vertices:
            vert.co.x += dx
            vert.co.y += dy
        mesh.data.update()
        generated_hide(mesh, self.def_id.split(".")[1], self.family, self.normal, self.tex)

        arm = rig.build_armature(self.def_id, rig.landmarks(mesh, self.height, self.carry, self.held))
        mesh.name = mesh.data.name = self.def_id + ".mesh"
        rig.skin(mesh, arm, self.thigh, self.knee, self.carry, self.held, self.fused_arms)
        # No baked occlusion: white, so the runtime's multiply leaves the sheet alone.
        layer = mesh.data.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        layer.data.foreach_set("color", numpy.ones(len(mesh.data.loops) * 4, dtype=numpy.float32))
        mesh.data.color_attributes.active_color = layer
        rig.author(arm, self.height, self.carry)
        self.root = arm
        return arm


class GeneratedSkin(Creature):
    """A generated mesh worn over a DECLARED skeleton, for bodies `rig_humanoid`
    cannot read: the species states its spine and legs at joints measured off the
    mesh, and the roster's own bone graph, weights and gait drive it. The mesh
    must face +Y as imported, as every node-graph species is authored."""

    def __init__(self, def_id, source, normal, family, height, offset, tex=1024, flip=False):
        super().__init__(def_id, family, 0.25, height)
        self.source, self.normal = source, normal
        self.offset = offset
        # Sheet size: 512 for a mob, 1024 for a boss, which fills far more screen.
        self.tex = tex
        # TRELLIS faces a mesh whichever way its reference looked: turn it to +Y.
        self.flip = flip

    def leg_through(self, index, hip, knee, foot):
        """Hip, knee, ankle, toe at measured points; the ankle sits just above the
        tip, so the shin is the long bone and the toe is the claw."""
        ankle = tuple(foot[k] + (knee[k] - foot[k]) * 0.18 for k in range(3))
        part = self.limb(f"leg{index}", hip)
        part.chain([hip, knee, ankle, foot], [0.03] * 4)
        return part

    def emit(self, mats):
        spec = importlib.util.spec_from_file_location(
            "rig_humanoid", os.path.join(ROOT, "tools", "rig_humanoid.py"))
        rig = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rig)
        for path in (self.source, self.normal):
            if not os.path.exists(path):
                sys.exit("missing generated creature: " + path)
        mesh = rig.load_mesh(self.source, self.height, self.flip)
        # load_mesh centres on the mid-height mass; the stance centre is where
        # the sim's body radius belongs. A third component lifts a legless body.
        dx, dy, dz = (tuple(self.offset) + (0.0,))[:3]
        for vert in mesh.data.vertices:
            vert.co.x += dx
            vert.co.y += dy
            vert.co.z += dz
        mesh.data.update()
        name = self.def_id.split(".")[1]
        generated_hide(mesh, name, self.family, self.normal, self.tex)

        parts = [self.body] + self.limbs
        bones = bone_graph(parts)
        arm = make_armature(self.def_id, bones)
        arm.rotation_euler = (0.0, 0.0, math.pi)  # see Creature.emit
        self.root = arm
        mesh.name = mesh.data.name = self.def_id + ".mesh"
        mesh.parent = arm
        skin(mesh, bones, nearest_part(mesh, bones), self.height)
        # No baked occlusion: white, so the runtime's multiply leaves the sheet alone.
        layer = mesh.data.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        layer.data.foreach_set("color", numpy.ones(len(mesh.data.loops) * 4, dtype=numpy.float32))
        mesh.data.color_attributes.active_color = layer
        gait = Gait(self, bones)
        author_clips(arm, gait, bones)
        print("  bones %d verts %d legs %d cycle %d frames reach %+.1f%% stride %.2f"
              % (len(bones), len(mesh.data.vertices), len(gait.legs), gait.frames(),
                 gait.reach_error * 100.0, gait.stride_ratio))
        return arm


def nearest_part(mesh, bones):
    """Which part each vertex of a welded generated mesh belongs to: its nearest
    bone's. The trunk wins near a tie (`BODY_BIAS`), so the carapace rim over a
    hip stays on the body instead of riding the leg."""
    co = numpy.empty(len(mesh.data.vertices) * 3, dtype=numpy.float64)
    mesh.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    dist = numpy.empty((len(co), len(bones)))
    for j, b in enumerate(bones):
        a, ab = numpy.array(b.head), numpy.array(b.tail) - numpy.array(b.head)
        t = numpy.clip((co - a) @ ab / max(ab @ ab, 1e-12), 0.0, 1.0)
        dist[:, j] = numpy.linalg.norm(co - (a + t[:, None] * ab), axis=1)
        if b.part == 0:
            dist[:, j] *= BODY_BIAS
    part = numpy.array([b.part for b in bones])
    return part[dist.argmin(axis=1)].tolist()


BODY_BIAS = 0.6


def drowned_grubling():
    """A squat toad on two legs, pot belly, glowing eyes and a moss clump on one
    shoulder: the swamp's pack of eight.

    Generated (review/3d/drowned-grubling-v2), opened by tools/open_volume.py
    --res 240 --radius 2 --band 8 (the default band leaked into the body and kept
    one leg), 4k triangles, rig_humanoid. Feet centroid measured at x 0.015 as
    loaded: the offset centres the stance.
    """
    return GeneratedCreature("monster.drowned_grubling.v1", GRUBLING_SOURCE, "swamp", 0.95,
                             normal=GRUBLING_NORMAL, offset=(-0.015, 0.0))


BOAR_SOURCE = os.path.join(TEX_DIR, "source", "thornhide_boar_v2.glb")
BOAR_NORMAL = os.path.join(TEX_DIR, "source", "thornhide_boar_v2_n.png")


def thornhide_boar():
    """Bark plates over a boar's mass, tusks up, head carried low to charge.

    Generated (review/3d/thornhide-boar-v2), volumetric opening res 240 r 2 band
    8, 4k triangles. TRELLIS faced this one +Y already, so no flip. Joints
    measured off thornhide_boar_v2.glb by tools/measure_generated.py --flip 0.
    """
    c = GeneratedSkin("monster.thornhide_boar.v1", BOAR_SOURCE, BOAR_NORMAL,
                      "forest", 1.4, (-0.017, 0.425), tex=512, flip=False)
    spine = c.body.chain([(0, -0.55, 0.62), (0, 0.0, 0.64), (0, 0.50, 0.62)], [0.1] * 3)
    c.body.chain([(0, 0.75, 0.58), (0, 0.95, 0.50)], [0.1] * 2, parent=spine[-1])
    c.body.chain([(0, -0.75, 0.58)], [0.05], parent=spine[0])
    # The measured hind knees disagreed (0.37 against 0.19 high); both sit mid-shin.
    # The forefeet stand ahead of the hips, so the coil pulled the measured fore
    # legs 20% past reach: their knees sit at the back of the leg column.
    for i, (hip, knee, foot) in enumerate([
        ((-0.348, 0.326, 0.492), (-0.420, 0.300, 0.250), (-0.418, 0.614, 0.016)),
        ((0.338, 0.391, 0.491), (0.420, 0.340, 0.250), (0.502, 0.629, 0.016)),
        ((-0.262, -0.514, 0.458), (-0.330, -0.640, 0.250), (-0.340, -0.678, 0.000)),
        ((0.301, -0.460, 0.471), (0.300, -0.640, 0.240), (0.256, -0.565, 0.000)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


# --------------------------------------------------------------------------
# the heavies: the loudest thing in a pack, and the slowest
# --------------------------------------------------------------------------

BLOOD_SENTINEL_SOURCE = os.path.join(TEX_DIR, "source", "blood_sentinel_v2.glb")
BLOOD_SENTINEL_NORMAL = os.path.join(TEX_DIR, "source", "blood_sentinel_v2_n.png")


def blood_sentinel():
    """A faceless hooded knight in dark plate trimmed blood red, a broad sword
    point-down in the right hand.

    Generated (review/3d/blood-sentinel-v2), volumetric opening res 240 r 2,
    4k triangles, rig_humanoid. Ankles measured at x 0.325 and -0.375 as loaded:
    the offset centres the stance.
    """
    return GeneratedCreature("monster.blood_sentinel.v1", BLOOD_SENTINEL_SOURCE, "vaal", 2.1,
                             normal=BLOOD_SENTINEL_NORMAL, offset=(0.022, 0.0), carry="r")


COLOSSUS_SOURCE = os.path.join(TEX_DIR, "source", "sunbaked_colossus_v2.glb")
COLOSSUS_NORMAL = os.path.join(TEX_DIR, "source", "sunbaked_colossus_v2_n.png")


def sunbaked_colossus():
    """A sandstone golem that knuckle-walks: the fists are its forefeet.

    Generated (review/3d/sunbaked-colossus-v2), volumetric opening
    (tools/open_volume.py --res 240 --radius 2), 4k triangles. Joints measured off
    sunbaked_colossus_v2.glb by tools/measure_generated.py --flip 1.
    """
    c = GeneratedSkin("monster.sunbaked_colossus.v1", COLOSSUS_SOURCE, COLOSSUS_NORMAL,
                      "desert", 1.8, (0.043, -0.004), tex=512, flip=True)
    # Rooted over the hind hips: the attack pitches the trunk about its first node.
    spine = c.body.chain([(0, -0.65, 1.00), (0, -0.20, 1.30), (0, 0.30, 1.35)], [0.1] * 3)
    c.body.chain([(0, -0.90, 0.85)], [0.1], parent=spine[0])
    # The head sits sunk low between the shoulders, ahead of the hump.
    c.body.chain([(0, 0.52, 1.20), (0, 0.68, 1.12)], [0.1] * 2, parent=spine[-1])
    for i, (hip, knee, foot) in enumerate([
        ((-0.460, 0.122, 0.910), (-0.692, 0.322, 0.572), (-0.605, 0.610, 0.087)),
        ((0.529, 0.165, 0.992), (0.683, 0.420, 0.659), (0.578, 0.827, 0.110)),
        ((-0.227, -0.730, 0.605), (-0.487, -0.741, 0.415), (-0.520, -0.796, 0.000)),
        ((0.342, -0.634, 0.616), (0.520, -0.556, 0.472), (0.547, -0.640, 0.008)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


BEHEMOTH_SOURCE = os.path.join(TEX_DIR, "source", "rotting_behemoth_v2.glb")
BEHEMOTH_NORMAL = os.path.join(TEX_DIR, "source", "rotting_behemoth_v2_n.png")


def rotting_behemoth():
    """A bloated slug-tick on six stumps, its back split and glowing, pustules
    lit along the flanks.

    Generated (review/3d/rotting-behemoth-v2), volumetric opening res 240 r 2
    band 8, 4k triangles. TRELLIS stood it nose-down, so the rebuild levelled it
    (reshape_generated.py --pitch -4.3). Height 1.2, not 2.0: the body is twice as
    long as tall, and at 1.4 it was 2.9 wide against a 2-unit tile opening.
    Joints measured off rotting_behemoth_v2.glb by tools/measure_generated.py
    --flip 1 --foot-z 0.03; the default band read the belly as a foot.
    """
    c = GeneratedSkin("monster.rotting_behemoth.v1", BEHEMOTH_SOURCE, BEHEMOTH_NORMAL,
                      "swamp", 1.2, (-0.035, 0.268), tex=512, flip=True)
    spine = c.body.chain([(0, -0.80, 0.74), (0, 0.10, 0.78), (0, 0.95, 0.74)], [0.1] * 3)
    c.body.chain([(0, 1.20, 0.68), (0, 1.42, 0.62)], [0.1] * 2, parent=spine[-1])
    c.body.chain([(0, -1.10, 0.66)], [0.1], parent=spine[0])
    # Front pair first, then mid, then rear.
    for i, (hip, knee, foot) in enumerate([
        ((-0.439, 0.666, 0.396), (-0.695, 0.930, 0.251), (-0.740, 0.806, 0.005)),
        ((0.394, 0.671, 0.393), (0.622, 0.977, 0.254), (0.691, 0.768, 0.004)),
        ((-0.789, -0.029, 0.358), (-0.978, 0.094, 0.185), (-1.066, 0.000, 0.032)),
        ((0.789, -0.051, 0.362), (0.944, 0.066, 0.177), (1.134, 0.015, 0.033)),
        ((-0.606, -0.781, 0.332), (-0.865, -0.705, 0.182), (-0.931, -0.812, 0.000)),
        ((0.616, -0.710, 0.328), (0.849, -0.703, 0.199), (0.911, -0.777, 0.005)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


# --------------------------------------------------------------------------
# the bosses: one per biome, and each one is the room's silhouette
# --------------------------------------------------------------------------

CINDER_WARDEN_SOURCE = os.path.join(TEX_DIR, "source", "cinder_warden_v2.glb")
CINDER_WARDEN_NORMAL = os.path.join(TEX_DIR, "source", "cinder_warden_v2_n.png")


def cinder_warden():
    """Vaal Stone. A furnace on two legs, carrying the slab it slams with.

    Generated (review/3d/cinder-warden-v2), volumetric opening res 240 r 2 band
    8, 8k triangles on a 1024 sheet, rig_humanoid. The slab stands fused to the
    right shin: past 0.28 H it is the slab, rigid with the hand, its inner face
    joins it by surface distance, and the faces fused to the leg are cut and
    capped. Ankles measured at x -0.25 and 0.65 as loaded: the offset centres the
    stance.
    """
    return GeneratedCreature("monster.cinder_warden.v1", CINDER_WARDEN_SOURCE, "cinder", 2.9,
                             normal=CINDER_WARDEN_NORMAL, tex=1024, offset=(-0.20, 0.0),
                             carry="r", held=0.28)


SIRRATH_SOURCE = os.path.join(TEX_DIR, "source", "sirrath_v2.glb")
SIRRATH_NORMAL = os.path.join(TEX_DIR, "source", "sirrath_v2_n.png")


def sirrath():
    """Desert. A hooded sun-priest on five bone stilts, censers hung under the robe.

    Generated (review/3d/sirrath-v2), volumetric opening res 240 r 2, 8k triangles
    on a 1024 sheet. Five legs because the reference shows five: the sixth hides
    behind a censer and TRELLIS built what it saw. Joints measured off
    sirrath_v2.glb by tools/measure_generated.py --legs 5 --flip 1, whose offset is
    the feet centroid, three feet on one side pulling it 0.17 off the robe: the
    offset here is the midpoint between the two sides' feet, which puts the hood
    on the midline.
    """
    c = GeneratedSkin("monster.sirrath.v1", SIRRATH_SOURCE, SIRRATH_NORMAL,
                      "desert", 2.8, (0.19, -0.273), flip=True)
    spine = c.body.chain([(0, -0.55, 1.60), (0, -0.05, 1.70), (0, 0.45, 1.65)], [0.2] * 3)
    c.body.chain([(-0.05, 0.10, 2.10), (-0.03, 0.15, 2.50)], [0.1] * 2, parent=spine[-1])
    for i, (hip, knee, foot) in enumerate([
        ((-0.438, 0.634, 1.047), (-0.706, 0.697, 0.806), (-0.771, 0.680, 0.000)),
        ((0.575, 0.358, 1.148), (0.895, 0.545, 1.049), (0.736, 1.176, 0.035)),
        ((-0.499, 0.082, 1.084), (-0.951, -0.001, 0.375), (-1.009, 0.014, 0.119)),
        ((-0.466, -0.675, 1.228), (-0.781, -0.882, 0.427), (-0.755, -0.864, 0.002)),
        ((0.451, -0.302, 1.332), (0.794, -0.752, 0.907), (0.939, -1.005, 0.069)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


MOTHER_VHAL_SOURCE = os.path.join(TEX_DIR, "source", "mother_vhal_v1.glb")
MOTHER_VHAL_NORMAL = os.path.join(TEX_DIR, "source", "mother_vhal_v1_n.png")


def mother_vhal():
    """Swamp. A brood sac caged in rib arches, low and wide on nine tendrils.

    Generated (review/3d/mother-vhal, reference v2), volumetric opening res 240
    r 2, 8k triangles on a 1024 sheet. Height 1.5, not the old 3.1: the body is
    three times wider than tall, and at 3.1 it covered 8.7 units of floor.
    Joints measured off mother_vhal_v1.glb by tools/measure_generated.py
    --legs 9 --flip 1, except two. The left fore-mid tendril runs into its
    neighbour and traced under the body: its foot is the --legs 10 trace's. The
    left fore tendril traced its hip at the tip: hip and knee mirror the right's.
    """
    c = GeneratedSkin("monster.mother_vhal.v1", MOTHER_VHAL_SOURCE, MOTHER_VHAL_NORMAL,
                      "swamp", 1.5, (-0.322, 0.281), flip=True)
    spine = c.body.chain([(0, -1.20, 0.85), (0, 0.0, 0.95), (0, 1.20, 0.85)], [0.3] * 3)
    c.body.chain([(0, 1.40, 0.70), (0, 1.60, 0.55)], [0.15] * 2, parent=spine[-1])
    for i, (hip, knee, foot) in enumerate([
        ((-0.550, 1.250, 0.490), (-0.852, 1.681, 0.420), (-0.937, 1.802, 0.000)),
        ((0.466, 1.129, 0.492), (0.608, 1.446, 0.436), (0.647, 1.550, 0.001)),
        ((-0.860, 0.864, 0.409), (-1.550, 0.840, 0.450), (-1.840, 0.783, 0.000)),
        ((0.618, 0.587, 0.321), (1.091, 0.858, 0.422), (1.252, 1.004, 0.000)),
        ((-1.218, -0.243, 0.326), (-1.712, -0.625, 0.500), (-1.870, -0.751, 0.001)),
        ((0.735, 0.048, 0.331), (1.384, -0.007, 0.455), (1.536, 0.079, 0.000)),
        ((-0.893, -0.671, 0.330), (-0.945, -1.299, 0.507), (-0.893, -1.611, 0.000)),
        ((0.493, -0.433, 0.366), (0.991, -0.862, 0.460), (1.130, -1.082, 0.000)),
        ((-0.039, -0.755, 0.392), (0.016, -1.459, 0.443), (0.042, -1.801, 0.000)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


GHALTREK_SOURCE = os.path.join(TEX_DIR, "source", "ghaltrek_v2.glb")
GHALTREK_NORMAL = os.path.join(TEX_DIR, "source", "ghaltrek_v2_n.png")


def ghaltrek():
    """Forest. A mossy bark shell on four splayed stone legs, the head slung low
    in front under an antler rack wider than the corridor it comes down.

    Generated (review/3d/ghaltrek-v2), volumetric opening res 240 r 2 band 8, 8k
    triangles on a 1024 sheet. TRELLIS faced it +X, so the rebuild turned it
    (reshape_generated.py --yaw -90). The shell is the top at 2.5; the head and
    antlers hang below it. Joints measured off ghaltrek_v2.glb by
    tools/measure_generated.py --flip 1.
    """
    c = GeneratedSkin("monster.ghaltrek.v1", GHALTREK_SOURCE, GHALTREK_NORMAL,
                      "forest", 2.5, (-0.181, 0.335), tex=1024, flip=True)
    spine = c.body.chain([(0, -1.10, 1.45), (0, -0.05, 1.55), (0, 1.00, 1.45)], [0.1] * 3)
    # The antlers ride the head bone: nothing else is near them.
    c.body.chain([(0, 1.50, 1.20), (0, 2.00, 1.05)], [0.1] * 2, parent=spine[-1])
    c.body.chain([(0, -1.75, 1.30)], [0.1], parent=spine[0])
    # The coil pulled the measured fore legs 13% past reach: their knees sit out
    # and back at the edge of the leg column.
    for i, (hip, knee, foot) in enumerate([
        ((-0.529, 0.731, 1.132), (-0.980, 0.680, 0.800), (-1.128, 1.155, 0.000)),
        ((0.537, 0.647, 1.111), (1.000, 0.620, 0.780), (1.129, 1.080, 0.000)),
        ((-0.617, -0.670, 1.183), (-0.984, -1.057, 0.597), (-1.139, -1.128, 0.000)),
        ((0.690, -0.722, 1.158), (1.054, -1.096, 0.511), (1.138, -1.107, 0.000)),
    ]):
        c.leg_through(i, hip, knee, foot)
    return c


BOSS_FAMILIES = {
    "monster.cinder_warden.v1": "cinder",
    "monster.sirrath.v1": "desert",
    "monster.mother_vhal.v1": "swamp",
    "monster.ghaltrek.v1": "forest",
}

SPECIES = [
    cinder_imp, vaal_husk, sand_skitterer, bramble_whelp, brine_scuttler,
    dune_spitter, fen_wisp, hoarfrost_spitter, tide_spitter,
    drowned_grubling,
    vaal_construct, bog_drowned, thornhide_boar, wrack_drowned,
    blood_sentinel, sunbaked_colossus, rotting_behemoth,
    cinder_warden, sirrath, mother_vhal, ghaltrek,
]


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.scene.render.fps = FPS

    mats = build_materials()
    for make in SPECIES:
        creature = make()
        print(creature.def_id)
        family = BOSS_FAMILIES.get(creature.def_id)
        if family is not None:
            boss_mats = dict(mats)
            boss_mats[f"hide_{family}"] = mats[f"hide_{family}_boss"]
            creature.emit(boss_mats)
        else:
            creature.emit(mats)

    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        # Nothing is left to apply — the hulls were evaluated through the
        # depsgraph on the way in — and the one modifier still on a creature is
        # its armature, which must survive as a skin rather than be baked flat.
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_influence_nb=INFLUENCES,
        export_animations=True,
        # One glTF animation per NLA track, on the armature that owns the track.
        # ACTIONS mode offers every action to every armature in the file, which
        # for seventeen creatures is thirty-four clips each.
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_image_format="AUTO",  # the built hides are already JPEG
        # The baked occlusion rides out as COLOR_0. "MATERIAL" would drop it,
        # because none of these shader graphs reads a colour attribute — the
        # multiply happens in Babylon, not here.
        export_vertex_color="ACTIVE",
        export_cameras=False,
        export_lights=False,
    )
    print("wrote", OUT, os.path.getsize(OUT), "bytes")
    faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print("faces", faces, "objects", len(bpy.data.objects))


main()
