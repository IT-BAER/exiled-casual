"""Build `wardrobe.glb`: one skeleton carrying every equipment slot's geometry.

Run headless:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --disable-autoexec --python-exit-code 1 \
      --python tools/build_wardrobe.py

Why this is now a repack and not a sculpt
-----------------------------------------
The previous wardrobe was cut out of two whole authored outfits that welded
sleeves to forearms and shipped no head, so every slot past the torso had to be
generated: a head cut out of a third pack by weight, a coat grown from rings, a
helmet faceted out of a cowl. That is 2000 lines of surgery to get four looks.

KayKit Adventurers (CC0) is already the thing that surgery was trying to build.
Every character ships as separate `Head`, `Body`, `ArmLeft`, `ArmRight`,
`LegLeft`, `LegRight` meshes plus its own headgear and cape, all six characters
share ONE 23-joint `Rig_Medium` skeleton at the same rest pose, and the pack
carries `handslot.l` / `handslot.r` bones that exist for nothing but holding
weapons. So a wardrobe is an assignment: load six files, rename each mesh to the
slot it fills, hang them all off one armature, done.

Slot mapping, and why the parts fall where they do
--------------------------------------------------
An outfit's arms carry its gauntlets and its legs carry its boots - KayKit does
not model those as separate pieces, and cutting them out would put us straight
back in the surgery business. So the arms ARE the gloves slot and the legs ARE
the boots slot, which is not a compromise: it means equipping plate gauntlets
changes the whole sleeve, exactly what an ARPG paper-doll wants.

  base.head.face      one head for every look (the atlas differs, the skull
                      does not), hidden by nothing - KayKit helmets are closed
                      shapes that sit OVER a head
  helmet.<look>.*     Knight's helmet + visor, Mage's hat, Barbarian's bear
                      hat, the Rogue's hood mask
  body.<look>.torso   the chest piece, plus `.cape` where the look has one
  gloves.<look>.arms  both arms joined - one mesh, one draw
  boots.<look>.legs   both legs joined
  weapon1.<name>      main hand, skinned 1.0 to `handslot.r`
  weapon2.<name>      off hand, skinned 1.0 to `handslot.l`

Held gear is placed by pre-multiplying the mesh by its handslot bone's rest
matrix and then skinning it 1.0 to that bone, which is exactly what parenting
the object to the bone at local identity would do - the pose KayKit authored its
weapons for. Nothing is parented or driven per frame at runtime; a weapon swap
is the same visibility flip as an armour swap.

There is no `belt` geometry in the pack and no skirt-bone chain: the capes are
skinned straight to the chest. `skirt.ts` therefore has nothing to solve on this
rig - see `rig.ts`.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(
    ROOT, "assets", "props", "source", "kaykit_adventurers",
    "KayKit_Adventurers_2.0_FREE",
)
CHARACTERS = os.path.join(PACK, "Characters", "gltf")
ASSETS = os.path.join(PACK, "Assets", "gltf")
OUT = os.path.join(ROOT, "apps", "web", "public", "models", "wardrobe.glb")

# The armature every mesh ends up on. The Knight is the donor because his file is
# the one whose joint ORDER matches the animation pack's; the others list the
# same 23 bones in a different order, which is free to ignore (a joint is bound
# by name) but not free to export twice.
MASTER = "Knight.glb"
ARMATURE = "Rig_Medium"

# Outfit file -> look name. `hooded` is the Rogue with his hood up: a separate
# body, arms and legs in the pack, so a separate look rather than a head swap.
LOOKS = {
    "Knight.glb": "knight",
    "Barbarian.glb": "barbarian",
    "Mage.glb": "mage",
    "Ranger.glb": "ranger",
    "Rogue.glb": "rogue",
    "Rogue_Hooded.glb": "hooded",
}

# Which look donates the one head. Every KayKit head is the same skull under a
# different atlas, so this picks the skin tone as much as the mesh.
HEAD_LOOK = "knight"

# Mesh suffix (after the character prefix) -> `slot`, `part`. A suffix absent
# here is a headgear piece and lands in the helmet slot under its own name,
# which is how `Helmet` + `HelmetVisor` stay two meshes on one look.
PARTS = {
    "Body": ("body", "torso"),
    "Cape": ("body", "cape"),
    "Quiver": ("body", "quiver"),
    "Head": (None, None),          # handled once, see HEAD_LOOK
    "ArmLeft": ("gloves", "armL"),
    "ArmRight": ("gloves", "armR"),
    "LegLeft": ("boots", "legL"),
    "LegRight": ("boots", "legR"),
}

# Everything else on a character is headgear.
HELMET_PARTS = ("Helmet", "HelmetVisor", "Hat", "BearHat", "Mask")

# Held gear: asset file -> (slot, look). The main hand takes anything with a
# grip; the off hand takes the shields and the things a caster holds in the
# other fist. `_color` variants are the same mesh with the palette swapped into
# the atlas, so only one of each pair is worth shipping.
MAIN_HAND = {
    "sword_1handed": "sword",
    "sword_2handed": "greatsword",
    "axe_1handed": "axe",
    "axe_2handed": "greataxe",
    "dagger": "dagger",
    "staff": "staff",
    "wand": "wand",
    "bow_withString": "bow",
    "crossbow_1handed": "crossbow",
    "crossbow_2handed": "arbalest",
    "mug_full": "mug",
}
OFF_HAND = {
    "shield_round": "buckler",
    "shield_square": "tower",
    "shield_badge": "kite",
    "shield_spikes": "spiked",
    "spellbook_open": "focus",
    "smokebomb": "bomb",
    "quiver": "quiver",
}

HANDSLOT = {"weapon1": "handslot.r", "weapon2": "handslot.l"}

# A quarter turn about the hand slot's own long axis, applied to MAIN-HAND gear
# only. KayKit authors a weapon standing up its own +Z, and the hand slot's rest
# frame has +Z pointing at the sky - so placed raw, a sword points up out of a
# T-posed fist and therefore sticks out SIDEWAYS the moment the idle drops the
# arm to the hip. Turning the blade onto the slot's +X puts it along the arm
# instead, so it hangs down at rest and swings through the strike.
#
# The off hand is deliberately exempt: a shield is a disc in that same plane,
# already facing forward off the forearm, and rotating it would turn a kite
# shield on its side.
GRIP_TURN = 90.0

# ...and the other way for the two casting sticks. A sword hangs point-down at
# rest, but a staff carried point-down buries its crystal in the floor, so the
# quarter turn goes the other way and it rides upright in the fist like a
# walking staff.
GRIP_TURN_UP = ("staff", "wand")


def log(msg):
    print("[wardrobe] %s" % msg, file=sys.stderr)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    """Import one file and return the objects it added."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def rest_signature(armature_obj):
    """Every bone's rest head and tail, rounded - what "the same rig" means here.

    Bind matrices are what actually decide whether a mesh from one file deforms
    correctly on another file's skeleton, and they are derived from the rest
    pose, so comparing rest poses compares the thing that matters. Rounded to
    0.1mm because the pack's six exports differ in float noise, not in shape.
    """
    return {
        b.name: (
            tuple(round(v, 4) for v in b.head_local),
            tuple(round(v, 4) for v in b.tail_local),
        )
        for b in armature_obj.data.bones
    }


