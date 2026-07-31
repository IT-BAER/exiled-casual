"""Take the horizon out of the life and mana globes.

The generated sphere art (`orb-{life,mana}-v2.png`) has a horizon in it. Around
half way down the ball the mottled surface stops and turns into vertical smears
for seventy rows, then picks up again underneath: the renderer drew a landscape
receding to a vanishing point rather than a wall of liquid, and the top of that
band is a hard horizontal line straight across the globe. It is painted INTO the
texture, so nothing layered over it in CSS can remove it, which is why the dodge
ramp underneath was fixed twice for a line that was never the ramp's.

The repair keeps the lighting and replaces only the texture. Split the image
into a vertical low-frequency part (the shading, which is correct) and its
detail (the mottling, which is smeared across the band). Inside the band, take
the detail from the rows just above it, mirrored, and cross-fade it in at both
ends so the patch cannot leave an edge of its own. The band is FOUND, not
declared: a smeared row barely differs from the row above it, which is exactly
what makes it measurable.

    python tools/deband_orb.py

Re-runnable: a repaired image has no low-detail band left to find, and the
script says so and writes nothing.
"""

import numpy as np
from PIL import Image

FILES = ("apps/web/public/hud/orb-life-v2.png", "apps/web/public/hud/orb-mana-v2.png")

#: Rows over which the shading is considered smooth. Well above the seventy-row
#: band, so the split cannot put any of the horizon into the "lighting" half.
SHADE_SIGMA = 40.0
#: A row is smeared when it differs from the row above it by less than this
#: fraction of the image's own median row-to-row difference.
SMEAR_RATIO = 0.45
#: Rows of cross-fade at each end of the patch.
FEATHER = 14


def blur_rows(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur down the image only. Columns are untouched."""
    radius = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    k /= k.sum()
    padded = np.pad(a, ((radius, radius), (0, 0), (0, 0)), mode="edge")
    out = np.zeros_like(a)
    for i, weight in enumerate(k):
        out += padded[i : i + a.shape[0]] * weight
    return out


def find_band(a: np.ndarray) -> tuple[int, int] | None:
    """The smeared rows, as [first, last]. None when there is no horizon left."""
    h, w, _ = a.shape
    core = a[:, w // 4 : 3 * w // 4, :3].mean(axis=2)
    step = np.abs(np.diff(core, axis=0)).mean(axis=1)
    inner = slice(int(h * 0.15), int(h * 0.85))
    smeared = np.zeros(h, bool)
    smeared[1:] = step < SMEAR_RATIO * np.median(step[inner])
    smeared[: inner.start] = False
    smeared[inner.stop :] = False
    rows = np.flatnonzero(smeared)
    if rows.size < 20:
        return None
    return int(rows.min()), int(rows.max())


def deband(path: str) -> None:
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float64)
    band = find_band(a)
    if band is None:
        print(f"{path}: no horizon found, left alone")
        return
    top, bottom = band
    span = bottom - top + 1

    rgb = a[:, :, :3]
    shade = blur_rows(rgb, SHADE_SIGMA)
    detail = rgb - shade

    # The donor: the same number of rows immediately above the band, mirrored, so
    # the mottling that runs into the horizon runs back out of it.
    src_top = max(0, top - span)
    donor = detail[src_top:top][::-1]
    if donor.shape[0] < span:
        donor = np.repeat(donor, int(np.ceil(span / max(donor.shape[0], 1))), axis=0)
    donor = donor[:span]

    # Feathered at both ends: a hard swap trades one horizontal line for two.
    mix = np.ones(span)
    ramp = np.linspace(0, 1, FEATHER)
    mix[:FEATHER] = ramp
    mix[-FEATHER:] = ramp[::-1]
    detail[top : bottom + 1] = (
        detail[top : bottom + 1] * (1 - mix)[:, None, None] + donor * mix[:, None, None]
    )

    a[:, :, :3] = np.clip(shade + detail, 0, 255)
    Image.fromarray(a.astype(np.uint8), "RGBA").save(path)
    print(f"{path}: horizon at rows {top}..{bottom} repaired from the {span} above it")


if __name__ == "__main__":
    for f in FILES:
        deband(f)
