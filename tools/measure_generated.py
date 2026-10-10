"""Measure a generated creature mesh for a `GeneratedSkin` declaration.

  blender --background --factory-startup --python-exit-code 1 \
      --python tools/measure_generated.py -- --input mesh.glb --height 0.6 --legs 6 \
      [--flip 0|1] [--foot-z 0.12] [--json out.json]

Loads the mesh exactly as `GeneratedSkin.emit` does (rig_humanoid.load_mesh), then:
  feet   - local low points below `foot-z` x height, each with its sole around it;
  origin - the feet centroid, printed as the declaration's `offset`;
  legs   - walked up from each foot over the SURFACE: rings of equal geodesic distance
           are leg cross-sections, their centres the leg's axis. The hip is where the
           ring widens into the body for good; the knee is the axis point
           furthest off the foot-hip chord. Works for splayed and upright legs alike.
Prints a Python stub in the post-offset frame, legs front pair first, left first.
"""
import heapq
import importlib.util
import json
import os
import sys

import bpy
import numpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def args():
    tail = sys.argv[sys.argv.index("--") + 1:]
    out = {"flip": "0", "foot-z": "0.12", "json": ""}
    for i in range(0, len(tail) - 1, 2):
        out[tail[i].lstrip("-")] = tail[i + 1]
    return out


def adjacency(mesh, co):
    e = numpy.empty(len(mesh.data.edges) * 2, dtype=numpy.int64)
    mesh.data.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    w = numpy.linalg.norm(co[e[:, 0]] - co[e[:, 1]], axis=1)
    adj = [[] for _ in range(len(co))]
    for (a, b), d in zip(e.tolist(), w.tolist()):
        adj[a].append((b, d))
        adj[b].append((a, d))
    # The exporter splits vertices along every UV seam; the surface does not end there.
    _, weld = numpy.unique(numpy.round(co / 1e-5).astype(numpy.int64), axis=0, return_inverse=True)
    order = numpy.argsort(weld.ravel(), kind="stable")
    ids = weld.ravel()[order]
    for i in range(1, len(order)):
        if ids[i] == ids[i - 1]:
            a, b = int(order[i - 1]), int(order[i])
            adj[a].append((b, 0.0))
            adj[b].append((a, 0.0))
    return adj, e


def geodesic(sources, adj, n):
    dist = numpy.full(n, numpy.inf)
    heap = []
    for s in sources:
        dist[s] = 0.0
        heap.append((0.0, s))
    heapq.heapify(heap)
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v]:
            continue
        for u, w in adj[v]:
            nd = d + w
            if nd < dist[u]:
                dist[u] = nd
                heapq.heappush(heap, (nd, u))
    return dist


