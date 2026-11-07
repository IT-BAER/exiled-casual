"""Build every cursor bitmap the client ships.

Two looks (Options > UI): the plain arrow, from its 512 px master, and the gilt
blade, whose only masters are its first 64 px frames (normal and deny). Each
look comes in three states and four sizes:

  normal  the arrow at rest, its tip on the top-left corner (hotspot 0 0)
  deny    the same arrow cooled to red iron (an illegal drop target)
  press   PoE2's click tilt while a mouse button is held: the arrow leans in, its
          body foreshortened toward the tip by LEAN while the tip stays on the
          point. A hardware cursor cannot animate, so it snaps.

Every frame of both looks is turned TURN_DEG counter-clockwise around the tip.

Sizes are CSS px (DIP); every frame ships at 1x and 2x, named by its pixel size
(`cursor_plain_48.png` is Medium at 2x). The turned art fills the box. Never
above 32: Chromium drops a larger custom cursor near native UI.

Writes apps/web/public/textures/ui/cursor*.png. Run after touching a master:

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

SIZES = (20, 24, 28, 32)
# How far the pressed arrow foreshortens along its axis: a subtle lean, not a swing.
LEAN = 0.95
# The whole cursor's turn counter-clockwise; past ~23 deg its upper edge rises above the tip.
TURN_DEG = 11.0
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


def press_axis(art: np.ndarray) -> np.ndarray:
    """Unit vector from the tip (origin) to the silhouette's centroid: the arrow's axis."""
    ys, xs = np.nonzero(art[..., 3] > 8)
    v = np.array([xs.mean() + 0.5, ys.mean() + 0.5])
    return v / np.linalg.norm(v)


def silhouette(art: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(art[..., 3] > 8)
    return np.stack([xs + 0.5, ys + 0.5], 1)


def render(art: np.ndarray, m2: np.ndarray, px: int) -> Image.Image:
    """Source -> 2x2 linear map m2 (output px per source px), tip pinned at (0, 0)."""
    pm = art.copy()
    pm[..., :3] *= pm[..., 3:4] / 255  # premultiplied, or the rim bleeds dark
    m = np.hstack([m2 * SS, np.zeros((2, 1))]).astype(np.float32)
    big = cv2.warpAffine(pm, m, (px * SS, px * SS), flags=cv2.INTER_CUBIC,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    big = np.clip(big, 0, None)
    small = cv2.resize(big, (px, px), interpolation=cv2.INTER_AREA)
    a = np.clip(small[..., 3], 0, 255)
    rgb = np.where(a[..., None] > 0, small[..., :3] * 255 / np.maximum(a[..., None], 1e-3), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a]).round().astype(np.uint8), "RGBA")


def main() -> None:
    looks = {"plain": ("cursor_plain", plain_sources()), "gilt": ("cursor", gilt_sources())}
    for look, (stem, src) in looks.items():
        art = src["normal"]
        ax = press_axis(art)
        t = math.radians(TURN_DEG)
        turn = np.array([[math.cos(t), math.sin(t)], [-math.sin(t), math.cos(t)]])  # CCW, y down
        lean = np.eye(2) - (1 - LEAN) * np.outer(ax, ax)
        turned = silhouette(art) @ turn.T
        # Anything above the tip would be cut off at the bitmap's top edge.
        assert turned[:, 1].min() > -1, f"{look}: TURN_DEG lifts the art above its tip"
        for size in SIZES:
            k = size / turned.max()
            for scale in (1, 2):
                px = size * scale
                rest = turn * k * scale
                frames = {
                    "": render(src["normal"], rest, px),
                    "_deny": render(src["deny"], rest, px),
                    "_press": render(src["normal"], rest @ lean, px),
                }
                for suffix, im in frames.items():
                    im.save(UI / f"{stem}{suffix}_{px}.png", optimize=True)
            print(f"{look} {size}: {k:.4f} css px per source px")


if __name__ == "__main__":
    main()
