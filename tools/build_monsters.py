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
OUT = os.path.join(ROOT, "apps", "web", "public", "models", "monsters.glb")

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
FLOOR_LUMA = {"cinder": 75.0, "vaal": 75.0, "desert": 162.0, "swamp": 55.0, "forest": 55.0}
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
            if aim is not None and aim.length_squared > 1e-12:
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
            want = STRIDE_K * span / 2.0
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
            # which is the difference between a step and a stamp.
            toe = rest[3] + delta
            roll = Matrix.Rotation(-0.30 * math.sin(2.0 * math.pi * (t + leg["phase"])), 3, "X")
            self._dirs[bones[2].name] = roll @ (toe - ankle).normalized()
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
    """Write `walk` and `idle` onto the armature as two NLA tracks.

    One track per clip, named `<species>|<clip>`, because the glTF exporter's
    ACTIONS mode offers every action to every armature in the file and would
    give all seventeen creatures all thirty-four clips. NLA_TRACKS exports each
    track once, on the armature that owns it, under the track's own name.
    """
    poser = Poser(arm, bones)
    arm.animation_data_create()
    walk = gait.frames()
    # Idle is authored over the same frame count as the walk and played back
    # slow (`IDLE_RATIO` in `monsters.ts`). A breath is one long sine — sampling
    # it three times as densely only costs the download.
    for clip, length, moving in (("walk", walk, True), ("idle", walk, False)):
        action = bpy.data.actions.new("%s|%s" % (arm.name, clip))
        action.use_fake_user = True
        slot = action.slots.new("OBJECT", arm.name)
        strip_layer = action.layers.new("base")
        strip_layer.strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
        arm.animation_data.action = action
        arm.animation_data.action_slot = slot

        for frame in range(length + 1):
            # The last frame repeats the first, so the loop has no seam.
            moved = gait.pose(poser, (frame % length) / length, moving)
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
        target = max(HIDE_FLOOR, FLOOR_LUMA[name] * HIDE_RATIO)
        gain = min(1.0, (target / luma) ** 2.2)
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
        mix = tree.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 1.0
        mix.inputs["Color2"].default_value = (*tint, 1.0)
        tree.links.new(mix.inputs["Color1"], tex.outputs["Color"])
        shade = mix.outputs["Color"]
    tree.links.new(bsdf.inputs["Base Color"], shade)
    # Emission follows the tint. Left on the raw sheet it re-adds a slice of the
    # brightness the tint just took off, which is the one thing this pass is for.
    tree.links.new(bsdf.inputs["Emission Color"], shade)
    bsdf.inputs["Emission Strength"].default_value = EMISSION

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

def cinder_imp():
    """Humped quadruped, horns swept back, a whip tail. The one everybody meets."""
    c = Creature("monster.cinder_imp.v1", "cinder", 0.275, 0.85)
    # (across, up) per node. The hump is a rib cage — deep and NARROW — over a
    # pelvis that is wide and flat, with a waist between them you can see the
    # floor under. One radius per node makes all three the same circle, which is
    # the bean this creature used to be.
    spine = c.body.chain(
        [(0, -0.34, 0.42), (0, -0.16, 0.46), (0, 0.02, 0.52), (0, 0.20, 0.54), (0, 0.34, 0.48)],
        [(0.19, 0.12), (0.12, 0.13), (0.15, 0.24), (0.17, 0.21), (0.13, 0.15)])
    neck = c.body.chain([(0, 0.48, 0.44), (0, 0.60, 0.42)],
                        [(0.075, 0.09), (0.15, 0.13)], parent=spine[-1])
    c.body.chain([(0, 0.74, 0.38), (0, 0.86, 0.34)], [(0.10, 0.085), 0.045], parent=neck[-1])
    c.body.chain([(0, -0.54, 0.44), (0, -0.74, 0.54), (0, -0.90, 0.34)],
                 [0.075, 0.045, 0.018], parent=spine[0])
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.09, 0.70, 0.50), (0.042, 0.042, 0.042), 6, 4), GLOWS)
        c.body.add(horn([(side * 0.11, 0.56, 0.56), (side * 0.18, 0.44, 0.78),
                         (side * 0.20, 0.28, 0.92)], [0.06, 0.038, 0.0]), BONES)
        # A shoulder blade standing proud of the hide, where the foreleg hangs.
        c.body.add(horn([(side * 0.09, 0.28, 0.58), (side * 0.16, 0.21, 0.70)],
                        [0.05, 0.0], 5), BONES)
    # Three plates down the back, not a comb of spines. The top edge is the line
    # this camera reads first, and a round spine three percent of the creature
    # across is sub-pixel at seventy pixels tall — a blade of the same length
    # holds its own value against the floor and actually breaks the outline.
    for a, b, tip in [((0, 0.24, 0.68), (0, 0.04, 0.74), (0, 0.13, 0.94)),
                      ((0, 0.02, 0.74), (0, -0.16, 0.62), (0, -0.05, 0.90)),
                      ((0, -0.18, 0.58), (0, -0.34, 0.50), (0, -0.24, 0.72))]:
        c.body.add(fin(a, b, tip, 0.040, lean=0.02), BONES)
    for i, (x, y) in enumerate([(-0.17, 0.20), (0.17, 0.20), (-0.18, -0.26), (0.18, -0.26)]):
        c.leg(i, (x, y, 0.44), (x * 1.25, y, 0.0), 0.085, 0.05, bend=0.06)
    return c


