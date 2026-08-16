"""Build `anim-library.glb`: the clips `rig.ts` plays, on the wardrobe's skeleton.

Run headless:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --disable-autoexec --python-exit-code 1 \
      --python tools/build_anim_library.py

This used to be a retarget. The old animation pack was a different skeleton at
different proportions from the wardrobe's, so `rig.ts` had to rescale the hips
curve into the outfit's own rest offsets, and two of the six clips did not exist
at all: the cast was a LEFT-handed spell mirrored onto the right arm offline
(`build_cast_mirror.py`) and the second slash was the first one rolled and played
backwards (`build_slash_variant.py`).

KayKit animates the same `Rig_Medium` skeleton the wardrobe is built on, so this
is a copy, not a retarget: same bone names, same rest pose, same proportions.
The pack's free clip set is 139 takes across eight files; this ships the six the
runtime asks for, each exported as an NLA strip whose name is the clip name.
"""
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(
    ROOT, "assets", "props", "source", "kaykit_animations_char",
    "KayKit_Character_Animations_1.1", "Animations", "gltf", "Rig_Medium",
)
OUT = os.path.join(ROOT, "apps", "web", "public", "models", "anim-library.glb")

# Source file -> the clips taken from it. Names on the right are what ships, and
# what `CLIP_NAME` in `rig.ts` must say.
#
# The two strikes are deliberately opposite motions rather than one swing and its
# reverse: a diagonal slice comes down across the body, a chop comes straight
# over the top, so an alternated melee reads as two attacks instead of a loop.
CLIPS = {
    "Rig_Medium_General.glb": {"Idle_A": "Idle_Loop"},
    "Rig_Medium_MovementBasic.glb": {
        "Walking_A": "Walk_Loop",
        "Running_A": "Run_Loop",
    },
    "Rig_Medium_CombatRanged.glb": {"Ranged_Magic_Shoot": "Cast_Shoot"},
    "Rig_Medium_CombatMelee.glb": {
        "Melee_1H_Attack_Slice_Diagonal": "Sword_Attack",
        "Melee_1H_Attack_Chop": "Sword_Attack_Down",
    },
}


def log(msg):
    print("[anims] %s" % msg, file=sys.stderr)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    master = None
    strips = []

    for filename, wanted in CLIPS.items():
        path = os.path.join(PACK, filename)
        if not os.path.exists(path):
            sys.exit("missing animation source %s" % path)

        before = set(bpy.data.objects)
        actions_before = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=path)
        added = [o for o in bpy.data.objects if o not in before]
        armature = next(o for o in added if o.type == "ARMATURE")
        new_actions = {a.name: a for a in bpy.data.actions if a not in actions_before}

        if master is None:
            master = armature
            master.name = "Rig_Medium"
            master.animation_data_clear()
            master.animation_data_create()
        else:
            for o in added:
                bpy.data.objects.remove(o, do_unlink=True)

        for source, ship in wanted.items():
            action = new_actions.get(source)
            if action is None:
                sys.exit("%s has no clip %r (has %s)"
                         % (filename, source, sorted(new_actions)))
            action.name = ship
            action.use_fake_user = True
            strips.append(action)

        for name, action in new_actions.items():
            if action not in strips:
                bpy.data.actions.remove(action)

    # The mannequin's own geometry rides along in the source files. The library
    # is played onto `wardrobe.glb`'s skeleton, so shipping a second body would
    # be a second character standing inside the first.
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        bpy.data.objects.remove(obj, do_unlink=True)

    # One NLA track per clip. The exporter names each exported animation after
    # its strip, so the track layout IS the clip list the runtime sees.
    for action in strips:
        track = master.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, int(action.frame_range[0]), action)
        strip.name = action.name
        track.mute = False
        log("%s  %d frames" % (action.name, action.frame_range[1] - action.frame_range[0]))

    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_skins=True,
        export_yup=True,
        use_selection=False,
    )
    log("wrote %s (%.2f MB)" % (OUT, os.path.getsize(OUT) / 1e6))


main()
