"""Render the companion cat's clips to a contact sheet for review.

  blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
      --python tools/preview_pet.py -- [--clip hover] [--view game|quarter|side] \
      [--frames 6] [--tile 384] [--lift 0] [--out review/pet-hover.png]

Eevee, so the coat's emission and the eyes show; one row per view given as a
comma list. "game" is Babylon's lens (see preview_monsters.py), the only view
that says whether the shape survives to the player.
"""
import os
import sys

import bpy
import numpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, "assets", "pets", "pet.glb")
ID = "pet.cat.v1"
VIEWS = {"quarter": (0.85, -1.0, 0.42), "game": (0.428, 0.428, 0.796), "side": (1.0, 0.0, 0.1), "top": (0.0, 0.05, 1.0)}
TILE = 384


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"clip": "hover", "view": "game,quarter", "frames": "6", "tile": str(TILE),
           "out": os.path.join(ROOT, "review", "pet-hover.png"), "glb": GLB, "lift": "0"}
    for i in range(0, len(tail) - 1, 2):
        out[tail[i].lstrip("-")] = tail[i + 1]
    return out


def setup(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.18, 0.17, 0.15, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    sun_ob = bpy.data.objects.new("sun", sun)
    sun_ob.rotation_euler = (0.9, 0.2, 0.6)
    scene.collection.objects.link(sun_ob)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    floor = bpy.data.meshes.new("floor")
    floor.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [[0, 1, 2, 3]])
    fo = bpy.data.objects.new("floor", floor)
    mat = bpy.data.materials.new("floor")
    mat.diffuse_color = (0.45, 0.40, 0.33, 1)
    floor.materials.append(mat)
    scene.collection.objects.link(fo)
    return cam


def frame_camera(cam, meshes, view):
    corners = [m.matrix_world @ Vector(c) for m in meshes for c in m.bound_box]
    lo = [min(c[k] for c in corners) for k in range(3)]
    hi = [max(c[k] for c in corners) for k in range(3)]
    centre = Vector([(lo[k] + hi[k]) / 2 for k in range(3)])
    size = max(hi[k] - lo[k] for k in range(3))
    direction = Vector(VIEWS[view]).normalized()
    cam.location = centre + direction * (size * 4.0)
    cam.rotation_euler = (direction * -1).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = size * 1.4


def render_tile(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = numpy.empty(TILE * TILE * 4, dtype=numpy.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(TILE, TILE, 4)[::-1]


def main():
    global TILE
    opts = args()
    TILE = int(opts["tile"])
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    cam = setup(scene)
    bpy.ops.import_scene.gltf(filepath=opts["glb"])
    arm = bpy.data.objects.get(ID)
    if arm is None or arm.type != "ARMATURE":
        sys.exit("no armature %s in %s" % (ID, opts["glb"]))
    # Air clips hang from the origin: lift them off the floor as the runtime does.
    arm.location.z = float(opts["lift"])
    meshes = [c for c in arm.children_recursive if c.type == "MESH"]
    action = bpy.data.actions.get("%s|%s" % (ID, opts["clip"]))
    if action is None:
        sys.exit("no action %s|%s in the export" % (ID, opts["clip"]))
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    start, end = (int(v) for v in action.frame_range)
    span = max(end - start, 1)
    frames = int(opts["frames"])
    tmp = os.path.join(ROOT, "review", "_pet_tile.png")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    rows = []
    for view in opts["view"].split(","):
        scene.frame_set(start)
        bpy.context.view_layer.update()
        frame_camera(cam, meshes, view)
        tiles = []
        for i in range(frames):
            scene.frame_set(start + round(span * i / frames))
            tiles.append(render_tile(scene, tmp))
        rows.append(numpy.concatenate(tiles, axis=1))
    sheet = numpy.concatenate(rows, axis=0)
    h, w, _ = sheet.shape
    out = bpy.data.images.new("sheet", w, h, alpha=False)
    out.pixels.foreach_set(sheet[::-1].ravel())
    out.file_format = "PNG"
    out.save(filepath=opts["out"])
    os.remove(tmp)
    print("wrote", opts["out"], w, "x", h, "clip", opts["clip"], "frames", start, "-", end)


main()