def vaal_husk():
    """Hauls itself on long forelimbs; the hind legs are stubs that drag."""
    c = Creature("monster.vaal_husk.v1", "vaal", 0.25, 0.9)
    # Wide flat haunches, a narrow deep waist, and a chest wider than either: the
    # cross-section has to change down the trunk or a hauler is a bean with arms.
    spine = c.body.chain(
        [(0, -0.30, 0.30), (0, -0.06, 0.42), (0, 0.16, 0.52), (0, 0.28, 0.52)],
        [(0.20, 0.10), (0.17, 0.22), (0.30, 0.20), (0.25, 0.17)])
    neck = c.body.chain([(0, 0.34, 0.62), (0, 0.42, 0.74)], [(0.10, 0.12), (0.15, 0.13)],
                        parent=spine[-1])
    c.body.chain([(0, 0.54, 0.74)], [0.08], parent=neck[-1])
    # The split chest is what says "hollow" from above.
    c.body.add(slab((0, 0.26, 0.52), (0.12, 0.11, 0.30), tilt=0.30), GLOWS)
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.06, 0.52, 0.78), (0.033, 0.033, 0.033), 6, 4), GLOWS)
        c.body.add(horn([(side * 0.12, 0.40, 0.86), (side * 0.34, 0.30, 0.94)],
                        [0.05, 0.0]), BONES)
        # A shoulder blade broken out through the hide, one side bent further.
        # It leans OUT rather than up: from 53 degrees of elevation a blade that
        # rises is a dot, and the same blade laid over the flank is a fin.
        c.body.add(horn([(side * 0.14, 0.06, 0.46), (side * 0.30, 0.02, 0.60),
                         (side * (0.42 + side * 0.06), -0.12, 0.60)],
                        [0.09, 0.06, 0.0], 5), BONES)
    for i, side in enumerate((-1, 1)):
        c.leg(i, (side * 0.26, 0.14, 0.50), (side * 0.36, 0.44, 0.0), 0.072, 0.048, bend=0.11)
    for i, side in enumerate((-1, 1), start=2):
        # Not wider than the rump is: a hip further out than the hull reaches is a
        # stub standing beside the animal with daylight between them.
        c.leg(i, (side * 0.18, -0.22, 0.32), (side * 0.25, -0.34, 0.0), 0.062, 0.04)
    return c


def sand_skitterer():
    """Wider than it is long: a flat carapace on six splayed legs."""
    c = Creature("monster.sand_skitterer.v1", "desert", 0.25, 0.6)
    spine = c.body.chain([(0, -0.30, 0.34), (0, -0.04, 0.36), (0, 0.26, 0.34)],
                         [(0.22, 0.11), (0.44, 0.17), (0.28, 0.13)])
    c.body.chain([(0, 0.44, 0.30), (0, 0.56, 0.27)], [(0.15, 0.10), 0.08], parent=spine[-1])
    c.body.add(slab((0, -0.10, 0.46), (0.56, 0.52, 0.06), tilt=-0.12))
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.07, 0.50, 0.36), (0.038, 0.042, 0.033), 6, 4), GLOWS)
        # Mandibles: the only thing out front, so they carry the facing.
        c.body.add(horn([(side * 0.09, 0.56, 0.24), (side * 0.20, 0.78, 0.28),
                         (side * 0.09, 0.92, 0.22)], [0.044, 0.03, 0.0]), BONES)
    for i, (x, y) in enumerate([(-0.28, 0.24), (0.28, 0.24), (-0.30, -0.02), (0.30, -0.02),
                                (-0.28, -0.28), (0.28, -0.28)]):
        # Knee ABOVE the body: a spider's stance, and the reason the outline is
        # legs first and carapace second.
        c.leg(i, (x, y, 0.36), (x * 2.4, y * 1.25, 0.0), 0.05, 0.026, bend=0.0)
    return c


def bramble_whelp():
    """Bark hound: long legs, a ridge of thorns from skull to tail."""
    c = Creature("monster.bramble_whelp.v1", "forest", 0.25, 0.95)
    spine = c.body.chain(
        [(0, -0.38, 0.54), (0, -0.12, 0.60), (0, 0.14, 0.62), (0, 0.32, 0.58)],
        [(0.10, 0.13), (0.24, 0.18), (0.26, 0.20), (0.20, 0.16)])
    neck = c.body.chain([(0, 0.48, 0.54), (0, 0.62, 0.50)], [(0.12, 0.14), (0.17, 0.15)],
                        parent=spine[-1])
    c.body.chain([(0, 0.78, 0.44), (0, 0.88, 0.42)], [0.10, 0.055], parent=neck[-1])
    c.body.chain([(0, -0.52, 0.56), (0, -0.70, 0.62), (0, -0.86, 0.46)],
                 [0.07, 0.045, 0.018], parent=spine[0])
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.07, 0.74, 0.54), (0.036, 0.036, 0.036), 6, 4), GLOWS)
    # The thorns. Six of them stood along the spine at x=0 and could not be seen
    # at all: a comb aimed straight up is edge-on to this camera and lands inside
    # the body's own outline. The same six rooted in the flanks and swept out and
    # back are the whole animal from above, and cost not one extra face.
    for i in range(3):
        y = 0.24 - i * 0.34
        for side in (-1, 1):
            c.body.add(horn([(side * 0.10, y + 0.06, 0.64), (side * 0.30, y - 0.06, 0.80),
                             (side * 0.42, y - 0.22, 0.74)],
                            [0.055 - i * 0.008, 0.036, 0.0], 5), BONES)
    for i, (x, y) in enumerate([(-0.22, 0.18), (0.22, 0.18), (-0.22, -0.22), (0.22, -0.22)]):
        c.leg(i, (x, y, 0.56), (x * 1.2, y, 0.0), 0.075, 0.044, bend=0.08)
    return c


