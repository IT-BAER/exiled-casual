"""Turn the generated loading-screen masters into the plates the client ships.

One wallpaper per biome, plus the hideout, plus one small boot plate that
`index.html` can afford to block the first paint on.

Two things this script exists to do, neither of which is optional.

**It upscales.** The generator caps out around 1672x941, and the plate is drawn
full-bleed on a display that is routinely 2560 wide. Shipping the master means
the browser does the upscale with a bilinear filter at draw time, every frame,
on art that is already soft. Doing it here with Lanczos plus a light unsharp
pass is strictly better and costs nothing at runtime. It is still an upscale and
still not free detail: if the generator ever renders larger, drop the target
below the master's own size and this becomes a downscale, which is what you
actually want.

**It re-encodes to JPEG.** These are photographic paintings with no alpha and no
flat colour; PNG spends four megabytes on what JPEG q82 carries in three hundred
kilobytes, and the plate is the one asset whose whole job is to be on screen
before anything else is.

Run after regenerating anything in assets/loading/:

    python tools/build_loading_textures.py
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "loading"
OUT = ROOT / "apps" / "web" / "public" / "textures" / "loading"

# Keyed by BIOME id, because that is what the client resolves the filename from
# (`GameView` reads `base.biomeId`). "hideout" is not a biome and is the one
# entry that is not in `BIOMES` — it is the area with no map base at all.
PLATES = ["vaal_stone", "desert", "swamp", "forest", "hideout"]

# 1440p. Above this the file grows faster than the plate improves, and the plate
# is behind a UI band and a gradient for most of its height.
TARGET = (2560, 1440)
QUALITY = 82

# What index.html blocks its first paint on. Small on purpose: it is downloaded
# before the 5 MB bundle, in front of a user who is looking at nothing.
BOOT_FROM = "hideout"
BOOT_SIZE = (1280, 720)
BOOT_QUALITY = 72


def newest_master(biome: str) -> pathlib.Path | None:
    """The highest-numbered `<biome>_v<N>.png`. Versions are kept, never overwritten."""
    found = sorted(SRC.glob(f"{biome}_v*.png"))
    return found[-1] if found else None


def to_plate(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Cover-fit to `size`, then sharpen just enough to pay back the upscale."""
    im = im.convert("RGB")
    sw, sh = im.size
    tw, th = size
    # Cover, not fit: the client draws this with `object-fit: cover` and a letterbox
    # baked into the file would show as two black bars inside the covered area.
    scale = max(tw / sw, th / sh)
    im = im.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    left = (im.width - tw) // 2
    top = (im.height - th) // 2
    im = im.crop((left, top, left + tw, top + th))
    if scale > 1.0:
        # Radius under a pixel: this is meant to put back the edge the resample
        # softened, not to add detail the master never had. Anything stronger
        # haloes the high-contrast silhouettes these plates are built out of.
        im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=3))
    return im


def main() -> int:
    if not SRC.is_dir():
        print(f"missing masters directory: {SRC}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    missing = [b for b in PLATES if newest_master(b) is None]
    if missing:
        # Loud rather than partial: a biome whose plate silently never built is a
        # biome that ships a blank loading screen, and the client cannot tell the
        # difference between that and a slow network.
        print(f"no master found for: {', '.join(missing)}", file=sys.stderr)
        return 1

    for biome in PLATES:
        master = newest_master(biome)
        assert master is not None
        with Image.open(master) as im:
            plate = to_plate(im, TARGET)
            dest = OUT / f"{biome}.jpg"
            plate.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            print(f"{master.name} {im.size} -> {dest.name} {plate.size} {dest.stat().st_size // 1024}kB")

            if biome == BOOT_FROM:
                boot = to_plate(im, BOOT_SIZE)
                bdest = OUT / "boot.jpg"
                boot.save(bdest, "JPEG", quality=BOOT_QUALITY, optimize=True, progressive=True)
                print(f"{master.name} -> {bdest.name} {boot.size} {bdest.stat().st_size // 1024}kB")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
