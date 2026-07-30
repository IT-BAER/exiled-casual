"""Crop generated item masters to their alpha and fit them to the inventory grid.

A master out of `/codex-imagegen` is a big square with the object floating in the
middle of a lot of nothing. Two things have to happen before it is an icon, in this
order: CROP to the alpha bounds, THEN downscale. Downscaling first spends most of
the pixels on the transparent margin, and the object lands soft and small inside a
cell it should be filling.

A shipped icon is 128 px per grid cell (`ICON_CELL`), which is what every existing
icon in `apps/web/public/textures/items/` measures: a 2x2 base is 256x256, a 1x2
wand is 128x256. The object is fitted INSIDE that box with its aspect kept and
centred, so a 2x3 sword drawn slightly too wide is letterboxed rather than
squashed.

The footprint per icon is declared here rather than read out of `items.ts`, because
a base may not exist yet when its art is generated -- these run in the other order,
art first. `items.test.ts` is what makes the two agree once a base is wired up.

Usage:
    python tools/build_item_icons.py            # every entry in ICONS
    python tools/build_item_icons.py sword axe  # only entries whose name matches
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "assets" / "items"
OUT = ROOT / "apps" / "web" / "public" / "textures" / "items"

# Pixels per inventory cell. Every existing icon is built to this.
ICON_CELL = 128

# Alpha at or under this counts as transparent. See the film in `build()`.
ALPHA_FLOOR = 24

# Currency ships at twice the cell resolution: `portal_scroll.png` is 256 square in
# a 1x1 cell, because a 1x1 icon at 128 is the smallest thing in the panel and it
# was the first to look soft. A new currency icon matches its sibling, not the rule.
CURRENCY_CELL = 256

# master stem -> (output stem, cells wide, cells tall)
ICONS: list[tuple[str, str, int, int]] = [
    # One-handed weapons: tall and narrow, the same 1x3 footprint PoE gives a
    # one-hander, except the dirk which has to read as the small one.
    ("cindercleave_blade_v1", "cindercleave_blade", 1, 3),
    ("ashfall_axe_v1", "ashfall_axe", 2, 3),
    ("emberhead_maul_v1", "emberhead_maul", 2, 3),
    ("cinderfang_dirk_v1", "cinderfang_dirk", 1, 2),
    # Two-hander and the two shields.
    # 2x4, and v2: v1 was a bare rod whose content measured 14.6:1, so fitted into
    # any cell one wide it rendered a 35 px sliver. v2 is bladed at both ends and
    # laid on the diagonal, 0.62 wide to tall, which fills a 2x4 to 81%.
    ("ashen_quarterstaff_v2", "ashen_quarterstaff", 2, 4),
    ("ember_buckler_v1", "ember_buckler", 2, 2),
    ("ashwall_tower_shield_v1", "ashwall_tower_shield", 2, 3),
    # Armour, matching the footprint the existing base in each slot already uses.
    ("ashplate_helm_v1", "ashplate_helm", 2, 2),
    ("emberbone_circlet_v1", "emberbone_circlet", 2, 2),
    ("ironcoil_girdle_v1", "ironcoil_girdle", 2, 1),
    ("cinderhide_strap_v1", "cinderhide_strap", 2, 1),
    ("ashen_bracers_v1", "ashen_bracers", 2, 2),
    ("cinderplate_gauntlets_v1", "cinderplate_gauntlets", 2, 2),
    # v2: v1 came back as modern low-cut dress shoes, which is not a slot this game
    # has, and at 1.79 wide to tall it also filled a 2x2 to only 56%.
    ("emberstep_shoes_v2", "emberstep_shoes", 2, 2),
    ("ashen_sabatons_v1", "ashen_sabatons", 2, 2),
    # The scroll replaces the one hand-authored SVG in the pool.
    ("wisdom_scroll_v1", "wisdom_scroll", 1, 1),
]

# The browser-tab mark, which is not an inventory icon and does not go through
# `build()`: no grid cell, and it is cropped SQUARE rather than to its alpha. The
# badge master's side spikes make it wider than tall, so an alpha crop letterboxes
# the badge and spends a 16 px tab icon on two spike tips -- clipping them instead
# gives the letters about 10% more pixels, which is the difference between the C
# reading and not. 48/32/16 in one .ico so `/favicon.ico` answers with no markup;
# 180 px PNG is what iOS wants for a home-screen tile.
FAVICON_MASTER = "logo_mark_badge_v1"
FAVICON_SIZES = (48, 32, 16)
APPLE_TOUCH = 180
# The two sizes a browser wants before it will offer to install the game: 192 for
# the launcher tile, 512 for the splash it draws while the client boots.
PWA_SIZES = (192, 512)


def build(master: Path, out: Path, cells_w: int, cells_h: int, cell: int = ICON_CELL) -> str:
    im = Image.open(master).convert("RGBA")
    # A generated master often carries a near-invisible film of alpha right across
    # the frame -- 9 to 14 out of 255 on four of the first batch. `getbbox()` counts
    # anything not EXACTLY zero, so that film makes the crop a no-op, the object
    # keeps its transparent margin, and it lands small and soft inside its cell.
    # Anything under the floor is snapped to clear before the bounds are measured.
    # 24, not 16: the bracers' film sat at 0-7 but sprinkled single pixels up to 17
    # across the frame, so a floor of 16 left the bbox at the full frame anyway. A
    # sparse speckle needs headroom, and 24 is still safe against real art -- an
    # ember edge glows, it does not sit at 9%. Costs at most 1 px on every master.
    alpha = im.getchannel("A").point(lambda v: 0 if v <= ALPHA_FLOOR else v)
    im.putalpha(alpha)
    box = im.getbbox()  # alpha-aware: the bounds of everything not fully clear
    if box is None:
        raise SystemExit(f"{master.name}: fully transparent, nothing to crop")
    im = im.crop(box)
    target = (cells_w * cell, cells_h * cell)
    # Fit, never fill: an icon squashed to the cell aspect is a bent sword.
    scale = min(target[0] / im.width, target[1] / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                   Image.LANCZOS)
    canvas = Image.new("RGBA", target, (0, 0, 0, 0))
    canvas.paste(im, ((target[0] - im.width) // 2, (target[1] - im.height) // 2))
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    return f"{master.name} {box[2] - box[0]}x{box[3] - box[1]} cropped -> {out.name} {target[0]}x{target[1]}"


def build_favicon() -> str:
    master = MASTERS / f"{FAVICON_MASTER}.png"
    im = Image.open(master).convert("RGBA")
    alpha = im.getchannel("A").point(lambda v: 0 if v <= ALPHA_FLOOR else v)
    im.putalpha(alpha)
    im = im.crop(im.getbbox())
    side = min(im.size)
    im = im.crop(((im.width - side) // 2, (im.height - side) // 2,
                  (im.width - side) // 2 + side, (im.height - side) // 2 + side))
    root = ROOT / "apps" / "web" / "public"
    im.resize((APPLE_TOUCH, APPLE_TOUCH), Image.LANCZOS).save(root / "apple-touch-icon.png")
    im.save(root / "favicon.ico", sizes=[(s, s) for s in FAVICON_SIZES])
    for px in PWA_SIZES:
        im.resize((px, px), Image.LANCZOS).save(root / f"icon-{px}.png")
    return (f"{master.name} {side}x{side} squared -> favicon.ico "
            f"{'/'.join(str(s) for s in FAVICON_SIZES)} + apple-touch-icon.png {APPLE_TOUCH}"
            f" + icon-{'/'.join(str(s) for s in PWA_SIZES)}.png")


def main() -> None:
    picks = sys.argv[1:]
    missing: list[str] = []
    for stem, out_stem, w, h in ICONS:
        if picks and not any(p in stem for p in picks):
            continue
        master = MASTERS / f"{stem}.png"
        if not master.exists():
            missing.append(master.name)
            continue
        cell = CURRENCY_CELL if out_stem.endswith("_scroll") else ICON_CELL
        print(build(master, OUT / f"{out_stem}.png", w, h, cell))
    for name in missing:
        print(f"SKIP (no master yet): {name}")
    if not picks or any(p in "favicon" for p in picks):
        print(build_favicon())


if __name__ == "__main__":
    main()
