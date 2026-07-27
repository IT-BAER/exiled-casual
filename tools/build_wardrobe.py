"""Build `wardrobe.glb`: one skeleton carrying every equipment slot's geometry.

Run headless:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python tools/build_wardrobe.py

Why this exists
---------------
The two source packs are whole authored outfits, not a modular character. Each
one welds its sleeves to its bare forearms in a single `_Arms` mesh, and neither
pack contains a head at all - the ranger only looks finished because his hood is
his head. So a wardrobe cannot be assembled by loading packs side by side; the
parts have to be cut apart once, offline, and re-emitted against a single rig.

They can share that rig for free: both packs list the same 65 joints in the same
order with bit-identical inverse bind matrices (see `rig.test.ts`), so a ranger
mesh re-parented to the peasant's armature deforms exactly as it did in its own
file. That is what makes this a repack rather than a re-rig.

Output naming is `slot.look.part`, which is the contract the runtime toggles on:
show every mesh whose name starts with `<slot>.<look>.` and hide the rest of that
slot. Each look is a complete set for its slot, so nothing needs a hide mask
except the head, which any helmet replaces.
"""
import sys
import bpy
from mathutils import Vector

# Build inputs live outside `public/`: they are cut up offline and never fetched
# by the browser, so shipping them would double the character payload.
SRC = "D:/VSC/exiled-casual/assets/characters/"
MODELS = "D:/VSC/exiled-casual/apps/web/public/models/"
OUT = MODELS + "wardrobe.glb"

SKIN_MAT = "MI_Regular_Male"

# A flat, perfectly uniform skin texel in T_Regular_Male_Dark_BaseColor.png
# (found by scanning for the lowest-variance skin-toned window). Pinning the
# generated head's UVs here gives it the hands' exact tone under the hands' own
# material, instead of inventing a second skin shader that would drift from them.
# Blender's V runs bottom-up where the image runs top-down, hence 1 - v.
HEAD_UV = (0.7891, 1.0 - 0.4492)

# Same trick for the hair cap, pinned instead to the flattest near-black texel in
# the same atlas (rgb 46,46,46). Sharing the skin material is the whole point -
# one material, one draw setup - so the hair has to get its colour from a
# different pixel rather than a different shader, or it renders skin-coloured and
# the character reads as bald.
HAIR_UV = (0.7656, 0.4727)

# Source mesh -> output name. Anything not listed is dropped.
RENAME = {
    "Male_Peasant_Body":       "body.commoner.torso",
    "Male_Peasant_Legs":       "body.commoner.legs",
    "Male_Peasant_Arms#cloth": "body.commoner.sleeves",
    "Male_Peasant_Arms#skin":  "body.commoner.hands",
    "Male_Peasant_Feet":       "boots.commoner.shoes",

    "Male_Ranger_Body":        "body.ranger.torso",
    "Male_Ranger_Legs":        "body.ranger.legs",
    "Male_Ranger_Arms#cloth":  "body.ranger.sleeves",
    "Male_Ranger_Arms#skin":   "body.ranger.hands",
    "Male_Ranger_Feet_Boots":  "boots.ranger.boots",
    "Male_Ranger_Head_Hood":   "helmet.hood.hood",
    "Male_Ranger_Arms_Bracer": "gloves.bracers.bracers",
    "Male_Ranger_Acc_Pauldron": "body.ranger.pauldron",
    "Male_Ranger_Body_Belt_1": "belt.ranger.strap_upper",
    "Male_Ranger_Body_Belt_2": "belt.ranger.strap_lower",
}


def log(msg):
    print(f"WARDROBE {msg}")


def only(pred):
    return next(o for o in bpy.context.scene.objects if pred(o))


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name != "Icosphere"]


def split_arms(name):
    """Cut an `_Arms` mesh into its cloth half and its bare-skin half.

    Returns the two objects tagged `#cloth` / `#skin`. Which half keeps the
    original object is not defined by the operator, so both are identified by
    the material they ended up with rather than by name.
    """
    obj = bpy.data.objects[name]
    before = set(bpy.context.scene.objects)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.mesh.separate(type="MATERIAL")
    parts = [obj] + [o for o in bpy.context.scene.objects if o not in before]
    out = {}
    for p in parts:
        tag = "skin" if SKIN_MAT in p.data.materials[0].name else "cloth"
        out[tag] = p
        p.name = f"{name}#{tag}"
    if "skin" not in out or "cloth" not in out:
        raise SystemExit(f"{name}: expected a skin half and a cloth half, got {list(out)}")
    log(f"split {name} -> skin {len(out['skin'].data.vertices)}v, cloth {len(out['cloth'].data.vertices)}v")
    return out


def rebind(obj, armature):
    """Drive `obj` with `armature` instead of the one it was imported with."""
    obj.parent = armature
    obj.matrix_parent_inverse = armature.matrix_world.inverted()
    for m in obj.modifiers:
        if m.type == "ARMATURE":
            m.object = armature
            break
    else:
        m = obj.modifiers.new("Armature", "ARMATURE")
        m.object = armature


