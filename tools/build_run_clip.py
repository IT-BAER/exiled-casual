"""Add `Rig|Run_Fwd_Loop` to `anim-library.glb`: our own run, built to PoE2's gait traits.

The upper body is the UAL jog's (arms and twist damped). The legs are authored here: each
ankle follows a path made from a handful of gait traits, and two-bone IK puts thigh and calf
on it. PoE2's run (every weapon set shares one set of legs) was MEASURED for those traits as
reference numbers only: the trait values below were searched until our curves (knee, ankle,
hips, roll, lean, wrists) came closest to its measured ones (`fit_run.py`, `score_run.py` in
the handoff evidence); no PoE2 key or sampled trajectory is read or copied here. Its look:

  - a short ground contact (DUTY) on a near-straight leg, hips riding high;
  - push-off into a long trailing leg that keeps swinging back and up after toe-off (TRAIL);
  - then a fast fold, the heel whipped up under the hips (TUCK);
  - the foot swung through and held a hand's height in front (REACH), then put down
    under the knee rather than far out in front (LAND_AHEAD);
  - hips highest as the foot reaches, lowest late in the stance (HIP_TOP, HIP_DIP).

A planted foot moves back at exactly the run's ground speed (SPEED at the clip's own rate),
so `rig.ts` plays it at cadence 1.0 with no slide. The cycle is 20 frames: 0.667 s at the
player's base 4.2 u/s, two of the soundscape's 10-tick footsteps. The left foot lands on frame 0
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
SPEED = 4.2
WARDROBE_LEG = 0.8876

# Every length below is a share of the leg, every height is the ankle's above where it rests
# with the foot flat, `ahead` is along the run from the mid-hip, phase 0 is touchdown.
# Share of the cycle a foot is on the ground.
DUTY = 0.2325
# Ankle ahead of the hips as the foot lands, and its pitch (degrees, toe down positive).
LAND_AHEAD = 0.2075
LAND_PITCH = -17.5
# Share of the stance spent flat before the heel peels off the ground...
FLAT = 0.2813
# ...and the toe-down pitch the foot leaves the ground at, pivoting on the toe.
PUSH_PITCH = 40.25
# (phase, ahead, height, pitch): the trailing leg at its farthest back, swung up nearly straight,
TRAIL = (0.47, -0.8212, 0.6025, 117)
# the heel at its highest, folded up under the hips,
TUCK = (0.6425, -0.295, 0.6774, 116.375)
# the foot dropping fast out of the tuck (any number of keys, phase order),
DROP = ((0.6975, 0.0425, 0.33, 65.625),)
# and the foot reaching, held off the floor before it drops.
REACH = (0.89, 0.4438, 0.1525, -20.75)
# Share of the ground speed the foot is already moving back at as it lands.
LAND_MATCH = 0.0
# Thigh joints' height over the flat ankle: highest as a foot reaches, lowest late in the stance.
HIP_TOP = (0.795, 1.0175)
HIP_DIP = (0.1575, 0.9253)
# Radians the hips turn each way, the reaching leg's side forward, at the reach.
HIP_YAW = math.radians(10)
# Pelvis roll, degrees, left hip up positive: (once per stride, its phase, three times per
# stride, its phase). Odd waves only, so each step mirrors the other: PoE2's hips drop on the
# landing side and wiggle back once inside each step.
ROLL = (4.875, 0.4162, 2.025, 0.0363)
# Trunk lean forward, degrees, neck over pelvis: (mean, each way twice per stride, its phase).
LEAN = (22.4125, 1.475, 0.2362)
# Pelvis ahead of where a steady glide puts it, in legs: (mean, each way twice per stride, its
# phase). PoE2's hips surge as each foot pushes off and sit back over the landing.
SURGE = (0.015, -0.1, 0.0376)
# Extra chest turn about the vertical, degrees, left shoulder back positive: (once per stride, its phase).
TWIST = (10, -0.1187)
# Upper chest bent forward over the spine, degrees: (each way twice per stride, its phase, each way
# once per stride, its phase). PoE2's trunk flexes with every step; the head keeps its pitch.
SPINE_BEND = (6, 0.0412, 2.375, -0.255)
# The head's turn off the run's line, degrees, toward the left positive: (once per stride, the
# phase it looks furthest left). PoE2's head goes with the shoulders about half way; locked
# straight ahead while the shoulders swing, it reads as a head looking left and right.
HEAD_YAW = (12.975, 0.81)
# Extra head pitch, degrees, chin up positive: (each way twice per stride, its phase).
HEAD_NOD = (-7.0625, 0.05)
# Share of the arms' swing off their mean pose kept.
ARM_KEEP = 0.55
ARM_PARTS = ("clavicle", "upperarm", "lowerarm", "hand")
# Share of the trunk's twist kept: the jog turns the shoulders through 80 degrees on still
# hips. Neck and head go with it, so the face still looks where it did.
SPINE_KEEP = 0.5638
SPINE_PARTS = ("spine_01", "spine_02", "spine_03", "neck_01", "Head")
# Knee pole: forward, and this share outward (negative: in). PoE2's knee stays on the hip-ankle
# line or just inside it through the fold; one bowed out reads as a waddle.
KNEE_OUT = -0.0125
# Feet planted toward the midline, in legs inside the jog's track, as (mean, each way): fullest
# at mid-stance, back out at the tuck. PoE2 runs on a narrow track, each foot landing ~0.12 of
# a leg inside its own hip.
TRACK_IN = (0.0725, 0.0738)
# Each wrist off the chest, in legs, over its swing: ahead of the chest (mean, each way), out to
# its side (mean, and in toward the midline at the front), and above the hips (mean at the ends,
# higher in front, and the drop as it passes the hip, a pendulum's arc). Low, close in, elbows
# bent the whole way, pumping against the opposite leg: PoE2's free-arm run, against the jog's
# arms held high and flared out with the elbows locked.
# Per arm, left then right: the right carries the weapon, held lower, wider and straighter.
ARM_SWING = ((0.0825, 0.2625), (0.055, 0.245))
ARM_OUT = ((0.245, 0.1225), (0.3075, 0.0525))
ARM_HEIGHT = ((0.2575, 0.045, 0.1125), (0.1275, -0.02, 0.0675))
# Per arm: share of a cycle the swing lags its leg, and the swing's lopsided parts in legs: the
# wrist higher on the way forward (once per stride) and at the quarter points (twice), and further
# out on the way forward.
ARM_PHASE = (0.005, 0.01)
ARM_LIFT = ((0.0425, 0.015), (0.015, 0.0075))
ARM_OUT_Q = (0.0125, 0.035)
# Per arm: the forward swing's own lead over the rest of the arm's path (share of a cycle) and its
# twice-per-stride part in legs (size, phase): PoE2's wrist punches forward fast and drifts back.
ARM_FWD = ((0, -0.06, 0.15), (0, -0.03, 0.2))
# Elbow pole: behind the arm, and this share outward.
ELBOW_OUT = 0.55
ARMS = (("upperarm_l", "lowerarm_l", "hand_l"), ("upperarm_r", "lowerarm_r", "hand_r"))
# The bow held through the run (`rig.ts` lays it over the run while a bow is worn): PoE2's bow run
# keeps both arms near still, the bow arm forward and low and nearly straight, the draw hand bent
# up by the chest. Per arm (ahead of the chest, out to its side, above the hips) in legs, and the
# elbow pole as (behind, out, down). One pose, the mean over the cycle; the bow fist stays
# `Rig|Bow_Carry`'s, so only the arm bones are keyed.
BOW_RUN = "Rig|Bow_RunCarry"
BOW_HOLD = (((0.4, -0.1, 0.18), (0.35, 0.85, -0.3)), ((0.215, 0.2475, 0.2825), (0.175, -0.375, -1.3)))
# Degrees the upper chest turns about the vertical under the bow, bow shoulder forward. `rig.ts`
# lays this chest on at `BOW_RUN_CHEST_HOLD` only, so the run's shoulder swing still shows in part:
# PoE2's bow run twists less than its free run, about a mean turned toward the bow.
BOW_TWIST = -17.0
BOW_KEYED = ("spine_03", "upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r")


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
        pts = [k0, TRAIL, TUCK, *DROP, REACH, keys[-1]]
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

    # Roll and lean are measured as the curves are (thigh joints across, neck over pelvis) and
    # turned onto their traits; which way each turn goes is read off the rig, not assumed.
    left_dir = lateral[0].normalized()
    across = up.cross(forward).normalized()

    def roll_of(h):
        return math.degrees(math.atan2(h.dot(up), h.dot(left_dir)))

    def lean_of(t):
        return math.degrees(math.atan2(t.dot(forward), t.dot(up)))

    probe = bones[LEGS[0][0]].head - bones[LEGS[1][0]].head
    roll_sign = 1.0 if roll_of(Matrix.Rotation(0.1, 3, forward) @ probe) > roll_of(probe) else -1.0
    probe = bones["neck_01"].head - bones["spine_02"].head
    lean_sign = 1.0 if lean_of(Matrix.Rotation(0.1, 3, across) @ probe) > lean_of(probe) else -1.0

    def roll_at(u):
        a1, p1, a3, p3 = ROLL
        return a1 * math.sin(2 * math.pi * (u - p1)) + a3 * math.sin(6 * math.pi * (u - p3))

    def lean_at(u):
        mean, each, ph = LEAN
        return mean + each * math.cos(4 * math.pi * (u - ph))

    gaze_left = up.cross(gaze).normalized()
    if gaze_left.dot(left_dir) < 0:
        gaze_left = -gaze_left

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
        surge = SURGE[0] + SURGE[1] * math.cos(4 * math.pi * (u - SURGE[2]))
        slide = pelvis_mean - horizontal(pelvis.head, up) + forward * (surge * leg_length)
        reach_l = math.cos(2 * math.pi * (u - REACH[0]))  # 1 while the left foot reaches
        yaw = yaw_sign * HIP_YAW * reach_l
        pelvis.matrix = Matrix.Translation(up * lift + slide) @ about(pelvis.head.copy(), Matrix.Rotation(yaw, 3, up)) @ pelvis.matrix
        bpy.context.view_layer.update()
        # The pelvis rolls alone: the spine turns back by as much, so the chest keeps its line.
        # spine_02, never spine_01: the jog keys no spine_01, and `splice` drops a channel it does not key.
        now = roll_of(bones[LEGS[0][0]].head - bones[LEGS[1][0]].head)
        turn = Matrix.Rotation(roll_sign * math.radians(roll_at(u) - now), 3, forward)
        pelvis.matrix = about(pelvis.head.copy(), turn) @ pelvis.matrix
        bpy.context.view_layer.update()
        spine = bones["spine_02"]
        spine.matrix = about(spine.head.copy(), turn.transposed()) @ spine.matrix
        bpy.context.view_layer.update()
        b2, p2, b1, p1 = SPINE_BEND
        bend = Matrix.Rotation(lean_sign * math.radians(b2 * math.cos(4 * math.pi * (u - p2)) + b1 * math.cos(2 * math.pi * (u - p1))), 3, across)
        bones["spine_03"].matrix = about(bones["spine_03"].head.copy(), bend) @ bones["spine_03"].matrix
        bpy.context.view_layer.update()
        bones["Head"].matrix = about(bones["Head"].head.copy(), bend.transposed()) @ bones["Head"].matrix
        bpy.context.view_layer.update()
        for _ in range(3):  # the spine turns about its own root, not the pelvis the lean is read from
            now = lean_of(bones["neck_01"].head - pelvis.head)
            spine.matrix = about(spine.head.copy(), Matrix.Rotation(lean_sign * math.radians(lean_at(u) - now), 3, across)) @ spine.matrix
            bpy.context.view_layer.update()
        chest_bone = bones["spine_03"]
        chest_bone.matrix = about(chest_bone.head.copy(), Matrix.Rotation(
            math.radians(TWIST[0] * math.cos(2 * math.pi * (u - TWIST[1]))), 3, up)) @ chest_bone.matrix
        bpy.context.view_layer.update()
        head = bones["Head"]
        now = horizontal(head.matrix.to_3x3().col[2], up).normalized()
        a = math.radians(HEAD_YAW[0] * math.cos(2 * math.pi * (u - HEAD_YAW[1])))
        look = gaze * math.cos(a) + gaze_left * math.sin(a)
        head.matrix = about(head.head.copy(), now.rotation_difference(look).to_matrix()) @ head.matrix
        bpy.context.view_layer.update()
        nod = math.radians(HEAD_NOD[0] * math.cos(4 * math.pi * (u - HEAD_NOD[1])))
        head.matrix = about(head.head.copy(), Matrix.Rotation(-nod * lean_sign, 3, across)) @ head.matrix
        bpy.context.view_layer.update()

        # Each wrist on its own path off the chest, swinging against the leg on its side.
        chest = bones["spine_03"].head.copy()
        hips_up = bones["pelvis"].head.dot(up)
        for i, names in enumerate(ARMS):
            arc = 2 * math.pi * (u - REACH[0] - 0.5 * (1 - i) - ARM_PHASE[i])
            c, s = math.cos(arc), math.sin(arc)  # c is 1 with this wrist farthest forward
            outward = lateral[i].normalized()
            swing, out, rise, lift = ARM_SWING[i], ARM_OUT[i], ARM_HEIGHT[i], ARM_LIFT[i]
            fwd_arc = arc + 2 * math.pi * ARM_FWD[i][0]
            ahead = swing[0] + swing[1] * math.cos(fwd_arc) + ARM_FWD[i][1] * math.cos(2 * fwd_arc - 2 * math.pi * ARM_FWD[i][2])
            target = (horizontal(chest, up) + forward * (ahead * leg_length)
                      + outward * ((out[0] - out[1] * c + ARM_OUT_Q[i] * s) * leg_length)
                      + up * (hips_up + (rise[0] + rise[1] * c - rise[2] * (1 - c * c)
                                         + lift[0] * s + lift[1] * math.sin(2 * arc)) * leg_length))
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
        upper = bones["spine_03"]
        upper.matrix = about(upper.head.copy(), Matrix.Rotation(math.radians(BOW_TWIST), 3, up)) @ upper.matrix
        bpy.context.view_layer.update()
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
