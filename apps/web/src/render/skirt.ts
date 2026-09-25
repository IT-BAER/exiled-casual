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
  /** Previous solver-frame endpoints, for continuous collision detection. */
  previousA?: Vector3;
  previousB?: Vector3;
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
 * Catch-up after a hitch, in steps. 100ms of wall clock: the ceiling exists so a
 * background tab resumes rather than fast-forwards, but every frame UNDER it
 * must simulate its full delta — at the old 50ms a 12 fps game dropped 30ms of
 * cloth time per frame, running the coat in slow motion against full-speed legs,
 * which read as the robe glitching whenever the frame rate dipped
 * (skirt.test.ts pins 12 fps and 60 fps to the same hem).
 */
const MAX_STEPS = 24;

/** Steps that used to happen in the time one now does; keeps the tuning below. */
const PER_OLD_STEP = FIXED_STEP * 60;

/**
 * Velocity kept per step. Lower is heavier, wetter cloth.
 *
 * Written as the value tuned against a 1/60 step and rescaled, so the cloth
 * keeps exactly the per-second feel it was tuned for at any step rate: a factor
 * applied four times as often has to be four times as gentle, or raising the
 * rate would silently starch the coat.
 *
 * This is the frequency knob, and it is the one that fixes rubber. Raising the
 * escape speed to 24 gave the coat the travel it needed and made it ring: over
 * the captured run the hem reversed direction on 0.6% of chain-frames against
 * 0.3% for the old stiff coat, which is what "flutters too quick" measures as.
 * Nothing else moved it — absorption between 0.3 and 0.6 changes the reversal
 * rate not at all, and stiffness only trades swing for penetration. Damping
 * 0.9 -> 0.75 halves the reversals back to the stiff coat's number and cuts
 * per-frame hem jitter 0.047 -> 0.033, while frames showing more than 2cm of
 * leg *improve* 4.7% -> 2.0%: a heavier hem that is shoved aside stays aside.
 *
 * 0.75 and not lower because the mean offset from the bind pose keeps climbing
 * past it (0.33 at 0.9, 0.38 at 0.75, 0.53 at 0.6) and that number is lag, not
 * swing — below 0.75 the coat visibly trails the body instead of hanging on it.
 */
const DAMPING = 0.75 ** PER_OLD_STEP;
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
 * leg can push a panel, so it caps how much of a collision is allowed to show,
 * and the two walls sit close together. At 50 degrees and below a knee runs out
 * of travel mid-stride and the coat stops moving while the leg keeps going:
 * skirt.test.ts measures 0.107 of leg through the cloth against a 0.02 ceiling.
 * At 70 an open hip panel reaches 78 degrees off vertical at a run and reads as
 * a flat plank instead of a swinging panel; 55 holds it to 67.
 */
const MAX_DEVIATION = Math.cos((55 * Math.PI) / 180);

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
 * Once the escape speed above was right this knob stopped mattering: swept
 * against the captured run at 0.3, 0.4, 0.5 and 0.6 it moves frames showing
 * more than 2cm of leg by less than the noise between neighbouring cells, and
 * moves hem jitter not at all. It is kept at the low end of that window because
 * the failure at the top is sharp and known — at 1.0 the cloth keeps none of
 * the limb's momentum, rides *inside* it, and every frame reports contact.
 */
const CONTACT_ABSORB = 0.3;

