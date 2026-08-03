// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Vector3 } from "@babylonjs/core";
import { SkirtSim, MAX_CONTACT_PUSH } from "./skirt";

const SEGMENT = 0.5;
const FRAME = 1 / 60;

/** One chain hanging straight down from `x`, in its bind pose. */
function pose(x: number): { anchors: Vector3[]; rests: Vector3[] } {
  return {
    anchors: [new Vector3(x, 1, 0)],
    rests: [new Vector3(x, 1 - SEGMENT, 0), new Vector3(x, 1 - SEGMENT * 2, 0)],
  };
}

function run(sim: SkirtSim, x: number, frames: number, colliders = []): void {
  const { anchors, rests } = pose(x);
  for (let i = 0; i < frames; i++) sim.step(FRAME, anchors, rests, colliders);
}

/** Where the hem ended up. */
function tip(sim: SkirtSim, x: number): Vector3 {
  const { anchors } = pose(x);
  const upper = sim.direction(0, 0, anchors[0]!, new Vector3()).scale(SEGMENT);
  const mid = anchors[0]!.add(upper);
  return mid.add(sim.direction(0, 1, anchors[0]!, new Vector3()).scale(SEGMENT));
}

describe("SkirtSim", () => {
  it("holds the bind pose while the body is still", () => {
    // Nothing pulls the cloth off its authored shape on its own: the spring is
    // toward the bind pose, not toward straight down, so a standing character's
    // coat renders exactly as it was modelled.
    const sim = new SkirtSim(1, 2, SEGMENT);
    run(sim, 0, 120);
    expect(tip(sim, 0).subtract(pose(0).rests[1]!).length()).toBeLessThan(1e-6);
  });

  it("lags behind the body it hangs off, then catches up", () => {
    const sim = new SkirtSim(1, 2, SEGMENT);
    run(sim, 0, 30);

    // One frame of a stride. The hem must not teleport with the hips — that lag
    // is the whole reason the coat is not simply skinned to the legs.
    run(sim, 0.3, 1);
    const lag = tip(sim, 0.3).subtract(pose(0.3).rests[1]!).length();
    expect(lag).toBeGreaterThan(0.05);

    // And it has to settle, or the coat trails the character forever.
    run(sim, 0.3, 200);
    expect(tip(sim, 0.3).subtract(pose(0.3).rests[1]!).length()).toBeLessThan(1e-3);
  });

  it("is pushed off a knee that walks into it", () => {
    const sim = new SkirtSim(1, 2, SEGMENT);
    run(sim, 0, 30);

    // A shin: a segment, not a ball. It overlaps the cloth's rest position by
    // 0.03 and runs past it on both sides, so a solver that only tested the two
    // ends would find nothing. A joint cannot stretch, so escaping means
    // swinging the other way, not moving out along the push.
    const knee = {
      a: new Vector3(0.15, 1, 0),
      b: new Vector3(0.15, 1 - SEGMENT * 2, 0),
      radius: 0.18,
    };
    const { anchors, rests } = pose(0);
    for (let i = 0; i < 60; i++) sim.step(FRAME, anchors, rests, [knee]);

    const mid = anchors[0]!.add(sim.direction(0, 0, anchors[0]!, new Vector3()).scale(SEGMENT));
    expect(Math.abs(mid.x - knee.a.x)).toBeGreaterThan(knee.radius - 0.02);
    expect(mid.x).toBeLessThan(0);
  });

  it("escapes a leg that is exactly centred on the cloth", () => {
    // Idle can place a chain directly over a leg's centreline. A zero-distance
    // contact still needs a stable outward direction, otherwise the collider is
    // skipped forever and the rendered leg stays inside the robe.
    const sim = new SkirtSim(1, 2, SEGMENT);
    const { anchors, rests } = pose(0);
    const leg = {
      a: new Vector3(0, 1, 0),
      b: new Vector3(0, 0, 0),
      radius: 0.16,
    };

    for (let i = 0; i < 60; i++) sim.step(FRAME, anchors, rests, [leg]);

    const mid = anchors[0]!.add(sim.direction(0, 0, anchors[0]!, new Vector3()).scale(SEGMENT));
    expect(Math.abs(mid.x)).toBeGreaterThan(leg.radius - 0.02);
  });

  it("is pushed off a knee that touches only the middle of a panel", () => {
    // The cloth is drawn between its particles, and a knee lands squarely
    // between them: this capsule clears both ends of the lower segment (0.269
    // away) and cuts through its midpoint (0.1 against a radius of 0.11). Test
    // the two particles alone and it reports no contact at all while the leg
    // passes through the surface in plain sight.
    const sim = new SkirtSim(1, 2, SEGMENT);
    run(sim, 0, 30);

    const knee = {
      a: new Vector3(0.1, 1 - SEGMENT * 1.5, -0.3),
      b: new Vector3(0.1, 1 - SEGMENT * 1.5, 0.3),
      radius: 0.11,
    };
    const { anchors, rests } = pose(0);
    const before = tip(sim, 0);
    for (let i = 0; i < 60; i++) sim.step(FRAME, anchors, rests, [knee]);

    // Away from the limb, not merely disturbed.
    expect(tip(sim, 0).x).toBeLessThan(before.x - 0.01);
  });

  it("never flings a particle faster than a limb could carry it", () => {
    // The rubber test. A contact used to be a positional correction applied in
    // full and divided by how far along the segment it landed, so a touch near
    // the base was amplified 4x and thrown into the Verlet velocity: one step
    // moved the hem half a unit — a third of the character's height — and the
    // spring pulled it back the next. That reads as rubber, and it is the
    // complaint this bound exists to answer. A leg does not move this fast, so
    // neither may the cloth it is pushing.
    //
    // The bound is written against the solver's own speed limit rather than as a
    // number, because the limit is a tuning knob and a literal here would have to
    // be re-guessed every time it moved — which is how a guard quietly stops
    // guarding. Each bone may spend the step's whole push budget, and the hem is
    // carried by every bone above it, so `joints * MAX_CONTACT_PUSH` is the
    // geometry's ceiling. The 4x amplification this catches blew through 4x that.
    const sim = new SkirtSim(1, 2, SEGMENT);
    const { anchors, rests } = pose(0);
    const step = 1 / 240;
    for (let i = 0; i < 240; i++) sim.step(step, anchors, rests, []);

    let worst = 0;
    let previous = tip(sim, 0);
    // A thigh sweeping across the cloth low down, where the amplification bit.
    for (let i = 0; i < 240; i++) {
      const x = -0.3 + (i / 240) * 0.6;
      const leg = { a: new Vector3(x, 1, 0), b: new Vector3(x, 0.2, 0), radius: 0.12 };
      sim.step(step, anchors, rests, [leg]);
      const now = tip(sim, 0);
      worst = Math.max(worst, Vector3.Distance(now, previous));
      previous = now;
    }
    expect(worst).toBeLessThan(2 * MAX_CONTACT_PUSH);
  });

  it("keeps a leg out of the cloth at the speed a leg actually moves", () => {
    // The regression. The escape speed was set from a guess that a limb tops out
    // at 3 units/s; the instrumented rig runs one at 18, so the leg outran the
    // only mechanism that could move the coat and went through it instead — 25%
    // of frames of a captured run showed more than 2cm of leg through the cloth.
    //
    // A thigh is swept across the panel here at that measured 18 units/s, which
    // is the condition the shipped tuning failed. Penetration is measured against
    // the cloth *segments* rather than its particles, because the leg went
    // through the surface drawn between them while both ends reported clear.
    const sim = new SkirtSim(1, 2, SEGMENT);
    const { anchors, rests } = pose(0);
    const step = 1 / 240;
    for (let i = 0; i < 240; i++) sim.step(step, anchors, rests, []);

    // Below the waist, because the anchor is pinned: a capsule laid over it
    // reports a penetration no solver can fix and measures nothing. On the real
    // rig the chain ring clears the leg axis by 0.174 for exactly this reason.
    const radius = 0.11;
    const top = 0.75;
    const bottom = 0.1;
    // 18 units/s is the speed measured off the real rig, so the sweep is short:
    // 0.6 of travel at that speed is over in 33ms, which is eight solver steps.
    // Spreading the same travel across a lazier sweep is what makes this look
    // fine at any tuning — the whole defect is the leg being faster than the
    // cloth is allowed to be.
    const speed = 18;
    const steps = Math.round(0.6 / (speed * step));
    let worst = 0;
    for (let i = 0; i <= steps; i++) {
      const x = -0.3 + i * speed * step;
      const leg = { a: new Vector3(x, top, 0), b: new Vector3(x, bottom, 0), radius };
      sim.step(step, anchors, rests, [leg]);

      const mid = anchors[0]!.add(sim.direction(0, 0, anchors[0]!, new Vector3()).scale(SEGMENT));
      const end = mid.add(sim.direction(0, 1, anchors[0]!, new Vector3()).scale(SEGMENT));
      for (const [p, q] of [[anchors[0]!, mid], [mid, end]] as [Vector3, Vector3][]) {
        // Distance from the leg's axis to the nearest point of this cloth bone.
        let near = Infinity;
        for (let k = 0; k <= 40; k++) {
          const s = p.add(q.subtract(p).scale(k / 40));
          near = Math.min(near, Math.hypot(s.x - x, Math.max(0, bottom - s.y, s.y - top)));
        }
        worst = Math.max(worst, radius - near);
      }
    }
    // 2cm on a character 1.8 units tall is the point a leg reads as showing
    // through. The shipped 6 units/s left 0.05 here — half the leg's radius.
    expect(worst).toBeLessThan(0.02);
  });

  it("catches a boot that crosses the coat between solver samples", () => {
    const sim = new SkirtSim(1, 2, SEGMENT);
    const { anchors, rests } = pose(0);
    for (let i = 0; i < 30; i++) sim.step(FRAME, anchors, rests, []);

    // Both endpoint poses are clear of the hanging panel. Only the swept path
    // intersects it, matching a boot crossing a robe between rendered frames.
    const boot = {
      a: new Vector3(0.35, 0.8, -0.15),
      b: new Vector3(0.35, 0.35, 0.15),
      previousA: new Vector3(-0.35, 0.8, -0.15),
      previousB: new Vector3(-0.35, 0.35, 0.15),
      radius: 0.12,
    };
    sim.step(1 / 240, anchors, rests, [boot]);

    const displaced = tip(sim, 0);
    expect(Math.hypot(displaced.x, displaced.z)).toBeGreaterThan(0.01);
  });

  it("snaps home on a teleport instead of streaking across the map", () => {
    const sim = new SkirtSim(1, 2, SEGMENT);
    run(sim, 0, 30);
    run(sim, 40, 1);
    expect(tip(sim, 40).subtract(pose(40).rests[1]!).length()).toBeLessThan(1e-6);
  });

  it("reports unit directions, so a joint can be aimed down one", () => {
    const sim = new SkirtSim(1, 2, SEGMENT);
    run(sim, 0, 30);
    const anchor = pose(0).anchors[0]!;
    for (const segment of [0, 1]) {
      const dir = sim.direction(0, segment, anchor, new Vector3());
      expect(dir.length()).toBeCloseTo(1, 6);
      expect(dir.y).toBeLessThan(0);
    }
  });
});
