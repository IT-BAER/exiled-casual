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
 *
 * Fast enough to outrun the display, which is the whole reason for the number.
 * At 1/60 against a 165 Hz monitor the solver ran on barely a third of the
 * frames: on the other two the legs advanced and the cloth did not move at all,
 * so a knee slid into stationary cloth and the coat popped out afterwards.
 * Measured over a jog, frames that skipped the solve were three times as likely
 * to have a particle inside a leg as frames that ran it. Collision only happens
 * inside a step, so the step rate *is* how often the coat is allowed to notice a
 * leg.
 */
const FIXED_STEP = 1 / 240;
/**
 * Catch-up after a hitch, in steps. Held at the same 50ms of wall clock the 1/60
 * solver allowed, so a background tab still resumes rather than fast-forwards.
 */
const MAX_STEPS = 12;

/** Steps that used to happen in the time one now does; keeps the tuning below. */
const PER_OLD_STEP = FIXED_STEP * 60;

/**
 * Velocity kept per step. Lower is heavier, wetter cloth.
 *
 * Written as the value tuned against a 1/60 step and rescaled, so the cloth
 * keeps exactly the per-second feel it was tuned for at any step rate: a factor
 * applied four times as often has to be four times as gentle, or raising the
 * rate would silently starch the coat.
 */
const DAMPING = 0.9 ** PER_OLD_STEP;
/**
 * Pull toward the bind pose per step. Higher is starched: at 0.14 the coat held
 * a rigid bell through a whole jog and only translated, which is the same
 * complaint as the skinned version wearing a softer face. 0.09 was still stiff
 * once the legs stopped caging it (see `SKIRT_COLLIDERS`) — with the cloth free
 * to swing, the spring is what decides how much it does. Rescaled like the
 * damping above: it is the error that survives a step that compounds.
 *
 * 0.06 bought its tidiness by not moving: over a captured run cycle the hem sat
 * a mean 0.11 off its bind pose, which is the "stiff" complaint measured. This
 * is the one knob that trades the two symptoms against each other rather than
 * fixing both — at 24 units/s of escape speed and three joints, dropping it
 * moves the hem 0.11 -> 0.20 -> 0.29 -> 0.35 (0.06, 0.03, 0.015, 0.01) and
 * costs frames showing more than 2cm of leg 1.7% -> 4.3% -> 3.7% -> 4.0%.
 * 0.015 is the far end of that curve: 2.7x the swing for the least penetration
 * of any setting soft enough to read as cloth.
 */
const STIFFNESS = 1 - (1 - 0.015) ** PER_OLD_STEP;
/** Length-constraint passes. Two is visibly stretchy at a sprint, three is not. */
const ITERATIONS = 3;

/**
 * Collision passes per step.
 *
 * One pass resolves each limb against the *current* cloth, in order, so the last
 * capsule applied can shove a particle back into one an earlier capsule had
 * already cleared. The coat hangs between two legs, which is exactly that pinch.
 * A second pass answers it and is worth having: frames showing more than 2cm of
 * leg fall from 3.2% to 1.7%.
 *
 * Two and no more, because passes do not buy escape *travel* — `budget` below is
 * shared across them on purpose. A sweep that let each pass spend the full push
 * cap looked like it was solving the problem and was really just raising the
 * speed limit eight-fold; once the budget was shared, everything past the second
 * pass was noise. It is also cheap: `collide` reports whether it moved anything
 * and the loop stops on the first quiet pass, so a frame with no leg near the
 * cloth — most of them — pays for exactly one.
 */
const COLLIDE_PASSES = 2;

/**
 * How far a segment may swing off its bind direction. This is the coat's body:
 * without it the chains fold up over the hips at a sprint and the character
 * appears to be wearing an umbrella. It is also the hard ceiling on how far a
 * leg can push a panel, so it caps how much of a collision is allowed to show:
 * at 50 degrees a knee driving into the cloth ran out of travel mid-stride and
 * the coat stopped moving while the leg kept going.
 */
const MAX_DEVIATION = Math.cos((70 * Math.PI) / 180);

/**
 * An anchor jump this big in one step is a teleport, not a stride — respawn, or
 * a portal. The cloth is snapped home rather than dragged across the map.
 */
const SNAP_DISTANCE = 1.5;

/**
 * How far along a cloth segment a contact has to be before it is allowed to move
 * the far end. A touch right at the base needs an enormous swing to clear, since
 * the end travels 1/t as far as the contact does; below this the segment is
 * treated as pinned there and the joint above deals with it.
 */
const MIN_CONTACT = 0.25;

