"""Add `Rig|Run_Fwd_Loop` to `anim-library.glb`: our own run, built to PoE2's gait traits.

The upper body is the UAL jog's (arms and twist damped). The legs are authored here: each
ankle follows a path made from a handful of gait traits, and two-bone IK puts thigh and calf
on it. PoE2's run (every weapon set shares one set of legs) was MEASURED for those traits as
reference numbers only, by looking at it beside ours (`compare_run.py` in the handoff
evidence); no PoE2 key or sampled trajectory is read or copied here. Its look:

  - a short ground contact (DUTY) on a near-straight leg, hips riding high;
  - push-off into a long trailing leg that keeps swinging back and up after toe-off (TRAIL);
  - then a fast fold, the heel whipped up under the hips (TUCK);
  - the foot swung through and held a hand's height in front (REACH), then put down
    under the knee rather than far out in front (LAND_AHEAD);
  - hips highest as the foot reaches, lowest late in the stance (HIP_TOP, HIP_DIP).

A planted foot moves back at exactly the run's ground speed (SPEED at the clip's own rate),
so `rig.ts` plays it at cadence 1.0 with no slide. The cycle is 20 frames: 0.667 s at the
player's 3.5 u/s, two of the soundscape's 10-tick footsteps. The left foot lands on frame 0
(`LEFT_PLANT`). Rerun `build_direction_clips.py` after this, then `node tools/pack_anims.mjs`.

    blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python tools/build_run_clip.py [-- --no-splice]
"""

import math
import os
import sys
import tempfile

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_direction_clips import (  # noqa: E402
    ANIMS, FPS, KNEE_GAP, LEGS, SOFT_REACH, STANCE_BAND, about, apply, horizontal, sample, splice, turn_onto,
)

SOURCE = "Rig|Jog_Fwd_Loop"
NAME = "Rig|Run_Fwd_Loop"
SCRATCH = os.path.join(tempfile.gettempdir(), "exiled-run-clip.glb")

# Frames per cycle at FPS, and the ground speed it depicts in game units (u/s). The wardrobe
# leg (thigh + shin) is WARDROBE_LEG units, and the clip is rotations only, so a foot's travel
# scales with it.
CYCLE = 20
SPEED = 3.5
WARDROBE_LEG = 0.8876

# Every length below is a share of the leg, every height is the ankle's above where it rests
# with the foot flat, `ahead` is along the run from the mid-hip, phase 0 is touchdown.
# Share of the cycle a foot is on the ground.
DUTY = 0.27
# Ankle ahead of the hips as the foot lands, and its pitch (degrees, toe down positive).
LAND_AHEAD = 0.18
LAND_PITCH = -4
# Share of the stance spent flat before the heel peels off the ground...
FLAT = 0.5
# ...and the toe-down pitch the foot leaves the ground at, pivoting on the toe.
PUSH_PITCH = 32
# (phase, ahead, height, pitch): the trailing leg at its farthest back, swung up nearly straight,
TRAIL = (0.39, -0.80, 0.42, 62)
# the heel at its highest, folded up under the hips,
TUCK = (0.59, -0.45, 0.68, 42)
# and the foot reaching, held off the floor before it drops.
REACH = (0.86, 0.34, 0.17, -12)
# Share of the ground speed the foot is already moving back at as it lands.
LAND_MATCH = 0.5
# Thigh joints' height over the flat ankle: highest as a foot reaches, lowest late in the stance.
HIP_TOP = (0.88, 0.99)
HIP_DIP = (0.15, 0.91)
# Radians the hips turn each way, the reaching leg's side forward, at the reach.
HIP_YAW = math.radians(10)
# Share of the arms' swing off their mean pose kept.
ARM_KEEP = 0.55
ARM_PARTS = ("clavicle", "upperarm", "lowerarm", "hand")
# Share of the trunk's twist kept: the jog turns the shoulders through 80 degrees on still
# hips. Neck and head go with it, so the face still looks where it did.
SPINE_KEEP = 0.8
SPINE_PARTS = ("spine_01", "spine_02", "spine_03", "neck_01", "Head")
# Knee pole: forward, and this share outward (negative: in). PoE2's knee stays on the hip-ankle
# line or just inside it through the fold; one bowed out reads as a waddle.
KNEE_OUT = 0.0
# Feet planted toward the midline, in legs inside the jog's track, as (mean, each way): fullest
# at mid-stance, back out at the tuck. PoE2 runs on a narrow track, each foot landing ~0.12 of
# a leg inside its own hip.
TRACK_IN = (0.055, 0.055)
# Each wrist off the chest, in legs, over its swing: ahead of the chest (mean, each way), out to
# its side (mean, and in toward the midline at the front), and above the hips (mean at the ends,
# higher in front, and the drop as it passes the hip, a pendulum's arc). Low, close in, elbows
# bent the whole way, pumping against the opposite leg: PoE2's free-arm run, against the jog's
# arms held high and flared out with the elbows locked.
# Per arm, left then right: the right carries the weapon, held lower, wider and straighter.
ARM_SWING = ((0.02, 0.24), (0.02, 0.22))
ARM_OUT = ((0.20, 0.10), (0.26, 0.06))
ARM_HEIGHT = ((0.18, 0.03, 0.07), (0.11, -0.03, 0.02))
# Elbow pole: behind the arm, and this share outward.
ELBOW_OUT = 0.6
ARMS = (("upperarm_l", "lowerarm_l", "hand_l"), ("upperarm_r", "lowerarm_r", "hand_r"))
# The bow held through the run (`rig.ts` lays it over the run while a bow is worn): PoE2's bow run
# keeps both arms near still, the bow arm forward and low and nearly straight, the draw hand bent
# up by the chest. Per arm (ahead of the chest, out to its side, above the hips) in legs, and the
# elbow pole as (behind, out, down). One pose, the mean over the cycle; the bow fist stays
# `Rig|Bow_Carry`'s, so only the arm bones are keyed.
BOW_RUN = "Rig|Bow_RunCarry"
BOW_HOLD = (((0.25, 0.03, 0.10), (0.0, 0.5, 1.0)), ((0.16, 0.13, 0.21), (1.0, 0.6, 0.3)))
BOW_KEYED = ("upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r")


