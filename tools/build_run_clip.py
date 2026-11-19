"""Add `Rig|Run_Fwd_Loop` to `anim-library.glb`: the UAL jog reshaped toward PoE2's run.

The jog is a bounding run: the hips bounce 0.28 of a leg's length per step, the knees rise
high in front, the shoulders twist 80 degrees over still hips and the arms pump. PoE2's run
(every weapon set shares one set of legs) stays low and flat, swings the trailing leg back
nearly straight, turns the hips with the stride and keeps the arms near the weapon. Those
traits were measured off the PoE2 client's clips as REFERENCE NUMBERS only; no PoE2 key is
read or copied here. Every pose below is the jog's own, moved by the knobs, and lands at:

                       PoE2 run     this run    UAL jog   (per leg length, or degrees)
  hip bounce             0.10         0.10        0.28    BOB_KEEP
  knee lift              0.28         0.23        0.57    KNEE_CUT, BOB_KEEP
  arm swing           0.23-0.51       0.52        0.87    ARM_KEEP, SPINE_KEEP
  shoulder twist         31-51          43          80    SPINE_KEEP, HIP_YAW
  hip turn                 20          20.5          1    HIP_YAW
  knee under 100 deg   26% of frames   14%         30%    EXTEND, KICK, HIP_LIFT
  lean                     22           23          23    unchanged

The stride is cut to 0.75 (STRIDE_KEEP) so the run turns over at PoE2's 0.667 s cycle at
the player's speed with little slide (`CADENCE` in rig.ts). The pelvis moves first, then each
ankle is put back on its reshaped track by the two-bone IK of `build_direction_clips.py`, so
the stance foot stays on the floor. The jog's timing is kept frame for frame, so `LEFT_PLANT`
holds and the direction clips made from this run keep their phase. Rerun
`build_direction_clips.py` after this, then `node tools/pack_anims.mjs`.

    blender --background --factory-startup --disable-autoexec         --python-exit-code 1 --python tools/build_run_clip.py [-- --no-splice]
"""

import math
import os
import sys
import tempfile

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_direction_clips import (  # noqa: E402
    ANIMS, FPS, KNEE_GAP, LEGS, STANCE_BAND, about, apply, horizontal, sample, solve_leg, splice,
)

SOURCE = "Rig|Jog_Fwd_Loop"
NAME = "Rig|Run_Fwd_Loop"
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-run-clip.glb")

# Share of the jog's vertical hip travel kept.
BOB_KEEP = 0.36
# Hips raised by this share of a leg: the jog's stance knee bends to 90 degrees, PoE2's to 130.
HIP_LIFT = 0.05
# Share of each foot's fore-aft travel off its mean kept: a shorter step turns over faster at one ground speed.
STRIDE_KEEP = 0.75
# A swinging foot's height off the floor, raised by this share at its farthest behind...
KICK = 0.25
# ...and lowered by this share at its farthest in front.
KNEE_CUT = 0.75
# A foot trailing in the air is pushed back until the hip-to-ankle span is this share of the
# leg, in full from halfway back: PoE2 lifts the heel by swinging the leg back nearly
# straight and folds the knee only as it comes through. A knee held bent through the swing
# shows the Emberbound robe's dark leg backing (rig.test.ts).
EXTEND = 0.9
# Share of the arms' swing off their mean pose kept.
ARM_KEEP = 0.55
ARM_PARTS = ("clavicle", "upperarm", "lowerarm", "hand")
# Share of the trunk's twist kept: the jog turns the shoulders through 80 degrees on still
# hips. Neck and head go with it, so the face still looks where it did.
SPINE_KEEP = 0.8
SPINE_PARTS = ("spine_01", "spine_02", "spine_03", "neck_01", "Head")
# Radians the hips turn each way with the stride, the reaching leg's side forward.
HIP_YAW = math.radians(10)


def mean_rotation(quats):
    """Normalised sum, each flipped into the first one's hemisphere."""
    ref = quats[0]
    total = Quaternion((0, 0, 0, 0))
    for q in quats:
        total = total + (q if q.dot(ref) >= 0 else -q)
    return total.normalized()