# --------------------------------------------------------------------------
# the shooters: tall, thin, and they keep their distance
# --------------------------------------------------------------------------

def dune_spitter():
    """A sac carried high on four stilts, with a spout aimed forward."""
    c = Creature("monster.dune_spitter.v1", "desert", 0.3, 1.4)
    body = c.body.chain([(0, -0.18, 1.04), (0, 0.02, 1.10), (0, 0.22, 1.12)],
                        [(0.11, 0.14), (0.31, 0.20), (0.22, 0.16)])
    head = c.body.chain([(0, 0.40, 1.14), (0, 0.52, 1.12)], [(0.15, 0.12), 0.11],
                        parent=body[-1])
    c.body.chain([(0, 0.70, 1.06), (0, 0.82, 1.02)], [0.07, 0.03], parent=head[-1])
    c.body.add(ellipsoid((0, -0.04, 0.94), (0.17, 0.19, 0.13), 10, 6), GLOWS)
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.07, 0.52, 1.20), (0.032, 0.032, 0.032), 6, 4), GLOWS)
        c.body.add(slab((side * 0.24, -0.04, 1.24), (0.07, 0.30, 0.26), tilt=0.2))
    for i, (x, y) in enumerate([(-0.16, 0.14), (0.16, 0.14), (-0.16, -0.16), (0.16, -0.16)]):
        # The knee stands well above the body: a wading bird, not a table.
        c.leg(i, (x, y, 1.02), (x * 2.7, y * 1.8, 0.0), 0.07, 0.032,
              bend=0.17 if y > 0 else -0.17)
    return c


def fen_wisp():
    """A drowned skull wrapped in weed, with the light still on inside it.

    A symmetric cage of six staves round a ball is a lantern, and a lantern is
    not frightening. This is a broken skull tipped forward, half wrapped, with
    the glow behind the eye sockets and weed trailing off the back of it — the
    asymmetry is what turns a prop into a thing that is looking at you."""
    c = Creature("monster.fen_wisp.v1", "swamp", 0.225, 1.2)
    skull = c.body.chain([(0, -0.14, 1.14), (0, 0.06, 1.10), (0, 0.22, 1.02)],
                         [(0.19, 0.13), (0.21, 0.15), (0.13, 0.10)])
    c.body.chain([(0, -0.24, 1.24), (0, -0.30, 1.34)], [0.10, 0.05], parent=skull[0])
    c.body.add(ellipsoid((0, 0.02, 1.08), (0.12, 0.14, 0.12), 12, 7), GLOWS)
    for side in (-1, 1):
        # Eye sockets: the glow is behind the hole, not on the outside of it.
        c.body.add(ellipsoid((side * 0.07, 0.16, 1.12), (0.035, 0.035, 0.035), 6, 4), GLOWS)
        # Weed: three strands, different lengths, all trailing to one side.
        for k, (out, back, drop) in enumerate(((0.16, 0.34, 0.40), (0.24, 0.22, 0.56),
                                               (0.10, 0.44, 0.30))):
            c.body.add(horn([(side * 0.10, -0.06, 1.06),
                             (side * (0.10 + out), -0.06 - back * 0.5, 1.06 - drop * 0.45),
                             (side * (0.06 + out * 0.6), -0.06 - back, 1.06 - drop)],
                            [0.035, 0.026, 0.0]), BONES)
    for i in range(4):
        a = 2.0 * math.pi * i / 4 + 0.4
        x, y = 0.11 * math.cos(a), 0.11 * math.sin(a)
        part = c.limb(f"leg{i}", (x, y, 0.94))
        part.chain([(x, y, 0.94), (x * 2.4, y * 2.4, 0.56), (x * 3.2, y * 3.2, 0.14)],
                   [0.042, 0.026, 0.012])
    return c


