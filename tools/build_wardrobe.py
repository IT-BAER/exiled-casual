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
# Sized against the icon, which draws a wand about as long as the forearm that
# holds it: at 0.36 long and 20 mm through the fist it read as a chopstick under
# the play camera, where the whole character is 12% of frame height.
WAND_PROFILE = [
    (-0.145, 0.016), (-0.087, 0.022), (0.000, 0.022), (0.145, 0.018),
    (0.276, 0.021), (0.341, 0.037), (0.377, 0.021),
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

# --- Shields -----------------------------------------------------------------
#
# A shield is strapped across the forearm and aimed, while the fist under it can
# roll freely. Its mesh is authored around its own origin, then `shield_fit`
# expresses the measured carry pose inside `lowerarm_l`. The ordinary animation
# remains entirely in charge of the arm while the rigid shield follows it.
#
# This measured matrix is used only to derive that forearm-local fit. It is
# `bind * pose^-1` for `lowerarm_l` at frame 35 of `Idle_Loop`, measured off
# wardrobe.glb driven by anim-library.glb. Remeasure it if the idle changes.
SHIELD_BONE = "lowerarm_l"
SHIELD_BIND_FROM_POSE = Matrix((
    (0.17406628, -0.31860599, -0.93176740, 1.54562294),
    (0.42496106, 0.87787241, -0.22078922, 0.19232447),
    (0.88831854, -0.35753304, 0.28820324, 0.86196965),
    (0.00000000, 0.00000000, 0.00000000, 1.00000000),
))

# The forearm a shield is strapped to, MEASURED as a hull rather than as a bone:
# every vertex the sleeve and the bracer give `lowerarm_l`/`hand_l` at that frame
# spans x 0.296..0.444, y -0.168..-0.020, z 0.848..1.238. A bone is the middle of
# the meat, so a plate placed on the bone is a plate inside the arm - which is
# exactly what the first pass did, and what put the bracer through the boards.
FOREARM_FRONT = -0.168
FOREARM_OUT = 0.444
FOREARM_TOP, FOREARM_BOTTOM = 1.238, 0.848
# What the plate keeps between itself and that surface. A strapped shield should
# sit against the bracer, with only enough clearance to avoid depth flicker.
SHIELD_CLEAR = 0.004

# Every shield is carried in the SAME attitude: face left with a small forward
# bias, because that is how a shield sits on a strapped forearm and because the
# play camera reads a plate edge-on as a stick. A buckler aimed straight forward
# was the odd one out, and it looked like a dinner plate held out to be taken.
# The sign decides which way the plate bows: at -75 the domed face and its
# ironwork turn inward and the shield cups the hip like a bowl.
SHIELD_YAW = math.radians(75.0)
TOWER_YAW = SHIELD_YAW

# How far off head-on a face may turn and still carry the shield's icon, and the
# texel the rest of them sample. 0.2 is about 78 degrees: the dome of the buckler
# and the bow of the tower turn their outer boards well past 45, and every one of
# those is still the picture. Only the edge walls and the back fall outside.
# RIM_UV sits inside the fill square `build_gear_textures.py` stamps in EACH
# corner of the plate, so it lands in one whichever way the loader runs v.
PLATE_FRONT_DOT = 0.2
RIM_UV = (0.008, 0.008)

# Each shield's own anchor: (x of its centre, y of its BACK face, z of its centre).
# The x is pulled inboard of the arm so the plate covers the hip instead of
# hanging off the side, and the buckler is centred on the forearm the way a
# buckler really is strapped.
# Once a plate faces left, its width runs along the character's forward axis.
# Shift that span back until the hand lands behind its middle, not past its edge.
BUCKLER_FOREARM_SHIFT = 0.300
BUCKLER_AT = (0.340, FOREARM_FRONT - SHIELD_CLEAR + BUCKLER_FOREARM_SHIFT, 1.045)
# The tower shield hangs from the arm rather than being pinned through its middle:
# its top sits just under the elbow, so the boards fall towards the knee and stay
# clear of the pauldron at 1.43. Centred at the forearm it reached the shoulder,
# which is a door carried at chest height.
TOWER_FOREARM_SHIFT = 0.220
TOWER_AT = (0.340, FOREARM_FRONT - SHIELD_CLEAR + TOWER_FOREARM_SHIFT, 0.960)

# The buckler, matched to ember_buckler.png: a round riveted plate, domed, with a
# raised rim and a proud central boss. 0.36 across, so it covers a shoulder and no
# more - the icon is a 2x2 and a buckler that covered the chest would be a heater.
BUCKLER_R = 0.180
# (radius as a fraction of R, how far that ring stands out from the back plane).
# Read outwards: boss crown, boss skirt, the field falling away, then the rim
# standing back up. The step at 0.88 is the rim, and it is the one edge of a round
# shield that still reads when the whole thing is forty pixels wide.
BUCKLER_PROFILE = [
    (0.00, 0.100), (0.15, 0.092), (0.26, 0.056), (0.30, 0.050),
    (0.60, 0.038), (0.86, 0.022), (0.90, 0.036), (1.00, 0.028),
]
# 16 segments and every other one lifted gives the icon's eight radial spokes for
# no extra geometry: the ridge is where the ring sits proud, not a strip glued on.
BUCKLER_SEGMENTS = 16
BUCKLER_SPOKE = 0.009
# How far the back of the plate sits behind the rim. Not zero: a disc with no
# depth disappears the moment the character turns side-on.
BUCKLER_BACK = -0.014

# The tower shield, matched to ashwall_tower_shield.png: tall planks bowed around
# the body, an arched top, three iron bands and a rail down each edge. The icon is
# a 2x3, and this covers thigh to shoulder the way that reads.
TOWER_W, TOWER_H = 0.400, 0.720
# How far the centre of the boards bows forward, and how far the top arch drops at
# the corners. Both come straight off the icon's outline.
TOWER_BOW, TOWER_ARCH = 0.055, 0.070
TOWER_THICK = 0.024
# The three bands, as a fraction of the height from the bottom, and how far they
# and the edge rails stand out of the boards.
TOWER_BANDS = (0.20, 0.52, 0.84)
TOWER_BAND_H, TOWER_BAND_OUT = 0.055, 0.016
TOWER_RAIL, TOWER_RAIL_OUT = 0.88, 0.012
# Grid resolution across and up. Odd across, so a column lands on the centre line.
TOWER_NU, TOWER_NV = 13, 21

# The coat's profile, waist first: (z, radius) around the body axis. Measured
# against the ranger's own silhouette rather than guessed - his torso peaks at
# r=0.192 over the hips, his belt at 0.177 and his legs at 0.193, so the coat
# starts inside the belt, follows the lower torso, then opens over the hips. A
# single wide top ring made a straight, detached skirt seam under the belt.
COAT_RINGS = [
    (1.120, 0.158),  # cinched under the belt, not raised into it
    (1.045, 0.174),  # fitted yoke before the coat opens over the hips
    (0.980, 0.208),
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

# A profile per body look: the item art is not one silhouette, so the geometry is
# not either. `ranger` is the reference and stays byte-identical (its numbers ARE
# the module constants above), so every unmapped base still renders as it did.
# `plate` is bulkier through the torso and stops at short stiff tassets; `leather`
# is a trimmer knee-length cut. Both hems sit ABOVE ranger's deepest tatter (0.200),
# so the skirt span (SKIRT_TOP_Z..SKIRT_HEM_Z) is still ranger's and the chains
# are unchanged - a floor-length robe that deepens them is a separate task that
# re-baselines the cloth pins. `rig.test.ts` binds every coat here to one chain.
#
# A coat may not be narrower than the body it covers, and the tight spot is the
# DIAGONAL, not the side: the profile is a radius but the coat is an ellipse, so
# a ring of radius r only reaches `r * depth` front-to-back and something between
# the two at 45 degrees. The ranger tunic's own hem flares to 0.192 at z 0.98 and
# sits almost exactly ON his coat's surface there, so it is the binding
# constraint for every look that clones his torso - a look narrower than the
# ranger through that band pushes the tunic's tatters out through the cloth, and
# it shows standing still, which no cloth tuning can reach. `assert_coat_clears`
# fails the build on it rather than leaving it to be spotted in game.
BODY_LOOKS = {
    "ranger": {"rings": COAT_RINGS, "hem": COAT_HEM, "cy": COAT_CY, "depth": COAT_DEPTH},
    "plate": {
        "rings": [(1.120, 0.173), (1.045, 0.192), (0.900, 0.236),
                  (0.700, 0.256), (0.520, 0.269)],
        "hem": [(0.470, 0.277), (0.430, 0.284)],
        "cy": 0.03, "depth": 0.94,
    },
    "leather": {
        "rings": [(1.120, 0.176), (1.045, 0.191), (0.950, 0.212),
                  (0.760, 0.229), (0.600, 0.256)],
        "hem": [(0.540, 0.266), (0.500, 0.272)],
        "cy": 0.03, "depth": 0.88,
    },
}

# What the coat keeps between itself and the body under it. 8mm of cloth plus
# enough that an animation which shifts the tunic a little does not spend it all.
COAT_CLEARANCE = 0.012

# Plate's shoulder caps, built from the pack's own pauldron rather than from a
# generated dome: it is already modelled, already weighted to the arm, and
# already in the atlas, so a hand-built shell would only be a worse copy that
# needs its own uvs. The ranger wears exactly ONE of them, on his left, which is
# a scout's asymmetry - plate is the look that should be armoured on both sides,
# so the copy is mirrored and the rig happens to be exactly symmetric about x=0
# (upperarm_l head +0.1919 against upperarm_r -0.1919, same y and z), which is
# what makes a mirrored copy land by assignment instead of needing a re-fit.
#
# Scaled about the shoulder joint, not about the mesh's own centre: a cap grown
# about its middle lifts off the joint it is supposed to sit on. 1.25 is bulk
# that still reads as a shoulder at the play camera's ten pixels a head; past
# about 1.4 it stops being armour and becomes a pair of wings.
PLATE_PAULDRON_SCALE = 1.25

# The cuirass, which is what actually makes plate read as plate. Every look
# clones the ranger's torso (see `BODY_BASE_PARTS`), so above the waist plate IS
# his leather tunic and no profile number can change that - only accent geometry
# over the top of it can, the same way the pauldron does.
#
# Its radius is DERIVED from the torso at each ring rather than authored, so the
# shell cannot sink into the body it covers however the tunic is later changed:
# `swell` is how far it then stands off, and that is the only look number here.
# The chest swells and the waist does not, which is the shape of a breastplate.
#
# Stops at 1.40, below the shoulder flare: the torso's widest slice up there is
# the shoulders themselves (half-width 0.205 against a 0.117 depth), and a ring
# wide enough to clear that is a barrel around the arms, which is the pauldron's
# job and not this one.
CUIRASS_RINGS = [(1.150, 1.01), (1.220, 1.02), (1.300, 1.06),
                 (1.360, 1.07), (1.400, 1.03)]
# Squashed front to back like the body under it, and like the coat.
CUIRASS_DEPTH = 0.92
CUIRASS_CLEARANCE = 0.010
# Twelve, and flat-shaded, for the reason the helm is: at ten pixels a head a
# smooth shell reads as cloth however it is coloured, and it is the facets
# catching the light that say iron. A finer ring throws that away.
CUIRASS_SEG = 12
# The shell is given a real inner surface at this fraction of the outer, so its
# top and bottom edges have thickness. An open tube shows its own inside at the
# collar the moment the character is seen from above, which is always.
CUIRASS_INNER = 0.94

# The body parts a look needs besides its coat, cloned from the ranger's so a new
# armour look is a whole character rather than a floating skirt.
BODY_BASE_PARTS = ("torso", "legs", "sleeves", "hands")

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

    Every vertex lands ON the dome, and the dome is sized from the crown it caps
    rather than declared. Clamping only the vertices that fell INSIDE a fixed
    ellipsoid left the rest of them on the cloth, so the shell alternated between
    projected rings and the hood's own wrinkles and read as a stack of terraces
    down the crown - the flat shading that is supposed to say plate drew a ledge
    at every one. A dome measured to contain the crown has nothing left inside it
    to leave behind, and it cannot sink under the cloth it is grown from either.

    Flat-shaded, unlike everything else here: at ten pixels a head, facets
    catching light are what say plate rather than cloth.
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

    # Grow the dome until the crown is inside it: per axis, the furthest cloth
    # vertex from the centre, floored by the authored half-extents so a small
    # cowl still gets a helmet-shaped cap rather than a skullcap.
    reach = Vector((0.0, 0.0, 0.0))
    for v in bm.verts:
        d = (mw @ v.co) - centre
        reach = Vector((max(reach.x, abs(d.x)), max(reach.y, abs(d.y)), max(reach.z, abs(d.z))))
    half = Vector((max(half.x, reach.x), max(half.y, reach.y), max(half.z, reach.z)))

    for v in bm.verts:
        p = mw @ v.co
        d = p - centre
        k = Vector((d.x / half.x, d.y / half.y, d.z / half.z)).length
        if k > 0.0:
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
        f"dome half {half.x:.3f}/{half.y:.3f}/{half.z:.3f}, mat={obj.data.materials[0].name}")
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
    return place_in_basis(obj, armature, bone_name, material, frame_basis(frame), fit)


def place_in_basis(obj, armature, bone_name, material, basis, fit):
    """Place rigid gear through one bone's bind basis and skin it to that bone."""
    obj.data.transform(fit)
    obj.data.transform(basis)
    return skin_to(obj, armature, bone_name, material)


def frame_basis(frame):
    """Matrix taking held-item coordinates from a hand frame into the rig bind."""
    origin, out, palm, grip = frame
    return Matrix((
        (out.x, palm.x, grip.x, origin.x),
        (out.y, palm.y, grip.y, origin.y),
        (out.z, palm.z, grip.z, origin.z),
        (0.0, 0.0, 0.0, 1.0),
    ))


def skin_to(obj, armature, bone_name, material):
    """Give `obj` the shared material, the pinned texel, flat faces and one bone.

    Everything held shares this tail whether it was authored in a hand's frame or
    in the posed world, because none of it varies: one texel, one influence.
    """
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)
    # The pinned texel is for gear with no art of its own to wear. A piece that
    # brought its own projection (the shields) keeps it.
    if not obj.data.uv_layers:
        layer = obj.data.uv_layers.new()
        for loop in layer.data:
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
    rod_uv(obj)
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


