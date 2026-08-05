"""Build the level's blocker rocks as one glTF: boulders, dunes and dune weed.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python tools/build_rocks.py

Why this exists
---------------
A wall cell was a box. At this camera a box shows one lit side, one shaded side
and a capped top, and a field of them scattered across open floor is the exact
silhouette Minecraft has — which is the thing the whole in-map art pass is
trying to stop being. No amount of texture fixes it, because the read comes from
the outline: six identical right angles per blocker, repeated on a grid.

So the blockers become rock. Each variant is an icosphere pushed around by
fractal value noise, then sliced by a few random planes and flat-shaded, which
is what turns a lumpy potato into something with facets and edges the light can
catch. The base is flattened so the rock sits ON the ground rather than through
it, and the whole thing is normalised to a 1x1x1 box so the runtime can scale it
in world units without knowing anything about how it was made.

No materials and no textures here on purpose
--------------------------------------------
The rock wears its biome's own `wall_color`/`wall_normal` plate, assigned by the
runtime (`rocks.ts`) from the same material the merged wall band already uses. So
one glb serves every tileset, the rock in a swamp is swamp rock, and adding a
biome costs nothing here. UVs are therefore box-projected in WORLD units at the
renderer's `TILE = 2` repeat, so a rock's grain matches the wall band it sits on
no matter how much the runtime scales it — a per-object unwrap would make the
stone grow with the boulder.
"""
import math
import os

import bpy
import mathutils
import numpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "web", "public", "models", "rocks.glb")
SOURCE_DIR = os.path.join(ROOT, "assets", "props", "source")
BUILD_DIR = os.path.join(ROOT, "assets", "props", "build", "flora")

VARIANTS = 6
# Icosphere subdivision. 3 (1280 tris) is nearly twice the silhouette quality of
# 2 and the whole boundary of a map is ONE draw call of thin instances, so the
# triangle count is the only cost and 1280 x ~600 rocks is a rounding error next
# to what the character rig already spends.
SUBDIV = 3
# World units per texture repeat. Must match TILE in apps/web/src/render/level.ts.
TILE = 2.0
# How far the noise may push a vertex off the sphere, as a fraction of radius.
# Past ~0.45 the shape starts self-intersecting at the deep pits.
RELIEF = 0.38
# Planar slices per rock. Each one shears a cap flat and gives the flat shading
# something large to work with; 4 reads as a broken boulder, 8 as a gemstone.
SLICES = 4


def fbm(points, seed):
    """Fractal value noise in [0,1] at unit-cube `points`, three octaves."""
    rng = numpy.random.default_rng(seed)
    total = numpy.zeros(len(points))
    norm = 0.0
    for octave, (res, amp) in enumerate(((3, 1.0), (6, 0.5), (13, 0.25))):
        lattice = rng.random((res + 1, res + 1, res + 1))
        p = numpy.clip(points, 0.0, 0.9999) * res
        i = numpy.floor(p).astype(int)
        f = p - i
        w = f * f * (3.0 - 2.0 * f)  # smoothstep, so octaves stay C1
        acc = numpy.zeros(len(points))
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    wt = (w[:, 0] if dx else 1.0 - w[:, 0])
                    wt = wt * (w[:, 1] if dy else 1.0 - w[:, 1])
                    wt = wt * (w[:, 2] if dz else 1.0 - w[:, 2])
                    acc += wt * lattice[i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
        total += amp * acc
        norm += amp
    return total / norm


def build_rock(index):
    seed = 1000 + index * 37
    rng = numpy.random.default_rng(seed)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=SUBDIV, radius=1.0)
    obj = bpy.context.object
    obj.name = f"rock_{index}"
    me = obj.data

    v = numpy.array([tuple(vert.co) for vert in me.vertices], dtype=float)

    # Squash first, displace second. Displacing a sphere and squashing the result
    # squashes the noise too, and every rock ends up wearing the same wavelength
    # stretched differently; this way each variant's grain is its own.
    v *= rng.uniform(0.72, 1.28, size=3)

    n = fbm((v / numpy.abs(v).max() + 1.0) * 0.5, seed)
    length = numpy.linalg.norm(v, axis=1, keepdims=True)
    v *= 1.0 + RELIEF * (n[:, None] * 2.0 - 1.0)
    del length

    # Slice caps flat. A plane that never points down keeps the base broad: a
    # boulder sliced from below is a boulder balanced on a point.
    for _ in range(SLICES):
        d = rng.normal(size=3)
        d[2] = abs(d[2]) * 0.6 + 0.15
        d /= numpy.linalg.norm(d)
        proj = v @ d
        cut = numpy.quantile(proj, rng.uniform(0.80, 0.94))
        over = proj > cut
        v[over] -= numpy.outer(proj[over] - cut, d)

    # Flat base, then sit the rock on z=0. Rocks are placed on the ground plane
    # and never conform to it, so anything below zero is geometry nobody sees.
    floor = numpy.quantile(v[:, 2], 0.12)
    v[:, 2] = numpy.maximum(v[:, 2], floor)
    v[:, 2] -= floor

    # Normalise into a unit box: the runtime scales in world units and must not
    # have to know that variant 4 happened to come out of the noise 12% wider.
    span = numpy.array([
        v[:, 0].max() - v[:, 0].min(),
        v[:, 1].max() - v[:, 1].min(),
        v[:, 2].max() - v[:, 2].min(),
    ])
    v[:, 0] -= (v[:, 0].max() + v[:, 0].min()) * 0.5
    v[:, 1] -= (v[:, 1].max() + v[:, 1].min()) * 0.5
    v /= numpy.maximum(span, 1e-6)

    for vert, co in zip(me.vertices, v):
        vert.co = co

    me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
    me.update()
    box_project(me)
    return obj


