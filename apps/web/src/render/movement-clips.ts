import {
  AbstractMesh,
  Animation,
  AnimationGroup,
  Matrix,
  Quaternion,
  TransformNode,
  Vector3,
  type IAnimationKey,
  type Node,
  type Scene,
} from "@babylonjs/core";

type Gait = "walk" | "run";
type Key = readonly [phase: number, value: number];

export type MovementKeyframeSpec = { name: string; gait: Gait; yaw: number; stride: number };

export const MOVEMENT_PACE: Readonly<Record<Gait, number>> = { walk: 1.55, run: 3.8 };

const FPS = 30;
const SECOND_FOOT = 0.5;
const RIGHT = Vector3.Right();
const UP = Vector3.Up();
const FORWARD = Vector3.Forward();

interface GaitKeys {
  frames: number;
  stance: number;
  lift: readonly Key[];
  footPitch: readonly Key[];
  hips: readonly Key[];
  arm: readonly Key[];
  lean: number;
}

// Foot lift is a fraction of leg reach. The hip curve spans one step, and
// each arm curve spans a full stride. Angles are radians.
const GAITS: Readonly<Record<Gait, GaitKeys>> = {
  walk: {
    frames: 35,
    stance: 0.6,
    lift: [[0, 0], [0.22, 0.054], [0.55, 0.09], [0.78, 0.048], [1, 0]],
    footPitch: [[0, 0], [0.24, 0.23], [0.66, -0.08], [0.88, -0.17], [1, 0]],
    hips: [[0, -0.052], [0.21, -0.075], [0.55, -0.045], [0.82, -0.033], [1, -0.052]],
    arm: [[0, -0.16], [0.19, -0.10], [0.50, 0.17], [0.72, 0.11], [1, -0.16]],
    lean: 0.035,
  },
  run: {
    frames: 22,
    stance: 0.43,
    lift: [[0, 0], [0.19, 0.15], [0.44, 0.22], [0.73, 0.12], [1, 0]],
    footPitch: [[0, 0], [0.22, 0.39], [0.55, 0.02], [0.83, -0.15], [1, 0]],
    hips: [[0, -0.085], [0.24, -0.115], [0.57, -0.066], [0.86, -0.035], [1, -0.085]],
    arm: [[0, -0.34], [0.14, -0.27], [0.46, 0.32], [0.68, 0.26], [1, -0.34]],
    lean: 0.14,
  },
};

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function sample(keys: readonly Key[], phase: number): number {
  for (let i = 1; i < keys.length; i++) {
    const [end, to] = keys[i]!;
    if (phase > end) continue;
    const [start, from] = keys[i - 1]!;
    return from + (to - from) * ease((phase - start) / (end - start));
  }
  return keys.at(-1)![1];
}

function freshWorld(node: TransformNode): void {
  if (node.parent instanceof TransformNode) freshWorld(node.parent);
  node.computeWorldMatrix(true);
}

function toParent(node: TransformNode, pivotWorld: Matrix): Matrix {
  const parent = node.parent;
  return parent instanceof TransformNode
    ? pivotWorld.multiply(parent.getWorldMatrix().clone().invert())
    : pivotWorld;
}

function swing(node: TransformNode, current: Vector3, wanted: Vector3, pivotWorld: Matrix): void {
  const transform = toParent(node, pivotWorld);
  const from = Vector3.TransformNormal(current, transform).normalize();
  const to = Vector3.TransformNormal(wanted, transform).normalize();
  const rotation = node.rotationQuaternion!;
  Quaternion.FromUnitVectorsToRef(from, to, new Quaternion()).multiplyToRef(rotation, rotation);
}

function turn(node: TransformNode, axis: Vector3, angle: number, pivotWorld: Matrix): void {
  const transform = toParent(node, pivotWorld);
  const local = Vector3.TransformNormal(axis, transform).normalize();
  // Mapping an angular axis through the imported armature's reflection reverses its sense.
  const rotation = node.rotationQuaternion!;
  Quaternion.RotationAxis(local, angle * Math.sign(transform.determinant())).multiplyToRef(rotation, rotation);
}

interface Leg {
  thigh: TransformNode;
  calf: TransformNode;
  foot: TransformNode;
  anchor: Vector3;
  bindBasis: Matrix;
  upper: number;
  lower: number;
}

interface Arm {
  shoulder: TransformNode;
  elbow: TransformNode;
  hand: TransformNode;
  side: number;
}

