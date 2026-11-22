import {
  Color3,
  type Mesh,
  MeshBuilder,
  type Observer,
  Quaternion,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

/**
 * DEV only: a reference clip (world joint positions per frame, e.g. exported from another
 * game for side-by-side study) drawn as a stick figure beside the viewer's character.
 * The data is never bundled: it is fetched from the dev server's `/__ref/<name>.json`.
 */
export interface ReferenceClip {
  clip: string;
  fps: number;
  bones: readonly { name: string; parent: number }[];
  /** One row per frame, xyz per bone; the last frame repeats the first. */
  frames: readonly (readonly number[])[];
}

/** The subject's proportions the reference is fitted to. */
export interface StageFit {
  leg: number;
  /** +1 or -1: the sign of X on the subject's left side. */
  leftSign: number;
  /** Height of the ankle joint standing. */
  ankleY: number;
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.sqrt(dot(a, a));
const unit = (a: V): V => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const CORE = [
  ...["hip", "spine_1", "spine_2", "chest", "neck", "head",
    ...["L", "R"].flatMap((s) => ["clavicle", "shoulder", "elbow", "wrist", "thigh", "knee", "ankle", "foot", "toe"].map((b) => `${s}_${b}`)),
  ].map((b) => `${b}_jntBnd`),
  "L_finger_2_jntBnd_1", "R_finger_2_jntBnd_1",
];

/**
 * Every frame's joints in the viewer's space: up +Y, facing +Z, the reference's left on the
 * subject's left, scaled to the subject's leg, the root's travel over the cycle removed and
 * the hip centred over the origin, the lowest ankle of the cycle at the subject's ankle height.
 */
export function toStage(clip: ReferenceClip, fit: StageFit): V[][] {
  const ix = new Map(clip.bones.map((b, i) => [b.name, i]));
  const at = (f: number, name: string): V => {
    const i = ix.get(name);
    if (i === undefined) throw new Error(`reference lacks ${name}`);
    const row = clip.frames[f]!;
    return [row[3 * i]!, row[3 * i + 1]!, row[3 * i + 2]!];
  };
  const n = Math.max(1, clip.frames.length - 1);
  const mean = (name: string): V => {
    const s: V = [0, 0, 0];
    for (let f = 0; f < n; f++) { const p = at(f, name); s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return [s[0] / n, s[1] / n, s[2] / n];
  };
  const rise = sub(mean("head_jntBnd"), mean("L_ankle_jntBnd"));
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(rise[b]!) > Math.abs(rise[a]!) ? b : a), 0);
  const up: V = [0, 0, 0];
  up[k] = Math.sign(rise[k]!) || 1;
  const toes: V = [0, 0, 0];
  for (let f = 0; f < n; f++) {
    for (const s of ["L", "R"]) {
      const t = sub(at(f, `${s}_toe_jntBnd`), at(f, `${s}_ankle_jntBnd`));
      toes[0] += t[0]; toes[1] += t[1]; toes[2] += t[2];
    }
  }
  toes[k] = 0;
  const fwd = unit(toes);
  let side = cross(up, fwd);
  if (Math.sign(dot(sub(mean("L_thigh_jntBnd"), mean("R_thigh_jntBnd")), side)) !== fit.leftSign) side = [-side[0], -side[1], -side[2]];
  const leg = len(sub(at(0, "L_thigh_jntBnd"), at(0, "L_knee_jntBnd"))) + len(sub(at(0, "L_knee_jntBnd"), at(0, "L_ankle_jntBnd")));
  const scale = fit.leg / leg;
  const project = (p: V): V => [dot(p, side) * scale, dot(p, up) * scale, dot(p, fwd) * scale];

  const raw = clip.frames.map((_, f) => clip.bones.map((b) => project(at(f, b.name))));
  const hip = ix.get("hip_jntBnd")!;
  const drift = sub(raw[n]![hip]!, raw[0]![hip]!);
  for (const [f, frame] of raw.entries()) {
    for (const p of frame) { p[0] -= drift[0] * (f / n); p[2] -= drift[2] * (f / n); }
  }
  let cx = 0, cz = 0, low = Infinity;
  const ankles = [ix.get("L_ankle_jntBnd")!, ix.get("R_ankle_jntBnd")!];
  for (let f = 0; f < n; f++) {
    cx += raw[f]![hip]![0] / n;
    cz += raw[f]![hip]![2] / n;
    for (const a of ankles) low = Math.min(low, raw[f]![a]![1]);
  }
  for (const frame of raw) for (const p of frame) { p[0] -= cx; p[1] += fit.ankleY - low; p[2] -= cz; }
  return raw;
}

/** Parent-child pairs worth drawing: the body's main chain, no helpers, twists or attachments. */
export function segments(clip: ReferenceClip): [number, number][] {
  const keep = new Set(CORE);
  return clip.bones.flatMap((b, i) => (keep.has(b.name) && b.parent >= 0 && keep.has(clip.bones[b.parent]!.name) ? [[b.parent, i] as [number, number]] : []));
}

function fitOf(subject: TransformNode | null): StageFit | null {
  const mesh = subject?.getChildMeshes(false).find((m) => m.isEnabled() && m.skeleton !== null);
  const bones = mesh?.skeleton?.bones;
  if (!bones) return null;
  const node = (name: string) => bones.find((b) => b.name === name)?.getTransformNode() ?? null;
  const [thighL, calfL, footL, thighR] = ["thigh_l", "calf_l", "foot_l", "thigh_r"].map(node);
  if (!thighL || !calfL || !footL || !thighR) return null;
  for (const n of [thighL, calfL, footL, thighR]) n.computeWorldMatrix(true);
  const p = (n: TransformNode) => n.getAbsolutePosition();
  return {
    leg: Vector3.Distance(p(thighL), p(calfL)) + Vector3.Distance(p(calfL), p(footL)),
    leftSign: Math.sign(p(thighL).x - p(thighR).x) || 1,
    ankleY: p(footL).y,
  };
}

export interface ReferenceOptions {
  /** Where the figure stands off the subject, in viewer units; default 1.2 to the camera's right. */
  offset?: readonly [number, number, number];
  /** Playback rate over the clip's own fps. */
  rate?: number;
  /** Hold the figure at this fraction of its clip instead of playing it. */
  phase?: number;
  /** Turn the figure about Y by this many degrees (counter-clockwise in atan2(z, x)), e.g. to stand on a body whose feet point off +Z. */
  yaw?: number;
  /** The subject's planted ankle height; default is the subject's ankle in the pose it holds when the figure appears. */
  ankleY?: number;
  /** Draw over the subject (rendering group 1) instead of hidden inside him, for an on-body overlay. */
  onTop?: boolean;
  /**
   * Draw the take on the subject's own proportions: its bone directions at his bone lengths, hips on the take's,
   * at his retargeted clip's phase (`retarget.ts`). Needs the rig to have baked the retargeted clips.
   */
  retarget?: boolean;
}

let shown: { dispose(): void } | null = null;

/** Show `name` (`/__ref/<name>.json`) beside the subject, or take the figure down with null. */
export async function showReference(scene: Scene, subject: () => TransformNode | null, name: string | null, opts: ReferenceOptions = {}): Promise<string> {
  shown?.dispose();
  shown = null;
  if (name === null) return "cleared";
  const res = await fetch(`/__ref/${encodeURIComponent(name)}.json`);
  if (!res.ok) throw new Error(`reference ${name}: HTTP ${res.status}`);
  const clip = (await res.json()) as ReferenceClip;
  const pairs = segments(clip);
  const mat = new StandardMaterial("ref-mat", scene);
  mat.emissiveColor = new Color3(1, 0.55, 0.15);
  mat.disableLighting = true;
  const sticks: Mesh[] = pairs.map(([, c]) => {
    const m = MeshBuilder.CreateCylinder(`ref-${clip.bones[c]!.name}`, { height: 1, diameter: 0.03, tessellation: 6 }, scene);
    m.material = mat;
    m.rotationQuaternion = new Quaternion();
    return m;
  });
  const head = MeshBuilder.CreateSphere("ref-head", { diameter: 0.2, segments: 8 }, scene);
  head.material = mat;
  if (opts.onTop) for (const m of [...sticks, head]) m.renderingGroupId = 1;
  // On his own proportions the marker sits inside his skull.
  if (opts.retarget) head.scaling.setAll(0.5);
  const headIx = clip.bones.findIndex((b) => b.name === "head_jntBnd");
  let [ox, oy, oz] = opts.offset ?? [0, 0, 0];
  const n = clip.frames.length - 1;
  let frames: V[][] | null = null;
  let t = 0;
  const a = new Vector3(), b = new Vector3(), dir = new Vector3();
  if (opts.retarget) {
    const rt = await import("../render/retarget");
    const host = subject();
    const pivot = host?.getDescendants(false).find((d): d is TransformNode => d instanceof TransformNode && rt.BINDS.has(d)) ?? null;
    const bind = pivot ? rt.BINDS.get(pivot)! : null;
    if (!bind) throw new Error("no retargeted body under the subject");
    const take = rt.takeOf(clip, bind);
    // Every frame of the take on his proportions, world space.
    const placed: V[][] = Array.from({ length: take.n + 1 }, (_, f) => {
      const j = rt.targetJoints(bind, take.frame(f % take.n));
      const w = bind.pivot.getWorldMatrix();
      return clip.bones.map((bn) => { const p = j[bn.name]; if (!p) return [NaN, NaN, NaN]; const q = Vector3.TransformCoordinates(p, w); return [q.x, q.y, q.z]; });
    });
    frames = placed;
    ox = oy = oz = 0;
  }
  const lerp = (fa: V[], fb: V[], u: number, i: number, out: Vector3) =>
    out.set(fa[i]![0] + (fb[i]![0] - fa[i]![0]) * u + ox, fa[i]![1] + (fb[i]![1] - fa[i]![1]) * u + oy, fa[i]![2] + (fb[i]![2] - fa[i]![2]) * u + oz);
  const tick: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
    if (frames === null) {
      const fit = fitOf(subject());
      if (fit === null) return;
      frames = toStage(clip, opts.ankleY === undefined ? fit : { ...fit, ankleY: opts.ankleY });
      const r = ((opts.yaw ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      if (r !== 0) for (const frame of frames) for (const p of frame) [p[0], p[2]] = [p[0] * c - p[2] * s, p[0] * s + p[2] * c];
    }
    if (!opts.offset && !opts.retarget && scene.activeCamera) {
      // Without a fixed offset the figure stands to the screen's right of the subject, however the camera orbits.
      const right = scene.activeCamera.getDirection(Vector3.Right());
      const flat = Math.hypot(right.x, right.z) || 1;
      ox = (right.x / flat) * 1.2;
      oz = (right.z / flat) * 1.2;
    }
    t += (scene.getEngine().getDeltaTime() / 1000) * scene.animationTimeScale * (opts.rate ?? 1);
    const pos = opts.phase === undefined ? (t * clip.fps) % n : ((((opts.phase % 1) + 1) % 1) * n) % n;
    const f0 = Math.floor(pos), u = pos - f0;
    const fa = frames[f0]!, fb = frames[f0 + 1]!;
    for (const [s, [p, c]] of pairs.entries()) {
      lerp(fa, fb, u, p, a);
      lerp(fa, fb, u, c, b);
      b.subtractToRef(a, dir);
      const stick = sticks[s]!;
      a.addToRef(b, stick.position).scaleInPlace(0.5);
      stick.scaling.y = dir.length();
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir.normalize(), stick.rotationQuaternion!);
    }
    if (headIx >= 0) lerp(fa, fb, u, headIx, head.position).addInPlaceFromFloats(0, 0.08, 0);
  });
  shown = {
    dispose() {
      scene.onBeforeRenderObservable.remove(tick);
      for (const s of sticks) s.dispose();
      head.dispose();
      mat.dispose();
    },
  };
  return `${clip.clip}: ${n} frames @ ${clip.fps} fps, ${pairs.length} bones`;
}
