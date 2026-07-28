"""Build the level's blocker rocks as one glTF: six boulder variants.

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
import numpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "web", "public", "models", "rocks.glb")

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

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="NONE",
    )
    total = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"wrote {OUT}: {VARIANTS} rocks, {total} tris, {os.path.getsize(OUT)} bytes")


main()
