"""Compare scalar gait measurements and draw every authored frame. Reference only.

Blender: --python tools/measure_run_frames.py -- dump <out.json> [master.glb]
Python: tools/measure_run_frames.py report <dump.json> <output-prefix>
RUN_EVIDENCE selects the host-local reference measurement directory.
"""
import csv
import html
import json
import math
import os
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = Path(os.environ.get("RUN_EVIDENCE", r"C:\Users\bruno.miglar\.claude\handoff-evidence\it-baer-exiled-casual\poe2-run"))
sys.dont_write_bytecode = True
sys.path.insert(0, str(EVIDENCE))
import compare_run as cr

LATERAL_METRICS = ("ankle L out of hip (leg)", "knee L out of leg line (leg)")


def dump(dest, glb=None):
    import bpy
    from mathutils import Vector
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(glb or ROOT / "assets/characters/anim-library.glb"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    low = {b.name.lower(): b.name for b in arm.pose.bones}
    names = {v[1]: low[v[1].lower()] for k, v in cr.MAP.items() if k != "face"}
    names.update({n: low[n] for n in ("foot_end_l", "foot_end_r")})
    up = (arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1))).normalized()
    fw = arm.data.bones[low["foot_end_l"]].head_local - arm.data.bones[low["foot_l"]].head_local
    fw = (fw - up * fw.dot(up)).normalized()
    face_axis = arm.data.bones[low["head"]].matrix_local.to_3x3().inverted() @ fw
    rig = (ROOT / "apps/web/src/render/rig.ts").read_text()
    import re
    holds = {k: float(re.search(rf"const BOW_RUN_{k}_HOLD = ([\d.]+)", rig)[1]) for k in ("ARM", "CHEST")}
    arm.animation_data.action = bpy.data.actions["Rig|Bow_RunCarry"]
    bpy.context.scene.frame_set(int(arm.animation_data.action.frame_range[0]))
    keyed = ("spine_03", "upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r")
    overlay = {n: arm.pose.bones[n].rotation_quaternion.copy() for n in keyed}
    arm.animation_data.action = bpy.data.actions["Rig|Run_Fwd_Loop"]
    s, e = (int(round(v)) for v in arm.animation_data.action.frame_range)
    out = {k: {"fps": 30, "frames": []} for k in ("Rig|Run_Fwd_Loop", "Run+Bow_RunCarry")}
    def joints():
        bpy.context.view_layer.update()
        fr = {n: list(arm.matrix_world @ arm.pose.bones[actual].head) for n, actual in names.items()}
        head = arm.pose.bones[low["head"]]
        fr["face"] = list(arm.matrix_world @ (head.head + head.matrix.to_3x3() @ face_axis * 10))
        return fr
    for f in range(s, e + 1):
        bpy.context.scene.frame_set(f)
        out["Rig|Run_Fwd_Loop"]["frames"].append(joints())
        saved = {n: arm.pose.bones[n].rotation_quaternion.copy() for n in keyed}
        arm.animation_data.action = None
        for n in keyed:
            arm.pose.bones[n].rotation_quaternion = saved[n].slerp(overlay[n], holds["CHEST" if n.startswith("spine") else "ARM"])
        out["Run+Bow_RunCarry"]["frames"].append(joints())
        for n, q in saved.items():
            arm.pose.bones[n].rotation_quaternion = q
        arm.animation_data.action = bpy.data.actions["Rig|Run_Fwd_Loop"]
    out["metadata"] = {"glb": str(glb), "bow_weights": holds, "space": "animation rig, offline runtime-weight composition"}
    Path(dest).write_text(json.dumps(out))
    print("DUMP", dest, "frames", e - s, "bow_weights", holds)


