"""Slice the passive-tree sprite sheets into per-asset PNGs.

Masters (codex-imagegen output) live in assets/passives/; each sheet lays its
items out with clear transparent gutters, so the split is found from the alpha
itself rather than a guessed grid — the same measure-off-alpha rule
build_menu_textures.py follows. Rerun after regenerating a sheet.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "hud" / "passives"

FRAMES = ["frame-minor", "frame-notable", "frame-keystone", "frame-start"]
ICONS = [
    "life", "brawn", "mana", "spell", "cast", "crit", "armour", "ward",
    "fireRes", "coldRes", "lightRes", "chaosRes", "travel",
]

SIZE = 256  # longest side of a shipped asset


def spans(mask: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous runs of True, as [start, end) pairs."""
    out: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def cells(alpha: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Row-major (x0, y0, x1, y1) boxes split on fully transparent gutters."""
    boxes = []
    for y0, y1 in spans(alpha.any(axis=1)):
        row = alpha[y0:y1]
        for x0, x1 in spans(row.any(axis=0)):
            boxes.append((x0, y0, x1, y1))
    return boxes


def slice_sheet(sheet: Path, names: list[str]) -> None:
    im = Image.open(sheet).convert("RGBA")
    alpha = np.asarray(im)[:, :, 3] > 8
    boxes = cells(alpha)
    if len(boxes) != len(names):
        raise SystemExit(f"{sheet.name}: found {len(boxes)} regions, expected {len(names)}")
    for name, (x0, y0, x1, y1) in zip(names, boxes):
        crop = im.crop((x0, y0, x1, y1))
        crop = crop.crop(crop.getbbox())  # tighten within the cell
        crop.thumbnail((SIZE, SIZE), Image.LANCZOS)
        crop.save(OUT / f"{name}.png")
        print(f"{name}.png {crop.size[0]}x{crop.size[1]}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    slice_sheet(ROOT / "assets" / "passives" / "frames-sheet-v1.png", FRAMES)
    slice_sheet(ROOT / "assets" / "passives" / "icons-sheet-v1.png", ICONS)


if __name__ == "__main__":
    main()
