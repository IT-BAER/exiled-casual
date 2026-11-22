import { Animation, AnimationGroup, Matrix, Quaternion, TransformNode, Vector3, type IAnimationKey, type Node, type Scene } from "@babylonjs/core";
import { HEEL_BACK, HEEL_DOWN } from "./movement-clips";

/**
 * A reference take as a joint dump holds it: world positions per frame for named joints (PoE2's
 * `*_jntBnd` names: up -Z, forward -Y, left +X, centimetres), the last frame repeating the first.
 */
export interface PoseClip {
  clip: string;
  fps: number;
  bones: readonly { name: string; parent: number }[];
  frames: readonly (readonly number[])[];
}

/** The joints a take is read and drawn by: the reference's name, and ours where one bone sits there. */
export const POSE_JOINTS: readonly { poe: string; ours?: string }[] = [
  { poe: "hip_jntBnd", ours: "pelvis" }, { poe: "spine_1_jntBnd", ours: "spine_01" }, { poe: "spine_2_jntBnd", ours: "spine_02" },
  { poe: "chest_jntBnd", ours: "spine_03" }, { poe: "neck_jntBnd", ours: "neck_01" }, { poe: "head_jntBnd", ours: "Head" },
  { poe: "face_jntBnd" },
  ...(["l", "r"] as const).flatMap((s) => {
    const S = s.toUpperCase();
    return [
      { poe: `${S}_clavicle_jntBnd`, ours: `clavicle_${s}` }, { poe: `${S}_shoulder_jntBnd`, ours: `upperarm_${s}` },
      { poe: `${S}_elbow_jntBnd`, ours: `lowerarm_${s}` }, { poe: `${S}_wrist_jntBnd`, ours: `hand_${s}` },
      { poe: `${S}_finger_2_jntBnd_1`, ours: `middle_01_${s}` }, { poe: `${S}_thumb_1_jntBnd_1`, ours: `thumb_01_${s}` },
      { poe: `${S}_thigh_jntBnd`, ours: `thigh_${s}` }, { poe: `${S}_knee_jntBnd`, ours: `calf_${s}` },
      { poe: `${S}_ankle_jntBnd`, ours: `foot_${s}` }, { poe: `${S}_foot_jntBnd`, ours: `ball_${s}` },
      { poe: `${S}_toe_jntBnd` },
    ];
  }),
];

type Pose = Record<string, Vector3>;
/** The character faces +Z in its pivot. */
const FORWARD = new Vector3(0, 0, 1);
/** The toe tip past the ball, as a share of ankle-to-ball, and how much flatter than ankle-to-ball it runs (PoE2 planted: 0.66, 28-35 deg). */
const TOE_SHARE = 0.66;
const TOE_LIFT = (30 * Math.PI) / 180;
/** The face point off the head: PoE2's 0.12 of a leg, raised 10 deg off square to the neck (its takes hold 1-17). */
const FACE_REACH = 0.12;
const FACE_LIFT = (10 * Math.PI) / 180;

/** One bone the take turns: the aim (its child joint) and a second axis that fixes its twist. */
interface Rule {
  bone: string;
  aim: (p: Pose) => Vector3;
  up: (p: Pose) => Vector3;
}

const mid = (a: Vector3, b: Vector3) => a.add(b).scaleInPlace(0.5);
const unit = (v: Vector3) => { const n = v.length(); return n > 1e-9 ? v.scale(1 / n) : v.clone(); };

