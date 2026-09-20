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

import json
import math
import os
import sys

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils import Matrix, Vector

SRC = "D:/VSC/exiled-casual/assets/characters/"
GEAR_SRC = "D:/VSC/exiled-casual/assets/props/source/trellis_local/"
OUT = "D:/VSC/exiled-casual/apps/web/public/models/wardrobe.glb"
FIT_REPORT = "D:/VSC/exiled-casual/assets/characters/gear-fit.json"

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


def import_gltf(name, root=SRC):
    path = os.path.join(root, name)
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


# --------------------------------------------------------------------------
# Rigid gear
#
# Every piece here is one donor mesh with no skeleton of its own, fitted to a
# measured feature of the body. A piece with no `deform` key hangs off one joint
# and is skinned ENTIRELY to it; a piece that names bones in `deform` takes the
# body's own weights over that set instead, because a torso plate has to bend
# where the spine bends. That is what keeps the runtime unchanged: a helmet is
# `helmet.<look>.helm` exactly the way a body is `base.<look>.body`, shown by
# enabling it and hidden by not, with no socket, no parenting and no per-frame
# work anywhere in the client.
#
# Placement is derived from the body that is actually loaded - this head's
# width, this hand's centre, this forearm's thickness - never from a world
# coordinate, so the same table fits a body with different proportions.

# The suit is a cuirass, its pauldrons and half sleeves, and its own short fauld
# in one shell, so it answers to the trunk, both shoulders AND the hips: the
# fauld hangs off the belt and swings with the thighs. Without the leg joints the
# skirt stays welded to the pelvis and the thigh walks out through it.
PLATE_BONES = ("spine_01", "spine_02", "spine_03", "neck_01",
               "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r",
               "pelvis", "thigh_l", "thigh_r")

# What is left of that shell once the two shoulder caps are their own objects.
# A smooth-skinned edge whose ends answer to the trunk and to an upper arm has
# to stretch when the arm lifts - measured up to 8x its rest length at 55 deg -
# and no weighting removes that, because the two bones genuinely move apart.
TORSO_BONES = tuple(b for b in PLATE_BONES if not b.startswith("upperarm"))
PLATE_ARMS = ("upperarm_r", "upperarm_l")
# Where the shell stops being torso: the body's own upper-arm weight under each
# point of steel, which is the same number that decides how far that point would
# have been dragged. Half a unit is the boundary; the band either side of it is
# shell that belongs to BOTH pieces, so the torso's rim slides under steel
# instead of opening a crack. `split_arm_plates` prints the band it cut.
PLATE_SPLIT_AT = 0.5     # arm weight at which the shell stops being torso
# Overlap is grown in millimetres, not in weight: the transfer crosses from
# trunk to arm inside a single 15 mm edge over much of the shoulder, so any band
# cut between two weights collapses to a touching seam. Each cap therefore takes
# every vertex within this of the arm set and the torso drops only the arm set
# eroded by the same, which leaves twice this much shell in both meshes.
PLATE_SPLIT_MARGIN = 0.06
# How far a cap may stand off the arm it rides, in metres, measured out from the
# arm's OWN skin rather than guessed: a pauldron is a dome over the deltoid and
# a sleeve down the humerus, and nothing further out is arm at any pose. Without
# this the transfer hands the humerus every point of loose steel whose nearest
# body surface happens to be the arm - collar, upper chest, the flank under the
# armpit - and rigid binding then swings a slab of breastplate off the cuirass.
PLATE_CAP_STANDOFF = 0.05   # out from the axis, past the widest arm skin
PLATE_CAP_INBOARD = 0.02    # along the bone, past where the arm's skin starts

# The harness answers to every joint it spans, the knees included. Steel bent by
# a smooth transfer reads soft at a knee; the trade is taken on purpose, because
# the alternative - a rigid segment per limb section - opens a crack at the
# outside of every hard bend, and a crack shows the body that is no longer drawn
# under it. No forearm: the sleeve is cut off at the pauldron.
SUIT_BONES = ("spine_01", "spine_02", "spine_03", "neck_01",
              "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r",
              "pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r")
# Where the sleeve ends, as a fraction of the upper arm from shoulder to elbow.
# Body armour carries a pauldron over the deltoid and stops; the arm below it is
# skin and the hand belongs to the glove slot.
SUIT_PAULDRON_DROP = 0.5
# The gorget. A short steel ring standing this far above the base of the neck,
# with bare skin above it up to the jaw - a collar drawn to the helm rim is a
# 12 cm tube round a neck and reads as plumbing rather than armour. The radius
# is how wide the collar column reaches off the neck axis in the neck's own skin
# radii; it picks the column out of the shell, so the pauldrons standing 21 cm
# out to each side and the backplate top are never part of it.
SUIT_GORGET_HEIGHT = 0.02
# The collar steel outside the throat column, over the trapezius, stands this
# far above the base of the neck.
SUIT_COLLAR_HEIGHT = 0.06
# Ahead of the neck the ring's rim drops this many metres per metre forward.
SUIT_THROAT_FALL = 0.25
SUIT_GORGET_LIFT = 0.5
SUIT_GORGET_RADIUS = 2.2
# The collar column, in neck skin radii, that the rim cut must leave steel in:
# the check that the plane did not take the whole collar. Wider than
# SUIT_GORGET_RADIUS above: this donor's collar rises into an angular block
# reaching 4.1 neck radii off the axis before the pauldrons take over past 4.8.
SUIT_GORGET_CUT_RADIUS = 4.3
# The collar rim is levelled sector by sector, not stretched by one factor: this
# donor's collar stands 40 mm higher at the throat than behind the neck, and one
# factor that closes the back drives the front through the helmet.
SUIT_GORGET_SECTORS = 16
SUIT_GORGET_MAX = 2.2
# The pauldron. A generated figure's shoulder is its own girth, and this one is
# thinner than the body it is worn on, so the deltoid comes through the plate.
# The cap is grown about the arm's own axis until the deltoid under it is
# inside, ramped in over this much of its span so it does not tear off the
# breastplate, and never grown by more than this factor.
SUIT_PAULDRON_STANDOFF = 0.006
SUIT_PAULDRON_MAX = 1.8
SUIT_PAULDRON_SECTORS = 12
SUIT_PAULDRON_RAMP = 0.08
# How wide the sleeve reaches off the arm axis, in the arm's own skin radii.
# Generous enough to hold a pauldron standing over the deltoid, tight enough
# that the fauld hanging 40 cm below the axis is never mistaken for a sleeve.
SUIT_SLEEVE_RADIUS = 3.0
# How thick the steel reads at a cut rim, metres: the collar's open ring and
# the pauldron's outer edge are extruded this far into the body they surround.
SUIT_RIM_LIP = 0.006
# How far inboard of the shoulder joint the pauldron cap still counts as cap
# and escapes the collar plane, metres.
SUIT_CAP_INBOARD = 0.08
# Collar steel this far off the trapezius is a torn flap, not a plate: measured
# on the v9 harness, the shell over that skin sits inside 30 mm and the fins
# stand 40 to 100 mm out. Read from this far below the shoulder joint up.
SUIT_FLARE_PROUD = 0.04
SUIT_FLARE_BELOW_SHOULDER = 0.04
# Where the suit's shins are cut off into `chest.plate.greave`, below the knee.
# 30 mm under the sabaton rim (`BOOT_TOP`): the suit is still wider than the
# boot there, so its edge laps the rim from outside.
SUIT_GREAVE_BELOW_KNEE = 0.06
# A soft suit's greave is its trouser legs alone, the shell inside this many
# calf radii of either shin (`greave_radius` on the spec): a skirt cut on the
# same plane loses its lower half under a pair of boots and wears the cut as a
# seam of slivers. The coat's is wider because its boot cuffs and straps flare.
SOFT_GREAVE_RADIUS = 2.0

# A fauld hangs off the belt and its tassets ride the thighs, so the skirt has
# to answer to both legs and to the lumbar the cuirass above it already bends
# with. Without `spine_01` the top ring stays rigid while the plate over it
# leans, and the two rims part company at the waist.
HIPS_BONES = ("spine_01", "pelvis", "thigh_l", "thigh_r")

# Every joint a gauntlet answers to. The wrist band alone is not enough: each
# finger carries its own groups and they are what the steel has to follow, and
# the cuff stands over the forearm, which moves with the elbow and not the
# wrist. The twelve terminal `*_end_*` tips are left out on purpose - the
# fingertip steel then comes out of the transfer orphaned and `skin_by_transfer`
# pins an orphan to the nearest kept bone, which is the last real finger joint.
FINGER_BONES = tuple(f"{finger}_{i:02d}" for finger in ("index", "middle", "ring", "pinky", "thumb")
                     for i in (1, 2, 3))
FINGER_TIPS = tuple(f"{finger}_04_end" for finger in ("index", "middle", "ring", "pinky", "thumb"))
GAUNTLET_BONES = ("hand_r", "lowerarm_r") + tuple(f"{b}_r" for b in FINGER_BONES)

# A sabaton is the shin plate and the boot under it, so it bends at the ankle and
# again at the ball of the foot. The knee is the top rim's limit rather than a
# joint it hangs from: `thigh_r` would drag the shaft up the leg on every stride.
SABATON_BONES = ("calf_r", "foot_r", "ball_r")

# A worn piece REPLACES the body under it. The skin it closes is not drawn at
# all, so nothing can push out through a plate at any pose, and that needs the
# body cut into pieces the runtime can switch off one at a time. The cut asks
# the same summed-weight question `build_trousers` asks of the legs.
#
# Only what a piece genuinely CLOSES is listed. The suit is a whole harness cut
# off at the skull base, the wrists and the ankles, so it closes the trunk, both
# arms to the wrist and both legs to the ankle. The head, the hands and the feet
# are left out because a helmet, a gauntlet and a boot own those and each is its
# own item. Nor are the neck and the clavicles - they stand in the harness's own
# collar and arm holes.
BODY_REGIONS = {
    "torso": ("pelvis", "spine_01", "spine_02", "spine_03"),
    # The neck and the collar (both clavicles) are their OWN regions and both
    # stay drawn under a suit: the gorget is a short ring standing off the neck,
    # and with the clavicles hidden the neck ended in a void inside it. The
    # trapezius blends across the two and belongs to whichever sums higher - see
    # `split_body_regions`, which is what keeps a bare strip out of the seam.
    "neck": ("neck_01",),
    "collar": ("clavicle_l", "clavicle_r"),
    "arm_l": ("upperarm_l", "lowerarm_l"),
    "arm_r": ("upperarm_r", "lowerarm_r"),
    "leg_l": ("thigh_l", "calf_l"),
    "leg_r": ("thigh_r", "calf_r"),
    # The `*_04_end_*` tips carry the fingernails; left out, they stay on the
    # body remainder and stand through the gauntlet's fingertips.
    "hand_l": ("hand_l",) + tuple(f"{b}_l" for b in FINGER_BONES + FINGER_TIPS),
    "hand_r": ("hand_r",) + tuple(f"{b}_r" for b in FINGER_BONES + FINGER_TIPS),
    "foot_l": ("foot_l", "ball_l"),
    "foot_r": ("foot_r", "ball_r"),
}
BODY_REGION_WEIGHT = 0.5    # summed weight over a region's bones to belong to it

RIGID_GEAR = (
    {
        "slot": "helmet", "look": "iron", "part": "helm",
        "src": "iron-helm-8k-v3.glb", "bone": "Head", "fit": "head_shell",
        "matte": True,
    },
    {
        "slot": "helmet", "look": "leather", "part": "hood",
        "src": "leather-hood-20k-v1.glb", "bone": "Head", "fit": "head_shell",
        # A cowl stands off the skull where a helm's lining does not, so the
        # median gap it is allowed is wider. A head is deeper than this cavity
        # and no taller than it, so the stretch that makes room runs front to
        # back: drawn out along Z instead, the cowl stands over the crown. The
        # helm's forward pull is left off, because a hood is not worn pulled
        # down over the brow and the pull costs the occiput the same 7 mm.
        "symmetric": True,
        "fit_args": {"coverage": 1.0, "max_median": 0.040, "back_shift": 0.0,
                     "stretch": 1.2, "stretch_axis": 1},
        "matte": True,
    },
    {
        "slot": "weapon1", "look": "emberwand", "part": "mesh",
        "src": "wand-3000-v3b.glb", "bone": "hand_r", "fit": "hand_grip",
    },
    {
        "slot": "weapon2", "look": "buckler", "part": "mesh",
        "src": "buckler-4000-v1.glb", "bone": "lowerarm_l", "fit": "forearm_strap",
    },
    {
        "slot": "weapon2", "look": "towershield", "part": "mesh",
        "src": "tower-shield-10k-v3.glb", "bone": "lowerarm_l", "fit": "tower_strap",
    },
    {
        "slot": "chest", "look": "plate", "part": "cuirass",
        "src": "plate-suit-20k-v9.glb", "bone": "spine_03", "fit": "plate_suit",
        "deform": SUIT_BONES,
        "matte": True, "twosided": True, "clean": True, "greaves": True,
    },
    # The soft suits are the same whole-figure donor shape as the harness -
    # headless T-pose, gloves and boots on - so they take the same cuts: head at
    # the skull base, sleeves at the pauldron, feet at the ankle.
    #
    # The robe is first of the two because it lays the skirt ring out: its cloth
    # runs to the ankle, the coat's stops at the greave plane, and a ring laid
    # out from the coat has nothing to say about the half below it.
    {
        "slot": "chest", "look": "robe", "part": "robe",
        "src": "emberbound-robe-20k-v1.glb", "bone": "spine_03", "fit": "soft_suit",
        "deform": SUIT_BONES,
        # No greave. A greave is hidden the moment boots are worn, and this robe
        # is floor length: splitting its shins off takes exactly the cloth that
        # covers the boot, and the boot then shows through the outer flare.
        "matte": True, "twosided": True, "clean": True,
        "skirt": 0.0,
    },
    {
        "slot": "chest", "look": "leather", "part": "coat",
        "src": "stalker-leathers-20k-v1.glb", "bone": "spine_03", "fit": "soft_suit",
        "deform": SUIT_BONES,
        # The decode's two shoulder caps are not the same garment: the -X one is
        # a smooth puff, the +X one a faceted plate torn along its lower edge
        # with a pale sliver over its top. A coat is symmetric, so the good half
        # carries both, and here that half is the one at -X.
        "symmetric": "-x",
        "matte": True, "twosided": True, "clean": True, "greaves": "shins",
        "greave_radius": 3.5, "skirt": 1.3,
    },
    {
        "slot": "boots", "look": "plate", "part": "sabaton",
        "src": "sabaton-8k-v1.glb", "bone": "foot_r", "fit": "boot_leg",
        "deform": SABATON_BONES, "matte": True, "mirror": True,
    },
    {
        "slot": "boots", "look": "leather", "part": "boot",
        "src": "leather-boot-8k-v1.glb", "bone": "foot_r", "fit": "boot_leg",
        "deform": SABATON_BONES, "matte": True, "mirror": True,
    },
    {
        "slot": "gloves", "look": "plate", "part": "gauntlet",
        "src": "gauntlet-hand-v2.glb", "bone": "hand_r", "fit": "hand_authored",
        "deform": GAUNTLET_BONES, "matte": True, "mirror": True,
    },
    {
        "slot": "gloves", "look": "leather", "part": "glove",
        "src": "glove-hand-v1.glb", "bone": "hand_r", "fit": "hand_authored",
        "deform": GAUNTLET_BONES, "matte": True, "mirror": True,
    },
)

# The long lame skirt the fauld donor made. The plate suit carries its own short
# fauld, so two skirts would fight over the same hips; `fit_plate_hips`, the
# `HIPS_*` constants and `tools/prep_tassets.py` stay for the day a longer one
# is wanted over a suit that has none.
SKIRT_PARKED = {
    "slot": "chest", "look": "plate", "part": "tassets",
    "src": "fauld-proc-v4.glb", "bone": "pelvis", "fit": "plate_hips",
    "deform": HIPS_BONES, "matte": True,
}

# A decoded donor is welded at this distance and every boundary loop but the
# largest DONOR_OPENINGS is closed. Zero for the plate suit: the decode is a
# solid figure, its steel has an inner and an outer skin 7 mm apart, and its
# largest boundary loop spans 36 mm at an ankle - every loop is a crack. Edges
# bent past DONOR_SMOOTH_ANGLE stay sharp under the smooth shading.
DONOR_WELD = 0.0005
DONOR_OPENINGS = 0
# A loose island under this much surface is a decode shard, not a plate: the
# smallest island any of these donors carries on purpose measures 341 cm2.
DONOR_SCRAP_AREA = 0.005   # square metres
DONOR_SMOOTH_ANGLE = math.radians(48.0)

# Both donors ship a glossy ORM pack that reads as latex under Babylon's PBR;
# raised/capped here rather than flattened, so a steel highlight still moves.
# The metallic cap is also a floor under the DIFFUSE term: a metal has none, so
# a fully metallic plate renders black anywhere the environment fails to reach.
MATTE_ROUGHNESS_FLOOR = 0.40
MATTE_METALLIC_CAP = 0.75

# Air the scalp must keep under a hard shell, and the skull it is measured over:
# everything above a quarter of the head's height, forehead included. Filtering
# the face out reads as sensible - the opening is meant to be bare - and hides
# the one fault that matters, because the forehead is ABOVE the brim and has to
# be under steel.
HELM_SEAT_SWEEP = 24     # heights the seat is swept over before it is halved
HELM_SEAT_STEPS = 10     # halvings after the sweep, well under a millimetre
HELM_COVER_FROM = 0.25   # cranium measured from this fraction of head height up
HELM_NAPE_FROM = 0.10    # the nape starts this fraction of head depth behind centre
HELM_BACK_SHIFT = -0.03  # seat, as a fraction of head depth; negative is forward
# The ears and the lower nape are outside this measurement and no automatic
# test replaced it: ray parity is undefined on a shell open at the bottom, and
# "steel overhead" is true of the whole head under any dome. The width floor is
# therefore an eye's number, set where the ears stopped coming through.
HELM_WIDTH_FROM = 1.125  # narrowest dome/head width ratio worth trying
HELM_WIDTH_TO = 1.35     # past this a shell is a bucket, whatever it measures
HELM_WIDTH_STEP = 0.025
# A nearest-surface distance is unsigned, so a scalp point 2 mm through the
# steel and one 2 mm under it measure the same. Sizing on that number alone
# grows the shell until the distance happens to rise, which is why a bucket
# reads as a fit. Coverage is the signed test: from a point under steel, a ray
# out along the head's radius hits the shell, and from a point poking through
# it hits nothing. The smallest ratio that covers every scalp point is the fit;
# the gap floor keeps the steel off the skin and the median gap is the ceiling
# that rejects a donor needing a bucket to cover anything at all.
# Coverage answers a question about the cranium only, because the ears and the
# nape sit below the brim on any open helm and asking for steel outboard of them
# demands a bucket. What they must not do is come THROUGH the steel, and that is
# a different measurement: a point embedded in the shell wall is inside its
# solid, which ray parity says and a distance cannot.
HELM_COVERAGE = 1.0      # fraction of measured cranium that must have steel outboard
HELM_MIN_GAP = 0.0002    # 1st-percentile air between scalp and steel, metres
HELM_MAX_MEDIAN = 0.030

# A haft is sized by the hole a fist makes, not by the length that looks right:
# scaling a gnarled donor to a wand's length leaves its grip wider than the
# fingers can close, and the knuckles come through the wood. Length is then
# bought back along the shaft alone, which a hand cannot feel and an eye reads
# as a longer wand rather than a fatter one.
WAND_GRIP_DIA = 0.028      # metres across the shaft where the fist closes
WAND_LEN_RATIO = 0.23      # of body height
WAND_MAX_STRETCH = 1.8     # past this the carving visibly smears
# Where the wand's head should point while he stands still, in world axes:
# ahead of him and raised about a third of a right angle, with a little of his
# own right in it so the shaft clears the thigh. Aiming it across the palm is
# what a hand actually does and it is unreadable, because `Idle_Loop` is a
# bare-handed idle that turns the grip axis forward and UP - down the barrel of
# the front camera, and inside the arm from the game camera. The bind-pose
# direction that lands here is measured off the clip, not assumed.
WAND_AIM = (-0.18, -0.62, 0.76)
IDLE_CLIP = "Rig|Idle_Loop"
ANIMS = "D:/VSC/exiled-casual/apps/web/public/models/anim-library.glb"

BUCKLER_DIA_RATIO = 0.20   # of body height
BUCKLER_GAP = 0.008        # air between the arm and the shield's back face
BUCKLER_ALONG = 0.82       # 0 at the elbow, 1 at the wrist
BUCKLER_ROLL = -90         # degrees about the shield's own face
# Where the face looks while he stands still, in world axes: out from his left
# side and a little ahead, which is how a strapped buckler hangs when the arm is
# down. Measured against the idle clip, not the bind pose.
BUCKLER_FACE = (0.94, -0.34, 0.0)

TOWER_HEIGHT_RATIO = 0.62  # of body height; shoulder to below the knee
TOWER_GAP = 0.012          # air between the arm and the shield's back face
TOWER_ALONG = 0.95         # 0 at the elbow, 1 at the wrist; a bracer rides near the hand
# A tower shield is not gripped at its own middle: the forearm strap sits above
# it, so the board covers from the chest down past the knee with the hand at the
# hip. Fraction of the donor's own height, from the bottom, that the strap point
# sits at. Lower than this and the top edge falls to the belt, leaving a plank
# beside the leg that guards nothing.
TOWER_HANG_FROM_BOTTOM = 0.58  # strap height up the shield's own span, 0 at its foot
# A tall board does not look where a buckler looks. Hung on the buckler's own
# outward face it stands edge-on to the front, so from the game camera it is a
# plank beside the leg and covers nothing. This one faces mostly ahead with
# enough of his left in it that the board clears the thigh.
TOWER_FACE = (0.32, -0.95, 0.0)

# A rigid piece is measured in the idle and carried back through the clip's own
# transform, because it rides one joint and the mesh must be authored in the
# rest pose. A DEFORMING piece inverts that rule: the skinning is what carries
# it into every clip, so it is fitted against the REST body and nothing about
# the idle applies. Fitting a plate to the idle would bake that one frame's
# spine bend into the bind pose and put it back into the ribs everywhere else.
#
# The plate covers the trunk, and each pauldron sits over its own shoulder, so
# the weights it takes from the body have to span all three. Anything outside
# this set is dropped after the transfer: a chest plate that picks up a stray
# thigh weight tears downward the moment he runs.
# The trunk is measured below the armpit, because the pauldrons stand far wider
# than the chest and sizing on the full width leaves the plate INSIDE it - the
# body then wears two floating shoulder caps and a sliver of sternum. On a suit
# that runs collar to mid-thigh in one shell the band is the WAIST: it is the
# only stretch of the donor with nothing else beside it, sleeves above it and the
# fauld's flare below. Measured as the narrowest cross-section in that stretch,
# not at a named height, so it moves with whatever donor is fitted.
# The top of the stretch is where the armscye opens: a ray fired above it leaves
# through the sleeve instead of the chest wall and reads 0.81 m across on a torso
# that is 0.47.
PLATE_TRUNK_FROM = 0.42  # the trunk is measured over this stretch of donor height
PLATE_TRUNK_TO = 0.64
# Height and width are scaled separately, because a donor's own aspect is not the
# body's: sized to the chest this suit hangs past the knees, sized to the span
# from the collar to mid-thigh it is a corset. A plate is not a face - nobody
# reads a few per cent of stretch in it, and everybody reads a skirt over the
# knees.
# Positive lifts the collar ABOVE the base of the neck, and because the hem is
# pinned to the thigh this makes the suit taller rather than just higher - which
# is the whole point, because the seat is really about where the PAULDRONS land.
# Swept against the hem pinned at mid-thigh: at 0.09 the shoulder caps hang
# 48 mm below the shoulder joint, they graze the trapezius (1st-percentile air
# 0.2-0.3 mm against a 0.5 mm floor) and lateral cover of the upper chest is
# 0.78; every step up lifts them, and from 0.18 the caps sit ON the shoulders
# with 8 mm of air, cover is 1.000 and the median gap is still inside its cap.
# Past 0.20 nothing improves and the suit is climbing off the body.
# This donor's collar is a tall flared gorget, so the rim ends up at chin height:
# that is the donor's own proportion, not slack in the fit.
PLATE_COLLAR = 0.18      # collar rim relative to the base of the neck, metres
# The suit's hem is its fauld's, and a fauld stops at mid-thigh: far enough down
# that no low camera angle sees under it, far enough above the knee that the leg
# never walks through it. Measured off the knee (the calf's own head) because
# that is the landmark the leg bends at, so the skirt keeps its clearance on any
# body proportion.
PLATE_HEM_ABOVE_KNEE = 0.15
PLATE_TRUNK_SAMPLES = 24  # heights the trunk is measured across, over that stretch
# A fauld that reaches mid-thigh and keeps the donor's flare reads as a dress,
# whatever it measures. Both faults are fixed on the donor, BELOW the belt only,
# after the width sweep has settled - the chest, the collar and the width are the
# fit that was accepted and nothing here may move them.
#
# Length is pinned to the crotch rather than to the knee, because the crotch is
# what a short fauld has to cover and the knee is what a long one reaches. The
# crotch is read off the body: the lowest skin the pelvis carries at half weight
# or more, within a hand's width of the mid-plane, so it is this body's own
# landmark and not a height anybody chose.
PLATE_HEM_BELOW_CROTCH = 0.05  # the hem lands this far under the crotch, metres
PLATE_CROTCH_HALF = 0.03       # skin this close to the mid-plane is the crotch
# The line the skirt is drawn up to is the BELT, found as the donor's narrowest
# ring between its hem and its chest. Pinning it there is what keeps the belt
# where the fit put it: everything above the ring is untouched.
PLATE_BELT_FROM = 0.10   # the belt ring is searched over this stretch of donor height
PLATE_BELT_TO = 0.50
PLATE_BELT_BANDS = 32
# Flare: the hem may stand no further from the hip axis than the hips themselves
# plus a little ease, or the skirt swings wide of the legs and is a skirt. The
# taper runs from nothing at the belt to the measured factor at the hem, and it
# is backed off in steps if it costs the thighs their air.
PLATE_FAULD_EASE = 0.03  # the hem may reach this far past the hips, metres
PLATE_HEM_BAND = 0.10    # the bottom this share of the fauld is its hem
PLATE_TAPER_STEP = 0.02  # the taper is relaxed by this much per try
# A scanned cuirass hem need not be level, and one that hangs out of level cannot
# be corrected by any affine transform that leaves the arm openings alone - the
# older donor's back hung 125 mm below its front and only its SKIRT was stretched
# down onto the belt. This suit's front and back hems agree to within a few
# millimetres, so it takes one uniform placement and no skirt segment at all.
# Asserted rather than assumed: past this the two-segment stretch is needed back.
PLATE_FRONT = 0.15       # the hem is read over this depth of each face of the donor
PLATE_HEM_LEVEL = 0.02   # most the front and back hems may differ by, metres
# A chest box measured off skin includes soft tissue, so a cuirass that reads
# narrower than it can still stand clear of every rib. Coverage and the gap floor
# decide that, not this bound - it only says where the sweep starts looking.
PLATE_WIDTH_FROM = 0.98  # narrowest plate/chest width ratio worth trying
PLATE_WIDTH_TO = 1.45    # past this it is a barrel, whatever it measures
PLATE_WIDTH_STEP = 0.02
# The shoulder joint is measured as a ball on the body itself: the upper arm's
# own radius, taken over the skin down the first fraction of the bone.
PLATE_SOCKET_ALONG = 0.3  # of upperarm length, from the head down
PLATE_COVERAGE = 0.90   # fraction of measured chest that must have steel outboard
PLATE_MIN_GAP = 0.0005  # 1st-percentile air between skin and steel, metres
PLATE_MAX_MEDIAN = 0.040

