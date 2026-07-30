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

Three parts are generated here rather than cut from a pack: the head (neither
pack has one), the coat (the body item art is a floor-length coat and the ranger
wears a hip-length tunic, which no amount of re-texturing can fix) and the helm
(every helmet base is drawn as iron over cloth, and the pack only has the cloth).
"""
import math
import sys
import bmesh
import bpy
from mathutils import Matrix, Vector

# Build inputs live outside `public/`: they are cut up offline and never fetched
# by the browser, so shipping them would double the character payload.
SRC = "D:/VSC/exiled-casual/assets/characters/"
MODELS = "D:/VSC/exiled-casual/apps/web/public/models/"
OUT = MODELS + "wardrobe.glb"

SKIN_MAT = "MI_Regular_Male"

# The base male's own material names, as the head pack ships them.
BASE_SKIN_MAT = "MI_Superhero_Male"
EYE_MAT = "MI_Eyes"
BROW_MAT = "MI_Hair_1"

# Where the head stops being a head. The base male is one welded body mesh, so
# the head has to be cut out of it, and the honest place to cut is by weight
# rather than by height: keep a vertex only if `Head` and `neck_01` own this much
# of it between them. 0.70 puts the seam at z 1.545 with a neck radius of 0.079,
# which is under the collar line at 1.559 and inside every torso in the wardrobe.
# Cutting by a z plane instead takes the shoulders with it at the front and loses
# the nape at the back, because a neck does not meet a body at one height.
HEAD_JOINTS = ("Head", "neck_01")
HEAD_WEIGHT = 0.70

# The flattest near-black texel in T_Regular_Male_Dark_BaseColor.png (rgb
# 46,46,46). Hair and eyebrows are pinned to it rather than given the pack's own
# hair texture, which is a 2048 greyscale authored to be tinted by an engine that
# has a hair shader. We do not have one, so untinted it renders white-haired.
# Pinning shares the skin material instead - one material, one draw setup - and
# costs only the strand detail, which at a head this size is under a pixel.
# Blender's V runs bottom-up where the image runs top-down, hence 1 - v.
HAIR_UV = (0.7656, 0.4727)

# And again for the helm, pinned this time to the flattest *bright* texel in the
# ranger atlas (rgb 152,159,150, luminance 155 against cloth's ~60). The gear
# textures are a luminance -> icon-palette lookup, so a bright texel is what puts
# the helm at the light end of the cinder cap's own ramp: plate grey where the
# cowl under it lands in the same icon's charcoal.
HELM_UV = (0.2363, 1.0 - 0.1035)

# Where the iron stops and the cloth starts. Measured on the cowl: the skull sits
# at z 1.688, so this is a brow line just above the eyes, and everything the helm
# leaves alone (the face opening, the drape down the neck) is the icon's tail.
HELM_CUT = 1.720

# The dome the cowl's crown is pushed out onto: centre and half-extents. The cowl
# is a hood with a forward point, not a helmet, so the shell is clamped to a
# minimum radius rather than shrink-wrapped - it keeps the cowl's front peak
# where the cowl is wider, and rounds out the sides and crown, which is 0.02
# wider than the cloth and reads as a hard cap from the play camera.
HELM_C = (0.0, 0.030, 1.700)
HELM_HALF = (0.118, 0.150, 0.178)

# How far the iron stands off the cloth everywhere, so no cowl vertex pokes
# through its own shell.
HELM_CLEAR = 0.006

# The brow band: the bottom of the shell flares out over this height, which is
# the one edge of a helmet that still catches light at ten pixels a head.
HELM_LIP, HELM_LIP_H = 0.014, 0.035

# Held gear, all of it in the hand frame `hand_frame` returns: x runs out to the
# fingertips, y out of the back of the hand, z along the axis a held stick lies
# on. The character is 1.68 units tall and the hands sit at 1.4555, so these are
# metres and a 0.36 wand is a wand rather than a broom.

# Each piece is modelled around its own origin along +z and then placed by one
# matrix, because both of the first attempt's faults were orientation and not
# size: the shield came out edge-on to the front and the wand stuck straight
# forward like a lance. Measured, not eyeballed - the deformed bounding box of
# each piece under Idle_Loop says which world axis it actually runs along.

# The wand, as (distance along its own axis, radius). Butt behind the fist, a
# swell at the head: a constant-radius rod is a dowel, and the one silhouette cue
# that survives the play camera is that the far end is fatter than the near one.
WAND_PROFILE = [
    (-0.100, 0.010), (-0.060, 0.014), (0.000, 0.014), (0.100, 0.011),
    (0.190, 0.013), (0.235, 0.023), (0.260, 0.013),
]
WAND_SIDES = 8
# Swung 65 degrees off the fist axis and onto the arm's, so at rest it hangs down
# the thigh the way PoE holds a wand between casts. Level, it was a lance on a
# hip; straight down the arm, it is the forearm with a knob on the end.
WAND_TILT = math.radians(78.0)
WAND_AT = (0.055, -0.015, 0.010)

# The focus: a stone carried just off the palm. PoE2's foci hang rather than
# being gripped, which is also the only way to hold one on a rig whose fingers
# never open.
FOCUS_R = 0.070
FOCUS_AT = (0.100, -0.030, 0.020)

# The shield, on the forearm rather than in the fist. Half-extents: along its own
# length (LEN scales the taper's -1..1), across its width, and through its face.
SHIELD_LEN, SHIELD_WIDE, SHIELD_THICK = 0.210, 0.150, 0.018
# Its face is normal to the *grip* axis, not to the palm. Built the other way up
# it presented its edge to whatever the character was walking towards, and a
# shield seen edge-on is a plank; the deformed bounding box measured the fault.
#
# The last 26 degrees are the arm's own roll. A board strapped rigidly to a
# forearm faces wherever that forearm has rolled to, which under Idle_Loop is 38
# degrees off the front; a real shield is gripped square to the threat instead.
# So the plate is counter-rolled by what the *posed* arm measures, not by what
# the bind pose suggests - the bind pose is a T and has no opinion about it.
SHIELD_ROLL = math.radians(-26.0)
SHIELD_AT = (-0.050, 0.000, 0.055)
# (position along the shield in -1..1, how wide that slice is). Straight-sided
# through the middle, rounded off at both ends.
SHIELD_TAPER = [
    (-1.00, 0.30), (-0.86, 0.72), (-0.40, 1.00),
    (0.40, 1.00), (0.86, 0.78), (1.00, 0.36),
]

# The coat's profile, waist first: (z, radius) around the body axis. Measured
# against the ranger's own silhouette rather than guessed - his torso peaks at
# r=0.192 over the hips, his belt at 0.177 and his legs at 0.193, so the coat
# starts at 0.195 and flares from there and never has to fight them for space.
COAT_RINGS = [
    (1.120, 0.195),  # just under the belt (z 1.125), so the belt stays on top
    (0.980, 0.215),
    (0.800, 0.243),
    (0.600, 0.268),
    (0.400, 0.292),
]

# The hem alternates between these two, giving the icon's row of hanging tatters
# for free: same vertex count, zigzag bottom edge. Ankle-length rather than
# floor-length so the boots still read as boots.
COAT_HEM = [(0.330, 0.300), (0.200, 0.312)]

# Two coat segments per skirt chain. The chains are what bend, so a ring coarser
# than the chain ring cannot show one panel swinging away from its neighbour.
COAT_SEG = 32

# The body's axis is not x=0,y=0: the torso is centred a little forward of the
# origin, and a *circular* skirt around it reads as a traffic cone from the play
# camera, so the coat is squashed front-to-back.
COAT_CY = 0.03
COAT_DEPTH = 0.88

# The coat hangs off a ring of two-joint chains rather than off the legs. Riding
# the thighs was the first attempt and it looks wrong for a good reason: a thigh
# rotation is rigid about the hip, so the hem sweeps a wide arc exactly in phase
# with the knee and the coat reads as two stiff blades. These bones carry no
# animation at all - `skirt.ts` swings them - so what is baked here is only where
# they hang and how far apart they are.
#
# One chain per coat column, and that ratio is the whole point - not the absolute
# count. The chains are the only geometry the solver collides, so a column with no
# chain of its own is skinned to the average of its two neighbours and lies on
# neither: it hangs in the gap *between* the collided lines, where no capsule can
# reach it. Measured on the running character at 16 chains against 32 columns,
# those split columns sat 0.04 off the nearest chain at the waist and 0.088 at the
# hem - wider than the entire thigh capsule (0.088). The leg went through the coat
# while the solver correctly reported every particle clear, which is why raising
# the count alone never fixed it: 8 -> 16 chains shipped alongside 24 -> 32
# columns and kept the ratio, so it doubled the resolution *and* the blind spot.
SKIRT_CHAINS = COAT_SEG

# Joints per chain, which is how many places the cloth is allowed to fold on its
# way down. Two was not enough and the reason is a ratio: each bone was 0.464
# long against a thigh capsule of radius 0.088, so a single bar five times the
# leg's width had to answer for a whole leg's worth of contact. It cannot dent -
# it can only pivot about its one joint - so a leg pressing into the middle of a
# panel had nowhere to put the cloth and went through it instead. Measured over a
# captured run cycle, frames showing more than 2cm of leg through the coat: 17.6%
# at two joints, 0.3% at three.
#
# Three and not more. Four was worse on every penetration measure and cost more,
# because a finer chain moves less per collision pass and needs passes back to
# keep up: the win is having somewhere to fold, not having many somewheres.
#
# Every joint in a chain is deliberately the same length: the runtime reads one
# segment length off the asset and uses it for all of them, so there is no second
# copy of these numbers to drift. `rig.test.ts` pins it.
SKIRT_JOINTS = 3
SKIRT_JOINT = "skirt_{i}_{n:02d}"

# Where the chain hangs from and reaches to. Taken from the coat's own profile so
# the bones cannot drift away from the cloth they carry.
#
# The hem is the *deepest* tatter, not the average of the two. Averaging stopped
# every chain 0.065 above the long tatters, and cloth below the last collided
# point is cloth a leg walks through: the hem measured 0.088 off the nearest chain
# there. Running every chain to the bottom costs the short tatters a stretch of
# bone with no cloth on it, which only ever over-reports a contact by a hair.
SKIRT_TOP_Z, SKIRT_TOP_R = COAT_RINGS[0]
SKIRT_HEM_Z, SKIRT_HEM_R = min(COAT_HEM)

# Height along the chain (0 at the waist, 1 at the hem) where the cloth stops
# being pinned to the body. The top band keeps the waist crisp under the belt;
# everything below is shared out between the chain's joints and swings.
SKIRT_PINNED = 0.20

# Band of the tunic the coat borrows its uvs from: its own hem (z 0.909) up to
# mid-chest. Stretched down the coat, so the tunic's hem trim lands on the hem.
COAT_UV_Z = (0.909, 1.45)

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
    return [
        o for o in bpy.context.scene.objects
        if o.type == "MESH" and not o.name.startswith("Icosphere")
    ]


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


def import_parts(path):
    """Import a glTF and keep only its meshes, dropping its armature.

    Every source file here carries its own copy of the same 65 joints, and only
    the first one imported is kept as the canonical rig; the rest are re-parented
    onto it by name. Also drops the 42-vertex `Icosphere` the glTF importer adds
    as the bone display shape, which is otherwise counted as a part.
    """
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    keep = [o for o in new if o.type == "MESH" and not o.name.startswith("Icosphere")]
    for obj in new:
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    return keep


def cut_to_head(obj):
    """Delete everything the head and neck joints do not own."""
    group = {g.index: g.name for g in obj.vertex_groups}
    kept = {
        v.index for v in obj.data.vertices
        if sum(g.weight for g in v.groups if group.get(g.group) in HEAD_JOINTS) >= HEAD_WEIGHT
    }
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(
        bm, geom=[v for v in bm.verts if v.index not in kept], context="VERTS",
    )
    if not bm.faces:
        raise SystemExit(f"head: nothing survived a {HEAD_WEIGHT} weight cut on {obj.name}")
    bm.to_mesh(obj.data)
    bm.free()


def build_head(armature, skin_material):
    """A head, because neither outfit pack ships one.

    The outfit packs are outfits: each one welds its sleeves to its own bare
    forearms and stops at the collar, and the ranger only looks finished because
    his hood is his head. What they do carry is the *texture* for a head -
    `T_Regular_Male_Dark_BaseColor.png` has a painted face in its top-left
    corner, referenced by both packs and used by neither, because the head it was
    unwrapped for lives in the author's separate base-character pack.

    So the head is cut out of that base male rather than modelled here. It is one
    welded body mesh, so `cut_to_head` takes the part the head and neck joints
    own and throws the body away; what survives keeps the pack's own UVs and its
    own skin weights, which is the entire reason to do it this way. A generated
    skull can only ever be pinned to a flat texel - a correctly shaped, correctly
    animated blank - because there is no way to guess UVs that land a painted eye
    on a sphere.

    The two males are different proportions (this one is the `Superhero` build,
    the outfits are `Regular`) and that does not matter for a head: they share one
    UV unwrap, and `Head`, `neck_01`, `spine_03` and `pelvis` have bit-identical
    inverse bind matrices in both files. Only the thumbs, fingers, hands and feet
    differ, and none of those are above the collar. `rig.test.ts` pins it.

    Eyes are geometry, not paint, so they come across as their own part with the
    pack's own eye texture. Hair and eyebrows are pinned to a dark skin texel; see
    `HAIR_UV`.
    """
    parts = {o.data.materials[0].name: o for o in import_parts(SRC + "Base_Male.gltf")}
    head, eyes, brows = parts[BASE_SKIN_MAT], parts[EYE_MAT], parts[BROW_MAT]
    hair = import_parts(SRC + "Hair_SimpleParted.gltf")[0]

    before = len(head.data.vertices)
    cut_to_head(head)
    log(f"cut the head off the base male: {before}v -> {len(head.data.vertices)}v")

    head.name = "base.head.head"
    eyes.name = "base.head.eyes"
    brows.name = "base.head.brows"
    hair.name = "base.head.hair"

    # The head joins the hands' material rather than keeping the base pack's own.
    # Both name the same image now, so this is one draw setup instead of two, and
    # the face cannot drift in tone from the forearms under it.
    head.data.materials.clear()
    head.data.materials.append(skin_material)

    for obj in (brows, hair):
        obj.data.materials.clear()
        obj.data.materials.append(skin_material)
        for loop in obj.data.uv_layers[0].data:
            loop.uv = HAIR_UV

    made = [head, eyes, brows, hair]
    for obj in made:
        rebind(obj, armature)

    log(f"built head: {', '.join(o.name + ' ' + str(len(o.data.vertices)) + 'v' for o in made)}")
    return made


def build_helm(armature, hood):
    """An iron cap over the ranger cowl, because helmets are drawn as iron.

    The pack's only head covering is a soft hood, and every helmet base in the
    item art is a riveted shell with a ragged cloth tail hanging out from under
    it. The cowl is already the tail; what is missing is the shell.

    So the shell is made *out of* the cowl: its crown is duplicated, cut off at
    the brow, and pushed outward onto a dome. Copying the cloth carries its skin
    weights along with it, which is the whole reason to do it this way - a
    hand-built dome would need its own weight painting to follow the head, and
    this one cannot drift from the cloth it caps by construction.

    Pushed *outward only*: the cowl points forward over the face, and a shell
    shrink-wrapped onto it would be a pointed hood in iron. Clamping to a dome
    keeps that point where the cloth is wider than the dome and rounds out the
    sides and crown, where it is not. Flat-shaded, unlike everything else here:
    at ten pixels a head, facets catching light are what say plate rather than
    cloth.
    """
    bpy.context.view_layer.update()
    obj = hood.copy()
    obj.data = hood.data.copy()
    obj.name = obj.data.name = "helmet.hood.helm"
    bpy.context.scene.collection.objects.link(obj)

    mw = obj.matrix_world
    to_local = mw.inverted()
    centre, half = Vector(HELM_C), Vector(HELM_HALF)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(
        bm, geom=[v for v in bm.verts if (mw @ v.co).z < HELM_CUT], context="VERTS",
    )
    if not bm.faces:
        raise SystemExit(f"helm: the cowl has no faces above z {HELM_CUT}")

    for v in bm.verts:
        p = mw @ v.co
        d = p - centre
        k = Vector((d.x / half.x, d.y / half.y, d.z / half.z)).length
        if 0.0 < k < 1.0:
            p = centre + d / k
            d = p - centre
        p += d.normalized() * HELM_CLEAR
        # The brow band flares straight out from the head's axis, not along the
        # dome, so it reads as a rim rather than as a slightly fatter helmet.
        lip = (HELM_CUT + HELM_LIP_H - p.z) / HELM_LIP_H
        flat = Vector((d.x, d.y, 0.0))
        if lip > 0.0 and flat.length > 1e-6:
            p += flat.normalized() * (HELM_LIP * min(1.0, lip))
        v.co = to_local @ p

    bm.to_mesh(obj.data)
    bm.free()

    for loop in obj.data.uv_layers[0].data:
        loop.uv = HELM_UV
    for poly in obj.data.polygons:
        poly.use_smooth = False
    rebind(obj, armature)

    log(f"built helm: {len(obj.data.vertices)}v of cowl above z {HELM_CUT}, "
        f"mat={obj.data.materials[0].name}")
    return obj


def hand_frame(armature, bone_name, mirror):
    """The frame held gear is authored in: (origin, out, palm, grip).

    Everything here is expressed against the *bone*, never against the world, and
    that is the whole reason a weapon follows the arm without a single line of
    runtime code: the mesh is skinned 1.0 to this bone, so wherever the animation
    puts the hand, the weapon has already been there.

    `out` runs to the fingertips, `grip` is the axis a held stick lies along, and
    `palm` points out of the back of the hand. The two hands are mirror images in
    bone space - `hand_l`'s X is world *down* where `hand_r`'s is world up - so
    the left one's palm axis is flipped and both hands can share one set of
    numbers instead of two hand-tuned copies that drift apart.
    """
    m = armature.matrix_world @ armature.data.bones[bone_name].matrix_local
    out = m.col[1].xyz.normalized()
    palm = m.col[0].xyz.normalized() * (-1.0 if mirror else 1.0)
    grip = m.col[2].xyz.normalized()
    return m.translation.copy(), out, palm, grip


def place(obj, armature, bone_name, frame, material, fit):
    """Move `obj` from its authored frame into the hand's, and skin it to it.

    `fit` is the piece's own placement inside that frame - where it sits in the
    fist and which way round it is held. One vertex group at weight 1.0: held
    gear is rigid, so a blended influence would only let the shaft bend when the
    wrist did.
    """
    origin, out, palm, grip = frame
    obj.data.transform(fit)
    basis = Matrix((
        (out.x, palm.x, grip.x, origin.x),
        (out.y, palm.y, grip.y, origin.y),
        (out.z, palm.z, grip.z, origin.z),
        (0.0, 0.0, 0.0, 1.0),
    ))
    obj.data.transform(basis)

    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new()
    for loop in obj.data.uv_layers[0].data:
        loop.uv = HELM_UV
    # Flat, for the same reason the helm is: facets catching light are what read
    # as forged iron at the size the play camera draws a hand.
    for poly in obj.data.polygons:
        poly.use_smooth = False

    group = obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    rebind(obj, armature)
    return obj


def new_mesh(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_wand(armature, material):
    """A tapered shaft through the main-hand fist, heavier at the head."""
    obj = new_mesh("weapon1.wand.shaft")
    bm = bmesh.new()
    for t, r in WAND_PROFILE:
        bmesh.ops.create_circle(
            bm, cap_ends=True, segments=WAND_SIDES, radius=r,
            matrix=Matrix.Translation((0.0, 0.0, t)),
        )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # The rings are separate discs until they are bridged; loft them into a shaft.
    bmesh.ops.bridge_loops(bm, edges=[e for e in bm.edges if len(e.link_faces) < 2])
    bm.to_mesh(obj.data)
    bm.free()
    fit = Matrix.Translation(WAND_AT) @ Matrix.Rotation(WAND_TILT, 4, "Y")
    return place(obj, armature, "hand_r", hand_frame(armature, "hand_r", False), material, fit)


def build_focus(armature, material):
    """A stone the off hand carries rather than grips: PoE2's foci are held, not wielded."""
    obj = new_mesh("weapon2.focus.stone")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=FOCUS_R)
    bm.to_mesh(obj.data)
    bm.free()
    fit = Matrix.Translation(FOCUS_AT)
    return place(obj, armature, "hand_l", hand_frame(armature, "hand_l", True), material, fit)


