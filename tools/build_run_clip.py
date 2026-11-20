"""Add `Rig|Run_Fwd_Loop` to `anim-library.glb`: our own run, built to PoE2's gait traits.

The trunk starts from the UAL jog's, its twist damped. Arms and legs are authored here: each
ankle follows a path made from a handful of gait traits, each wrist one made from harmonic
shoulder, elbow and wrist curves (FREE_ARMS), and two-bone IK puts thigh and calf, or upper
arm and forearm, on it. PoE2's run (every weapon set shares one set of legs) was MEASURED for those traits as
reference numbers only: the trait values below were searched until our curves (knee, ankle,
hips, roll, lean, wrists) came closest to its measured ones (`fit_run.py`, `score_run.py` in
the handoff evidence); no PoE2 key or sampled trajectory is read or copied here. The bow
ready pose inherits the lower-spine and clavicle motion when layered over the run. Its look:

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
from mathutils import Euler, Matrix, Quaternion, Vector

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
DUTY = 0.252
# Ankle ahead of the hips as the foot lands, and its pitch (degrees, toe down positive).
LAND_AHEAD = 0.23559
LAND_PITCH = -12.66
HEEL_BACK = 0.07
# End of the flat phase, then a late heel rise onto the ball.
FLAT_END = 0.075
PUSH_POWER = 3.145
PUSH_PITCH = 52.02
PUSH_RATE = PUSH_PITCH * PUSH_POWER / (DUTY - FLAT_END)
# Rearward and upward travel from toe-off, and the pitch and rate as the toes release.
RELEASE = (0.3275, 0.34363, 0.26512, 82.94, 66.6)
TOE_RELEASE = 0.13
# (phase, ahead, height, pitch): the trailing leg at its farthest back, swung up nearly straight,
TRAIL = (0.5134, -0.74121, 0.69455, 123.02)
# the heel at its highest, folded up under the hips,
TUCK = (0.674, -0.22306, 0.66126, 114.28)
# the foot dropping fast out of the tuck (any number of keys, phase order),
DROP = (0.7123, -0.06656, 0.2821, 62.0)
DROP_PITCH_RATE = -705.0
# and the foot reaching, held off the floor before it drops.
REACH = (0.89, 0.41178, 0.14775, -18.5)
# Share of the ground speed the foot is already moving back at as it lands.
LAND_MATCH = 0.2091
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
# The mean sits ~3 deg under the fit: the wardrobe's spine reads that much more lean in game.
LEAN = (19.45, 1.475, 0.2362)
# Pelvis ahead of where a steady glide puts it, in legs: (mean, each way twice per stride, its
# phase). PoE2's hips surge as each foot pushes off and sit back over the landing.
SURGE = (0.015, -0.1, 0.0376)
# Forward and vertical pelvis travel through loading and push-off, in leg lengths.
HIP_LOAD = ((-0.03245, -0.01555), (0.06605, 0.02282), (0.02407, -0.00047), (-0.00154, -0.01064), (-0.02086, -0.00159))
# Extra chest turn about the vertical, degrees, left shoulder back positive: (once per stride, its phase).
TWIST = (10, -0.1187)
# Shoulder-line bank over the stride, in degrees.
CHEST_BANK = (0, 12.66, -14.99)
# Upper chest bent forward over the spine, degrees: (each way twice per stride, its phase, each way
# once per stride, its phase). PoE2's trunk flexes with every step; the head keeps its pitch.
SPINE_BEND = (6, 0.0412, 2.375, -0.255)
# The head's turn off the run's line, degrees, toward the left positive: (once per stride, the
# phase it looks furthest left). PoE2's head goes with the shoulders about half way; locked
# straight ahead while the shoulders swing, it reads as a head looking left and right.
HEAD_YAW = (12.975, 0.81)
# Extra head pitch, degrees, chin up positive: (each way twice per stride, its phase).
HEAD_NOD = (-7.0625, 0.05)
# Share of the jog's arm swing off its mean pose kept; it survives on clavicles and hands only,
# because FREE_ARMS re-solves upper arm and forearm every frame.
ARM_KEEP = 0.55
ARM_PARTS = ("clavicle", "upperarm", "lowerarm", "hand")
# Share of the trunk's twist kept: the jog turns the shoulders through 80 degrees on still
# hips. Neck and head go with it, so the face still looks where it did.
SPINE_KEEP = 0.5638
SPINE_PARTS = ("spine_01", "spine_02", "spine_03", "neck_01", "Head")
# Knee bend sideways relative to the sagittal bend. Negative tips inward.
KNEE_OUT = -0.0421
LEG_SOFT_REACH = 0.012
# Inward shift while planted and outward excursion in swing, in leg lengths.
TRACK_IN = (0.1245, 0.164)
# Shoulder swing, flare, elbow bend (degrees), and wrist height (arm lengths).
# Each curve is a centre plus cosine/sine pairs at successive stride harmonics.
FREE_ARMS = (
    ((-27.66, -18.80, 18.11, -3.91, 0), (25.14, -7.63, -2.95, 1.71, 0.91),
     (99.43, 27.72, -7.65, -6.78, 9.94, 0.36, 5.85), (-0.68665, -0.158, 0.063, 0.038, -0.091, 0.017, -0.032)),
    ((-28.47, 10.49, -9.49, -3.76, -0.04), (21.11, 8.22, 1.92, 1.64, 0.30),
     (115.18, -14.56, 4.26, -3.13, 4.42, -0.09, -2.58), (-0.8061, 0.060, -0.015, 0.016, -0.033, -0.007, 0.013)),
)
ARMS = (("upperarm_l", "lowerarm_l", "hand_l"), ("upperarm_r", "lowerarm_r", "hand_r"))
BOW_RUN = "Rig|Bow_RunCarry"
# Bank and yaw of the lower spine, and axial roll of each clavicle, in degrees over the stride.
BOW_BRACE = ((0, 5.13, 3.06, -4.28, -0.09), (0, 11.50, -0.21, 1.50, -0.49))
BOW_CLAVICLE_ROLL = ((0, 2.00, -1.30, 7.49, 0.37), (0, -1.90, 4.94, -5.64, -0.89))
# Local XYZ angles for the ready pose. The bow fist remains in Rig|Bow_Carry.
BOW_READY = {
    "spine_03": (15.13, -30.89, -12.39),
    "upperarm_l": (50.50, -20.72, -104.32),
    "lowerarm_l": (141.21, 12.36, 171.63),
    "upperarm_r": (106.64, 64.60, -173.16),
    "lowerarm_r": (-60.31, -32.02, 151.11),
}


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


def stride_wave(curve, phase):
    centre, *pairs = curve
    angle = math.tau * phase
    return centre + sum(c * math.cos(i * angle) + s * math.sin(i * angle)
                        for i, (c, s) in enumerate(zip(pairs[::2], pairs[1::2]), 1))


def arm_path(arm, curves, phase, forward, outward, up):
    """Wrist target and elbow pole in rig space, relative to the moving shoulder."""
    shoulder, elbow, wrist = (b.head for b in arm)
    upper_len, lower_len = (elbow - shoulder).length, (wrist - elbow).length
    swing, flare, elbow_angle, height = (stride_wave(curve, phase) for curve in curves)
    upper = (forward * math.tan(math.radians(swing)) + outward * math.tan(math.radians(flare)) - up).normalized()
    bend = math.radians(180 - elbow_angle)
    length_along = upper_len + lower_len * math.cos(bend)
    radius = lower_len * math.sin(bend)
    rise = up - upper * up.dot(upper)
    lift = (height * (upper_len + lower_len) - length_along * up.dot(upper)) / (radius * rise.length)
    lift = max(-0.999, min(0.999, lift))
    across = upper.cross(rise).normalized()
    if across.dot(forward) < 0:
        across = -across
    wrist = shoulder + upper * length_along + radius * (rise.normalized() * lift + across * math.sqrt(1 - lift * lift))
    return wrist, upper


def stance_pitch(u):
    if u < 0.04:
        return LAND_PITCH * (1 - u / 0.04)
    rise = max(0.0, (u - FLAT_END) / (DUTY - FLAT_END))
    return PUSH_PITCH * rise ** PUSH_POWER


def foot_path(forward, up, side, heel, ball, stance_speed):
    """Ankle and pitch in leg lengths, with common stance and swing tangents at toe-off."""
    def stance(u):
        pitch = stance_pitch(u)
        pivot = heel if pitch < 0 else ball
        offset = pivot - Matrix.Rotation(math.radians(pitch), 3, side) @ pivot
        return LAND_AHEAD - stance_speed * u + offset.dot(forward), offset.dot(up), pitch

    phase, back, lift, pitch, rate = RELEASE
    off_ahead, off_height, off_pitch = stance(DUTY)
    keys = [(DUTY, off_ahead, off_height, off_pitch), (phase, off_ahead - back, off_height + lift, pitch),
            TRAIL, TUCK, DROP, REACH, (1.0, *stance(0.0))]
    off_ball = Matrix.Rotation(math.radians(off_pitch), 3, side) @ ball
    velocity = -forward * stance_speed - side.cross(off_ball) * math.radians(PUSH_RATE)
    tangents = [(velocity.dot(forward), velocity.dot(up), PUSH_RATE)]
    pitch_rates = {phase: rate, DROP[0]: DROP_PITCH_RATE}
    for previous, key, following in zip(keys, keys[1:], keys[2:]):
        dx, dz, dp = ((b - a) / (following[0] - previous[0]) for a, b in zip(previous[1:], following[1:]))
        tangents.append((dx, dz, pitch_rates.get(key[0], dp)))
    tangents.append((-stance_speed * LAND_MATCH, 0.0, (LAND_PITCH - REACH[3]) / (1.0 - REACH[0])))

    def sample_path(u):
        if u <= DUTY:
            return stance(u)
        j = next(j for j in range(len(keys) - 1) if u <= keys[j + 1][0])
        a, b = keys[j:j + 2]
        span = b[0] - a[0]
        return hermite(a[1:], b[1:], [x * span for x in tangents[j]], [x * span for x in tangents[j + 1]], (u - a[0]) / span)

    return sample_path


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
    base, flat_rot, flat_ball, ball_offset, toe_offset, lateral = [], [], [], [], [], []
    ankle_flat = None
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
        ball_offset.append((foot.children[0].head - foot.head) / leg_length)
        toe_offset.append((bones[leg[3]].head - foot.children[0].head) / leg_length)
        if i == 0:
            ankle_flat = foot.head.dot(up)
        offs = [horizontal(legs[i][1], up) - origin for _p, legs, _t in frames[:jog_cycle]]
        mean = sum(offs, Vector()) / jog_cycle
        lateral.append(mean - forward * mean.dot(forward))

    # Which way round `side` puts the toe down, off the rig rather than assumed.
    if (Matrix.Rotation(0.1, 3, side) @ ball_offset[0]).dot(up) > ball_offset[0].dot(up):
        side = -side
    heel_offset = [-forward * HEEL_BACK + up * ball.dot(up) for ball in ball_offset]
    floor = ankle_flat + ball_offset[0].dot(up) * leg_length
    stance_speed = SPEED * (CYCLE / FPS) / WARDROBE_LEG
    paths = [foot_path(forward, up, side, heel, ball, stance_speed) for heel, ball in zip(heel_offset, ball_offset)]

    def foot_pose(u, i):
        ahead, height, pitch = paths[i](u)
        swing = max(0, (u - DUTY) / (1 - DUTY))
        inward = TRACK_IN[0] - TRACK_IN[1] * math.sin(math.pi * swing) ** 2
        release = max(0, min(1, 1 - (u - DUTY) / TOE_RELEASE))
        curl = max(0, pitch) * release ** 2 * (3 - 2 * release)
        rot = Matrix.Rotation(math.radians(pitch), 3, side)
        ball_turn = Matrix.Rotation(math.radians(-curl), 3, side)
        ball = rot @ ball_offset[i]
        toe = ball + rot @ ball_turn @ toe_offset[i]
        heel = rot @ heel_offset[i]
        sole = min(p.dot(up) for p in (ball, toe, heel)) * leg_length
        z = max(ankle_flat + height * leg_length, floor - sole + leg_length * 1e-4)
        where = origin + lateral[i] + (forward * ahead - lateral[i].normalized() * inward) * leg_length + up * z
        return where, rot, ball_turn, heel * leg_length

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

    def solve(top, mid, end, target, pole, softness=SOFT_REACH):
        """Two-bone IK off the chain's current pose: `end` onto `target`, the joint toward `pole`."""
        root, joint, tip = top.head.copy(), mid.head.copy(), end.head.copy()
        upper, lower = (joint - root).length, (tip - joint).length
        reach = target - root
        full = upper + lower
        ease = full * softness
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

    posed, knee_gaps, knees = [], [], []
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
        beat = 4 * math.pi * u
        wave = (1, math.cos(beat), math.sin(beat), math.cos(2 * beat), math.sin(2 * beat))
        surge += sum(w * x for w, (x, _z) in zip(wave, HIP_LOAD))
        lift += sum(w * z for w, (_x, z) in zip(wave, HIP_LOAD)) * leg_length
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
        shoulders = bones["upperarm_l"].head - bones["upperarm_r"].head
        bank = math.radians(stride_wave(CHEST_BANK, u))
        banked = horizontal(shoulders, up) + up * (shoulders.dot(left_dir) * math.tan(bank))
        chest_bone.matrix = about(chest_bone.head.copy(), turn_onto(shoulders, banked)) @ chest_bone.matrix
        bpy.context.view_layer.update()
        # The ready pose inherits this brace. The free pose keeps its chest orientation.
        free_chest = chest_bone.matrix.copy()
        brace_bank, brace_yaw = (math.radians(stride_wave(curve, u)) for curve in BOW_BRACE)
        brace = Matrix.Rotation(brace_yaw, 3, up) @ Matrix.Rotation(brace_bank, 3, forward)
        spine.matrix = about(spine.head.copy(), brace) @ spine.matrix
        bpy.context.view_layer.update()
        free_chest.translation = chest_bone.head
        chest_bone.matrix = free_chest
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

        # The wrist arc follows the moving shoulder while the elbow swings in its own plane.
        for names, curves, offset, roll in zip(ARMS, FREE_ARMS, lateral, BOW_CLAVICLE_ROLL):
            chain = [bones[n] for n in names]
            clavicle = chain[0].parent
            axis = (chain[0].head - clavicle.head).normalized()
            turn = Matrix.Rotation(math.radians(stride_wave(roll, u)), 3, axis)
            clavicle.matrix = about(clavicle.head.copy(), turn) @ clavicle.matrix
            bpy.context.view_layer.update()
            target, pole = arm_path(chain, curves, u, forward, offset.normalized(), up)
            solve(*chain, target, pole)

        for i, leg in enumerate(LEGS):
            target, rot, ball_turn, heel = foot_pose((u + 0.5 * i) % 1.0, i)
            thigh, calf, foot = (bones[n] for n in leg[:3])
            for n in leg[:3]:
                bones[n].rotation_quaternion = base[i][n]
            bpy.context.view_layer.update()
            aim = (target - thigh.head).normalized()
            outward = lateral[i].normalized()
            sagittal = (up * aim.dot(forward) - forward * aim.dot(up)).normalized()
            across_leg = (outward - aim * aim.dot(outward)).normalized()
            solve(thigh, calf, foot, target, sagittal + across_leg * KNEE_OUT, LEG_SOFT_REACH)
            foot.matrix = Matrix.Translation(foot.head.copy()) @ (rot @ flat_rot[i]).to_4x4()
            ball = foot.children[0]
            ball.rotation_quaternion = flat_ball[i]
            bpy.context.view_layer.update()
            ball.matrix = about(ball.head.copy(), ball_turn) @ ball.matrix
            bpy.context.view_layer.update()
            lowest = min(p.dot(up) for p in (ball.head, bones[leg[3]].head, foot.head + heel))
            assert lowest >= floor - leg_length * 1e-5, f"frame {k} leg {i}: sole {(lowest - floor) / leg_length:.6f} legs below floor"
            knees.append(math.degrees((calf.head - thigh.head).angle(foot.head - calf.head)))
        knee_gaps.append(horizontal(bones[LEGS[0][1]].head - bones[LEGS[1][1]].head, up).length)
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
    for n, angles in BOW_READY.items():
        bones[n].rotation_quaternion = Euler(tuple(map(math.radians, angles)), "XYZ").to_quaternion()
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
    splice({NAME: SOURCE, BOW_RUN: SOURCE}, SCRATCH, only={BOW_RUN: set(BOW_READY)})
    print(f"{os.path.getsize(ANIMS) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
    sys.exit(0)