def rebind(obj, armature):
    """Move a mesh onto `armature` without moving it in space."""
    for mod in list(obj.modifiers):
        if mod.type == "ARMATURE":
            obj.modifiers.remove(mod)
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.matrix_world = world
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature


def join(objects, name):
    """Join meshes into one object called `name`. Returns it."""
    if len(objects) == 1:
        objects[0].name = objects[0].data.name = name
        return objects[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = joined.data.name = name
    return joined


def drop(obj):
    bpy.data.objects.remove(obj, do_unlink=True)


def build_characters():
    """Load every outfit onto the master armature. Returns the armature object."""
    added = import_glb(os.path.join(CHARACTERS, MASTER))
    armature = next(o for o in added if o.type == "ARMATURE")
    armature.name = ARMATURE
    reference = rest_signature(armature)

    # The pack ships a stray unparented Icosphere in each character file.
    master_meshes = [o for o in added if o.type == "MESH" and o.parent]
    for o in [o for o in added if o.type == "MESH" and not o.parent]:
        drop(o)

    for filename, look in LOOKS.items():
        if filename == MASTER:
            objects = master_meshes
        else:
            new = import_glb(os.path.join(CHARACTERS, filename))
            donor = next(o for o in new if o.type == "ARMATURE")
            if rest_signature(donor) != reference:
                sys.exit(
                    "%s does not share the master rest pose - a mesh bound to it "
                    "would deform wrong on the exported skeleton" % filename
                )
            objects = [o for o in new if o.type == "MESH"]
            for o in list(objects):
                if not o.parent:          # the stray Icosphere again
                    objects.remove(o)
                    drop(o)
            for o in objects:
                rebind(o, armature)
            drop(donor)

        emit_look(objects, look)

    return armature


def emit_look(objects, look):
    """Rename one character's meshes into `slot.look.part`."""
    by_slot = {}
    helmet = []
    for obj in objects:
        suffix = obj.name.split("_", 1)[1] if "_" in obj.name else obj.name
        if suffix == "Head":
            if look == HEAD_LOOK:
                obj.name = obj.data.name = "base.head.face"
            else:
                drop(obj)
            continue
        if suffix in PARTS:
            slot, part = PARTS[suffix]
            by_slot.setdefault(slot, []).append((part, obj))
            continue
        if suffix in HELMET_PARTS:
            helmet.append((suffix.lower(), obj))
            continue
        log("unmapped mesh %s - dropped" % obj.name)
        drop(obj)

    # Arms and legs are one mesh each: they are never shown apart, and joining
    # halves the draw calls for two of the four armour slots.
    for slot, pairs in by_slot.items():
        if slot == "gloves":
            join([o for _, o in pairs], "gloves.%s.arms" % look)
        elif slot == "boots":
            join([o for _, o in pairs], "boots.%s.legs" % look)
        else:
            for part, obj in pairs:
                obj.name = obj.data.name = "%s.%s.%s" % (slot, look, part)

    for part, obj in helmet:
        obj.name = obj.data.name = "helmet.%s.%s" % (look, part)


def build_held(armature):
    """Skin every weapon and shield 1.0 to its hand slot."""
    bones = {b.name: b.matrix_local.copy() for b in armature.data.bones}
    for slot, table in (("weapon1", MAIN_HAND), ("weapon2", OFF_HAND)):
        bone = HANDSLOT[slot]
        place = bones[bone]
        for filename, look in table.items():
            path = os.path.join(ASSETS, filename + ".gltf")
            if not os.path.exists(path):
                sys.exit("missing held asset %s" % path)
            new = import_glb(path)
            meshes = [o for o in new if o.type == "MESH"]
            for o in new:
                if o.type != "MESH":
                    drop(o)
            obj = join(meshes, "%s.%s.mesh" % (slot, look))

            # KayKit authors held gear where a bone-parented object would sit:
            # at the origin, in the hand slot's own frame. Pre-multiplying by
            # the bone's rest matrix puts it in the hand, and skinning it whole
            # to that bone reproduces the parent exactly - with no per-frame
            # attachment for the runtime to keep in step with an animation.
            if slot != "weapon1":
                turn = Matrix.Identity(4)
            else:
                degrees = -GRIP_TURN if look in GRIP_TURN_UP else GRIP_TURN
                turn = Matrix.Rotation(math.radians(degrees), 4, "Y")
            obj.data.transform(place @ turn)
            obj.matrix_world = Matrix.Identity(4)

            obj.vertex_groups.clear()
            group = obj.vertex_groups.new(name=bone)
            group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
            rebind(obj, armature)
            log("held %s.%s -> %s (%d tris)"
                % (slot, look, bone, len(obj.data.polygons)))


def dedupe_materials():
    """Collapse the per-file copies of each atlas onto one material.

    Every one of the 24 imports brings its own `knight`/`mage`/... material and
    its own copy of that atlas image, and the exporter ships each copy. The pack
    names one material per outfit and the importer only ever adds a `.001`, so
    the name with that suffix stripped is the identity - and it merges the two
    rogue files, which the image name does not (one of them arrives unpacked).
    """
    base = lambda name: name.split(".")[0]

    canonical = {}
    for mat in list(bpy.data.materials):
        canonical.setdefault(base(mat.name), mat)

    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for i, mat in enumerate(obj.data.materials):
            if mat is not None:
                obj.data.materials[i] = canonical[base(mat.name)]

    # Reassigning a slot does not drop the old material's user count until the
    # data is purged, so counting users first leaves the duplicate behind.
    bpy.data.orphans_purge(do_local_ids=True, do_recursive=True)
    for mat in bpy.data.materials:
        mat.name = mat.name.split(".")[0]
    log("materials: %s" % sorted(m.name for m in bpy.data.materials))


def report(armature):
    tris = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
    log("%d meshes, %d tris, %d joints, %d materials"
        % (sum(1 for o in bpy.data.objects if o.type == "MESH"),
           tris, len(armature.data.bones), len(bpy.data.materials)))
    for name in sorted(o.name for o in bpy.data.objects if o.type == "MESH"):
        log("  " + name)


def export():
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_yup=True,
        use_selection=False,
    )
    log("wrote %s (%.2f MB)" % (OUT, os.path.getsize(OUT) / 1e6))


def main():
    clear()
    armature = build_characters()
    build_held(armature)
    dedupe_materials()
    report(armature)
    export()


main()