function footPose(leg: Leg, lane: number, phase: number, keys: GaitKeys, distance: number, travel: Vector3): { at: Vector3; pitch: number } {
  const swingPhase = Math.max(0, (phase - keys.stance) / (1 - keys.stance));
  const along = phase < keys.stance ? 0.5 - phase / keys.stance : ease(swingPhase) - 0.5;
  const at = leg.anchor.add(travel.scale(along * distance));
  const reach = leg.upper + leg.lower;
  at.y += reach * sample(keys.lift, swingPhase);
  at.x += Math.sign(leg.anchor.x || lane) * reach * Math.abs(travel.x) * 0.09;
  at.z += lane * reach * Math.abs(travel.x) * 0.12;
  return { at, pitch: sample(keys.footPitch, swingPhase) * Math.max(0.35, travel.z) };
}

function placeLeg(leg: Leg, target: Vector3, pitch: number, pivotWorld: Matrix, position: (node: TransformNode) => Vector3): void {
  const { thigh, calf, foot, upper, lower } = leg;
  const hip = position(thigh);
  const reach = target.subtract(hip);
  const length = Math.max(Math.abs(upper - lower) + 1e-5, Math.min(0.998 * (upper + lower), reach.length()));
  const toward = reach.normalize();
  const forward = FORWARD.subtract(toward.scale(Vector3.Dot(FORWARD, toward))).normalize();
  const along = (upper * upper + length * length - lower * lower) / (2 * length);
  const knee = hip.add(toward.scale(along)).addInPlace(forward.scale(Math.sqrt(Math.max(0, upper * upper - along * along))));
  swing(thigh, position(calf).subtract(hip), knee.subtract(hip), pivotWorld);
  thigh.computeWorldMatrix(true);
  calf.computeWorldMatrix(true);
  foot.computeWorldMatrix(true);
  const currentKnee = position(calf);
  swing(calf, position(foot).subtract(currentKnee), target.subtract(currentKnee), pivotWorld);
  calf.computeWorldMatrix(true);
  leg.bindBasis.multiply(Matrix.RotationX(pitch)).multiply(toParent(foot, pivotWorld))
    .decompose(undefined, foot.rotationQuaternion!);
  foot.computeWorldMatrix(true);
}

function motionTrack(name: string, property: string, type: number, frames: number, keys: IAnimationKey[], target: TransformNode, group: AnimationGroup): void {
  const animation = new Animation(`${name}-${target.name}-${property}`, property, FPS, type, Animation.ANIMATIONLOOPMODE_CYCLE);
  const first = keys[0]!.value as Quaternion | Vector3;
  keys.push({ frame: frames, value: first.clone() });
  animation.setKeys(keys);
  group.addTargetedAnimation(animation, target);
}

