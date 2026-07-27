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

COAT_SEG = 24

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
SKIRT_CHAINS = 8

# Both joints in a chain are deliberately the same length: the runtime reads one
# segment length off the asset and uses it for both, so there is no second copy
# of these numbers to drift. `rig.test.ts` pins it.
SKIRT_JOINT = "skirt_{i}_{n:02d}"

# Where the chain hangs from and reaches to. Taken from the coat's own profile so
# the bones cannot drift away from the cloth they carry.
SKIRT_TOP_Z, SKIRT_TOP_R = COAT_RINGS[0]
SKIRT_HEM_Z = sum(z for z, _ in COAT_HEM) / len(COAT_HEM)
SKIRT_HEM_R = sum(r for _, r in COAT_HEM) / len(COAT_HEM)

# Height along the chain (0 at the waist, 1 at the hem) where the cloth stops
# being pinned to the body and where it hands over to the lower joint. The top
# band keeps the waist crisp under the belt; everything below swings.
SKIRT_PINNED = 0.20
SKIRT_LOWER = 0.45

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
        mid = (top + hem) * 0.5

        upper = bones.new(SKIRT_JOINT.format(i=i, n=1))
        upper.head, upper.tail = to_local @ top, to_local @ mid
        upper.parent, upper.use_connect = pelvis, False

        lower = bones.new(SKIRT_JOINT.format(i=i, n=2))
        lower.head, lower.tail = to_local @ mid, to_local @ hem
        lower.parent, lower.use_connect = upper, True

        made += [upper.name, lower.name]

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
    # costs a whole extra attribute set on every vertex of the mesh.
    pelvis = obj.vertex_groups.new(name="pelvis")
    chains = [
        (obj.vertex_groups.new(name=SKIRT_JOINT.format(i=i, n=1)),
         obj.vertex_groups.new(name=SKIRT_JOINT.format(i=i, n=2)))
        for i in range(SKIRT_CHAINS)
    ]
    step = 2.0 * math.pi / SKIRT_CHAINS
    for v, (theta, z) in zip(mesh.vertices, meta):
        t = min(1.0, max(0.0, (SKIRT_TOP_Z - z) / (SKIRT_TOP_Z - SKIRT_HEM_Z)))
        pinned = min(1.0, max(0.0, (SKIRT_PINNED - t) / SKIRT_PINNED))
        lower = min(1.0, max(0.0, (t - SKIRT_LOWER) / (1.0 - SKIRT_LOWER)))
        upper = 1.0 - pinned - lower

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
            g_upper, g_lower = chains[chain]
            g_upper.add([v.index], upper * share, "REPLACE")
            g_lower.add([v.index], lower * share, "REPLACE")
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
    generated.add(build_helm(armature, bpy.data.objects["Male_Ranger_Head_Hood"]).name)

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
