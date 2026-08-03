"""Bake the BlenderKit Animated Fire Sprite into the game's flipbook texture.

Run with Blender 5.2:

    blender --background --disable-autoexec --python tools/bake_fire_sprite.py

The source blend is kept in ``tools/assets`` so the generated sheet can be
recreated without relying on a live BlenderKit session. The transparent output
is consumed by ``apps/web/src/render/flames.ts``.
"""

import os

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "tools", "assets", "animated_fire_sprite.blend")
OUTPUT = os.path.join(ROOT, "apps", "web", "public", "textures", "world", "brazier_fire_sheet.png")
TEMP_DIR = os.path.join(ROOT, ".tmp-fire-sprite")

COLS = 4
ROWS = 2
FRAME_COUNT = COLS * ROWS
FRAME_WIDTH = 128
FRAME_HEIGHT = 192


def main():
    os.makedirs(TEMP_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=SOURCE)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = FRAME_WIDTH
    scene.render.resolution_y = FRAME_HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"

    # The asset is authored in the XZ plane. This camera keeps its original
    # proportions and frames the full flame without baking a background.
    camera_data = bpy.data.cameras.new("FireBakeCamera")
    camera = bpy.data.objects.new("FireBakeCamera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0, -4, 0.58)
    camera.rotation_euler = (Vector((0, 0, 0.58)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 1.45
    scene.camera = camera

    paths = []
    first = scene.frame_start
    last = scene.frame_end
    for frame_index in range(FRAME_COUNT):
        # Spread the samples across the authored 250-frame procedural cycle.
        frame = first + round((last - first) * frame_index / FRAME_COUNT)
        scene.frame_set(frame)
        path = os.path.join(TEMP_DIR, f"frame-{frame_index:02d}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)

    sheet = bpy.data.images.new(
        "brazier_fire_sheet",
        width=FRAME_WIDTH * COLS,
        height=FRAME_HEIGHT * ROWS,
        alpha=True,
    )
    pixels = [0.0] * (FRAME_WIDTH * COLS * FRAME_HEIGHT * ROWS * 4)
    sheet_width = FRAME_WIDTH * COLS
    for frame_index, path in enumerate(paths):
        image = bpy.data.images.load(path, check_existing=False)
        row = ROWS - 1 - frame_index // COLS
        col = frame_index % COLS
        for y in range(FRAME_HEIGHT):
            src = (y * FRAME_WIDTH) * 4
            dst = ((row * FRAME_HEIGHT + y) * sheet_width + col * FRAME_WIDTH) * 4
            pixels[dst:dst + FRAME_WIDTH * 4] = image.pixels[src:src + FRAME_WIDTH * 4]
            # The BlenderKit material bakes its colour through an opaque EEVEE
            # surface while film transparency leaves alpha at zero. Derive
            # coverage from the emitted fire, so the black bake background
            # stays transparent and the flame survives in the game renderer.
            for x in range(FRAME_WIDTH):
                pixel = dst + x * 4
                pixels[pixel + 3] = min(1.0, max(
                    pixels[pixel], pixels[pixel + 1], pixels[pixel + 2],
                ) * 1.15)
        bpy.data.images.remove(image)

    sheet.pixels = pixels
    sheet.filepath_raw = OUTPUT
    sheet.file_format = "PNG"
    sheet.save()
    print("wrote", OUTPUT, os.path.getsize(OUTPUT), "bytes")


main()
