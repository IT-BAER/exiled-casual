"""Bake the Blendkit fire material into the runtime brazier flipbook.

Run inside Blender 5.2 with the downloaded source blend loaded first:

  blender --background --factory-startup --disable-autoexec --offline-mode \
    assets/props/build/blendkit-animated-fire-sprite.blend \
    --python-exit-code 1 --python tools/render_brazier_fire.py -- \
    --out apps/web/public/textures/effects/brazier-fire.png

Production brief
----------------
- Asset: Matthew Ames's "Animated Fire Sprite" from Blendkit, asset base id
  8ff79865-5467-43b7-bdb1-8f821f839bb8, royalty-free license.
- Purpose/runtime: the visible flame in Babylon.js braziers. The source's
  127-node procedural EEVEE material cannot survive glTF export, so Blender
  bakes it to an additive RGB flipbook.
- Camera: orthographic, square to the source plane. The game keeps its camera
  yaw fixed and turns each quad toward the active camera at runtime.
- Budget: 48 frames at 128 px, packed 8 by 6 into a 1024x768 PNG under 1 MB.
  The fire draws near 50 px high in normal gameplay, leaving 2x headroom.
- Loop: the final eight frames crossfade into source frames -7 through 0. The
  last baked frame is therefore source frame 1, exactly the frame that follows.
- Delivery: only the baked PNG ships. Keep the downloaded .blend gitignored;
  the royalty-free license permits use in the game but not resale as a model.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector
import numpy as np


SOURCE_OBJECT = "Animated Fire Sprite"
SOURCE_MATERIAL = "Fire_Mat"
FRAMES = 48
SIZE = 128
COLS = 8
ROWS = 6
LOOP_BLEND = 8


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene(size: int) -> bpy.types.Scene:
    scene = bpy.context.scene
    flame = bpy.data.objects.get(SOURCE_OBJECT)
    if flame is None or flame.type != "MESH":
        raise RuntimeError(f"source blend has no mesh named {SOURCE_OBJECT!r}")
    if bpy.data.materials.get(SOURCE_MATERIAL) is None:
        raise RuntimeError(f"source blend has no material named {SOURCE_MATERIAL!r}")
    flame.constraints.clear()

    camera_data = bpy.data.cameras.new("brazier_fire_camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 1.45
    camera = bpy.data.objects.new("brazier_fire_camera", camera_data)
    camera.location = (0.0, -3.0, 0.2)
    point_camera(camera, Vector((0.0, 0.0, 0.2)))
    scene.collection.objects.link(camera)
    scene.camera = camera

    world = bpy.data.worlds.new("brazier_fire_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0
    scene.world = world

    render = scene.render
    render.engine = "BLENDER_EEVEE"
    render.film_transparent = False
    render.resolution_x = size
    render.resolution_y = size
    render.resolution_percentage = 100
    render.image_settings.file_format = "PNG"
    render.image_settings.color_mode = "RGB"
    render.image_settings.color_depth = "8"
    render.image_settings.compression = 100
    scene.view_settings.look = "Medium High Contrast"
    return scene


def render_frame(scene: bpy.types.Scene, frame: int, path: Path) -> np.ndarray:
    scene.frame_set(frame)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path), check_existing=False)
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape((SIZE, SIZE, 4))
    rgb = pixels[:, :, :3].copy()
    bpy.data.images.remove(image)
    return rgb


def save_atlas(scene: bpy.types.Scene, frames: list[np.ndarray], out: Path) -> None:
    if len(frames) != FRAMES:
        raise RuntimeError(f"expected {FRAMES} frames, got {len(frames)}")
    atlas = np.zeros((ROWS * SIZE, COLS * SIZE, 4), dtype=np.float32)
    atlas[:, :, 3] = 1
    for i, frame in enumerate(frames):
        row, col = divmod(i, COLS)
        atlas[row * SIZE:(row + 1) * SIZE, col * SIZE:(col + 1) * SIZE, :3] = frame

    image = bpy.data.images.new("brazier_fire_atlas", width=COLS * SIZE, height=ROWS * SIZE, alpha=False)
    image.pixels.foreach_set(atlas.ravel())
    out.parent.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.color_mode = "RGB"
    image.save_render(str(out), scene=scene)
    bpy.data.images.remove(image)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--work", default="assets/props/build/brazier-fire")
    args = parser.parse_args(argv)
    out = Path(args.out).resolve()
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    for old in work.glob("*.png"):
        old.unlink()

    scene = configure_scene(SIZE)
    frames = [
        render_frame(scene, frame, work / f"frame_{frame:03d}.png")
        for frame in range(1, FRAMES + 1)
    ]
    wrap = [
        render_frame(scene, frame, work / f"wrap_{frame:+03d}.png")
        for frame in range(1 - LOOP_BLEND, 1)
    ]
    for i in range(LOOP_BLEND):
        mix = (i + 1) / LOOP_BLEND
        index = FRAMES - LOOP_BLEND + i
        frames[index] = frames[index] * (1 - mix) + wrap[i] * mix

    save_atlas(scene, frames, out)
    print(f"baked {FRAMES} frames -> {out} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    raise SystemExit(main(argv))