function rules(): Rule[] {
  const left = (p: Pose) => unit(p.L_thigh_jntBnd!.subtract(p.R_thigh_jntBnd!));
  const shoulders = (p: Pose) => unit(p.L_shoulder_jntBnd!.subtract(p.R_shoulder_jntBnd!));
  // The clavicle roots ride the chest rigidly; the shoulders do not (the clavicles lift them).
  const collar = (p: Pose) => unit(p.L_clavicle_jntBnd!.subtract(p.R_clavicle_jntBnd!));
  const out: Rule[] = [
    { bone: "pelvis", aim: left, up: (p) => p.spine_1_jntBnd!.subtract(p.hip_jntBnd!) },
    { bone: "spine_01", aim: (p) => p.spine_2_jntBnd!.subtract(p.spine_1_jntBnd!), up: (p) => left(p).scale(2).add(collar(p)) },
    { bone: "spine_02", aim: (p) => p.chest_jntBnd!.subtract(p.spine_2_jntBnd!), up: (p) => left(p).add(collar(p).scale(2)) },
    { bone: "spine_03", aim: (p) => p.neck_jntBnd!.subtract(p.chest_jntBnd!), up: collar },
    { bone: "neck_01", aim: (p) => p.head_jntBnd!.subtract(p.neck_jntBnd!), up: collar },
    { bone: "Head", aim: (p) => p.face_jntBnd!.subtract(p.head_jntBnd!), up: (p) => p.head_jntBnd!.subtract(p.neck_jntBnd!) },
  ];
  for (const s of ["l", "r"] as const) {
    const S = s.toUpperCase();
    const j = (p: Pose, n: string) => p[`${S}_${n}`]!;
    // The elbow and knee point where their limb bends; nearly straight, a lean toward the back / the toes keeps the twist.
    const elbow = (p: Pose) => {
      const bend = j(p, "elbow_jntBnd").subtract(mid(j(p, "shoulder_jntBnd"), j(p, "wrist_jntBnd")));
      const back = Vector3.Cross(shoulders(p), p.neck_jntBnd!.subtract(p.chest_jntBnd!));
      return bend.add(unit(back).scale(0.15 * Vector3.Distance(j(p, "shoulder_jntBnd"), j(p, "elbow_jntBnd"))));
    };
    const knee = (p: Pose) => {
      const bend = j(p, "knee_jntBnd").subtract(mid(j(p, "thigh_jntBnd"), j(p, "ankle_jntBnd")));
      return bend.add(unit(j(p, "toe_jntBnd").subtract(j(p, "ankle_jntBnd"))).scale(0.15 * Vector3.Distance(j(p, "thigh_jntBnd"), j(p, "knee_jntBnd"))));
    };
    const legUp = (p: Pose) => j(p, "knee_jntBnd").subtract(j(p, "ankle_jntBnd"));
    const thumb = (p: Pose) => j(p, "thumb_1_jntBnd_1").subtract(j(p, "wrist_jntBnd"));
    out.push(
      { bone: `clavicle_${s}`, aim: (p) => j(p, "shoulder_jntBnd").subtract(j(p, "clavicle_jntBnd")), up: (p) => p.neck_jntBnd!.subtract(p.chest_jntBnd!) },
      { bone: `upperarm_${s}`, aim: (p) => j(p, "elbow_jntBnd").subtract(j(p, "shoulder_jntBnd")), up: elbow },
      { bone: `lowerarm_${s}`, aim: (p) => j(p, "wrist_jntBnd").subtract(j(p, "elbow_jntBnd")), up: thumb },
      { bone: `hand_${s}`, aim: (p) => j(p, "finger_2_jntBnd_1").subtract(j(p, "wrist_jntBnd")), up: thumb },
      { bone: `thigh_${s}`, aim: (p) => j(p, "knee_jntBnd").subtract(j(p, "thigh_jntBnd")), up: knee },
      { bone: `calf_${s}`, aim: (p) => j(p, "ankle_jntBnd").subtract(j(p, "knee_jntBnd")), up: knee },
      { bone: `foot_${s}`, aim: (p) => j(p, "foot_jntBnd").subtract(j(p, "ankle_jntBnd")), up: legUp },
      { bone: `ball_${s}`, aim: (p) => j(p, "toe_jntBnd").subtract(j(p, "foot_jntBnd")), up: legUp },
    );
  }
  return out;
}
const RULES = rules();
const OURS = new Map(POSE_JOINTS.filter((j) => j.ours).map((j) => [j.ours!, j.poe]));