def build_shield(armature, material):
    """A slab on the off arm, face forward, tapered at both ends so it is not a door."""
    obj = new_mesh("weapon2.shield.plate")
    bm = bmesh.new()
    # Stacked cross sections up the arm, each a rectangle across the grip axis and
    # a slab thick along the palm. The taper narrows the top and bottom: a plain
    # box at this size reads as cargo strapped to an arm, not as armour.
    #
    # It is authored lying in the arm's own plane, which looks wrong in the T-pose
    # and is right everywhere else - the forearm is horizontal only while the
    # character is standing in the bind pose, and stands upright the moment any
    # clip runs, taking the face round to the front with it.
    rings = []
    for t, k in SHIELD_TAPER:
        x = t * SHIELD_LEN
        rings.append([
            bm.verts.new((x, sy * SHIELD_WIDE * k, sz * SHIELD_THICK))
            for sy, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))
        ])
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    fit = Matrix.Translation(SHIELD_AT) @ Matrix.Rotation(SHIELD_ROLL, 4, "X")
    return place(obj, armature, "hand_l", hand_frame(armature, "hand_l", True), material, fit)


def coat_point(theta, z, radius):
    """A point on the coat's surface: elliptical around the body's own axis."""
    return (
        radius * math.cos(theta),
        COAT_CY + radius * COAT_DEPTH * math.sin(theta),
        z,
    )


