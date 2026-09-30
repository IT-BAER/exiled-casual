"""Slice the generated damage-type glyph sheet into one icon per element.

`assets/hud/elements/element_glyphs_v1.png` (/codex-imagegen) is five glyphs in a row
on transparency: physical, fire, cold, lightning, chaos. Each is found as a run of
columns with alpha, cropped to its own alpha bounds, centred on a square and scaled
to the size the HUD draws at twice over.

    python tools/build_element_icons.py
"""
from __future__ import annotations

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "hud" / "elements" / "element_glyphs_v1.png"
DST = ROOT / "apps" / "web" / "public" / "hud" / "elements"
ORDER = ("physical", "fire", "cold", "lightning", "chaos")
SIZE = 64
# Alpha at or below this is the model's soft haze, not the glyph.
SOLID = 24


def main() -> None:
    sheet = Image.open(SRC).convert("RGBA")
    alpha = sheet.getchannel("A").point(lambda a: 255 if a > SOLID else 0)
    width, height = sheet.size
    filled = [any(alpha.getpixel((x, y)) for y in range(0, height, 2)) for x in range(width)]
    runs, start = [], None
    for x, on in enumerate(filled + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x))
            start = None
    runs = [r for r in runs if r[1] - r[0] > width // 40]
    assert len(runs) == len(ORDER), f"expected {len(ORDER)} glyphs, found {len(runs)}: {runs}"
    DST.mkdir(parents=True, exist_ok=True)
    for name, (x0, x1) in zip(ORDER, runs):
        glyph = sheet.crop((x0, 0, x1, height))
        glyph = glyph.crop(glyph.getchannel("A").point(lambda a: 255 if a > SOLID else 0).getbbox())
        side = max(glyph.size)
        square = Image.new("RGBA", (side, side))
        square.alpha_composite(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
        out = DST / f"{name}.webp"
        square.resize((SIZE, SIZE), Image.LANCZOS).save(out, "WEBP", quality=90, method=6)
        print(f"{out.relative_to(ROOT)}: {glyph.width}x{glyph.height} -> {SIZE}px, {out.stat().st_size} B")


if __name__ == "__main__":
    main()
