"""Contact sheet of a wardrobe body, straight out of the exported glb.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --disable-autoexec --python tools/preview_wardrobe.py -- \
      [--look male|female] [--views front,quarter,back,side] [--tile 512] \
      [--out review/wardrobe.png]

This judges the ASSET: the atlas landing on the right islands, the shorts hem
following the hip, no seam down a leg, no patch of the wrong colour on a foot.
The bind pose is the right place for that and the only place - nothing is
foreshortened and nothing is hidden behind a limb. A body wearing the wrong
pack's atlas looks 95% right and gives itself away exactly here.

Deformation is NOT judged here. Replaying a clip offline means reproducing the
runtime's retarget, and a preview that retargets differently from `rig.ts` is
worse than none: it reports faults play does not have and hides the ones it
does. Watch a clip at `?viewer` instead, where the runtime's own code drives it.

Lit, not Workbench: every fault above is in the base colour, and a flat matcap
hides all of them.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

WARDROBE = "D:/VSC/exiled-casual/apps/web/public/models/wardrobe.glb"

RIG_OF = {"male": "Armature", "female": "Armature_female"}

# Camera direction per view, in the glb's Z-up Blender space.
VIEWS = {
    "front": Vector((0.0, -1.0, 0.18)),
    "quarter": Vector((0.7, -1.0, 0.35)),
    "back": Vector((0.0, 1.0, 0.18)),
    "side": Vector((1.0, 0.0, 0.18)),
}


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {
        "look": "male", "views": "front,quarter,back", "tile": 512,
        "out": "D:/VSC/exiled-casual/review/wardrobe.png",
    }
    for i in range(0, len(tail) - 1, 2):
        key = tail[i].lstrip("-")
        if key not in out:
            raise SystemExit(f"unknown argument --{key}")
        out[key] = int(tail[i + 1]) if isinstance(out[key], int) else tail[i + 1]
    return out


def scene_setup(tile):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.resolution_x = tile
    scene.render.resolution_y = int(tile * 4 / 3)

    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.06, 1)
    scene.world = world

    key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
    key.data.energy, key.data.size = 900, 3
    key.location = (2.0, -3.0, 3.0)
    key.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(key)

    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
    fill.data.energy, fill.data.size = 300, 4
    fill.location = (-3.0, -2.0, 1.5)
    fill.rotation_euler = (math.radians(75), 0, math.radians(-60))
    scene.collection.objects.link(fill)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def main():
    opts = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=WARDROBE)

    look = opts["look"]
    if look not in RIG_OF:
        raise SystemExit(f"--look must be one of {sorted(RIG_OF)}")
    shown = [o for o in bpy.data.objects if o.type == "MESH" and f".{look}." in o.name]
    if not shown:
        raise SystemExit(f"wardrobe has no base.{look}.* parts")
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj not in shown:
            obj.hide_render = True

    scene, cam = scene_setup(opts["tile"])

    pts = [o.matrix_world @ Vector(c) for o in shown for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre, height = (lo + hi) / 2, hi.z - lo.z
    print(f"base.{look}: height {height:.4f}, centre {tuple(round(c, 4) for c in centre)}")

    os.makedirs(os.path.dirname(opts["out"]), exist_ok=True)
    stem, ext = os.path.splitext(opts["out"])
    for view in opts["views"].split(","):
        if view not in VIEWS:
            raise SystemExit(f"unknown view {view!r}; have {sorted(VIEWS)}")
        cam.location = centre + VIEWS[view].normalized() * (height * 1.5)
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{stem}-{look}-{view}{ext}"
        bpy.ops.render.render(write_still=True)
        print(f"wrote {scene.render.filepath}")


main()