/** Bake original in-place movement against the attached body's bind proportions. */
export function createMovementClips(
  scene: Scene,
  pivot: TransformNode,
  bones: ReadonlyMap<string, Node>,
  specs: readonly MovementKeyframeSpec[],
): Map<string, AnimationGroup> | null {
  function joint(name: string): TransformNode | null {
    const node = bones.get(name);
    return node instanceof TransformNode && node.rotationQuaternion && !(node instanceof AbstractMesh) ? node : null;
  }

  const pelvis = joint("pelvis");
  const chest = joint("spine_02");
  if (!pelvis || !chest) return null;
  freshWorld(pivot);
  const pivotWorld = pivot.getWorldMatrix().clone();
  const inverse = pivotWorld.clone().invert();
  const position = (node: TransformNode) => Vector3.TransformCoordinates(node.getAbsolutePosition(), inverse);
  const legs: Leg[] = [];
  const arms: Arm[] = [];
  for (const side of ["l", "r"]) {
    const thigh = joint(`thigh_${side}`), calf = joint(`calf_${side}`), foot = joint(`foot_${side}`);
    const shoulder = joint(`upperarm_${side}`), elbow = joint(`lowerarm_${side}`), hand = joint(`hand_${side}`);
    if (!thigh || !calf || !foot || !shoulder || !elbow || !hand) return null;
    freshWorld(foot);
    freshWorld(hand);
    const upper = Vector3.Distance(position(thigh), position(calf));
    const lower = Vector3.Distance(position(calf), position(foot));
    if (!(upper > 1e-4 && lower > 1e-4)) return null;
    legs.push({ thigh, calf, foot, anchor: position(foot), bindBasis: foot.getWorldMatrix().multiply(inverse), upper, lower });
    arms.push({ shoulder, elbow, hand, side: Math.sign(position(shoulder).x - position(chest).x) || 1 });
  }

  const keyed = [pelvis, chest, ...legs.flatMap(({ thigh, calf, foot }) => [thigh, calf, foot]), ...arms.flatMap(({ shoulder, elbow }) => [shoulder, elbow])];
  const saved = keyed.map((node) => node.rotationQuaternion!.clone());
  const pelvisRest = pelvis.position.clone();
  const pelvisToParent = toParent(pelvis, pivotWorld);
  const groups = new Map<string, AnimationGroup>();
  const rest = () => {
    for (const [i, node] of keyed.entries()) node.rotationQuaternion!.copyFrom(saved[i]!);
    pelvis.position.copyFrom(pelvisRest);
  };

  try {
    for (const spec of specs) {
      if (groups.has(spec.name) || !Number.isFinite(spec.yaw) || !(spec.stride > 0) || !Number.isFinite(spec.stride)) {
        throw new Error(`Invalid movement clip ${spec.name}`);
      }
      const keys = GAITS[spec.gait];
      const travel = new Vector3(Math.sin(spec.yaw), 0, Math.cos(spec.yaw));
      const distance = (keys.frames / FPS) * keys.stance * MOVEMENT_PACE[spec.gait] * spec.stride;
      const rotations: IAnimationKey[][] = keyed.map(() => []);
      const translations: IAnimationKey[] = [];
      for (let frame = 0; frame < keys.frames; frame++) {
        rest();
        const phase = frame / keys.frames;
        const feet = legs.map((leg, i) => footPose(leg, i === 0 ? 1 : -1, (phase + SECOND_FOOT * i) % 1, keys, distance, travel));
        const legsReach = (legs[0]!.upper + legs[0]!.lower + legs[1]!.upper + legs[1]!.lower) / 2;
        const sway = Math.sin(phase * Math.PI * 2);
        const shift = new Vector3(sway * legsReach * 0.016, sample(keys.hips, (phase * 2) % 1) * legsReach, 0);
        turn(pelvis, UP, sway * 0.05, pivotWorld);
        pelvis.computeWorldMatrix(true);
        for (const [i, leg] of legs.entries()) {
          leg.thigh.computeWorldMatrix(true);
          const hip = position(leg.thigh);
          const target = feet[i]!.at;
          const dx = target.x - hip.x - shift.x, dz = target.z - hip.z;
          const reach = (leg.upper + leg.lower) * 0.995;
          const below = Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
          shift.y = Math.min(shift.y, target.y + below - hip.y);
        }
        pelvis.position.copyFrom(pelvisRest).addInPlace(Vector3.TransformNormal(shift, pelvisToParent));
        pelvis.computeWorldMatrix(true);
        for (const [i, leg] of legs.entries()) {
          leg.thigh.computeWorldMatrix(true);
          leg.calf.computeWorldMatrix(true);
          leg.foot.computeWorldMatrix(true);
          const { at, pitch } = feet[i]!;
          placeLeg(leg, at, pitch, pivotWorld, position);
        }
        freshWorld(chest);
        turn(chest, RIGHT, keys.lean * travel.z, pivotWorld);
        turn(chest, UP, -sway * 0.08, pivotWorld);
        for (const [i, arm] of arms.entries()) {
          const { shoulder, elbow, hand, side } = arm;
          const armPhase = (phase + SECOND_FOOT * i) % 1;
          const swingAmount = sample(keys.arm, armPhase) * (1 - 0.4 * Math.abs(travel.x));
          freshWorld(elbow);
          swing(shoulder, position(elbow).subtract(position(shoulder)), new Vector3(side * 0.24, -1, swingAmount), pivotWorld);
          freshWorld(hand);
          const bent = spec.gait === "run" ? 0.95 : 0.30;
          swing(elbow, position(hand).subtract(position(elbow)), new Vector3(-side * 0.16, -1, bent + swingAmount * 0.75), pivotWorld);
        }
        for (const [i, node] of keyed.entries()) rotations[i]!.push({ frame, value: node.rotationQuaternion!.clone() });
        translations.push({ frame, value: pelvis.position.clone() });
      }

      const group = new AnimationGroup(spec.name, scene);
      groups.set(spec.name, group);
      for (const [i, node] of keyed.entries()) {
        motionTrack(spec.name, "rotationQuaternion", Animation.ANIMATIONTYPE_QUATERNION, keys.frames, rotations[i]!, node, group);
      }
      motionTrack(spec.name, "position", Animation.ANIMATIONTYPE_VECTOR3, keys.frames, translations, pelvis, group);
      group.normalize(0, keys.frames);
    }
    return groups;
  } catch {
    for (const group of groups.values()) group.dispose();
    return null;
  } finally {
    rest();
    for (const node of keyed) freshWorld(node);
  }
}