def hoarfrost_spitter():
    """Antlered biped, frost in every crack, arms long enough to throw with."""
    c = Creature("monster.hoarfrost_spitter.v1", "forest", 0.275, 2.0)
    # An upright chain takes its pair as (across, front-to-back), so a torso that
    # is wide and shallow is one number apart from the barrel it used to be.
    spine = c.body.chain(
        [(0, -0.04, 0.72), (0, 0.06, 1.06), (0, 0.02, 1.36), (0, -0.02, 1.52)],
        [(0.16, 0.18), (0.31, 0.21), (0.33, 0.20), (0.18, 0.14)])
    # Shoulders swept out of the spine, or a thrower has nothing to throw with.
    for side in (-1, 1):
        c.body.chain([(side * 0.24, 0.0, 1.40), (side * 0.34, 0.0, 1.30)],
                     [0.15, 0.11], parent=spine[-2])
    neck = c.body.chain([(0, 0.06, 1.60)], [0.10], parent=spine[-1])
    c.body.chain([(0, 0.12, 1.72), (0, 0.24, 1.68)], [0.16, 0.09], parent=neck[-1])
    c.body.add(slab((0, 0.20, 1.14), (0.10, 0.06, 0.38)), GLOWS)
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.07, 0.26, 1.72), (0.032, 0.032, 0.032), 6, 4), GLOWS)
        # The rack is the outline: a swept beam with three tines, reaching half
        # the skull's height again above it and a third of the body out sideways.
        # Thicker than it looks right in the sculpt: a 0.055 beam on a 2-unit
        # creature is under three percent of its height and renders as a scratch.
        beam = [(side * 0.11, 0.04, 1.82), (side * 0.40, -0.10, 2.10), (side * 0.66, 0.08, 2.24)]
        c.body.add(horn(beam, [0.075, 0.05, 0.0]), BONES)
        c.body.add(horn([(side * 0.26, -0.04, 1.96), (side * 0.44, -0.32, 2.06)],
                        [0.042, 0.0]), BONES)
        c.body.add(horn([(side * 0.50, -0.02, 2.16), (side * 0.62, -0.26, 2.28)],
                        [0.036, 0.0]), BONES)
    for i, side in enumerate((-1, 1)):
        c.arm(i, [(side * 0.34, 0.0, 1.28), (side * 0.44, 0.14, 0.90), (side * 0.36, 0.32, 0.54)],
              [0.075, 0.055, 0.036])
    for i, side in enumerate((-1, 1)):
        c.leg(i, (side * 0.17, 0.0, 0.74), (side * 0.22, 0.0, 0.0), 0.09, 0.05, bend=0.09)
    return c


# --------------------------------------------------------------------------
# the brutes: mid-sized, slow, and they close on you
# --------------------------------------------------------------------------

def vaal_construct():
    """A walking pillar: shoulders carved wider than the waist, and a socket of
    light where a head should be. Its mass is in the SKELETON, not in plates
    stuck on the outside of one — a shoulder that is a box floating beside a
    torso is the single loudest amateur tell on this whole roster."""
    c = Creature("monster.vaal_construct.v1", "vaal", 0.375, 1.9)
    # Wider across than it is deep at every height, and widest at the shoulder:
    # "carved wider than the waist" was written in the docstring and then built
    # as a round column, which is the whole reason this one read as a box.
    spine = c.body.chain([(0, 0, 0.76), (0, 0.03, 1.08), (0, 0.02, 1.42), (0, 0, 1.62)],
                         [(0.29, 0.22), (0.23, 0.21), (0.45, 0.26), (0.38, 0.23)])
    for side in (-1, 1):
        c.body.chain([(side * 0.34, 0.0, 1.58), (side * 0.52, 0.0, 1.46)],
                     [0.24, 0.19], parent=spine[-1])
        # Sunk to HALF its thickness: a plate is set into the stone, not resting
        # on it, and the shadow line where it enters is what sells it.
        c.body.add(slab((side * 0.34, 0.20, 1.20), (0.20, 0.07, 0.62), tilt=0.05))
        # The crown spikes rake back over the shoulders instead of standing up.
        c.body.add(horn([(side * 0.30, -0.14, 1.70), (side * 0.66, -0.40, 1.82)],
                        [0.07, 0.0]), BONES)
    # The socket: a recessed collar with the glyph burning at the bottom of it,
    # so the light has somewhere to come FROM.
    c.body.add(slab((0, 0.08, 1.70), (0.34, 0.30, 0.16), tilt=0.10))
    c.body.add(ellipsoid((0, 0.14, 1.76), (0.13, 0.11, 0.11), 10, 6), GLOWS)
    for i, side in enumerate((-1, 1)):
        c.arm(i, [(side * 0.58, 0.0, 1.42), (side * 0.68, 0.14, 1.02), (side * 0.64, 0.24, 0.66)],
              [0.15, 0.12, 0.17])
    for i, side in enumerate((-1, 1)):
        c.leg(i, (side * 0.26, 0.0, 0.78), (side * 0.34, 0.0, 0.0), 0.16, 0.11, bend=0.06)
    return c


def bog_drowned():
    """Hunched, bloated, arms to the floor, head hanging off a broken neck."""
    c = Creature("monster.bog_drowned.v1", "swamp", 0.325, 1.7)
    spine = c.body.chain(
        [(0, -0.04, 0.70), (0, 0.02, 1.00), (0, 0.06, 1.26), (0, 0.04, 1.42)],
        [(0.26, 0.22), (0.40, 0.28), (0.35, 0.23), (0.23, 0.18)])
    neck = c.body.chain([(0.05, 0.14, 1.50)], [0.11], parent=spine[-1])
    c.body.chain([(0.12, 0.30, 1.54), (0.14, 0.42, 1.50)], [0.15, 0.09], parent=neck[-1])
    # Ribs split open on the left — the asymmetry is what stops it reading human.
    c.body.add(slab((-0.17, 0.26, 1.10), (0.19, 0.09, 0.40), tilt=0.22), BONES)
    c.body.add(slab((-0.17, 0.32, 1.10), (0.10, 0.06, 0.30), tilt=0.22), GLOWS)
    for side in (-1, 1):
        c.body.add(ellipsoid((0.12 + side * 0.06, 0.42, 1.56), (0.03, 0.03, 0.03), 6, 4), GLOWS)
        # A paddle off each flank, laid nearly flat: from overhead this is what
        # the shoulders are, and a thin upright fin at the same place is nothing.
        c.body.add(slab((side * 0.38, -0.08, 1.26), (0.28, 0.34, 0.11), tilt=0.25))
    for i, side in enumerate((-1, 1)):
        # Knuckles nearly on the floor: the whole reason it reads as drowned.
        c.arm(i, [(side * 0.37, 0.0, 1.30), (side * 0.50, 0.16, 0.82), (side * 0.44, 0.34, 0.26)],
              [0.095, 0.076, 0.06])
    for i, side in enumerate((-1, 1)):
        c.leg(i, (side * 0.22, 0.0, 0.72), (side * 0.28, 0.02, 0.0), 0.115, 0.075, bend=0.07)
    return c