# --------------------------------------------------------------------------
# the coast's boundary: the ledge, and the scrub that grows over it
# --------------------------------------------------------------------------
#
# THE COAST'S WALL IS NOT A BOULDER CHAIN AND NOT A CLIFF. Four references say
# what it is. `reference-screenshots/strand-map-layout2.png` (the revealed
# overview) draws the Strand's whole landward boundary as a narrow ribbon under a
# solid mat of khaki-olive scrub, and `strand-map1.jpg.png` shows the same thing
# at gameplay zoom: a smooth ROUNDED rock mass, dark and pebbled, with fern and
# broad leaf spilling over its lip. `beach-map-walls.png` and `beach-map.jpg` are
# the other side of the brief — the beach's own look, warm gold sand with wind
# ripples — and its boundary is jungle undergrowth running out onto the sand.
#
# So the coast borders with these two instead of with `rock_*`: a low smooth
# swell for the ledge, and a blade clump for the mat over it. Both are the same
# icosphere/quad machinery at settings no boulder would take, because the runtime
# already knows how to scatter a mesh along a wall run and nothing is gained by
# teaching it a second way. The ledge wears the biome's own wall plate, which for
# this tileset is a brown-and-moss coastal ground scan (see
# `assets/tilesets/coast/SOURCE.md` for why that swap happened).

DUNES = 5
# Barely a tenth of the boulder's RELIEF. The ledge is a SWELL: past ~0.2 the
# noise starts reading as lumps, which is the boulder silhouette this exists to
# escape.
DUNE_RELIEF = 0.16
# Where the base is cut, as a quantile of height. Much lower than the boulder's
# 0.12 — the ledge wants a broad dome coming out of the beach, not a rock resting
# on a flat it was sliced along.
DUNE_FLOOR_Q = 0.04

LEDGES = 5
# Between the boulder's 0.38 and the ledge-mound's 0.16. At 0.16 a shape scaled
# to two and a half units across came off the screen as an inflated balloon —
# "bubble wrap" is the exact read — because a low-relief dome has nothing on it
# for the light to break over once it is that big. Two slices then give the mass
# the planes `strand-map1.jpg.png`'s rock face has without turning it into the
# faceted boulder the coast is not made of.
LEDGE_RELIEF = 0.3
LEDGE_SLICES = 2

WEEDS = 4
BLADES = 48
# Segments per blade. 4 is enough to bend one; the whole point is the fuzzy mass,
# not any single blade, and at this camera a blade is about two pixels wide.
BLADE_SEGMENTS = 4
# Blade half-width at the root, in the clump's own unit box.
BLADE_ROOT = 0.022


