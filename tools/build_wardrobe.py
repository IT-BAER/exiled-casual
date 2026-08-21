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

import bpy
import mathutils
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
# Every piece here is one closed donor mesh with no skeleton of its own, so it
# is fitted to a measured feature of the body and then skinned ENTIRELY to the
# one bone it hangs from. That is what keeps the runtime unchanged: a helmet is
# `helmet.<look>.helm` exactly the way a body is `base.<look>.body`, shown by
# enabling it and hidden by not, with no socket, no parenting and no per-frame
# work anywhere in the client.
#
# Placement is derived from the body that is actually loaded - this head's
# width, this hand's centre, this forearm's thickness - never from a world
# coordinate, so the same table fits a body with different proportions.

RIGID_GEAR = (
    {
        "slot": "helmet", "look": "iron", "part": "helm",
        "src": "iron-helm-8k-v3.glb", "bone": "Head", "fit": "head_shell",
    },
    {
        "slot": "weapon1", "look": "emberwand", "part": "mesh",
        "src": "wand-3000-v3b.glb", "bone": "hand_r", "fit": "hand_grip",
    },
    {
        "slot": "weapon2", "look": "buckler", "part": "mesh",
        "src": "buckler-4000-v1.glb", "bone": "lowerarm_l", "fit": "forearm_strap",
    },
)

# Air the scalp must keep under a hard shell, and the skull it is measured over:
# everything above a quarter of the head's height, forehead included. Filtering
# the face out reads as sensible - the opening is meant to be bare - and hides
# the one fault that matters, because the forehead is ABOVE the brim and has to
# be under steel.
HELM_CLEAR = 0.003       # padding under the steel, metres
HELM_COVER_FROM = 0.25
HELM_BACK_SHIFT = 0.06   # seat, as a fraction of head depth
HELM_WIDTH_FROM = 1.05   # narrowest dome/head width ratio worth trying
HELM_WIDTH_TO = 1.35     # past this a shell is a bucket, whatever it measures
HELM_WIDTH_STEP = 0.025
# Clearance alone cannot say a helmet is too big, because growing the shell
# also reseats it: the scalp point nearest the steel keeps changing, so the
# gap wanders up and down as the ratio climbs rather than rising with it.
# Accepting the first ratio that clears therefore lands on whichever local dip
# happens to come first - 1.57 on this donor, a helm half again as wide as the
# head. The smallest passing ratio is the fit; the median gap is the ceiling
# that catches a donor whose shape needs a bucket to clear anything at all.
HELM_MAX_MEDIAN = 0.035

# A haft is sized by the hole a fist makes, not by the length that looks right:
# scaling a gnarled donor to a wand's length leaves its grip wider than the
# fingers can close, and the knuckles come through the wood. Length is then
# bought back along the shaft alone, which a hand cannot feel and an eye reads
# as a longer wand rather than a fatter one.
WAND_GRIP_DIA = 0.038      # metres across the shaft where the fist closes
WAND_LEN_RATIO = 0.23      # of body height
WAND_MAX_STRETCH = 1.8     # past this the carving visibly smears
# Where the wand's head should point while he stands still, in world axes: out
# to his right, ahead of him, and down. Aiming it across the palm is what a
# hand actually does and it is unreadable, because `Idle_Loop` is a bare-handed
# idle that turns the grip axis forward and UP - down the barrel of the front
# camera, and inside the arm from the game camera. The bind-pose direction that
# lands here is measured off the clip, not assumed.
WAND_AIM = (-0.45, -0.55, -0.70)
IDLE_CLIP = "Rig|Idle_Loop"
ANIMS = "D:/VSC/exiled-casual/apps/web/public/models/anim-library.glb"

BUCKLER_DIA_RATIO = 0.20   # of body height
BUCKLER_GAP = 0.008        # air between the arm and the shield's back face
BUCKLER_ALONG = 0.82       # 0 at the elbow, 1 at the wrist
BUCKLER_ROLL = -90         # degrees about the shield's own face


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