def trace_leg(foot_patch, co, adj, edges, H):
    """Axis points from the foot up to where the cross-section widens into the body.

    A cross-section is where one geodesic level crosses the edges, interpolated
    along each edge: a decimated shin has edges longer than any band of vertices."""
    dist = geodesic(foot_patch, adj, len(co))
    du, dv = dist[edges[:, 0]], dist[edges[:, 1]]
    ok = numpy.isfinite(du) & numpy.isfinite(dv) & (du != dv)
    edges, du, dv = edges[ok], du[ok], dv[ok]
    step = 0.03 * H
    axis, radii = [], []
    level = step
    while level < 2.0 * H:
        cross = (numpy.minimum(du, dv) < level) & (numpy.maximum(du, dv) >= level)
        if cross.sum() < 3:
            break
        t = ((level - du[cross]) / (dv[cross] - du[cross]))[:, None]
        ring = co[edges[cross, 0]] + t * (co[edges[cross, 1]] - co[edges[cross, 0]])
        c = ring.mean(axis=0)
        axis.append(c)
        radii.append(float(numpy.median(numpy.linalg.norm(ring - c, axis=1))))
        level += step
    if os.environ.get("MEASURE_DEBUG"):
        print("  radii", [round(r, 3) for r in radii], "z", [round(float(p[2]), 2) for p in axis])
    # The body is where the section widens FOR GOOD: knee knobs and a claw rim widen
    # it for a few levels and narrow again, the trunk never does.
    leg_r = float(numpy.median(radii[2:max(5, len(radii) // 4)]))
    wide = max(2.0 * leg_r, 0.12 * H)
    narrow = [i for i, r in enumerate(radii) if r <= wide]
    if narrow:
        k = narrow[-1] + 1
        return numpy.array(axis[:k]), radii[:k]
    return numpy.array(axis), radii


def main():
    a = args()
    H, legs = float(a["height"]), int(a["legs"])
    spec = importlib.util.spec_from_file_location("rig", os.path.join(ROOT, "tools", "rig_humanoid.py"))
    rig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rig)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    mesh = rig.load_mesh(a["input"], H, a["flip"] == "1")
    co = rig.verts(mesh)
    adj, edges = adjacency(mesh, co)

    # A foot is a LOCAL low point: the rear feet of a splayed body can stand a few
    # centimetres higher than the front ones, so one global threshold misses them.
    idx = numpy.nonzero(co[:, 2] < float(a["foot-z"]) * H)[0]
    low = co[idx]
    near = numpy.linalg.norm(low[:, None, :2] - low[None, :, :2], axis=2) < 0.08 * H
    minima = [i for i in range(len(idx)) if low[i, 2] <= low[near[i], 2].min()]
    merged = []
    for i in sorted(minima, key=lambda i: low[i, 2]):
        if any(numpy.linalg.norm(low[i, :2] - co[m[0], :2]) < 0.08 * H for m in merged):
            continue
        sole = (numpy.linalg.norm(low[:, :2] - low[i, :2], axis=1) < 0.05 * H) & (low[:, 2] < low[i, 2] + 0.02 * H)
        merged.append([int(idx[i])] + [int(j) for j in idx[sole] if j != idx[i]])
    if len(merged) != legs:
        for m in merged:
            print("  foot at %s" % co[m[0]].round(3))
        sys.exit("found %d feet, expected %d: adjust --foot-z" % (len(merged), legs))

    feet = [numpy.array([*co[m, :2].mean(axis=0), co[m, 2].min()]) for m in merged]
    centre = numpy.mean([f[:2] for f in feet], axis=0)
    shift = numpy.array([-centre[0], -centre[1], 0.0])

    out = []
    for m, foot in zip(merged, feet):
        axis, radii = trace_leg(m, co, adj, edges, H)
        if len(axis) < 2:
            sys.exit("leg at %s did not trace: the foot patch is not a limb end" % foot.round(3))
        hip = axis[-1]
        chord = hip - foot
        L = float(numpy.linalg.norm(chord))
        t = numpy.clip((axis - foot) @ chord / max(L * L, 1e-12), 0.0, 1.0)
        off = numpy.linalg.norm(axis - (foot + t[:, None] * chord), axis=1)
        knee = axis[int(off.argmax())] if off.max() > 0.04 * L else foot + 0.5 * chord
        out.append({"hip": hip + shift, "knee": knee + shift, "foot": foot + shift,
                    "bend": float(off.max() / L), "radius": float(numpy.median(radii))})
    # Front pair first, left (-x, facing +Y) first inside a pair.
    out.sort(key=lambda l: -l["foot"][1])
    pairs = [sorted(out[i:i + 2], key=lambda l: l["foot"][0]) for i in range(0, len(out), 2)]
    out = [l for p in pairs for l in p]

    hips_z = float(numpy.mean([l["hip"][2] for l in out]))
    core = co[(numpy.abs(co[:, 0] - centre[0]) < 0.1 * H) & (co[:, 2] > 0.8 * hips_z)] + shift
    y0, y1 = float(core[:, 1].min()), float(core[:, 1].max())
    zc = float(numpy.median(core[:, 2]))

    print("bounds", (co + shift).min(0).round(3), (co + shift).max(0).round(3), "verts", len(co))
    print("offset = (%.3f, %.3f)" % (shift[0], shift[1]))
    print("spine y %.3f..%.3f at z %.3f" % (y0, y1, zc))
    f3 = lambda p: "(%.3f, %.3f, %.3f)" % tuple(p)
    for l in out:
        print("    (%s, %s, %s),  # bend %.2f leg r %.3f" % (
            f3(l["hip"]), f3(l["knee"]), f3(l["foot"]), l["bend"], l["radius"]))
    if a["json"]:
        with open(a["json"], "w") as fh:
            json.dump({"offset": shift[:2].tolist(), "spine": [y0, y1, zc],
                       "legs": [{k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in l.items()}
                                for l in out]}, fh, indent=1)


main()