def build_dune(index):
    """A low smooth swell, normalised into the same unit box as a boulder."""
    seed = 4000 + index * 53
    rng = numpy.random.default_rng(seed)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=SUBDIV, radius=1.0)
    obj = bpy.context.object
    obj.name = f"dune_{index}"
    me = obj.data

    v = numpy.array([tuple(vert.co) for vert in me.vertices], dtype=float)
    v *= rng.uniform(0.75, 1.3, size=3)
    n = fbm((v / numpy.abs(v).max() + 1.0) * 0.5, seed)
    v *= 1.0 + DUNE_RELIEF * (n[:, None] * 2.0 - 1.0)

    # No planar slices, unlike a boulder: a slice is what gives rock its facets
    # and a facet is exactly what must not appear on a sand berm.
    floor = numpy.quantile(v[:, 2], DUNE_FLOOR_Q)
    v[:, 2] = numpy.maximum(v[:, 2], floor)
    v[:, 2] -= floor

    span = numpy.array([
        v[:, 0].max() - v[:, 0].min(),
        v[:, 1].max() - v[:, 1].min(),
        v[:, 2].max() - v[:, 2].min(),
    ])
    v[:, 0] -= (v[:, 0].max() + v[:, 0].min()) * 0.5
    v[:, 1] -= (v[:, 1].max() + v[:, 1].min()) * 0.5
    v /= numpy.maximum(span, 1e-6)

    for vert, co in zip(me.vertices, v):
        vert.co = co

    # Smooth, where a boulder is flat-shaded. Flat shading is what makes stone
    # catch the light in planes; sand has no planes to catch it in.
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    box_project(me)
    return obj


def build_ledge(index):
    """The landward wall's mass: bigger relief than a mound, a couple of planes,
    still smooth-shaded so it never reads as the dungeon's broken boulder."""
    seed = 9000 + index * 71
    rng = numpy.random.default_rng(seed)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=SUBDIV, radius=1.0)
    obj = bpy.context.object
    obj.name = f"ledge_{index}"
    me = obj.data

    v = numpy.array([tuple(vert.co) for vert in me.vertices], dtype=float)
    v *= rng.uniform(0.7, 1.35, size=3)
    n = fbm((v / numpy.abs(v).max() + 1.0) * 0.5, seed)
    v *= 1.0 + LEDGE_RELIEF * (n[:, None] * 2.0 - 1.0)

    for _ in range(LEDGE_SLICES):
        d = rng.normal(size=3)
        d[2] = abs(d[2]) * 0.4 + 0.1
        d /= numpy.linalg.norm(d)
        proj = v @ d
        cut = numpy.quantile(proj, rng.uniform(0.78, 0.9))
        over = proj > cut
        v[over] -= numpy.outer(proj[over] - cut, d)

    floor = numpy.quantile(v[:, 2], 0.08)
    v[:, 2] = numpy.maximum(v[:, 2], floor)
    v[:, 2] -= floor

    span = numpy.array([
        v[:, 0].max() - v[:, 0].min(),
        v[:, 1].max() - v[:, 1].min(),
        v[:, 2].max() - v[:, 2].min(),
    ])
    v[:, 0] -= (v[:, 0].max() + v[:, 0].min()) * 0.5
    v[:, 1] -= (v[:, 1].max() + v[:, 1].min()) * 0.5
    v /= numpy.maximum(span, 1e-6)

    for vert, co in zip(me.vertices, v):
        vert.co = co

    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    box_project(me)
    return obj


