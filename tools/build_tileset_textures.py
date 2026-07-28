"""Turn the generated biome wall masters into shippable tiling textures.

Generated art does not tile. That was the known cost of choosing generation over
a CC0 library, and this is the pass that pays it: every master is made seamless,
downscaled, and given a derived normal map, because the generator ships neither
a seam nor a normal.

Run after adding or regenerating a master:

    python tools/build_tileset_textures.py

Masters:  assets/tilesets/<biome>/wall_master_v1.png    (committed)
          assets/tilesets/<biome>/floor_master_v1.png
Output:   apps/web/public/textures/tilesets/<biome>/wall_color.jpg
          apps/web/public/textures/tilesets/<biome>/wall_normal.jpg
          apps/web/public/textures/tilesets/<biome>/floor_color.jpg

`level.ts` looks these up by tileset id, and `level.test.ts` fails if a biome in
MAP_BASES has no files here.
"""

from __future__ import annotations

import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "assets" / "tilesets"
OUT = ROOT / "apps" / "web" / "public" / "textures" / "tilesets"

BIOMES = ["vaal_stone", "desert", "swamp", "forest"]

# Shipped size. The old CC0 stone wall was 1024x512 and read fine at the game's
# 2-world-unit repeat; matching it keeps the memory cost where it was. The floor
# matches the old floor.png at 1024 square.
SHIP_W, SHIP_H = 1024, 512
FLOOR_SHIP = 1024

# Fraction of each axis spent cross-fading the wrap. Wide enough to hide a hard
# mismatch, narrow enough that the blended band is not a visible smear: at 0.12
# the band is ~120px of a 1024-wide plate.
BLEND = 0.12

# How hard the derived normal map bites. The generator gives us no height data,
# so luminance stands in for it; past ~3 the mortar lines start to look inflated
# rather than recessed.
NORMAL_STRENGTH = 2.2

# Minimum mean luminance, 0-255. The renderer is calibrated against two specific
# plates: the hideout floor at 57 and the CC0 wall at 132, and engine.ts lifts the
# floor above 1.0 precisely because "the actors are near-black, and they only read
# as silhouettes if the floor is clearly brighter than they are".
#
# The generated art does not respect that. Straight from the model the floors ran
# 37 (forest) to 162 (desert) and the walls 41 (swamp) to 191 — a swamp floor at
# 47 swallowed the character whole, and a swamp wall at 41 read as a black void
# with no masonry in it at all.
#
# So this is a FLOOR, not a target: lift the plates that are too dark to play on,
# and leave the bright ones alone, because a bright desert is a desert and a
# character reads even better against it.
FLOOR_MIN_LUMA = 55.0
WALL_MIN_LUMA = 95.0


def mean_luma(a: np.ndarray) -> float:
    return float((0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]).mean())


def lift_luma(a: np.ndarray, target: float) -> tuple[np.ndarray, float, float]:
    """Raise mean luminance to `target` by gamma, leaving brighter plates alone.

    Gamma rather than a multiply: a 3x multiply on a dark plate clips every
    highlight to white and the masonry turns to paste, while x**g cannot leave
    0..1 and keeps the midtone detail that makes stone look like stone.
    """
    before = mean_luma(a)
    if before >= target:
        return a, before, before
    x = a / 255.0
    lo, hi = 0.05, 1.0
    for _ in range(40):  # bisect on gamma; mean is monotonic in it
        g = (lo + hi) / 2
        if mean_luma((x**g) * 255.0) < target:
            hi = g
        else:
            lo = g
    out = (x ** ((lo + hi) / 2)) * 255.0
    return out, before, mean_luma(out)


def make_seamless(a: np.ndarray) -> np.ndarray:
    """Crop the overlap off each axis and cross-fade it back over the far edge.

    The output is (W-bw, H-bh). Column 0 of the result is the original column
    W-bw, which is exactly what the last kept column flows into, so the wrap is
    continuous by construction rather than by eye.
    """
    for axis in (1, 0):
        n = a.shape[axis]
        b = max(2, int(round(n * BLEND)))
        a = np.swapaxes(a, 0, axis)
        head, tail = a[:b], a[n - b:]
        alpha = (np.arange(b, dtype=np.float32) / (b - 1)).reshape(-1, 1, 1)
        a = np.concatenate([tail * (1.0 - alpha) + head * alpha, a[b:n - b]], axis=0)
        a = np.swapaxes(a, 0, axis)
    return a


def seam_error(a: np.ndarray) -> tuple[float, float]:
    """Mean per-channel difference across each wrap. 0 is a perfect tile."""
    lr = float(np.abs(a[:, 0] - a[:, -1]).mean())
    tb = float(np.abs(a[0, :] - a[-1, :]).mean())
    return lr, tb


def normal_map(rgb: np.ndarray) -> np.ndarray:
    """Tangent-space normal from luminance-as-height, wrapping at the edges so
    the normal map tiles as cleanly as the colour it came from."""
    lum = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]) / 255.0
    # Central differences with wrap: np.roll is the whole reason this tiles.
    dx = (np.roll(lum, -1, axis=1) - np.roll(lum, 1, axis=1)) * 0.5
    dy = (np.roll(lum, -1, axis=0) - np.roll(lum, 1, axis=0)) * 0.5
    nx = -dx * NORMAL_STRENGTH
    ny = -dy * NORMAL_STRENGTH
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx / length, ny / length, nz / length], axis=-1)
    return ((out * 0.5 + 0.5) * 255.0).clip(0, 255).astype(np.uint8)


def plate(
    src: pathlib.Path, size: tuple[int, int], min_luma: float
) -> tuple[Image.Image, str] | None:
    """Load a master, make it tile, lift it if it is too dark to play on, and
    downscale it to its shipped size."""
    if not src.exists():
        print(f"    MISSING {src.relative_to(ROOT)}")
        return None
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    before = seam_error(a)
    a = make_seamless(a)
    after = seam_error(a)
    a, luma_before, luma_after = lift_luma(a, min_luma)
    img = Image.fromarray(a.clip(0, 255).astype(np.uint8)).resize(size, Image.LANCZOS)
    note = (
        f"seam L-R {before[0]:5.2f}->{after[0]:4.2f}  T-B {before[1]:5.2f}->{after[1]:4.2f}"
        f"  luma {luma_before:5.1f}->{luma_after:5.1f}"
    )
    return img, note


def build(biome: str) -> bool:
    dst = OUT / biome
    dst.mkdir(parents=True, exist_ok=True)

    wall = plate(MASTERS / biome / "wall_master_v1.png", (SHIP_W, SHIP_H), WALL_MIN_LUMA)
    if wall is None:
        return False
    wall_img, wall_note = wall
    wall_img.save(dst / "wall_color.jpg", quality=92)
    Image.fromarray(normal_map(np.asarray(wall_img).astype(np.float32))).save(
        dst / "wall_normal.jpg", quality=92
    )
    print(f"  {biome:11s} wall   {wall_note}")

    floor = plate(MASTERS / biome / "floor_master_v1.png", (FLOOR_SHIP, FLOOR_SHIP), FLOOR_MIN_LUMA)
    if floor is None:
        return False
    floor_img, floor_note = floor
    floor_img.save(dst / "floor_color.jpg", quality=92)
    print(f"  {biome:11s} floor  {floor_note}  ->  {dst.relative_to(ROOT)}")
    return True


def main() -> int:
    print(f"building biome tileset textures -> {OUT.relative_to(ROOT)}")
    ok = all([build(b) for b in BIOMES])
    if not ok:
        print("FAILED: a master is missing", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