def mean_rotation(quats):
    """Normalised sum, each flipped into the first one's hemisphere."""
    ref = quats[0]
    total = Quaternion((0, 0, 0, 0))
    for q in quats:
        total = total + (q if q.dot(ref) >= 0 else -q)
    return total.normalized()


def hermite(p0, p1, m0, m1, t):
    t2, t3 = t * t, t * t * t
    return [(2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * c + (-2 * t3 + 3 * t2) * b + (t3 - t2) * d
            for a, b, c, d in zip(p0, p1, m0, m1)]


def gait(stance_speed):
    """Phase -> (ahead, height, pitch, on the ground) of one foot, from the traits above.

    `stance_speed` is how far the planted foot moves back per unit of phase, in legs. Off
    the ground the path is a Hermite spline through toe-off, TRAIL, TUCK, REACH and
    touchdown, Catmull-Rom tangents inside, the stance's own velocity at both ends."""
    def stance(u):
        ahead = LAND_AHEAD - stance_speed * u
        flat_until = DUTY * FLAT
        if u < 0.04:
            pitch = LAND_PITCH * (1 - u / 0.04)
        elif u <= flat_until:
            pitch = 0.0
        else:
            s = (u - flat_until) / (DUTY - flat_until)
            pitch = PUSH_PITCH * s * s
        return ahead, pitch

    keys = [(DUTY,), TRAIL, TUCK, REACH, (1.0, LAND_AHEAD, 0.0, LAND_PITCH)]
    off_ahead, off_pitch = stance(DUTY)
    keys[0] = (DUTY, off_ahead, None, off_pitch)  # height filled per foot: it depends on the toe pivot
    return stance, keys


def build(arm, up, forward):
    action = bpy.data.actions[SOURCE]
    start, end = (int(round(v)) for v in action.frame_range)
    frames = sample(arm, action, start, end)
    jog_cycle = len(frames) - 1  # the last frame repeats the first, so the loop closes
    bones = arm.pose.bones
    rest = arm.data.bones
    leg_length = sum((rest[a].head_local - rest[b].head_local).length for a, b in ((LEGS[0][0], LEGS[0][1]), (LEGS[0][1], LEGS[0][2])))
    side = up.cross(forward).normalized()  # turning about it by +angle puts the toe down

    # The jog's left touchdown: the stride's phase 0, so the arms keep swinging against the legs.
    heights = [legs[0][1].dot(up) for _p, legs, _t in frames[:jog_cycle]]
    ground = [h < min(heights) + STANCE_BAND for h in heights]
    jog_land = next(t for t in range(jog_cycle) if ground[t] and not ground[t - 1])

    origin = sum((horizontal((legs[0][0] + legs[1][0]) / 2, up) for _p, legs, _t in frames[:jog_cycle]), Vector()) / jog_cycle
    pelvis_mean = Vector()
    for pose, _l, _t in frames[:jog_cycle]:
        apply(arm, pose)
        pelvis_mean += horizontal(bones["pelvis"].head, up)
    pelvis_mean /= jog_cycle

    def knee_angle(legs_i):
        hip, ankle = legs_i[0], legs_i[1]
        return (ankle - hip).length

    # Per leg: a bent base pose for the IK (a straight knee has no hinge plane), the flat
    # foot it lands on, and its line across.
    base, flat_rot, flat_ball, flat_toe, lateral = [], [], [], [], []
    ankle_flat = toe_floor = None
    for i, leg in enumerate(LEGS):
        bent = min(range(jog_cycle), key=lambda f: knee_angle(frames[f][1][i]))
        base.append({n: frames[bent][0][n][1].copy() for n in leg[:3]})
        hs = [legs[i][1].dot(up) for _p, legs, _t in frames[:jog_cycle]]
        low = min(hs)
        down = [f for f in range(jog_cycle) if hs[f] < low + STANCE_BAND]
        mid = down[len(down) // 2]
        apply(arm, frames[mid][0])
        foot = bones[leg[2]]
        flat_rot.append(foot.matrix.to_3x3().normalized())
        flat_ball.append(frames[mid][0][foot.children[0].name][1].copy())
        flat_toe.append(bones[leg[3]].head - foot.head)
        if i == 0:
            ankle_flat = foot.head.dot(up)
            toe_floor = bones[leg[3]].head.dot(up)
        offs = [horizontal(legs[i][1], up) - origin for _p, legs, _t in frames[:jog_cycle]]
        mean = sum(offs, Vector()) / jog_cycle
        lateral.append(mean - forward * mean.dot(forward))

    # Which way round `side` puts the toe down, off the rig rather than assumed.
    if (Matrix.Rotation(0.1, 3, side) @ flat_toe[0]).dot(up) > flat_toe[0].dot(up):
        side = -side
    # Ground speed per unit of phase, in legs: SPEED over one cycle of CYCLE frames.
    stance_speed = SPEED * (CYCLE / FPS) / WARDROBE_LEG
    stance, keys = gait(stance_speed)

    def pitched(pitch, i):
        return Matrix.Rotation(math.radians(pitch), 3, side)

    def stance_ankle(u, i):
        ahead, pitch = stance(u)
        flat = origin + lateral[i] + forward * (ahead * leg_length) + up * ankle_flat
        if pitch <= 0:
            return flat, pitch  # heel down: the foot turns about the ankle
        toe = flat + flat_toe[i]
        return toe - pitched(pitch, i) @ flat_toe[i], pitch

    def path(u, i):
        """Ankle position and pitch of leg i at phase u, drawn in toward the midline."""
        where, pitch = track(u, i)
        inward = -lateral[i].normalized()
        return where + inward * ((TRACK_IN[0] + TRACK_IN[1] * math.cos(2 * math.pi * (u - DUTY / 2))) * leg_length), pitch

    def track(u, i):
        u %= 1.0
        if u <= DUTY:
            return stance_ankle(u, i)
        off, off_pitch = stance_ankle(DUTY, i)
        eps = 1e-3
        before, _ = stance_ankle(DUTY - eps, i)
        k0 = (DUTY, (off - origin - lateral[i]).dot(forward) / leg_length, (off.dot(up) - ankle_flat) / leg_length, off_pitch)
        v0 = ((off - before).dot(forward) / leg_length / eps, (off - before).dot(up) / leg_length / eps)
        pts = [k0, TRAIL, TUCK, REACH, keys[-1]]
        j = next(j for j in range(len(pts) - 1) if pts[j][0] <= u <= pts[j + 1][0])
        a, b = pts[j], pts[j + 1]
        span = b[0] - a[0]

        def tangent(k):
            if k == 0:
                return [v0[0], v0[1], (pts[1][3] - pts[0][3]) / (pts[1][0] - pts[0][0])]
            if k == len(pts) - 1:
                return [-stance_speed * LAND_MATCH, 0.0, (LAND_PITCH - pts[k - 1][3]) / (pts[k][0] - pts[k - 1][0])]
            p, n = pts[k - 1], pts[k + 1]
            return [(n[c] - p[c]) / (n[0] - p[0]) for c in (1, 2, 3)]

        m0 = [x * span for x in tangent(j)]
        m1 = [x * span for x in tangent(j + 1)]
        ahead, height, pitch = hermite(a[1:], b[1:], m0, m1, (u - a[0]) / span)
        return origin + lateral[i] + forward * (ahead * leg_length) + up * (ankle_flat + height * leg_length), pitch

    def hip_height(u):
        """Thigh joints over the flat ankle, in legs: one rise and one fall per step."""
        s = u % 0.5 / 0.5
        dip, top = HIP_DIP[0] * 2 % 1, HIP_TOP[0] * 2 % 1
        rise = (top - dip) % 1
        x = (s - dip) % 1
        if x < rise:
            w = 0.5 - 0.5 * math.cos(math.pi * x / rise)
        else:
            w = 0.5 + 0.5 * math.cos(math.pi * (x - rise) / (1 - rise))
        return HIP_DIP[1] + (HIP_TOP[1] - HIP_DIP[1]) * w

    keep = {n: ARM_KEEP for n in frames[0][0] if n.startswith(ARM_PARTS)}
    keep.update({n: SPINE_KEEP for n in frames[0][0] if n.startswith(SPINE_PARTS)})
    mean_rot = {n: mean_rotation([frames[f][0][n][1] for f in range(jog_cycle)]) for n in keep}

    apply(arm, frames[0][0])
    gaze = horizontal(bones["Head"].matrix.to_3x3().col[2], up).normalized()
    test = about(bones["pelvis"].head.copy(), Matrix.Rotation(0.1, 3, up))
    left = bones[LEGS[0][0]].head
    yaw_sign = 1.0 if ((test @ left) - left).dot(forward) > 0 else -1.0

    def frame_of(a, b):
        x = a.normalized()
        y = a.cross(b).normalized()
        return Matrix((x, y, x.cross(y))).transposed()

    def solve(top, mid, end, target, pole):
        """Two-bone IK off the chain's current pose: `end` onto `target`, the joint toward `pole`."""
        root, joint, tip = top.head.copy(), mid.head.copy(), end.head.copy()
        upper, lower = (joint - root).length, (tip - joint).length
        reach = target - root
        full = upper + lower
        ease = full * SOFT_REACH
        span = reach.length
        if span > full - ease:
            span = full - ease + ease * (1.0 - math.exp(-(span - full + ease) / ease))
        aim = reach.normalized()
        bend = (pole - aim * pole.dot(aim)).normalized()
        along = (upper * upper - lower * lower + span * span) / (2 * span)
        new_joint = root + aim * along + bend * math.sqrt(max(0.0, upper * upper - along * along))
        reached = root + aim * span
        turn = frame_of(new_joint - root, reached - root) @ frame_of(joint - root, tip - root).transposed()
        top.matrix = about(root, turn) @ top.matrix
        bpy.context.view_layer.update()
        mid.matrix = about(mid.head.copy(), turn_onto(end.head - mid.head, reached - mid.head)) @ mid.matrix
        bpy.context.view_layer.update()

    posed, knee_gaps, toes, knees, bow_frames = [], [], [], [], []
    for k in range(CYCLE + 1):
        u = k / CYCLE
        # The jog's upper body at the same share of its stride.
        x = (jog_land + u * jog_cycle) % jog_cycle
        f0, t = int(x), x - int(x)
        pa, pb = frames[f0][0], frames[(f0 + 1) % jog_cycle][0]
        pose = {}
        for n in pa:
            la, ra = pa[n]
            lb, rb = pb[n]
            pose[n] = (la.lerp(lb, t), ra.slerp(rb if rb.dot(ra) >= 0 else -rb, t))
        for n, kk in keep.items():
            loc, rot = pose[n]
            pose[n] = (loc, mean_rot[n].slerp(rot if rot.dot(mean_rot[n]) >= 0 else -rot, kk))
        apply(arm, pose)

        pelvis = bones["pelvis"]
        thighs = (bones[LEGS[0][0]].head + bones[LEGS[1][0]].head) / 2
        lift = ankle_flat + hip_height(u) * leg_length - thighs.dot(up)
        slide = pelvis_mean - horizontal(pelvis.head, up)
        reach_l = math.cos(2 * math.pi * (u - REACH[0]))  # 1 while the left foot reaches
        yaw = yaw_sign * HIP_YAW * reach_l
        pelvis.matrix = Matrix.Translation(up * lift + slide) @ about(pelvis.head.copy(), Matrix.Rotation(yaw, 3, up)) @ pelvis.matrix
        bpy.context.view_layer.update()
        head = bones["Head"]
        now = horizontal(head.matrix.to_3x3().col[2], up).normalized()
        head.matrix = about(head.head.copy(), now.rotation_difference(gaze).to_matrix()) @ head.matrix
        bpy.context.view_layer.update()

        # Each wrist on its own path off the chest, swinging against the leg on its side.
        chest = bones["spine_03"].head.copy()
        hips_up = bones["pelvis"].head.dot(up)
        for i, names in enumerate(ARMS):
            c = math.cos(2 * math.pi * (u - REACH[0] - 0.5 * (1 - i)))  # 1 with this wrist farthest forward
            outward = lateral[i].normalized()
            swing, out, rise = ARM_SWING[i], ARM_OUT[i], ARM_HEIGHT[i]
            target = (horizontal(chest, up) + forward * ((swing[0] + swing[1] * c) * leg_length)
                      + outward * ((out[0] - out[1] * c) * leg_length)
                      + up * (hips_up + (rise[0] + rise[1] * c - rise[2] * (1 - c * c)) * leg_length))
            solve(*(bones[n] for n in names), target, -forward + outward * ELBOW_OUT - up * 0.2)

        for i, leg in enumerate(LEGS):
            target, pitch = path(u + 0.5 * i, i)
            thigh, calf, foot = (bones[n] for n in leg[:3])
            for n in leg[:3]:
                bones[n].rotation_quaternion = base[i][n]
            bpy.context.view_layer.update()
            outward = lateral[i].normalized() if lateral[i].length > 1e-9 else Vector()
            solve(thigh, calf, foot, target, forward + outward * KNEE_OUT)
            foot.matrix = Matrix.Translation(foot.head.copy()) @ (Matrix.Rotation(math.radians(pitch), 3, side) @ flat_rot[i]).to_4x4()
            foot.children[0].rotation_quaternion = flat_ball[i]
            bpy.context.view_layer.update()
            # Toe through the floor (a pitch the path asked for low over the ground): lift the leg onto it.
            sink = toe_floor - bones[leg[3]].head.dot(up)
            if sink > 1e-6:
                raise AssertionError(f"frame {k} leg {i}: toe {sink * 1e4:.1f} cm through the floor")
            knees.append(math.degrees((calf.head - thigh.head).angle(foot.head - calf.head)))
        # The bow hold on this frame's chest, then the run's own arms back.
        saved = {n: bones[n].rotation_quaternion.copy() for n in BOW_KEYED}
        for i, names in enumerate(ARMS):
            (ahead, out, rise), (behind, side_out, down) = BOW_HOLD[i]
            outward = lateral[i].normalized()
            target = (horizontal(chest, up) + forward * (ahead * leg_length) + outward * (out * leg_length)
                      + up * (hips_up + rise * leg_length))
            solve(*(bones[n] for n in names), target, -forward * behind + outward * side_out - up * down)
        bow_frames.append({n: bones[n].rotation_quaternion.copy() for n in BOW_KEYED})
        for n, q in saved.items():
            bones[n].rotation_quaternion = q
        bpy.context.view_layer.update()
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
    stale = bpy.data.actions.get(BOW_RUN)
    if stale is not None:
        bpy.data.actions.remove(stale)
    bow = bpy.data.actions.new(BOW_RUN)
    arm.animation_data.action = bow
    for n in BOW_KEYED:
        bones[n].rotation_quaternion = mean_rotation([f[n] for f in bow_frames[:CYCLE]])
        for frame in (start, start + 1):
            bones[n].keyframe_insert("rotation_quaternion", frame=frame)
    arm.animation_data.action = None
    bpy.context.view_layer.update()
    elbows = [math.degrees((bones[n[1]].head - bones[n[0]].head).angle(bones[n[2]].head - bones[n[1]].head)) for n in ARMS]
    print(f"{BOW_RUN}: elbows {180 - elbows[0]:.0f} / {180 - elbows[1]:.0f} deg (bow / draw)")
    folds = [180 - a for a in knees]
    print(f"{NAME}: {len(posed)} frames, knee {min(folds):.0f}-{max(folds):.0f} deg, "
          f"knees {min(knee_gaps) * 1e4:.1f} cm apart at the closest, planted foot {stance_speed / (CYCLE / FPS):.2f} legs/s")
    assert min(knee_gaps) >= KNEE_GAP, f"knees {min(knee_gaps) * 1e4:.1f} cm apart"
    return made, bow


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
    made, bow = build(arm, up, forward)
    for action in list(bpy.data.actions):
        if action not in (made, bow):
            bpy.data.actions.remove(action)
    bpy.ops.export_scene.gltf(
        filepath=SCRATCH, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS",
        export_frame_range=False, export_optimize_animation_size=False, export_apply=False,
    )
    if "--no-splice" in sys.argv:
        print(f"scratch only: {SCRATCH}")
        return
    splice({NAME: SOURCE, BOW_RUN: SOURCE}, SCRATCH, only={BOW_RUN: set(BOW_KEYED)})
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