def rest_against_arm(obj):
    """Slide a finished local-space plate until its backmost point is at zero.

    The cant and the bow both move that face, so a plate that cleared the arm on
    paper is 19 mm inside the bracer once it is rotated. Measuring the mesh and
    shifting it is the only version of this that stays true when a shape changes.
    """
    deepest = max(v.co.y for v in obj.data.vertices)
    obj.data.transform(Matrix.Translation((0.0, -deepest, 0.0)))


def rod_uv(obj):
    """Lay a shaft's own icon along it: v up the length, u across the barrel.

    Planar and not cylindrical: the icon is a side view of the object, so wrapping
    it around the barrel would squeeze the whole picture into the circumference.
    Projected, the far side repeats the near side mirrored, which at a wand's
    width is a texel or two.
    """
    axis = [vertex.co.z for vertex in obj.data.vertices]
    across = [vertex.co.x for vertex in obj.data.vertices]
    span_a = max(max(axis) - min(axis), 1e-6)
    span_c = max(max(across) - min(across), 1e-6)
    layer = obj.data.uv_layers.new()
    for poly in obj.data.polygons:
        for loop in poly.loop_indices:
            i = obj.data.loops[loop].vertex_index
            layer.data[loop].uv = ((across[i] - min(across)) / span_c,
                                   (axis[i] - min(axis)) / span_a)


