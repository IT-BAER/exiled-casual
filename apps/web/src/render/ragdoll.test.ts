import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core";
import {
  CORPSE_SECONDS, DEATH_SPEED, SINK_SECONDS, sinkDepth, throwBody, trunkIndex,
} from "./ragdoll";

describe("corpse sink", () => {
  it("starts at the floor and ends deep enough to swallow a body", () => {
    expect(sinkDepth(0)).toBe(0);
    expect(sinkDepth(1)).toBeGreaterThanOrEqual(1.5);
  });

  it("creeps at the start", () => {
    // The moment the body first moves is the one that is seen; a linear sink
    // would already be a quarter under by here.
    expect(sinkDepth(0.25)).toBeLessThan(sinkDepth(1) * 0.25);
  });

  it("never rises", () => {
    for (let t = 0; t < 1; t += 0.05) {
      expect(sinkDepth(t + 0.05)).toBeGreaterThan(sinkDepth(t));
    }
  });

  it("clamps outside the window", () => {
    expect(sinkDepth(-1)).toBe(0);
    expect(sinkDepth(2)).toBe(sinkDepth(1));
  });

  it("throws the body at a speed a body could be thrown at", () => {
    // Every box takes this velocity change, so it is the speed the whole corpse
    // leaves with. Below a walking pace the fall is gravity alone and every
    // death is the same shape; above a sprint the corpse is launched.
    expect(DEATH_SPEED).toBeGreaterThan(1.5);
    expect(DEATH_SPEED).toBeLessThan(6);
  });

  it("leaves the body lying still far longer than the sink takes", () => {
    expect(CORPSE_SECONDS).toBeGreaterThan(SINK_SECONDS * 4);
  });
});

describe("the killing blow", () => {
  it("lands on the trunk, not on the root marker between the feet", () => {
    // Skeleton order, both packs: the top bone comes first and it is not a body
    // part. Aggregate 0 is therefore a 0.08 marker at the character's origin.
    expect(trunkIndex(["root", "pelvis", "spine_02", "thigh_l"])).toBe(1);
    expect(trunkIndex(["armature", "body_0", "body_1", "leg1_0"])).toBe(1);
    expect(trunkIndex(["body_0", "leg1_0"])).toBe(0);
    expect(trunkIndex(["nothing", "recognisable"])).toBe(0);
  });

  it("moves every box, because they are jointed to each other", () => {
    // One box carrying the whole blow drags the other fifteen along by their
    // constraints, and the corpse leaves at a sixteenth of the speed: gravity
    // wins and the body drops on the spot. This is the bug.
    const bodies = fakeBodies(4);
    throwBody(bodies, 1, new Vector3(0, 0, 1), new Vector3(0, 0.65, 0));

    for (const b of bodies) expect(b.moved).toBe(true);
  });

  it("gives the trunk its share off the centre line, so the body turns", () => {
    const bodies = fakeBodies(3);
    const at = new Vector3(0.3, 0.65, 0);
    throwBody(bodies, 1, new Vector3(0, 0, 1), at);

    expect(bodies[1]!.at).toBe(at);
    // The rest is pure translation: an impulse at each own centre spins nothing,
    // and sixteen boxes each spinning about a shared point is a shredded corpse.
    expect(bodies[0]!.at).toBeNull();
    expect(bodies[2]!.at).toBeNull();
  });
});

function fakeBodies(n: number): FakeBody[] {
  return Array.from({ length: n }, () => new FakeBody());
}

class FakeBody {
  moved = false;
  at: Vector3 | null = null;
  private velocity = Vector3.Zero();
  applyImpulse(impulse: Vector3, at: Vector3): void {
    this.moved = impulse.lengthSquared() > 0;
    this.at = at;
  }
  getLinearVelocity(): Vector3 { return this.velocity; }
  setLinearVelocity(v: Vector3): void {
    this.velocity = v;
    this.moved = v.lengthSquared() > 0;
  }
}
