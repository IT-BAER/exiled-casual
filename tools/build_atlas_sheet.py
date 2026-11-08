"""Turn the Atlas sheet and backdrop masters into the three files the map device draws.

The world painting is printed on a torn parchment sheet lying on cloth, like PoE1's
Atlas. From `assets/ui/atlas_sheet_master_v1.png` (a blank sheet, real alpha outside
the tear) this writes:

- `atlas_sheet_v1.webp`: the paper, drawn under the painting;
- `atlas_sheet_mask_v1.webp`: where the painting is printed, the sheet shrunk and
  faded short of the tear, so a band of stained paper shows all the way round;

and from `assets/ui/atlas_backdrop_master_v1.png` the cloth, `atlas_backdrop_v1.webp`.
Rerun after replacing a master:

    python tools/build_atlas_sheet.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "ui"
OUT = ROOT / "apps" / "web" / "public" / "textures" / "ui"

WIDTH = 1600
# Below this alpha the master's matte is fringe, not paper.
ALPHA_FLOOR = 8
# Softness of the printed edge, as a share of the sheet width.
PRINT_BLUR = 0.025
# The blurred sheet reads 0.5 on the tear: the print starts above PRINT_FROM and is
# full at PRINT_FULL, which leaves a few px of bare paper and a soft worn ink edge.
PRINT_FROM = 0.58
PRINT_FULL = 0.92


def sheet() -> None:
    img = Image.open(SRC / "atlas_sheet_master_v1.png").convert("RGBA")
    alpha = np.asarray(img)[..., 3]
    ys, xs = np.nonzero(alpha > ALPHA_FLOOR)
    img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    img = img.resize((WIDTH, round(WIDTH * img.height / img.width)), Image.LANCZOS)
    rgba = np.asarray(img).astype(np.float32)
    a = rgba[..., 3] / 255.0

    img.save(OUT / "atlas_sheet_v1.webp", quality=82, alpha_quality=100)

    solid = Image.fromarray(((a > 0.5) * 255).astype(np.uint8), "L")
    inner = np.asarray(solid.filter(ImageFilter.GaussianBlur(WIDTH * PRINT_BLUR))).astype(np.float32) / 255.0
    ink = np.clip((inner - PRINT_FROM) / (PRINT_FULL - PRINT_FROM), 0.0, 1.0)
    ink = ink * ink * (3.0 - 2.0 * ink)
    mask = np.zeros_like(rgba)
    mask[..., :3] = 255.0
    mask[..., 3] = a * ink * 255.0
    Image.fromarray(mask.astype(np.uint8), "RGBA").save(OUT / "atlas_sheet_mask_v1.webp", lossless=True)


def backdrop() -> None:
    img = Image.open(SRC / "atlas_backdrop_master_v1.png").convert("RGB")
    img = img.resize((WIDTH, round(WIDTH * img.height / img.width)), Image.LANCZOS)
    img.save(OUT / "atlas_backdrop_v1.webp", quality=80)


if __name__ == "__main__":
    sheet()
    backdrop()
    for name in ("atlas_sheet_v1", "atlas_sheet_mask_v1", "atlas_backdrop_v1"):
        f = OUT / f"{name}.webp"
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size // 1024} KB  {Image.open(f).size}")