def build(arm, up, forward):
    action = bpy.data.actions[SOURCE]
    start, end = (int(round(v)) for v in action.frame_range)
    frames = sample(arm, action, start, end)
    cycle = len(frames) - 1  # the last frame repeats the first, so the loop closes

    hips = [(legs[0][0] + legs[1][0]).dot(up) / 2 for _p, legs, _t in frames]
    rest_legs = arm.data.bones
    leg_length = sum((rest_legs[a].head_local - rest_legs[b].head_local).length for a, b in ((LEGS[0][0], LEGS[0][1]), (LEGS[0][1], LEGS[0][2])))
    mean_hips = sum(hips[:cycle]) / cycle
    keep = {n: ARM_KEEP for n in frames[0][0] if n.startswith(ARM_PARTS)}
    keep.update({n: SPINE_KEEP for n in frames[0][0] if n.startswith(SPINE_PARTS)})
    rest = {n: mean_rotation([frames[f][0][n][1] for f in range(cycle)]) for n in keep}

    tracks, leads = [], []
    for i in range(len(LEGS)):
        flat = [horizontal(legs[i][1] - (legs[0][0] + legs[1][0]) / 2, up) for _p, legs, _t in frames]
        neutral = sum(flat[:cycle], Vector()) / cycle
        reach = max(abs((f - neutral).dot(forward)) for f in flat)
        heights = [legs[i][1].dot(up) for _p, legs, _t in frames]
        floor = min(heights)
        track = []
        for f, h, hip in zip(flat, heights, hips):
            ahead = (f - neutral).dot(forward)
            where = neutral + (f - neutral) - forward * ahead * (1 - STRIDE_KEEP)
            s = ahead / reach
            lift = (h - floor) * (1 + KICK * max(0.0, -s) - KNEE_CUT * max(0.0, s))
            if s < 0 and h - floor > STANCE_BAND:
                drop = mean_hips + (hip - mean_hips) * BOB_KEEP + HIP_LIFT * leg_length - floor - lift
                behind = -where.dot(forward)
                want = leg_length * EXTEND * min(1.0, -2 * s)
                if behind > 0 and want > drop and math.hypot(behind, drop) < want:
                    where -= forward * (math.sqrt(want * want - drop * drop) - behind)
            track.append((where, floor + lift))
        tracks.append(track)
        leads.append([(f - neutral).dot(forward) / reach for f in flat])

    apply(arm, frames[0][0])
    gaze = horizontal(arm.pose.bones["Head"].matrix.to_3x3().col[2], up).normalized()

    toe_floor = min(legs[i][2].dot(up) for _p, legs, _t in frames for i in range(len(LEGS)))
    posed, knee_gaps, toes = [], [], []
    for index, (pose, _legs, _trunk) in enumerate(frames):
        pose = dict(pose)
        for n, k in keep.items():
            loc, rot = pose[n]
            pose[n] = (loc, rest[n].slerp(rot if rot.dot(rest[n]) >= 0 else -rot, k))
        apply(arm, pose)
        bones = arm.pose.bones
        pelvis = bones["pelvis"]
        if index == 0:
            # Which way round `up` carries the left hip forward, off the rig rather than assumed.
            test = about(pelvis.head.copy(), Matrix.Rotation(0.1, 3, up))
            left = bones[LEGS[0][0]].head
            sign = 1.0 if ((test @ left) - left).dot(forward) > 0 else -1.0
        yaw = sign * HIP_YAW * (leads[0][index] - leads[1][index]) / 2
        drop = (hips[index] - mean_hips) * (1 - BOB_KEEP) - HIP_LIFT * leg_length
        pelvis.matrix = about(pelvis.head.copy(), Matrix.Rotation(yaw, 3, up)) @ Matrix.Translation(-up * drop) @ pelvis.matrix
        bpy.context.view_layer.update()
        # The jog's face looks one way the whole cycle; turned hips would swing it 19 degrees.
        head = bones["Head"]
        now = horizontal(head.matrix.to_3x3().col[2], up).normalized()
        head.matrix = about(head.head.copy(), now.rotation_difference(gaze).to_matrix()) @ head.matrix
        bpy.context.view_layer.update()
        # The feet stay pointed down the run while the hips turn above them.
        unturn = Matrix.Rotation(-yaw, 3, up)
        for i, leg in enumerate(LEGS):
            where, height = tracks[i][index]
            # The foot keeps its authored pitch, so a lowered landing would put the toe through the floor.
            height = max(height, toe_floor - (bones[leg[3]].head - bones[leg[2]].head).dot(up))
            mid = (bones[LEGS[0][0]].head + bones[LEGS[1][0]].head) / 2
            solve_leg(arm, leg, horizontal(mid, up) + where + up * height, unturn)
        knee_gaps.append(horizontal(bones[LEGS[0][1]].head - bones[LEGS[1][1]].head, up).length)
        toes.append(min(bones[leg[3]].head.dot(up) for leg in LEGS))
        posed.append({b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in bones})

    stale = bpy.data.actions.get(NAME)
    if stale is not None:
        bpy.data.actions.remove(stale)
    made = bpy.data.actions.new(NAME)
    arm.animation_data.action = made
    for index, pose in enumerate(posed):
        for bone_name, (loc, rot) in pose.items():
            bone = arm.pose.bones[bone_name]
            bone.location, bone.rotation_quaternion = loc, rot
            bone.keyframe_insert("location", frame=start + index)
            bone.keyframe_insert("rotation_quaternion", frame=start + index)
    arm.animation_data.action = None
    print(f"{NAME}: {len(posed)} frames, knees {min(knee_gaps) * 1e4:.1f} cm apart at the closest, "
          f"toe {(toe_floor - min(toes)) * 1e4:.1f} cm under the jog's lowest")
    assert min(knee_gaps) >= KNEE_GAP, f"knees {min(knee_gaps) * 1e4:.1f} cm apart"
    # The heel kick and the lower hips only raise or keep a foot: a toe below the jog's floor is a solve gone wrong.
    assert min(toes) >= toe_floor - 2e-5, f"toe {(toe_floor - min(toes)) * 1e4:.1f} cm through the floor"
    return made


def main():
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.animation_data_create()
    for b in arm.pose.bones:
        b.rotation_mode = "QUATERNION"
    up = (arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1))).normalized()
    rest = arm.data.bones
    forward = horizontal(rest["foot_end_l"].head_local - rest["foot_l"].head_local, up).normalized()
    made = build(arm, up, forward)
    for action in list(bpy.data.actions):
        if action is not made:
            bpy.data.actions.remove(action)
    bpy.ops.export_scene.gltf(
        filepath=SCRATCH, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS",
        export_frame_range=False, export_optimize_animation_size=False, export_apply=False,
    )
    if "--no-splice" in sys.argv:
        print(f"scratch only: {SCRATCH}")
        return
    splice({NAME: SOURCE}, SCRATCH)
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
