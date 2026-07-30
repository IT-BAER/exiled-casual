"""Contact sheet of the dressed character, straight out of the exported glb.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python tools/preview_wardrobe.py -- \
      [--looks weapon1.wand,weapon2.shield,body.ranger] [--clip Idle_Loop] \
      [--view quarter|game|front] [--frames 4] [--tile 384] \
      [--out review/wardrobe.png]

Held gear is the reason this exists. Armour is judged on the body it is welded
to, so a bind-pose look at it is honest; a weapon is not, because it is skinned
1.0 to a hand and the bind pose is the one frame where that hand is out sideways
in a T. Whether a wand comes out of a fist or out of a wrist is only answerable
against a clip that has moved the arm, so this replays `anim-library.glb` over
the wardrobe exactly the way `rig.ts` does.

Workbench, not EEVEE: what is being judged is placement and silhouette, and a
lit texture over it hides the seam where a hand meets a haft.
"""
import os
import sys

import bpy
import numpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "apps", "web", "public", "models")
WARDROBE = os.path.join(MODELS, "wardrobe.glb")
ANIMS = os.path.join(MODELS, "anim-library.glb")

# One look per slot, matching rig.ts's EQUIPPED. Held gear first, because it is
# what a preview is usually being run for.
DEFAULT_LOOKS = [
    "weapon1.wand", "weapon2.shield", "helmet.hood", "body.ranger",
    "gloves.bracers", "boots.ranger", "belt.ranger", "base.head",
]

# Same lenses as preview_monsters.py, plus a straight-on front view: a weapon
# held across the body is exactly the thing the game camera foreshortens away.
VIEWS = {
    "quarter": (0.85, -1.0, 0.42),
    "game": (0.428, 0.428, 0.796),
    "front": (0.0, -1.0, 0.06),
}
TILE = 384


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"looks": DEFAULT_LOOKS, "clip": "Idle_Loop", "view": "quarter",
           "frames": 4, "tile": TILE,
           "out": os.path.join(ROOT, "review", "wardrobe.png")}
    for i in range(0, len(tail) - 1, 2):
        key, value = tail[i].lstrip("-"), tail[i + 1]
        out[key] = value.split(",") if key == "looks" else value
    if out["view"] not in VIEWS:
        sys.exit("unknown view %r, want one of %s" % (out["view"], sorted(VIEWS)))
    return out


def setup(scene):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "SINGLE"
    shading.single_color = (0.62, 0.60, 0.58)
    shading.show_shadows = True
    shading.show_cavity = True

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    floor = bpy.data.meshes.new("floor")
    floor.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)],
                      [], [[0, 1, 2, 3]])
    scene.collection.objects.link(bpy.data.objects.new("floor", floor))
    return cam


def dress(looks):
    """Show the meshes of the chosen looks and hide every other one.

    Same rule the runtime dresses by: a part is `slot.look.part`, so a look is
    matched on the first two fields and nothing else.
    """
    shown = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name == "floor":
            continue
        look = ".".join(obj.name.split(".")[:2])
        obj.hide_render = look not in looks
        if not obj.hide_render:
            shown.append(obj.name)
    missing = set(looks) - {".".join(n.split(".")[:2]) for n in shown}
    if missing:
        sys.exit("no such look(s) in the wardrobe: %s" % sorted(missing))
    return shown


def frame_camera(cam, view):
    """Framed on the standing character, not on his bounding box.

    Fitting the box would rescale the shot the moment a weapon widened it, and a
    weapon that changed the framing it is being judged in cannot be compared to
    the frame before it.
    """
    from mathutils import Vector
    centre = Vector((0.0, 0.0, 0.9))
    direction = Vector(VIEWS[view]).normalized()
    cam.location = centre + direction * 8.0
    cam.rotation_euler = (direction * -1).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = 2.1
    return centre


def render_tile(scene, path, tile):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = numpy.empty(tile * tile * 4, dtype=numpy.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(tile, tile, 4)[::-1]


def main():
    opts = args()
    tile = int(opts["tile"])
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    cam = setup(scene)
    scene.render.resolution_x = scene.render.resolution_y = tile

    bpy.ops.import_scene.gltf(filepath=WARDROBE)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    print("dressed:", ", ".join(sorted(dress(opts["looks"]))))

    # The clips ship in their own file, exactly as the runtime fetches them.
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    action = next((a for a in bpy.data.actions if a.name.endswith("|" + opts["clip"])), None)
    if action is None:
        sys.exit("no clip %r; have %s" % (opts["clip"], sorted(a.name for a in bpy.data.actions)))
    for obj in set(bpy.data.objects) - before:
        bpy.data.objects.remove(obj, do_unlink=True)

    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]

    frame_camera(cam, opts["view"])
    start, end = (int(v) for v in action.frame_range)
    span = max(end - start, 1)
    frames = int(opts["frames"])
    tmp = os.path.join(ROOT, "review", "_tile.png")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    tiles = []
    for i in range(frames):
        scene.frame_set(start + round(span * i / frames))
        tiles.append(render_tile(scene, tmp, tile))

    sheet = numpy.concatenate(tiles, axis=1)
    h, w, _ = sheet.shape
    out = bpy.data.images.new("sheet", w, h, alpha=False)
    out.pixels.foreach_set(sheet[::-1].ravel())
    out.file_format = "PNG"
    out.save(filepath=opts["out"])
    os.remove(tmp)
    print("wrote", opts["out"], w, "x", h, "clip", action.name, "frames", start, "-", end)


main()
