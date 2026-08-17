"""Build `wardrobe.glb` from the Quaternius Universal Base Characters pack.

Two base bodies, no outfits. Each body keeps its OWN armature: the male and
female skeletons share every bone name but not their rest poses (the female's
head sits 30 mm lower and her hands 111 mm closer in), so one shared skeleton
would squash whichever body did not author it. The clips in `anim-library.glb`
are rotations over those shared names, which is what makes one library drive
both.

Parts are `base.<look>.<part>`, the same `slot.look.part` convention the runtime
already resolves: it shows one look per slot and hides the rest.

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --factory-startup --python-exit-code 1 \
        --python tools/build_wardrobe.py
"""

import os
import sys

import bpy

SRC = "D:/VSC/exiled-casual/assets/characters/"
OUT = "D:/VSC/exiled-casual/apps/web/public/models/wardrobe.glb"

# The armature the runtime drives. Only the male is wired today; the female
# ships beside him so she is one look away rather than one build away.
MALE_RIG = "Armature"
FEMALE_RIG = "Armature_female"

# A body's glTF carries its body, eyes and brows in one file; hair is separate.
# Mesh names in the pack are unreliable ('Face', 'Face.001',
# 'Sphere.005_Retopology.004'), so parts are identified by material instead.
LOOKS = (
    {
        "look": "male",
        "rig": MALE_RIG,
        "body": "Base_Male.gltf",
        "hair": "Hair_SimpleParted.gltf",
        "parts": {"MI_Superhero_Male": "body", "MI_Eyes": "eyes", "MI_Hair_1": "brows"},
    },
    {
        "look": "female",
        "rig": FEMALE_RIG,
        "body": "Superhero_Female_FullBody.gltf",
        "hair": "Hair_Buns.gltf",
        "parts": {"MI_Superhero_Female": "body", "MI_Eyes": "eyes", "MI_Hair_2": "brows"},
    },
)

# The pack's hair atlases are greyscale masks (mean luma ~0.56) meant to be
# tinted by the material, so untinted hair renders bone white. Linear, and
# multiplied by that mask, so the rendered hair lands well below this value.
HAIR_TINT = (0.34, 0.19, 0.10, 1.0)

# Every joint the pack ships, weighted or not.
EXPECTED_JOINTS = 65

# The pack names its twelve terminal tips `*_leaf_*`; the clips in
# `anim-library.glb` drive them as `*_end_*`. They carry no skin weight, so a
# mismatch only loses the tracks silently - renaming them binds all 65.
LEAF_RENAME = {f"ball_leaf_{s}": f"foot_end_{s}" for s in "lr"} | {
    f"{finger}_04_leaf_{s}": f"{finger}_04_end_{s}"
    for finger in ("index", "middle", "pinky", "ring", "thumb")
    for s in "lr"
}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_gltf(name):
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        raise SystemExit(f"missing source: {path}")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def split(objects):
    """Armature plus the meshes worth keeping. Every file in the pack ships a
    42-vertex materialless Icosphere helper that is not part of the character."""
    armatures = [o for o in objects if o.type == "ARMATURE"]
    meshes, helpers = [], []
    for o in objects:
        if o.type != "MESH":
            continue
        (meshes if o.data.materials and o.data.materials[0] else helpers).append(o)
    if len(armatures) != 1:
        raise SystemExit(f"expected one armature, got {[a.name for a in armatures]}")
    for helper in helpers:
        drop(helper)
    return armatures[0], meshes


def material_of(mesh):
    if not mesh.data.materials or mesh.data.materials[0] is None:
        raise SystemExit(f"{mesh.name} has no material to identify it by")
    # Blender suffixes duplicates ('MI_Eyes.001'); the stem is the identity.
    return mesh.data.materials[0].name.split(".")[0]


def rebind(mesh, armature):
    """Point a mesh at another armature. Vertex groups carry the binding, so
    this is an assignment - it only holds because both rest poses agree."""
    mesh.parent = armature
    mesh.matrix_parent_inverse = armature.matrix_world.inverted()
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            mesh.modifiers.remove(mod)
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = armature


def drop(obj):
    bpy.data.objects.remove(obj, do_unlink=True)


def uses_hair_atlas(mesh):
    """True when a part samples a greyscale `T_Hair_*` mask rather than the
    body atlas. The female's brows do; the male's are painted into his skin."""
    mat = mesh.data.materials[0]
    if not mat.use_nodes:
        return False
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image:
            if os.path.basename(node.image.filepath or node.image.name).startswith("T_Hair_"):
                return True
    return False


def tint(mesh, colour):
    """Multiply a mesh's base colour texture by a constant. The glTF exporter
    reads a Mix/MULTIPLY between the image and Base Color as baseColorFactor."""
    mat = mesh.data.materials[0]
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    base = bsdf.inputs["Base Color"]
    if not base.links:
        base.default_value = colour
        return
    image = base.links[0].from_socket
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    tree.links.new(mix.inputs[6], image)
    mix.inputs[7].default_value = colour
    tree.links.new(base, mix.outputs[2])


def build_look(spec):
    body_objs = import_gltf(spec["body"])
    rig, body_meshes = split(body_objs)
    rig.name = spec["rig"]
    rig.data.name = spec["rig"]

    joints = len(rig.data.bones)
    if joints != EXPECTED_JOINTS:
        raise SystemExit(f"{spec['look']}: expected {EXPECTED_JOINTS} joints, got {joints}")

    renamed = 0
    for bone in rig.data.bones:
        target = LEAF_RENAME.get(bone.name)
        if target:
            bone.name = target
            renamed += 1
    if renamed != len(LEAF_RENAME):
        raise SystemExit(
            f"{spec['look']}: renamed {renamed} tip bones, expected {len(LEAF_RENAME)}"
        )

    named = []
    for mesh in body_meshes:
        mat = material_of(mesh)
        part = spec["parts"].get(mat)
        if part is None:
            raise SystemExit(f"{spec['look']}: unmapped material {mat} on {mesh.name}")
        mesh.name = f"base.{spec['look']}.{part}"
        mesh.data.name = mesh.name
        if uses_hair_atlas(mesh):
            tint(mesh, HAIR_TINT)
        named.append(part)

    hair_objs = import_gltf(spec["hair"])
    hair_rig, hair_meshes = split(hair_objs)
    if len(hair_meshes) != 1:
        raise SystemExit(f"{spec['look']}: expected one hair mesh, got {len(hair_meshes)}")
    hair = hair_meshes[0]
    hair.name = f"base.{spec['look']}.hair"
    hair.data.name = hair.name
    tint(hair, HAIR_TINT)
    rebind(hair, rig)
    named.append("hair")
    # The hair's own skeleton is a duplicate of the body's; keep one.
    drop(hair_rig)

    print(f"built base.{spec['look']}: {joints} joints, parts {sorted(named)}")
    return sorted(named)


def main():
    clear_scene()
    for spec in LOOKS:
        parts = build_look(spec)
        missing = {"body", "eyes", "brows", "hair"} - set(parts)
        if missing:
            raise SystemExit(f"{spec['look']}: missing parts {sorted(missing)}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_animations=False,
        export_skins=True,
        export_yup=True,
        export_apply=False,
    )
    size = os.path.getsize(OUT)
    meshes = sorted(o.name for o in bpy.data.objects if o.type == "MESH")
    rigs = sorted(o.name for o in bpy.data.objects if o.type == "ARMATURE")
    print(f"wrote {OUT} ({size // 1024} KB)")
    print(f"  armatures: {rigs}")
    print(f"  meshes:    {meshes}")


main()