def thornhide_boar():
    """Bark plates over a boar's mass, tusks up, head carried low to charge."""
    c = Creature("monster.thornhide_boar.v1", "forest", 0.35, 1.4)
    spine = c.body.chain(
        [(0, -0.58, 0.88), (0, -0.24, 0.96), (0, 0.16, 1.02), (0, 0.44, 0.92)],
        [(0.22, 0.15), (0.40, 0.28), (0.48, 0.33), (0.37, 0.27)])
    neck = c.body.chain([(0, 0.68, 0.78)], [(0.30, 0.24)], parent=spine[-1])
    c.body.chain([(0, 0.92, 0.66), (0, 1.06, 0.62)], [0.19, 0.11], parent=neck[-1])
    c.body.chain([(0, -0.72, 0.94), (0, -0.88, 1.02)], [0.07, 0.028], parent=spine[0])
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.10, 0.94, 0.74), (0.042, 0.042, 0.042), 6, 4), GLOWS)
        c.body.add(horn([(side * 0.11, 1.00, 0.54), (side * 0.22, 1.16, 0.76),
                         (side * 0.14, 1.06, 0.94)], [0.055, 0.034, 0.0]), BONES)
    # Bark growing THROUGH the hide, not resting on it: each plate is a wedge
    # rooted below the surface and leaning back, in a staggered double row. Flat
    # boxes laid on a spine are the thing that reads as a model kit.
    for i in range(4):
        y = 0.34 - i * 0.32
        r = 0.42 - abs(y) * 0.16
        for side in (-1, 1):
            c.body.add(horn([(side * r * 0.30, y + 0.06, 0.94),
                             (side * r * 0.46, y - 0.02, 1.30),
                             (side * r * 0.52, y - 0.14, 1.46)],
                            [0.10, 0.075, 0.0], 5), BONES)
        c.body.add(horn([(0, y + 0.08, 1.02), (0, y - 0.04, 1.36), (0, y - 0.18, 1.54)],
                        [0.12, 0.09, 0.0], 5), BONES)
    for i, (x, y) in enumerate([(-0.32, 0.28), (0.32, 0.28), (-0.32, -0.36), (0.32, -0.36)]):
        c.leg(i, (x, y, 0.78), (x * 1.15, y, 0.0), 0.125, 0.072, bend=0.08)
    return c


# --------------------------------------------------------------------------
# the heavies: the loudest thing in a pack, and the slowest
# --------------------------------------------------------------------------

def blood_sentinel():
    """A statue with a mantle and one blade too big for the arm holding it."""
    c = Creature("monster.blood_sentinel.v1", "vaal", 0.4, 2.1)
    spine = c.body.chain([(0, 0, 0.86), (0, 0.03, 1.22), (0, 0.02, 1.62), (0, 0, 1.82)],
                         [(0.27, 0.21), (0.25, 0.19), (0.40, 0.25), (0.32, 0.21)])
    # The mantle is BUILT, not bolted: two shoulder masses swept out of the neck,
    # with a thin ridge over them. A 1.08-wide board across the back was a shelf.
    for side in (-1, 1):
        c.body.chain([(side * 0.28, -0.02, 1.76), (side * 0.50, -0.04, 1.62),
                      (side * 0.60, -0.02, 1.42)],
                     [0.26, 0.22, 0.14], parent=spine[-1])
        c.body.add(slab((side * 0.40, -0.03, 1.84), (0.44, 0.42, 0.09), tilt=0.22))
        c.body.add(horn([(side * 0.34, -0.06, 1.90), (side * 0.48, -0.22, 2.32)],
                        [0.08, 0.0]), BONES)
        c.body.add(slab((side * 0.16, 0.20, 1.28), (0.10, 0.06, 0.80)))
    # No skull: a helm slit sunk into the collar between the shoulders.
    c.body.chain([(0, 0.10, 1.96), (0, 0.20, 1.94)], [0.16, 0.13], parent=spine[-1])
    c.body.add(slab((0, 0.30, 1.96), (0.20, 0.05, 0.05)), GLOWS)
    # The blade arm: right side only. Symmetry is what made the old imp read as
    # a toy — one oversized limb is the whole silhouette.
    blade = c.limb("arm0", (0.50, 0.0, 1.62))
    blade.chain([(0.50, 0.0, 1.62), (0.66, 0.10, 1.16)], [0.14, 0.115])
    blade.add(slab((0.72, 0.42, 0.98), (0.11, 1.10, 0.34), tilt=0.22), BONES)
    c.arm(1, [(-0.46, 0.0, 1.62), (-0.56, 0.16, 1.14), (-0.50, 0.28, 0.84)], [0.10, 0.08, 0.062])
    for i, side in enumerate((-1, 1)):
        c.leg(i, (side * 0.24, 0.0, 0.86), (side * 0.30, 0.0, 0.0), 0.145, 0.10, bend=0.05)
    return c