def build_weed(index):
    """A clump of blades: real geometry, not an alpha card.

    Single-sided on purpose — the runtime turns backface culling off for the weed
    material, which halves the triangles for a shape whose whole job is to be a
    silhouette. Blades are rooted in a small disc rather than a point so the clump
    has a footprint and does not read as a firework.
    """
    rng = numpy.random.default_rng(7000 + index * 61)
    verts = []
    faces = []
    uvs = []
    for _ in range(BLADES):
        angle = rng.uniform(0.0, 2.0 * math.pi)
        # Lean away from the clump's centre, hard: an upright tuft reads as a
        # brush, and every reference photo of marram has the blades falling open.
        lean = rng.uniform(0.55, 1.15)
        root_r = rng.uniform(0.0, 0.22)
        height = rng.uniform(0.62, 1.0)
        # Which way the blade's flat face points. Perpendicular to its growth, so
        # a blade presents its width to the side and its edge along the arc.
        side = numpy.array([-math.sin(angle), math.cos(angle), 0.0])
        base = len(verts)
        for s in range(BLADE_SEGMENTS + 1):
            t = s / BLADE_SEGMENTS
            # A quarter-circle arc from vertical toward `lean`, so the tip droops
            # instead of the blade being a straight spike.
            bend = lean * t * t
            x = math.cos(angle) * bend * height
            y = math.sin(angle) * bend * height
            z = math.sin((1.0 - bend * 0.6) * math.pi * 0.5) * t * height
            half = BLADE_ROOT * (1.0 - t) ** 0.7
            verts.append((x - side[0] * half + math.cos(angle) * root_r,
                          y - side[1] * half + math.sin(angle) * root_r, z))
            verts.append((x + side[0] * half + math.cos(angle) * root_r,
                          y + side[1] * half + math.sin(angle) * root_r, z))
            uvs.append((0.0, t))
            uvs.append((1.0, t))
        for s in range(BLADE_SEGMENTS):
            a = base + s * 2
            faces.append((a, a + 1, a + 3, a + 2))

    me = bpy.data.meshes.new(f"weed_{index}")
    me.from_pydata(verts, [], faces)
    me.validate()
    obj = bpy.data.objects.new(f"weed_{index}", me)
    bpy.context.scene.collection.objects.link(obj)

    v = numpy.array(verts, dtype=float)
    span = numpy.array([
        max(v[:, 0].max() - v[:, 0].min(), 1e-6),
        max(v[:, 1].max() - v[:, 1].min(), 1e-6),
        max(v[:, 2].max() - v[:, 2].min(), 1e-6),
    ])
    v[:, 0] -= (v[:, 0].max() + v[:, 0].min()) * 0.5
    v[:, 1] -= (v[:, 1].max() + v[:, 1].min()) * 0.5
    v /= span
    for vert, co in zip(me.vertices, v):
        vert.co = co

    layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            layer.data[li].uv = uvs[me.loops[li].vertex_index]
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    return obj


# --------------------------------------------------------------------------
# the coast's flora
# --------------------------------------------------------------------------
#
# "Is this single green grass asset the only thing you could find? on the ref
# screenshots, there are much more" — and that was right. One procedural blade
# clump repeated a few hundred times is a hedge, not a coastline.
# `beach-map-walls.png` has fern, broad leaf, sword-grass and low bush all in one
# frame, and `strand-map1.jpg.png` hangs two more species over its rock.
#
# So the scrub is a SET: real scanned plants from BlenderKit, alpha-cut, each
# keeping its own material — which is the one thing the rest of this file does
# not do. `rocks.glb` exports its shapes untextured because a boulder wears its
# biome's plate; a fern does not have a biome's plate, it has a photograph of a
# fern. Hence `export_materials="EXPORT"` and `buildRocks(..., null)`: pass no
# material and the instances keep the one they were authored with.
#
# The palm from the same search is deliberately NOT here. It is twelve metres
# tall, and under a camera 49 degrees up that is ten metres of world hidden
# behind a trunk. The references only ever show their palms at the frame edge.
FLORA_SOURCES = [
    # (blend, object name, triangle budget, base-colour image, alpha image)
    ("coast_fern.blend", "Picsart_24-11-03_17-17-16-746.006", 128,
     "Picsart_24-11-03_17-17-16-746.png", None),
    ("dune_shrub.blend", "shrub_02_a_LOD2", 1600, "shrub_02_diff.png", "shrub_02_alpha.png"),
    ("dune_shrub.blend", "shrub_02_b_LOD2", 1400, "shrub_02_diff.png", "shrub_02_alpha.png"),
    ("dune_shrub.blend", "shrub_02_c_LOD2", 1600, "shrub_02_diff.png", "shrub_02_alpha.png"),
    ("dune_shrub.blend", "shrub_02_d_LOD2", 1400, "shrub_02_diff.png", "shrub_02_alpha.png"),
]
# Every flora texture lands here. The shrub ships 4K maps and there are five
# species; at native size this one glb would outweigh the character rig.
FLORA_TEX = 512
# Alpha below this is cut away. MASK, never BLEND: a few hundred instanced
# clumps sorted per frame is the one thing that would actually cost a frame, and
# a leaf edge does not need a gradient at this camera.
FLORA_ALPHA_CUT = 0.5


