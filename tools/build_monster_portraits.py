"""One portrait per creature, for the death recap: the model the player fought, not a painting of it.

Run:
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
      --disable-autoexec --python-exit-code 1 --python tools/build_monster_portraits.py -- \
      [--species a,b] [--size 128] [--out apps/web/public/hud/monsters] [--glb path]

Reads the shipped monsters.glb (the same file the browser loads), poses each armature on the
first frame of its idle clip, and renders it textured on a transparent background from the
front quarter the preview tool calls "quarter" (the creature faces -Y). Writes
`<out>/<species id without "monster." and ".v1">.webp`, which `monsterPortrait()` in the
client resolves.
"""
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, "apps", "web", "public", "models", "monsters.glb")
OUT = os.path.join(ROOT, "apps", "web", "public", "hud", "monsters")
# Front, a little above: high enough to see a back, low enough to keep the face.
VIEW = Vector((0.55, -1.0, 0.55)).normalized()


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"species": None, "size": "128", "out": OUT, "glb": GLB}
    for i in range(0, len(tail) - 1, 2):
        key, value = tail[i].lstrip("-"), tail[i + 1]
        out[key] = value.split(",") if key == "species" else value
    return out


def setup(scene, size):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.quality = 90
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("portrait")
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.08, 0.08, 0.09, 1)
    scene.world = world

    def light(name, kind, energy, colour, direction):
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        data.color = colour
        obj = bpy.data.objects.new(name, data)
        obj.rotation_euler = (Vector(direction).normalized() * -1).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)

    light("key", "SUN", 4.0, (1.0, 0.9, 0.78), (0.8, -1.0, 1.2))
    light("fill", "SUN", 1.2, (0.7, 0.78, 1.0), (-1.0, -0.6, 0.4))
    # A back rim so a dark hide still separates from the panel behind it.
    light("rim", "SUN", 3.0, (1.0, 0.85, 0.7), (-0.3, 1.0, 0.6))

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def frame(cam, mesh):
    """Fit the posed, evaluated mesh: a 0.85-unit imp and a 3-unit boss both fill the tile."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    pts = [ev.matrix_world @ v.co for v in ev.to_mesh().vertices]
    ev.to_mesh_clear()
    right = VIEW.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(VIEW).normalized()
    xs = [p.dot(right) for p in pts]
    ys = [p.dot(up) for p in pts]
    zs = [p.dot(VIEW) for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    centre = right * cx + up * cy + VIEW * ((min(zs) + max(zs)) / 2)
    cam.location = centre + VIEW * (max(zs) - min(zs) + 10)
    cam.rotation_euler = (VIEW * -1).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.08
    cam.data.clip_end = 1000


def main():
    opts = args()
    size = int(opts["size"])
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    cam = setup(scene, size)
    bpy.ops.import_scene.gltf(filepath=opts["glb"])
    opts["out"] = os.path.abspath(opts["out"])
    os.makedirs(opts["out"], exist_ok=True)

    arms = [o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith("monster.")]
    wanted = opts["species"] or sorted(o.name for o in arms)
    for species in wanted:
        arm = bpy.data.objects.get(species)
        if arm is None or arm.type != "ARMATURE":
            sys.exit("no armature named %s in %s" % (species, opts["glb"]))
        mesh = next((c for c in arm.children if c.type == "MESH"), None)
        if mesh is None:
            sys.exit("%s carries no mesh" % species)
        action = bpy.data.actions.get("%s|idle" % species) or bpy.data.actions.get("%s|walk" % species)
        if action is None:
            sys.exit("%s has neither an idle nor a walk clip" % species)
        arm.animation_data.action = action
        if hasattr(arm.animation_data, "action_slot") and action.slots:
            arm.animation_data.action_slot = action.slots[0]
        for other in bpy.data.objects:
            if other.type in {"MESH", "ARMATURE"}:
                other.hide_render = True
        arm.hide_render = mesh.hide_render = False
        scene.frame_set(int(action.frame_range[0]))
        frame(cam, mesh)
        short = species.removeprefix("monster.").removesuffix(".v1")
        scene.render.filepath = os.path.join(opts["out"], short + ".webp")
        bpy.ops.render.render(write_still=True)
        print("portrait", species, "->", scene.render.filepath)


main()