# The fauld is the cuirass's own second half, so its top rim is measured off the
# cuirass rather than off the body: the same lumbar plane the breastplate stops
# at, plus an overlap that tucks the waist ring UNDER the steel above it. A rim
# that merely met the plate would open into a bare strip of hip the moment the
# spine bent, because the two pieces answer to different joints.
# The join is a BELT, not two rims meeting. The donor's top is a plain waist
# band, and it is sized on the cuirass rather than on the body: its inner face
# clears the breastplate's rim by a few millimetres all the way round, and its
# top stands above the rim's lowest front point, so the rim ends up INSIDE the
# band and there is no ledge between the two pieces to read as a gap.
HIPS_BAND_AIR = 0.003    # the band's outer face stands this far past the flare, metres
# Signed against the cuirass's lowest FRONT point: negative tucks the band's top
# edge under the flare's lip, which is where it belongs - the lip then lands on
# the band and there is no seam to see. Positive would push the band's edge up
# inside the flare, where the plate is wider than any belt that is not a hoop.
HIPS_BAND_RISE = -0.003
# The band's share of the donor's own height, which is `WAIST_BAND_H` over the
# donor's span in `tools/prep_tassets.py`. It cannot be measured off the mesh:
# a smooth band carries vertices at its two edges only, so every slab search
# through the middle of one finds a rivet and calls that the waist.
HIPS_BAND = 0.131
HIPS_BAND_BINS = 36      # 10-degree bins for the air, rim-cover and overlap sweeps
# Signed against the KNEE: positive stops the hem above it, negative carries it
# below. The sabaton's own rim is 30 mm under the knee (`BOOT_TOP`), so at -10 mm
# the skirt hangs 20 mm over the outside of that cuff and the shin has no bare
# band at any stride. Above the knee - which is where 0.04 put it - the skirt is
# short enough to show the crotch from a low angle, which is the fault this is.
HIPS_HEM = -0.010        # the hem lands this far above the knee, metres
# The width is not swept off the hips any more: the waist band is a belt on the
# cuirass, so the rim decides it and there is one answer. What is left to sweep
# is slack ABOVE that answer, for the case where the skirt hanging under a
# rim-tight band cannot make its own gates; every step of it is air opening at
# the belt, so it is bounded tightly and reported when it is used.
HIPS_BAND_SLACK = 1.30   # most the sweep may widen the piece past a rim-tight band
HIPS_WIDTH_STEP = 0.02
# The band is measured at the donor's very top, over this fraction of its
# height: its smallest radius there is the inner face the cuirass rim goes
# inside, its largest is the outer face that has to stand past that rim. It is
# NOT found by a slab search - a smooth band carries vertices only at its two
# edges, so a slab through the middle of one finds a rivet and calls it the
# waist.
HIPS_LIP = 0.06          # the band is read off the top this fraction of the donor
HIPS_RIM_BAND = 0.02     # the cuirass's rim is its lowest this much, metres
HIPS_RIM_CLEAR = 0.002   # the lip reaches this far past that rim, metres
# Below the plate's 0.90 on purpose: the donor's eight panels lap rather than
# meet, so a ray leaving between two laps can still slip out at a grazing angle
# even though the plan is closed. The crotch is excluded from THIS measurement
# and reported on its own instead - see `fit_plate_hips`.
HIPS_COVERAGE = 0.85
HIPS_INNER = 0.5         # outward directions this far toward the other leg are crotch
# A skirt covers sideways. Skin whose way out of its own limb points up leaves
# through the open waist - that is the cuirass's to cover - and skin pointing
# down leaves through the open hem, which is what a hem is. The boot draws the
# same line at its rim and its sole; without it the two openings alone cost this
# fit 28 per cent of its coverage.
HIPS_VERTICAL = 0.5      # outward directions this far off level are an opening
HIPS_MIN_GAP = 0.0005    # 1st-percentile air between skin and steel, metres
HIPS_MAX_MEDIAN = 0.045

# A gauntlet is a hand-shaped shell, so its length is not a ratio to sweep: the
# fingertips have to land on the fingertips or the steel reads as a claw or a
# stump. Length is pinned to the hand and the cross-section is what grows until
# the knuckles are inside, which is the plate's split by another name.
# What grows is the AIR, not a proportion: armour clears skin by millimetres, and
# a hand is three and a half times as wide as it is thick, so one shared ratio
# buys 5 mm through the fingers by adding 17 mm across them. The sweep is over
# the clearance itself and each axis takes the same millimetres on its own span.
# The donor runs up its own +Z: fingertips at +Z, the cuff opening at -Z, the
# thumb splayed to +X and dropped to the palm side at -Y, which is what makes it
# a RIGHT hand. The rest pose holds that hand out along -X with the palm down
# and the thumb forward, which is where the two quarter turns below put it.
GAUNTLET_TIP = 0.008        # steel past the fingertips, metres
GAUNTLET_SEAT = 0.06        # wrist plane, as a fraction of hand length in from it
GAUNTLET_WRIST_FROM = 0.15  # the wrist is the donor's waist, searched over this
GAUNTLET_WRIST_TO = 0.55    # stretch of its own length and no further
# Width and thickness are both measured over the outer fifth of the hand, which
# is fingers and nothing else: an anatomical thumb tips out at 0.75 of the
# donor's run and at 0.58 of this body's hand, so anything lower lets the thumb
# answer for the width. It measures half again what the four fingers span, and
# the fit then squashes them to make room for a thumb that was never going to
# line up - every steel finger lands in the gap between two of the body's.
GAUNTLET_FAN_FROM = 0.80    # of hand length, from the wrist out
GAUNTLET_CLEAR_FROM = 0.0005  # tightest air between fingers and steel, metres
GAUNTLET_CLEAR_TO = 0.014     # past this it is a mitt, whatever it measures
GAUNTLET_CLEAR_STEP = 0.0005
# The webs between the fingers are the hand's arm sockets: a glove is cut open
# there and no shell reaches into them, so a ray fired out of a web leaves
# between two steel fingers and reports bare skin however well the hand is
# covered. Each web is a ball on the midpoint of two neighbouring finger roots,
# sized by those fingers' own measured radius - all of it read off this body.
GAUNTLET_WEB_ALONG = 0.6    # of finger length, from the root down
# Skin with less room than this between itself and the next finger holds no air
# for a glove: two shell faces share the gap, so half of a millimetre is the
# most either side can have. Measured per point, not named - the flanks of the
# ring and pinky run 0.65 mm apart on this body and no geometry changes that.
GAUNTLET_PINCH = 0.002
GAUNTLET_COVERAGE = 0.90    # fraction of measured hand that must have steel outboard
GAUNTLET_MIN_GAP = 0.0005   # 1st-percentile air between skin and steel, metres
GAUNTLET_MAX_MEDIAN = 0.020

# The two quarter turns a donor built in this body's own hand space is carried
# through to reach the convention the sweep reads: fingers up +Z, thumb at +X.
# `tools/prep_gauntlet.py` shares this name rather than keeping its own copy.
HAND_DONOR_SPACE = (Matrix.Rotation(math.radians(-90), 4, "Z")
                    @ Matrix.Rotation(math.radians(90), 4, "X")).inverted()

# A boot stands on the floor, so the one thing that cannot be traded is the
# outer sole: seat it anywhere but the ground and the character floats or sinks.
# Everything else follows from that - the piece is sized on the foot, and the
# shaft is drawn up the shin afterwards the way a wand buys length along its own
# shaft, because nothing about a calf reads a few per cent of stretch.
# The donor is authored toe at -Y, heel at +Y, sole at -Z, which is the rest
# pose's own foot orientation, so it needs no rotation.
BOOT_TOP = -0.03            # top rim relative to the knee, metres; negative is below
BOOT_LEN_FROM = 1.00        # narrowest boot/foot length ratio worth trying
BOOT_LEN_TO = 1.60          # past this it is a clown's boot, whatever it measures
BOOT_LEN_STEP = 0.02
BOOT_MAX_STRETCH = 2.0      # past this the donor's straps visibly smear
BOOT_ANKLE_FROM = 0.30      # the ankle is the donor's waist, searched over this
BOOT_ANKLE_TO = 0.70        # stretch of its own height and no further
# A standing foot bears on the insole, so there is no air under it to measure
# and no outboard direction to fire a ray along: sole contact is left out of
# both gates. Which skin that is comes out of the body - a point is on the sole
# when the way out of its own limb points more DOWNWARD than sideways, so the
# test is a direction and not a height anybody chose. Half a right angle, not
# merely "downward", because a calf's way out is horizontal to within a degree
# or two either way and rounding it down would drop half the shin.
SOLE_CONTACT = -math.sqrt(0.5)
BOOT_COVERAGE = 0.90        # fraction of measured leg that must have steel outboard
BOOT_MIN_GAP = 0.0005       # 1st-percentile air between skin and steel, metres
BOOT_MAX_MEDIAN = 0.030


def bbox(points):
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return lo, hi, (hi - lo), (lo + hi) / 2


def group_points(mesh, group, min_w=0.5):
    gi = mesh.vertex_groups[group].index
    return [mesh.matrix_world @ v.co for v in mesh.data.vertices
            if sum(g.weight for g in v.groups if g.group == gi) >= min_w]


def bake_transform(obj):
    """glTF import leaves its Y-up to Z-up rotation on the object; push it into
    the mesh so vertex coordinates are world coordinates."""
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()


def bvh_of(obj, M=None):
    """A BVH over the datablock, optionally transformed.

    Built from raw polygons rather than `FromObject`: editing mesh vertices in
    place does not retag an evaluated object, so a BVH taken through the
    depsgraph during a search reads whatever the previous candidate left behind.
    """
    verts = [(M @ v.co) if M else v.co.copy() for v in obj.data.vertices]
    tris = []
    for poly in obj.data.polygons:
        idx = list(poly.vertices)
        for i in range(1, len(idx) - 1):
            tris.append((idx[0], idx[i], idx[i + 1]))
    return mathutils.bvhtree.BVHTree.FromPolygons(verts, tris)


def covered_laterally(bvh, pts, axis):
    """Fraction of `pts` with a surface outboard of them, measured sideways.

    `covered_fraction` fires each ray away from one centre, which is the right
    question about a skull and a meaningless one about a trunk: a ray from a low
    rib through the chest centroid runs UP the torso and leaves through the neck
    opening, so a plate that covers everything still scores about a third. A
    breastplate is asked the lateral question instead - from this rib, straight
    out from the spine at its own height, is there steel - and the vertical
    openings a cuirass is supposed to have stop deciding the answer.
    """
    hits = 0
    for p in pts:
        d = p - Vector((axis.x, axis.y, p.z))
        if d.length < 1e-6:
            hits += 1
            continue
        if bvh.ray_cast(p, d.normalized())[0] is not None:
            hits += 1
    return hits / len(pts)


def gap_profile(bvh, pts):
    """Distances from `pts` to a surface, as (1st percentile, median).

    The minimum is deliberately not the gate. One vertex grazing the steel is
    not a fault anybody can see, and on a scanned donor there is always one:
    chasing it to zero grows the helmet until it reads as a bucket. A patch of
    scalp coming through is what shows, and a percentile is what measures one.
    """
    ds = sorted(bvh.find_nearest(p)[3] for p in pts if bvh.find_nearest(p)[0] is not None)
    if not ds:
        return 0.0, 0.0
    return ds[max(0, len(ds) // 100)], ds[len(ds) // 2]


def covered_fraction(bvh, pts, centre):
    """Fraction of `pts` with surface outboard of them, along the head radius.

    `find_nearest` cannot say which side of the steel a point is on, so this is
    the test that a scalp point is actually under the helmet rather than merely
    close to it.
    """
    hits = 0
    for p in pts:
        d = p - centre
        if d.length < 1e-6:
            d = Vector((0, 0, 1))
        d = d.normalized()
        loc, nrm, _, _ = bvh.ray_cast(p + d * 1e-4, d)
        # An inner surface faces back at the head, an outer one faces away: a
        # ray that leaves through the outside of the shell says the point was
        # never under it, even though it hit steel.
        if loc is not None and nrm.dot(d) < 0:
            hits += 1
    return hits / len(pts) if pts else 0.0


def sizing(scale, stretch=1.0, axis=2):
    """Uniform scale, optionally drawn out along one of the donor's own axes."""
    s = [scale, scale, scale]
    s[axis] *= stretch
    return Matrix.Diagonal((s[0], s[1], s[2], 1.0))


def placed(obj, S, rot, translate):
    """Size a donor about its own centre, rotate it, then move it."""
    _, _, _, c = bbox([v.co for v in obj.data.vertices])
    return Matrix.Translation(translate) @ rot @ S @ Matrix.Translation(-c)


def seated(obj, S, rot, anchor, target):
    """Place a donor so its own `anchor` point lands on `target`."""
    _, _, _, c = bbox([v.co for v in obj.data.vertices])
    return placed(obj, S, rot, target - (rot.to_3x3() @ (S.to_3x3() @ (anchor - c))))


def waist(obj, axis, bands=12):
    """The narrowest cross-section along `axis`, as (position, radius).

    A carved haft is thinnest exactly where a hand is meant to close on it, so
    the grip is a measurement rather than a guess. Bands, not per-vertex: one
    stray vertex on the donor's axis would otherwise read as an infinitely thin
    waist wherever it happened to sit.
    """
    pts = [v.co for v in obj.data.vertices]
    lo, hi, dims, c = bbox(pts)
    others = [i for i in range(3) if i != axis]
    best = None
    for i in range(bands):
        a = lo[axis] + dims[axis] * i / bands
        b = lo[axis] + dims[axis] * (i + 1) / bands
        sel = [p for p in pts if a <= p[axis] <= b]
        if len(sel) < 8:
            continue
        r = max(math.hypot(p[others[0]] - c[others[0]], p[others[1]] - c[others[1]])
                for p in sel)
        if best is None or r < best[1]:
            best = ((a + b) / 2, r)
    if best is None:
        raise SystemExit("no measurable cross-section along the donor's long axis")
    return best


def band(points, axis, at, half):
    """Centre and radius of one slice across a limb or a donor.

    A seat lands on the middle of a cross-section, and a bone head is not it:
    the wrist joint sits above and behind the wrist's own skin, and seating a
    cuff on the joint puts the glove through the back of the hand.
    """
    sel = [p for p in points if abs(p[axis] - at) <= half]
    if len(sel) < 8:
        raise SystemExit(f"only {len(sel)} points in the slice at {at:.4f} along axis {axis}")
    centre = sum(sel, Vector((0, 0, 0))) / len(sel)
    others = [i for i in range(3) if i != axis]
    radius = max(math.hypot(p[others[0]] - centre[others[0]], p[others[1]] - centre[others[1]])
                 for p in sel)
    return centre, radius


def narrowest(obj, axis, low, high, bands=16):
    """The narrowest cross-section of a donor between two fractions of its run.

    `waist` searches the whole length, which finds a fingertip long before it
    finds a wrist and an open boot cuff before it finds an ankle. The join a
    piece is seated on lies in the middle of it, so the search is bounded to
    that stretch and each band is measured about its OWN centre rather than the
    donor's, or a bent shape reads as narrow wherever it happens to cross the
    axis.
    """
    pts = [v.co for v in obj.data.vertices]
    lo, _, dims, _ = bbox(pts)
    best = None
    for i in range(bands):
        a = lo[axis] + dims[axis] * (low + (high - low) * i / bands)
        b = lo[axis] + dims[axis] * (low + (high - low) * (i + 1) / bands)
        sel = [p for p in pts if a <= p[axis] <= b]
        if len(sel) < 8:
            continue
        centre, radius = band(sel, axis, (a + b) / 2, dims[axis])
        if best is None or radius < best[2]:
            best = ((a + b) / 2, centre, radius)
    if best is None:
        raise SystemExit(f"no measurable cross-section between {low} and {high} of the donor")
    return best


def nearest_on(segments, p):
    """The closest point to `p` on a set of bone segments."""
    best = None
    for head, tail in segments:
        axis = tail - head
        t = 0.0 if axis.length_squared < 1e-12 else max(
            0.0, min(1.0, (p - head).dot(axis) / axis.length_squared))
        q = head + axis * t
        d = (p - q).length
        if best is None or d < best[0]:
            best = (d, q)
    return best[1]


def outward(segments, p):
    """Which way is out of the limb, from one point of skin on it."""
    d = p - nearest_on(segments, p)
    return d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))


def covered_radially(bvh, pts, segments):
    """Fraction of `pts` with a surface outboard of them, out of their own limb.

    `covered_laterally` fires every ray away from one vertical axis, which is
    the right question about a trunk and a meaningless one about a limb that
    bends: a ray from the instep away from a leg axis runs along the foot rather
    than out of it, and a ray from a fingertip away from a wrist runs down the
    finger. The nearest bone this piece covers is the axis for that point, so
    the hand and the ankle are each measured out of themselves.

    Signed, the same way `covered_fraction` is: an inner surface faces back at
    the limb, so a ray that leaves through the OUTSIDE of the shell says the
    skin was never under it even though it hit steel.
    """
    hits = 0
    for p in pts:
        d = outward(segments, p)
        loc, nrm, _, _ = bvh.ray_cast(p + d * 1e-4, d)
        if loc is not None and nrm.dot(d) < 0:
            hits += 1
    return hits / len(pts) if pts else 0.0


def fit_head_shell(donor, body, rig, coverage=HELM_COVERAGE, max_median=HELM_MAX_MEDIAN,
                   back_shift=HELM_BACK_SHIFT, width_from=HELM_WIDTH_FROM, stretch=1.0,
                   stretch_axis=2):
    """Grow the shell until the skull above the brim is inside it, letting each
    size down onto the head until its lining meets the scalp.

    Seating alone cannot do it: the cavity has to be wide enough for the head
    before the crown can clear, and a donor scanned around somebody else's skull
    never is at the first ratio tried.

    The seat is searched, not read off the donor. A ray dropped through a shell
    reports whichever inner wall it crosses, and on a hood the wall under an
    off-axis ray is a side flare a head's height below the cowl's own crown: the
    hood then hung 190 mm over the skull. Contact with the scalp is the seat,
    and the same two numbers that accept a size measure it.
    """
    head_lo, head_hi, head_dims, head_c = bbox(group_points(body, "Head"))
    hp = [v.co for v in donor.data.vertices]
    _, d_hi, d_dims, d_c = bbox(hp)
    dome = [p for p in hp if p.z > d_c.z]
    dome_w = max(p.x for p in dome) - min(p.x for p in dome)
    dy = head_dims.y * back_shift
    covered = [p for p in group_points(body, "Head", 0.5)
               if p.z > head_c.z + head_dims.z * HELM_COVER_FROM]
    # Coverage is asked of the crown alone, because a brim is open in front of
    # it. Nothing is open at the BACK of a skull, and the shell has to come to
    # rest off the occiput as surely as off the crown: seated on the crown
    # alone, a cowl whose back wall is narrower than its dome comes down
    # through the back of the head.
    skull = covered + [p for p in group_points(body, "Head", 0.5)
                       if p.z > head_c.z and p.z <= head_c.z + head_dims.z * HELM_COVER_FROM
                       and p.y > head_c.y + head_dims.y * HELM_NAPE_FROM]

    def matrix(scale, z):
        return placed(donor, sizing(scale, stretch, stretch_axis), Matrix.Identity(4),
                      Vector((head_c.x, head_c.y + dy, z)))

    def clears(scale, z):
        bvh = bvh_of(donor, matrix(scale, z))
        return (gap_profile(bvh, skull)[0] >= HELM_MIN_GAP
                and covered_fraction(bvh, skull, head_c) >= coverage)

    def seat(scale):
        """The lowest this size sits with the whole cranium still inside it.

        Swept, not halved: a shell held over the head fails coverage exactly as
        one driven through it does, so clearance is true only in a band and a
        bisection started above it never enters.
        """
        z_scale = scale * (stretch if stretch_axis == 2 else 1.0)
        high = head_hi.z + d_dims.z * z_scale  # donor floor above the crown
        low = head_lo.z
        step = (high - low) / HELM_SEAT_SWEEP
        best = None
        for i in range(HELM_SEAT_SWEEP + 1):
            z = high - step * i
            if clears(scale, z):
                best = z
        if best is None:
            return high
        deep = best - step
        for _ in range(HELM_SEAT_STEPS):
            mid = (best + deep) / 2
            if clears(scale, mid):
                best = mid
            else:
                deep = mid
        return best

    tries = []
    ratio = width_from
    while ratio <= HELM_WIDTH_TO + 1e-9:
        scale = (head_dims.x * ratio) / dome_w
        z = seat(scale)
        bvh = bvh_of(donor, matrix(scale, z))
        p01 = gap_profile(bvh, skull)[0]
        med = gap_profile(bvh, covered)[1]
        cov = covered_fraction(bvh, skull, head_c)
        tries.append([round(ratio, 3), round(p01 * 1000, 2), round(med * 1000, 2),
                      round(cov, 4)])
        if cov >= coverage and p01 >= HELM_MIN_GAP and med <= max_median:
            top = z + (d_hi.z - d_c.z) * scale * (stretch if stretch_axis == 2 else 1.0)
            return matrix(scale, z), {
                "dome_width_ratio": round(ratio, 3), "scale": round(scale, 5),
                "skull_gap_p01_mm": round(p01 * 1000, 2),
                "skull_gap_median_mm": round(med * 1000, 2),
                "skull_covered": round(cov, 4),
                "skull_points": len(skull),
                "peak_above_crown_mm": round((top - head_hi.z) * 1000, 1),
                "forward_of_head_centre_mm": round(-dy * 1000, 1),
            }
        ratio += HELM_WIDTH_STEP
    raise SystemExit(f"no helm size both clears the skull and stays a helmet; {tries}")


