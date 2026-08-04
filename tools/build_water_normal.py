"""Tiling wave normal map for the strand's sea.

Generated, not sourced. Every BlenderKit water hit is either a procedural node
graph with no texture to extract or a royalty_free photoscan of a pool.

Built in the FREQUENCY domain, which is how ocean surfaces are actually made:
fill a spectrum with random phases and an amplitude that falls off with wave
number, then inverse-FFT it. Two properties come free and neither is available
from a hand-written sum of sines — the field is exactly periodic (so it tiles
with no seam pass, unlike the biome plates), and it is ISOTROPIC. A sum of a
dozen sines is not: with that few directions the crests cross at fixed angles
and the water reads as woven plaid, which is what the first two attempts looked
like on screen.

    python tools/build_water_normal.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 512
OUT = Path(__file__).resolve().parent.parent / "apps/web/public/textures/water/water_normal.jpg"

# Wave numbers kept, in cycles across the tile. The low end is the reason this
# was regenerated twice: at a 9-unit tile, wave number 1 is a nine-metre swell,
# which on screen is a soft lump three body-lengths across. Wind chop on a
# shallow beach is decimetres, so the spectrum starts at 5. The high end stops
# short of Nyquist because anything finer only aliases into sparkle at this
# camera height.
K_MIN = 5
K_MAX = 90

# How fast amplitude falls with wave number. 1.6 is between a true Phillips
# spectrum's steepness and flat: flatter than this is sandpaper, steeper is the
# lumps again.
FALLOFF = 1.6

# Slope scale. Chosen against the frame, not derived: the water is lit by one
# low sun, so this is really "how much specular breakup", and past about 1.2 the
# highlights blow to white stripes.
STEEPNESS = 0.9

# Deterministic: the same texture every build, so a rebuild is never a silent
# art change.
SEED = 7


def height_field() -> np.ndarray:
    rng = np.random.default_rng(SEED)
    kx = np.fft.fftfreq(SIZE, d=1.0 / SIZE)
    ky = np.fft.fftfreq(SIZE, d=1.0 / SIZE)
    KX, KY = np.meshgrid(kx, ky, indexing="xy")
    k = np.hypot(KX, KY)
    amp = np.zeros_like(k)
    band = (k >= K_MIN) & (k <= K_MAX)
    amp[band] = k[band] ** -FALLOFF
    # Random phase per component, Hermitian-symmetrised by taking the real part
    # of the transform: the field stays real and stays periodic.
    phase = rng.uniform(0, 2 * np.pi, size=k.shape)
    spectrum = amp * np.exp(1j * phase)
    h = np.real(np.fft.ifft2(spectrum))
    h /= np.abs(h).max()
    return h


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
    Image.fromarray(rgb).save(OUT, quality=94)
    print(f"wrote {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
