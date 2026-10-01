"""Crop the generated sort glyph to its alpha bounds and write the HUD icon.

`assets/hud/sort_master.png` (/codex-imagegen) is one glyph on transparency; it is cropped to
its alpha bounds, centred on a square and scaled to the size the HUD draws at twice over.

    python tools/build_sort_icon.py
"""
from __future__ import annotations

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "hud" / "sort_master.png"
DST = ROOT / "apps" / "web" / "public" / "hud" / "sort.webp"
SIZE = 64
# Alpha at or below this is the model's soft haze, not the glyph.
SOLID = 24


def main() -> None:
    sheet = Image.open(SRC).convert("RGBA")
    box = sheet.getchannel("A").point(lambda a: 255 if a > SOLID else 0).getbbox()
    assert box, f"{SRC} has no opaque pixels"
    glyph = sheet.crop(box)
    side = max(glyph.size)
    square = Image.new("RGBA", (side, side))
    square.alpha_composite(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    square.resize((SIZE, SIZE), Image.LANCZOS).save(DST, "WEBP", lossless=True, method=6)
    print(f"{DST.relative_to(ROOT)}: {glyph.width}x{glyph.height} -> {SIZE}px, {DST.stat().st_size} B")


if __name__ == "__main__":
    main()