/** A basis whose rows are the aim, the twist axis made square to it, and their cross. */
function basis(aim: Vector3, up: Vector3): Matrix {
  const x = unit(aim);
  let y = up.subtract(x.scale(Vector3.Dot(up, x)));
  if (y.lengthSquared() < 1e-12) y = Math.abs(x.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  y = unit(y.subtract(x.scale(Vector3.Dot(y, x))));
  const m = new Matrix();
  Matrix.FromXYZAxesToRef(x, y, Vector3.Cross(x, y), m);
  return m;
}

const rot = (m: Matrix): Matrix => { const q = new Quaternion(); m.decompose(undefined, q); const r = new Matrix(); Matrix.FromQuaternionToRef(q, r); return r; };

/** The body at bind, read once before any clip moves it. */
export interface Bind {
  pivot: TransformNode;
  nodes: Map<string, TransformNode>;
  /** Bind positions, pivot space, for every joint in POSE_JOINTS (face and toe derived). */
  pos: Pose;
  /** Bind world (pivot space) per turned bone, translation removed. The glTF root mirrors Z, so these are not rotations. */
  rot: Map<string, Matrix>;
  /** Each turned bone's aim and twist axis at bind. */
  frame: Map<string, Matrix>;
  left: Vector3;
  leg: number;
  /** The pelvis parent's world (pivot space), which no take moves. */
  pelvisParent: Matrix;
  faceOffset: Vector3;
  toeOffset: Record<"l" | "r", Vector3>;
  /** The sole's heel off the ankle, carried by the foot (movement-clips' HEEL_BACK / HEEL_DOWN). */
  heelOffset: Record<"l" | "r", Vector3>;
}

/** DEV: the bind each body's retargeted clips were baked on, by rig pivot, for the reference overlay. */
export const BINDS = new WeakMap<TransformNode, Bind>();

export function captureBind(pivot: TransformNode, byName: ReadonlyMap<string, Node>): Bind | null {
  pivot.computeWorldMatrix(true);
  const inv = pivot.getWorldMatrix().clone().invert();
  const nodes = new Map<string, TransformNode>();
  for (const j of POSE_JOINTS) {
    if (!j.ours) continue;
    const n = byName.get(j.ours);
    if (!(n instanceof TransformNode) || !n.rotationQuaternion) return null;
    nodes.set(j.ours, n);
  }
  const world = (n: TransformNode) => n.computeWorldMatrix(true).multiply(inv);
  const pos: Pose = {};
  for (const [ours, poe] of OURS) pos[poe] = world(nodes.get(ours)!).getTranslation();
  const left = unit(pos.L_thigh_jntBnd!.subtract(pos.R_thigh_jntBnd!));
  const leg = Vector3.Distance(pos.L_thigh_jntBnd!, pos.L_knee_jntBnd!) + Vector3.Distance(pos.L_knee_jntBnd!, pos.L_ankle_jntBnd!);
  // Lift `d` toward `toward` (made square to it) by `a`.
  const lift = (d: Vector3, toward: Vector3, a: number) => {
    const u = unit(d), t = unit(toward.subtract(u.scale(Vector3.Dot(toward, u))));
    return u.scale(Math.cos(a)).addInPlace(t.scale(Math.sin(a)));
  };
  const neckUp = unit(pos.head_jntBnd!.subtract(pos.neck_jntBnd!));
  const faceOffset = lift(FORWARD.subtract(neckUp.scale(Vector3.Dot(FORWARD, neckUp))), neckUp, FACE_LIFT).scale(FACE_REACH * leg);
  pos.face_jntBnd = pos.head_jntBnd!.add(faceOffset);
  const toeOffset = { l: Vector3.Zero(), r: Vector3.Zero() };
  const heelOffset = { l: Vector3.Zero(), r: Vector3.Zero() };
  for (const s of ["l", "r"] as const) {
    const S = s.toUpperCase();
    const ball = pos[`${S}_foot_jntBnd`]!.subtract(pos[`${S}_ankle_jntBnd`]!);
    toeOffset[s] = lift(ball, new Vector3(0, 1, 0), TOE_LIFT).scale(TOE_SHARE * ball.length());
    pos[`${S}_toe_jntBnd`] = pos[`${S}_foot_jntBnd`]!.add(toeOffset[s]);
    heelOffset[s] = new Vector3(0, HEEL_DOWN * ball.y, -HEEL_BACK * ball.z);
    pos[`${S}_heel`] = pos[`${S}_ankle_jntBnd`]!.add(heelOffset[s]);
  }
  const rotMap = new Map<string, Matrix>();
  const frame = new Map<string, Matrix>();
  for (const r of RULES) {
    rotMap.set(r.bone, world(nodes.get(r.bone)!).clone().setTranslation(Vector3.Zero()));
    // Elbows bend back and knees forward at bind; the bind limb is too straight to say so itself.
    const up = r.bone.startsWith("upperarm") ? FORWARD.scale(-1) : r.bone.startsWith("thigh") || r.bone.startsWith("calf") ? FORWARD : r.up(pos);
    frame.set(r.bone, basis(r.aim(pos), up));
  }
  const pelvisNode = nodes.get("pelvis")!;
  const pelvisParent = pelvisNode.parent instanceof TransformNode ? pelvisNode.parent.computeWorldMatrix(true).multiply(inv) : Matrix.Identity();
  return { pivot, nodes, pos, rot: rotMap, frame, left, leg, pelvisParent, faceOffset, toeOffset, heelOffset };
}

/** Our body's joints as a take dump would name them, from the bones as they stand (face and toe carried by their bone). */
export function poseFrame(bind: Bind, at: (ours: string) => Vector3, worldOf: (ours: string) => Matrix): Pose {
  const out: Pose = {};
  for (const [ours, poe] of OURS) out[poe] = at(ours);
  const carry = (bone: string, offset: Vector3) =>
    Vector3.TransformNormal(offset, bind.rot.get(bone)!.clone().invert().multiply(worldOf(bone).clone().setTranslation(Vector3.Zero())));
  out.face_jntBnd = out.head_jntBnd!.add(carry("Head", bind.faceOffset));
  for (const s of ["l", "r"] as const) {
    const S = s.toUpperCase();
    out[`${S}_toe_jntBnd`] = out[`${S}_foot_jntBnd`]!.add(carry(`ball_${s}`, bind.toeOffset[s]));
  }
  return out;
}

/** Each turned bone's rotation off its bind (row vectors: bind world dir x R = posed dir), for one reference pose. */
function deltas(bind: Bind, pose: Pose): Map<string, Matrix> {
  const out = new Map<string, Matrix>();
  for (const r of RULES) out.set(r.bone, Matrix.Transpose(bind.frame.get(r.bone)!).multiply(basis(r.aim(pose), r.up(pose))));
  return out;
}

const PARENT: Record<string, string> = {
  spine_01: "pelvis", spine_02: "spine_01", spine_03: "spine_02", neck_01: "spine_03", Head: "neck_01",
  ...Object.fromEntries((["l", "r"] as const).flatMap((s) => [
    [`clavicle_${s}`, "spine_03"], [`upperarm_${s}`, `clavicle_${s}`], [`lowerarm_${s}`, `upperarm_${s}`], [`hand_${s}`, `lowerarm_${s}`],
    [`middle_01_${s}`, `hand_${s}`], [`thumb_01_${s}`, `hand_${s}`],
    [`thigh_${s}`, "pelvis"], [`calf_${s}`, `thigh_${s}`], [`foot_${s}`, `calf_${s}`], [`ball_${s}`, `foot_${s}`],
  ])),
};

/**
 * The reference drawn on our body: the take's bone directions at our bone lengths, hips where the take's
 * hips are. The bones reach exactly these joints when `apply` plays the same frame.
 */
export function targetJoints(bind: Bind, pose: Pose): Pose {
  return solve(bind, pose).joints;
}

/**
 * The turns and the joints they reach. A pose may carry `pin_L` / `pin_R`, where that ankle must stand (the
 * planted foot held to the ground, `takeOf`): thigh and calf then reach it, the knee bending on the take's side.
 */
function solve(bind: Bind, pose: Pose): { R: Map<string, Matrix>; joints: Pose } {
  const R = deltas(bind, pose);
  let joints = chain(bind, pose, R);
  for (const s of ["l", "r"] as const) {
    const S = s.toUpperCase();
    const pin = pose[`pin_${S}`];
    if (!pin) continue;
    const H = joints[`${S}_thigh_jntBnd`]!, K = joints[`${S}_knee_jntBnd`]!;
    const a = Vector3.Distance(bind.pos[`${S}_thigh_jntBnd`]!, bind.pos[`${S}_knee_jntBnd`]!);
    const b = Vector3.Distance(bind.pos[`${S}_knee_jntBnd`]!, bind.pos[`${S}_ankle_jntBnd`]!);
    const toPin = pin.subtract(H);
    const d = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, toPin.length()));
    const u = unit(toPin);
    let side = K.subtract(H);
    side = side.subtract(u.scale(Vector3.Dot(side, u)));
    if (side.lengthSquared() < 1e-12) side = Vector3.Cross(u, bind.left);
    side = unit(side);
    const cos = (a * a + d * d - b * b) / (2 * a * d);
    const knee = H.add(u.scale(a * cos)).addInPlace(side.scale(a * Math.sqrt(Math.max(0, 1 - cos * cos))));
    const ankle = H.add(u.scale(d));
    const rule = (bone: string) => RULES.find((r) => r.bone === bone)!;
    R.set(`thigh_${s}`, Matrix.Transpose(bind.frame.get(`thigh_${s}`)!).multiply(basis(knee.subtract(H), rule(`thigh_${s}`).up(pose))));
    R.set(`calf_${s}`, Matrix.Transpose(bind.frame.get(`calf_${s}`)!).multiply(basis(ankle.subtract(knee), rule(`calf_${s}`).up(pose))));
  }
  if (pose.pin_L || pose.pin_R) joints = chain(bind, pose, R);
  return { R, joints };
}

