"""Turn the generated inventory chest master into the skill-bar button icon.

`assets/hud/inventory_chest_master.png` (/codex-imagegen) is one chest on transparency.
It is cropped to its alpha bounds, centred on a square and Lanczos-scaled to 128 px (the
button draws at about 56 px, so 2x), saved as lossless WebP.

    python tools/build_inventory_icon.py
"""
from __future__ import annotations

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "hud" / "inventory_chest_master.png"
DST = ROOT / "apps" / "web" / "public" / "hud" / "inventory-chest.webp"
SIZE = 128
# Alpha at or below this is the model's soft haze, not the chest.
SOLID = 24


def main() -> None:
    master = Image.open(SRC).convert("RGBA")
    box = master.getchannel("A").point(lambda a: 255 if a > SOLID else 0).getbbox()
    assert box, "master has no opaque pixels"
    glyph = master.crop(box)
    side = max(glyph.size)
    square = Image.new("RGBA", (side, side))
    square.alpha_composite(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    square.resize((SIZE, SIZE), Image.LANCZOS).save(DST, "WEBP", lossless=True, method=6)
    print(f"{DST.relative_to(ROOT)}: {glyph.width}x{glyph.height} -> {SIZE}px, {DST.stat().st_size} B")


if __name__ == "__main__":
    main()