def idle_pose(rig, bone, probes):
    """How the idle clip turns one bone, and where it puts a set of joints.

    Borrowed from `anim-library.glb` and handed straight back: the clip is
    imported, read at one frame and deleted again, and the rig leaves in its
    rest pose. A piece aimed in the rest pose is aimed at nothing anybody sees -
    the character is never in it - so the clip he stands in is the only frame
    that can say where a weapon points.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    borrowed = [o for o in bpy.data.objects if o not in before]
    if IDLE_CLIP not in bpy.data.actions:
        raise SystemExit(f"{ANIMS} carries no {IDLE_CLIP}")
    act = bpy.data.actions[IDLE_CLIP]
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = act
    for slot in act.slots:
        rig.animation_data.action_slot = slot
        break
    bpy.context.scene.frame_set(int(sum(act.frame_range) // 2))
    bpy.context.view_layer.update()
    pose = rig.pose.bones[bone].matrix
    M = (rig.matrix_world @ pose @ rig.data.bones[bone].matrix_local.inverted())
    posed = {n: (rig.matrix_world @ rig.pose.bones[n].head).copy() for n in probes}
    mats = {n: (rig.matrix_world @ rig.pose.bones[n].matrix
                @ rig.data.bones[n].matrix_local.inverted()) for n in probes}

    # Dropping the action does not undo the pose: every bone keeps whatever the
    # last evaluated frame left on it, and the export would ship a rig frozen
    # mid-idle.
    rig.animation_data_clear()
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    for o in borrowed:
        drop(o)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    rest = (rig.matrix_world @ rig.pose.bones[bone].matrix
            @ rig.data.bones[bone].matrix_local.inverted()).to_3x3()
    if max(abs(rest[i][j] - rig.matrix_world.to_3x3()[i][j])
           for i in range(3) for j in range(3)) > 1e-4:
        raise SystemExit(f"{bone} did not return to its rest pose after reading {IDLE_CLIP}")
    return M, posed, mats


def aimed(donor, axis_dir, R, aim):
    """Rotate a donor's own `axis_dir` onto whatever the clip turns into `aim`."""
    want = R.transposed() @ Vector(aim).normalized()
    return axis_dir.rotation_difference(want).to_matrix().to_4x4()


FINGERS = ("index", "middle", "ring", "pinky")
# Every bone the left fist is painted to. `hand_l` alone is the wrist band - the
# fingers carry their own groups, and they are what stands furthest out from the
# arm, so a shield cleared against `hand_l` has the knuckles through its face.
LEFT_HAND = ("hand_l",) + tuple(f"{f}_{i:02d}_l" for f in ("index", "middle", "ring", "pinky", "thumb")
                                for i in (1, 2, 3))
# Every joint down the four fingers, which curl around whatever the fist holds:
# their centroid in the posed hand is the middle of the hole, and no part of it
# has to be guessed from an open hand.
FIST_JOINTS = tuple(f"{f}_{i:02d}_r" for f in FINGERS for i in (1, 2, 3)) +     tuple(f"{f}_04_end_r" for f in FINGERS)


def fist_centre(posed):
    """Middle of the hole a closed fist makes, from the joints that make it.

    The rest hand is OPEN - fingers straight, thumb splayed - so the hole does
    not exist in it to be measured, and predicting one from the knuckle line is
    what put the shaft beside the fist rather than through it. The idle clip
    closes the fingers, so the hole is read where it actually exists: the four
    fingers wrap the shaft, and the centroid of their joints is its axis.
    """
    pts = [posed[n] for n in FIST_JOINTS]
    return sum(pts, Vector((0, 0, 0))) / len(pts)


def fit_hand_grip(donor, body, rig):
    """A shaft through the closed fist, gripped at its waist.

    Sized off the grip and not off the length: this donor's midpoint is its
    fattest knot, so centring it on the hand puts 9 cm of wood inside a fist
    that can close on about 4, and the knuckles come through it.
    """
    _, _, body_dims, _ = bbox([body.matrix_world @ v.co for v in body.data.vertices])
    hand_pts = group_points(body, "hand_r")
    _, _, d_dims, _ = bbox([v.co for v in donor.data.vertices])
    grip_z, grip_r = waist(donor, 2)
    scale = WAND_GRIP_DIA / (2 * grip_r)
    want = body_dims.z * WAND_LEN_RATIO
    stretch = min(WAND_MAX_STRETCH, want / (d_dims.z * scale))
    length = d_dims.z * scale * stretch
    # The donor's long axis is Z with its decorated end at +Z, so +Z is the way
    # the head points and the rotation is whatever carries it to WAND_AIM once
    # the idle clip has turned the hand.
    M, posed, _ = idle_pose(rig, "hand_r", FIST_JOINTS)
    rot = aimed(donor, Vector((0, 0, 1)), M.to_3x3(), WAND_AIM)
    _, _, _, d_c = bbox([v.co for v in donor.data.vertices])
    anchor = Vector((d_c.x, d_c.y, grip_z))
    # The hole is found in the pose and the mesh is authored in the rest one, so
    # it comes back through the same transform the clip applied.
    hole = M.inverted() @ fist_centre(posed)
    M = seated(donor, sizing(scale, stretch), rot, anchor, hole)
    p01, med = gap_profile(bvh_of(donor, M), hand_pts)
    return M, {
        "scale": round(scale, 5),
        "stretch": round(stretch, 4),
        "length_m": round(length, 4),
        "grip_diameter_mm": round(2 * grip_r * scale * 1000, 2),
        "grip_at_length_fraction": round((grip_z - (-d_dims.z / 2)) / d_dims.z, 3),
        "hole_m": [round(v, 4) for v in hole],
        "aim_world": list(WAND_AIM),
        "hand_gap_p01_mm": round(p01 * 1000, 2),
    }


def fit_forearm_strap(donor, body, rig):
    """A disc strapped to the outside of the forearm, hanging beside the hip.

    Aimed the same way a weapon is: against the clip he stands in, never the
    bind pose. A facing that is unarguable with the arm out to the side is
    turned by the shoulder rotation that drops it, and -Z becomes +X - the
    shield finishes edge-on, cutting across the hip. The face is put where a
    strapped shield looks in the idle instead, outward from his own left arm,
    and the disc rides one arm radius clear of the skin so the strap side never
    sinks into it.
    """
    _, _, body_dims, _ = bbox([body.matrix_world @ v.co for v in body.data.vertices])
    arm_pts = group_points(body, "lowerarm_l")
    hand_pts = group_points(body, "hand_l")
    _, _, d_dims, _ = bbox([v.co for v in donor.data.vertices])
    scale = (body_dims.z * BUCKLER_DIA_RATIO) / max(d_dims.x, d_dims.z)
    bone = rig.data.bones["lowerarm_l"]
    elbow = rig.matrix_world @ bone.head_local
    wrist = rig.matrix_world @ bone.tail_local

    M, _, mats = idle_pose(rig, "lowerarm_l", LEFT_HAND)
    face = Vector(BUCKLER_FACE).normalized()
    along = (M @ elbow).lerp(M @ wrist, BUCKLER_ALONG)
    # The arm is not the only thing behind the shield: the fist stands further
    # out than the forearm does. Every part is carried by the bone it is painted
    # to, in the pose, and the disc goes outboard of whichever reaches furthest.
    out = [M @ q for q in arm_pts]
    for b in LEFT_HAND:
        out += [mats[b] @ q for q in group_points(body, b)]
    reach = max((p - along).dot(face) for p in out)
    centre = M.inverted() @ (
        along + face * (reach + BUCKLER_GAP + d_dims.y * scale / 2))
    # The facing settles which way the disc looks; the roll settles where its
    # boss straps and its spokes run, which the donor authored for a different
    # arm than this one.
    roll = Matrix.Rotation(math.radians(BUCKLER_ROLL), 4, "Y")
    rot = aimed(donor, Vector((0, -1, 0)), M.to_3x3(), BUCKLER_FACE) @ roll
    M4 = placed(donor, sizing(scale), rot, centre)
    p01, med = gap_profile(bvh_of(donor, M4), arm_pts + hand_pts)
    return M4, {
        "scale": round(scale, 5),
        "diameter_m": round(body_dims.z * BUCKLER_DIA_RATIO, 4),
        "arm_reach_mm": round(reach * 1000, 2),
        "face_world": list(BUCKLER_FACE),
        "arm_gap_p01_mm": round(p01 * 1000, 2),
        "arm_gap_median_mm": round(med * 1000, 2),
    }



def arm_socket(rig, body, side):
    """The shoulder joint as a ball: the upper arm's median radius at its head.

    Measured off the skin the arm actually carries, so it scales with the body.
    """
    bone = rig.data.bones[f"upperarm_{side}"]
    head = rig.matrix_world @ bone.head_local
    axis = (rig.matrix_world @ bone.tail_local) - head
    if axis.length_squared < 1e-12:
        raise SystemExit(f"upperarm_{side} has no length to measure a socket along")
    radii = []
    for p in group_points(body, f"upperarm_{side}", 0.5):
        t = (p - head).dot(axis) / axis.length_squared
        if 0.0 <= t <= PLATE_SOCKET_ALONG:
            radii.append((p - (head + axis * t)).length)
    if not radii:
        raise SystemExit(f"upperarm_{side} carries no skin to measure a socket on")
    radii.sort()
    return head, radii[len(radii) // 2]


def donor_trunk(donor, lo, dims, centre, band=(PLATE_TRUNK_FROM, PLATE_TRUNK_TO)):
    """The suit's own torso: how wide it is, how deep, and where its middle is.

    Not an x-span of the vertices: on a suit with sleeves the widest points at
    chest height are the sleeves, and sizing the trunk on them leaves the plate
    inside the ribs. Not a connected run of vertex positions either - the donor's
    density is uneven and a run walked through it collapses wherever the wall is
    coarsely tessellated. It is a RAY out of the donor's own axis instead, four
    ways: the first thing a ray leaving the middle of the torso meets is the
    torso wall, whatever hangs outside it.

    The DEPTH and the seat come out of the same cast, at the widest height, and
    both are needed. A donor whose torso does not sit in the middle of its own
    bounding box - this one is carried 21 mm behind it by the fauld's back flare
    - is seated on that box with the breastplate grazing the sternum and the
    backplate four centimetres off the spine.
    """
    bvh = bvh_of(donor)
    best = None
    for i in range(PLATE_TRUNK_SAMPLES):
        f = band[0] + (band[1] - band[0]) * i / (PLATE_TRUNK_SAMPLES - 1)
        z = lo.z + dims.z * f
        origin = Vector((centre.x, centre.y, z))
        right = bvh.ray_cast(origin, Vector((1, 0, 0)))
        left = bvh.ray_cast(origin, Vector((-1, 0, 0)))
        front = bvh.ray_cast(origin, Vector((0, -1, 0)))
        back = bvh.ray_cast(origin, Vector((0, 1, 0)))
        if any(h[0] is None for h in (right, left, front, back)):
            continue
        span = right[0].x - left[0].x
        if best is None or span > best[1]:
            best = (z, span, back[0].y - front[0].y, (back[0].y + front[0].y) / 2)
    if best is None:
        raise SystemExit("no ray out of the donor's axis met its own wall between "
                         f"{band[0]} and {band[1]} of its height")
    return best


def body_crotch(body):
    """The lowest skin the pelvis carries, on the mid-plane: this body's crotch.

    A fauld is short when it clears this and long when it reaches the knee, so
    it is the landmark the hem is measured from. Weighted at half rather than a
    third, and taken near x = 0, because a thigh's own skin carries some pelvis
    everywhere and only the fork between the legs is pelvis alone.
    """
    pts = [p for p in group_points(body, "pelvis", 0.5) if abs(p.x) <= PLATE_CROTCH_HALF]
    if not pts:
        raise SystemExit("no pelvis skin on the mid-plane to measure a crotch at")
    return min(p.z for p in pts), len(pts)


def donor_belt(points, lo, dims, axis):
    """The donor's narrowest ring between its hem and its chest: the belt.

    A radius about the piece's own axis, not an x-span: the fauld flares in
    depth as well as across, and a belt is the one ring on the whole skirt that
    does neither.
    """
    best = None
    for i in range(PLATE_BELT_BANDS):
        a = lo.z + dims.z * (PLATE_BELT_FROM + (PLATE_BELT_TO - PLATE_BELT_FROM) * i / PLATE_BELT_BANDS)
        b = lo.z + dims.z * (PLATE_BELT_FROM + (PLATE_BELT_TO - PLATE_BELT_FROM) * (i + 1) / PLATE_BELT_BANDS)
        sel = [p for p in points if a <= p.z <= b]
        if len(sel) < 8:
            continue
        r = max(math.hypot(p.x - axis.x, p.y - axis.y) for p in sel)
        if best is None or r < best[1]:
            best = ((a + b) / 2, r)
    if best is None:
        raise SystemExit("no measurable ring between the donor's hem and its chest")
    return best


def drape_fauld(donor, M, hip_axis, hip_half, hem_world, hips):
    """Shorten and un-flare the suit's skirt, below its belt and nowhere else.

    Two edits in the donor's own coordinates, both pinned at the belt ring so
    the fit above it is untouched: a z map that draws the hem up to the target,
    and a taper toward the hip axis running from nothing at the belt to whatever
    the hem needs. `M` is the placement the sweep settled on and is NOT rebuilt
    afterwards - it maps donor space to the body, and these edits are in donor
    space, so the chest stays exactly where it was accepted.

    The taper is relaxed in steps if it costs the thighs their air: a skirt
    drawn in tight enough to look right and tight enough to walk through is not
    an improvement.
    """
    hp = [v.co for v in donor.data.vertices]
    d_lo, _, d_dims, _ = bbox(hp)
    axis = M.inverted() @ Vector((hip_axis.x, hip_axis.y, 0.0))
    belt_z, belt_r = donor_belt(hp, d_lo, d_dims, axis)
    belt_world = (M @ Vector((0.0, 0.0, belt_z))).z
    old_hem = (M @ Vector((0.0, 0.0, d_lo.z))).z
    if hem_world >= belt_world:
        raise SystemExit(f"the hem target {hem_world:.4f} is at or above the belt "
                         f"{belt_world:.4f}: there is no skirt to shorten")
    k = (belt_world - hem_world) / (belt_world - old_hem)
    if k < 1.0:
        for v in donor.data.vertices:
            if v.co.z < belt_z:
                v.co.z = belt_z - (belt_z - v.co.z) * k
        donor.data.update()
    hem_z = belt_z - (belt_z - d_lo.z) * k

    band = (belt_z - hem_z) * PLATE_HEM_BAND
    hem_pts = [v.co.copy() for v in donor.data.vertices if v.co.z <= hem_z + band]
    if not hem_pts:
        raise SystemExit("the shortened skirt has no hem band to measure a flare on")

    def world_radius(pts):
        return max(math.hypot((M @ p).x - hip_axis.x, (M @ p).y - hip_axis.y) for p in pts)

    hem_r = world_radius(hem_pts)
    target = hip_half + PLATE_FAULD_EASE
    wanted = min(1.0, target / hem_r)

    # Each try re-places the vertices from their un-tapered coordinates, so
    # relaxing the taper is a fresh placement and not a second squeeze.
    below = [(v, v.co.copy()) for v in donor.data.vertices if v.co.z < belt_z]
    tries = []
    factor = wanted
    while True:
        for v, co in below:
            t = min(1.0, (belt_z - co.z) / (belt_z - hem_z))
            scale = 1.0 + (factor - 1.0) * t
            v.co.x = axis.x + (co.x - axis.x) * scale
            v.co.y = axis.y + (co.y - axis.y) * scale
        donor.data.update()
        p01, med = gap_profile(bvh_of(donor, M), hips)
        tries.append([round(factor, 3), round(p01 * 1000, 2), round(med * 1000, 2)])
        if p01 >= PLATE_MIN_GAP or factor >= 1.0 - 1e-9:
            break
        factor = min(1.0, factor + PLATE_TAPER_STEP)
    if p01 < PLATE_MIN_GAP:
        raise SystemExit(f"no fauld taper clears the hips; factor, p01, median: {tries}")

    after = [v.co.copy() for v in donor.data.vertices if v.co.z <= hem_z + band]
    return {
        "belt_z": round(belt_world, 4),
        "belt_donor_radius": round(belt_r, 4),
        "hem_z_before": round(old_hem, 4),
        "hem_z_after": round((M @ Vector((0.0, 0.0, hem_z))).z, 4),
        "hem_length_scale": round(k, 4),
        "hem_below_crotch_mm": round(PLATE_HEM_BELOW_CROTCH * 1000, 1),
        "hem_radius_before_m": round(hem_r, 4),
        "hem_radius_after_m": round(world_radius(after), 4),
        "hip_half_width_m": round(hip_half, 4),
        "hem_taper": round(factor, 4),
        "taper_wanted": round(wanted, 4),
        "taper_tries": tries,
        "hip_gap_p01_mm": round(p01 * 1000, 2),
        "hip_gap_median_mm": round(med * 1000, 2),
        "hip_points": len(hips),
    }


def fit_plate_torso(donor, body, rig):
    """Grow the plate until the chest under it is inside it.

    The same signed test the helm uses, for the same reason: a nearest-surface
    distance reads a rib 2 mm through the steel and one 2 mm under it as the
    same number, so sizing on distance alone grows the shell until it reads as
    a barrel. Coverage asks the question that matters - is there steel outboard
    of this piece of skin - and the gap floor keeps the steel off it.

    Measured against the REST body. The skinning carries the plate into every
    clip, so a fit made in the idle would bake that frame's spine into the bind
    pose.

    The donor is placed whole, with one height scale and one swept width: this
    suit's front and back hems agree to within a few millimetres, so there is no
    out-of-level skirt for a second segment to draw down. `PLATE_HEM_LEVEL` says
    so out loud, because the fix for a donor that fails it is not a wider sweep.
    """
    # Two different sets, because they answer two different questions. The
    # RIBCAGE sizes the plate: it is the thing the steel has to go round. The
    # clavicles are only along for coverage - including them in the measurement
    # makes the "chest width" a shoulder span, about 10 cm wider than any chest,
    # and dividing that by the donor's waist sizes the plate as a barrel.
    ribs = []
    for b in ("spine_02", "spine_03"):
        ribs += group_points(body, b, 0.35)
    chest = list(ribs)
    for b in ("clavicle_l", "clavicle_r"):
        chest += group_points(body, b, 0.35)
    if not ribs:
        raise SystemExit("the body carries no chest weights to fit a plate against")
    _, _, chest_dims, _ = bbox(ribs)
    _, _, _, chest_c = bbox(chest)
    # The arm socket is open on a cuirass, the way the ears and nape are open on
    # a helm: skin inside the arm's own radius of the joint is not the plate's.
    sockets = [arm_socket(rig, body, side) for side in "lr"]
    sample = [p for p in chest if all((p - h).length >= r for h, r in sockets)]
    if not sample:
        raise SystemExit("the arm sockets swallowed every chest point")
    neck = rig.matrix_world @ rig.data.bones["neck_01"].head_local

    knee = sum((rig.matrix_world @ rig.data.bones[n].head_local).z
               for n in ("calf_l", "calf_r")) / 2

    hp = [v.co for v in donor.data.vertices]
    d_lo, d_hi, d_dims, d_c = bbox(hp)
    trunk_at, trunk_w, trunk_d, trunk_y = donor_trunk(donor, d_lo, d_dims, d_c)
    # Seated on the torso's own middle, not the bounding box's: see `donor_trunk`.
    collar = Vector((d_c.x, trunk_y, d_hi.z))
    top = neck.z + PLATE_COLLAR
    bottom = knee + PLATE_HEM_ABOVE_KNEE
    if bottom >= top:
        raise SystemExit("the knee is above the collar: there is no suit span to fill")
    high = (top - bottom) / d_dims.z

    # Seated with no rotation onto a body that faces -Y, so the donor's front is
    # its -Y side. Both hems are read and compared: a donor whose faces disagree
    # needs the two-segment skirt stretch the older cuirass had, and no width in
    # the sweep is a substitute for it.
    front_hem = min(p.z for p in hp if p.y <= d_lo.y + d_dims.y * PLATE_FRONT)
    back_hem = min(p.z for p in hp if p.y >= d_hi.y - d_dims.y * PLATE_FRONT)
    tilt = abs(front_hem - back_hem)
    if tilt > PLATE_HEM_LEVEL:
        raise SystemExit(f"this suit's hem is {tilt * 1000:.1f} mm out of level, past "
                         f"{PLATE_HEM_LEVEL * 1000:.0f}: it needs a skirt stretch, not a scale")

    # Reported, never gated. The sleeves are authored hanging at the donor's own
    # angle and the rest pose holds the arms straight out, so how much of the
    # upper arm ends up under steel is a fact about the donor's stance rather
    # than about the size the sweep picked.
    arms = []
    for side in "lr":
        arms += group_points(body, f"upperarm_{side}", 0.35)
    arm_segments = bones_of(rig, ("upperarm_l", "upperarm_r"))

    # What the skirt has to cover and clear, all of it read off this body: the
    # crotch sets the hem, and the hips set how far the hem may stand out.
    crotch, crotch_pts = body_crotch(body)
    hem_world = crotch - PLATE_HEM_BELOW_CROTCH
    hips = []
    for b in ("pelvis", "thigh_l", "thigh_r"):
        hips += group_points(body, b, 0.35)
    skirted = [p for p in hips if p.z >= hem_world]
    if not skirted:
        raise SystemExit("no hip or thigh skin above the hem to size a fauld against")
    _, _, _, hip_axis = bbox(skirted)
    hip_half = max(math.hypot(p.x - hip_axis.x, p.y - hip_axis.y) for p in skirted)

    def matrix(wide):
        S = Matrix.Diagonal((wide, wide, high, 1.0))
        return seated(donor, S, Matrix.Identity(4), collar,
                      Vector((chest_c.x, chest_c.y, top)))

    tries = []
    ratio = PLATE_WIDTH_FROM
    while ratio <= PLATE_WIDTH_TO + 1e-9:
        wide = (chest_dims.x * ratio) / trunk_w
        bvh = bvh_of(donor, matrix(wide))
        p01, med = gap_profile(bvh, sample)
        cov = covered_laterally(bvh, sample, chest_c)
        arm_cov = covered_radially(bvh, arms, arm_segments)
        tries.append([round(ratio, 3), round(p01 * 1000, 2), round(med * 1000, 2),
                      round(cov, 4), round(arm_cov, 4)])
        if cov >= PLATE_COVERAGE and p01 >= PLATE_MIN_GAP and med <= PLATE_MAX_MEDIAN:
            placement = matrix(wide)
            fauld = drape_fauld(donor, placement, hip_axis, hip_half, hem_world, skirted)
            return placement, {
                "crotch_z": round(crotch, 4),
                "crotch_points": crotch_pts,
                **fauld,
                "trunk_width_ratio": round(ratio, 3),
                "width_scale": round(wide, 5), "height_scale": round(high, 5),
                "suit_span_m": round(top - bottom, 4),
                "hem_z": round(bottom, 4),
                "hem_above_knee_mm": round(PLATE_HEM_ABOVE_KNEE * 1000, 1),
                "donor_hem_out_of_level_mm": round(tilt * 1000, 2),
                "chest_width_m": round(chest_dims.x, 4),
                "donor_trunk_width": round(trunk_w, 4),
                "donor_trunk_depth": round(trunk_d, 4),
                "donor_trunk_at": round(trunk_at, 4),
                "donor_trunk_offset_from_bbox_mm": round((trunk_y - d_c.y) * 1000, 2),
                "donor_depth_over_chest": round((trunk_d / trunk_w) / (chest_dims.y / chest_dims.x), 4),
                "chest_gap_p01_mm": round(p01 * 1000, 2),
                "chest_gap_median_mm": round(med * 1000, 2),
                "chest_covered": round(cov, 4),
                "chest_points": len(sample),
                "arm_socket_points": len(chest) - len(sample),
                "arm_socket_radius_mm": round(sockets[0][1] * 1000, 2),
                "collar_below_neck_mm": round(-PLATE_COLLAR * 1000, 1),
                "upper_arm_covered": round(arm_cov, 4),
                "upper_arm_points": len(arms),
            }
        ratio += PLATE_WIDTH_STEP
    raise SystemExit("no suit size both clears the chest and stays a cuirass; "
                     f"ratio, p01, median, chest, arms: {tries}")


def cut_donor(donor, M, co, no, region=None, lip=None):
    """Slice the donor on a WORLD plane and drop what lies on its `no` side.

    A bisect, not a vertex deletion: every face crossing the plane is split ON
    it, so the rim it leaves is one level edge. Deleting the vertices past the
    plane instead leaves the face row under it as a saw of half-triangles, the
    torn collar and pauldron tops this suit wore. `region` limits the cut to the
    faces with a corner inside it (the neck column, an arm cylinder); the plane
    is otherwise the whole figure's.

    `lip(p)` names, for a rim point, the direction the steel's thickness runs -
    into the neck, into the arm - and the open edge is extruded SUIT_RIM_LIP
    that way. A bare cut is a sheet of paper: from above the ring shows its own
    inside as a black band with a bright thread along the top, and a plate's
    rolled edge is what the eye expects there. Returns the vertices removed.
    """
    inv = M.inverted()
    bm = bmesh.new()
    bm.from_mesh(donor.data)
    bm.verts.ensure_lookup_table()
    before = len(bm.verts)
    for v in bm.verts:
        v.co = M @ v.co
    if region is None:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    else:
        faces = [f for f in bm.faces if any(region(v.co) for v in f.verts)]
        verts = {v for f in faces for v in f.verts}
        edges = {e for f in faces for e in f.edges}
        geom = list(verts) + list(edges) + faces
    cut = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no,
                                 clear_outer=True, clear_inner=False)
    removed = before - len(bm.verts)
    rim = [e for e in cut["geom_cut"] if isinstance(e, bmesh.types.BMEdge)
           and e.is_valid and e.is_boundary]
    if lip is not None and rim:
        uv = bm.loops.layers.uv.active
        ext = bmesh.ops.extrude_edge_only(bm, edges=rim)
        new_verts = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
        new_faces = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMFace)]
        for v in new_verts:
            v.co += lip(v.co).normalized() * SUIT_RIM_LIP
        for f in new_faces:
            # The lip faces the cut's open side, never the void under the plate.
            f.normal_update()
            if f.normal.dot(no) < 0:
                f.normal_flip()
            if uv is not None:
                for l in f.loops:
                    src = l.vert if l.vert not in new_verts else next(
                        e.other_vert(l.vert) for e in l.vert.link_edges
                        if e.other_vert(l.vert) not in new_verts)
                    l[uv].uv = next(sl[uv].uv.copy() for sf in src.link_faces
                                    if sf not in new_faces for sl in sf.loops if sl.vert is src)
    for v in bm.verts:
        v.co = inv @ v.co
    bm.to_mesh(donor.data)
    bm.free()
    donor.data.update()
    return removed


