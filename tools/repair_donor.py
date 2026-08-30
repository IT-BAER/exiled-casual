"""Close the pinholes a TRELLIS decode leaves in a donor shell.

A decode comes back unwelded - duplicate vertices on one position, no shared
edge - so the shell reads as thousands of one-triangle islands until it is
merged by distance. Welded, it is a surface with tiny boundary loops - five or
six edges each, invisible in a thumbnail and a puncture you can see the void
through at play distance. The openings the piece is SUPPOSED to have (a neck, an
arm hole, a waist) are boundary loops too, and they are the large ones, so the
fill is gated on loop size rather than run over every boundary.

Islands are the other half: a decode hands back the odd unattached flake, which
reads as a lame hanging off an elbow. An island under a share of the largest
one's vertex count is dropped.

Run:
  blender --background --factory-startup --python tools/repair_donor.py -- \
      --in <donor.glb> --out <repaired.glb> [--max-loop 32] [--island-share 0.02]
      [--weld 0.0001]
"""

import sys

import bpy
import bmesh


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"in": None, "out": None, "max-loop": 12, "island-share": 0.02, "weld": 0.0001}
    for i in range(0, len(tail) - 1, 2):
        key = tail[i].lstrip("-")
        if key not in out:
            raise SystemExit(f"unknown argument --{key}")
        out[key] = type(out[key])(tail[i + 1]) if isinstance(out[key], (int, float)) else tail[i + 1]
    if not out["in"] or not out["out"]:
        raise SystemExit("--in and --out are required")
    return out


def loops_of(bm):
    """Every boundary loop, as a list of its edges."""
    seen, loops = set(), []
    for edge in bm.edges:
        if len(edge.link_faces) != 1 or edge in seen:
            continue
        stack, group = [edge], []
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            group.append(cur)
            for vert in cur.verts:
                for other in vert.link_edges:
                    if other not in seen and len(other.link_faces) == 1:
                        stack.append(other)
        loops.append(group)
    return loops


def islands(bm):
    """Connected vertex sets, largest first."""
    seen, groups = set(), []
    for vert in bm.verts:
        if vert in seen:
            continue
        stack, group = [vert], []
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            group.append(cur)
            for edge in cur.link_edges:
                stack.append(edge.other_vert(cur))
        groups.append(group)
    groups.sort(key=len, reverse=True)
    return groups


def main():
    opts = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=opts["in"])
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"{opts['in']}: no mesh")

    for obj in meshes:
        bm = bmesh.new()
        bm.from_mesh(obj.data)

        before_tris = sum(len(f.verts) - 2 for f in bm.faces)
        before_verts = len(bm.verts)
        before_loops = loops_of(bm)

        # A decode exports its shell unwelded: thousands of vertices sit on the
        # same position without sharing an edge, so every triangle is its own
        # island and a hole fill has nothing to walk. Merging by distance first
        # is what turns the soup back into a surface. Per-corner UVs live on the
        # loops and survive the merge.
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=opts["weld"])

        groups = islands(bm)
        floor = len(groups[0]) * opts["island-share"]
        dead = [v for g in groups[1:] if len(g) < floor for v in g]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context="VERTS")
        dropped = sum(1 for g in groups[1:] if len(g) < floor)

        small = [e for loop in loops_of(bm) if len(loop) <= opts["max-loop"] for e in loop]
        kept = [loop for loop in loops_of(bm) if len(loop) > opts["max-loop"]]
        if small:
            new = bmesh.ops.holes_fill(bm, edges=small, sides=opts["max-loop"])
            # Only the caps get their winding decided, and each against the ring
            # it closes. A recalc over the whole shell instead re-orients every
            # face from one seed and flips half a decoded surface black.
            capped = [f for f in new.get("faces", []) if f.is_valid]
            if capped:
                bmesh.ops.recalc_face_normals(bm, faces=capped)

        after_tris = sum(len(f.verts) - 2 for f in bm.faces)
        after_loops = len(loops_of(bm))
        after_verts = len(bm.verts)
        bm.to_mesh(obj.data)
        obj.data.update()
        bm.free()

        print(f"{obj.name}: verts {before_verts} -> {after_verts}, "
              f"tris {before_tris} -> {after_tris} (+{after_tris - before_tris})")
        print(f"  boundary loops {len(before_loops)} -> {after_loops}, "
              f"kept {len(kept)} openings over {opts['max-loop']} edges")
        print(f"  islands dropped {dropped} under {floor:.0f} verts")

    bpy.ops.export_scene.gltf(filepath=opts["out"], export_format="GLB",
                              use_selection=False, export_yup=True)
    print(f"wrote {opts['out']}")


main()