def sunbaked_colossus():
    """All shoulder: a quadruped bull whose head is nearly an afterthought."""
    c = Creature("monster.sunbaked_colossus.v1", "desert", 0.425, 1.8)
    spine = c.body.chain(
        [(0, -0.76, 1.02), (0, -0.34, 1.08), (0, 0.14, 1.24), (0, 0.44, 1.18)],
        [(0.24, 0.16), (0.48, 0.31), (0.62, 0.40), (0.50, 0.34)])
    # The hump: a bull's mass sits over the FRONT legs, which is what makes the
    # head look small instead of the body look long.
    c.body.chain([(0, 0.24, 1.52)], [(0.44, 0.30)], parent=spine[2])
    neck = c.body.chain([(0, 0.66, 1.04)], [(0.32, 0.26)], parent=spine[-1])
    c.body.chain([(0, 0.94, 0.88), (0, 1.12, 0.84)], [0.21, 0.13], parent=neck[-1])
    c.body.chain([(0, -0.90, 1.06), (0, -1.12, 0.92), (0, -1.24, 0.68)],
                 [0.09, 0.06, 0.024], parent=spine[0])
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.11, 1.00, 0.96), (0.048, 0.048, 0.048), 6, 4), GLOWS)
        c.body.add(horn([(side * 0.18, 0.92, 1.02), (side * 0.52, 0.98, 1.22),
                         (side * 0.62, 1.18, 1.06)], [0.075, 0.048, 0.0]), BONES)
        # Shoulder armour swept out of the hump itself, and a second, smaller
        # plate over the haunch: two masses per flank give the plan view a waist
        # between them, which one continuous barrel never has.
        c.body.add(horn([(side * 0.14, 0.30, 1.36), (side * 0.54, 0.24, 1.52),
                         (side * 0.68, 0.06, 1.44)], [0.20, 0.14, 0.0], 5))
        c.body.add(horn([(side * 0.16, -0.52, 1.16), (side * 0.48, -0.58, 1.26),
                         (side * 0.58, -0.74, 1.18)], [0.15, 0.10, 0.0], 5))
    for i, (x, y) in enumerate([(-0.38, 0.28), (0.38, 0.28), (-0.38, -0.46), (0.38, -0.46)]):
        c.leg(i, (x, y, 0.96), (x * 1.15, y, 0.0), 0.15, 0.10, bend=0.07)
    return c


def rotting_behemoth():
    """A sack of rot on four short legs, split down the spine and lit from inside."""
    c = Creature("monster.rotting_behemoth.v1", "swamp", 0.4, 2.0)
    spine = c.body.chain(
        [(0, -0.70, 1.08), (0, -0.28, 1.20), (0, 0.24, 1.24), (0, 0.58, 1.08)],
        [(0.28, 0.17), (0.60, 0.34), (0.68, 0.37), (0.46, 0.27)])
    neck = c.body.chain([(0, 0.82, 0.94)], [(0.32, 0.25)], parent=spine[-1])
    c.body.chain([(0, 1.06, 0.84), (0, 1.20, 0.80)], [0.20, 0.12], parent=neck[-1])
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.10, 1.12, 0.90), (0.042, 0.042, 0.042), 6, 4), GLOWS)
    # The back has split, and what is inside is lit. Two bone lips hold the wound
    # open and the light sits BETWEEN them, below the skin line — a bar laid on
    # top of the spine was a glowstick taped to a pig.
    # The lips ride OUT along the shoulder of the back instead of standing up
    # beside the split. Held near the spine they were a two-centimetre bump on a
    # body 1.3 across; carried onto the flank they are the row of teeth that makes
    # a potato into something that has been opened.
    for side in (-1, 1):
        for k in range(5):
            y = 0.44 - k * 0.28
            c.body.add(horn([(side * 0.08, y, 1.36), (side * 0.42, y - 0.02, 1.46),
                             (side * 0.54, y - 0.10, 1.36)], [0.11, 0.08, 0.0], 5), BONES)
    for k in range(5):
        y = 0.44 - k * 0.28
        c.body.add(ellipsoid((0, y, 1.44), (0.11, 0.13, 0.10), 10, 6), GLOWS)
    # Sacs swelling out of the flank, half inside it, hide-coloured: growths are
    # part of the animal, and a grey cap on a stalk is a mushroom.
    for i, (x, y, r) in enumerate(((0.56, 0.24, 0.22), (-0.62, -0.10, 0.26),
                                   (0.48, -0.46, 0.18), (-0.40, 0.52, 0.16))):
        c.body.add(ellipsoid((x, y, 1.20 + r * 0.3), (r, r * 1.15, r * 0.85), 12, 7))
    for i, (x, y) in enumerate([(-0.44, 0.30), (0.44, 0.30), (-0.44, -0.42), (0.44, -0.42)]):
        c.leg(i, (x, y, 0.88), (x * 1.2, y, 0.0), 0.155, 0.10, bend=0.05)
    return c


# --------------------------------------------------------------------------
# the bosses: one per biome, and each one is the room's silhouette
# --------------------------------------------------------------------------

