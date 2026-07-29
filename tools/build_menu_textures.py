"""Turn the generated menu masters into the files the client ships.

Generated art comes out of /codex-imagegen at whatever size the model felt like,
with a transparent margin around anything that has alpha. Shipping that directly
means the browser downloads three megabytes to draw a 220px button, and a CSS
`background-size: contain` silently shrinks the art to fit the margin instead of
the plate. So every master is cropped to its own alpha bounds first, then scaled
to the size it is actually drawn at.

The frame is the one asset that also needs a NUMBER out of this script: CSS
`border-image-slice` has to know where the ornate corner stops and the repeatable
edge begins, and guessing that inset is what makes a nine-slice frame shear. It
is measured here, from the alpha channel, and printed for `frames.tsx` to carry.

Run after regenerating anything in assets/menu/:

    python tools/build_menu_textures.py
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image

SRC = pathlib.Path(__file__).resolve().parent.parent / "assets" / "menu"
DST = pathlib.Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "textures" / "ui" / "menu"

# master stem -> (output name, target width or None to keep, jpeg quality or None for png)
PLAN: dict[str, tuple[str, int | None, int | None]] = {
    "menu_backdrop_v3": ("menu_backdrop.jpg", None, 86),
    "select_backdrop_v1": ("select_backdrop.jpg", None, 86),
    "logo_v4": ("logo.png", 1024, None),
    "button_plate_v1": ("button_plate.png", 880, None),
    "panel_frame_v1": ("panel_frame.png", 512, None),
    "row_plate_v1": ("row_plate.png", 1024, None),
    "portrait_ironsworn_v1": ("portrait_ironsworn.png", 256, None),
    "portrait_stalker_v1": ("portrait_stalker.png", 256, None),
    "portrait_emberbound_v1": ("portrait_emberbound.png", 256, None),
    "fog_sheet_v1": ("fog_sheet.png", 512, None),
    "divider_v1": ("divider.png", 512, None),
}

ALPHA_FLOOR = 8

# The three class starter armours are ITEM icons, not menu art, so they land in
# the item folder with the rest of the inventory art. They are built here anyway
# because their masters are generated alongside the menu's and the crop-then-
# scale step is identical. `tools/build_gear_textures.py` then re-palettizes the
# character atlas from each of them, which is what makes three classes read as
# three people on one rig.
ITEMS_DST = pathlib.Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "textures" / "items"
ITEM_ICONS: dict[str, tuple[str, int]] = {
    "icon_ironsworn_plate_v1": ("ironsworn_plate.png", 256),
    "icon_stalker_leathers_v1": ("stalker_leathers.png", 256),
    "icon_emberbound_robe_v1": ("emberbound_robe.png", 256),
}


def crop_to_alpha(im: Image.Image) -> Image.Image:
    """Trim the transparent margin. A fully opaque image is returned unchanged."""
    if im.mode != "RGBA":
        return im
    box = im.getchannel("A").point(lambda v: 255 if v > ALPHA_FLOOR else 0).getbbox()
    return im if box is None else im.crop(box)


def frame_slice(im: Image.Image) -> tuple[int, int, int, int]:
    """Border thickness (left, top, right, bottom) of a frame with a hollow centre.

    Walks in from each edge along the middle row/column until the alpha drops
    out — that is where the border ends and the hole begins. Measured rather
    than assumed: an eighth of the width was the brief, not the render.
    """
    a = im.getchannel("A").load()
    w, h = im.size
    mid_y, mid_x = h // 2, w // 2

    def walk(count: int, at):  # noqa: ANN001 - local helper
        for i in range(count):
            if a[at(i)] <= ALPHA_FLOOR:
                return i
        return count

    left = walk(w, lambda i: (i, mid_y))
    right = walk(w, lambda i: (w - 1 - i, mid_y))
    top = walk(h, lambda i: (mid_x, i))
    bottom = walk(h, lambda i: (mid_x, h - 1 - i))
    return left, top, right, bottom


def main() -> int:
    if not SRC.is_dir():
        print(f"no masters at {SRC}", file=sys.stderr)
        return 1
    DST.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    for stem, (out_name, width, quality) in PLAN.items():
        src = SRC / f"{stem}.png"
        if not src.is_file():
            missing.append(stem)
            continue
        im = crop_to_alpha(Image.open(src))
        if width is not None and im.width != width:
            im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)

        out = DST / out_name
        if quality is None:
            im.convert("RGBA").save(out, optimize=True)
        else:
            im.convert("RGB").save(out, quality=quality, optimize=True, progressive=True)
        note = ""
        if stem.startswith("panel_frame"):
            note = f"  border-image-slice {' '.join(str(v) for v in frame_slice(im))}"
        print(f"{out_name:26} {im.width}x{im.height}  {out.stat().st_size // 1024} KiB{note}")

    ITEMS_DST.mkdir(parents=True, exist_ok=True)
    for stem, (out_name, height) in ITEM_ICONS.items():
        src = SRC / f"{stem}.png"
        if not src.is_file():
            missing.append(stem)
            continue
        im = crop_to_alpha(Image.open(src))
        # Item icons are sized by HEIGHT, not width: a body armour occupies a
        # 2x3 grid cell and the art is fitted to the taller axis, which is how
        # the icons already in that folder are cut.
        if im.height != height:
            im = im.resize((max(1, round(im.width * height / im.height)), height), Image.LANCZOS)
        out = ITEMS_DST / out_name
        im.convert("RGBA").save(out, optimize=True)
        print(f"{out_name:26} {im.width}x{im.height}  {out.stat().st_size // 1024} KiB  (item icon)")

    if missing:
        print(f"\nnot generated yet: {', '.join(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