/** The joints the turns reach, hips on the take's. */
function chain(bind: Bind, pose: Pose, R: Map<string, Matrix>): Pose {
  const hips = mid(pose.L_thigh_jntBnd!, pose.R_thigh_jntBnd!);
  const bindHips = mid(bind.pos.L_thigh_jntBnd!, bind.pos.R_thigh_jntBnd!);
  const out: Pose = {};
  const place = (ours: string): Vector3 => {
    const poe = OURS.get(ours)!;
    if (out[poe]) return out[poe]!;
    const parent = PARENT[ours];
    const from: Vector3 = parent ? place(parent) : hips;
    const base = parent ? bind.pos[OURS.get(parent)!]! : bindHips;
    out[poe] = from.add(Vector3.TransformNormal(bind.pos[poe]!.subtract(base), R.get(parent ?? "pelvis")!));
    return out[poe]!;
  };
  for (const ours of OURS.keys()) place(ours);
  out.face_jntBnd = out.head_jntBnd!.add(Vector3.TransformNormal(bind.faceOffset, R.get("Head")!));
  for (const s of ["l", "r"] as const) {
    const S = s.toUpperCase();
    out[`${S}_toe_jntBnd`] = out[`${S}_foot_jntBnd`]!.add(Vector3.TransformNormal(bind.toeOffset[s], R.get(`ball_${s}`)!));
    out[`${S}_heel`] = out[`${S}_ankle_jntBnd`]!.add(Vector3.TransformNormal(bind.heelOffset[s], R.get(`foot_${s}`)!));
  }
  return out;
}