def cinder_warden():
    """Vaal Stone. A furnace on two legs, carrying the slab it slams with."""
    c = Creature("monster.cinder_warden.v1", "cinder", 0.5, 2.9)
    spine = c.body.chain([(0, 0, 1.16), (0, 0.04, 1.74), (0, 0, 2.30)],
                         [(0.44, 0.33), (0.54, 0.36), (0.48, 0.31)])
    c.body.chain([(0, 0.06, 2.52), (0, 0.14, 2.72)], [0.20, 0.26], parent=spine[-1])
    c.body.add(ellipsoid((0, 0.30, 1.86), (0.38, 0.22, 0.44), 12, 7), GLOWS)
    c.body.add(slab((0, 0, 2.42), (1.46, 0.78, 0.30), tilt=0.10))
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.11, 0.36, 2.78), (0.055, 0.055, 0.055), 6, 4), GLOWS)
        # The crown rakes outward as much as up: the tips end up over the
        # shoulders, where the plan view still has them.
        for dx, dz in ((0.16, 0.40), (0.46, 0.28), (0.72, 0.10)):
            c.body.add(horn([(side * (0.14 + dx * 0.5), 0.02, 2.76),
                             (side * (0.28 + dx), -0.16, 2.76 + dz)], [0.08, 0.0]), BONES)
    # The slab arm is the tell: it is what the telegraph is about to come from.
    hammer = c.limb("arm0", (0.70, 0.0, 2.22))
    hammer.chain([(0.70, 0.0, 2.22), (1.02, 0.16, 1.52)], [0.22, 0.18])
    hammer.add(slab((1.12, 0.24, 1.08), (0.54, 0.76, 0.52)))
    hammer.add(slab((1.12, 0.24, 1.08), (0.58, 0.24, 0.14)), GLOWS)
    c.arm(1, [(-0.70, 0.0, 2.22), (-0.90, 0.20, 1.62), (-0.82, 0.38, 1.16)], [0.17, 0.14, 0.12])
    for i, side in enumerate((-1, 1)):
        c.leg(i, (side * 0.38, 0.0, 1.16), (side * 0.48, 0.0, 0.0), 0.24, 0.16, bend=0.09)
    return c


def sirrath():
    """Desert. A sun-priest on six stilts, carrying its own censers.

    Three bare glowing balls on sticks read as a toy. Each sac now hangs INSIDE a
    split chitin husk that only opens toward the front, so the light is a slot
    seen edge-on from behind and a furnace seen head-on — which is exactly the
    information a player wants about a thing that is winding up a volley."""
    c = Creature("monster.sirrath.v1", "desert", 0.45, 2.8)
    spine = c.body.chain([(0, -0.04, 1.42), (0, 0.06, 1.82), (0, 0.02, 2.16), (0, -0.02, 2.32)],
                         [(0.26, 0.18), (0.46, 0.30), (0.42, 0.26), (0.30, 0.20)])
    c.body.shape((0.82, 1.0, 1.0), pivot=(0, 0, 1.4))
    c.body.chain([(0, 0.22, 2.24), (0, 0.36, 2.20)], [0.15, 0.18], parent=spine[-2])
    for dx, dy in ((0.0, 0.30), (-0.40, 0.02), (0.40, 0.02)):
        c.body.chain([(dx * 0.4, dy * 0.4, 2.28), (dx, dy, 2.54)], [0.10, 0.15],
                     parent=spine[-1])
        c.body.add(ellipsoid((dx, dy, 2.68), (0.15, 0.15, 0.17), 12, 7), GLOWS)
        # The husk: two shells clamped round the sac, open toward +y.
        for sh in (-1, 1):
            c.body.add(horn([(dx + sh * 0.20, dy - 0.20, 2.60), (dx + sh * 0.22, dy - 0.02, 2.76),
                             (dx + sh * 0.12, dy + 0.16, 2.84)],
                            [0.075, 0.085, 0.045]), BONES)
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.08, 0.48, 2.24), (0.04, 0.04, 0.04), 6, 4), GLOWS)
        # Robe: a long shell down each flank, half sunk into the body and now
        # standing clear of it, so the plan outline is three masses and not one.
        c.body.add(slab((side * 0.46, 0.02, 1.80), (0.22, 0.44, 0.86), tilt=0.08))
    for i, (x, y) in enumerate([(-0.30, 0.24), (0.30, 0.24), (-0.34, 0.0), (0.34, 0.0),
                                (-0.30, -0.26), (0.30, -0.26)]):
        c.leg(i, (x, y, 1.46), (x * 3.4, y * 2.4, 0.0), 0.11, 0.046,
              bend=0.26 if y > 0 else -0.26)
    return c


