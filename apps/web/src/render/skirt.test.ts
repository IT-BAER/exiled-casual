// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Vector3 } from "@babylonjs/core";
import { SkirtSim } from "./skirt";

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
    const sim = new SkirtSim(1, SEGMENT);
    run(sim, 0, 120);
    expect(tip(sim, 0).subtract(pose(0).rests[1]!).length()).toBeLessThan(1e-6);
  });

  it("lags behind the body it hangs off, then catches up", () => {
    const sim = new SkirtSim(1, SEGMENT);
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
    const sim = new SkirtSim(1, SEGMENT);
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

  it("snaps home on a teleport instead of streaking across the map", () => {
    const sim = new SkirtSim(1, SEGMENT);
    run(sim, 0, 30);
    run(sim, 40, 1);
    expect(tip(sim, 40).subtract(pose(40).rests[1]!).length()).toBeLessThan(1e-6);
  });

  it("reports unit directions, so a joint can be aimed down one", () => {
    const sim = new SkirtSim(1, SEGMENT);
    run(sim, 0, 30);
    const anchor = pose(0).anchors[0]!;
    for (const segment of [0, 1]) {
      const dir = sim.direction(0, segment, anchor, new Vector3());
      expect(dir.length()).toBeCloseTo(1, 6);
      expect(dir.y).toBeLessThan(0);
    }
  });
});