/** Turn our bones to one reference pose (pelvis placed so our hips sit on the take's). */
export function applyPose(bind: Bind, pose: Pose): void {
  const { R, joints } = solve(bind, pose);
  const world = new Map<string, Matrix>();
  const scale = new Vector3(), q = new Quaternion(), t = new Vector3();
  for (const r of RULES) {
    // Bind world, then the turn in pivot space, standing on the joint the reference draws.
    const m = bind.rot.get(r.bone)!.multiply(R.get(r.bone)!).setTranslation(joints[OURS.get(r.bone)!]!);
    world.set(r.bone, m);
    const p = PARENT[r.bone];
    const local = m.multiply((p ? world.get(p)! : bind.pelvisParent).clone().invert());
    local.decompose(scale, q, t);
    const node = bind.nodes.get(r.bone)!;
    node.rotationQuaternion!.copyFrom(q);
    if (r.bone === "pelvis") node.position.copyFrom(t);
  }
  for (const n of bind.nodes.values()) n.computeWorldMatrix(true);
}

/** A reference take placed on our body: in place, scaled to our leg, floor under our ankles, phase 0 at the left touchdown. */
export interface Take {
  n: number;
  fps: number;
  /** Source frames skipped so frame 0 is the left foot's touchdown. */
  shift: number;
  /** What placing added to every reference joint (pivot space). */
  offset: Vector3;
  /** The way the planted feet carry the body, radians off +Z toward +X, and how fast (pivot units per second). */
  travel: number;
  speed: number;
  frame(f: number): Pose;
  apply(f: number): void;
}