def _leaf_texture(base, alpha, name):
    """One RGBA texture: the plant's colour with its cutout in the alpha channel.

    glTF has no separate alpha map — a material's opacity has to ride in the
    baseColorTexture's own alpha — so a scan that ships colour and mask as two
    files has to be composited here. Exported as two images and linked
    separately, the first build came back with every leaf card drawn as a solid
    quad: the mask was in the file and nothing was reading it.

    Also the place the downscale lands, because the exporter writes an image's
    PACKED FILE when it has one (the original 4K bytes) and `Image.scale` only
    touches the pixel buffer — that build came out at 7.2MB for three 512-pixel
    textures.
    """
    for img in (base, alpha):
        if img is not None and max(img.size) > FLORA_TEX:
            img.scale(FLORA_TEX, FLORA_TEX)
    w, h = base.size
    px = numpy.empty(w * h * 4, dtype=numpy.float32)
    base.pixels.foreach_get(px)
    if alpha is not None:
        if alpha.size[:] != base.size[:]:
            alpha.scale(w, h)
        ap = numpy.empty(w * h * 4, dtype=numpy.float32)
        alpha.pixels.foreach_get(ap)
        px[3::4] = ap[0::4]  # the mask is greyscale; red is the whole of it

    os.makedirs(BUILD_DIR, exist_ok=True)
    out = os.path.join(BUILD_DIR, name + ".png")
    combined = bpy.data.images.new(name, w, h, alpha=True)
    combined.pixels.foreach_set(px)
    combined.filepath_raw = out
    combined.file_format = "PNG"
    combined.save()
    return bpy.data.images.load(out)


