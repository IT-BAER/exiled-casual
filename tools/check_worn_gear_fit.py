"""Static half of the worn-gear gate (`.claude/skills/generate-local-3d-asset/scripts/fit_worn_gear.ps1`).

Run with Blender 5.2 against a wardrobe master (`assets/characters/wardrobe*.glb`,
never the meshopt-packed copy the client serves):

    blender --background --factory-startup --python-exit-code 1 \
        --python tools/check_worn_gear_fit.py -- --wardrobe <glb> \
        --helmet helmet.maren.tresses --body chest.maren.gown --report <json>

Fails closed when either piece is missing, unskinned, carries a vertex with no
weight, more than four influences or weights that do not sum to one, names a
group that is not a live bone, has no entry in the build's fit report, or when
the helmet piece sits inside the bare head it is worn on. The animated half is
`validate_wearable.py`.
"""

import argparse
import json
import os
import sys

import bpy
from mathutils.bvhtree import BVHTree

MAX_INFLUENCES = 4
WEIGHT_SUM_TOLERANCE = 1e-3
# A strand this far inside the scalp is the head showing through the hair.
HEAD_INSIDE_TOLERANCE = 0.0005
# Share of the bare head's height, from its lowest point, below which nothing is judged.
HEAD_SKULL_FROM = 0.25


def parse_args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--wardrobe", required=True)
    p.add_argument("--helmet", required=True)
    p.add_argument("--body", required=True, help="the worn body piece (a chest look's shell)")
    p.add_argument("--report", required=True)
    return p.parse_args(tail)


def skin_report(obj, bones):
    """Weights per vertex: present, at most four, normalised, on live bones."""
    names = {g.index: g.name for g in obj.vertex_groups}
    dead = sorted({n for n in names.values() if n not in bones})
    unweighted = over = unnormalised = 0
    for v in obj.data.vertices:
        ws = [g.weight for g in v.groups if g.weight > 0.0]
        if not ws:
            unweighted += 1
            continue
        if len(ws) > MAX_INFLUENCES:
            over += 1
        if abs(sum(ws) - 1.0) > WEIGHT_SUM_TOLERANCE:
            unnormalised += 1
    armature = any(m.type == "ARMATURE" and m.object is not None for m in obj.modifiers) or (
        obj.parent is not None and obj.parent.type == "ARMATURE")
    return {
        "vertices": len(obj.data.vertices), "armature": armature, "dead_groups": dead,
        "unweighted_vertices": unweighted, "over_influence_vertices": over,
        "unnormalised_vertices": unnormalised,
    }


def world_bvh(obj):
    mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    verts = [obj.matrix_world @ v.co for v in mesh.vertices]
    polys = [tuple(p.vertices) for p in mesh.polygons]
    return BVHTree.FromPolygons(verts, polys)


def main():
    a = parse_args()
    failures = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.wardrobe)
    objs = {o.name: o for o in bpy.data.objects}
    rigs = [o for o in objs.values() if o.type == "ARMATURE"]
    bones = {b.name for r in rigs for b in r.data.bones}
    stem = os.path.splitext(os.path.basename(a.wardrobe))[0].replace("wardrobe", "gear-fit")
    fit_path = os.path.join(os.path.dirname(a.wardrobe), f"{stem}.json")
    fit = json.load(open(fit_path)) if os.path.exists(fit_path) else {}
    if not fit:
        failures.append(f"no fit report at {fit_path}")

    report = {"wardrobe": a.wardrobe, "fit_report": fit_path, "pieces": {}}
    for name in (a.helmet, a.body):
        obj = objs.get(name)
        if obj is None or obj.type != "MESH":
            failures.append(f"{name}: not in the wardrobe")
            continue
        r = skin_report(obj, bones)
        r["fit_metadata"] = name in fit
        report["pieces"][name] = r
        if not r["armature"]:
            failures.append(f"{name}: not skinned to an armature")
        if r["dead_groups"]:
            failures.append(f"{name}: groups on no live bone {r['dead_groups']}")
        for key in ("unweighted_vertices", "over_influence_vertices", "unnormalised_vertices"):
            if r[key]:
                failures.append(f"{name}: {r[key]} {key.replace('_', ' ')}")
        if not r["fit_metadata"]:
            failures.append(f"{name}: no entry in {os.path.basename(fit_path)}")

    # The bare head the helmet piece is worn on: its look's own head where it
    # brings one (the body's is hidden under that), else the body's remainder mesh.
    helmet = objs.get(a.helmet)
    look = next((n.split(".")[1] for n in objs if n.startswith("base.") and n.endswith(".body")), None)
    head = objs.get(".".join(a.helmet.split(".")[:2] + ["face"])) or (objs.get(f"base.{look}.body") if look else None)
    if helmet is not None and head is not None:
        bvh = world_bvh(head)
        zs = [(head.matrix_world @ v.co).z for v in head.data.vertices]
        # The skull only: the head mesh ends in a cut at the neck whose edge
        # normals run sideways, and a lock hanging past it is not inside anything.
        skull_from = min(zs) + (max(zs) - min(zs)) * HEAD_SKULL_FROM
        inside = deepest = 0
        for v in helmet.data.vertices:
            co = helmet.matrix_world @ v.co
            if co.z < skull_from:
                continue
            hit, normal, _, _ = bvh.find_nearest(co)
            if hit is None:
                continue
            depth = (co - hit).dot(normal)
            if depth < -HEAD_INSIDE_TOLERANCE:
                inside += 1
                deepest = min(deepest, depth)
        report["head_crossing"] = {"head": head.name, "vertices_inside": inside,
                                   "deepest_mm": round(deepest * 1000, 2)}
        if inside:
            failures.append(f"{a.helmet}: {inside} vertices inside {head.name}, deepest {deepest * 1000:.2f} mm")
    else:
        failures.append("no helmet piece or bare head to measure against")

    report["failures"] = failures
    report["passed"] = not failures
    os.makedirs(os.path.dirname(os.path.abspath(a.report)), exist_ok=True)
    with open(a.report, "w") as fh:
        json.dump(report, fh, indent=1)
    print(json.dumps(report, indent=1))
    if failures:
        sys.exit(1)


main()