def symmetrise(donor, keep="+x"):
    """Replace one half of the donor across X with a reflection of the other.

    A decode is never symmetric, and a shell is fitted by its worst side: this
    hood's left rear sat a centimetre tighter than its right, and enclosing the
    skull there meant growing the whole cowl until it stood over the crown. The
    kept half is named per donor, because which side came out whole is a fact
    about that decode and nothing else: the coat's is at -X.
    """
    mod = donor.modifiers.new("symmetry", "MIRROR")
    mod.use_axis[0] = True
    mod.use_bisect_axis[0] = True
    mod.use_bisect_flip_axis[0] = keep == "-x"
    mod.use_mirror_merge = True
    mod.merge_threshold = DONOR_WELD
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(donor.evaluated_get(dg))
    donor.modifiers.remove(mod)
    old = donor.data
    donor.data = me
    bpy.data.meshes.remove(old)
    donor.data.name = donor.name
    return {"symmetrised": keep}


def weld_donor(donor, dist, openings):
    """Merge a decode's doubled vertices and close its pinholes.

    A TRELLIS shell arrives with three vertices per triangle and no shared edge,
    and its surface is cracked wherever the decode dropped a face: at play
    distance a crack is the void, and under two-sided steel it is a black
    shard. Boundary loops are walked round the face fan, so two loops touching
    at one vertex stay two loops, and every loop but the `openings` largest is
    fanned shut from its centroid. Loops that fail to close stay open.
    """
    bm = bmesh.new()
    bm.from_mesh(donor.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    used, loops = set(), []
    for e0 in bm.edges:
        if not e0.is_boundary or e0 in used:
            continue
        loop, v, e = [e0.verts[0]], e0.verts[1], e0
        ledges = [e0]
        used.add(e0)
        closed = True
        while v is not loop[0]:
            loop.append(v)
            f, nxt = e.link_faces[0], None
            for _ in range(64):
                side = [x for x in f.edges if v in x.verts and x is not e]
                if not side:
                    break
                e2 = side[0]
                if e2.is_boundary:
                    nxt = e2
                    break
                other = [g for g in e2.link_faces if g is not f]
                if not other:
                    break
                f, e = other[0], e2
            if nxt is None or nxt in used or len(loop) > 4096:
                closed = False
                break
            e = nxt
            used.add(e)
            ledges.append(e)
            v = e.other_vert(v)
        if closed and len(loop) >= 3:
            loops.append((loop, ledges))
    loops.sort(key=lambda pair: len(pair[0]), reverse=True)
    uv = bm.loops.layers.uv.active
    made, filled, fanned = [], 0, 0
    for loop, ledges in loops[openings:]:
        # A centroid fan is right for a pinhole and wrong for a tear. This
        # decode's back is torn twenty centimetres across, and a cone pulled to
        # that loop's centroid funnels into the chest: from behind it reads as a
        # chevron notch with the backing in it. A triangulation of the loop
        # itself stays on the surface, so it is tried first and the fan is what
        # is left for a rim too ragged to triangulate.
        edges = [e for e in ledges if e.is_valid and e.is_boundary]
        fan = bmesh.ops.holes_fill(bm, edges=edges, sides=0)["faces"] if edges else []
        if not fan and edges:
            grid = bmesh.ops.triangle_fill(bm, edges=edges, use_beauty=True,
                                           use_dissolve=False)["geom"]
            fan = [g for g in grid if isinstance(g, bmesh.types.BMFace)]
        if not fan:
            centre = bm.verts.new(sum((v.co for v in loop), Vector()) / len(loop))
            for i, a in enumerate(loop):
                b = loop[(i + 1) % len(loop)]
                try:
                    fan.append(bm.faces.new((a, b, centre)))
                except ValueError:
                    continue
            if not fan:
                bm.verts.remove(centre)
                continue
            fanned += 1
        filled += 1
        made += fan
        if uv is not None:
            # The cap wears its rim's texture: the centroid has no UV of its own
            # and a zero UV would drag one atlas corner across every hole.
            rim = next((l[uv].uv.copy() for v in loop if v.is_valid
                        for f in v.link_faces if f not in fan
                        for l in f.loops if l.vert is v), None)
            for f in fan:
                for l in f.loops:
                    if rim is not None:
                        l[uv].uv = rim
    made = [f for f in made if f.is_valid]
    # The walk stops at a non-manifold junction, so the cracks that run into one
    # are still open. With no opening to keep, whatever boundary is left is a
    # crack by definition.
    edged = 0
    if openings == 0:
        rest = [e for e in bm.edges if e.is_boundary]
        if rest:
            capped = bmesh.ops.holes_fill(bm, edges=rest, sides=0)["faces"]
            made += capped
            edged = len(capped)
    # The decode also leaves shards loose beside the shell - a few square
    # centimetres of steel standing off the pauldron as a torn fin. An island
    # this small is never a plate; the smallest real one on these donors is two
    # orders of magnitude bigger.
    scrapped = _drop_scrap_islands(bm, DONOR_SCRAP_AREA)
    made = [f for f in made if f.is_valid]
    if made:
        bmesh.ops.recalc_face_normals(bm, faces=made)
    bm.to_mesh(donor.data)
    bm.free()
    donor.data.update()
    return {"welded_verts": before - len(donor.data.vertices), "boundary_loops": len(loops),
            "holes_filled": filled, "holes_fanned": fanned, "holes_filled_edgewise": edged,
            "scrap_islands_dropped": scrapped[0], "scrap_island_faces": scrapped[1],
            "largest_scrap_cm2": scrapped[2],
            "openings_kept": [len(l) for l, _ in loops[:openings]]}


def _drop_scrap_islands(bm, max_area):
    """Delete every loose island under `max_area` of surface. Returns
    (islands, faces, largest kept-out island in cm2)."""
    seen, doomed, islands, biggest = set(), [], 0, 0.0
    for f0 in bm.faces:
        if f0 in seen:
            continue
        stack, comp = [f0], []
        seen.add(f0)
        while stack:
            f = stack.pop()
            comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        area = sum(f.calc_area() for f in comp)
        if area < max_area:
            doomed += comp
            islands += 1
            biggest = max(biggest, area)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
    return islands, len(doomed), round(biggest * 1e4, 2)


def smooth_donor(donor, body, angle):
    """Throw away the decode's per-face normals and shade the shell smooth.

    A decoded suit's stored normals sit a median 26 degrees off the smooth
    normal of its own welded surface, so every plate renders as a field of
    flat triangles whatever the mesh does. Edges bent past `angle` stay sharp:
    those are the lame steps and the plate rims, and smoothing across them
    melts a harness into a wetsuit.

    The decode's windings are a coin toss face by face, and a smooth normal
    averaged over them lights two fifths of the trunk from inside. A recalc
    across the shell cannot settle them either: this steel has an inner and an
    outer skin joined along its cracks, and the propagation flips at every
    join. Each face is instead turned to agree with the skin normal at the
    nearest point of the body it is worn on - the one direction every plate,
    lame and inner skin agrees on. The normal, not the offset to that point:
    steel sunk under the hidden skin (shoulder tops, knees) would turn inward.
    The donor is in world space by now, as is the body.
    """
    me = donor.data
    if "custom_normal" in me.attributes:
        me.attributes.remove(me.attributes["custom_normal"])
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    skin = bvh_of(body, body.matrix_world)
    flipped = 0
    for f in bm.faces:
        centre = f.calc_center_median()
        near, skin_normal = skin.find_nearest(centre)[:2]
        if near is not None and f.normal.dot(skin_normal) < 0:
            f.normal_flip()
            flipped += 1
    bm.normal_update()
    sharp = 0
    for e in bm.edges:
        e.smooth = True
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > angle:
            e.smooth = False
            sharp += 1
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.update()
    return {"sharp_edges": sharp, "faces_turned_out": flipped}


def taper_sleeves(donor, M, body, rig):
    """PARKED - the shipping suit is cut at the pauldron, so no sleeve survives.

    Draw the harness's arms in to the length this body's arms have.

    One sweep sizes the whole figure off the trunk, and a generated figure's
    arms are their own proportion: this one reaches 44 % past the fingertips of
    the body it is worn on. Scaling the suit down until the arms fit would leave
    a breastplate inside the ribs, so the arms are corrected on their own.

    An x map pinned at the SHOULDER, the same shape of edit `drape_fauld` makes
    of a skirt pinned at its belt: nothing inboard of the joint moves, so the
    pauldron stays on the shoulder it was placed on, and everything outboard is
    drawn in by one factor, which shortens the sleeve without thinning it -
    the arm's long axis is x in a rest pose that holds it straight out.

    The sleeve is picked out by the ARM'S OWN AXIS and not by a height. An arm
    is a cylinder about that axis and half of it hangs BELOW the armpit, so a
    height gate shears the sleeve down its length and moves only the top of it.

    Done in world space and mapped back, so the pin and the target are both rig
    measurements. `M` is not rebuilt: this is an edit in donor coordinates and
    the trunk it already accepted stays exactly where it was.
    """
    inv = M.inverted()
    joint = rig.matrix_world @ rig.data.bones["upperarm_l"].head_local
    shoulder = abs(joint.x)
    fingertip = abs((rig.matrix_world @ rig.data.bones["hand_l"].tail_local).x)
    bound = arm_socket(rig, body, "l")[1] * SUIT_SLEEVE_RADIUS
    if fingertip <= shoulder:
        raise SystemExit("this body's fingertips are inboard of its own shoulder")

    def sleeve(p):
        return (abs(p.x) > shoulder
                and math.hypot(p.y - joint.y, p.z - joint.z) <= bound)

    world = [M @ v.co for v in donor.data.vertices]
    out = [p for p in world if sleeve(p)]
    if not out:
        raise SystemExit(f"no harness steel lies outboard of the shoulder at "
                         f"{shoulder:.4f} m within {bound:.4f} m of its axis: no sleeves")
    reach = max(abs(p.x) for p in out)
    factor = (fingertip - shoulder) / (reach - shoulder)
    if factor >= 1.0:
        return {"sleeve_factor": 1.0, "sleeve_reach_m": round(reach, 4),
                "sleeve_target_m": round(fingertip, 4),
                "sleeve_reach_after_m": round(reach, 4),
                "sleeve_points": len(out)}

    for v, p in zip(donor.data.vertices, world):
        if not sleeve(p):
            continue
        side = 1.0 if p.x > 0.0 else -1.0
        v.co = inv @ Vector((side * (shoulder + (abs(p.x) - shoulder) * factor),
                             p.y, p.z))
    donor.data.update()
    after = max(abs((M @ v.co).x) for v in donor.data.vertices)
    return {
        "sleeve_factor": round(factor, 4),
        "sleeve_pin_x": round(shoulder, 4),
        "sleeve_axis_bound_m": round(bound, 4),
        "sleeve_points": len(out),
        "sleeve_reach_m": round(reach, 4),
        "sleeve_target_m": round(fingertip, 4),
        "sleeve_reach_after_m": round(after, 4),
    }


def lift_gorget(donor, M, body, rig):
    """PARKED - the shipping suit wears a SHORT gorget ring with bare neck above
    it, cut in `fit_plate_suit`, so no collar is drawn up to a helm rim.

    Draw the collar rim up until it meets a helmet, pinned at the neck's base.

    A z map with the same shape as `taper_sleeves`' x map: nothing at or below
    the base of the neck moves, so the breastplate the sweep just sized stays
    where it was sized, and the collar column above it is stretched by one
    factor. The column is picked out by the neck's OWN axis, so the pauldrons
    standing 21 cm out to each side are never part of it.

    Run AFTER the head cut, or the donor's own helm is still standing in the
    column and it, not the collar, is what the top reads.
    """
    inv = M.inverted()
    base = rig.matrix_world @ rig.data.bones["neck_01"].head_local
    skull = (rig.matrix_world @ rig.data.bones["Head"].head_local).z
    bound = limb_radius(rig, body, "neck_01", 1.0)[1] * SUIT_GORGET_RADIUS
    target = skull + (skull - base.z) * SUIT_GORGET_LIFT

    def collar(p):
        return p.z > base.z and math.hypot(p.x - base.x, p.y - base.y) <= bound

    def sector(p):
        a = math.atan2(p.y - base.y, p.x - base.x) / (2 * math.pi) % 1.0
        return a * SUIT_GORGET_SECTORS

    world = [M @ v.co for v in donor.data.vertices]
    up = [p for p in world if collar(p)]
    if not up:
        raise SystemExit(f"no harness steel stands above the neck base within "
                         f"{bound:.4f} m of its axis: no collar to lift")
    # Each sector carries its own rim, so a back that starts 40 mm low is lifted
    # 40 mm further than a throat that already reaches the jaw.
    raw = [base.z] * SUIT_GORGET_SECTORS
    for p in up:
        i = int(sector(p)) % SUIT_GORGET_SECTORS
        raw[i] = max(raw[i], p.z)
    if min(raw) <= base.z:
        raise SystemExit(f"the collar leaves a sector of the neck bare: {raw}")
    # Smoothed round the ring before any factor is taken from it. A rim that
    # dips in one sector and not its neighbours turns into a spike otherwise:
    # the low sector is stretched twice as hard as the steel it is welded to.
    n = SUIT_GORGET_SECTORS
    tops = [(raw[(i - 1) % n] + raw[i] * 2 + raw[(i + 1) % n]) / 4 for i in range(n)]
    factors = [min((target - base.z) / (t - base.z), SUIT_GORGET_MAX) for t in tops]

    def factor_at(p):
        # Between the two nearest sector centres, or the rim steps every 22.5.
        s = sector(p) - 0.5
        i = math.floor(s)
        t = s - i
        return (factors[int(i) % SUIT_GORGET_SECTORS] * (1 - t)
                + factors[int(i + 1) % SUIT_GORGET_SECTORS] * t)

    for v, p in zip(donor.data.vertices, world):
        if collar(p):
            k = max(factor_at(p), 1.0)
            v.co = inv @ Vector((p.x, p.y, base.z + (p.z - base.z) * k))
    donor.data.update()
    return {
        "gorget_factor_min": round(min(factors), 4),
        "gorget_factor_max": round(max(factors), 4),
        "gorget_pin_z": round(base.z, 4),
        "gorget_axis_bound_m": round(bound, 4),
        "gorget_points": len(up),
        "gorget_rim_low_m": round(min(tops), 4),
        "gorget_rim_high_m": round(max(tops), 4),
        "gorget_target_m": round(target, 4),
        "gorget_top_after_m": round(max((M @ v.co).z for v in donor.data.vertices), 4),
    }


def trim_collar_flare(donor, M, body, rig, shoulder):
    """Drop the collar steel that stands off the trapezius instead of on it.

    The decode tears the collar into flaps between the throat ring and the
    pauldron cap, and a flap keeps the angle it was torn at: from behind they
    are a stack of fins standing over the shoulder. A collar lies ON the
    trapezius, so steel more than `SUIT_FLARE_PROUD` off that skin, inboard of
    the shoulder joint, is a flap and not a plate. What it leaves bare is the
    collar region, which `build_gorget` closes with its own plate.
    """
    skin = bvh_of(body, body.matrix_world)
    floor = shoulder.z - SUIT_FLARE_BELOW_SHOULDER
    bm = bmesh.new()
    bm.from_mesh(donor.data)
    doomed = []
    for f in bm.faces:
        p = M @ f.calc_center_median()
        if p.z > floor and abs(p.x) < abs(shoulder.x) \
                and skin.find_nearest(p)[3] > SUIT_FLARE_PROUD:
            doomed.append(f)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(donor.data)
    bm.free()
    donor.data.update()
    return len(doomed)


def inflate_pauldrons(donor, M, body, rig, per_vertex=False):
    """Grow each shoulder cap about the arm's own axis until the deltoid is in.

    The suit is sized on the trunk, and a generated figure's shoulder girth is
    its own: this donor's cap sits 92 mm off the arm axis where this body's
    deltoid reaches 105 mm, so the arm comes through the plate. One radial scale
    about that axis keeps the cap's shape and its seat on the shoulder - it
    grows, it does not move.

    The factor is read sector by sector round the axis and the worst one is
    used. A single figure over the whole cap says nothing: this cap reaches
    170 mm at its outer flare and 92 mm over the deltoid, and the deltoid is the
    azimuth the arm comes through. A sector the cap does not reach at all is the
    arm hole, which is open on every harness ever made, so it is passed over.

    One factor for the whole cap, and never a per-vertex push out to the skin:
    the cap dips towards the axis where it wraps the arm hole, and pushing those
    vertices alone tears a hole in the plate around them.

    Ramped in over the first of the cap's span and pinned at the shoulder joint,
    so the plate does not tear away from the breastplate it overlaps.

    Run AFTER the sleeve cut: growing first would carry sleeve steel outside the
    cut's own axis cylinder and leave it hanging past the arm.

    `per_vertex` is the soft-suit rule: a cloth sleeve is a tube round the arm
    with no arm hole to dip into, so each vertex under its sector's skin is
    pushed out to that skin alone and the rest of the sleeve keeps its shape.
    One factor over a thin sleeve balloons it into a lobe of fins.
    """
    inv = M.inverted()
    joint = rig.matrix_world @ rig.data.bones["upperarm_l"].head_local
    root = abs(joint.x)
    bound = arm_socket(rig, body, "l")[1] * SUIT_SLEEVE_RADIUS

    def radius(p):
        return math.hypot(p.y - joint.y, p.z - joint.z)

    def cap(p):
        return abs(p.x) > root and radius(p) <= bound

    def sector(p):
        a = math.atan2(p.z - joint.z, p.y - joint.y) / (2 * math.pi) % 1.0
        return int(a * SUIT_PAULDRON_SECTORS) % SUIT_PAULDRON_SECTORS

    world = [M @ v.co for v in donor.data.vertices]
    steel = [p for p in world if cap(p)]
    if not steel:
        raise SystemExit("no shoulder cap outboard of the joint to grow")
    edge = max(abs(p.x) for p in steel)
    skin = [body.matrix_world @ v.co for v in body.data.vertices
            if root < abs((body.matrix_world @ v.co).x) <= edge]
    if not skin:
        raise SystemExit("no arm skin under the cap to measure it against")

    skin_r = [0.0] * SUIT_PAULDRON_SECTORS
    steel_r = [0.0] * SUIT_PAULDRON_SECTORS
    for q in skin:
        i = sector(q)
        skin_r[i] = max(skin_r[i], radius(q))
    for q in steel:
        i = sector(q)
        steel_r[i] = max(steel_r[i], radius(q))
    ratios = [(skin_r[i] + SUIT_PAULDRON_STANDOFF) / steel_r[i]
              for i in range(SUIT_PAULDRON_SECTORS)
              if steel_r[i] > 0.0 and skin_r[i] > 0.0]
    if not ratios:
        raise SystemExit("no sector round the arm carries both skin and cap")
    k = min(max(ratios), SUIT_PAULDRON_MAX)
    if k <= 1.0:
        return {"pauldron_scale": 1.0,
                "pauldron_worst_sector_ratio": round(max(ratios), 4)}
    ramp = (edge - root) * SUIT_PAULDRON_RAMP
    pushed = 0
    for v, p in zip(donor.data.vertices, world):
        if not cap(p):
            continue
        t = min((abs(p.x) - root) / ramp, 1.0) if ramp > 0 else 1.0
        if per_vertex:
            r = radius(p)
            want = skin_r[sector(p)] + SUIT_PAULDRON_STANDOFF
            if r < 1e-6 or r >= want:
                continue
            f = 1.0 + (min(want / r, SUIT_PAULDRON_MAX) - 1.0) * t
            pushed += 1
        else:
            f = 1.0 + (k - 1.0) * t
        v.co = inv @ Vector((p.x, joint.y + (p.y - joint.y) * f,
                             joint.z + (p.z - joint.z) * f))
    donor.data.update()
    return {
        "pauldron_per_vertex": per_vertex,
        "pauldron_pushed_points": pushed,
        "pauldron_scale": round(k, 4),
        "pauldron_worst_sector_ratio": round(max(ratios), 4),
        "pauldron_sectors_covered": len(ratios),
        "pauldron_root_x_m": round(root, 4),
        "pauldron_edge_x_m": round(edge, 4),
        "pauldron_ramp_m": round(ramp, 4),
        "pauldron_points": len(steel),
    }


def fit_plate_suit(donor, body, rig, trunk_band=(PLATE_TRUNK_FROM, PLATE_TRUNK_TO), soft=False):
    """Place a whole harness on the body, then cut it back to the chest slot.

    The donor is a complete figure - helm, pauldrons, sleeves, gauntlets, fauld,
    legs and sabatons in one shell - so it is sized against the WHOLE body
    rather than against a chest span: two figures of the same height correspond
    limb for limb, and any other anchor would land the fauld and the knees
    somewhere the body does not have them. The girth still comes from the same
    chest sweep the cuirass used, because height says nothing about how wide a
    trunk is.

    Then three cuts, all read off the rig: everything above the skull base is a
    helm, everything outboard of the pauldron is an arm, everything below an
    ankle is a boot. Those are their own slots and their own items, so the chest
    may not draw them. What is left is trunk, pauldrons, fauld and legs, and it
    REPLACES the torso and both legs - see `BODY_REGIONS`.

    Measured against the REST body, for the reason `fit_plate_torso` gives.
    """
    ribs = []
    for b in ("spine_02", "spine_03"):
        ribs += group_points(body, b, 0.35)
    chest = list(ribs)
    for b in ("clavicle_l", "clavicle_r"):
        chest += group_points(body, b, 0.35)
    if not ribs:
        raise SystemExit("the body carries no chest weights to fit a suit against")
    _, _, chest_dims, _ = bbox(ribs)
    _, _, _, chest_c = bbox(chest)
    sockets = [arm_socket(rig, body, side) for side in "lr"]
    # Ribs only. The clavicles were in the cuirass's coverage sample because the
    # shoulder skin beside them was drawn; a lateral ray from the spine at that
    # height leaves through the arm hole a real harness has, so on a suit that
    # hides the arms they only ask a question with no right answer.
    sample = [p for p in ribs if all((p - h).length >= r for h, r in sockets)]
    if not sample:
        raise SystemExit("the arm sockets swallowed every rib point")

    body_pts = [body.matrix_world @ v.co for v in body.data.vertices]
    b_lo, b_hi, b_dims, _ = bbox(body_pts)

    # A harness donor carries no head, so its topmost steel is a collar rim and
    # a collar rim stands at the skull base - which is also where the head cut
    # runs. Sole to skull base, therefore, not sole to crown: a crown seat adds
    # a head's height to the trunk, and the shoulders ride up with it (measured
    # on this donor: 6860 vertices above the skull base and the pauldrons over
    # the ears).
    head_z = (rig.matrix_world @ rig.data.bones["Head"].head_local).z
    hp = [v.co for v in donor.data.vertices]
    d_lo, d_hi, d_dims, d_c = bbox(hp)
    trunk_at, trunk_w, trunk_d, trunk_y = donor_trunk(donor, d_lo, d_dims, d_c, trunk_band)
    high = (head_z - b_lo.z) / d_dims.z
    # The donor's own trunk centre carries the horizontal seat, for the reason
    # `donor_trunk` gives: a fauld flared behind the back drags the bounding box
    # off the sternum.
    crown = Vector((d_c.x, trunk_y, d_hi.z))

    arms = []
    for side in "lr":
        arms += group_points(body, f"upperarm_{side}", 0.35)
    arm_segments = bones_of(rig, ("upperarm_l", "upperarm_r"))

    def matrix(wide):
        S = Matrix.Diagonal((wide, wide, high, 1.0))
        return seated(donor, S, Matrix.Identity(4), crown,
                      Vector((chest_c.x, chest_c.y, head_z)))

    # The sweep is judged on the RIBS alone, and only on coverage and girth. The
    # cuirass was also held off the skin by a gap floor, because skin it touched
    # was skin that showed; this suit replaces the trunk, the arms and the legs,
    # so there is no longer any drawn surface under it to push through. What is
    # still drawn beside the steel - the neck and the head - is measured after
    # the cuts, where the helm is no longer in the way of the question.
    tries = []
    ratio = PLATE_WIDTH_FROM
    placement = None
    while ratio <= PLATE_WIDTH_TO + 1e-9:
        wide = (chest_dims.x * ratio) / trunk_w
        bvh = bvh_of(donor, matrix(wide))
        p01, med = gap_profile(bvh, sample)
        cov = covered_laterally(bvh, sample, chest_c)
        arm_cov = covered_radially(bvh, arms, arm_segments)
        tries.append([round(ratio, 3), round(p01 * 1000, 2), round(med * 1000, 2),
                      round(cov, 4), round(arm_cov, 4)])
        if cov >= PLATE_COVERAGE and med <= PLATE_MAX_MEDIAN:
            placement = matrix(wide)
            break
        ratio += PLATE_WIDTH_STEP
    if placement is None:
        raise SystemExit("no suit size both covers the ribs and stays a harness; "
                         f"ratio, p01, median, ribs, arms: {tries}")

    # The helm. `Head` starts at the skull base, so the gorget below the plane
    # is kept and the neck stays inside it. The seat already puts the collar rim
    # on that plane, so this takes only what flares past it, and may take
    # nothing.
    cut_head = cut_donor(donor, placement, Vector((0, 0, head_z)), Vector((0, 0, 1)))

    # The gorget. A short ring off the base of the neck, with the throat bare
    # above it: a collar carried all the way to a helm rim is a steel tube round
    # a neck. The rim is one plane over the whole trunk and only the pauldrons
    # are spared: cutting the neck's own column alone left the collar's
    # shoulders standing past the rim on both sides, a castellated step from
    # behind. The sleeve cylinders are measured first because they gate this.
    neck = rig.matrix_world @ rig.data.bones["neck_01"].head_local
    collar_bound = limb_radius(rig, body, "neck_01", 1.0)[1] * SUIT_GORGET_CUT_RADIUS

    def in_collar(p):
        return math.hypot(p.x - neck.x, p.y - neck.y) <= collar_bound

    shoulder = rig.matrix_world @ rig.data.bones["upperarm_l"].head_local
    bound = arm_socket(rig, body, "l")[1] * SUIT_SLEEVE_RADIUS

    def in_sleeve(p):
        return math.hypot(p.y - shoulder.y, p.z - shoulder.z) <= bound

    # Only the cap itself is spared, the steel OUTBOARD of the shoulder joint:
    # the arm cylinder reaches in to the neck, and the collar flare inside it
    # stood up beside the jaw as a spike the plane never touched.
    cap_x = abs(shoulder.x) - SUIT_CAP_INBOARD
    ring_bound = limb_radius(rig, body, "neck_01", 1.0)[1] * SUIT_GORGET_RADIUS

    def in_ring(p):
        return math.hypot(p.x - neck.x, p.y - neck.y) <= ring_bound

    def is_cap(p):
        return in_sleeve(p) and abs(p.x) > cap_x

    # Two heights. The throat ring is cut low, so the neck is bare above it;
    # the collar steel OUTSIDE that column is cut higher, so it still covers the
    # trapezius slope between the ring and the pauldrons when seen from above -
    # one low plane left the shoulders bare, one high plane stood the ring up
    # the throat. The spike beside the jaw rose past both. Ahead of the neck
    # axis (the face looks down -Y) the ring's plane falls forward, or the sides
    # of the collar's front notch stand out past the throat as two fins.
    rim = neck.z + SUIT_GORGET_HEIGHT
    lip = lambda p: Vector((neck.x - p.x, neck.y - p.y, 0))
    ring = lambda p: in_ring(p) and not is_cap(p)
    cut_gorget = cut_donor(donor, placement, Vector((0, neck.y, rim)),
                           Vector((0, -SUIT_THROAT_FALL, 1)).normalized(),
                           region=lambda p: ring(p) and p.y < neck.y, lip=lip)
    cut_gorget += cut_donor(donor, placement, Vector((0, 0, rim)), Vector((0, 0, 1)),
                            region=lambda p: ring(p) and p.y >= neck.y, lip=lip)
    cut_gorget += cut_donor(donor, placement, Vector((0, 0, neck.z + SUIT_COLLAR_HEIGHT)),
                            Vector((0, 0, 1)),
                            region=lambda p: not in_ring(p) and not is_cap(p), lip=lip)
    column = [p.z for p in (placement @ v.co for v in donor.data.vertices)
              if in_collar(p)]
    if not column:
        raise SystemExit("the gorget cut took the whole collar column")

    # The sabatons. Both ankles, averaged, because the rest pose stands level
    # and a per-side plane would cut the two shins at different heights.
    ankle_z = sum((rig.matrix_world @ rig.data.bones[n].head_local).z
                  for n in ("foot_l", "foot_r")) / 2
    cut_feet = cut_donor(donor, placement, Vector((0, 0, ankle_z)), Vector((0, 0, -1)))

    # The sleeves. Body armour ends at the pauldron, so everything outboard of a
    # plane part way down the upper arm goes with the arm it was drawn for. The
    # plane is paired with the arm's own axis cylinder, or the same cut takes
    # the fauld hanging 40 cm below it. One pass for both arms: the rest pose is
    # symmetric about x and the donor was seated on it.
    elbow = rig.matrix_world @ rig.data.bones["lowerarm_l"].head_local
    edge = abs(shoulder.x) + abs(elbow.x - shoulder.x) * SUIT_PAULDRON_DROP
    cut_arms = sum(cut_donor(donor, placement, Vector((s * edge, 0, 0)), Vector((s, 0, 0)),
                             region=in_sleeve,
                             lip=lambda p: Vector((0, shoulder.y - p.y, shoulder.z - p.z)))
                   for s in (1, -1))
    cut_flare = 0 if soft else trim_collar_flare(donor, placement, body, rig, shoulder)
    caps = inflate_pauldrons(donor, placement, body, rig, per_vertex=soft)
    if not cut_feet or not cut_arms:
        raise SystemExit(f"a harness cut removed nothing - feet {cut_feet}, arms "
                         f"{cut_arms}: this donor is not a whole figure")

    # The one clipping question left. Everything the suit closes is switched off
    # under it, so the only skin that can come through steel is the throat and
    # the jaw standing in the gorget - and that is asked of the CUT donor,
    # because the helm this shell arrived with encloses the head by design.
    drawn = []
    for b in ("neck_01", "Head"):
        drawn += group_points(body, b, 0.5)
    neck_p01, neck_med = gap_profile(bvh_of(donor, placement), drawn)
    if neck_p01 < PLATE_MIN_GAP:
        raise SystemExit(f"the gorget sits {neck_p01 * 1000:.2f} mm off the neck, under "
                         f"{PLATE_MIN_GAP * 1000:.1f}: the collar needs raising, not scaling")

    return placement, {
        "gorget_height_m": round(max(column) - neck.z, 4),
        "gorget_rim_z": round(max(column), 4),
        "gorget_pin_z": round(neck.z, 4),
        "gorget_axis_bound_m": round(collar_bound, 4),
        "cut_verts_gorget": cut_gorget,
        "cut_faces_collar_flare": cut_flare,
        **caps,
        "neck_gap_p01_mm": round(neck_p01 * 1000, 2),
        "neck_gap_median_mm": round(neck_med * 1000, 2),
        "neck_points": len(drawn),
        "trunk_width_ratio": round(ratio, 3),
        "width_scale": round((chest_dims.x * ratio) / trunk_w, 5),
        "height_scale": round(high, 5),
        "body_height_m": round(b_dims.z, 4),
        "chest_width_m": round(chest_dims.x, 4),
        "donor_trunk_width": round(trunk_w, 4),
        "donor_trunk_depth": round(trunk_d, 4),
        "donor_trunk_at": round(trunk_at, 4),
        "donor_trunk_offset_from_bbox_mm": round((trunk_y - d_c.y) * 1000, 2),
        "chest_gap_p01_mm": round(tries[-1][1], 2),
        "chest_gap_median_mm": round(tries[-1][2], 2),
        "chest_covered": round(tries[-1][3], 4),
        "chest_points": len(sample),
        "arm_socket_points": len(chest) - len(sample),
        "arm_socket_radius_mm": round(sockets[0][1] * 1000, 2),
        "upper_arm_covered": round(tries[-1][4], 4),
        "upper_arm_points": len(arms),
        "cut_head_z": round(head_z, 4),
        "cut_ankle_z": round(ankle_z, 4),
        "cut_verts_head": cut_head,
        "cut_verts_feet": cut_feet,
        "cut_verts_arms": cut_arms,
        "cut_pauldron_edge_x": round(edge, 4),
        "cut_pauldron_bound_m": round(bound, 4),
        "size_tries": tries,
    }


# A coat's skirt is split down the front, so at the harness's trunk band a ray
# out of the axis leaves through the split and seats the coat on its trousers,
# six centimetres behind the chest. A soft suit is measured at chest height.
SOFT_TRUNK_BAND = (0.58, 0.70)


def fit_soft_suit(donor, body, rig):
    return fit_plate_suit(donor, body, rig, SOFT_TRUNK_BAND, soft=True)


def bones_of(rig, names):
    """Each bone as a world-space segment."""
    return [(rig.matrix_world @ rig.data.bones[n].head_local,
             rig.matrix_world @ rig.data.bones[n].tail_local) for n in names]


def limb_radius(rig, body, bone, along):
    """A joint as a ball: the median skin radius down the first `along` of its
    own bone, the same measurement `arm_socket` makes of a shoulder."""
    b = rig.data.bones[bone]
    head = rig.matrix_world @ b.head_local
    axis = (rig.matrix_world @ b.tail_local) - head
    if axis.length_squared < 1e-12:
        raise SystemExit(f"{bone} has no length to measure a radius along")
    radii = []
    for p in group_points(body, bone, 0.35):
        t = (p - head).dot(axis) / axis.length_squared
        if 0.0 <= t <= along:
            radii.append((p - (head + axis * t)).length)
    if not radii:
        raise SystemExit(f"{bone} carries no skin to measure a radius on")
    radii.sort()
    return head, radii[len(radii) // 2]


def surface_headroom(bm, rings=2, reach=0.02):
    """How far each vertex may move before the surface meets itself.

    The distance to the nearest triangle outside the vertex's own `rings` of
    neighbours: across a finger crease that is a millimetre, over a knuckle it
    is centimetres. Face-accurate on purpose - two sides of a crease pinch
    between their vertices, and a distance taken off the corners misses it.
    The mesh must be welded first, or a UV seam's doubled vertices read as a
    surface touching itself and every seam reports no room at all.
    """
    bm.verts.index_update()
    near = []
    for v in bm.verts:
        ring = {v}
        for _ in range(rings):
            ring |= {e.other_vert(u) for u in list(ring) for e in u.link_edges}
        near.append({u.index for u in ring})
    tris = []
    for f in bm.faces:
        idx = [v.index for v in f.verts]
        for i in range(1, len(idx) - 1):
            tris.append((idx[0], idx[i], idx[i + 1]))
    bvh = mathutils.bvhtree.BVHTree.FromPolygons([v.co.copy() for v in bm.verts], tris)
    room = []
    for i, v in enumerate(bm.verts):
        best = reach
        for _loc, _nrm, index, dist in bvh.find_nearest_range(v.co, reach):
            if any(x in near[i] for x in tris[index]):
                continue
            best = min(best, dist)
        room.append(best)
    return room


def skin_pinch(body):
    """Every skin point's own headroom, keyed by position.

    The hand's fingers are modelled a millimetre apart down their flanks. Two
    faces of a shell share that millimetre, so half of it is all the air any
    glove can hold there - the same reason the plate drops the arm sockets and
    the boot drops the sole, measured off the body instead of named.
    """
    obj = body.copy()
    obj.data = body.data.copy()
    bpy.context.scene.collection.objects.link(obj)
    obj.data.transform(body.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    room = surface_headroom(bm)
    found = {key_of(v.co): room[i] for i, v in enumerate(bm.verts)}
    bm.free()
    drop(obj)
    return found


def key_of(point):
    return (round(point.x, 6), round(point.y, 6), round(point.z, 6))


def finger_webs(rig, body, side):
    """The webs between the fingers, as balls.

    Neighbouring finger roots give each centre and the fingers' own measured
    radius gives the size, so nothing here is a number somebody picked: it is
    the arm socket's construction on a smaller joint.
    """
    across = ("thumb", "index", "middle", "ring", "pinky")
    measured = [limb_radius(rig, body, f"{f}_01_{side}", GAUNTLET_WEB_ALONG) for f in across]
    return [((a[0] + b[0]) / 2, max(a[1], b[1])) for a, b in zip(measured, measured[1:])]


def fit_hand_plate(donor, body, rig):
    """Grow the glove until the hand inside it is covered.

    The same signed test the helm and the plate use, fired out of the hand's own
    bones (`covered_radially`): a nearest-surface distance reads a knuckle 2 mm
    under the steel and one 2 mm through it as the same number.

    Measured against the REST body. The skinning is what carries a deforming
    piece into every clip, so a fit made in the idle would bake that frame's
    closed fist into the bind pose and put the steel through the fingers
    everywhere else. It is also why the donor has to be authored flat: a glove
    sculpted with the fingers relaxed hangs below the straight ones at every
    size, which no placement fixes.
    """
    matrix, sample, segments, measured = hand_plate_seat(donor, body, rig)

    tries = []
    clear = GAUNTLET_CLEAR_FROM
    while clear <= GAUNTLET_CLEAR_TO + 1e-9:
        bvh = bvh_of(donor, matrix(clear))
        p01, med = gap_profile(bvh, sample)
        cov = covered_radially(bvh, sample, segments)
        tries.append([round(clear * 1000, 2), round(p01 * 1000, 2), round(med * 1000, 2),
                      round(cov, 4)])
        if cov >= GAUNTLET_COVERAGE and p01 >= GAUNTLET_MIN_GAP and med <= GAUNTLET_MAX_MEDIAN:
            width, thick = measured["fan_scales"](clear)
            # The sizing callable is the seat's own, not something a fit report
            # can carry.
            return matrix(clear), dict(
                {k: v for k, v in measured.items() if k != "fan_scales"},
                hand_clearance_mm=round(clear * 1000, 2),
                width_scale=round(width, 5),
                thickness_scale=round(thick, 5),
                hand_gap_p01_mm=round(p01 * 1000, 2),
                hand_gap_median_mm=round(med * 1000, 2),
                hand_covered=round(cov, 4),
                steel_past_fingertips_mm=round(GAUNTLET_TIP * 1000, 1),
            )
        clear += GAUNTLET_CLEAR_STEP
    raise SystemExit(f"no gauntlet size both clears the hand and stays a glove; {tries}")


def fit_hand_authored(donor, body, rig):
    """Place a donor carved from this body's own hand; never resize it.

    `tools/prep_gauntlet.py` cuts its shell out of this same hand's skin and
    pushes it out by a clearance already measured on this body, so growing a
    size back out of the donor's own finger fan re-derives a number the shape
    already answers and shrinks an already-fitted shell - which is what drove
    steel through the fingers under `fit_hand_plate`.
    """
    _, sample, segments, measured = hand_plate_seat(donor, body, rig)
    matrix = HAND_DONOR_SPACE.inverted()
    bvh = bvh_of(donor, matrix)
    p01, med = gap_profile(bvh, sample)
    cov = covered_radially(bvh, sample, segments)
    if cov >= GAUNTLET_COVERAGE and p01 >= GAUNTLET_MIN_GAP and med <= GAUNTLET_MAX_MEDIAN:
        return matrix, dict(
            {k: v for k, v in measured.items() if k != "fan_scales"},
            hand_gap_p01_mm=round(p01 * 1000, 2),
            hand_gap_median_mm=round(med * 1000, 2),
            hand_covered=round(cov, 4),
            placed_as_authored=True,
        )
    raise SystemExit(
        f"the authored gauntlet fails its placement gate: covered {cov:.4f} "
        f"(need >= {GAUNTLET_COVERAGE}), p01 gap {p01 * 1000:.2f} mm "
        f"(need >= {GAUNTLET_MIN_GAP * 1000:.2f}), median gap {med * 1000:.2f} mm "
        f"(need <= {GAUNTLET_MAX_MEDIAN * 1000:.2f})")


def hand_plate_seat(donor, body, rig):
    """The hand a glove goes on, the donor's own finger run, and what puts one
    on the other. Shared with `tools/prep_gauntlet.py`, which carves the donor's
    cavity out of this same hand at this same placement."""
    hand = group_points(body, "hand_r", 0.35)
    for bone in FINGER_BONES:
        hand += group_points(body, f"{bone}_r", 0.35)
    if not hand:
        raise SystemExit("the body carries no hand weights to fit a gauntlet against")
    # The rest arm runs out along -X, so the wrist is the +X end of the hand.
    _, hand_hi, hand_dims, hand_c = bbox(hand)
    hand_len = hand_dims.x
    seat_x = hand_hi.x - hand_len * GAUNTLET_SEAT

    webs = finger_webs(rig, body, "r")
    sample = [p for p in hand if all((p - c).length >= r for c, r in webs)]
    pinched = skin_pinch(body)
    sample = [p for p in sample
              if pinched.get(key_of(p), GAUNTLET_PINCH) >= GAUNTLET_PINCH]
    if not sample:
        raise SystemExit("the finger webs swallowed every hand point")
    segments = bones_of(rig, ("hand_r",) + tuple(f"{b}_r" for b in FINGER_BONES))

    hp = [v.co for v in donor.data.vertices]
    wrist_z, _, wrist_r = narrowest(donor, 2, GAUNTLET_WRIST_FROM, GAUNTLET_WRIST_TO)
    glove = [p for p in hp if p.z > wrist_z]
    _, g_hi, _, g_c = bbox(glove)
    run = g_hi.z - wrist_z
    long = (hand_len + GAUNTLET_TIP) / run

    # The fingers alone, on each mesh, in its own axes: the donor runs up +Z and
    # is measured across X and through Y; the hand runs out -X, across Y and
    # through Z.
    _, _, fan_body, fan_body_c = bbox(
        [p for p in hand if p.x < hand_hi.x - hand_len * GAUNTLET_FAN_FROM])
    _, _, fan_donor, fan_donor_c = bbox(
        [p for p in glove if p.z > wrist_z + run * GAUNTLET_FAN_FROM])
    # Donor +Z is the fingers and +X the thumb; the rest pose wants the fingers
    # down -X, the palm down -Z and the thumb forward at -Y. Two quarter turns.
    rot = Matrix.Rotation(math.radians(-90), 4, "Z") @ Matrix.Rotation(math.radians(90), 4, "X")
    # Seated down the fingers, not on the whole hand: the rest pose's thumb is
    # rotated under the palm and this donor's lies flat in it, so a hand's bbox
    # centre sits three centimetres lower on the body than on the donor and the
    # glove goes on under the palm.
    anchor = Vector((fan_donor_c.x, fan_donor_c.y, wrist_z))
    target = Vector((seat_x, fan_body_c.y, fan_body_c.z))

    def scales(clear):
        """The same air on both axes: a glove is not a scaled hand."""
        return ((fan_body.y + 2 * clear) / fan_donor.x,
                (fan_body.z + 2 * clear) / fan_donor.y)

    def matrix(clear):
        width, thick = scales(clear)
        return seated(donor, Matrix.Diagonal((width, thick, long, 1.0)), rot, anchor, target)

    return matrix, sample, segments, {
        "length_scale": round(long, 5),
        "hand_length_m": round(hand_len, 4),
        "finger_fan_m": round(fan_body.y, 4),
        "finger_thickness_m": round(fan_body.z, 4),
        "donor_finger_fan": round(fan_donor.x, 4),
        "donor_wrist_radius": round(wrist_r, 4),
        "donor_wrist_at": round(wrist_z, 5),
        "donor_run": round(run, 5),
        "hand_points": len(sample),
        "finger_web_points": len(hand) - len(sample),
        "finger_web_radius_mm": round(max(r for _, r in webs) * 1000, 2),
        "fan_scales": scales,
    }


def fit_boot_leg(donor, body, rig):
    """Grow the boot until the leg inside it is covered, standing on the floor.

    The outer sole is the one thing that cannot move: seat it anywhere but the
    ground the feet are already on and the character floats or sinks. So the
    piece is sized on the foot and the shaft is drawn up the shin afterwards,
    the way the wand buys length along its own shaft.

    Measured against the REST body, for the reason the plate is.
    """
    leg = []
    for bone in SABATON_BONES:
        leg += group_points(body, bone, 0.35)
    foot = group_points(body, "foot_r", 0.35) + group_points(body, "ball_r", 0.35)
    if not foot:
        raise SystemExit("the body carries no foot weights to fit a sabaton against")
    _, _, foot_dims, _ = bbox(foot)
    sole_z = min(p.z for p in foot)
    knee = (rig.matrix_world @ rig.data.bones["calf_r"].head_local).z
    top = knee + BOOT_TOP
    ankle_z = (rig.matrix_world @ rig.data.bones["foot_r"].head_local).z
    seat, _ = band(leg, 2, ankle_z, (top - sole_z) * 0.05)
    # Fore-aft the seat is the ankle, but across the body it is the FOOT: this
    # foot stands 13 mm outboard of its own ankle, and a toe box centred on the
    # ankle puts the little-toe side through the wall while the inner side has
    # 30 mm of air. The shaft has room to follow the foot; the toes do not.
    _, _, _, foot_c = bbox(foot)

    segments = bones_of(rig, SABATON_BONES)
    # Below the rim, because a boot is open at the top and the calf above it is
    # bare on purpose; and never the underside, which stands on the insole.
    sample = [p for p in leg if p.z <= top and outward(segments, p).z > SOLE_CONTACT]
    if not sample:
        raise SystemExit("the rim and the sole between them swallowed every leg point")

    hp = [v.co for v in donor.data.vertices]
    d_lo, d_hi, d_dims, _ = bbox(hp)
    _, ankle_c, ankle_r = narrowest(donor, 2, BOOT_ANKLE_FROM, BOOT_ANKLE_TO)
    _, _, _, d_foot_c = bbox([p for p in hp if p.z <= d_lo.z + d_dims.z * BOOT_ANKLE_FROM])

    tries = []
    ratio = BOOT_LEN_FROM
    while ratio <= BOOT_LEN_TO + 1e-9:
        scale = (foot_dims.y * ratio) / d_dims.y
        stretch = min(BOOT_MAX_STRETCH, (top - sole_z) / (d_dims.z * scale))
        M = seated(donor, sizing(scale, stretch, 2), Matrix.Identity(4),
                   Vector((d_foot_c.x, ankle_c.y, d_lo.z)),
                   Vector((foot_c.x, seat.y, sole_z)))
        bvh = bvh_of(donor, M)
        p01, med = gap_profile(bvh, sample)
        cov = covered_radially(bvh, sample, segments)
        tries.append([round(ratio, 3), round(p01 * 1000, 2), round(med * 1000, 2),
                      round(cov, 4)])
        if cov >= BOOT_COVERAGE and p01 >= BOOT_MIN_GAP and med <= BOOT_MAX_MEDIAN:
            return M, {
                "foot_length_ratio": round(ratio, 3),
                "scale": round(scale, 5), "shaft_stretch": round(stretch, 4),
                "foot_length_m": round(foot_dims.y, 4),
                "shin_span_m": round(top - sole_z, 4),
                "donor_ankle_radius": round(ankle_r, 4),
                "leg_gap_p01_mm": round(p01 * 1000, 2),
                "leg_gap_median_mm": round(med * 1000, 2),
                "leg_covered": round(cov, 4),
                "leg_points": len(sample),
                "sole_and_rim_points": len(leg) - len(sample),
                "rim_below_knee_mm": round(-BOOT_TOP * 1000, 1),
            }
        ratio += BOOT_LEN_STEP
    raise SystemExit(f"no sabaton size both clears the leg and stays a boot; {tries}")


def fit_plate_hips(donor, body, rig):
    """Grow the fauld until the hips and thighs under it are covered.

    The plate's search, one storey down: the ring is the smallest one that puts
    steel outboard of the hips, and the donor's own flare carries the tassets
    over the thighs from there. Height and width scale separately for the reason
    the cuirass does - the span from the belt to the knee is set by the body, and
    a uniform scale that satisfies it would size the ring by accident.

    Measured against the REST body, for the reason the plate is.

    The crotch is measured on its own rather than mixed into the gate. Those
    points are the ones whose way out of their own limb aims across the body's
    mid-plane, which the body itself says - `outward` reads it off the thigh the
    skin belongs to; the ray out of one leaves past the other, so what it can
    hit is the far side of the skirt. `crotch_covered` is that fraction, and it
    is the number that says the skirt closes between the legs. The open waist
    and the open hem go the same way, by the same test turned upright.
    """
    hips = group_points(body, "pelvis", 0.35)
    legs = group_points(body, "thigh_l", 0.35) + group_points(body, "thigh_r", 0.35)
    if not hips or not legs:
        raise SystemExit("the body carries no hip or thigh weights to fit a fauld against")

    # The donor is authored front = -Y and wider across than deep, so it needs no
    # rotation onto a body built the same way; but that is a fact about this rest
    # pose, and a body facing the other way would put the front slit on a buttock.
    toe = (rig.matrix_world @ rig.data.bones["ball_r"].head_local
           - rig.matrix_world @ rig.data.bones["foot_r"].head_local)
    if toe.y >= 0:
        raise SystemExit("this body does not face -Y: the fauld's slits need a rotation")

    knee = sum((rig.matrix_world @ rig.data.bones[b].head_local).z
               for b in ("calf_l", "calf_r")) / 2

    # The cuirass is fitted before this piece, so it can simply be read off the
    # scene. Its own front rim is what the belt is hung from - the front is the
    # edge the eye follows, and this donor's back tail hangs lower than it.
    cuirass = bpy.data.objects.get("chest.plate.cuirass")
    if cuirass is None:
        raise SystemExit("the fauld's waist band is sized on the cuirass, which is not fitted")
    cvs = [cuirass.matrix_world @ v.co for v in cuirass.data.vertices]
    c_lo = min(v.z for v in cvs)
    mid_y = sum(p.y for p in cvs) / len(cvs)
    top = min(v.z for v in cvs if v.y < mid_y) + HIPS_BAND_RISE
    bottom = knee + HIPS_HEM
    if bottom >= top:
        raise SystemExit("the knee is above the belt: there is no fauld span to fill")

    # The ring is sized on the hips, and the hips are the pelvis plus the top of
    # the thighs: a band about the hip joint, reaching as far below it as the
    # belt is above it, so the widest part of the pelvis is inside the span the
    # skirt's own ring has to clear.
    hip_z = sum((rig.matrix_world @ rig.data.bones[b].head_local).z
                for b in ("thigh_l", "thigh_r")) / 2
    hip_band = [p for p in hips + legs if hip_z - (top - hip_z) <= p.z <= top]
    if len(hip_band) < 8:
        raise SystemExit("no hip band to size a fauld against")
    _, _, hip_dims, hip_c = bbox(hip_band)

    segments = bones_of(rig, ("pelvis", "thigh_l", "thigh_r"))
    sample = []
    crotch_pts = []
    opening = 0
    for p in hips + legs:
        if not (bottom <= p.z <= top):
            continue
        out = outward(segments, p)
        side = nearest_on(segments, p).x
        if abs(side) > 1e-3 and -out.x * math.copysign(1.0, side) > HIPS_INNER:
            crotch_pts.append(p)
            continue
        if abs(out.z) > HIPS_VERTICAL:
            opening += 1
            continue
        sample.append(p)
    if not sample:
        raise SystemExit("the hem and the crotch between them swallowed every hip point")

    hp = [v.co for v in donor.data.vertices]
    d_lo, d_hi, d_dims, d_c = bbox(hp)
    lip = [p for p in hp if p.z >= d_hi.z - d_dims.z * HIPS_LIP]
    lip_r = max(math.hypot(p.x - d_c.x, p.y - d_c.y) for p in lip)
    waist_ring = Vector((d_c.x, d_c.y, d_hi.z))
    high = (top - bottom) / d_dims.z

    # A fauld is belted OUTSIDE the breastplate, so the band is sized on the
    # widest thing the breastplate puts in front of it: the flare's lip, which
    # is what the eye follows down. Everything of the cuirass at or below the
    # band's top edge has to end up inside the band's outer face.
    rim_r = max(math.hypot(v.x - hip_c.x, v.y - hip_c.y)
                for v in cvs if v.z <= top)
    if c_lo >= top:
        raise SystemExit(
            f"the cuirass rim at {c_lo:.4f} is above the fauld's band top at {top:.4f}")

    # The band's outer face is the donor's widest radius at its very top, and it
    # is what the whole piece is scaled by: the stand-off from the flare is a
    # fixed few millimetres, so the width is READ rather than swept. The sweep
    # below starts there and only climbs if the skirt cannot make its gates.
    band_out_r = max(math.hypot(p.x - d_c.x, p.y - d_c.y)
                     for p in hp if p.z >= d_hi.z - d_dims.z * HIPS_LIP)
    wide_band = (rim_r + HIPS_BAND_AIR) / band_out_r

    def matrix(wide):
        S = Matrix.Diagonal((wide, wide, high, 1.0))
        return seated(donor, S, Matrix.Identity(4), waist_ring,
                      Vector((hip_c.x, hip_c.y, top)))

    def band_metrics(wide):
        """Air, rim cover and overlap between the fitted band and the cuirass.

        Both shells are binned by angle about the hip centre, because neither is
        a circle: the donor is an oval and the breastplate is a scan. In each bin
        the band's outer face is the largest radius its own vertices reach inside
        the band's height, and the cuirass is the largest radius and the lowest z
        its own reach there. Air is the band standing PAST the plate; negative
        air is the plate poking through it.
        """
        band_bot = top - (top - bottom) * HIPS_BAND
        m = matrix(wide)
        inner = [None] * HIPS_BAND_BINS
        outer = [None] * HIPS_BAND_BINS
        low = [None] * HIPS_BAND_BINS

        def slot(x, y):
            a = math.atan2(y - hip_c.y, x - hip_c.x)
            return int((a + math.pi) / (2 * math.pi) * HIPS_BAND_BINS) % HIPS_BAND_BINS

        for q in hp:
            w = m @ q
            if not (band_bot <= w.z <= top):
                continue
            i = slot(w.x, w.y)
            r = math.hypot(w.x - hip_c.x, w.y - hip_c.y)
            inner[i] = r if inner[i] is None else max(inner[i], r)
        for v in cvs:
            i = slot(v.x, v.y)
            low[i] = v.z if low[i] is None else min(low[i], v.z)
            if not (band_bot <= v.z <= top):
                continue
            r = math.hypot(v.x - hip_c.x, v.y - hip_c.y)
            outer[i] = r if outer[i] is None else max(outer[i], r)

        pairs = [(inner[i], outer[i]) for i in range(HIPS_BAND_BINS)
                 if inner[i] is not None and outer[i] is not None]
        air = min(a - b for a, b in pairs) if pairs else None
        step = 360.0 / HIPS_BAND_BINS
        covered = sum(step for z in low if z is not None and z >= band_bot)
        below = [(i * step - 180.0, band_bot - low[i]) for i in range(HIPS_BAND_BINS)
                 if low[i] is not None and low[i] < band_bot]
        worst = max(below, key=lambda t: t[1]) if below else None
        return {
            "band_air_mm": round(air * 1000, 2) if air is not None else None,
            "band_bins_measured": len(pairs),
            "rim_covered_deg": round(covered, 1),
            "worst_rim_outside_band_mm": (round(max(0.0, -air) * 1000, 2)
                                          if air is not None else None),
            "rim_below_band_worst_deg_mm": ([round(worst[0], 1), round(worst[1] * 1000, 1)]
                                            if worst else None),
        }

    tries = []
    slack = 1.0
    while slack <= HIPS_BAND_SLACK + 1e-9:
        wide = wide_band * slack
        bvh = bvh_of(donor, matrix(wide))
        p01, med = gap_profile(bvh, sample)
        cov = covered_radially(bvh, sample, segments)
        crotch_cov = covered_radially(bvh, crotch_pts, segments)
        lip_out = lip_r * wide
        tries.append([round(slack, 3), round(p01 * 1000, 2), round(med * 1000, 2),
                      round(cov, 4), round(lip_out * 1000, 1)])
        if (cov >= HIPS_COVERAGE and p01 >= HIPS_MIN_GAP and med <= HIPS_MAX_MEDIAN
                and lip_out >= rim_r + HIPS_RIM_CLEAR):
            report = {
                "band_slack_over_rim": round(slack, 3),
                "band_width_over_hip": round(band_out_r * 2 * wide / hip_dims.x, 3),
                "width_set_by": ("the cuirass rim" if abs(slack - 1.0) < 1e-9
                                 else "swept above a rim-tight band"),
                "width_scale": round(wide, 5), "height_scale": round(high, 5),
                "hip_width_m": round(hip_dims.x, 4),
                "span_m": round(top - bottom, 4),
                "lip_radius_m": round(lip_r * wide, 4),
                "cuirass_rim_radius_m": round(rim_r, 4),
                "lip_past_rim_mm": round((lip_r * wide - rim_r) * 1000, 2),
                "hip_gap_p01_mm": round(p01 * 1000, 2),
                "hip_gap_median_mm": round(med * 1000, 2),
                "hip_covered": round(cov, 4),
                "hip_points": len(sample),
                "crotch_points": len(crotch_pts),
                "crotch_covered": round(crotch_cov, 4),
                "opening_points": opening,
                "hem_vs_knee_mm": round(HIPS_HEM * 1000, 1),
                "boot_rim_below_hem_mm": round((HIPS_HEM - BOOT_TOP) * 1000, 1),
                "band_rise_mm": round(HIPS_BAND_RISE * 1000, 1),
                "band_outer_radius_m": round(band_out_r * wide, 4),
                "cuirass_flare_radius_m": round(rim_r, 4),
            }
            report.update(band_metrics(wide))
            return matrix(wide), report
        slack += HIPS_WIDTH_STEP
    raise SystemExit("no fauld size clears the hips, belts onto the cuirass rim and "
                     f"stays a skirt; slack, p01, median, covered, lip: {tries}")


def fit_tower_strap(donor, body, rig):
    """A tall board strapped to the outside of the forearm, hanging past the hand.

    Sized on its own long axis against body height, the way a tower shield
    covers a fighter from the shoulder to below the knee, rather than
    `fit_forearm_strap`'s diameter ratio, which reads a board this tall as a
    buckler. The strap is not the board's own middle: the contact point sits
    near its top edge, TOWER_HANG_FROM_BOTTOM up from the bottom, so most of
    the length hangs below the hand the way one is actually carried. Aimed
    against the idle clip, never the bind pose, for the same reason
    `fit_forearm_strap` is.
    """
    _, _, body_dims, _ = bbox([body.matrix_world @ v.co for v in body.data.vertices])
    arm_pts = group_points(body, "lowerarm_l")
    hand_pts = group_points(body, "hand_l")
    d_lo, d_hi, d_dims, d_c = bbox([v.co for v in donor.data.vertices])
    scale = (body_dims.z * TOWER_HEIGHT_RATIO) / d_dims.z
    bone = rig.data.bones["lowerarm_l"]
    elbow = rig.matrix_world @ bone.head_local
    wrist = rig.matrix_world @ bone.tail_local

    M, _, mats = idle_pose(rig, "lowerarm_l", LEFT_HAND)
    face = Vector(TOWER_FACE).normalized()
    along = (M @ elbow).lerp(M @ wrist, TOWER_ALONG)
    out = [M @ q for q in arm_pts]
    for b in LEFT_HAND:
        out += [mats[b] @ q for q in group_points(body, b)]
    reach = max((p - along).dot(face) for p in out)
    # The strap sits on the board's own back SURFACE, which a dished shield does
    # not carry at its bounding box: the box's back is the rim, a half-dish
    # behind the wood the arm actually rests on, and seating by either the box
    # back or the mid-depth leaves the same hollow between board and forearm.
    # Measured off the vertices around the strap height on the board's midline.
    strap_z = d_lo.z + TOWER_HANG_FROM_BOTTOM * d_dims.z
    near = [v.co for v in donor.data.vertices
            if abs(v.co.z - strap_z) < d_dims.z * 0.08
            and abs(v.co.x - d_c.x) < d_dims.x * 0.15]
    back_y = max(p.y for p in near) if near else d_hi.y
    centre = M.inverted() @ (along + face * (reach + TOWER_GAP))
    anchor = Vector((d_c.x, back_y, strap_z))
    roll = Matrix.Rotation(math.radians(BUCKLER_ROLL), 4, "Y")
    rot = aimed(donor, Vector((0, -1, 0)), M.to_3x3(), TOWER_FACE) @ roll
    M4 = seated(donor, sizing(scale), rot, anchor, centre)
    p01, med = gap_profile(bvh_of(donor, M4), arm_pts + hand_pts)
    return M4, {
        "scale": round(scale, 5),
        "height_m": round(body_dims.z * TOWER_HEIGHT_RATIO, 4),
        "arm_reach_mm": round(reach * 1000, 2),
        "face_world": list(TOWER_FACE),
        "hang_from_bottom": TOWER_HANG_FROM_BOTTOM,
        "strap_back_inset_mm": round((d_hi.y - back_y) * scale * 1000, 2),
        "arm_gap_p01_mm": round(p01 * 1000, 2),
        "arm_gap_median_mm": round(med * 1000, 2),
    }


FITTERS = {
    "head_shell": fit_head_shell,
    "hand_grip": fit_hand_grip,
    "forearm_strap": fit_forearm_strap,
    "tower_strap": fit_tower_strap,
    "plate_torso": fit_plate_torso,
    "plate_suit": fit_plate_suit,
    "soft_suit": fit_soft_suit,
    "plate_hips": fit_plate_hips,
    "hand_plate": fit_hand_plate,
    "hand_authored": fit_hand_authored,
    "boot_leg": fit_boot_leg,
}


def skin_to_bone(mesh, rig, bone):
    """Bind every vertex to one bone at full weight.

    A rigid piece needs no deformation, only to go where its joint goes, and one
    group at weight 1 says that in the same skinning the body already uses. The
    runtime therefore learns nothing new: the piece rides the skeleton it is
    exported with.
    """
    if bone not in rig.data.bones:
        raise SystemExit(f"{mesh.name}: no bone {bone} on {rig.name}")
    mesh.parent = rig
    mesh.matrix_parent_inverse = rig.matrix_world.inverted()
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            mesh.modifiers.remove(mod)
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    for stale in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(stale)
    group = mesh.vertex_groups.new(name=bone)
    group.add(range(len(mesh.data.vertices)), 1.0, "REPLACE")


def _kdtree(pts, idxs):
    tree = mathutils.kdtree.KDTree(len(idxs))
    for i in idxs:
        tree.insert(pts[i], i)
    tree.balance()
    return tree


def _drop_islands_below(obj, M, z):
    """Drop every connected piece that lies wholly below z: a donor's boot-cuff
    scrap that the shin cut left outside its region, not a hem that hangs past it."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen = set()
    doomed = []
    for start in bm.verts:
        if start.index in seen:
            continue
        island, stack = [], [start]
        seen.add(start.index)
        while stack:
            v = stack.pop()
            island.append(v)
            for e in v.link_edges:
                o = e.other_vert(v)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        if all((M @ v.co).z < z for v in island):
            doomed.extend(island)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(doomed)


def _cut_verts(obj, doomed):
    """Drop a set of vertices and every face that used one, then any loose rest."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in doomed], context="VERTS")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _cut_faces(obj, doomed):
    """Drop a set of faces and any vertex left holding none."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in doomed], context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def region_cores(body, bm):
    """The vertex indices each `BODY_REGIONS` entry claims on this body."""
    bm.verts.ensure_lookup_table()
    dl = bm.verts.layers.deform.active
    idx = {g.name: g.index for g in body.vertex_groups}
    wanted = {}
    for region, bones in BODY_REGIONS.items():
        missing = [b for b in bones if b not in idx]
        if missing:
            raise SystemExit(f"{body.name}: no vertex groups {missing}")
        wanted[region] = {idx[b] for b in bones}
    cores = {region: set() for region in wanted}
    for v in bm.verts:
        sums = {region: sum(w for gi, w in v[dl].items() if gi in want)
                for region, want in wanted.items()}
        best = max(sums, key=lambda region: sums[region])
        if sum(sums.values()) >= BODY_REGION_WEIGHT and sums[best] > 0.0:
            cores[best].add(v.index)
    return cores


def split_body_regions(body, look):
    """Cut a body into the pieces worn steel is allowed to replace.

    A face joins a region as soon as ONE of its corners belongs there, and the
    body keeps only the faces with no corner in any region. The two never share
    a triangle, so a region that is SHOWN meets the body with no crack, and a
    region that is hidden leaves the single rim of faces the cuff over it
    covers. Cutting by vertex instead would delete every straddling face from
    both meshes and open that rim even with nothing worn.

    A vertex goes to the region that sums HIGHEST over its bones, once the
    regions together hold `BODY_REGION_WEIGHT` of it. A per-region floor instead
    drops every vertex that blends across two regions - the trapezius sums under
    half in the neck and under half in the collar, and lands in neither, which
    is a bare strip of skin between the gorget and the pauldron. The floor on
    the TOTAL still keeps the head, which no region claims, on the body.
    """
    bm = bmesh.new()
    bm.from_mesh(body.data)
    cores = region_cores(body, bm)
    regions, claimed = [], set()
    for region, core in cores.items():
        faces = {f.index for f in bm.faces if any(v.index in core for v in f.verts)}
        if not faces:
            raise SystemExit(f"{body.name}: nothing weighted to {region}")
        regions.append((region, faces))
        claimed |= faces
    total = len(bm.faces)
    bm.free()

    for region, faces in regions:
        piece = body.copy()
        piece.data = body.data.copy()
        piece.name = piece.data.name = f"base.{look}.{region}"
        bpy.context.scene.collection.objects.link(piece)
        _cut_faces(piece, [i for i in range(total) if i not in faces])
        print(f"  {piece.name}: {len(piece.data.polygons)} faces")
    _cut_faces(body, sorted(claimed))
    print(f"  {body.name}: {len(body.data.polygons)} faces of {total} kept")
    return [region for region, _ in regions]


def arm_reach(body, rig, bone, at, standoff, inboard):
    """The sleeve of air a cap for `bone` may occupy, measured off the arm.

    Returned as the bone's own frame plus two bounds: how far inboard of the
    arm's own skin the cap may reach along the bone, and how far out from the
    bone axis. Both come from the body, so a different body moves them.
    """
    b = rig.data.bones[bone]
    head = rig.matrix_world @ b.head_local
    axis = ((rig.matrix_world @ b.tail_local) - head).normalized()
    want = body.vertex_groups[bone].index
    skin = [body.matrix_world @ v.co for v in body.data.vertices
            if any(g.group == want and g.weight >= at for g in v.groups)]
    if not skin:
        raise SystemExit(f"{body.name}: no skin at {bone} weight {at}")
    axial = [(p - head).dot(axis) for p in skin]
    radial = [((p - head) - axis * t).length for p, t in zip(skin, axial)]
    return head, axis, min(axial) - inboard, max(radial) + standoff


def split_arm_plates(donor, body, rig, arms, classify_bones, stem, at, margin,
                     standoff, inboard):
    """Cut the shoulder caps off a torso shell into one rigid piece per arm.

    A point of steel belongs to an arm when the body under it does: the same
    nearest-surface transfer the whole shell is skinned with answers that, and
    it answers it where the fault is, on the outer shoulder and down the sleeve,
    rather than on the flank a hanging arm bone happens to run past.

    The transfer alone is not enough on a shell that stands off the skin. Steel
    out in the air over the chest, the collar or the flank finds the arm as its
    nearest body surface, and every point it hands the arm is then bound rigidly
    to the humerus: a slab of breastplate that swings away from the cuirass the
    moment the arm moves. `arm_reach` therefore bounds the cap to the sleeve of
    air around the arm's own skin, and steel outside it stays torso whatever the
    transfer says.

    That set is then dilated by `margin` for the cap and eroded by `margin` for
    the torso, so a band twice `margin` wide is cut into both meshes and the
    cuirass rim sits under the cap it left rather than beside it.
    """
    skin_by_transfer(donor, body, rig, classify_bones)
    idx = {g.name: g.index for g in donor.vertex_groups}
    pts = [donor.matrix_world @ v.co for v in donor.data.vertices]
    n = len(pts)
    made = []
    for bone in arms:
        want = idx[bone]
        w = [next((g.weight for g in v.groups if g.group == want), 0.0)
             for v in donor.data.vertices]
        head, axis, axial_min, radial_max = arm_reach(
            body, rig, bone, at, standoff, inboard)
        reach = []
        for p in pts:
            t = (p - head).dot(axis)
            reach.append(t >= axial_min
                         and ((p - head) - axis * t).length <= radial_max)
        core = [i for i in range(n) if w[i] >= at and reach[i]]
        outside = [i for i in range(n) if not (w[i] >= at and reach[i])]
        if not core or not outside:
            raise SystemExit(f"{donor.name}: nothing to cut at {bone} weight {at}")
        near_core, near_outside = _kdtree(pts, core), _kdtree(pts, outside)
        # Dilated: the cap keeps the arm set and every vertex within `margin` of
        # it. Eroded: the torso drops only arm vertices that far inside the set.
        # The reach bounds the dilation too, or the band grows the slab back.
        dilated = {i for i in range(n)
                   if reach[i] and near_core.find(pts[i])[2] <= margin}
        eroded = {i for i in core if near_outside.find(pts[i])[2] > margin}
        print(f"  {bone}: cap reach {radial_max * 1000:.0f} mm off the bone, "
              f"{axial_min * 1000:.0f} mm inboard; "
              f"{sum(1 for i in range(n) if w[i] >= at and not reach[i])} vertices "
              f"the transfer gave the arm are outside it and stay torso")
        piece = donor.copy()
        piece.data = donor.data.copy()
        bpy.context.scene.collection.objects.link(piece)
        piece.name = piece.data.name = f"{stem}_{bone.split('_')[-1]}"
        _cut_verts(piece, [i for i in range(n) if i not in dilated])
        print(f"  {piece.name}: {len(piece.data.vertices)} vertices of {n}, "
              f"{len(core)} at {bone} weight {at} or more, "
              f"{len(dilated) - len(eroded)} of them shared with the torso "
              f"(band {margin * 2000:.0f} mm wide)")
        made.append((piece, bone, eroded))

    _cut_verts(donor, sorted({i for _, _, eroded in made for i in eroded}))
    print(f"  {donor.name}: {len(donor.data.vertices)} vertices of {n} kept")
    return [(piece, bone) for piece, bone, _ in made]


def skin_by_transfer(mesh, body, rig, bones):
    """Take the body's own weights, over one named set of bones.

    A plate cannot ride a joint the way a helmet does: it spans the spine and
    both shoulders, and every one of them moves separately. Nearest-surface
    transfer asks the body what it does under each point of steel and gives the
    steel the same answer, which is the only thing that keeps a pauldron on a
    shoulder through a full stride.

    Everything outside `bones` is dropped rather than left at a small weight.
    An unnormalised stray - a thigh group on a breastplate - is invisible in the
    idle and tears the plate downward the moment the leg swings.
    """
    missing = [b for b in bones if b not in rig.data.bones]
    if missing:
        raise SystemExit(f"{mesh.name}: no bones {missing} on {rig.name}")
    for group in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(group)

    # The modifier names both objects. `object.data_transfer` reads its source
    # and its destination off the selection instead, which is one stray active
    # object away from transferring the wrong way and reporting success.
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    mod = mesh.modifiers.new("Transfer", "DATA_TRANSFER")
    mod.object = body
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"
    mod.layers_vgroup_select_src = "ALL"
    mod.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.datalayout_transfer(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)

    kept = 0
    for group in list(mesh.vertex_groups):
        if group.name in bones:
            kept += 1
        else:
            mesh.vertex_groups.remove(group)
    if kept < len(bones):
        raise SystemExit(
            f"{mesh.name}: transfer produced {kept} of {len(bones)} groups")

    # Dropping groups leaves the survivors summing to less than one, which reads
    # as a plate shrinking toward the origin under the modifier.
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    # A pauldron tip stands out past the shoulder in open air, so the body
    # polygon nearest to it is down the forearm - and every weight there belongs
    # to a group this piece just dropped. Those vertices come out of the
    # transfer with nothing on them, which the modifier reads as the origin and
    # draws as a spike through the character. They are given the nearest bone
    # that IS kept, which for a pauldron tip is the upper arm it hangs from.
    orphans = [v for v in mesh.data.vertices if not v.groups]
    if orphans:
        segs = [(b, rig.matrix_world @ rig.data.bones[b].head_local,
                 rig.matrix_world @ rig.data.bones[b].tail_local) for b in bones]
        for v in orphans:
            best, near = None, None
            for name, head, tail in segs:
                axis = tail - head
                t = 0.0 if axis.length_squared < 1e-12 else max(
                    0.0, min(1.0, (v.co - head).dot(axis) / axis.length_squared))
                d = (v.co - (head + axis * t)).length
                if near is None or d < near:
                    best, near = name, d
            mesh.vertex_groups[best].add([v.index], 1.0, "REPLACE")
        print(f"  {mesh.name}: {len(orphans)} vertices past the body, "
              f"pinned to the nearest kept bone")
    rebind(mesh, rig)
    return kept


def mirrored(right, rig, name):
    """The other side of a fitted piece, reflected across the body's mid-plane.

    A gauntlet is fitted to one hand and worn on two, and refitting the mirror
    image is not the same thing as mirroring the fit: the search would land on
    its own ratio and the two hands would carry visibly different steel. The
    reflection is exact instead, which only holds because this rest pose IS
    symmetric - see `assert_symmetric`, which runs before anything is copied.
    """
    left = right.copy()
    left.data = right.data.copy()
    bpy.context.scene.collection.objects.link(left)
    left.name = name
    left.data.name = name
    left.data.transform(Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0)))
    # Reflecting turns every triangle inside out, and Babylon culls back faces.
    left.data.flip_normals()
    left.data.update()
    for group in left.vertex_groups:
        if group.name.endswith("_r"):
            group.name = group.name[:-2] + "_l"
    missing = [g.name for g in left.vertex_groups if g.name not in rig.data.bones]
    if missing:
        raise SystemExit(f"{name}: mirrored onto bones that do not exist: {missing}")
    rebind(left, rig)
    return left


def split_greaves(suit, rig, name, below_knee, region=None):
    """Cut the suit's shins off into their own piece, below both knees.

    A sabaton carries its own shin plate, and the suit's greave inside it is
    the same radius give or take a centimetre, so worn together the two cross
    down the whole shin and the suit's ankle flange stands out through the boot.
    The runtime hides this piece under boots (`COVERED_BY` in `rig.ts`); the
    suit's edge left above then laps the sabaton rim from outside.
    """
    knee = sum((rig.matrix_world @ rig.data.bones[b].head_local).z
               for b in ("calf_l", "calf_r")) / 2
    z = knee - below_knee
    shin = suit.copy()
    shin.data = suit.data.copy()
    for coll in suit.users_collection:
        coll.objects.link(shin)
    shin.name = name
    shin.data.name = name
    M = suit.matrix_world
    kept = cut_donor(suit, M, Vector((0, 0, z)), Vector((0, 0, -1)), region=region)
    cut = cut_donor(shin, M, Vector((0, 0, z)), Vector((0, 0, 1)), region=region)
    if region is not None:
        # The copy keeps everything outside the region too; only the shins are its.
        _cut_verts(shin, [v.index for v in shin.data.vertices
                          if not region(M @ v.co) or (M @ v.co).z > z + 1e-4])
    if not kept or not cut:
        raise SystemExit(f"the greave plane at {z:.4f} m left one side empty")
    scraps = _drop_islands_below(suit, M, z)
    return {"greave_cut_z": round(z, 4), "greave_below_knee_mm": round(below_knee * 1000, 1),
            "greave_scrap_verts_dropped": scraps,
            "greave_triangles": sum(len(p.vertices) - 2 for p in shin.data.polygons)}


def assert_symmetric(rig):
    """Every `_r` bone is its `_l` twin reflected across x = 0, or a mirrored
    piece lands beside the limb it is meant to be on rather than around it."""
    worst, who = 0.0, None
    pairs = 0
    for bone in rig.data.bones:
        if not bone.name.endswith("_r"):
            continue
        twin = rig.data.bones.get(bone.name[:-2] + "_l")
        if twin is None:
            raise SystemExit(f"{bone.name} has no left twin on {rig.name}")
        pairs += 1
        for a, b in ((bone.head_local, twin.head_local), (bone.tail_local, twin.tail_local)):
            a = rig.matrix_world @ a
            b = rig.matrix_world @ b
            d = (Vector((-a.x, a.y, a.z)) - b).length
            if d > worst:
                worst, who = d, bone.name
    if worst > 1e-4:
        raise SystemExit(f"{rig.name} is not symmetric: {who} is off by {worst * 1000:.2f} mm")
    return pairs, worst


def _channel_image(socket):
    """The image and RGB index feeding a BSDF socket through a glTF ORM Separate Color node."""
    if not socket.links:
        return None
    src = socket.links[0]
    node = src.from_node
    if node.type != "SEPARATE_COLOR":
        raise SystemExit(f"cannot matte {socket.name}: unexpected source {node.type}")
    channel = {"Red": 0, "Green": 1, "Blue": 2}[src.from_socket.name]
    tex = node.inputs[0].links[0].from_node
    return tex.image, channel


def _transform_channel(socket, fn):
    """Apply a vectorized 0..1 -> 0..1 map to a socket's texture channel, or its scalar."""
    found = _channel_image(socket)
    if found is None:
        socket.default_value = float(fn(np.array([socket.default_value]))[0])
        return
    image, channel = found
    px = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(-1, image.channels)
    px[:, channel] = fn(px[:, channel])
    image.pixels.foreach_set(px.ravel())
    image.update()


def matte(mesh):
    """Raise the roughness floor and cap peak metallic so donor steel stops reading as latex."""
    mat = mesh.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    _transform_channel(bsdf.inputs["Roughness"],
                        lambda v: MATTE_ROUGHNESS_FLOOR + v * (1 - MATTE_ROUGHNESS_FLOOR))
    _transform_channel(bsdf.inputs["Metallic"], lambda v: np.minimum(v, MATTE_METALLIC_CAP))


def build_rigid_gear(rig, body):
    """Fit, skin and name every rigid piece against one built look."""
    fitted = {}
    pairs, off = assert_symmetric(rig)
    print(f"{rig.name}: {pairs} mirrored bone pairs, worst {off * 1000:.4f} mm off centre")
    for spec in RIGID_GEAR:
        path = os.path.join(GEAR_SRC, spec["src"])
        if not os.path.exists(path):
            raise SystemExit(f"missing gear source: {path}")
        objs = import_gltf(spec["src"], root=GEAR_SRC)
        meshes = [o for o in objs if o.type == "MESH"]
        if len(meshes) != 1:
            raise SystemExit(f"{spec['src']}: expected one mesh, got {len(meshes)}")
        donor = meshes[0]
        for other in objs:
            if other is not donor:
                drop(other)
        bake_transform(donor)
        # A decoded shell is welded and closed BEFORE it is measured, so the
        # fitter reads one surface; it is shaded smooth AFTER the cuts, so the
        # rims they leave get the same normals as the plate beside them.
        if spec.get("clean"):
            detail_clean = weld_donor(donor, DONOR_WELD, DONOR_OPENINGS)
        if spec.get("symmetric"):
            symmetrise(donor, "-x" if spec["symmetric"] == "-x" else "+x")
        M, detail = FITTERS[spec["fit"]](donor, body, rig, **spec.get("fit_args", {}))
        donor.data.transform(M)
        donor.data.update()
        if spec.get("clean"):
            detail_clean.update(smooth_donor(donor, body, DONOR_SMOOTH_ANGLE))
            detail.update(detail_clean)
        stem = f"{spec['slot']}.{spec['look']}.{spec['part']}"
        # A mirrored piece is worn on both limbs, so the fitted one says which
        # side it was measured against and the reflection carries the other.
        donor.name = f"{stem}_r" if spec.get("mirror") else stem
        donor.data.name = donor.name
        # Before the copy, and once: the halves share one material, so matteing
        # after the mirror would run the texture through the map twice.
        if spec.get("matte"):
            matte(donor)
        # A scanned suit is an open shell: the neck, the armholes, the hem and
        # the two sleeve mouths are rings it simply stops at, and a culled
        # backface turns each into a black cavity. Steel from inside is steel.
        if spec.get("twosided"):
            for mat in donor.data.materials:
                mat.use_backface_culling = False
        # Split before skinning: each cap is bound rigidly to its own upper arm,
        # and the shell left over never spans a shoulder joint again.
        caps = []
        if spec.get("split_arms"):
            caps = split_arm_plates(donor, body, rig, spec["split_arms"], PLATE_BONES,
                                    f"{spec['slot']}.{spec['look']}.pauldron",
                                    PLATE_SPLIT_AT, PLATE_SPLIT_MARGIN,
                                    PLATE_CAP_STANDOFF, PLATE_CAP_INBOARD)
        for piece, bone in caps:
            skin_to_bone(piece, rig, bone)
            cap_tris = sum(len(p.vertices) - 2 for p in piece.data.polygons)
            fitted[piece.name] = dict(detail, bone=bone, fit=spec["fit"],
                                      triangles=cap_tris, source=spec["src"],
                                      split_from=stem, split_at_weight=PLATE_SPLIT_AT,
                                      overlap_band_mm=PLATE_SPLIT_MARGIN * 2000)
            print(f"fitted {piece.name}: {cap_tris} tris rigid on {bone}")
        if spec.get("deform"):
            groups = skin_by_transfer(donor, body, rig, spec["deform"])
            detail["deform_bones"] = list(spec["deform"])
            detail["deform_groups"] = groups
        else:
            skin_to_bone(donor, rig, spec["bone"])
        if spec.get("skirt") is not None:
            detail.update(skin_skirt(donor, body, rig, spec["skirt"]))
        if spec.get("greaves"):
            region = None
            if spec["greaves"] == "shins":
                shins = [(rig.matrix_world @ rig.data.bones[b].head_local,
                          limb_radius(rig, body, b, 1.0)[1]
                          * spec.get("greave_radius", SOFT_GREAVE_RADIUS))
                         for b in ("calf_l", "calf_r")]
                region = lambda p: any(math.hypot(p.x - c.x, p.y - c.y) <= r for c, r in shins)
            detail.update(split_greaves(donor, rig, f"{spec['slot']}.{spec['look']}.greave",
                                        SUIT_GREAVE_BELOW_KNEE, region))
        tris = sum(len(p.vertices) - 2 for p in donor.data.polygons)
        detail.update({"bone": spec["bone"], "fit": spec["fit"], "triangles": tris,
                       "source": spec["src"]})
        fitted[donor.name] = detail
        print(f"fitted {donor.name}: {tris} tris on {spec['bone']}")
        if spec.get("mirror"):
            left = mirrored(donor, rig, f"{stem}_l")
            fitted[left.name] = dict(
                detail, bone=spec["bone"][:-2] + "_l", mirrored_from=donor.name,
                deform_bones=[b[:-2] + "_l" for b in spec.get("deform", ())],
                deform_groups=len(left.vertex_groups),
            )
            print(f"mirrored {left.name}: {tris} tris on {spec['bone'][:-2] + '_l'}")
    return fitted


# --------------------------------------------------------------------------
# Skirt chains
#
# Cloth below the hips is not skinned to the legs: a thigh rotation is rigid
# about the hip, so a hem on it sweeps in phase with the knee and reads as two
# stiff blades. It hangs on a ring of bone chains under the pelvis instead,
# which nothing animates; `render/skirt.ts` solves them at runtime and the
# cloth lags the body. Counts must match `SKIRT_CHAINS`/`SKIRT_JOINTS` in
# `render/rig.ts`; `rig.test.ts` pins the pair.
SKIRT_CHAINS = 32
SKIRT_JOINTS = 3
SKIRT_JOINT = "skirt_{i}_{n:02d}"
# Height down the chain (0 hip, 1 hem) that stays welded to the pelvis.
SKIRT_PINNED = 0.20
# Cloth thickness added to every measured leg radius the solver collides with.
SKIRT_CLOTH = 0.008
# Heights the cloth column's radius is measured at, and how many times the ring
# of them is averaged with its neighbours.
SKIRT_BANDS = 6
SKIRT_SMOOTH = 2
SKIRT_COLLIDERS = (("thigh_l", "calf_l"), ("thigh_r", "calf_r"),
                   ("calf_l", "foot_l"), ("calf_r", "foot_r"),
                   ("foot_l", "ball_l"), ("foot_r", "ball_r"))


def _leg_segments(rig):
    return {b: (rig.matrix_world @ rig.data.bones[b].head_local,
                rig.matrix_world @ rig.data.bones[b].tail_local)
            for b in ("thigh_l", "thigh_r", "calf_l", "calf_r")}


def _seg_distance(p, head, tail):
    axis = tail - head
    t = max(0.0, min(1.0, (p - head).dot(axis) / axis.length_squared))
    return (p - (head + axis * t)).length


def collider_radii(rig, body):
    """Maximum radial extent of the skin about each leg bone, plus cloth."""
    out = {}
    for head_bone, tail_bone in SKIRT_COLLIDERS:
        head = rig.matrix_world @ rig.data.bones[head_bone].head_local
        tail = rig.matrix_world @ rig.data.bones[tail_bone].head_local
        radii = sorted(_seg_distance(p, head, tail) for p in group_points(body, head_bone, 0.35))
        # The thigh takes its median: its maximum is the buttock, and a capsule
        # that wide cages the waist. A calf and a foot are their maximum.
        r = radii[len(radii) // 2] if head_bone.startswith("thigh") else radii[-1]
        out[f"{head_bone}->{tail_bone}"] = round(r + SKIRT_CLOTH, 4)
    return out


def _run_length(path):
    """Cumulative length along a (z, radius) polyline."""
    run = [0.0]
    for (z0, r0), (z1, r1) in zip(path, path[1:]):
        run.append(run[-1] + math.hypot(z1 - z0, r1 - r0))
    return run


def _circle_hit(a, b, centre, radius, u_min):
    """Where the segment a->b first leaves a circle, as a fraction of it."""
    dz, dr = b[0] - a[0], b[1] - a[1]
    aa = dz * dz + dr * dr
    if aa <= 0.0:
        return None
    fz, fr = a[0] - centre[0], a[1] - centre[1]
    half_b = fz * dz + fr * dr
    c = fz * fz + fr * fr - radius * radius
    disc = half_b * half_b - aa * c
    if disc < 0.0:
        return None
    root = math.sqrt(disc)
    for u in sorted(((-half_b - root) / aa, (-half_b + root) / aa)):
        if u_min <= u <= 1.0:
            return u
    return None


def _walk(path, segment):
    """`SKIRT_JOINTS` + 1 knots down a (z, radius) polyline, each one `segment`
    in a STRAIGHT line from the last - a chord, not an arc, because the runtime
    reads one bone length for the whole ring. A path that runs out keeps going
    along its last direction."""
    knots = [path[0]]
    k, u = 0, 0.0
    for _ in range(SKIRT_JOINTS):
        centre = knots[-1]
        hit, j, start = None, k, u
        while j < len(path) - 1 and hit is None:
            t = _circle_hit(path[j], path[j + 1], centre, segment, start)
            hit = None if t is None else (j, t)
            j, start = j + 1, 0.0
        if hit is None:
            (z0, r0), (z1, r1) = path[-2], path[-1]
            step = math.hypot(z1 - z0, r1 - r0) or 1.0
            knots.append((centre[0] + (z1 - z0) / step * segment,
                          centre[1] + (r1 - r0) / step * segment))
            k, u = len(path) - 2, 1.0
            continue
        k, u = hit
        knots.append((path[k][0] + (path[k + 1][0] - path[k][0]) * u,
                      path[k][1] + (path[k + 1][1] - path[k][1]) * u))
    return knots


def skirt_columns(cloth, centre, top_z, hem_z):
    """Per sector, the cloth column's own median radius sampled down its height.

    The chain has to lie inside the cloth it drives: a ring hung at hip radius
    leaves a flared hem further from its own chain than any leg capsule is wide,
    so the solver collides a line inside the leg while the visible cloth trails
    behind the heel. Returns one (z, radius) knot list per chain, all walked at
    the same segment length, and that length.
    """
    span = top_z - hem_z
    step = 2.0 * math.pi / SKIRT_CHAINS
    bands = [[[] for _ in range(SKIRT_BANDS)] for _ in range(SKIRT_CHAINS)]
    for _, p in cloth:
        i = int(math.atan2(p.y - centre.y, p.x - centre.x) % (2 * math.pi) / step) % SKIRT_CHAINS
        b = min(SKIRT_BANDS - 1, max(0, int((top_z - p.z) / span * SKIRT_BANDS)))
        bands[i][b].append(math.hypot(p.x - centre.x, p.y - centre.y))
    ring = []
    for col in bands:
        med = [sorted(rs)[len(rs) // 2] if rs else None for rs in col]
        seen = [b for b, r in enumerate(med) if r is not None]
        if not seen:
            raise SystemExit("a skirt sector caught no cloth at any height")
        ring.append([med[min(seen, key=lambda k: abs(k - b))] for b in range(SKIRT_BANDS)])
    # A column is a few hundred vertices and a garment has folds, so one noisy
    # sector would kink the chain beside it; the neighbours average it out.
    for _ in range(SKIRT_SMOOTH):
        ring = [[(ring[(i - 1) % SKIRT_CHAINS][b] + 2 * r + ring[(i + 1) % SKIRT_CHAINS][b]) / 4
                 for b, r in enumerate(col)] for i, col in enumerate(ring)]
    zs = [top_z - span * (b + 0.5) / SKIRT_BANDS for b in range(SKIRT_BANDS)]
    paths = [[(top_z, col[0])] + list(zip(zs, col)) + [(hem_z, col[-1])] for col in ring]
    lengths = sorted(_run_length(path)[-1] for path in paths)
    segment = lengths[len(lengths) // 2] / SKIRT_JOINTS
    return [_walk(path, segment) for path in paths], segment


def build_skirt_bones(rig, columns, centre, segment):
    """A ring of chains hanging off the pelvis, one per cloth column, each
    bone the same length so the runtime reads one segment off the asset.
    `columns[i]` is chain i's (z, radius) knots about the hip axis."""
    to_local = rig.matrix_world.inverted()
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = rig.data.edit_bones
    made = []
    for i, column in enumerate(columns):
        theta = 2.0 * math.pi * i / SKIRT_CHAINS
        c, s_ = math.cos(theta), math.sin(theta)
        knots = [Vector((centre.x + r * c, centre.y + r * s_, z)) for z, r in column]
        parent = bones["pelvis"]
        for n in range(SKIRT_JOINTS):
            off = abs((knots[n + 1] - knots[n]).length - segment)
            if off > 1e-4:
                raise SystemExit(f"skirt_{i}_{n + 1:02d} is {off * 1000:.2f} mm off the ring's "
                                 f"segment: the runtime reads one length for all of them")
            bone = bones.new(SKIRT_JOINT.format(i=i, n=n + 1))
            bone.head = to_local @ knots[n]
            bone.tail = to_local @ knots[n + 1]
            bone.parent = parent
            bone.use_connect = n > 0
            parent = bone
            made.append(bone.name)
    bpy.ops.object.mode_set(mode="OBJECT")
    hems = [column[-1][0] for column in columns]
    print(f"built {len(columns)} skirt chains ({len(made)} joints), segment {segment:.4f}, "
          f"z {columns[0][0][0]:.3f} -> {min(hems):.3f}..{max(hems):.3f}")
    return made


def skin_skirt(mesh, body, rig, clear):
    """Hand the cloth below the hips to the skirt chains.

    A vertex is cloth when it hangs below the pelvis and sits more than `clear`
    thigh radii off every leg bone. 0 takes everything below the hip, for a
    closed robe with no trousers under it; a coat over trousers (`clear` > 0)
    ends at the knee plane the greave is cut on, and the trousers under it stay
    on the legs. The ring itself always runs from the hip to the donor's ankle
    cut, so a floor-length robe folds at every joint whichever piece laid the
    ring out; the first skirted piece in `RIGID_GEAR` lays the ring out from its
    own cloth and later pieces bind to the same bones, so the piece whose cloth
    runs lowest is listed first.
    """
    M = mesh.matrix_world
    legs = _leg_segments(rig)
    r_thigh = limb_radius(rig, body, "thigh_l", 1.0)[1]
    pelvis_head = rig.matrix_world @ rig.data.bones["pelvis"].head_local
    top_z = pelvis_head.z
    knee = sum((rig.matrix_world @ rig.data.bones[b].head_local).z
               for b in ("calf_l", "calf_r")) / 2
    floor_z = knee - SUIT_GREAVE_BELOW_KNEE if clear > 0 else None
    hem_z = min((M @ v.co).z for v in mesh.data.vertices)
    span = top_z - hem_z
    cloth = []
    for v in mesh.data.vertices:
        p = M @ v.co
        if p.z >= top_z or (floor_z is not None and p.z < floor_z):
            continue
        if clear > 0 and min(_seg_distance(p, h, t) for h, t in legs.values()) < r_thigh * clear:
            continue
        cloth.append((v, p))
    if not cloth:
        raise SystemExit(f"{mesh.name}: nothing below the hip reads as cloth")
    if SKIRT_JOINT.format(i=0, n=1) not in rig.data.bones:
        # A column is measured from the cloth that hangs FREE of the legs: what
        # lies inside a capsule is the solver's to push out, and counting it
        # pulls the chain off the drape it is there to carry.
        radii = collider_radii(rig, body)
        capsules = [(rig.matrix_world @ rig.data.bones[h].head_local,
                     rig.matrix_world @ rig.data.bones[t].head_local, radii[f"{h}->{t}"])
                    for h, t in SKIRT_COLLIDERS]
        hanging = [(v, p) for v, p in cloth
                   if all(_seg_distance(p, h, t) > r for h, t, r in capsules)]
        columns, segment = skirt_columns(hanging, pelvis_head, top_z, hem_z)
        build_skirt_bones(rig, columns, pelvis_head, segment)

    names = ["pelvis"] + [SKIRT_JOINT.format(i=i, n=n + 1)
                          for i in range(SKIRT_CHAINS) for n in range(SKIRT_JOINTS)]
    groups = {n: mesh.vertex_groups.get(n) or mesh.vertex_groups.new(name=n) for n in names}
    knots = [SKIRT_PINNED + (1.0 - SKIRT_PINNED) * (n + 1) / SKIRT_JOINTS
             for n in range(SKIRT_JOINTS)]
    step = 2.0 * math.pi / SKIRT_CHAINS
    for v, p in cloth:
        for g in mesh.vertex_groups:
            g.remove([v.index])
        t = min(1.0, max(0.0, (top_z - p.z) / span))
        pinned = min(1.0, max(0.0, (SKIRT_PINNED - t) / SKIRT_PINNED))
        weights = [0.0] * SKIRT_JOINTS
        if t <= knots[0]:
            weights[0] = 1.0
        elif t >= knots[-1]:
            weights[-1] = 1.0
        else:
            n = next(k for k in range(SKIRT_JOINTS - 1) if t < knots[k + 1])
            f = (t - knots[n]) / (knots[n + 1] - knots[n])
            weights[n], weights[n + 1] = 1.0 - f, f
        weights = [w * (1.0 - pinned) for w in weights]
        theta = math.atan2(p.y - pelvis_head.y, p.x - pelvis_head.x) % (2 * math.pi)
        exact = theta / step
        near = math.floor(exact)
        blend = exact - near
        if pinned > 0:
            groups["pelvis"].add([v.index], pinned, "REPLACE")
        for chain, share in ((near % SKIRT_CHAINS, 1.0 - blend),
                             ((near + 1) % SKIRT_CHAINS, blend)):
            if share <= 0.0:
                continue
            for n, w in enumerate(weights):
                if w > 0.0:
                    groups[SKIRT_JOINT.format(i=chain, n=n + 1)].add(
                        [v.index], w * share, "REPLACE")
    rebind(mesh, rig)
    print(f"  {mesh.name}: {len(cloth)} cloth vertices on {SKIRT_CHAINS} chains, "
          f"hip {top_z:.3f} hem {hem_z:.3f}")
    return {"skirt_vertices": len(cloth), "skirt_top_z": round(top_z, 4),
            "skirt_hem_z": round(hem_z, 4), "skirt_clear": clear,
            "skirt_floor_z": None if floor_z is None else round(floor_z, 4),
            "skirt_cloth_hem_z": round(min(p.z for _, p in cloth), 4),
            "skirt_colliders": collider_radii(rig, body)}


# --------------------------------------------------------------------------
# Trousers
#
# The leather under the plate is not a donor and not a fit: it IS the body's own
# leg surface, duplicated and pushed out along its normals. Every vertex keeps
# the weights the skin it was cut from carries, so the trousers deform with the
# leg the way the leg deforms and cannot clip through it at any pose - which no
# generated garment, however well fitted in the rest pose, can promise.
#
# The waist and the ankle rims are left open on purpose: the fauld covers the
# one and the sabaton cuff swallows the other, and a closed rim there is two
# surfaces fighting over the same millimetre.

LEG_BONES = ("pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r")
TROUSER_WEIGHT = 0.5        # summed leg weight a body vertex needs to be trousers
TROUSER_OFFSET = 0.004      # how far the leather stands off the skin, metres
TROUSER_FLOOR = 0.0005      # and the least it may be pulled back to, metres
TROUSER_WAIST = 0.02        # above the top of the pelvis; the fauld hides the rim
# The sabaton is skinned OUTSIDE the shin, and its own fit reports a 0.58 mm
# first-percentile gap to the skin - so a flat 4 mm push would stand the leather
# through the boot wall. Every vertex is capped by the air actually measured to
# the fitted boot instead of by a rule about where the knee is.
TROUSER_BOOT_AIR = 0.0005   # air kept between the leather and a sabaton's inner face
TROUSER_BOOT_REACH = 0.05   # past this a boot is not near enough to cap anything
# The suit's fauld hangs over the same thighs, so it caps the leather exactly the
# way a boot does. It is the same measurement and the same floor: the trousers
# are built AFTER the rigid gear, so both shells are already in the scene and
# neither clearance is a rule about where a hem is.
TROUSER_SHELLS = ("boots.", "chest.plate.cuirass")
TROUSER_SAFE = 0.45         # share of its own headroom a vertex may take (the crotch)
TROUSER_TILE = 3.5          # grain repeats over the unwrapped leg
TROUSER_TRIS = 6000
LEATHER_BLEND = "D:/VSC/exiled-casual/assets/props/source/mat-aged-dark-leather.blend"
LEATHER_ID = "d583c044-b586-4ecf-b3a1-12de1d032b3f"
LEATHER_NAME = "Aged Dark Leather"
LEATHER_FALLBACK = (0.06, 0.05, 0.04, 1.0)
LEATHER_ROUGHNESS = 0.75


def tiled_material(name, blend, fallback, roughness, metallic):
    """A BlenderKit material rebuilt as plain image textures into the BSDF.

    The donor's own tree carries mapping and displacement the glTF exporter
    drops, so the maps are relinked here. No `matte()` pass: that map exists to
    stop donor steel reading as latex, and a tiled material is authored flat.
    """
    imgs = {}
    if os.path.exists(blend):
        with bpy.data.libraries.load(blend) as (df, dt):
            dt.images = list(df.images)
        for im in dt.images:
            if im is None:
                continue
            for key in ("Color", "Roughness", "Normal", "Metallic"):
                if key.lower() in im.name.lower():
                    imgs[key] = im
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Metallic"].default_value = metallic
    if not {"Color", "Roughness", "Normal"} <= set(imgs):
        print(f"  {name}: only {sorted(imgs)} in {blend}, flat fallback")
        bsdf.inputs["Base Color"].default_value = fallback
        bsdf.inputs["Roughness"].default_value = roughness
        return mat, False

    def tex(key, y, colour):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = imgs[key]
        n.location = (-700, y)
        n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        return n

    nt.links.new(tex("Color", 300, True).outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex("Roughness", 0, False).outputs["Color"], bsdf.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.location = (-400, -300)
    nt.links.new(tex("Normal", -300, False).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if "Metallic" in imgs:
        nt.links.new(tex("Metallic", -600, False).outputs["Color"], bsdf.inputs["Metallic"])
    return mat, True


def leather_material():
    mat, textured = tiled_material("trouser_leather", LEATHER_BLEND, LEATHER_FALLBACK,
                                   LEATHER_ROUGHNESS, 0.0)
    return mat, LEATHER_ID if textured else None


def build_trousers(rig, body, worn):
    """Cut the legs off the body, push them out, and call the result leather.

    `worn` is every piece already fitted on this body: the boots among them are
    what the offset has to stay inside, and they are measured rather than
    assumed.
    """
    name = "chest.plate.legs"
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    bpy.context.scene.collection.objects.link(obj)
    obj.data.transform(body.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)
    while obj.data.materials:
        obj.data.materials.pop()

    missing = [b for b in LEG_BONES if b not in obj.vertex_groups]
    if missing:
        raise SystemExit(f"{name}: the body carries no groups for {missing}")
    keep = {obj.vertex_groups[b].index for b in LEG_BONES}
    pelvis = rig.data.bones["pelvis"]
    waist_z = max((rig.matrix_world @ pelvis.head_local).z,
                  (rig.matrix_world @ pelvis.tail_local).z) + TROUSER_WAIST
    ankle_z = min((rig.matrix_world @ rig.data.bones["foot_" + s].head_local).z
                  for s in "lr")

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.active
    doomed = [v for v in bm.verts
              if sum(w for gi, w in v[dl].items() if gi in keep) < TROUSER_WEIGHT
              or not ankle_z <= v.co.z <= waist_z]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    if not bm.faces:
        bm.free()
        raise SystemExit(f"{name}: the weight and height cuts left no leg surface")
    bm.normal_update()

    shells = [(o.name, bvh_of(o)) for o in worn
              if any(o.name.startswith(pre) for pre in TROUSER_SHELLS)]
    room = surface_headroom(bm)
    pushed, capped_by_shell, capped_by_self, tightest = [], 0, 0, None
    # Per shell, so the fauld's clearance is its own number rather than lost in a
    # minimum the boots usually win.
    per_shell = {name: [] for name, _ in shells}
    for i, v in enumerate(bm.verts):
        want = TROUSER_OFFSET
        # `surface_headroom` reports its own reach when it found nothing, and
        # that is not a measurement - only a vertex that actually saw another
        # part of the leg is held back by it.
        if room[i] < 0.02 - 1e-9:
            held = max(TROUSER_FLOOR, room[i] * TROUSER_SAFE)
            if held < want:
                want = held
                capped_by_self += 1
        near, seen = None, []
        for shell, bvh in shells:
            hit = bvh.find_nearest(v.co, TROUSER_BOOT_REACH)
            if hit[0] is None:
                continue
            seen.append((shell, hit[3]))
            if near is None or hit[3] < near:
                near = hit[3]
        if near is not None:
            # No floor under this one, unlike the crease cap: where a worn shell
            # is closer to the skin than the air it wants, the leather stays ON
            # the skin. It is under steel there, so nothing is lost, and pushing
            # it out regardless is what puts leather through a fauld.
            allowed = max(0.0, near - TROUSER_BOOT_AIR)
            if allowed < want - 1e-9:
                want = allowed
                capped_by_shell += 1
            left = near - want
            tightest = left if tightest is None else min(tightest, left)
            for shell, d in seen:
                per_shell[shell].append(d - want)
        v.co += v.normal * want
        pushed.append(want)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    ratio = 1.0
    if tris > TROUSER_TRIS:
        ratio = TROUSER_TRIS / tris
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = ratio
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)

    # The weights are already exact - these are the body's own vertices - so
    # nothing is transferred. Everything outside the leg set is dropped and the
    # survivors renormalised, or a stray spine weight tears the seat upward.
    spine = False
    if "spine_01" in obj.vertex_groups:
        gi = obj.vertex_groups["spine_01"].index
        spine = any(gi in {g.group for g in v.groups} for v in obj.data.vertices)
    bones = LEG_BONES + (("spine_01",) if spine else ())
    for group in list(obj.vertex_groups):
        if group.name not in bones:
            obj.vertex_groups.remove(group)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    orphans = [v.index for v in obj.data.vertices if not v.groups]
    if orphans:
        raise SystemExit(f"{name}: {len(orphans)} vertices carry no leg weight")
    rebind(obj, rig)

    # The body's own UVs address the skin atlas, so they are thrown away: a
    # leather tile read through them would paint a face across a thigh.
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    for d in obj.data.uv_layers.active.data:
        d.uv = (d.uv[0] * TROUSER_TILE, d.uv[1] * TROUSER_TILE)
    mat, asset = leather_material()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True

    n = len(pushed)
    order = sorted(pushed)
    # Per shell, as a profile rather than a minimum, for the reason `gap_profile`
    # gives: one vertex grazing worn steel is not a fault anybody can see, and on
    # a surface cut out of a scanned body there is always one. The 1st percentile
    # is what a patch of leather through the fauld would move.
    air_profile = {}
    for shell, airs in per_shell.items():
        if not airs:
            continue
        order_air = sorted(airs)
        air_profile[shell] = {
            "vertices": len(order_air),
            "min_mm": round(order_air[0] * 1000, 3),
            "p01_mm": round(order_air[len(order_air) // 100] * 1000, 3),
            "median_mm": round(order_air[len(order_air) // 2] * 1000, 3),
        }
    air = "n/a" if tightest is None else "%.2f mm" % (tightest * 1000)
    print(f"fitted {name}: {tris} tris, {n} verts, offset min {order[0]*1000:.2f} "
          f"p01 {order[n//100]*1000:.2f} median {order[n//2]*1000:.2f} max "
          f"{order[-1]*1000:.2f} mm, {capped_by_shell} capped by worn steel, "
          f"{capped_by_self} by their own crease, tightest air {air}, "
          f"per shell {air_profile}")
    fauld = air_profile.get("chest.plate.cuirass")
    if fauld is None:
        raise SystemExit(f"{name}: no trouser vertex is within {TROUSER_BOOT_REACH} m "
                         "of the suit's fauld to measure against")
    # Zero, not the air the boots keep: the leather cannot be held off a shell
    # that is already inside the skin it was cut from - that clearance is the
    # SUIT's, measured in its own fit - so what this gate can honestly ask is
    # that no band of leather stands through the fauld.
    if fauld["p01_mm"] < 0.0:
        raise SystemExit(f"{name}: leather stands {-fauld['p01_mm']:.2f} mm through the "
                         "fauld at its 1st percentile")
    return {name: {
        "built_from": "base.male.body leg weights, offset along its own normals",
        "source": "body",
        "offset_mm": TROUSER_OFFSET * 1000,
        "offset_min_mm": round(order[0] * 1000, 3),
        "offset_p01_mm": round(order[n // 100] * 1000, 3),
        "offset_median_mm": round(order[n // 2] * 1000, 3),
        "shell_capped_vertices": capped_by_shell,
        "crease_capped_vertices": capped_by_self,
        "shell_air_min_mm": None if tightest is None else round(tightest * 1000, 3),
        "worn_shell_air": air_profile,
        "waist_z": round(waist_z, 4), "ankle_z": round(ankle_z, 4),
        "vertices": len(obj.data.vertices), "triangles": tris,
        "decimate_ratio": round(ratio, 4),
        "uv_tiles": TROUSER_TILE,
        "bone": "pelvis", "fit": "body_offset",
        "deform_bones": list(bones), "deform_groups": len(obj.vertex_groups),
        "texture": {"blenderkit_id": asset, "blenderkit_name": LEATHER_NAME},
    }}


# --------------------------------------------------------------------------
# Gorget plate
#
# The v9 suit has no steel over the trapezius: its collar is a narrow block
# round the throat, so from behind the skin showed as two wedges from the ring
# out to each pauldron. No cut height fixes an absence, so the plate over the
# collar region is built the way the trousers were: the body's own clavicle
# surface, duplicated and pushed out along its normals, wearing the body's own
# weights so it moves with the shoulders and cannot clip through them.

GORGET_OFFSET = 0.005       # how far the plate stands off the skin, metres
GORGET_FLOOR = 0.0005       # and the least a crease may pull it back to, metres
GORGET_SAFE = 0.45          # share of its own headroom a vertex may take
GORGET_SHELL_AIR = 0.0005   # air kept between the plate and worn steel over it
GORGET_SHELL_REACH = 0.05   # past this a worn shell is not near enough to cap
# Every chest look carries its own gorget and backing, cut from the body and
# coloured off that look's own shell: `shell` -> (shell, its pauldron caps).
CHEST_SHELLS = {
    "plate": "chest.plate.cuirass",
    "leather": "chest.leather.coat",
    "robe": "chest.robe.robe",
}
SOFT_METALLIC = 0.0         # a leather or cloth collar plate is not steel
BACKING_AIR = 0.003         # the torso backing stops this far under the cuirass
BACKING_REACH = 0.15        # and looks this far out along its normal for it
# A soft suit's backing also stands under the HOLES in its shell: a vertex whose
# normal meets no shell is still backed, at the collar plate's offset, when the
# shell is within this distance. Past it the skin is genuinely bare.
BACKING_NEAR = 0.02
# A cuirass stands a median 23 mm off the ribs where a coat lies on them, so a
# torso vertex reading its own tear's rim has to look that much further. The
# plate's torso is covered edge to edge, so anything this misses is a tear.
BACKING_NEAR_PLATE = 0.06
# And it reaches no further than this along a normal: a thigh's normal meets the
# coat's skirt flap 14 cm out, and a backing pushed there is a shard between
# the knees. Trousers and sleeves sit within a few centimetres of the skin.
SOFT_BACKING_REACH = 0.04
SOFT_BACKED_REGIONS = ("torso", "arm_l", "arm_r", "leg_l", "leg_r")
GORGET_TILE = 2.0           # steel grain repeats over the unwrapped plate
STEEL_BLEND = "D:/VSC/exiled-casual/assets/props/source/mat-aged-black-steel.blend"
STEEL_ID = "8352b3b2-edb7-4700-a9d6-055ab6ec9233"
STEEL_NAME = "Aged Black Steel"
STEEL_FALLBACK = (0.18, 0.18, 0.19, 1.0)
STEEL_ROUGHNESS = 0.55
STEEL_METALLIC = 0.7
# The black steel is rusted and speckled beside a clean grey cuirass, so its
# albedo takes the cuirass's own mean colour, keeping this share of its grain.
STEEL_GRAIN = 0.15
STEEL_NORMAL = 0.35         # normal map strength; full strength reads as fur


LUMA = np.array((0.2126, 0.7152, 0.0722), dtype=np.float32)


def cuirass_albedo(worn, shell):
    """Mean base colour of the worn shell, sampled at its own UVs so the
    atlas's empty padding does not count."""
    obj = next(o for o in worn if o.name.startswith(shell))
    bsdf = next(n for n in obj.data.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = bsdf.inputs["Base Color"].links
    if not link:
        return np.array(bsdf.inputs["Base Color"].default_value[:3], dtype=np.float32)
    image = link[0].from_node.image
    w, h = image.size
    px = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, image.channels)[:, :, :3]
    uv = np.empty(len(obj.data.uv_layers.active.data) * 2, dtype=np.float32)
    obj.data.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2) % 1.0
    return px[(uv[:, 1] * (h - 1)).astype(int), (uv[:, 0] * (w - 1)).astype(int)].mean(axis=0)


def build_gorget(rig, body, worn, name="chest.plate.gorget", region="collar", fill=None,
                 shell="chest.plate.cuirass", metallic=STEEL_METALLIC, near=None,
                 reach=BACKING_REACH, keep=None):
    """Cut a body region off the body, push it out, and call it steel.

    The cut is exactly the piece `split_body_regions` will make, so hiding that
    piece under this plate leaves no skin uncovered and no crack. With `fill`, a
    shell name prefix, each vertex is pushed along its normal to just under that
    shell instead of a fixed offset: a backing that shows through its cracks.
    """
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    bpy.context.scene.collection.objects.link(obj)
    obj.data.transform(body.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)
    while obj.data.materials:
        obj.data.materials.pop()

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    core = region_cores(body, bm)[region]
    doomed = [f for f in bm.faces if not any(v.index in core for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    if not bm.faces:
        bm.free()
        raise SystemExit(f"{name}: the {region} region has no faces")
    if fill:
        # A body's torso is 924 vertices over a whole trunk, and a backing that
        # coarse cannot follow the rim of a tear in the shell it plugs: one cut
        # is what puts a vertex inside the tear rather than either side of it.
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    bm.normal_update()

    pushed, capped_by_shell, capped_by_self = [], 0, 0
    per_shell = {}
    if fill:
        backed = next((bvh_of(o) for o in worn if o.name.startswith(fill)), None)
        if backed is None:
            bm.free()
            raise SystemExit(f"{name}: no worn {fill} to back")
        missed = set()
        for v in bm.verts:
            hit = backed.ray_cast(v.co, v.normal, reach)
            want = 0.0 if hit[0] is None else max(0.0, hit[3] - BACKING_AIR)
            if hit[0] is None:
                side = backed.find_nearest(v.co, near) if near is not None else (None,)
                if keep is not None and keep(v.co):
                    want = GORGET_OFFSET
                elif side[0] is not None:
                    # A normal that leaves through a tear measures no steel. The
                    # nearest steel is the tear's own rim, and the backing is
                    # taken all the way OUT to it - no air, because here the
                    # backing is not under the plate but in the hole, and 3 mm
                    # short of the rim is the dark notch the tear reads as.
                    want = side[3]
                else:
                    missed.add(v)
            v.co += v.normal * want
            pushed.append(want)
        # Skin no steel stands over is not backed: it would stand out as steel.
        capped_by_shell = len(missed)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if any(v in missed for v in f.verts)],
                         context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    else:
        prefixes = (shell, shell.rsplit(".", 1)[0] + ".pauldron")
        shells = [(o.name, bvh_of(o)) for o in worn
                  if any(o.name.startswith(pre) for pre in prefixes)]
        room = surface_headroom(bm)
        per_shell = {shell: [] for shell, _ in shells}
        for i, v in enumerate(bm.verts):
            want = GORGET_OFFSET
            if room[i] < 0.02 - 1e-9:
                held = max(GORGET_FLOOR, room[i] * GORGET_SAFE)
                if held < want:
                    want = held
                    capped_by_self += 1
            near, seen = None, []
            for shell, bvh in shells:
                hit = bvh.find_nearest(v.co, GORGET_SHELL_REACH)
                if hit[0] is None:
                    continue
                seen.append((shell, hit[3]))
                if near is None or hit[3] < near:
                    near = hit[3]
            if near is not None:
                allowed = max(0.0, near - GORGET_SHELL_AIR)
                if allowed < want - 1e-9:
                    want = allowed
                    capped_by_shell += 1
                for shell, d in seen:
                    per_shell[shell].append(d - want)
            v.co += v.normal * want
            pushed.append(want)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    # The body's own vertices, so the weights are exact and nothing is
    # transferred; the groups nothing here uses are dropped for the report.
    used = set()
    for v in obj.data.vertices:
        used |= {g.group for g in v.groups if g.weight > 0.0}
    for name_ in [g.name for g in obj.vertex_groups if g.index not in used]:
        obj.vertex_groups.remove(obj.vertex_groups[name_])
    orphans = [v.index for v in obj.data.vertices if not v.groups]
    if orphans:
        raise SystemExit(f"{name}: {len(orphans)} vertices carry no weight")
    rebind(obj, rig)

    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    for d in obj.data.uv_layers.active.data:
        d.uv = (d.uv[0] * GORGET_TILE, d.uv[1] * GORGET_TILE)
    mat, textured = tiled_material(f"{name.replace('.', '_')}_steel", STEEL_BLEND,
                                   STEEL_FALLBACK, STEEL_ROUGHNESS, metallic)
    if textured:
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        image = bsdf.inputs["Base Color"].links[0].from_node.image
        px = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(px)
        px = px.reshape(-1, image.channels)
        target = cuirass_albedo(worn, shell)
        luma = px[:, :3] @ LUMA
        grain = 1.0 + (luma / max(float(luma.mean()), 1e-6) - 1.0) * STEEL_GRAIN
        px[:, :3] = np.clip(np.outer(grain, target), 0.0, 1.0)
        image.pixels.foreach_set(px.ravel())
        next(n for n in mat.node_tree.nodes if n.type == "NORMAL_MAP").inputs["Strength"].default_value = STEEL_NORMAL
        # The rust's roughness map blotches the highlight; the cuirass reads even.
        for link in list(bsdf.inputs["Roughness"].links):
            mat.node_tree.links.remove(link)
        bsdf.inputs["Roughness"].default_value = STEEL_ROUGHNESS
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True

    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    n = len(pushed)
    order = sorted(pushed)
    air_profile = {}
    for shell, airs in per_shell.items():
        if not airs:
            continue
        a = sorted(airs)
        air_profile[shell] = {
            "vertices": len(a),
            "min_mm": round(a[0] * 1000, 3),
            "p01_mm": round(a[len(a) // 100] * 1000, 3),
            "median_mm": round(a[len(a) // 2] * 1000, 3),
        }
    bones = sorted(g.name for g in obj.vertex_groups)
    print(f"fitted {name}: {tris} tris, {n} verts, offset min {order[0]*1000:.2f} "
          f"p01 {order[n//100]*1000:.2f} median {order[n//2]*1000:.2f} max "
          f"{order[-1]*1000:.2f} mm, {capped_by_shell} "
          f"{'under no steel' if fill else 'capped by worn steel'}, "
          f"{capped_by_self} by their own crease, bones {bones}, "
          f"per shell {air_profile}")
    return {name: {
        "built_from": f"base.male.body {region} region, "
                      + (f"filled out to {BACKING_AIR * 1000:.0f} mm under {fill}" if fill
                         else "offset along its own normals"),
        "source": "body",
        "offset_mm": None if fill else GORGET_OFFSET * 1000,
        "offset_min_mm": round(order[0] * 1000, 3),
        "offset_p01_mm": round(order[n // 100] * 1000, 3),
        "offset_median_mm": round(order[n // 2] * 1000, 3),
        "shell_capped_vertices": capped_by_shell,
        "crease_capped_vertices": capped_by_self,
        "worn_shell_air": air_profile,
        "vertices": len(obj.data.vertices), "triangles": tris,
        "uv_tiles": GORGET_TILE,
        "bone": "spine_03", "fit": "body_offset",
        "deform_bones": bones, "deform_groups": len(bones),
        "texture": {"blenderkit_id": STEEL_ID if textured else None,
                    "blenderkit_name": STEEL_NAME},
    }}


def main():
    clear_scene()
    built = {}
    for spec in LOOKS:
        parts = build_look(spec)
        missing = {"body", "eyes", "brows", "hair"} - set(parts)
        if missing:
            raise SystemExit(f"{spec['look']}: missing parts {sorted(missing)}")
        built[spec["look"]] = spec

    # Gear is fitted to the wired body only. The female ships unwired, and a
    # second copy of every piece would double the download for a look nothing
    # can select yet.
    male_rig = bpy.data.objects[MALE_RIG]
    male_body = bpy.data.objects["base.male.body"]
    fitted = build_rigid_gear(male_rig, male_body)
    worn = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("chest.")]
    # Each chest look closes the collar and the trunk, so each gets a collar
    # plate and a torso backing of its own colour. The v9 suit is cracked
    # through across the back: a backing filled out to just under it shows
    # steel through every crack instead of the void.
    for look, shell in CHEST_SHELLS.items():
        metallic = STEEL_METALLIC if look == "plate" else SOFT_METALLIC
        fitted.update(build_gorget(male_rig, male_body, worn, f"chest.{look}.gorget", "collar",
                                   shell=shell, metallic=metallic))
        if look == "plate":
            # A vertex whose own normal leaves through a tear meets no steel at
            # all, and unbacked it is the void the tear shows: the chevron in
            # the back plate. Steel within `BACKING_NEAR` of it is the tear's
            # own rim, so it is backed at the collar plate's offset.
            fitted.update(build_gorget(male_rig, male_body, worn, "chest.plate.backing", "torso",
                                       fill=shell, shell=shell, metallic=metallic,
                                       near=BACKING_NEAR_PLATE))
            # And the shoulder. The arm is bare skin under a pauldron, so with
            # the arm raised the rear quarter looks straight into the cap and
            # sees the shell's own inside. The deltoid is backed inboard of the
            # sleeve cut, which fills that view with steel and stays hidden
            # under the cap for every pose that does not open it.
            arm_edge = fitted[shell]["cut_pauldron_edge_x"] + SUIT_RIM_LIP
            for region in ("arm_l", "arm_r"):
                fitted.update(build_gorget(
                    male_rig, male_body, worn, f"chest.plate.backing_{region}", region,
                    fill=shell, shell=shell, metallic=metallic, near=BACKING_NEAR,
                    reach=SOFT_BACKING_REACH,
                    keep=lambda co, x=arm_edge: abs(co.x) <= x))
            continue
        fitted.update(build_gorget(male_rig, male_body, worn, f"chest.{look}.backing", "torso",
                                   fill=shell, shell=shell, metallic=metallic,
                                   near=BACKING_NEAR, reach=SOFT_BACKING_REACH))
        # A decoded coat is holed at the shoulder caps and the crotch, and the
        # skin under a hole is drawn; the backing stands under those too.
        # An arm is backed everywhere inboard of the sleeve cut, hole or not,
        # so the backing ends at the hem and never stands out below it.
        edge_x = fitted[shell]["cut_pauldron_edge_x"] + SUIT_RIM_LIP
        # A closed robe hands every vertex below the hip to the skirt chains,
        # and a leg plate under cloth that swings away stands out through it.
        closed_skirt = fitted[shell].get("skirt_clear") == 0.0
        for region in SOFT_BACKED_REGIONS[1:]:
            if closed_skirt and region.startswith("leg"):
                continue
            keep = (lambda co: abs(co.x) <= edge_x) if region.startswith("arm") else None
            fitted.update(build_gorget(male_rig, male_body, worn,
                                       f"chest.{look}.backing_{region}", region,
                                       fill=shell, shell=shell, metallic=metallic,
                                       near=BACKING_NEAR, reach=SOFT_BACKING_REACH, keep=keep))
    # The trousers are parked. They were the body's own legs pushed four
    # millimetres out and called leather, standing in for leg armour the chest
    # slot did not have; the harness carries real cuisses and greaves now, so
    # they would only sit inside the steel. `build_trousers`, `LEG_BONES` and
    # the `TROUSER_*` constants stay for the day a look wants cloth legs under
    # a shorter piece.
    # Last: everything above reads a whole body, as a transfer source or as the
    # shell a copy is taken from.
    for look in built:
        split_body_regions(bpy.data.objects[f"base.{look}.body"], look)

    with open(FIT_REPORT, "w") as fh:
        json.dump(fitted, fh, indent=1)

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


if __name__ == "__main__":
    main()
