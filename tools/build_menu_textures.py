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

from PIL import Image, ImageChops, ImageFilter

SRC = pathlib.Path(__file__).resolve().parent.parent / "assets" / "menu"
DST = pathlib.Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "textures" / "ui" / "menu"

# master stem -> (output name, target width or None to keep, jpeg/webp quality or None for lossless webp)
PLAN: dict[str, tuple[str, int | None, int | None]] = {
    # Drawn `cover` full-bleed, so 2560 wide on a 1440p panel. The masters are at
    # the generator's cap, so this is an upscale (see UPSCALE_SHARPEN).
    "menu_backdrop_v3": ("menu_backdrop.jpg", 2560, 86),
    "select_backdrop_v3": ("select_backdrop.jpg", 2560, 86),
    # WebP, not PNG: the logo is the menu's LCP element, and at q90 it is a
    # quarter of the PNG's 620 KB with no visible loss over the backdrop.
    "logo_v4": ("logo.webp", 1024, 90),
    "button_plate_v1": ("button_plate.webp", 880, None),
    "panel_frame_v1": ("panel_frame.webp", 512, None),
    "row_plate_v1": ("row_plate.webp", 1024, None),
    "portrait_ironsworn_v1": ("portrait_ironsworn.webp", 256, None),
    "portrait_stalker_v1": ("portrait_stalker.webp", 256, None),
    "portrait_emberbound_v1": ("portrait_emberbound.webp", 256, None),
    # Tiled at 1180 CSS px. A soft gradient: lossy q90 at full size is a fifth of
    # the bytes lossless took at 512.
    "fog_sheet_v1": ("fog_sheet.webp", None, 90),
    # Drawn over the loading plate, never over the game: PoE darkens the corners
    # of a wallpaper so the band and the tip are what the eye lands on.
    # Drawn `cover` full-bleed; the master's 2048 is its cap. Lossy, as above.
    # v2 is v1 with its painted gold frame inpainted away: `cover` cropped that
    # frame's top and bottom off on wide screens, so the frame is its own layer.
    "loading_vignette_v2": ("loading_vignette.webp", None, 90),
    # Stretched to its row: about 680 px under a dialog, the full width over the
    # passive tree. The master's own width, never an upscale.
    "divider_v1": ("divider.webp", None, None),
    # The Options panel's controls. The gems are one plate each rather than a
    # tint of the other: an unlit gem and a lit one differ in more than
    # brightness, and the bezel picks up the glow.
    # 56: twice the 28px checkbox they are drawn at.
    "gem_check_off_v1": ("gem_check_off.webp", 56, None),
    "gem_check_on_v1": ("gem_check_on.webp", 56, None),
    "slider_track_v1": ("slider_track.webp", 512, None),
    "slider_handle_v1": ("slider_handle.webp", 64, None),
    # One tab plate, tinted by CSS for active/inactive, the same rule the button
    # follows: two renders of the same tab are never quite the same tab.
    "tab_plate_v1": ("tab_plate.webp", 384, None),
    # Item tooltip header bands, one per rarity, stretched by CSS border-image:
    # the end-caps are the slice, the middle repeats. Opaque by design - the
    # band IS the header background - so crop_to_alpha passes them through.
    "tooltip_header_normal_v1": ("tooltip_header_normal.webp", 768, None),
    "tooltip_header_magic_v1": ("tooltip_header_magic.webp", 768, None),
    "tooltip_header_rare_v1": ("tooltip_header_rare.webp", 768, None),
    "tooltip_header_unique_v1": ("tooltip_header_unique.webp", 768, None),
}

ALPHA_FLOOR = 8

# Same pass as build_loading_textures.py: puts back the edge a Lanczos upscale
# softened. Lanczos here beats the browser's bilinear stretch at draw time.
UPSCALE_SHARPEN = ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=3)

# Narrower copies for <img srcset>: stem -> (output name, width). The logo is the
# menu's LCP element and a phone draws it about 330 device px wide.
SRCSET_COPIES: dict[str, tuple[str, int]] = {"logo_v4": ("logo-512.webp", 512)}