def metrics(C, ix):
    def p(n):
        return C[:, ix[n]]
    def angle(a, b, c):
        u, v = p(a) - p(b), p(c) - p(b)
        return np.degrees(np.arccos(np.clip(np.sum(u * v, 1) / np.linalg.norm(u, axis=1) / np.linalg.norm(v, axis=1), -1, 1)))
    def atan(y, x):
        return np.degrees(np.arctan2(y, x))
    out = {}
    for side in "LR":
        out[f"knee {side}"] = angle(f"thigh{side}", f"knee{side}", f"ankle{side}")
        foot = p(f"toe{side}") - p(f"ankle{side}")
        pitch = np.unwrap(np.arctan2(-foot[:, 2], foot[:, 0])) * 180 / np.pi
        flat = int(np.argmin(p(f"ankle{side}")[:, 2]))
        out[f"foot pitch {side}"] = (pitch - pitch[flat] + 180) % 360 - 180
        ankle = angle(f"knee{side}", f"ankle{side}", f"toe{side}")
        out[f"ankle flex {side}"] = ankle - ankle[flat]
        thigh = p(f"knee{side}") - p(f"thigh{side}")
        out[f"hip flex {side}"] = atan(thigh[:, 0], -thigh[:, 2])
        out[f"elbow {side}"] = angle(f"shoulder{side}", f"elbow{side}", f"wrist{side}")
        upper = p(f"elbow{side}") - p(f"shoulder{side}")
        out[f"shoulder flex {side}"] = atan(upper[:, 0], -upper[:, 2])
        out[f"shoulder out {side}"] = atan(upper[:, 1] * (1 if side == "L" else -1), -upper[:, 2])
        arm = np.linalg.norm(upper, axis=1) + np.linalg.norm(p(f"wrist{side}") - p(f"elbow{side}"), axis=1)
        out[f"wrist height {side} (arm)"] = (p(f"wrist{side}")[:, 2] - p(f"shoulder{side}")[:, 2]) / arm
    for name, a, b in (("pelvis", "thighL", "thighR"), ("chest", "shoulderL", "shoulderR")):
        across = p(a) - p(b)
        out[name + " yaw"] = atan(-across[:, 0], across[:, 1])
        out[name + " roll"] = atan(across[:, 2], across[:, 1])
    out["pelvis height (leg)"] = p("pelvis")[:, 2]
    hip, knee, ankle = (p(joint)[:, 1] for joint in ("thighL", "kneeL", "ankleL"))
    out[LATERAL_METRICS[0]] = ankle - hip
    out[LATERAL_METRICS[1]] = knee - (hip + ankle) / 2
    return out


def curve_summary(ours, reference, sample_count):
    def sample(values):
        return np.interp(np.arange(sample_count) / sample_count, np.arange(len(values) + 1) / len(values), np.r_[values, values[0]])
    a, b = sample(ours), sample(reference)
    error = a - b
    return {"ours_mean": float(a.mean()), "reference_mean": float(b.mean()),
            "ours_range": [float(a.min()), float(a.max())], "reference_range": [float(b.min()), float(b.max())],
            "bias": float(error.mean()), "rms": float(np.sqrt(np.mean(error ** 2)))}


def contacts(C, ix):
    out = {}
    for side in "LR":
        h = C[:, ix[f"toe{side}"], 2]
        # Joint-height proxy only: contact geometry and shoes differ between rigs.
        ground = h <= h.min() + 0.025
        out[side] = {"proxy_ground_frames": np.flatnonzero(ground).tolist(),
                     "proxy_touchdown": np.flatnonzero(ground & ~np.roll(ground, 1)).tolist(),
                     "proxy_toe_off": np.flatnonzero(~ground & np.roll(ground, 1)).tolist()}
    return out


def sheet(path, ref, ours, ix, rows, title):
    w, rowh, top = 1780, 268, 95
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{top+len(rows)*rowh}"><rect width="100%" height="100%" fill="#14161a"/>']
    def text(x, y, s, color="#ddd", size=14):
        svg.append(f'<text x="{x}" y="{y}" fill="{color}" font-family="monospace" font-size="{size}">{html.escape(s)}</text>')
    text(20, 26, title, size=19)
    text(20, 51, "Reference orange | ours cyan | equal leg scale | brighter left limbs | errors ours minus reference")
    text(20, 73, "Hip/shoulder: sagittal segment angle. Yaw/roll: hip/shoulder joint line. Wrists: arm lengths below shoulder.")
    for k, row in enumerate(rows):
        y0 = top + k * rowh
        svg.append(f'<path d="M0 {y0}H{w}" stroke="#444"/>')
        text(14, y0 + 20, f'Frame {row["frame"]:02d} phase {row["phase"]:.3f}')
        for v, axes in enumerate(((0, 2), (1, 2))):
            for which, (J, col) in enumerate(((ref[k], "#ff9a3c"), (ours[k], "#3cc8ff"))):
                cx = 125 + v * 385 + which * 185
                text(cx - 70, y0 + 43, ("side" if v == 0 else "front") + (" ref" if which == 0 else " ours"), col)
                def project(n):
                    p = J[ix[n]]
                    return cx + p[axes[0]] * 88 * (1 if v == 0 else -1), y0 + 244 - p[axes[1]] * 88
                for a, b in cr.BONES:
                    x1, y1 = project(a); x2, y2 = project(b)
                    opacity = 0.4 if a.endswith("R") or b.endswith("R") else 1
                    svg.append(f'<path d="M{x1:.2f} {y1:.2f}L{x2:.2f} {y2:.2f}" stroke="{col}" stroke-width="2.2" opacity="{opacity}"/>')
                x, y = project("head")
                svg.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="4" fill="{col}"/>')
        for j, (key, val) in enumerate(row["errors"].items()):
            col, line = divmod(j, 12)
            limit = 0.02 if "(leg)" in key else 0.03 if "(arm)" in key else 5
            precision = 3 if key.endswith(("(leg)", "(arm)")) else 2
            text(800 + col * 470, y0 + 27 + line * 19, f'{key:25s} {val:+7.{precision}f}', "#ff8888" if abs(val) > limit else "#b8d7c1")
    svg.append("</svg>")
    Path(path).write_text("".join(svg), encoding="utf-8")


