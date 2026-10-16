"""Scale the HUD masters in assets/ to the size the client draws them at, as lossless WebP.

Every entry is sized in vw (Hud.tsx, BuffBar.tsx, CharacterPanel.tsx), so its pixels
grow with the window. The target is twice the drawn size on a 2048 px wide viewport:
one file pixel per device pixel up to a 4096 px wide screen, and no 1024 px globe
fetched to paint 211 CSS px. Rerun after replacing a master:

    python tools/build_ui_webp.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
PUBLIC = ROOT / "apps" / "web" / "public"

SKILLS = [
    "blink", "cinder_ground", "ember_bolt", "ember_spark", "ground_slam", "heavy_strike",
    "move", "piercing_shot", "snap_shot", "split_arrow", "strike", "town_portal",
]

# master, shipped file, target height in px (width keeps the master's aspect)
PLAN: list[tuple[Path, Path, int]] = [
    # ORB_VW 10.3vw sphere; the ring is the sphere over ORB_HOLE, the figures 1.08 of it.
    (ASSETS / "hud" / "orb-life-v2.png", PUBLIC / "hud" / "orb-life-v2.webp", 422),
    (ASSETS / "hud" / "orb-mana-v2.png", PUBLIC / "hud" / "orb-mana-v2.webp", 422),
    (ASSETS / "hud" / "orb-ring-v6.png", PUBLIC / "hud" / "orb-ring-v6.webp", 486),
    (ASSETS / "hud" / "orb-figure-life-v5.png", PUBLIC / "hud" / "orb-figure-life-v5.webp", 456),
    (ASSETS / "hud" / "orb-figure-mana-v5.png", PUBLIC / "hud" / "orb-figure-mana-v5.webp", 456),
    # Buff bar tile, 2.4vw less its 1px border.
    (ASSETS / "buffs" / "grace.png", PUBLIC / "textures" / "buffs" / "grace.webp", 95),
    # 2x2 sheet drawn at background-size 200%: 83 px per quadrant, so the quadrants stay whole.
    (ASSETS / "ui" / "char_icons_v1.png", PUBLIC / "textures" / "ui" / "char_icons_v1.webp", 166),
    # Skill tile content box (SLOT minus its 1px border).
    *[(ASSETS / "skills" / f"{n}.png", PUBLIC / "textures" / "skills" / f"{n}.webp", 111) for n in SKILLS],
]


def main() -> None:
    for src, dst, height in PLAN:
        im = Image.open(src).convert("RGBA")
        width = max(1, round(im.width * height / im.height))
        im.resize((width, height), Image.LANCZOS).save(dst, "WEBP", lossless=True, method=6)
        print(f"{dst.relative_to(PUBLIC)}: {im.width}x{im.height} -> {width}x{height}, {dst.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
