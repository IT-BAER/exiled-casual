"""Render the loading spinner's frames. RUNS INSIDE BLENDER.

    blender --background --factory-startup --disable-autoexec --offline-mode \
        --python-exit-code 1 --python tools/render_loading_spinner.py \
        -- --out <dir> --frames 48 --size 128

`tools/build_loading_spinner.py` is what you actually run; it drives this and
then composes the sheet, because Blender's bundled Python has no Pillow.

## Production brief

- **Asset**: the ring that turns in the middle of the loading screen's band.
- **Target runtime**: a CSS sprite sheet, stepped on `background-position`. Not
  a mesh, not a glb — nothing loads Babylon to draw a loading screen.
- **Why rendered at all**: the placeholder is a CSS border with one lit edge,
  and it reads as a web spinner in a game that has spent its whole art budget
  looking like it was painted. A real gold surface with a real ember travelling
  around it, lighting the metal as it passes, is the one thing CSS cannot fake.
- **Loop**: exact. The assembly turns a full 360 degrees across the frame count,
  so the last frame is one step short of the first and the seam is invisible.
  This is why the rotation is set per frame in Python rather than keyframed —
  no interpolation curve gets a chance to overshoot at the wrap.
- **Camera**: orthographic down -Z. A perspective lens would make the ember's
  scale pulse as it travels, which reads as a wobble.
- **Budget**: 48 frames of 128px, an 8x6 sheet at 1024x768, RGBA, under 400 kB.
  128 because the ring draws at 58 CSS px at most and a 2x display doubles it.
"""
from __future__ import annotations

import argparse
import math
import sys

import bpy
from mathutils import Vector

# --- Look. Everything tunable is here rather than buried in the build. -------

GOLD = (0.62, 0.44, 0.16, 1.0)      # aged gilt, not bullion: the frames' own tone
GOLD_ROUGH = 0.28
RING_MAJOR = 0.74
RING_MINOR = 0.085
STUDS = 16                           # the braided rail's beading, as on the globe ring
STUD_R = 0.045
EMBER_R = 0.075
EMBER_COLOUR = (1.0, 0.46, 0.13)
EMBER_STRENGTH = 26.0
EMBER_LIGHT_W = 55.0                 # watts; what actually lights the metal it passes


def clear_scene() -> None:
    """Factory startup still ships a cube, a camera and a light. Own the scene."""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def set_input(node: bpy.types.Node, name: str, value) -> None:
    """
    Assign a shader input by name, loudly if the name is wrong.

    Principled BSDF's sockets have been renamed more than once across releases
    ("Emission" became "Emission Color" in 4.0), and a silent miss ships a ring
    with no ember on it and a green test suite.
    """
    sock = node.inputs.get(name)
    if sock is None:
        raise KeyError(f"{node.bl_idname} has no input {name!r}; has {[s.name for s in node.inputs]}")
    sock.default_value = value


def gold_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("spinner_gold")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    set_input(bsdf, "Base Color", GOLD)
    set_input(bsdf, "Metallic", 1.0)
    set_input(bsdf, "Roughness", GOLD_ROUGH)
    return mat


def ember_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("spinner_ember")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    set_input(bsdf, "Base Color", (*EMBER_COLOUR, 1.0))
    set_input(bsdf, "Emission Color", (*EMBER_COLOUR, 1.0))
    set_input(bsdf, "Emission Strength", EMBER_STRENGTH)
    return mat