def plate_uv(obj):
    """Lay the shield's own inventory icon across its face.

    Held gear otherwise samples a single texel, which is all a wand or a stone
    needs, but a shield IS its icon: the boards, the bands and the boss are drawn
    there and a flat repalettized wash throws all of that away. So the plate gets
    a planar projection along its own normal - u across the face, v up it -
    against a texture that is the icon cropped to its art (`build_gear_textures`).

    Only the FRONT wears it. A planar projection has nothing true to say about a
    face turned away from it: the edge walls took a single column of the picture
    and dragged it around the rim, and the back took the whole icon mirrored, so
    the shield read as a sticker on a slab from every angle but head on. Those
    faces are aimed at RIM_UV instead, a corner of the plate that the bake fills
    with the object's own darkest colour, which is what a shadowed edge is.
    """
    across = Vector((math.cos(SHIELD_YAW), math.sin(SHIELD_YAW), 0.0))
    # The face the icon is painted for: the plate is built along its own -y and
    # then yawed, so the outward direction is that yaw applied to (0, -1).
    facing = Vector((math.sin(SHIELD_YAW), -math.cos(SHIELD_YAW), 0.0))
    u = [vertex.co.xy.to_3d().dot(across) for vertex in obj.data.vertices]
    v = [vertex.co.z for vertex in obj.data.vertices]
    span_u = max(max(u) - min(u), 1e-6)
    span_v = max(max(v) - min(v), 1e-6)
    layer = obj.data.uv_layers.new()
    front = 0
    for poly in obj.data.polygons:
        # Well clear of edge-on: the buckler's dome and the tower's bow turn the
        # face away from the projection at the rim, and those verges belong to the
        # picture, not to the edge.
        if poly.normal.dot(facing) > PLATE_FRONT_DOT:
            front += 1
            for loop in poly.loop_indices:
                i = obj.data.loops[loop].vertex_index
                layer.data[loop].uv = ((u[i] - min(u)) / span_u, (v[i] - min(v)) / span_v)
        else:
            for loop in poly.loop_indices:
                layer.data[loop].uv = RIM_UV
    if front == 0:
        raise SystemExit(f"{obj.name}: no face carries the icon; the facing axis is wrong")
    log(f"  {obj.name}: {front}/{len(obj.data.polygons)} faces wear the icon")


