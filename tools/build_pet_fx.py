"""Turn the Celestial Cat's generated FX masters into the textures pet.ts ships.

PoE's cat wears GGG's textures; ours replace them one for one by ROLE, and this
pass gives each of ours the tone of the texture it replaces, measured once off
PoE's own files (study notes, never shipped or read here). The masters come off
the generator several times too bright for those roles: our nebula averaged luma
83 where `space-02` runs 23, our coat 20 where `space_bg_at` runs 2.9.

- Tiles (`starfield`, `nebula`) are drawn screen-projected and repeat, so they
  are made seamless, then each channel is mapped onto PoE's quantile curve:
  stars stay points of light while the space between them goes PoE's black.
- Sprites (`starburst`, `wisp`, `swirl`) are additive on black: the generator's
  1-2/255 floor is cut (it would add a grey square), the content cropped square,
  and scaled to the luma of PoE's premultiplied mean, keeping its own hue.
- `cloud_mask` already lands on PoE's mean (47 vs 49) and ships as drawn.
- The glows and the spark dot are plain radial ramps, computed from PoE's
  measured colour stops; nothing to generate.

    python tools/build_pet_fx.py
"""
from __future__ import annotations

import pathlib
import sys

import numpy as np
from PIL import Image

from build_tileset_textures import make_seamless, seam_error

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "pets" / "source"
OUT = ROOT / "apps" / "web" / "public" / "textures" / "fx" / "pet"

QUANTILES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.999, 1]
# Per channel (r, g, b), at QUANTILES, measured off space_bg_at.dds and space-02.dds.
TILES = {
    "starfield": ("starfield_v1.png", 512, (
        [0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 5, 8, 18, 41, 148, 255],
        [0, 1, 1, 1, 1, 2, 2, 2, 4, 4, 6, 12, 25, 48, 150, 247],
        [0, 0, 2, 2, 2, 2, 4, 5, 5, 10, 18, 32, 46, 73, 181, 255],
    )),
    "nebula": ("fx/nebula_v1.png", 512, (
        [0, 5, 7, 10, 13, 18, 23, 29, 38, 55, 81, 136, 198, 255, 255, 255],
        [0, 5, 6, 7, 9, 12, 16, 21, 28, 42, 58, 100, 175, 255, 255, 255],
        [0, 2, 4, 6, 9, 13, 21, 29, 38, 54, 73, 113, 185, 255, 255, 255],
    )),
}
# Premultiplied mean (r, g, b) of sparklemid, wisp_smoke_add and scrolling_tex.
SPRITES = {
    "starburst": ("fx/starburst_v1.png", (11.29, 18.18, 38.47)),
    "wisp": ("fx/wisp_v1.png", (11.59, 10.41, 27.4)),
    "swirl": ("fx/swirl_v1.png", (2.95, 0.95, 7.61)),
}
SPRITE_SIZE = 256
# Below this a master's background is generator noise, not light.
FLOOR = 3
# Radial colour stops, premultiplied, centre to edge at 9 even steps of the radius.
GLOWS = {
    "glow_blue": (128, [(174, 207, 255), (134, 163, 250), (95, 105, 221), (64, 58, 185), (45, 28, 144),
                        (28, 7, 102), (16, 0, 59), (7, 0, 23), (0, 0, 0)]),
    "glow_violet": (128, [(135, 0, 251), (119, 0, 233), (96, 0, 203), (69, 0, 166), (44, 0, 127),
                          (26, 0, 88), (12, 0, 52), (4, 0, 21), (0, 0, 0)]),
    "spark": (32, [(205, 200, 246), (118, 111, 234), (39, 30, 195), (19, 14, 102), (9, 6, 45),
                   (3, 2, 14), (0, 0, 2), (0, 0, 0), (0, 0, 0)]),
}


def rgb(path: pathlib.Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def luma(c: np.ndarray) -> float:
    return float(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])


