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

Size alone cannot pick a shell's intended openings: a bulky decode leaves
boundary loops well past --max-loop that are still pinholes, and holes_fill
run over a whole batch silently drops any loop that is non-planar,
self-touching or vertex-sharing with another loop in the batch - the small
loops in that batch stay open with no error. --keep-largest N instead ranks
every welded boundary loop by edge count and keeps only the top N as openings,
filling every other loop one at a time so one bad loop cannot sink the rest.

Run:
  blender --background --factory-startup --python tools/repair_donor.py -- \
      --in <donor.glb> --out <repaired.glb> [--max-loop 32] [--island-share 0.02]
      [--weld 0.0001] [--keep-largest 0]
"""

import sys

import bpy
import bmesh


def args():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"in": None, "out": None, "max-loop": 12, "island-share": 0.02, "weld": 0.0001,
           "keep-largest": 0}
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


def fill_loop(bm, edges):
    """Close one boundary loop; return (new faces, edges still open).

    holes_fill refuses non-planar or self-touching loops with no error, so a
    triangle_fill fan over the same edges is the fallback rather than a
    second bulk pass that would hide the same failure again.
    """
    result = bmesh.ops.holes_fill(bm, edges=edges, sides=len(edges))
    new = [f for f in result.get("faces", []) if f.is_valid]
    open_edges = [e for e in edges if e.is_valid and len(e.link_faces) == 1]
    if open_edges:
        result = bmesh.ops.triangle_fill(bm, use_beauty=True, edges=open_edges)
        new += [f for f in result.get("faces", []) if f.is_valid]
        open_edges = [e for e in edges if e.is_valid and len(e.link_faces) == 1]
    return new, open_edges


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

        loops = loops_of(bm)
        if opts["keep-largest"] > 0:
            ranked = sorted(loops, key=len, reverse=True)
            kept = ranked[:opts["keep-largest"]]
            to_fill = ranked[opts["keep-largest"]:]
        else:
            kept = [loop for loop in loops if len(loop) > opts["max-loop"]]
            to_fill = [loop for loop in loops if len(loop) <= opts["max-loop"]]

        filled, failed = 0, []
        for loop in to_fill:
            new, open_edges = fill_loop(bm, loop)
            # Only the caps get their winding decided, and each against the ring
            # it closes. A recalc over the whole shell instead re-orients every
            # face from one seed and flips half a decoded surface black.
            if new:
                bmesh.ops.recalc_face_normals(bm, faces=new)
            if open_edges:
                failed.append(len(loop))
            else:
                filled += 1

        after_tris = sum(len(f.verts) - 2 for f in bm.faces)
        after_loops = len(loops_of(bm))
        after_verts = len(bm.verts)
        bm.to_mesh(obj.data)
        obj.data.update()
        bm.free()

        print(f"{obj.name}: verts {before_verts} -> {after_verts}, "
              f"tris {before_tris} -> {after_tris} (+{after_tris - before_tris})")
        print(f"  boundary loops {len(before_loops)} -> {after_loops}, "
              f"filled {filled}, kept {[len(loop) for loop in kept]} openings, "
              f"failed {failed}")
        print(f"  islands dropped {dropped} under {floor:.0f} verts")

    bpy.ops.export_scene.gltf(filepath=opts["out"], export_format="GLB",
                              use_selection=False, export_yup=True)
    print(f"wrote {opts['out']}")


main()