def shield_fit(armature, anchor):
    """Express the measured shield carry anchor inside the forearm bind frame."""
    basis = armature.matrix_world @ armature.data.bones[SHIELD_BONE].matrix_local
    fit = (basis.inverted() @ SHIELD_BIND_FROM_POSE @ Matrix.Translation(anchor))
    return basis, fit


def build_buckler(armature, material):
    """The round shield of ember_buckler.png: domed field, raised rim, proud boss."""
    obj = new_mesh("weapon2.buckler.plate")
    bm = bmesh.new()
    # The anchor names the BACK of the plate, which is the face that touches the
    # arm; everything else is built forward of it.
    cx = cz = 0.0
    cy = BUCKLER_BACK
    n = BUCKLER_SEGMENTS

    def yawed(px, py, z):
        """Cant the plate about its own vertical axis, exactly as the tower is."""
        sin, cos = math.sin(SHIELD_YAW), math.cos(SHIELD_YAW)
        return (cx + px * cos - py * sin, cy + px * sin + py * cos, z)

    def ring_point(rf, out, s):
        theta = 2.0 * math.pi * s / n
        # Every other segment stands proud, outside the boss: eight ridges from
        # the boss to the rim, which is the icon's spoked face.
        lift = BUCKLER_SPOKE if (s % 2 == 0 and rf >= 0.30) else 0.0
        r = rf * BUCKLER_R
        return yawed(r * math.cos(theta), -(out + lift), cz + r * math.sin(theta))

    # The profile's first entry is the crown of the boss, which is a point rather
    # than a ring, and the appended last one is the back of the plate: between
    # them the two 1.00 entries stand the rim's edge up as a wall.
    profile = list(BUCKLER_PROFILE) + [(1.00, BUCKLER_BACK)]
    crown = bm.verts.new(yawed(0.0, -profile[0][1], cz))
    rings = [[bm.verts.new(ring_point(rf, out, s)) for s in range(n)]
             for rf, out in profile[1:]]
    back = bm.verts.new(yawed(0.0, -BUCKLER_BACK, cz))
    for s in range(n):
        bm.faces.new((crown, rings[0][s], rings[0][(s + 1) % n]))
    for a, b in zip(rings, rings[1:]):
        for s in range(n):
            bm.faces.new((a[s], a[(s + 1) % n], b[(s + 1) % n], b[s]))
    for s in range(n):
        bm.faces.new((back, rings[-1][(s + 1) % n], rings[-1][s]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    rest_against_arm(obj)
    plate_uv(obj)
    log(f"built buckler: {len(obj.data.vertices)}v, {BUCKLER_R * 2:.2f} across")
    basis, fit = shield_fit(armature, BUCKLER_AT)
    return place_in_basis(obj, armature, SHIELD_BONE, material, basis, fit)


def build_tower(armature, material):
    """The plank wall of ashwall_tower_shield.png: bowed boards, arched top, three bands."""
    obj = new_mesh("weapon2.tower.plate")
    bm = bmesh.new()
    # Solidify pushes the back out of the front sheet, so the sheet itself is one
    # thickness in front of where the plate touches the arm.
    cx = cz = 0.0
    cy = -TOWER_THICK

    def relief(u, v):
        """How far the ironwork at (across, up) stands out of the boards."""
        out = TOWER_RAIL_OUT if abs(u) >= TOWER_RAIL else 0.0
        for band in TOWER_BANDS:
            if abs(v - band) * TOWER_H <= TOWER_BAND_H * 0.5:
                out = max(out, TOWER_BAND_OUT)
        return out

    grid = []
    for iv in range(TOWER_NV):
        v = iv / (TOWER_NV - 1)
        row = []
        for iu in range(TOWER_NU):
            u = -1.0 + 2.0 * iu / (TOWER_NU - 1)
            # The top arch is the only edge that is not straight, and it is what
            # stops the shape reading as a door: the corners drop, the middle
            # stands. The boards bow forward together, so the whole face is a
            # section of a cylinder rather than a flat sheet.
            top = cz + TOWER_H * 0.5 - TOWER_ARCH * u * u
            z = (cz - TOWER_H * 0.5) + v * (top - (cz - TOWER_H * 0.5))
            bow = TOWER_BOW * (1.0 - u * u)
            # Cant the plate about its own vertical axis towards the character's
            # left, rather than pointing it straight forward.
            px = u * TOWER_W * 0.5
            py = -(bow + relief(u, v))
            sin, cos = math.sin(TOWER_YAW), math.cos(TOWER_YAW)
            row.append(bm.verts.new((
                cx + px * cos - py * sin,
                cy + px * sin + py * cos,
                z,
            )))
        grid.append(row)
    faces = []
    for a, b in zip(grid, grid[1:]):
        for i in range(TOWER_NU - 1):
            faces.append(bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    # Solidify rather than a second authored sheet: the back of a tower shield is
    # never seen and its edge walls are the only part that has to be right.
    bmesh.ops.solidify(bm, geom=faces, thickness=TOWER_THICK)
    bm.to_mesh(obj.data)
    bm.free()
    rest_against_arm(obj)
    plate_uv(obj)
    log(f"built tower shield: {len(obj.data.vertices)}v, {TOWER_W:.2f} x {TOWER_H:.2f}")
    basis, fit = shield_fit(armature, TOWER_AT)
    return place_in_basis(obj, armature, SHIELD_BONE, material, basis, fit)


def coat_point(theta, z, radius, cy=COAT_CY, depth=COAT_DEPTH):
    """A point on the coat's surface: elliptical around the body's own axis.

    `cy`/`depth` default to the ranger profile so the skirt chains, which are
    ranger's, are laid out exactly as before; a per-look coat passes its own.
    """
    return (
        radius * math.cos(theta),
        cy + radius * depth * math.sin(theta),
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


def build_cuirass(armature, torso, look):
    """A faceted breastplate over the cloned tunic, weighted like the tunic.

    Weights and uvs are taken from the nearest torso vertex rather than authored.
    That is the same reasoning the coat borrows its uvs by: the atlas is a packed
    character sheet, so any box big enough for a chest also clips something else
    into it, and a plate weighted to one spine bone shears at the waist while the
    body under it bends. Copying what the tunic already does makes the shell
    follow the body exactly, through every clip, for free.
    """
    cy = COAT_CY
    samples = [(v.co.copy(), [(g.group, g.weight) for g in v.groups])
               for v in torso.data.vertices]
    group_name = {g.index: g.name for g in torso.vertex_groups}
    uv_layer = torso.data.uv_layers[0].data
    uv_of = {}
    for poly in torso.data.polygons:
        for li in poly.loop_indices:
            uv_of.setdefault(torso.data.loops[li].vertex_index, tuple(uv_layer[li].uv))

    def ring_radius(z, swell):
        near = [p for p, _ in samples if abs(p.z - z) < 0.030]
        if not near:
            raise SystemExit(f"cuirass: the torso has no vertices at z {z:.3f}")
        # Undo the ellipse, exactly as `assert_coat_clears` does: the shell has to
        # clear the body at every angle, and the tight one is not the side.
        return max(math.hypot(p.x, (p.y - cy) / CUIRASS_DEPTH)
                   for p in near) * swell + CUIRASS_CLEARANCE

    rings = [(z, ring_radius(z, swell)) for z, swell in CUIRASS_RINGS]

    verts, faces = [], []
    for scale in (1.0, CUIRASS_INNER):
        for z, radius in rings:
            for s in range(CUIRASS_SEG):
                theta = 2.0 * math.pi * s / CUIRASS_SEG
                verts.append(coat_point(theta, z, radius * scale, cy, CUIRASS_DEPTH))
    span = len(rings) * CUIRASS_SEG

    def quads(base, flip):
        for r in range(len(rings) - 1):
            for s in range(CUIRASS_SEG):
                n = (s + 1) % CUIRASS_SEG
                top, bottom = base + r * CUIRASS_SEG, base + (r + 1) * CUIRASS_SEG
                face = (top + s, top + n, bottom + n, bottom + s)
                faces.append(face[::-1] if flip else face)

    quads(0, False)        # outer surface
    quads(span, True)      # inner surface, wound the other way
    # The rims that close the two surfaces into one shell with an edge.
    for r, flip in ((0, True), (len(rings) - 1, False)):
        for s in range(CUIRASS_SEG):
            n = (s + 1) % CUIRASS_SEG
            outer, inner = r * CUIRASS_SEG, span + r * CUIRASS_SEG
            face = (outer + s, outer + n, inner + n, inner + s)
            faces.append(face[::-1] if flip else face)

    name = f"body.{look}.cuirass"
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    mesh.materials.append(torso.data.materials[0])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    groups = {}
    uvs = mesh.uv_layers.new(name="UVMap")
    per_vertex = []
    for v in mesh.vertices:
        index = min(range(len(samples)),
                    key=lambda i: (samples[i][0] - v.co).length_squared)
        for gi, weight in samples[index][1]:
            name_ = group_name[gi]
            group = groups.get(name_) or groups.setdefault(name_, obj.vertex_groups.new(name=name_))
            group.add([v.index], weight, "REPLACE")
        per_vertex.append(uv_of.get(index, (0.0, 0.0)))
    for loop in mesh.loops:
        uvs.data[loop.index].uv = per_vertex[loop.vertex_index]

    rebind(obj, armature)
    log(f"built {look} cuirass: {len(mesh.vertices)}v, {len(mesh.polygons)} faces, "
        f"r {rings[0][1]:.3f}..{max(r for _, r in rings):.3f}, flat-shaded")
    return obj


def build_pauldrons(armature, source, look, scale):
    """A shoulder cap on each side, from the pack's single left-hand one.

    Weighted to `upperarm_*` and nothing else, exactly as the source is: a
    pauldron follows the arm, not the cloth, so it must not touch the coat's
    chains or it would swing with the skirt and shear off the shoulder.

    The right-hand copy is the left mirrored through x=0 and reassigned to the
    opposite bone. That is only legitimate because the armature is symmetric to
    the last digit; the winding is flipped with it, since mirroring turns every
    face inside out and Babylon culls back faces.
    """
    # The mesh carries a group per skeleton joint, not just the one it uses, so
    # the bind is moved by moving WEIGHTS between two existing groups. Renaming
    # groups instead is a trap worth naming: every group takes the same new name,
    # Blender suffixes the collisions, and the one that carried the weights ends
    # up matching no bone at all - which the exporter quietly answers with
    # `neutral_bone`, so the cap renders pinned to the floor.
    weighted = {g.name for g in source.vertex_groups
                for v in source.data.vertices
                for gv in v.groups if gv.group == g.index and gv.weight > 0}
    if weighted != {"upperarm_l"}:
        raise SystemExit(f"pauldron: expected weights on upperarm_l alone, got {sorted(weighted)}")

    made = []
    for side, mirror in (("l", False), ("r", True)):
        obj = source.copy()
        obj.data = source.data.copy()
        obj.name = obj.data.name = f"body.{look}.pauldron_{side}"
        bpy.context.scene.collection.objects.link(obj)

        # The bone's own head, NOT the left one negated: `upperarm_r` already
        # sits at the mirrored position, so negating it again scales the cap
        # about a point on the wrong side of the body.
        pivot = armature.data.bones[f"upperarm_{side}"].head_local
        for v in obj.data.vertices:
            p = v.co.copy()
            if mirror:
                p.x = -p.x
            v.co = pivot + (p - pivot) * scale
        if mirror:
            obj.data.flip_normals()
            # Custom split normals survive the mirror pointing the wrong way and
            # would light the cap as if it were still the left one. They are an
            # attribute since 4.1, so dropping the attribute is how they go.
            custom = obj.data.attributes.get("custom_normal")
            if custom is not None:
                obj.data.attributes.remove(custom)
            source_group = obj.vertex_groups["upperarm_l"]
            target_group = obj.vertex_groups["upperarm_r"]
            moved = [(v.index, g.weight) for v in obj.data.vertices
                     for g in v.groups if g.group == source_group.index]
            for index, weight in moved:
                target_group.add([index], weight, "REPLACE")
                source_group.remove([index])

        rebind(obj, armature)
        made.append(obj)
    log(f"built {look} pauldrons: {len(made)} caps, "
        f"{len(made[0].data.vertices)}v each, scale {scale}")
    return made


def assert_coat_clears(look, bodies):
    """Fail the build if the body pokes out through this look's coat.

    Exact rather than radial: a vertex is inside the ring of radius `r` when
    `hypot(x, (y - cy) / depth) < r`, so the ellipse is undone instead of being
    compared against a radius it only reaches at the sides. Comparing the widest
    coat vertex against the widest body vertex is what missed this the first
    time - both peak at the side, and the tunic came through on the diagonal.

    Only the tunic, the legs and the boots are tested. The arms hang outside the
    coat by design, and a check that swallowed them would demand a barrel.
    """
    profile = BODY_LOOKS[look]
    rings = list(profile["rings"]) + list(profile["hem"])
    cy, depth = profile["cy"], profile["depth"]
    z_top = rings[0][0]
    z_hem = min(z for z, _ in rings)

    points = [v.co for obj in bodies for v in obj.data.vertices]
    worst = None
    for z, r in rings:
        # A band, because a ring only has to clear the body it is actually next
        # to; half the gap to the neighbouring rings is the honest reach.
        band = 0.030
        for p in points:
            if abs(p.z - z) > band or not (z_hem <= p.z <= z_top):
                continue
            need = math.hypot(p.x, (p.y - cy) / depth) + COAT_CLEARANCE
            if need > r and (worst is None or need - r > worst[0]):
                worst = (need - r, z, r, need)
    if worst is None:
        log(f"coat {look}: clears the body at every ring (>= {COAT_CLEARANCE * 100:.1f}cm)")
        return
    gap, z, r, need = worst
    message = (f"body.{look}.coat is narrower than the body it covers: at z {z:.3f} "
               f"the ring is r {r:.3f} but the tunic/legs need {need:.3f} "
               f"({gap * 100:.1f}cm through the cloth, standing still)")
    # The ranger profile is the authored reference and is pinned byte-identical,
    # so it is measured and reported rather than enforced: his tunic hem sits
    # about a centimetre inside the clearance at the hip and has always done so.
    # Widening him is a look change, not a bug fix, and it re-baselines the
    # cloth pins with him. Every generated look answers to the check.
    if look == "ranger":
        log(f"NOTE (baseline, not enforced): {message}")
        return
    raise SystemExit(message)


def build_coat(armature, torso, look="ranger"):
    """A coat for a body look, because the item art is not one silhouette.

    The one thing a re-palettized texture cannot buy is shape: a plate cuirass, a
    ranger's coat and a leather jerkin are three shapes, not three colours of one.
    Each `look` in `BODY_LOOKS` is a `(z, radius)` profile lofted the same way and
    named `body.<look>.coat`; the ranger profile is the module constants, so its
    mesh is byte-identical to before.

    The ranger's authored body ends at the hip, so this adds the missing half of
    the silhouette as a lofted skirt hanging from under his belt.

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
    profile = BODY_LOOKS[look]
    coat_rings, coat_hem = profile["rings"], profile["hem"]
    cy, depth = profile["cy"], profile["depth"]
    name = f"body.{look}.coat"

    verts, faces, meta = [], [], []
    rings = list(coat_rings) + [None]  # the hem ring alternates, built inline

    for r, ring in enumerate(rings):
        for s in range(COAT_SEG):
            z, radius = coat_hem[s % len(coat_hem)] if ring is None else ring
            theta = 2.0 * math.pi * s / COAT_SEG
            verts.append(coat_point(theta, z, radius, cy, depth))
            meta.append((theta if theta <= math.pi else theta - 2.0 * math.pi, z))
        if r == 0:
            continue
        top, bottom = (r - 1) * COAT_SEG, r * COAT_SEG
        for s in range(COAT_SEG):
            n = (s + 1) % COAT_SEG
            faces.append((top + s, top + n, bottom + n, bottom + s))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(torso.data.materials[0])

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    samples = torso_uvs(torso)
    if not samples:
        raise SystemExit("coat: the torso has no vertices in the uv sampling band")
    z_hem = min(z for z, _ in coat_hem)
    z_top = coat_rings[0][0]

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
    ranger_body = bpy.data.objects["Male_Ranger_Body"]
    # The tunic, the legs and the boots are what a coat has to cover; the arms
    # hang outside it. Checked before the meshes are renamed, so these are still
    # the pack's own names.
    covered = [ranger_body,
               bpy.data.objects["Male_Ranger_Legs"],
               bpy.data.objects["Male_Ranger_Feet_Boots"]]
    for look in BODY_LOOKS:
        assert_coat_clears(look, covered)
        generated.add(build_coat(armature, ranger_body, look).name)
    # Plate alone: the ranger keeps the pack's own single cap, and a slim leather
    # jerkin with plate shoulders would be neither.
    for cap in build_pauldrons(armature, bpy.data.objects["Male_Ranger_Acc_Pauldron"],
                               "plate", PLATE_PAULDRON_SCALE):
        generated.add(cap.name)
    generated.add(build_cuirass(armature, ranger_body, "plate").name)
    hood = bpy.data.objects["Male_Ranger_Head_Hood"]
    generated.add(build_helm(armature, hood).name)

    # Held gear shares the hood's material, so the whole character is still two
    # draw setups and a weapon can be re-palettized by `build_gear_textures.py`
    # the same way a helmet is.
    iron = hood.data.materials[0]
    for build in (build_wand, build_focus, build_buckler, build_tower):
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

    # A body look is a whole body, not just a coat. `build_coat` gives each look
    # its own skirt silhouette, but the runtime dresses by showing `body.<look>.*`
    # and hiding the rest of the slot - so a look with only a coat renders as a
    # floating coat with no torso, arms or legs. Give every armour look its own
    # copy of the ranger torso/legs/sleeves/hands (same geometry and weights, the
    # coat on top is what differs), so dressing it shows a character.
    for look in BODY_LOOKS:
        if look == "ranger":
            continue  # ranger already owns the pack's body parts
        for part in BODY_BASE_PARTS:
            src = bpy.data.objects[f"body.ranger.{part}"]
            dup = src.copy()
            dup.data = src.data.copy()
            dup.name = f"body.{look}.{part}"
            dup.data.name = dup.name
            bpy.context.scene.collection.objects.link(dup)

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