/**
 * How far neighbouring chains may drift apart, as a multiple of their bind
 * spacing.
 *
 * The chains are what the cloth is skinned to, and until this existed nothing
 * held one to the ones beside it: each was an independent whip sharing only a
 * similar anchor. A knee spending the whole escape cap on one column moved its
 * neighbours not at all, and the surface drawn between them stretched into the
 * shards the robe showed at a sprint. Instrumented on the rig over a run cycle,
 * the hem's neighbour spacing ran to 20.5x its bind spacing, p90 6.6x, with
 * 51.6% of chain-pairs past 1.5x.
 *
 * Not 1.0, because a skirt legitimately opens: the hem's radius goes 0.345 ->
 * 0.747 through a run stride, and a ring flaring uniformly widens every gap in
 * the same proportion.
 *
 * 3.5 is where the two symptoms stop trading. Tighter is visibly tidier cloth
 * and buys it back in the thing the escape speed above was raised to fix: swept
 * against a thigh at the measured 18 units/s, penetration is flat at the
 * no-hoop 0.015 all the way down to 3.5 and then climbs - 0.029 at 3, 0.041 at
 * 2.5, 0.052 at 2 - past the 2cm a leg reads as showing through. 4 takes the
 * hem's neighbour spacing from 20.5x to 6.5x worst and 6.6x to 3.9x at p90,
 * which is the shards gone, for no leg at all. 3.5 is the last half-step before
 * that wall and it is free: over 30 frames of a run the worst gap around the
 * ring is unchanged (0.344 -> 0.363) but the ring is twice as even, worst
 * neighbour spacing against tightest falling 31.1x to 13.8x.
 *
 * Stretch only. Cloth gathers when it folds inward, so a pair closer than its
 * bind spacing is left alone.
 */
export const HOOP_STRETCH = 3.5;

/**
 * Share of a particle's offset from its bind pose that it takes from its two
 * neighbours per step, one half each side.
 *
 * The robe is skinned across two neighbouring columns, so wherever their hems
 * disagree by more than the gap between them the cloth drawn between them folds
 * over itself and shows its back: the torn hem at a run. The hoop above only
 * caps how far apart they drift. A leg drove single columns, and over a captured
 * run the ember robe showed ~720 of its 4710 skirt triangles folded per frame.
 * Swinging every column the same way left 87, so the tearing is disagreement
 * between columns, not the swing itself.
 *
 * A column a limb touched in the previous step is left where the limb put it:
 * smoothed back toward its neighbours it is pulled into the leg (frames with
 * more than 2cm of leg rose 27.5% -> 40%). Pinned, its neighbours move toward
 * it instead, the panel clears the leg early, and the same replay fell to 17.9%
 * while the folded triangles fell to ~210.
 */
const SHEET = 0.5;

