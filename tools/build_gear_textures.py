"""Bake one armour texture per item base, matched to that base's inventory icon.

Run:
  python tools/build_gear_textures.py

Why this exists
---------------
The character wears one authored outfit, the Quaternius ranger, and it is green
linen and brown leather. The item art is charred iron with ember in the seams.
Equipping an Emberweave Robe and watching the character stay green makes the
inventory and the world look like two different games.

Geometry per base is out of reach - the packs are whole authored outfits, and one
generated shape can serve a slot (see the coat in `build_wardrobe.py`) but not one
per base. So the *material* is what varies: the ranger's 512 atlas is
re-palettized once per base, offline, and the runtime swaps only `albedoTexture`
on that slot's material.

Doing it as a pixel transform on the authored atlas is what keeps it UV-correct.
The islands never move, so every seam the artist placed still lines up; only the
colours change. A generated texture painted from scratch could not do that - it
would have to guess where the sleeve ends and the hem begins.

The transform is a luminance -> palette map. Each icon's own opaque pixels are
sorted by luminance and sampled at 256 percentiles to build a ramp, then every
atlas texel is looked up in that ramp by its own luminance. So the output wears
the icon's real palette (its blacks, its rust, its ember highlights) in the
atlas's own shading, rather than a hue guessed by eye.
"""
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: python -m pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(ROOT, "assets", "characters", "T_Ranger_BaseColor.png")
ICONS = os.path.join(ROOT, "apps", "web", "public", "textures", "items")
OUT = os.path.join(ROOT, "apps", "web", "public", "textures", "gear")

# Item base -> its icon. One base per armour slot exists today; adding a base
# here is all it takes for the character to wear it, provided `rig.ts` maps the
# same id. `rig.test.ts` pins the two lists together.
BASES = {
    "base.cinder_cap": "cinder_cap.png",
    "base.emberweave_robe": "emberweave_robe.png",
    "base.ember_gauntlets": "ember_gauntlets.png",
    "base.ashen_treads": "ashen_treads.png",
    "base.cinderchain_sash": "cinderchain_sash.png",
}

# The character is roughly 12% of frame height, so the atlas is downscaled on the
# way out: 256 is past the point where more texels are visible, and five full-size
# variants would add about 2 MB to a payload that is already 7.4 MB.
SIZE = 256

# Ramp resolution. 256 entries is one per luminance step, so the lookup is exact
# and needs no interpolation.
RAMP = 256

# How much of the icon's darkest and brightest tail to discard when building the
# ramp. Icon art is cut out on transparency and keeps a rim of near-black
# antialiasing plus a few specular white pixels; letting those define the ends of
# the ramp crushes the whole character to black with white speckles.
CLIP = 0.02

# Gamma on the luminance *lookup*, not on the output colour, so the palette is
# untouched and only which part of it a texel lands in moves. Item icons are lit
# to read on a near-black inventory panel, and mapping them straight onto the
# character put him at the bottom of his own ramp: correct colours, but a
# silhouette against the hideout's grey flagstones. Below 1.0 lifts mid-tones.
GAMMA = 0.62


def luminance(px):
    r, g, b = px[0], px[1], px[2]
    return (r * 299 + g * 587 + b * 114) // 1000


def build_ramp(icon_path):
    """A 256-entry RGB ramp sampled from an icon's opaque pixels by luminance."""
    icon = Image.open(icon_path).convert("RGBA")
    opaque = [p for p in icon.getdata() if p[3] > 128]
    if len(opaque) < RAMP:
        raise SystemExit(f"{icon_path}: only {len(opaque)} opaque pixels, too few to sample")

    opaque.sort(key=luminance)
    lo = int(len(opaque) * CLIP)
    hi = len(opaque) - 1 - lo
    span = hi - lo

    ramp = []
    for i in range(RAMP):
        p = opaque[lo + (i * span) // (RAMP - 1)]
        ramp.append((p[0], p[1], p[2]))
    return ramp


def repalette(atlas, ramp):
    out = Image.new("RGBA", atlas.size)
    src = atlas.load()
    dst = out.load()
    lift = [min(RAMP - 1, int(RAMP * (i / 255.0) ** GAMMA)) for i in range(256)]
    w, h = atlas.size
    for y in range(h):
        for x in range(w):
            p = src[x, y]
            r, g, b = ramp[lift[luminance(p)]]
            # Alpha is carried through untouched: the atlas uses it for the
            # cut-out fringe on straps and hem, and re-deriving it would fray them.
            dst[x, y] = (r, g, b, p[3])
    return out


def main():
    atlas = Image.open(ATLAS).convert("RGBA")
    os.makedirs(OUT, exist_ok=True)

    written = {}
    for base_id, icon_name in BASES.items():
        icon_path = os.path.join(ICONS, icon_name)
        if not os.path.exists(icon_path):
            raise SystemExit(f"missing icon for {base_id}: {icon_path}")

        ramp = build_ramp(icon_path)
        out = repalette(atlas, ramp).resize((SIZE, SIZE), Image.LANCZOS)

        slug = base_id.split(".", 1)[1]
        path = os.path.join(OUT, f"{slug}.png")
        out.save(path, optimize=True)
        written[base_id] = os.path.getsize(path)
        print(f"GEAR {base_id:24s} <- {icon_name:24s} {SIZE}x{SIZE} {written[base_id] // 1024} KB")

    print(f"GEAR wrote {len(written)} textures, {sum(written.values()) // 1024} KB total, to {OUT}")
    print("GEAR base ids: " + json.dumps(sorted(written)))


main()