def match_quantiles(a: np.ndarray, target: tuple[list[int], ...]) -> np.ndarray:
    out = np.empty_like(a)
    for c in range(3):
        ours = np.quantile(a[..., c], QUANTILES)
        # np.interp needs a rising x; a run of equal quantiles (a black floor) is nudged apart.
        ours = ours + np.arange(len(QUANTILES)) * 1e-3
        out[..., c] = np.interp(a[..., c], ours, np.asarray(target[c], np.float32))
    return out


def tile(name: str) -> str:
    src, size, target = TILES[name]
    a = rgb(SRC / src)
    before = seam_error(a)
    a = make_seamless(a)
    img = Image.fromarray(a.clip(0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    a = match_quantiles(np.asarray(img).astype(np.float32), target)
    after = seam_error(a)
    Image.fromarray(a.clip(0, 255).round().astype(np.uint8)).save(OUT / f"{name}.webp", quality=90)
    return f"seam {before[0]:5.2f}/{before[1]:5.2f} -> {after[0]:4.2f}/{after[1]:4.2f}  mean {a.reshape(-1, 3).mean(0).round(1)}"


def sprite(name: str) -> str:
    src, mean = SPRITES[name]
    a = rgb(SRC / src)
    a = np.maximum(a - FLOOR, 0) * (255 / (255 - FLOOR))
    # Square crop round the lit content, centred, so the quad is the sprite.
    lit = np.argwhere(a.max(-1) > 8)
    (y0, x0), (y1, x1) = lit.min(0), lit.max(0) + 1
    half = max(y1 - y0, x1 - x0) // 2 + 4
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    pad = np.zeros((a.shape[0] + 2 * half, a.shape[1] + 2 * half, 3), np.float32)
    pad[half:half + a.shape[0], half:half + a.shape[1]] = a
    a = pad[cy:cy + 2 * half, cx:cx + 2 * half]
    img = Image.fromarray(a.clip(0, 255).astype(np.uint8)).resize((SPRITE_SIZE, SPRITE_SIZE), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32)
    # One gain on luma: a gain per channel clips the white core to a tint.
    gain = luma(np.asarray(mean, np.float32)) / max(luma(a.reshape(-1, 3).mean(0)), 1e-3)
    a = a * gain
    Image.fromarray(a.clip(0, 255).round().astype(np.uint8)).save(OUT / f"{name}.webp", quality=90)
    return f"crop {2 * half}px  gain {gain:.2f}  mean {a.clip(0, 255).reshape(-1, 3).mean(0).round(1)}"


def glow(name: str) -> str:
    size, stops = GLOWS[name]
    c = (size - 1) / 2
    yy, xx = np.mgrid[:size, :size]
    r = np.hypot(yy - c, xx - c) / (size / 2)
    at = np.linspace(0, 1, len(stops))
    s = np.asarray(stops, np.float32)
    a = np.stack([np.interp(r, at, s[:, ch], right=0) for ch in range(3)], -1)
    Image.fromarray(a.clip(0, 255).round().astype(np.uint8)).save(OUT / f"{name}.webp", quality=90, lossless=size <= 32)
    return f"{size}px  centre {tuple(int(v) for v in a[size // 2, size // 2])}"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"building pet fx -> {OUT.relative_to(ROOT)}")
    missing = [p for p in [SRC / v[0] for v in TILES.values()] + [SRC / v[0] for v in SPRITES.values()]
               + [SRC / "fx" / "cloud_mask_v1.png"] if not p.exists()]
    if missing:
        print("FAILED: missing " + ", ".join(str(p.relative_to(ROOT)) for p in missing), file=sys.stderr)
        return 1
    for name in TILES:
        print(f"  {name:11s} {tile(name)}")
    for name in SPRITES:
        print(f"  {name:11s} {sprite(name)}")
    mask = Image.open(SRC / "fx" / "cloud_mask_v1.png").convert("L").resize((256, 256), Image.LANCZOS)
    mask.save(OUT / "cloud_mask.webp", quality=90)
    print(f"  cloud_mask  256px  mean {np.asarray(mask).mean():.1f}")
    for name in GLOWS:
        print(f"  {name:11s} {glow(name)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
