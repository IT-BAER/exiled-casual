"""Turn the glyph masters into the skill-bar button icons.

A glow master (the Portal skill art) is light on pure black: black is taken out as
transparency (alpha = brightest channel, colour divided back out). A painted master
(/codex-imagegen chest) is on pure #00FF00 and is chroma-keyed, because its dark iron
would vanish under the black rule. Either way the icon needs no blend mode and a hover
glow follows the glyph, not its square. Then it is
cropped to its alpha bounds, centred on a square and Lanczos-scaled to 72 px (the icon
draws at CHEST_SCALE of a skill slot, 36 CSS px on a 2048 px viewport, so 2x), saved as lossless WebP.

    python tools/build_inventory_icon.py
"""
from __future__ import annotations

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps" / "web" / "public"
SIZE = 72
# Alpha at or below this is the glow's faint haze, not the glyph's bounds.
SOLID = 24
# Green lead over max(red, blue): at or below KEY_LO is the subject, at or above KEY_HI the screen.
KEY_LO, KEY_HI = 40, 160


def unscreen(src: Image.Image) -> Image.Image:
    """Light on black -> the same light on transparency: composited over black it is the master again."""
    rgb = src.convert("RGB")
    px = rgb.load()
    out = Image.new("RGBA", rgb.size)
    opx = out.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            r, g, b = px[x, y]
            a = max(r, g, b)
            opx[x, y] = (0, 0, 0, 0) if a == 0 else (r * 255 // a, g * 255 // a, b * 255 // a, a)
    return out


def chroma_key(src: Image.Image) -> Image.Image:
    """Subject on pure green -> the subject on transparency, with green spill clamped off the edges."""
    rgb = src.convert("RGB")
    px = rgb.load()
    out = Image.new("RGBA", rgb.size)
    opx = out.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            r, g, b = px[x, y]
            lead = g - max(r, b)
            a = 255 if lead <= KEY_LO else 0 if lead >= KEY_HI else 255 * (KEY_HI - lead) // (KEY_HI - KEY_LO)
            opx[x, y] = (r, min(g, max(r, b)), b, a)
    return out


ICONS = [
    (ROOT / "assets" / "hud" / "inventory_chest_flat_v3b.png", PUBLIC / "hud" / "inventory-chest.webp", chroma_key),
    (ROOT / "assets" / "skills" / "town_portal.png", PUBLIC / "hud" / "portal.webp", unscreen),
]


def build(src: pathlib.Path, dst: pathlib.Path, cut) -> None:
    out = cut(Image.open(src))
    box = out.getchannel("A").point(lambda v: 255 if v > SOLID else 0).getbbox()
    assert box, f"{src.name} has no lit pixels"
    glyph = out.crop(box)
    side = max(glyph.size)
    square = Image.new("RGBA", (side, side))
    square.alpha_composite(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    square.resize((SIZE, SIZE), Image.LANCZOS).save(dst, "WEBP", lossless=True, method=6)
    print(f"{dst.relative_to(ROOT)}: {glyph.width}x{glyph.height} -> {SIZE}px, {dst.stat().st_size} B")


def main() -> None:
    for src, dst, cut in ICONS:
        build(src, dst, cut)


if __name__ == "__main__":
    main()