/**
 * How fast, in units per second, a contact is allowed to move cloth.
 *
 * The push out of a limb is a positional correction, and the divide by `t`
 * above means one landing near the base is multiplied by four. Unbounded, that
 * put half a unit of travel into a single 1/240 step — a third of the
 * character's height, in 4ms. Nothing about a leg justifies that speed, and the
 * eye reads the snap-and-return as rubber rather than as contact.
 *
 * The number this was first set from — "a limb tops out around 3 units/s at a
 * sprint" — was a guess, and it was wrong by six-fold. Instrumenting the real
 * rig over a run cycle puts a joint at 18 units/s, so a cloth escape speed of 6
 * meant the leg simply outran the only mechanism that could get the coat out of
 * its way, and walked through it instead. This is the single biggest term in the
 * whole file: at three joints, frames showing more than 2cm of leg go 16.6% ->
 * 6.0% -> 3.8% -> 2.3% as it goes 6 -> 12 -> 18 -> 24.
 *
 * 24 and not more. It is the measured limb speed plus a third, which is the most
 * the evidence supports; the rubber this bound exists to prevent is real, and
 * `skirt.test.ts` still pins the hem to a bounded travel per step.
 */
const MAX_CONTACT_SPEED = 24;
/** Travel one particle may be given by contact in one step, shared by the passes. */
export const MAX_CONTACT_PUSH = MAX_CONTACT_SPEED * FIXED_STEP;

/**
 * How much of a contact push is taken out of the cloth's velocity again.
 *
 * Moving only `end` makes the push an impulse — in Verlet the gap between the
 * two positions *is* the velocity — so every touch fired the cloth off the limb
 * and the bind spring hauled it back: ringing, which is the rubber. Moving
 * `previous` the whole way instead costs nothing and looks worse, because then
 * a leg imparts no momentum at all: the cloth is nudged aside, springs straight
 * back, and rides *inside* the limb. Swept against a sweeping thigh, full
 * absorption left a particle 0.120 deep against a 0.12 collider and in contact
 * three times as often as half absorption. Half keeps enough of the leg's
 * motion for the cloth to stay ahead of it without being thrown by it.
 *
 * Half turned out to be more than the cloth needs once the escape speed above
 * was right: over the captured run it costs frames showing more than 2cm of leg
 * 25.5% against 19.5% at a quarter, for no loss of swing. Full absorption is
 * still wrong for the reason it always was — at 1.0 every frame reports contact
 * and the mean depth quadruples.
 */
const CONTACT_ABSORB = 0.25;

const scratch = new Vector3();
const scratchPerp = new Vector3();
const scratchNear = new Vector3();
const scratchSample = new Vector3();

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

const scratchD1 = new Vector3();
const scratchD2 = new Vector3();
const scratchR = new Vector3();

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Closest approach between the segment `p1`->`q1` and the segment `p2`->`q2`.
 *
 * Returns how far along the first segment that happens, and writes the matching
 * point on the second into `out`. Standard segment-segment solve: the pair of
 * parameters is found for the infinite lines, then each is clamped back onto its
 * own segment and the other re-solved against the clamped one, which is what
 * makes a parallel or degenerate pair behave.
 */