# The three class starter armours are ITEM icons, not menu art, so they land in
# the item folder with the rest of the inventory art. They are built here anyway
# because their masters are generated alongside the menu's and the crop-then-
# scale step is identical.
ITEMS_DST = pathlib.Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "textures" / "items"
ITEM_ICONS: dict[str, tuple[str, int]] = {
    "icon_ironsworn_plate_v1": ("ironsworn_plate.webp", 256),
    "icon_stalker_leathers_v1": ("stalker_leathers.webp", 256),
    "icon_ember_robe_v1": ("ember_robe.webp", 256),
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


# The loading plate's gold frame, assembled from ONE generated top-left corner.
# Drawn as a nine-slice over the visible area, so all four corners show at any
# aspect and the lines stay crisp instead of being a stretched painting.
# v2: blackened iron flush to the screen edge, thorns round a cracked stone (owner,
# 19 Nov: v1's bright thin gold was too prominent and too small).
FRAME_CORNER = "loading_frame_corner_v2"
FRAME_SLICE = 384
# Master px cut off the band's OUTER side: the render's 75 px band read too thick
# (owner, 19 Nov). Cutting the outside keeps the ornament's size and position.
FRAME_TRIM = 24


def build_loading_frame() -> str | None:
    """Mirror the corner into a four-corner nine-slice source; returns the slice line."""
    src = SRC / f"{FRAME_CORNER}.png"
    if not src.is_file():
        return None
    im = crop_to_alpha(Image.open(src).convert("RGBA"))
    im = im.crop((FRAME_TRIM, FRAME_TRIM, im.width, im.height))
    a = im.getchannel("A").point(lambda v: 255 if v > ALPHA_FLOOR else 0)
    w, h = im.size
    # The straight lines run the length of the image: a row lit across most of
    # the far half is the top line, a column likewise the left line. Grown by
    # 3 px so their anti-aliased fringe never counts as ornament.
    px = a.load()
    far_x, far_y = range(w // 2, w), range(h // 2, h)
    lit_rows = [y for y in range(h) if sum(1 for x in far_x if px[x, y]) > len(far_x) * 0.6]
    lit_cols = [x for x in range(w) if sum(1 for y in far_y if px[x, y]) > len(far_y) * 0.6]
    line_rows = {y + d for y in lit_rows for d in range(-3, 4)}
    line_cols = {x + d for x in lit_cols for d in range(-3, 4)}
    reach = 0
    for y in range(h):
        for x in range(w):
            if px[x, y] and y not in line_rows and x not in line_cols:
                reach = max(reach, x, y)
    # Corner slice = where the flourish ends plus a margin; the half-arm after it
    # is plain band, so the mirrored halves meet on straight metal. The edge is
    # TILED (`round`), not stretched: stretched, pitted iron smears into streaks,
    # so the arm is long enough to tile without a visible beat.
    corner = reach + 24
    quad = im.crop((0, 0, corner + 160, corner + 160))
    q = quad.width
    band = next(y for y in range(h) if y not in lit_rows)
    # The bottom corners are plain mitred iron: the frame runs round the bottom bar
    # too, and an ornament there would sit on the tip text (owner, 19 Nov).
    # Each arm from its own straight run: the render's left band is not as deep
    # as its top band, so a transposed top band steps where the two meet.
    band_v = next(x for x in range(w) if x not in lit_cols)
    strip = quad.crop((corner, 0, q, band + 3))
    strip_v = quad.crop((0, corner, band_v + 3, q))
    top = Image.new("RGBA", (q, q))
    for x in range(0, q, strip.width):
        top.paste(strip, (x, 0))
    left = Image.new("RGBA", (q, q))
    for y in range(0, q, strip_v.height):
        left.paste(strip_v, (0, y))
    miter = Image.new("L", (q, q))
    miter.putdata([255 if y <= x else 0 for y in range(q) for x in range(q)])
    plain = left.copy()
    plain.paste(top, (0, 0), ImageChops.multiply(top.getchannel("A"), miter))
    full = Image.new("RGBA", (2 * q, 2 * q))
    full.paste(quad, (0, 0))
    full.paste(quad.transpose(Image.FLIP_LEFT_RIGHT), (q, 0))
    full.paste(plain.transpose(Image.FLIP_TOP_BOTTOM), (0, q))
    full.paste(plain.transpose(Image.ROTATE_180), (q, q))
    # A 1440p panel draws the corner about 250 px; 384 keeps headroom. Lossy with
    # a lossless alpha: the textured gold is 860 KiB lossless at native size.
    scale = FRAME_SLICE / corner
    size = round(full.width * scale)
    full = full.resize((size, size), Image.LANCZOS)
    out = DST / "loading_frame.webp"
    full.save(out, quality=92, alpha_quality=100, method=6)
    # The band's depth as a share of the slice: how far the bottom bar's text must
    # stay off the screen's sides and foot.
    return (f"{out.name:26} {size}x{size}  {out.stat().st_size // 1024} KiB  "
            f"border-image-slice {FRAME_SLICE}  band {band / corner:.4f} of the slice")


def main() -> int:
    if not SRC.is_dir():
        print(f"no masters at {SRC}", file=sys.stderr)
        return 1
    DST.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    line = build_loading_frame()
    if line is None:
        missing.append(FRAME_CORNER)
    else:
        print(line)
    for stem, (out_name, width, quality) in PLAN.items():
        src = SRC / f"{stem}.png"
        if not src.is_file():
            missing.append(stem)
            continue
        im = crop_to_alpha(Image.open(src))
        if width is not None and im.width != width:
            upscale = width > im.width
            im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
            if upscale:
                im = im.filter(UPSCALE_SHARPEN)

        out = DST / out_name
        if quality is None:
            # Lossless WebP: the same pixels as a PNG at about 70% of the bytes.
            im.convert("RGBA").save(out, lossless=True, exact=True, method=6)
        elif out.suffix == ".webp":
            im.convert("RGBA").save(out, quality=quality, method=6)
        else:
            im.convert("RGB").save(out, quality=quality, optimize=True, progressive=True)
        note = ""
        if stem.startswith("panel_frame"):
            note = f"  border-image-slice {' '.join(str(v) for v in frame_slice(im))}"
        print(f"{out_name:26} {im.width}x{im.height}  {out.stat().st_size // 1024} KiB{note}")
        if stem in SRCSET_COPIES:
            name, w = SRCSET_COPIES[stem]
            small = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
            small.convert("RGBA").save(DST / name, quality=quality, method=6)
            print(f"{name:26} {small.width}x{small.height}  {(DST / name).stat().st_size // 1024} KiB")

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
        im.convert("RGBA").save(out, lossless=True, method=6)
        print(f"{out_name:26} {im.width}x{im.height}  {out.stat().st_size // 1024} KiB  (item icon)")

    if missing:
        print(f"\nnot generated yet: {', '.join(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