def cavity_ceiling(obj):
    """Height of a shell's inner crown, in its own coordinates.

    What rests on a head is the underside of the dome, and finding it means
    going through the steel: a ray dropped from above hits the outer skin first
    and the ceiling second. Taking the lowest vertex down the central axis was
    tried and is wrong on a donor with a comb - the measurement lands on the
    comb, and the crown then stays welded to the scalp at every size.
    """
    lo, hi, dims, c = bbox([v.co for v in obj.data.vertices])
    bvh = bvh_of(obj)
    down = Vector((0, 0, -1))
    ceiling = None
    for fx in (-0.25, -0.12, 0.0, 0.12, 0.25):
        for fy in (-0.12, 0.0, 0.12):
            start = Vector((c.x + dims.x * fx, c.y + dims.y * fy, hi.z + dims.z))
            outer = bvh.ray_cast(start, down, dims.z * 3)
            if outer[0] is None:
                continue
            inner = bvh.ray_cast(Vector(outer[0]) + down * 1e-4, down, dims.z * 3)
            if inner[0] is None:
                continue
            ceiling = inner[0].z if ceiling is None else min(ceiling, inner[0].z)
    if ceiling is None:
        raise SystemExit("no cavity under the dome: this donor is not a shell")
    return ceiling


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


def fit_head_shell(donor, body, rig):
    """Grow the shell until the skull above the brim is inside it.

    Seating alone cannot do it: the cavity has to be wide enough for the head
    before the crown can clear, and a donor scanned around somebody else's skull
    never is at the first ratio tried.
    """
    head_lo, head_hi, head_dims, head_c = bbox(group_points(body, "Head"))
    hp = [v.co for v in donor.data.vertices]
    _, d_hi, d_dims, d_c = bbox(hp)
    dome = [p for p in hp if p.z > d_c.z]
    dome_w = max(p.x for p in dome) - min(p.x for p in dome)
    ceiling = cavity_ceiling(donor)
    dy = head_dims.y * HELM_BACK_SHIFT
    covered = [p for p in group_points(body, "Head", 0.5)
               if p.z > head_c.z + head_dims.z * HELM_COVER_FROM]

    def matrix(scale):
        lift = (ceiling - d_c.z) * scale
        return placed(donor, sizing(scale), Matrix.Identity(4), Vector((
            head_c.x, head_c.y + dy, head_hi.z + HELM_CLEAR - lift)))

    tries = []
    ratio = HELM_WIDTH_FROM
    while ratio <= HELM_WIDTH_TO + 1e-9:
        scale = (head_dims.x * ratio) / dome_w
        p01, med = gap_profile(bvh_of(donor, matrix(scale)), covered)
        tries.append([round(ratio, 3), round(p01 * 1000, 2), round(med * 1000, 2)])
        if p01 >= HELM_CLEAR and med <= HELM_MAX_MEDIAN:
            return matrix(scale), {
                "dome_width_ratio": round(ratio, 3), "scale": round(scale, 5),
                "skull_gap_p01_mm": round(p01 * 1000, 2),
                "skull_gap_median_mm": round(med * 1000, 2),
                "skull_points": len(covered),
            }
        ratio += HELM_WIDTH_STEP
    raise SystemExit(f"no helm size both clears the skull and stays a helmet; {tries}")


def idle_rotation(rig, bone):
    """How the idle clip turns one bone, as a rest-to-posed 3x3.

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
    R = (rig.matrix_world @ pose
         @ rig.data.bones[bone].matrix_local.inverted()).to_3x3()

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
    return R


def aimed(donor, axis_dir, R, aim):
    """Rotate a donor's own `axis_dir` onto whatever the clip turns into `aim`."""
    want = R.transposed() @ Vector(aim).normalized()
    return axis_dir.rotation_difference(want).to_matrix().to_4x4()


KNUCKLES = ("index_01_r", "middle_01_r", "ring_01_r", "pinky_01_r")


