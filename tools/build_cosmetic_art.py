"""Write the inventory's Cosmetics page art from its generated masters.

`assets/ui/cosmetic_plate_v1.png` (/codex-imagegen) is a seamless gold-brown plate; it is
scaled to the 256 px tile `InventoryPanel.tsx` repeats. `assets/ui/cosmetic_cat_master.png`
is the Celestial Cat on transparency; it is cropped to its alpha bounds, centred on a
square and scaled to twice the size the strip and the Pet slot draw it at.

    python tools/build_cosmetic_art.py
"""
from __future__ import annotations

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps" / "web" / "public"
PLATE_SRC = ROOT / "assets" / "ui" / "cosmetic_plate_v1.png"
PLATE_DST = PUBLIC / "textures" / "ui" / "cosmetic_plate_v1.webp"
PLATE_TILE = 256
CAT_SRC = ROOT / "assets" / "ui" / "cosmetic_cat_master.png"
CAT_DST = PUBLIC / "hud" / "cosmetic_celestial_cat.webp"
CAT_SIZE = 128
# Alpha at or below this is the model's soft haze, not the cat.
SOLID = 24


def main() -> None:
    plate = Image.open(PLATE_SRC).convert("RGB").resize((PLATE_TILE, PLATE_TILE), Image.LANCZOS)
    plate.save(PLATE_DST, "WEBP", quality=82, method=6)
    print(f"{PLATE_DST.relative_to(ROOT)}: {PLATE_TILE}px, {PLATE_DST.stat().st_size // 1024} KiB")

    sheet = Image.open(CAT_SRC).convert("RGBA")
    box = sheet.getchannel("A").point(lambda a: 255 if a > SOLID else 0).getbbox()
    assert box, f"{CAT_SRC} has no opaque pixels"
    cat = sheet.crop(box)
    side = max(cat.size)
    square = Image.new("RGBA", (side, side))
    square.alpha_composite(cat, ((side - cat.width) // 2, (side - cat.height) // 2))
    square.resize((CAT_SIZE, CAT_SIZE), Image.LANCZOS).save(CAT_DST, "WEBP", quality=90, method=6)
    print(f"{CAT_DST.relative_to(ROOT)}: {cat.width}x{cat.height} -> {CAT_SIZE}px, {CAT_DST.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
