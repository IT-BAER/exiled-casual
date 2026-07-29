"""Contact sheet of the creature walk cycles, straight out of the exported glb.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python tools/preview_monsters.py -- \
      [--species a,b,c] [--clip walk] [--view quarter|game] [--frames 6] \
      [--tile 256] [--out review/creature-walk.png]

Why it reads the GLB and not the build scene
--------------------------------------------
A rig is not validated by a bind-pose render. What ships is the file, and the
file has been through the exporter's own skinning, joint-limit and animation
sampling — so the only frame worth looking at is one Blender re-imported from
the artifact the browser will fetch.

Workbench, not EEVEE: what is being judged here is deformation and silhouette —
knee bend, foot plant, whether a haunch tears off a hip — and lighting a hide
texture over it hides exactly the errors this is looking for.
"""
import os
import sys

import bpy
import numpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, "apps", "web", "public", "models", "monsters.glb")

# Four body plans, because a fault in the gait usually shows on one of them
# only: the quadruped trot, the biped, the six-legged tripod, and the radial
# eight-legged boss whose legs no pairing rule was written for.
DEFAULT = [
    "monster.cinder_imp.v1",
    "monster.hoarfrost_spitter.v1",
    "monster.sand_skitterer.v1",
    "monster.mother_vhal.v1",
]
COLUMNS = 6
TILE = 256

# "quarter" is the rig view: low and in front, where a knee that tears off a hip
# is obvious. "game" is Babylon's own lens (BETA_AT_DEFAULT 0.65 down from
# overhead, CAMERA_ALPHA -PI/4), converted out of glTF y-up into Blender z-up.
# Only the second one can answer whether a shape survives to the player: at 53
# degrees of elevation everything upright foreshortens to a line, so silhouette
# means the plan view and a detail is only real if it spreads sideways.
VIEWS = {"quarter": (0.85, -1.0, 0.42), "game": (0.428, 0.428, 0.796)}


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"species": DEFAULT, "clip": "walk", "tile": TILE, "view": "quarter",
           "frames": COLUMNS, "out": os.path.join(ROOT, "review", "creature-walk.png")}
    for i in range(0, len(tail) - 1, 2):
        key, value = tail[i].lstrip("-"), tail[i + 1]
        out[key] = value.split(",") if key == "species" else value
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


def frame_camera(cam, arm, mesh, view):
    """Framed on the creature's own bounding box, from `view`.

    A fixed camera cannot serve a 0.85-unit imp and a 3.1-unit boss, and a rig
    error is only ever visible at the scale where the limb fills the frame.
    """
    from mathutils import Vector as V
    corners = [mesh.matrix_world @ V(c) for c in mesh.bound_box]
    lo = [min(c[k] for c in corners) for k in range(3)]
    hi = [max(c[k] for c in corners) for k in range(3)]
    centre = [(lo[k] + hi[k]) / 2 for k in range(3)]
    size = max(hi[k] - lo[k] for k in range(3))

    from mathutils import Vector
    direction = Vector(VIEWS[view]).normalized()
    cam.location = Vector(centre) + direction * (size * 4.0)
    # Point at the centre: track the vector rather than a constraint, so nothing
    # has to be evaluated before the render.
    cam.rotation_euler = (direction * -1).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = size * 1.25
    return centre


def render_tile(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = numpy.empty(TILE * TILE * 4, dtype=numpy.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    # Blender's first row is the bottom one.
    return px.reshape(TILE, TILE, 4)[::-1]


def main():
    global TILE
    opts = args()
    # 256 reads a whole roster at a glance; a single boss is judged at 512+.
    TILE = int(opts["tile"])
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    cam = setup(scene)
    bpy.ops.import_scene.gltf(filepath=GLB)

    rows = []
    tmp = os.path.join(ROOT, "review", "_tile.png")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    for species in opts["species"]:
        arm = bpy.data.objects.get(species)
        if arm is None or arm.type != "ARMATURE":
            sys.exit("no armature named %s in %s" % (species, GLB))
        mesh = next((c for c in arm.children if c.type == "MESH"), None)
        if mesh is None:
            sys.exit("%s carries no mesh" % species)

        action = bpy.data.actions.get("%s|%s" % (species, opts["clip"]))
        if action is None:
            sys.exit("no action %s|%s — the clip did not survive the export"
                     % (species, opts["clip"]))
        arm.animation_data.action = action
        if hasattr(arm.animation_data, "action_slot") and action.slots:
            arm.animation_data.action_slot = action.slots[0]

        for other in bpy.data.objects:
            if other.type in {"MESH", "ARMATURE"} and other.name != "floor":
                other.hide_render = True
        arm.hide_render = mesh.hide_render = False
        frame_camera(cam, arm, mesh, opts["view"])

        start, end = (int(v) for v in action.frame_range)
        span = max(end - start, 1)
        frames = int(opts["frames"])
        tiles = []
        for i in range(frames):
            scene.frame_set(start + round(span * i / frames))
            tiles.append(render_tile(scene, tmp))
        rows.append(numpy.concatenate(tiles, axis=1))
        print("rendered", species, "frames", start, "-", end)

    sheet = numpy.concatenate(rows, axis=0)
    h, w, _ = sheet.shape
    out = bpy.data.images.new("sheet", w, h, alpha=False)
    out.pixels.foreach_set(sheet[::-1].ravel())
    out.file_format = "PNG"
    out.save(filepath=opts["out"])
    os.remove(tmp)
    print("wrote", opts["out"], w, "x", h)


main()