def build(size: int) -> bpy.types.Object:
    """Build the assembly and return the empty everything is parented to."""
    clear_scene()
    scene = bpy.context.scene

    pivot = bpy.data.objects.new("spinner_pivot", None)
    scene.collection.objects.link(pivot)

    gold = gold_material()
    ember_mat = ember_material()

    bpy.ops.mesh.primitive_torus_add(
        major_radius=RING_MAJOR, minor_radius=RING_MINOR,
        major_segments=72, minor_segments=18, location=(0, 0, 0),
    )
    ring = bpy.context.active_object
    ring.name = "spinner_ring"
    ring.data.materials.append(gold)
    for poly in ring.data.polygons:
        poly.use_smooth = True
    ring.parent = pivot

    # The beading. Sixteen of them, so the rail reads as braided rather than as a
    # smooth tube — the same device the life globe's ring uses.
    for i in range(STUDS):
        a = 2.0 * math.pi * i / STUDS
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=STUD_R, segments=16, ring_count=12,
            location=(math.cos(a) * RING_MAJOR, math.sin(a) * RING_MAJOR, RING_MINOR * 0.72),
        )
        stud = bpy.context.active_object
        stud.name = f"spinner_stud_{i:02d}"
        stud.data.materials.append(gold)
        for poly in stud.data.polygons:
            poly.use_smooth = True
        stud.parent = pivot

    # The ember, and the light it actually casts. Both parented to the pivot, so
    # the lit patch of metal travels with it — that travelling highlight is the
    # whole reason this is rendered instead of drawn.
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=EMBER_R, segments=20, ring_count=14, location=(RING_MAJOR, 0, 0),
    )
    ember = bpy.context.active_object
    ember.name = "spinner_ember"
    ember.data.materials.append(ember_mat)
    for poly in ember.data.polygons:
        poly.use_smooth = True
    ember.parent = pivot

    lamp_data = bpy.data.lights.new("spinner_ember_light", type="POINT")
    lamp_data.energy = EMBER_LIGHT_W
    lamp_data.color = EMBER_COLOUR
    lamp_data.shadow_soft_size = 0.12
    lamp = bpy.data.objects.new("spinner_ember_light", lamp_data)
    lamp.location = (RING_MAJOR, 0, 0.18)
    scene.collection.objects.link(lamp)
    lamp.parent = pivot

    # Key from the upper left and a cool rim from the lower right: the same two
    # lights the menu plates are lit by, so the ring belongs to them.
    for name, loc, energy, colour, sz in (
        ("key", (-1.8, 1.6, 2.6), 140.0, (1.0, 0.86, 0.66), 2.4),
        ("rim", (2.0, -1.7, -1.4), 70.0, (0.55, 0.70, 1.0), 2.0),
    ):
        d = bpy.data.lights.new(f"spinner_{name}", type="AREA")
        d.energy = energy
        d.color = colour
        d.size = sz
        o = bpy.data.objects.new(f"spinner_{name}", d)
        o.location = loc
        # Aim it at the origin.
        o.rotation_euler = (-Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)

    cam_data = bpy.data.cameras.new("spinner_cam")
    cam_data.type = "ORTHO"
    # Just past the ring plus its beading, so the art fills the frame without
    # any part of it touching the edge — a clipped stud reads as a broken sprite.
    cam_data.ortho_scale = (RING_MAJOR + STUD_R) * 2.0 * 1.16
    cam = bpy.data.objects.new("spinner_cam", cam_data)
    cam.location = (0, 0, 4)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # Transparent film still reflects the world, and pure black gives metal
    # nothing to be metal with. A dim warm dome is what keeps the gold reading
    # as gold in the parts no lamp reaches.
    world = bpy.data.worlds.new("spinner_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.04, 0.035, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world

    r = scene.render
    r.engine = "CYCLES"
    r.resolution_x = size
    r.resolution_y = size
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True

    return pivot


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--frames", type=int, default=48)
    ap.add_argument("--size", type=int, default=128)
    args = ap.parse_args(argv)

    pivot = build(args.size)
    scene = bpy.context.scene

    for i in range(args.frames):
        # Set per frame rather than keyframed: an f-curve through 0 and 360 can
        # overshoot at the wrap, and the wrap is the one place a loop is seen.
        pivot.rotation_euler = (0.0, 0.0, 2.0 * math.pi * i / args.frames)
        scene.render.filepath = f"{args.out}/frame_{i:03d}"
        bpy.ops.render.render(write_still=True)
        print(f"spinner frame {i + 1}/{args.frames}", flush=True)

    return 0


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    raise SystemExit(main(argv))
