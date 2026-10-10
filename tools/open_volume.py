"""Volumetric opening of a generated mesh: delete every part thinner than a radius.

Run with the system Python (numpy, scipy, scikit-image):
  python tools/open_volume.py in.npz out.npz --res 160 --radius 3 [--sigma 1.0]

TRELLIS surfaces are shell soup with flaps, bristles and spike plates as open sheets.
No surface smoothing removes a sheet, so the mesh is voxelised instead: triangle samples
mark a surface band, a flood fill from the grid boundary finds the outside, and
everything else is solid. A binary opening with a ball of `radius` voxels erases what is
thinner than about two radii, the largest component is kept, and marching cubes on the
blurred solid gives a closed surface. Coordinates stay in the input's frame.
in.npz holds float `verts` (N,3) and int `faces` (M,3); out.npz the same.
"""
import argparse
import math

import numpy as np
from scipy import ndimage
from skimage import measure


def mark_surface(grid, verts, faces, origin, voxel):
    """Set every voxel a triangle passes through, sampling at half-voxel spacing."""
    tri = verts[faces].astype(np.float32)
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    count = np.maximum(1, np.ceil(area / (voxel * voxel) * 16).astype(np.int64))
    rng = np.random.default_rng(0)
    for start in range(0, len(faces), 20000):
        sl = slice(start, start + 20000)
        idx = np.repeat(np.arange(len(tri[sl])), count[sl])
        u, v = rng.random((2, len(idx)), dtype=np.float32)
        flip = u + v > 1
        u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
        t = tri[sl][idx]
        p = t[:, 0] + u[:, None] * (t[:, 1] - t[:, 0]) + v[:, None] * (t[:, 2] - t[:, 0])
        ijk = np.floor((p - origin) / voxel).astype(np.int64)
        grid[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--res", type=int, default=160, help="voxels along the longest axis")
    ap.add_argument("--radius", type=int, default=3, help="opening ball radius in voxels")
    ap.add_argument("--band", type=int, help="hole-closing dilation in voxels (default ~2%% of size)")
    ap.add_argument("--sigma", type=float, default=1.0, help="blur before marching cubes")
    a = ap.parse_args()

    d = np.load(a.inp)
    verts, faces = d["verts"].astype(np.float64), d["faces"].astype(np.int64)
    lo, hi = verts.min(0), verts.max(0)
    voxel = (hi - lo).max() / a.res
    if a.band is None:
        # the soup's holes are a fixed share of the size: 3 voxels at res 160 closes them
        a.band = max(1, math.ceil(3 * a.res / 160))
    pad = a.radius + a.band + 3
    origin = lo - pad * voxel
    shape = np.ceil((hi - lo) / voxel).astype(int) + 2 * pad + 1

    surf = np.zeros(shape, bool)
    mark_surface(surf, verts, faces, origin.astype(np.float32), np.float32(voxel))
    if a.band:
        surf = ndimage.binary_dilation(surf, iterations=a.band)

    lab, _ = ndimage.label(~surf)
    outside = lab == lab[0, 0, 0]
    solid = ~outside
    if a.band:
        # the band closed the soup's holes by growing the surface; give that growth back
        solid = ndimage.binary_erosion(solid, iterations=a.band)
    before = int(solid.sum())

    ball = np.linalg.norm(np.mgrid[-a.radius:a.radius + 1, -a.radius:a.radius + 1,
                                   -a.radius:a.radius + 1], axis=0) <= a.radius + 0.01
    opened = ndimage.binary_opening(solid, structure=ball)
    lab, n = ndimage.label(opened)
    if n > 1:
        sizes = ndimage.sum(opened, lab, range(1, n + 1))
        opened = lab == 1 + int(np.argmax(sizes))
    after = int(opened.sum())

    field = ndimage.gaussian_filter(opened.astype(np.float32), a.sigma) if a.sigma else opened.astype(np.float32)
    if field.max() < 0.5:
        raise SystemExit(f"opening radius {a.radius} erased the whole body")
    v, f, _, _ = measure.marching_cubes(field, 0.5)
    v = origin + v * voxel
    np.savez(a.out, verts=v.astype(np.float32), faces=f.astype(np.int32))
    print(f"grid {tuple(shape)} voxel {voxel:.5f} solid {before} -> opened {after} "
          f"({100 * (before - after) / max(before, 1):.1f}% removed), {len(v)} verts {len(f)} faces")


if __name__ == "__main__":
    main()
