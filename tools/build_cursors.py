"""Build every cursor bitmap the client ships, and the hotspots the CSS needs.

Two looks (Options > UI): the plain arrow, from its 512 px master, and the gilt
blade, whose only masters are its first 64 px frames (normal and deny). Each
look comes in three states and four sizes:

  normal  the arrow at rest
  deny    the same arrow cooled to red iron (an illegal drop target)
  press   tilted TILT_DEG clockwise around the tip while a mouse button is held,
          PoE2's click tilt; a hardware cursor cannot animate, so it snaps

Sizes are CSS px (DIP); every frame ships at 1x and 2x, named by its pixel size
(`cursor_plain_48.png` is Medium at 2x). Chromium drops a custom cursor larger
than 32 DIP near native UI, so the TILTED frame must also fit 32 at Huge: the art
is scaled per size until the tilted silhouette fits the box, and the tip of a
tilted frame sits right of the bitmap's left edge, which the hotspot carries.

Writes apps/web/public/textures/ui/cursor*.png and
apps/web/src/cursor-frames.generated.ts. Run after touching a master:

    python tools/build_cursors.py
"""
from __future__ import annotations

import math
import pathlib

import cv2
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
UI = ROOT / "apps" / "web" / "public" / "textures" / "ui"
GENERATED = ROOT / "apps" / "web" / "src" / "cursor-frames.generated.ts"

SIZES = (20, 24, 28, 32)
TILT_DEG = 15.0
# The plain arrow read too bright beside the HUD; colour scaled, alpha untouched.
PLAIN_GAIN = 0.8
# Luminance -> red iron, fitted on the first plain deny frame (mean error 0.25/255).
DENY_RAMP = np.array([[-0.91255, 0.85597], [-1.05914, 0.29893], [-1.06838, 0.23869]])
SS = 8  # supersampling of the intermediate canvas


def crop_from(img: np.ndarray, x0: int, y0: int) -> np.ndarray:
    """Crop to the alpha bounds, with the tip corner (x0, y0) as the new origin."""
    ys, xs = np.nonzero(img[..., 3] > 0)
    return img[y0 : ys.max() + 1, x0 : xs.max() + 1]


def load(path: pathlib.Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.float32)


def plain_sources() -> dict[str, np.ndarray]:
    master = load(ROOT / "assets" / "ui" / "cursor_plain_master.png")
    ys, xs = np.nonzero(master[..., 3] > 0)
    art = crop_from(master, int(xs.min()), int(ys.min())).copy()
    art[..., :3] *= PLAIN_GAIN
    lum = art[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    deny = art.copy()
    deny[..., :3] = np.clip(DENY_RAMP[:, 0] + lum[..., None] * DENY_RAMP[:, 1], 0, 255)
    return {"normal": art, "deny": deny}


def gilt_sources() -> dict[str, np.ndarray]:
    # Tip at (1, 1) of the 64 px frame: the blade's point sits one pixel in.
    return {
        "normal": crop_from(load(ROOT / "assets" / "ui" / "cursor_gilt_master.png"), 1, 1),
        "deny": crop_from(load(ROOT / "assets" / "ui" / "cursor_gilt_deny_master.png"), 1, 1),
    }


def rotate(pts: np.ndarray, deg: float) -> np.ndarray:
    """Clockwise on screen (y down) around the origin."""
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return np.stack([pts[:, 0] * c - pts[:, 1] * s, pts[:, 0] * s + pts[:, 1] * c], 1)


def silhouette(art: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(art[..., 3] > 8)
    return np.stack([xs + 0.5, ys + 0.5], 1).astype(np.float64)


def layout(art: np.ndarray, size: int) -> tuple[float, int]:
    """Largest art scale (CSS px per source px) whose rest AND tilted frames fit `size`,
    and the tilted frame's integer hotspot x."""
    pts = silhouette(art)
    rest_w, rest_h = pts[:, 0].max(), pts[:, 1].max()
    tilt = rotate(pts, TILT_DEG)
    best = (0.0, 0)
    for step in range(1, 4000):
        k = step / 4000 * size / rest_h
        hx = math.ceil(-tilt[:, 0].min() * k)
        if (rest_w * k > size or rest_h * k > size or hx + tilt[:, 0].max() * k > size
                or tilt[:, 1].max() * k > size):
            break
        best = (k, hx)
    return best


def render(art: np.ndarray, k: float, deg: float, hx: float, px: int) -> Image.Image:
    """Source -> scale k (output px per source px) -> rotate around the tip -> tip at (hx, 0)."""
    pm = art.copy()
    pm[..., :3] *= pm[..., 3:4] / 255  # premultiplied, or the rim bleeds dark
    t = math.radians(deg)
    c, s = math.cos(t) * k * SS, math.sin(t) * k * SS
    m = np.array([[c, -s, hx * SS], [s, c, 0.0]], np.float32)
    big = cv2.warpAffine(pm, m, (px * SS, px * SS), flags=cv2.INTER_CUBIC,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    big = np.clip(big, 0, None)
    small = cv2.resize(big, (px, px), interpolation=cv2.INTER_AREA)
    a = np.clip(small[..., 3], 0, 255)
    rgb = np.where(a[..., None] > 0, small[..., :3] * 255 / np.maximum(a[..., None], 1e-3), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a]).round().astype(np.uint8), "RGBA")


def main() -> None:
    looks = {"plain": ("cursor_plain", plain_sources()), "gilt": ("cursor", gilt_sources())}
    hot: dict[str, dict[int, int]] = {}
    for look, (stem, src) in looks.items():
        hot[look] = {}
        for size in SIZES:
            k, hx = layout(src["normal"], size)
            hot[look][size] = hx
            for scale in (1, 2):
                px = size * scale
                frames = {
                    "": render(src["normal"], k * scale, 0, 0, px),
                    "_deny": render(src["deny"], k * scale, 0, 0, px),
                    "_press": render(src["normal"], k * scale, TILT_DEG, hx * scale, px),
                }
                for suffix, im in frames.items():
                    im.save(UI / f"{stem}{suffix}_{px}.png", optimize=True)
            print(f"{look} {size}: art {k * src['normal'].shape[0]:.1f} px tall, press hotspot {hx} 0")
    rows = "\n".join(
        f"  {look}: {{ {', '.join(f'{s}: {h}' for s, h in sizes.items())} }},"
        for look, sizes in hot.items()
    )
    GENERATED.write_text(
        "// GENERATED by tools/build_cursors.py. Do not edit.\n"
        "/** Hotspot x (CSS px) of each look's tilted press frame, per cursor size; y is 0. */\n"
        f"export const PRESS_HOTSPOT_X = {{\n{rows}\n}} as const;\n",
        encoding="utf-8",
        newline="\n",
    )


if __name__ == "__main__":
    main()