def _flora_material(name, leaf_img):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = leaf_img
    nt.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
    # The same 6% self-lighting every prop in this project carries, so a plant in
    # a wall's shadow is still a plant rather than a black hole.
    nt.links.new(bsdf.inputs["Emission Color"], tex.outputs["Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.06
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.9
    nt.links.new(bsdf.inputs["Alpha"], tex.outputs["Alpha"])
    # BOTH, because the two consumers read different properties. `blend_method`
    # is what Blender's own viewport uses; the glTF exporter in 5.2 decides
    # alphaMode from `surface_render_method`, and its default BLENDED wrote
    # alphaMode BLEND — several hundred sorted transparent instances a frame, for
    # leaves that only ever needed a cutout.
    mat.blend_method = "CLIP"
    mat.surface_render_method = "DITHERED"
    mat.alpha_threshold = FLORA_ALPHA_CUT
    # A leaf card has a back. Culled, half of every plant vanishes as the camera
    # crosses it — and this camera never rotates, so it would vanish for good.
    mat.use_backface_culling = False
    return mat


def _fit_unit_footprint(obj):
    """Centre on the origin, stand on z=0 and scale so the WIDEST horizontal span
    is 1, leaving the height proportional.

    Not the boulders' full unit-box normalisation: a rock is a lump and squashing
    one into a box makes another lump, while a fern squashed to a box is a
    different plant. The scatter then drives it with an aspect near 1 so the
    authored proportion survives to the screen.
    """
    me = obj.data
    v = numpy.array([tuple(obj.matrix_world @ vert.co) for vert in me.vertices], dtype=float)
    span = max(v[:, 0].max() - v[:, 0].min(), v[:, 1].max() - v[:, 1].min(), 1e-6)
    v[:, 0] -= (v[:, 0].max() + v[:, 0].min()) * 0.5
    v[:, 1] -= (v[:, 1].max() + v[:, 1].min()) * 0.5
    v[:, 2] -= v[:, 2].min()
    v /= span
    obj.matrix_world = mathutils.Matrix.Identity(4)
    for vert, co in zip(me.vertices, v):
        vert.co = co
    me.update()


def build_flora():
    """Append the plant set, cut it to budget, re-dress it and stand it up."""
    made = 0
    cache = {}
    for blend, name, budget, base_name, alpha_name in FLORA_SOURCES:
        path = os.path.join(SOURCE_DIR, blend)
        if not os.path.exists(path):
            print(f"  SKIP flora {name}: missing {path}")
            continue
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            if name not in src.objects:
                print(f"  SKIP flora {name}: not in {blend}")
                dst.objects = []
                continue
            dst.objects = [name]
            dst.images = [n for n in (base_name, alpha_name) if n and n in src.images]
        if not dst.objects:
            continue
        obj = dst.objects[0]
        bpy.context.scene.collection.objects.link(obj)
        # Poly Haven ships its LODs hidden except LOD0, and `select_all` skips a
        # hidden object — which is why the first build counted five flora meshes
        # and exported none of them.
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_set(False)
        # A freshly linked datablock answers matrix_world as identity until the
        # depsgraph has run once; `_fit_unit_footprint` reads it.
        bpy.context.view_layer.update()
        # Unparent, KEEPING the pose the depsgraph just computed. Every one of
        # these arrives parented to an empty that append did not link into the
        # scene, and a glTF export with `use_selection` walks hierarchies from
        # their roots — so the plants were built, counted, selected, and then
        # silently left out of the file. Clearing `parent` alone would fall back
        # to matrix_basis, which is the pose BEFORE the parent inverse.
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        bpy.context.view_layer.update()

        key = (base_name, alpha_name)
        if key not in cache:
            base = bpy.data.images.get(base_name)
            alpha = bpy.data.images.get(alpha_name) if alpha_name else None
            if base is None or (alpha_name and alpha is None):
                print(f"  SKIP flora {name}: missing {base_name}/{alpha_name}")
                bpy.data.objects.remove(obj)
                continue
            leaf = _leaf_texture(base, alpha, f"flora_leaf_{len(cache)}")
            cache[key] = _flora_material(f"flora_mat_{len(cache)}", leaf)

        decimate_to(obj, budget)
        obj.data.materials.clear()
        obj.data.materials.append(cache[key])
        _fit_unit_footprint(obj)
        obj.name = f"flora_{made}"
        obj.data.name = f"flora_{made}"
        made += 1
    return made


def decimate_to(obj, target):
    """Collapse a scan-weight mesh to a game budget in TRIANGLES, UVs kept."""
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > target:
        m = obj.modifiers.new("dec", "DECIMATE")
        m.use_collapse_triangulate = True
        m.ratio = target / tris
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)


def box_project(me):
    """UV every face from the axis its normal points down, in world units.

    Triplanar in spirit and free at runtime: the plate is a tiling rock texture,
    so the only thing that matters is that texel density is constant and the
    seams fall on the silhouette edges the flat shading already breaks.
    """
    uvs = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        nx, ny, nz = (abs(c) for c in poly.normal)
        for li in poly.loop_indices:
            x, y, z = me.vertices[me.loops[li].vertex_index].co
            if nz >= nx and nz >= ny:
                u, w = x, y
            elif nx >= ny:
                u, w = y, z
            else:
                u, w = x, z
            uvs.data[li].uv = (u / TILE, w / TILE)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for i in range(VARIANTS):
        build_rock(i)
    for i in range(DUNES):
        build_dune(i)
    for i in range(LEDGES):
        build_ledge(i)
    for i in range(WEEDS):
        build_weed(i)
    flora = build_flora()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # Selected by hand rather than by `select_all`: that operator silently skips
    # anything hidden, and the appended plants arrive hidden.
    for o in bpy.data.objects:
        o.hide_viewport = False
        o.hide_set(False)
        o.select_set(o.type == "MESH")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        # AUTO, never JPEG: half the flora textures carry the alpha that cuts the
        # leaves out, and a JPEG cannot hold an alpha channel.
        export_image_format="AUTO",
        export_jpeg_quality=88,
    )
    per_kind = {}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        kind = o.name.split("_")[0]
        per_kind[kind] = per_kind.get(kind, 0) + sum(
            len(p.vertices) - 2 for p in o.data.polygons
        )
    parts = ", ".join(f"{k} {v} tris" for k, v in sorted(per_kind.items()))
    print(f"wrote {OUT}: {parts}, {os.path.getsize(OUT)} bytes")


main()