def grip_hole(rig, radius):
    """Where a closed fist's hole sits, at `radius` of shaft.

    The rest hand is OPEN - fingers straight, thumb splayed - so the hole does
    not exist to be measured: the fist is something the idle clip makes out of
    the finger bones. It has to be predicted instead, from the knuckle line the
    fingers curl about and the thumb that says which side of that line is palm.
    Taking the hand vertex group's centre is the trap it replaces: those bones
    end at the knuckles, so the group's box is the wrist band and a wand seated
    on it rides the forearm with the fist closed and empty below.
    """
    heads = [rig.matrix_world @ rig.data.bones[b].head_local for b in KNUCKLES]
    knuckle = sum(heads, Vector((0, 0, 0))) / len(heads)
    finger = (rig.matrix_world @ rig.data.bones[KNUCKLES[1]].tail_local) - heads[1]
    finger.normalize()
    thumb = rig.data.bones["thumb_01_r"]
    palm = (rig.matrix_world @ thumb.tail_local) - knuckle
    palm -= finger * palm.dot(finger)
    palm.normalize()
    return knuckle + palm * radius


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
    R = idle_rotation(rig, "hand_r")
    rot = aimed(donor, Vector((0, 0, 1)), R, WAND_AIM)
    _, _, _, d_c = bbox([v.co for v in donor.data.vertices])
    anchor = Vector((d_c.x, d_c.y, grip_z))
    hole = grip_hole(rig, grip_r * scale)
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
    """A disc in front of the forearm, its face along the way the body looks.

    Which perpendicular the face takes is the whole fit. A shield turned to -Z
    lies flat under a T-posed forearm and is unarguable in the bind pose, but
    the shoulder rotation that drops the arm to the side is a turn about Y: it
    carries -Z round to +X and the shield ends up edge-on, facing across the
    hip and cutting through it. -Y is fixed by that same rotation, so the disc
    keeps both its plane and its facing in every pose the arm reaches.
    """
    _, _, body_dims, _ = bbox([body.matrix_world @ v.co for v in body.data.vertices])
    arm_pts = group_points(body, "lowerarm_l")
    hand_pts = group_points(body, "hand_l")
    _, _, d_dims, _ = bbox([v.co for v in donor.data.vertices])
    scale = (body_dims.z * BUCKLER_DIA_RATIO) / max(d_dims.x, d_dims.z)
    bone = rig.data.bones["lowerarm_l"]
    elbow = rig.matrix_world @ bone.head_local
    wrist = rig.matrix_world @ bone.tail_local
    along = elbow.lerp(wrist, BUCKLER_ALONG)
    # The arm is not the only thing behind the shield: the fist reaches further
    # forward than the forearm does, and clearing only the arm leaves fingers
    # standing through the boss.
    front = min(p.y for p in arm_pts + hand_pts)
    centre = Vector((along.x, front - BUCKLER_GAP - d_dims.y * scale / 2, along.z))
    # The facing settles which way the disc looks; the roll settles where its
    # boss straps and its spokes run, which the donor authored for a different
    # arm than this one.
    roll = Matrix.Rotation(math.radians(BUCKLER_ROLL), 4, "Y")
    M = placed(donor, sizing(scale), roll, centre)
    p01, med = gap_profile(bvh_of(donor, M), arm_pts + hand_pts)
    return M, {
        "scale": round(scale, 5),
        "diameter_m": round(body_dims.z * BUCKLER_DIA_RATIO, 4),
        "arm_gap_p01_mm": round(p01 * 1000, 2),
        "arm_gap_median_mm": round(med * 1000, 2),
    }


FITTERS = {
    "head_shell": fit_head_shell,
    "hand_grip": fit_hand_grip,
    "forearm_strap": fit_forearm_strap,
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
    group = mesh.vertex_groups.new(name=bone)
    group.add(range(len(mesh.data.vertices)), 1.0, "REPLACE")


def build_rigid_gear(rig, body):
    """Fit, skin and name every rigid piece against one built look."""
    fitted = {}
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
        M, detail = FITTERS[spec["fit"]](donor, body, rig)
        donor.data.transform(M)
        donor.data.update()
        donor.name = f"{spec['slot']}.{spec['look']}.{spec['part']}"
        donor.data.name = donor.name
        skin_to_bone(donor, rig, spec["bone"])
        tris = sum(len(p.vertices) - 2 for p in donor.data.polygons)
        detail.update({"bone": spec["bone"], "fit": spec["fit"], "triangles": tris,
                       "source": spec["src"]})
        fitted[donor.name] = detail
        print(f"fitted {donor.name}: {tris} tris on {spec['bone']}")
    return fitted


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


main()
