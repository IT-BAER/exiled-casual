import { Vector3 } from "@babylonjs/core";

/**
 * Secondary motion for the coat: a ring of two-particle chains hung off the
 * character's waist and solved in world space, so the cloth lags the body that
 * carries it.
 *
 * The coat used to be skinned to the thighs, which is the obvious thing to do
 * and looks wrong for a structural reason: a thigh rotation is rigid about the
 * hip, so the hem swept a wide arc exactly in phase with the knee and the coat
 * read as two stiff blades. Nothing a clip drives can lag, and lag is most of
 * what makes cloth look like cloth.
 *
 * There is no gravity term here on purpose. The bind pose is already the shape
 * the coat should have standing still, so the resting force is a spring toward
 * *that* rather than toward straight down: the coat keeps its authored flare
 * instead of collapsing into a tube, and there is one fewer constant to tune
 * against a character who is only about 1.8 units tall. All the motion comes
 * from the anchor moving out from under particles that have inertia.
 */

/**
 * A capsule the cloth is pushed out of: the swept sphere between `a` and `b`.
 *
 * Spheres at the joints were the first attempt and left the leg full of holes —
 * a knee ball and an ankle ball with nothing over the shin between them, which
 * is precisely the height the hem hangs at, so a stride put the boot straight
 * through the coat. A limb is a segment, so the collider is one too.
 */
export interface SkirtCollider {
  a: Vector3;
  b: Vector3;
  radius: number;
}

/**
 * Solved at a fixed rate, because Verlet integration with a variable step
 * changes stiffness with the frame rate: a hitch would fling the hem.
 */
const FIXED_STEP = 1 / 60;
/** Frames of catch-up after a hitch. Beyond this the cloth just skips ahead. */
const MAX_STEPS = 3;

/** Velocity kept per step. Lower is heavier, wetter cloth. */
const DAMPING = 0.9;
/**
 * Pull toward the bind pose per step. Higher is starched: at 0.14 the coat held
 * a rigid bell through a whole jog and only translated, which is the same
 * complaint as the skinned version wearing a softer face.
 */
const STIFFNESS = 0.09;
/** Length-constraint passes. Two is visibly stretchy at a sprint, three is not. */
const ITERATIONS = 3;

/**
 * How far a segment may swing off its bind direction. This is the coat's body:
 * without it the chains fold up over the hips at a sprint and the character
 * appears to be wearing an umbrella.
 */
const MAX_DEVIATION = Math.cos((50 * Math.PI) / 180);

/**
 * An anchor jump this big in one step is a teleport, not a stride — respawn, or
 * a portal. The cloth is snapped home rather than dragged across the map.
 */
const SNAP_DISTANCE = 1.5;

const scratch = new Vector3();
const scratchPerp = new Vector3();
const scratchAxis = new Vector3();
const scratchNear = new Vector3();

/**
 * Rotate `dir` toward `rest` until it is within `cosLimit` of it. Both are unit
 * vectors; the result is written into `dir`.
 */
function clampToCone(dir: Vector3, rest: Vector3, cosLimit: number): void {
  const along = Vector3.Dot(dir, rest);
  if (along >= cosLimit) return;
  // The part of `dir` that is perpendicular to `rest` fixes which way it leans;
  // only how far it leans is being clamped.
  scratchPerp.copyFrom(dir).subtractInPlace(scratch.copyFrom(rest).scaleInPlace(along));
  const length = scratchPerp.length();
  if (length < 1e-6) {
    dir.copyFrom(rest);
    return;
  }
  scratchPerp.scaleInPlace(1 / length);
  const sinLimit = Math.sqrt(Math.max(0, 1 - cosLimit * cosLimit));
  dir.copyFrom(rest).scaleInPlace(cosLimit).addInPlace(scratchPerp.scaleInPlace(sinLimit));
}

/**
 * The cloth state of one character's coat.
 *
 * World-space throughout: solving in the character's own frame would be cheaper
 * and completely inert, because in that frame the character never moves and
 * there is no inertia to lag behind.
 */
export class SkirtSim {
  /** Particle positions, two per chain: `[mid, tip, mid, tip, …]`. */
  private readonly points: Vector3[];
  private readonly previous: Vector3[];
  private readonly anchors: Vector3[];
  private readonly segment: number;
  private carry = 0;
  private settled = false;

  constructor(chains: number, segment: number) {
    this.segment = segment;
    this.points = Array.from({ length: chains * 2 }, () => new Vector3());
    this.previous = Array.from({ length: chains * 2 }, () => new Vector3());
    this.anchors = Array.from({ length: chains }, () => new Vector3());
  }

  get chains(): number {
    return this.anchors.length;
  }

  /** Forget where the cloth was; the next step drops it onto the bind pose. */
  unsettle(): void {
    this.settled = false;
  }