def mother_vhal():
    """Swamp. A cathedral of ribs over a brood sac, on eight heaving tendrils.

    The first version was one 0.9-radius node and read as an egg, which is what
    happens whenever a boss's mass is a single sphere: nothing casts a shadow on
    anything. The mass is now a LOW, WIDE abdomen carried between rib arches, so
    the outline from above is a cage with light coming through it."""
    c = Creature("monster.mother_vhal.v1", "swamp", 0.475, 3.1)
    spine = c.body.chain(
        [(0, -1.00, 0.96), (0, -0.46, 1.10), (0, 0.16, 1.18), (0, 0.66, 1.06), (0, 0.94, 1.34)],
        [0.26, 0.62, 0.70, 0.52, 0.40])
    # Flattened: an abdomen wider than it is tall, so the ribs stand clear of it.
    c.body.shape((1.35, 1.0, 0.72), pivot=(0, 0, 0.30))
    neck = c.body.chain([(0, 1.10, 1.86), (0, 1.16, 2.36)], [0.34, 0.26], parent=spine[-1])
    c.body.chain([(0, 1.26, 2.68), (0, 1.40, 2.62)], [0.28, 0.17], parent=neck[-1])
    c.body.add(ellipsoid((0, 0.06, 0.86), (0.74, 0.94, 0.42), 14, 8), GLOWS)
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.13, 1.46, 2.70), (0.06, 0.06, 0.06), 6, 4), GLOWS)
        c.body.add(horn([(side * 0.22, 1.18, 2.86), (side * 0.46, 0.94, 3.24)],
                        [0.09, 0.0]), BONES)
        # Five arches per side, springing from the spine and closing under the
        # sac. They are the outline, and the sac only glows between them.
        for k in range(5):
            y = 0.72 - k * 0.36
            c.body.add(horn([(side * 0.10, y, 1.52), (side * 0.86, y - 0.03, 1.28),
                             (side * 1.02, y - 0.05, 0.74), (side * 0.66, y - 0.06, 0.34)],
                            [0.10, 0.085, 0.07, 0.04]), BONES)
    for i in range(8):
        a = 2.0 * math.pi * i / 8 + 0.2
        x, y = 0.92 * math.cos(a), 1.02 * math.sin(a)
        part = c.limb(f"leg{i}", (x, y, 0.74))
        part.chain([(x, y, 0.74), (x * 1.45, y * 1.35, 0.40), (x * 1.75, y * 1.6, 0.04)],
                   [0.15, 0.10, 0.055])
        part.add(ellipsoid((x * 1.75, y * 1.6, 0.05), (0.10, 0.10, 0.05), 8, 5))
    return c


def ghaltrek():
    """Forest. Antler rack wider than the corridor it comes down, head already low."""
    c = Creature("monster.ghaltrek.v1", "forest", 0.45, 2.5)
    spine = c.body.chain(
        [(0, -1.10, 1.38), (0, -0.52, 1.50), (0, 0.24, 1.64), (0, 0.78, 1.54)],
        [(0.30, 0.21), (0.60, 0.42), (0.76, 0.52), (0.64, 0.44)])
    c.body.chain([(0, 0.42, 1.94)], [(0.52, 0.36)], parent=spine[2])
    neck = c.body.chain([(0, 1.08, 1.30)], [(0.36, 0.29)], parent=spine[-1])
    c.body.chain([(0, 1.46, 1.10), (0, 1.70, 1.02)], [0.24, 0.15], parent=neck[-1])
    c.body.chain([(0, -1.24, 1.44), (0, -1.48, 1.56)], [0.10, 0.035], parent=spine[0])
    for side in (-1, 1):
        c.body.add(ellipsoid((side * 0.15, 1.52, 1.18), (0.05, 0.05, 0.05), 6, 4), GLOWS)
        # Tusks forward, so the charge has a point on it.
        c.body.add(horn([(side * 0.15, 1.64, 0.92), (side * 0.26, 2.04, 1.06)],
                        [0.06, 0.0]), BONES)
        # The rack. 1.3 units across per side — wider than she is long, and the
        # only thing about this fight anybody will describe afterwards.
        beam = [(side * 0.24, 1.24, 1.58), (side * 0.72, 1.10, 2.12),
                (side * 1.14, 0.66, 2.38), (side * 1.30, 0.10, 2.32)]
        c.body.add(horn(beam, [0.135, 0.10, 0.068, 0.0], 7), BONES)
        for t, out, up in ((0.35, 0.10, 0.42), (0.75, 0.16, 0.46), (1.15, 0.20, 0.38),
                           (1.60, 0.16, 0.34), (2.30, 0.14, 0.30)):
            i0 = min(int(t), len(beam) - 2)
            f = t - i0
            p = [beam[i0][k] + (beam[i0 + 1][k] - beam[i0][k]) * f for k in range(3)]
            c.body.add(horn([tuple(p), (p[0] + side * out, p[1] - 0.14, p[2] + up)],
                            [0.072, 0.0]), BONES)
        # Bark ridges growing out of the flank, rooted well inside it.
        for k in range(4):
            y = 0.42 - k * 0.44
            c.body.add(horn([(side * 0.24, y + 0.06, 1.62), (side * 0.58, y, 1.92),
                             (side * 0.66, y - 0.12, 2.06)],
                            [0.13, 0.09, 0.0], 5), BONES)
    for i, (x, y) in enumerate([(-0.50, 0.42), (0.50, 0.42), (-0.50, -0.68), (0.50, -0.68)]):
        c.leg(i, (x, y, 1.20), (x * 1.15, y, 0.0), 0.185, 0.115, bend=0.10)
    return c


BOSS_FAMILIES = {
    "monster.cinder_warden.v1": "cinder",
    "monster.sirrath.v1": "desert",
    "monster.mother_vhal.v1": "swamp",
    "monster.ghaltrek.v1": "forest",
}

SPECIES = [
    cinder_imp, vaal_husk, sand_skitterer, bramble_whelp,
    dune_spitter, fen_wisp, hoarfrost_spitter,
    vaal_construct, bog_drowned, thornhide_boar,
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