def dedupe_materials():
    """Collapse `MI_Foo.001` back onto `MI_Foo`.

    Importing two packs that share a material gives Blender no choice but to
    suffix the second copy, and each copy drags its own texture images into the
    export. They are byte-identical sources, so remapping the suffixed ones saves
    a whole texture set on a file the browser fetches before the first frame.
    """
    import re
    dropped = 0
    for mat in list(bpy.data.materials):
        m = re.fullmatch(r"(.+)\.\d{3}", mat.name)
        if not m:
            continue
        original = bpy.data.materials.get(m.group(1))
        if original is None or original is mat:
            continue
        mat.user_remap(original)
        bpy.data.materials.remove(mat)
        dropped += 1
    if dropped:
        log(f"deduped {dropped} duplicate material(s) imported with the second pack")


def build_head(armature, skin_material):
    """A head, because neither pack ships one.

    Deliberately a plain skull-and-hair pair rather than a sculpted face: the
    character stands about 12% of frame height under this camera, which puts the
    head near ten pixels across, and a misaligned generated face reads as a bug
    at that size where a clean silhouette reads as a head. Rigid-weighted, so no
    weight painting is involved - the skull rides `Head`, the neck `neck_01`.
    """
    made = []

    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1.0)
    skull = bpy.context.active_object
    skull.name = "base.head.skull"
    skull.scale = (0.093, 0.101, 0.115)
    skull.location = (0.0, 0.012, 1.688)
    made.append(skull)

    # Neck, bridging the collar (z 1.559) up into the skull.
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.049, depth=0.16)
    neck = bpy.context.active_object
    neck.name = "base.head.neck"
    neck.location = (0.0, 0.030, 1.565)
    made.append(neck)

    # Hair: a slightly larger cap, cut to the top half, so the bald sphere reads
    # as a head rather than a mannequin ball.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1.0)
    hair = bpy.context.active_object
    hair.name = "base.head.hair"
    hair.scale = (0.098, 0.104, 0.118)
    hair.location = (0.0, 0.012, 1.690)
    made.append(hair)

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = hair
    hair.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in hair.data.vertices:
        # Keep the crown and the back; drop where the face would be.
        v.select = (v.co.z > -0.15) and not (v.co.y < -0.45 and v.co.z < 0.55)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="INVERT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")

    for obj in made:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

        obj.data.materials.clear()
        obj.data.materials.append(skin_material)
        uv = obj.data.uv_layers.new(name="UVMap") if not obj.data.uv_layers else obj.data.uv_layers[0]
        pinned = HAIR_UV if obj.name.endswith(".hair") else HEAD_UV
        for loop in uv.data:
            loop.uv = pinned

        # Rigid weights: everything below the jaw follows the neck, the rest the head.
        g_head = obj.vertex_groups.new(name="Head")
        g_neck = obj.vertex_groups.new(name="neck_01")
        for v in obj.data.vertices:
            (g_neck if v.co.z < 1.632 else g_head).add([v.index], 1.0, "REPLACE")
        rebind(obj, armature)

    log(f"built head: {', '.join(o.name + ' ' + str(len(o.data.vertices)) + 'v' for o in made)}")
    return made


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bpy.ops.import_scene.gltf(filepath=SRC + "Male_Peasant.gltf")
    armature = only(lambda o: o.type == "ARMATURE")
    armature.name = "Armature"
    log(f"canonical armature from the peasant pack: {len(armature.data.bones)} bones")

    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=SRC + "Male_Ranger.gltf")
    imported = [o for o in bpy.context.scene.objects if o not in before]
    ranger_arm = next(o for o in imported if o.type == "ARMATURE")

    for obj in imported:
        if obj.type == "MESH":
            rebind(obj, armature)
    bpy.data.objects.remove(ranger_arm, do_unlink=True)
    log("ranger meshes re-parented onto the peasant armature; ranger armature dropped")

    split_arms("Male_Peasant_Arms")
    split_arms("Male_Ranger_Arms")

    dedupe_materials()

    skin_material = next(
        m for o in meshes() for m in o.data.materials if m and m.name == SKIN_MAT
    )
    build_head(armature, skin_material)

    dropped = []
    for obj in meshes():
        if obj.name.startswith("base.head."):
            continue
        new = RENAME.get(obj.name)
        if new is None:
            dropped.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
        else:
            obj.name = new
    if dropped:
        log(f"dropped unmapped meshes: {', '.join(sorted(dropped))}")

    missing = set(RENAME.values()) - {o.name for o in meshes()}
    if missing:
        raise SystemExit(f"missing expected parts: {sorted(missing)}")

    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name == "Icosphere":
            bpy.data.objects.remove(o, do_unlink=True)

    log(f"exporting {len(meshes())} parts")
    for o in sorted(meshes(), key=lambda o: o.name):
        log(f"  {o.name:28s} {len(o.data.vertices):6d}v  mat={o.data.materials[0].name}")

    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB",
        export_apply=False, export_skins=True, export_animations=False,
        export_yup=True,
    )
    log(f"wrote {OUT}")


main()