function closestOnSegment(
  p1: Vector3,
  q1: Vector3,
  p2: Vector3,
  q2: Vector3,
  out: Vector3,
): number {
  scratchD1.copyFrom(q1).subtractInPlace(p1);
  scratchD2.copyFrom(q2).subtractInPlace(p2);
  scratchR.copyFrom(p1).subtractInPlace(p2);

  const a = Vector3.Dot(scratchD1, scratchD1);
  const e = Vector3.Dot(scratchD2, scratchD2);
  const f = Vector3.Dot(scratchD2, scratchR);

  let s = 0;
  let t = 0;
  if (a < 1e-12 && e < 1e-12) {
    out.copyFrom(p2);
    return 0;
  }
  if (a < 1e-12) {
    t = clamp01(f / e);
  } else {
    const c = Vector3.Dot(scratchD1, scratchR);
    if (e < 1e-12) {
      s = clamp01(-c / a);
    } else {
      const b = Vector3.Dot(scratchD1, scratchD2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  out.copyFrom(p2).addInPlace(scratchD2.scaleInPlace(t));
  return s;
}

/**
 * The cloth state of one character's coat.
 *
 * World-space throughout: solving in the character's own frame would be cheaper
 * and completely inert, because in that frame the character never moves and
 * there is no inertia to lag behind.
 */
export class SkirtSim {
  /** Particle positions, `joints` per chain, chain-major and top-down. */
  private readonly points: Vector3[];
  private readonly previous: Vector3[];
  private readonly anchors: Vector3[];
  /**
   * Contact travel already spent by each particle this step. The push cap is a
   * speed limit, so iterating to resolve two limbs at once must not buy the
   * cloth extra travel: the passes share one budget instead of each taking one.
   */
  private readonly budget: Float64Array;
  private readonly segment: number;
  private readonly perChain: number;
  private carry = 0;
  private settled = false;

  constructor(chains: number, joints: number, segment: number) {
    this.segment = segment;
    this.perChain = joints;
    this.points = Array.from({ length: chains * joints }, () => new Vector3());
    this.previous = Array.from({ length: chains * joints }, () => new Vector3());
    this.anchors = Array.from({ length: chains }, () => new Vector3());
    this.budget = new Float64Array(chains * joints);
  }

  /** Particles per chain. One more joint is one more place the cloth may fold. */
  get joints(): number {
    return this.perChain;
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
      this.budget.fill(MAX_CONTACT_PUSH);
      for (let pass = 0; pass < COLLIDE_PASSES; pass++) {
        if (!this.collide(anchors, colliders)) break;
      }
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
    const n = this.perChain;
    for (let chain = 0; chain < this.anchors.length; chain++) {
      // Top down: each joint is placed against the one above it, which this
      // pass has already put where it belongs.
      for (let j = 0; j < n; j++) {
        const i = chain * n + j;
        const base = j === 0 ? anchors[chain]! : this.points[i - 1]!;
        // The anchor is its own rest position — the body drives it — so it is
        // both the live base and the bind-pose base for the first segment.
        const restBase = j === 0 ? anchors[chain]! : rests[i - 1]!;
        this.place(this.points[i]!, base, rests[i]!, restBase);
      }
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

  /**
   * Push the cloth out of the limbs.
   *
   * The cloth is tested as segments, not as its two particles. A particle test
   * only knows about the cloth at two heights — the joint and the hem — and a
   * knee sits squarely between them, so it drove straight through the surface
   * that is drawn between the two while both endpoints reported themselves
   * clear. Sampling along each segment is the same lesson the collider side
   * already learned: a limb is a segment, and so is the cloth hanging past it.
   */
  private collide(anchors: readonly Vector3[], colliders: readonly SkirtCollider[]): boolean {
    const n = this.perChain;
    let moved = false;
    for (let chain = 0; chain < this.anchors.length; chain++) {
      for (let j = 0; j < n; j++) {
        const i = chain * n + j;
        const base = j === 0 ? anchors[chain]! : this.points[i - 1]!;
        if (this.collideSegment(base, this.points[i]!, this.previous[i]!, i, colliders)) moved = true;
      }
    }
    return moved;
  }

  /**
   * Move `end` until nothing along `base` -> `end` is inside a collider.
   *
   * Only the far end moves: the base is either the waist, which the body owns,
   * or the joint above, which this has already handled. A penetration found part
   * way along is therefore fixed by swinging the segment about its base, which
   * takes a bigger move at the end than at the sample — hence the divide by `t`.
   *
   * That divide is also why the push is bounded and partly absorbed: see
   * `MAX_CONTACT_PUSH` and `CONTACT_ABSORB`. Left raw, a touch near the base was
   * multiplied by four and went straight into the Verlet velocity, moving the
   * hem half a unit in one 4ms step and ringing afterwards. That is the rubber.
   */
  private collideSegment(
    base: Vector3,
    end: Vector3,
    previous: Vector3,
    index: number,
    colliders: readonly SkirtCollider[],
  ): boolean {
    let moved = false;
    for (const collider of colliders) {
      if (this.budget[index]! <= 0) return moved;
      // Closest approach of the two segments outright, rather than sampling
      // points along the cloth: any fixed set of samples leaves gaps between
      // them exactly the size of the thing being kept out, which is how a knee
      // gets through in the first place.
      const t = closestOnSegment(base, end, collider.a, collider.b, scratchNear);
      scratchSample.copyFrom(end).subtractInPlace(base).scaleInPlace(t).addInPlace(base);
      scratch.copyFrom(scratchSample).subtractInPlace(scratchNear);

      const distance = scratch.length();
      if (distance >= collider.radius) continue;
      // Exactly on the axis gives no direction to push along. Measure-zero,
      // and the next frame of body motion moves one of the two off it.
      if (distance < 1e-6) continue;
      const reach = Math.max(t, MIN_CONTACT);
      const push = Math.min((collider.radius - distance) / reach, this.budget[index]!);
      this.budget[index]! -= push;
      scratch.scaleInPlace(push / distance);
      end.addInPlace(scratch);
      previous.addInPlace(scratch.scaleInPlace(CONTACT_ABSORB));
      moved = true;
    }
    return moved;
  }

  /** Unit direction of a chain's `segment`-th bone, counting down from the waist. */
  direction(chain: number, segment: number, anchor: Vector3, out: Vector3): Vector3 {
    const i = chain * this.perChain + segment;
    const base = segment === 0 ? anchor : this.points[i - 1]!;
    out.copyFrom(this.points[i]!).subtractInPlace(base);
    const length = out.length();
    if (length < 1e-6) return out.set(0, -1, 0);
    return out.scaleInPlace(1 / length);
  }
}