def build_skirt_bones(armature):
    """A ring of two-joint chains hanging from the pelvis, for the coat to swing on.

    They are added to the rig rather than borrowed from it because the packs have
    no cloth bones - 65 joints of body and nothing that hangs. Nothing animates
    them: every clip in the library predates them and drives bones by name, so
    they sit in their rest pose until `skirt.ts` puts them somewhere.
    """
    to_local = armature.matrix_world.inverted()
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bones = armature.data.edit_bones
    pelvis = bones["pelvis"]
    made = []
    for i in range(SKIRT_CHAINS):
        theta = 2.0 * math.pi * i / SKIRT_CHAINS
        top = Vector(coat_point(theta, SKIRT_TOP_Z, SKIRT_TOP_R))
        hem = Vector(coat_point(theta, SKIRT_HEM_Z, SKIRT_HEM_R))

        # Evenly down the waist-to-hem line, so every bone in the chain is the
        # same length and the runtime's single segment number stays true.
        knots = [top.lerp(hem, n / SKIRT_JOINTS) for n in range(SKIRT_JOINTS + 1)]
        parent = pelvis
        for n in range(SKIRT_JOINTS):
            bone = bones.new(SKIRT_JOINT.format(i=i, n=n + 1))
            bone.head = to_local @ knots[n]
            bone.tail = to_local @ knots[n + 1]
            bone.parent = parent
            # The first hangs off the pelvis and must not be welded to it; the
            # rest are a chain and are.
            bone.use_connect = n > 0
            parent = bone
            made.append(bone.name)

    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"built {SKIRT_CHAINS} skirt chains ({len(made)} joints), "
        f"z {SKIRT_TOP_Z:.3f} -> {SKIRT_HEM_Z:.3f}")
    return made


