"""Build the loading spinner's sprite sheet.

    python tools/build_loading_spinner.py

Drives Blender over `tools/render_loading_spinner.py` (which is where the scene
and the look live), then packs the frames into one sheet. Two scripts because
Blender's bundled Python has no Pillow and the frames have to be composed by
something that does.

The sheet is a GRID, not a strip. A 48-frame strip at 128px is 6144px wide,
which is past the safe texture width on some mobile GPUs and is a silly shape
for a browser to decode; 8x6 is 1024x768. The client pays for that with two
stepped animations instead of one — `background-position-x` stepped 8 times per
turn, `background-position-y` stepped 6 times per 8 turns of x — which is the
standard way to walk a grid and costs nothing at runtime.
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BLENDER = pathlib.Path(r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe")
SCENE = ROOT / "tools" / "render_loading_spinner.py"
WORK = ROOT / "assets" / "loading" / "build" / "spinner"
OUT = ROOT / "apps" / "web" / "public" / "textures" / "loading" / "spinner.png"

FRAMES = 48
SIZE = 128
COLS = 8
ROWS = 6
PALETTE = 128


def render() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    for old in WORK.glob("frame_*.png"):
        old.unlink()
    cmd = [
        str(BLENDER),
        "--background", "--factory-startup", "--disable-autoexec", "--offline-mode",
        "--python-exit-code", "1", "--python", str(SCENE),
        "--", "--out", str(WORK), "--frames", str(FRAMES), "--size", str(SIZE),
    ]
    print(" ".join(cmd))
    # Blender is loud; only its own progress lines and any traceback matter, and
    # a non-zero exit is guaranteed on a Python error by --python-exit-code.
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout[-4000:])
        sys.stderr.write(proc.stderr[-4000:])
        raise SystemExit(f"blender failed with {proc.returncode}")


def compose() -> None:
    frames = sorted(WORK.glob("frame_*.png"))
    if len(frames) != FRAMES:
        raise SystemExit(f"expected {FRAMES} frames, found {len(frames)}")
    sheet = Image.new("RGBA", (COLS * SIZE, ROWS * SIZE), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        with Image.open(f) as im:
            if im.size != (SIZE, SIZE):
                raise SystemExit(f"{f.name} is {im.size}, expected {(SIZE, SIZE)}")
            sheet.paste(im.convert("RGBA"), ((i % COLS) * SIZE, (i // COLS) * SIZE))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Palette, not truecolour: this is one metal and one ember against nothing,
    # so 128 entries carry it at a sixth of the bytes (643 kB -> ~100 kB). The
    # banding that costs shows only in the soft falloff at several times the
    # size the ring is ever drawn at. FASTOCTREE because it is the quantizer
    # that keeps the alpha channel; the default one drops it and the ring ships
    # on a black square.
    sheet.quantize(colors=PALETTE, method=Image.FASTOCTREE).save(OUT, "PNG", optimize=True)
    print(f"{FRAMES} frames -> {OUT.name} {sheet.size} {OUT.stat().st_size // 1024}kB")


def main() -> int:
    if not BLENDER.is_file():
        raise SystemExit(f"no blender at {BLENDER}")
    if shutil.which("python") is None:
        raise SystemExit("no python on PATH")
    render()
    compose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
