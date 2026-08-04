"""Tiling wave normal map for the strand's sea.

Generated, not sourced. Every BlenderKit water hit is either a procedural node
graph with no texture to extract or a royalty_free photoscan of a pool, and a
wave normal is one of the few surfaces a sum of sines describes exactly: pick
INTEGER wave numbers and the height field is periodic by construction, so it
tiles with no seam pass at all (unlike the biome plates, which need the 12%
cross-fade in build_tileset_textures.py).

Two travel directions per octave, so the crests cross instead of marching in
one direction like a conveyor belt.

    python tools/build_water_normal.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 512
OUT = Path(__file__).resolve().parent.parent / "apps/web/public/textures/water/water_normal.jpg"

# (wave numbers kx, ky, amplitude). Integers only: kx/ky are cycles across the
# whole tile, so any integer pair is periodic over it. Amplitudes fall off with
# frequency the way real wind chop does.
WAVES = [
    (2, 1, 1.00),
    (1, -3, 0.70),
    (4, 2, 0.45),
    (-3, 5, 0.30),
    (7, -4, 0.18),
    (9, 6, 0.11),
    (13, -11, 0.06),
]

# World height of the crests relative to the tile's own width. Low: this is wind
# chop on shallow water read from a camera 49 degrees up, not an ocean swell.
STEEPNESS = 5.0


def height_field() -> np.ndarray:
    u = np.linspace(0, 2 * np.pi, SIZE, endpoint=False)
    x, y = np.meshgrid(u, u)
    h = np.zeros((SIZE, SIZE), dtype=np.float64)
    for kx, ky, amp in WAVES:
        # A phase per wave, else every crest lines up at the origin and the tile
        # has one bright cross in it.
        phase = (kx * 1.7 + ky * 0.9) % (2 * np.pi)
        h += amp * np.sin(kx * x + ky * y + phase)
    return h / sum(a for _, _, a in WAVES)


def main() -> None:
    h = height_field()
    # Central differences with wraparound, so the derivative is periodic too — a
    # np.gradient here would give the edge column a one-sided slope and put a
    # visible line down the seam.
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * SIZE * STEEPNESS / 64
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * SIZE * STEEPNESS / 64
    n = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # Babylon reads tangent-space normals with +Y up in the texture, matching the
    # OpenGL convention Blender exports.
    rgb = np.clip((n * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(OUT, quality=92)
    print(f"wrote {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