def torso_uvs(torso):
    """The tunic's own (angle, height, uv) samples, for the coat to borrow from.

    One uv per vertex - a seam vertex carries several and any of them is on the
    right island, which is all this needs.
    """
    uv_layer = torso.data.uv_layers[0].data
    seen = {}
    for poly in torso.data.polygons:
        for li in poly.loop_indices:
            vi = torso.data.loops[li].vertex_index
            if vi in seen:
                continue
            co = torso.data.vertices[vi].co
            if not (COAT_UV_Z[0] <= co.z <= COAT_UV_Z[1]):
                continue
            zn = (co.z - COAT_UV_Z[0]) / (COAT_UV_Z[1] - COAT_UV_Z[0])
            seen[vi] = (math.atan2(co.y - COAT_CY, co.x), zn, tuple(uv_layer[li].uv))
    return list(seen.values())


def build_coat(armature, torso):
    """A long coat for the ranger body look, because the item art is not a tunic.

    The one thing a re-palettized texture cannot buy is shape: every body base so
    far is drawn as a floor-length coat with a ragged hem, and the ranger's
    authored body ends at the hip. So this adds the missing half of the
    silhouette as a lofted skirt hanging from under his belt.

    It hangs off the skirt chains (see `build_skirt_bones`), not off the body. It
    was skinned to the thighs first, and that is worth not repeating: a thigh
    rotation is rigid about the hip, so the hem swept a wide arc exactly in phase
    with the knee and the coat read as two stiff blades. Cloth needs to lag, and
    a bone that a clip drives cannot lag anything.

    UVs are borrowed from the tunic by nearest (angle, height) match instead of
    being projected into a box on the atlas. The atlas is a packed character
    sheet, so any box big enough to hold a coat also clips a boot buckle or a
    strip of skin into it; sampling the tunic's real vertices cannot leave the
    cloth island, and it lands the tunic's own hem trim on the coat's hem.
    """
    verts, faces, meta = [], [], []
    rings = COAT_RINGS + [None]  # the hem ring alternates, so it is built inline

    for r, ring in enumerate(rings):
        for s in range(COAT_SEG):
            z, radius = COAT_HEM[s % len(COAT_HEM)] if ring is None else ring
            theta = 2.0 * math.pi * s / COAT_SEG
            verts.append(coat_point(theta, z, radius))
            meta.append((theta if theta <= math.pi else theta - 2.0 * math.pi, z))
        if r == 0:
            continue
        top, bottom = (r - 1) * COAT_SEG, r * COAT_SEG
        for s in range(COAT_SEG):
            n = (s + 1) % COAT_SEG
            faces.append((top + s, top + n, bottom + n, bottom + s))

    mesh = bpy.data.meshes.new("body.ranger.coat")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(torso.data.materials[0])

    obj = bpy.data.objects.new("body.ranger.coat", mesh)
    bpy.context.scene.collection.objects.link(obj)

    samples = torso_uvs(torso)
    if not samples:
        raise SystemExit("coat: the torso has no vertices in the uv sampling band")
    z_hem = min(z for z, _ in COAT_HEM)
    z_top = COAT_RINGS[0][0]

    uv_layer = mesh.uv_layers.new(name="UVMap")
    per_vertex = []
    for theta, z in meta:
        zn = (z - z_hem) / (z_top - z_hem)
        best, best_cost = samples[0][2], None
        for s_theta, s_zn, uv in samples:
            d = abs(theta - s_theta)
            if d > math.pi:
                d = 2.0 * math.pi - d
            # Height mismatch is weighted up to radians so one axis cannot be
            # traded away for the other: a coat texel from the wrong height is a
            # stretched hem, from the wrong angle only a rotated fold.
            cost = d * d + (3.0 * (zn - s_zn)) ** 2
            if best_cost is None or cost < best_cost:
                best, best_cost = uv, cost
        per_vertex.append(best)
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = per_vertex[loop.vertex_index]

    # Four influences per vertex and not one more: two neighbouring chains, and
    # within each the two joints its height falls between. glTF's fifth influence
    # costs a whole extra attribute set on every vertex of the mesh. Adding a
    # third joint does not spend any of that budget, because a vertex still only
    # ever lands between two consecutive joints of a chain however many there are.
    pelvis = obj.vertex_groups.new(name="pelvis")
    chains = [
        [obj.vertex_groups.new(name=SKIRT_JOINT.format(i=i, n=n + 1))
         for n in range(SKIRT_JOINTS)]
        for i in range(SKIRT_CHAINS)
    ]
    # Each joint owns the height of its own tail; below the pinned band the cloth
    # is handed from one joint to the next by a linear blend between those.
    knots = [SKIRT_PINNED + (1.0 - SKIRT_PINNED) * (n + 1) / SKIRT_JOINTS
             for n in range(SKIRT_JOINTS)]
    step = 2.0 * math.pi / SKIRT_CHAINS
    for v, (theta, z) in zip(mesh.vertices, meta):
        t = min(1.0, max(0.0, (SKIRT_TOP_Z - z) / (SKIRT_TOP_Z - SKIRT_HEM_Z)))
        pinned = min(1.0, max(0.0, (SKIRT_PINNED - t) / SKIRT_PINNED))

        # Which two joints this height falls between, and how far along.
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

        # Split between the two chains the vertex sits between, so a panel that
        # swings takes its neighbour's edge with it instead of tearing off it.
        exact = theta / step
        near = math.floor(exact)
        blend = exact - near
        pelvis.add([v.index], pinned, "REPLACE")
        for chain, share in ((near % SKIRT_CHAINS, 1.0 - blend),
                             ((near + 1) % SKIRT_CHAINS, blend)):
            if share <= 0.0:
                continue
            for group, w in zip(chains[chain], weights):
                if w > 0.0:
                    group.add([v.index], w * share, "REPLACE")
    rebind(obj, armature)

    log(f"built coat: {len(mesh.vertices)}v, {len(mesh.polygons)} faces, "
        f"mat={mesh.materials[0].name}")
    return obj


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
    generated = {o.name for o in build_head(armature, skin_material)}
    build_skirt_bones(armature)
    generated.add(build_coat(armature, bpy.data.objects["Male_Ranger_Body"]).name)
    hood = bpy.data.objects["Male_Ranger_Head_Hood"]
    generated.add(build_helm(armature, hood).name)

    # Held gear shares the hood's material, so the whole character is still two
    # draw setups and a weapon can be re-palettized by `build_gear_textures.py`
    # the same way a helmet is.
    iron = hood.data.materials[0]
    for build in (build_wand, build_focus, build_shield):
        generated.add(build(armature, iron).name)

    dropped = []
    for obj in meshes():
        if obj.name in generated:
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

    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o.name.startswith("Icosphere"):
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