export function takeOf(clip: PoseClip, bind: Bind): Take {
  const ix = new Map(clip.bones.map((b, i) => [b.name, i]));
  const n = Math.max(1, clip.frames.length - 1);
  const raw = (f: number, name: string) => {
    const i = ix.get(name);
    if (i === undefined) throw new Error(`take ${clip.clip} lacks ${name}`);
    const r = clip.frames[f]!;
    return new Vector3(r[3 * i]!, r[3 * i + 1]!, r[3 * i + 2]!);
  };
  const up = new Vector3(0, 1, 0);
  // PoE2 axes onto ours: +X its left, -Z its up, -Y its forward.
  const map = (v: Vector3) => bind.left.scale(v.x).addInPlace(up.scale(-v.z)).addInPlace(FORWARD.scale(-v.y));
  const legOf = (f: number) => Vector3.Distance(raw(f, "L_thigh_jntBnd"), raw(f, "L_knee_jntBnd")) + Vector3.Distance(raw(f, "L_knee_jntBnd"), raw(f, "L_ankle_jntBnd"));
  const scale = bind.leg / legOf(0);
  const poses: Pose[] = [];
  for (let f = 0; f < n; f++) poses.push(Object.fromEntries(POSE_JOINTS.map((j) => [j.poe, map(raw(f, j.poe)).scale(scale)])));
  // Floor and ground speed are read off OUR feet as the take places them: our thigh-to-shin ratio is not
  // the take's, so its own ankles would sink ours and pace them for a stride ours do not take.
  const placed = poses.map((p) => targetJoints(bind, p));
  // A sole point's height off where it stands at bind: ankle, ball, heel.
  const SOLE = ["ankle_jntBnd", "foot_jntBnd", "heel"];
  const heights = (p: Pose, s: "L" | "R") => SOLE.map((k) => p[`${s}_${k}`]!.y - bind.pos[`${s}_${k}`]!.y);
  const sole = (p: Pose, s: "L" | "R") => Math.min(...heights(p, s));
  const low = Math.min(...placed.flatMap((p) => [sole(p, "L"), sole(p, "R")]));
  const offset = new Vector3(0, -low, 0);
  for (const p of [...poses, ...placed]) for (const v of Object.values(p)) v.addInPlace(offset);
  // Planted: the sole within 0.03 of a leg of the floor (our proportions float a take's plant by up to that);
  // the left touchdown starts the cycle.
  const band = 0.03 * bind.leg;
  const down = (f: number, s: "L" | "R") => sole(placed[((f % n) + n) % n]!, s) <= band;
  let shift = 0;
  for (let f = 0; f < n; f++) if (down(f, "L") && !down(f - 1, "L")) { shift = f; break; }
  // The planted contact (the lowest sole point) slides back at the ground's speed.
  const lowest = (p: Pose, s: "L" | "R") => { const h = heights(p, s); return SOLE[h.indexOf(Math.min(...h))]!; };
  const contact = (p: Pose, s: "L" | "R") => p[`${s}_${lowest(p, s)}`]!;
  const slide = Vector3.Zero();
  let count = 0;
  for (const s of ["L", "R"] as const) {
    for (let f = 0; f < n; f++) {
      // The same sole point on both frames: a roll from heel to ball moves the contact a foot length.
      if (!down(f, s) || !down(f + 1, s) || lowest(placed[f]!, s) !== lowest(placed[(f + 1) % n]!, s)) continue;
      const k = lowest(placed[f]!, s);
      slide.addInPlace(placed[(f + 1) % n]![`${s}_${k}`]!.subtract(placed[f]![`${s}_${k}`]!));
      count++;
    }
  }
  slide.scaleInPlace(count ? 1 / count : 0);
  slide.y = 0;
  // Hold each planted contact on a line at the ground's step (fitted per run of one contact, ball or ankle),
  // the ankle moved by what that takes; the swing carries the shift from one plant to the next.
  for (const s of ["L", "R"] as const) {
    const shiftOf: (Vector3 | null)[] = Array.from({ length: n }, () => null);
    const kind = (f: number) => (down(f, s) ? 1 + SOLE.indexOf(lowest(placed[f]!, s)) : 0);
    const start = Array.from({ length: n }, (_, f) => f).find((f) => kind(f) !== kind(f - 1 < 0 ? n - 1 : f - 1)) ?? 0;
    for (let i = 0; i < n;) {
      const f0 = (start + i) % n, k = kind(f0);
      let m = 1;
      while (m < n - i && kind((f0 + m) % n) === k) m++;
      if (k !== 0) {
        // A plant's first contact is fitted; a contact rolled onto from another starts where that one left the foot.
        const before = shiftOf[(f0 - 1 + n) % n];
        const anchor = Vector3.Zero();
        if (before) anchor.copyFrom(contact(placed[f0]!, s).add(before));
        else {
          for (let j = 0; j < m; j++) anchor.addInPlace(contact(placed[(f0 + j) % n]!, s).subtract(slide.scale(j)));
          anchor.scaleInPlace(1 / m);
        }
        for (let j = 0; j < m; j++) {
          const p = placed[(f0 + j) % n]!;
          const c = anchor.add(slide.scale(j)).subtract(contact(p, s));
          // ...and on the floor.
          c.y = -sole(p, s);
          shiftOf[(f0 + j) % n] = c;
        }
      }
      i += m;
    }
    const held = shiftOf.map((c, f) => (c ? f : -1)).filter((f) => f >= 0);
    if (held.length === 0) continue;
    for (let f = 0; f < n; f++) {
      if (shiftOf[f]) continue;
      // Across the swing the floor shift runs linear from the last held frame to the next; the pull onto the
      // floor fades within 3 frames of a plant, or a lifting foot skims the floor at swing speed.
      let back = 1; while (!shiftOf[(f - back + n) % n] || held.indexOf((f - back + n) % n) < 0) back++;
      let ahead = 1; while (!shiftOf[(f + ahead) % n] || held.indexOf((f + ahead) % n) < 0) ahead++;
      const from = shiftOf[(f - back + n) % n]!, to = shiftOf[(f + ahead) % n]!;
      const c = Vector3.Lerp(from, to, back / (back + ahead));
      c.y = from.y * Math.max(0, 1 - back / 3) + to.y * Math.max(0, 1 - ahead / 3);
      shiftOf[f] = c;
    }
    for (let f = 0; f < n; f++) poses[f]![`pin_${s}`] = placed[f]![`${s}_ankle_jntBnd`]!.add(shiftOf[f]!);
  }
  const at = (f: number) => poses[(((f + shift) % n) + n) % n]!;
  return {
    n, fps: clip.fps, shift, offset,
    travel: Math.atan2(-slide.x, -slide.z),
    speed: Math.hypot(slide.x, slide.z) * clip.fps,
    frame: at,
    apply: (f) => applyPose(bind, at(f)),
  };
}