def report(src, prefix):
    data = json.loads(Path(src).read_text())
    refs = ["basewand:run_wand_unarmed_01", "basesword:run_sword_unarmed_01", "basewand:run_wand_unarmed_02", "basesword:run_sword_unarmed_02"]
    import poe2_metrics as pm
    bow_names = [c["name"] for c in pm.info("basebow")["clips"] if c["name"].startswith("run_bow_")]
    print("BOW_REFERENCE_CLIPS", bow_names)
    summary = {}
    for label, name, spec in (("free", "Rig|Run_Fwd_Loop", refs[0]), ("bow", "Run+Bow_RunCarry", "basebow:run_bow_01")):
        fps, O, ix = cr.ours(data, name)
        r_fps, R, _ = cr.poe2(spec)
        n = len(O)
        # Recover authored frame indices, since canon aligns maximum forward reach.
        raw = np.array([f["foot_l"] for f in data[name]["frames"][:-1]])
        pelvis = np.array([f["pelvis"] for f in data[name]["frames"][:-1]])
        upaxis = int(np.argmax(np.ptp(np.array([data[name]["frames"][0]["head"], data[name]["frames"][0]["foot_l"]]), axis=0)))
        ahead_axis = next(a for a in range(3) if a != upaxis and np.ptp(raw[:, a] - pelvis[:, a]) == max(np.ptp(raw[:, b] - pelvis[:, b]) for b in range(3) if b != upaxis))
        # Forward points from ankle to toe during the lowest ankle frames.
        lows = np.argsort(raw[:, upaxis])[:max(1, n // 4)]
        sign = np.sign(np.mean([data[name]["frames"][i]["ball_l"][ahead_axis] - raw[i, ahead_axis] for i in lows]))
        offset = int(np.argmax((raw[:, ahead_axis] - pelvis[:, ahead_axis]) * sign))
        om, rm = metrics(O, ix), metrics(R, ix)
        sampled = {k: np.interp(np.arange(n) / n, np.arange(len(v) + 1) / len(v), np.r_[v, v[0]]) for k, v in rm.items()}
        rows = []
        rp, op = [], []
        for f in range(n):
            phase_index = (f - offset) % n
            errors = {k: float(om[k][phase_index] - sampled[k][phase_index]) for k in om}
            for k, value in errors.items():
                if not k.endswith(("(arm)", "(leg)")):
                    errors[k] = (value + 180) % 360 - 180
            rows.append({"frame": f, "phase": phase_index / n, "errors": errors})
            rp.append(cr.at(R, phase_index / n)); op.append(O[phase_index])
        stats = {k: {"max": float(max(abs(row["errors"][k]) for row in rows)), "mean": float(np.mean([abs(row["errors"][k]) for row in rows]))} for k in om}
        result = {"reference": spec, "phase": "maximum forward left ankle relative to pelvis", "authored_phase_offset": offset,
                  "reference_frames": len(R), "ours_frames": n, "reference_cycle_s": len(R) / r_fps, "ours_cycle_s": n / fps,
                  "reference_contacts": contacts(np.array(rp), ix), "ours_contacts": contacts(np.array(op), ix), "stats": stats, "rows": rows}
        height = "pelvis height (leg)"
        result["pelvis_height"] = curve_summary(om[height], rm[height], len(R))
        result["lateral"] = {}
        for key in LATERAL_METRICS:
            curve = curve_summary(om[key], rm[key], 40)
            result["lateral"][key] = {**curve, "score": curve["rms"] / 0.02}
        if label == "free":
            variation = {}
            for sp in refs[1:]:
                other = metrics(cr.poe2(sp)[1], ix)
                variation[sp] = {k: float(np.max(np.abs(np.interp(np.arange(len(rm[k])) / len(rm[k]), np.arange(len(v) + 1) / len(v), np.r_[v, v[0]]) - rm[k]))) for k, v in other.items()}
            result["reference_variation"] = variation
        summary[label] = result
        sheet(f"{prefix}-{label}.svg", rp, op, ix, rows, f"{label}: {spec} vs {name}")
        with open(f"{prefix}-{label}.csv", "w", newline="") as fp:
            writer = csv.DictWriter(fp, fieldnames=["frame", "phase", *om]); writer.writeheader()
            for row in rows:
                writer.writerow({"frame": row["frame"], "phase": row["phase"], **row["errors"]})
        print(label, json.dumps({"phase_offset": offset, "contacts": result["ours_contacts"], "stats": stats, "lateral": result["lateral"]}))
    Path(f"{prefix}-errors.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if args[0] == "dump":
        dump(*args[1:])
    else:
        report(*args[1:])