  /** Drop the cloth exactly onto its bind pose, at rest. */
  snapTo(anchors: readonly Vector3[], rests: readonly Vector3[]): void {
    for (let i = 0; i < this.points.length; i++) {
      this.points[i]!.copyFrom(rests[i]!);
      this.previous[i]!.copyFrom(rests[i]!);
    }
    for (let i = 0; i < this.anchors.length; i++) this.anchors[i]!.copyFrom(anchors[i]!);
    this.carry = 0;
    this.settled = true;
  }

  /**
   * Advance the cloth. `anchors` holds each chain's waist point and `rests` the
   * bind-pose position of each particle, both in world space and both already
   * moved by whatever the animation did to the body this frame.
   */
  step(
    dt: number,
    anchors: readonly Vector3[],
    rests: readonly Vector3[],
    colliders: readonly SkirtCollider[],
  ): void {
    if (!this.settled || Vector3.Distance(this.anchors[0]!, anchors[0]!) > SNAP_DISTANCE) {
      this.snapTo(anchors, rests);
      return;
    }
    for (let i = 0; i < this.anchors.length; i++) this.anchors[i]!.copyFrom(anchors[i]!);

    // Guard against a first frame, a background tab, or a debugger pause handing
    // us a dt measured in seconds.
    this.carry = Math.min(this.carry + (dt > 0 ? dt : 0), FIXED_STEP * MAX_STEPS);
    while (this.carry >= FIXED_STEP) {
      this.carry -= FIXED_STEP;
      this.integrate(rests);
      for (let pass = 0; pass < ITERATIONS; pass++) this.constrain(anchors, rests);
      this.collide(colliders);
    }
  }

  private integrate(rests: readonly Vector3[]): void {
    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i]!;
      const previous = this.previous[i]!;
      // Verlet: the previous position *is* the velocity. Damping it here is what
      // stops a swing from ringing forever.
      scratch.copyFrom(point).subtractInPlace(previous).scaleInPlace(DAMPING);
      previous.copyFrom(point);
      point.addInPlace(scratch);
      // Spring home. The rest position has already moved with the body, so this
      // is also what drags the cloth along when the character walks.
      scratch.copyFrom(rests[i]!).subtractInPlace(point).scaleInPlace(STIFFNESS);
      point.addInPlace(scratch);
    }
  }

  /** Hold each segment at its baked length, and inside its cone. */
  private constrain(anchors: readonly Vector3[], rests: readonly Vector3[]): void {
    for (let chain = 0; chain < this.anchors.length; chain++) {
      const anchor = anchors[chain]!;
      const mid = this.points[chain * 2]!;
      const tip = this.points[chain * 2 + 1]!;
      const restMid = rests[chain * 2]!;
      const restTip = rests[chain * 2 + 1]!;

      this.place(mid, anchor, restMid, anchor);
      this.place(tip, mid, restTip, restMid);
    }
  }

  /**
   * Put `point` one segment away from `base`, in a direction clamped to the cone
   * around the bind direction that `rest` and `restBase` describe.
   */
  private place(point: Vector3, base: Vector3, rest: Vector3, restBase: Vector3): void {
    const direction = point.subtract(base);
    const length = direction.length();
    if (length < 1e-6) direction.copyFrom(rest).subtractInPlace(restBase);
    direction.normalize();

    const restDirection = rest.subtract(restBase).normalize();
    clampToCone(direction, restDirection, MAX_DEVIATION);

    point.copyFrom(base).addInPlace(direction.scaleInPlace(this.segment));
  }

  private collide(colliders: readonly SkirtCollider[]): void {
    for (const collider of colliders) {
      scratchAxis.copyFrom(collider.b).subtractInPlace(collider.a);
      const axisLength = scratchAxis.lengthSquared();
      for (const point of this.points) {
        // Nearest point on the limb's own segment, so a capsule costs one dot
        // product more than the sphere it replaces.
        scratch.copyFrom(point).subtractInPlace(collider.a);
        const along =
          axisLength < 1e-9
            ? 0
            : Math.min(1, Math.max(0, Vector3.Dot(scratch, scratchAxis) / axisLength));
        scratchNear.copyFrom(collider.a).addInPlace(
          scratchAxis.scale(along),
        );

        scratch.copyFrom(point).subtractInPlace(scratchNear);
        const distance = scratch.length();
        if (distance >= collider.radius) continue;
        // Exactly on the axis gives no direction to push along. Measure-zero,
        // and the next frame of body motion moves one of the two off it.
        if (distance < 1e-6) continue;
        point.copyFrom(scratchNear).addInPlace(
          scratch.scaleInPlace(collider.radius / distance),
        );
      }
    }
  }

  /** Unit direction of a chain's upper (`0`) or lower (`1`) segment. */
  direction(chain: number, segment: number, anchor: Vector3, out: Vector3): Vector3 {
    const base = segment === 0 ? anchor : this.points[chain * 2]!;
    out.copyFrom(this.points[chain * 2 + segment]!).subtractInPlace(base);
    const length = out.length();
    if (length < 1e-6) return out.set(0, -1, 0);
    return out.scaleInPlace(1 / length);
  }
}