/**
 * Bake each take into an in-place clip on this body. Played at speed ratio 1 its planted feet carry the
 * body at `pace` (MOVEMENT_PACE x stride): the take's own cadence, rescaled to that ground speed.
 */
export function createRetargetClips(scene: Scene, pivot: TransformNode, byName: ReadonlyMap<string, Node>,
  takes: ReadonlyMap<string, { clip: PoseClip; pace: number }>): Map<string, AnimationGroup> | null {
  const bind = captureBind(pivot, byName);
  if (!bind) return null;
  BINDS.set(pivot, bind);
  const turned = [...RULES.map((r) => bind.nodes.get(r.bone)!)];
  const saved = turned.map((n) => n.rotationQuaternion!.clone());
  const pelvis = bind.nodes.get("pelvis")!;
  const pelvisRest = pelvis.position.clone();
  const groups = new Map<string, AnimationGroup>();
  try {
    for (const [name, { clip, pace }] of takes) {
      const take = takeOf(clip, bind);
      const rate = take.speed > 1e-6 ? (take.fps * pace) / take.speed : take.fps;
      const rotations: IAnimationKey[][] = turned.map(() => []);
      const moves: IAnimationKey[] = [];
      for (let f = 0; f <= take.n; f++) {
        take.apply(f % take.n);
        for (const [i, node] of turned.entries()) rotations[i]!.push({ frame: f, value: node.rotationQuaternion!.clone() });
        moves.push({ frame: f, value: pelvis.position.clone() });
      }
      const group = new AnimationGroup(name, scene);
      for (const [i, node] of turned.entries()) {
        const a = new Animation(`${name}-${node.name}-rot`, "rotationQuaternion", rate, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
        a.setKeys(rotations[i]!);
        group.addTargetedAnimation(a, node);
      }
      const a = new Animation(`${name}-pelvis-pos`, "position", rate, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
      a.setKeys(moves);
      group.addTargetedAnimation(a, pelvis);
      group.normalize(0, take.n);
      groups.set(name, group);
    }
    return groups;
  } catch (e) {
    for (const g of groups.values()) g.dispose();
    console.warn("retarget failed", e);
    return null;
  } finally {
    for (const [i, node] of turned.entries()) node.rotationQuaternion!.copyFrom(saved[i]!);
    pelvis.position.copyFrom(pelvisRest);
  }
}