const scratch = new Vector3();
const scratchPerp = new Vector3();
const scratchNear = new Vector3();
const scratchSample = new Vector3();
const scratchSweepA = new Vector3();
const scratchSweepB = new Vector3();

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
  /**
   * Last frame's pose, and the per-substep interpolation between it and this
   * frame's. The colliders learned this lesson first (`previousA`/`previousB`):
   * a substep must see the pose AT its moment, not the end of the frame — fed
   * the end pose, every substep of a long frame yanks the cloth toward a target
   * that teleported a whole frame's travel, and the robe glitches exactly when
   * the frame rate drops.
   */
  private readonly anchorsPrev: Vector3[];
  private readonly restsPrev: Vector3[];
  private readonly anchorsMid: Vector3[];
  private readonly restsMid: Vector3[];
  private readonly segment: number;
  private readonly perChain: number;
  /** Each particle's offset from its bind pose, and the smoothed one; see `sheet`. */
  private readonly offsets: Vector3[];
  private readonly smoothed: Vector3[];
  private carry = 0;
  private settled = false;

  constructor(chains: number, joints: number, segment: number) {
    this.segment = segment;
    this.perChain = joints;
    this.points = Array.from({ length: chains * joints }, () => new Vector3());
    this.previous = Array.from({ length: chains * joints }, () => new Vector3());
    this.anchors = Array.from({ length: chains }, () => new Vector3());
    this.anchorsPrev = Array.from({ length: chains }, () => new Vector3());
    this.anchorsMid = Array.from({ length: chains }, () => new Vector3());
    this.restsPrev = Array.from({ length: chains * joints }, () => new Vector3());
    this.restsMid = Array.from({ length: chains * joints }, () => new Vector3());
    this.budget = new Float64Array(chains * joints);
    this.offsets = Array.from({ length: chains * joints }, () => new Vector3());
    this.smoothed = Array.from({ length: chains * joints }, () => new Vector3());
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
    for (let i = 0; i < this.anchors.length; i++) {
      this.anchors[i]!.copyFrom(anchors[i]!);
      this.anchorsPrev[i]!.copyFrom(anchors[i]!);
    }
    for (let i = 0; i < this.restsPrev.length; i++) this.restsPrev[i]!.copyFrom(rests[i]!);
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
    const steps = Math.floor(this.carry / FIXED_STEP);
    this.carry -= steps * FIXED_STEP;
    for (let step = 0; step < steps; step++) {
      const sweepStart = step / steps;
      const sweepEnd = (step + 1) / steps;
      // The pose AT this substep's moment, not the end of the frame — the same
      // sweep the colliders get. See `anchorsPrev`.
      for (let i = 0; i < this.anchorsMid.length; i++) {
        Vector3.LerpToRef(this.anchorsPrev[i]!, anchors[i]!, sweepEnd, this.anchorsMid[i]!);
      }
      for (let i = 0; i < this.restsMid.length; i++) {
        Vector3.LerpToRef(this.restsPrev[i]!, rests[i]!, sweepEnd, this.restsMid[i]!);
      }
      this.integrate(this.restsMid);
      for (let pass = 0; pass < ITERATIONS; pass++) this.constrain(this.anchorsMid, this.restsMid);
      this.sheet(this.restsMid);
      this.budget.fill(MAX_CONTACT_PUSH);
      for (let contact = 0; contact < COLLIDE_PASSES; contact++) {
        if (!this.collide(this.anchorsMid, colliders, sweepStart, sweepEnd)) break;
      }
      this.collide(this.anchorsMid, colliders, sweepStart, sweepEnd);
    }
    if (steps > 0) {
      // A dt too small to step keeps its previous pose, so the motion is swept
      // next frame rather than dropped.
      for (let i = 0; i < this.anchorsPrev.length; i++) this.anchorsPrev[i]!.copyFrom(anchors[i]!);
      for (let i = 0; i < this.restsPrev.length; i++) this.restsPrev[i]!.copyFrom(rests[i]!);
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

  /**
   * Pull each particle's offset from its bind pose toward its neighbours', so
   * the columns move as one sheet (`SHEET`). Runs after the length pass and
   * before collision, which keeps the last word; `budget` still holds the
   * previous step's contacts here. Moves `previous` too, so it adds no velocity.
   */
  private sheet(rests: readonly Vector3[]): void {
    const chains = this.anchors.length;
    if (chains < 3) return;
    const n = this.perChain;
    for (let i = 0; i < this.points.length; i++) {
      this.offsets[i]!.copyFrom(this.points[i]!).subtractInPlace(rests[i]!);
    }
    for (let chain = 0; chain < chains; chain++) {
      const left = ((chain + chains - 1) % chains) * n;
      const right = ((chain + 1) % chains) * n;
      for (let j = 0; j < n; j++) {
        const i = chain * n + j;
        const out = this.smoothed[i]!.copyFrom(this.offsets[i]!);
        if (this.budget[i]! < MAX_CONTACT_PUSH) continue;
        out.scaleInPlace(1 - SHEET)
          .addInPlace(scratch.copyFrom(this.offsets[left + j]!).scaleInPlace(SHEET / 2))
          .addInPlace(scratch.copyFrom(this.offsets[right + j]!).scaleInPlace(SHEET / 2));
      }
    }
    for (let i = 0; i < this.points.length; i++) {
      scratch.copyFrom(this.smoothed[i]!).subtractInPlace(this.offsets[i]!);
      this.points[i]!.addInPlace(scratch);
      this.previous[i]!.addInPlace(scratch);
    }
  }

  /** Hold each segment at its baked length, and inside its cone. */
  private constrain(anchors: readonly Vector3[], rests: readonly Vector3[]): void {
    this.hoop(rests);
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
   * Hold neighbouring chains within `HOOP_STRETCH` of their bind spacing.
   *
   * Along a chain the segments hold each other; across the ring nothing did, and
   * the cloth is DRAWN between the chains. This is the only thing that makes the
   * ring a surface rather than a row of whips that happen to hang side by side.
   *
   * The pair's own bind spacing, not a single number: the ring is not evenly
   * spaced, and a look with a slit has one pair that is far apart by design.
   * Stretch only, so cloth is free to gather when it folds inward. Runs before
   * the length pass, which has the last word on how long a segment is - what
   * survives from here is the direction the pull gave it.
   */
  private hoop(rests: readonly Vector3[]): void {
    const chains = this.anchors.length;
    if (chains < 2) return;
    const n = this.perChain;
    for (let chain = 0; chain < chains; chain++) {
      const beside = (chain + 1) % chains;
      for (let j = 0; j < n; j++) {
        const i = chain * n + j;
        const k = beside * n + j;
        const here = this.points[i]!;
        const there = this.points[k]!;
        const limit = Vector3.Distance(rests[i]!, rests[k]!) * HOOP_STRETCH;
        scratch.copyFrom(there).subtractInPlace(here);
        const apart = scratch.length();
        if (apart <= limit || apart < 1e-6) continue;
        scratch.scaleInPlace((apart - limit) / apart / 2);
        here.addInPlace(scratch);
        there.subtractInPlace(scratch);
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
  private collide(
    anchors: readonly Vector3[],
    colliders: readonly SkirtCollider[],
    sweepStart: number,
    sweepEnd: number,
  ): boolean {
    const n = this.perChain;
    let moved = false;
    for (let chain = 0; chain < this.anchors.length; chain++) {
      for (let j = 0; j < n; j++) {
        const i = chain * n + j;
        const base = j === 0 ? anchors[chain]! : this.points[i - 1]!;
        if (this.collideSegment(
          base, this.points[i]!, this.previous[i]!, i, colliders, sweepStart, sweepEnd,
        )) moved = true;
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
    sweepStart: number,
    sweepEnd: number,
  ): boolean {
    let moved = false;
    for (const collider of colliders) {
      if (this.budget[index]! <= 0) return moved;
      const previousA = collider.previousA ?? collider.a;
      const previousB = collider.previousB ?? collider.b;
      const travel = Math.max(
        Vector3.Distance(previousA, collider.a),
        Vector3.Distance(previousB, collider.b),
      ) * (sweepEnd - sweepStart);
      // Keep adjacent temporal samples closer than half the collision radius.
      // A limb cannot jump completely over the cloth between two such samples.
      const sweepSteps = Math.min(
        32,
        Math.max(1, Math.ceil(travel / Math.max(collider.radius * 0.5, 1e-3))),
      );
      for (let sweep = 0; sweep <= sweepSteps; sweep++) {
        if (this.budget[index]! <= 0) return moved;
        const alpha = sweepStart + (sweep / sweepSteps) * (sweepEnd - sweepStart);
        Vector3.LerpToRef(previousA, collider.a, alpha, scratchSweepA);
        Vector3.LerpToRef(previousB, collider.b, alpha, scratchSweepB);

        // Closest approach of the two segments outright, rather than sampling
        // points along the cloth: any fixed spatial samples leave gaps.
        const t = closestOnSegment(base, end, scratchSweepA, scratchSweepB, scratchNear);
        scratchSample.copyFrom(end).subtractInPlace(base).scaleInPlace(t).addInPlace(base);
        scratch.copyFrom(scratchSample).subtractInPlace(scratchNear);

        const distance = scratch.length();
        if (distance >= collider.radius) continue;
        if (distance < 1e-6) {
          scratch.copyFrom(base).subtractInPlace(scratchSweepA);
          scratch.y = 0;
          if (scratch.lengthSquared() < 1e-12) scratch.set(1, 0, 0);
          else scratch.normalize();
        }
        const reach = Math.max(t, MIN_CONTACT);
        const push = Math.min((collider.radius - distance) / reach, this.budget[index]!);
        this.budget[index] = this.budget[index]! - push;
        scratch.scaleInPlace(distance < 1e-6 ? push : push / distance);
        end.addInPlace(scratch);
        previous.addInPlace(scratch.scaleInPlace(CONTACT_ABSORB));
        moved = true;
      }
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
