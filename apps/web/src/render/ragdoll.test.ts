import { describe, expect, it } from "vitest";
import { PhysicsConstraintType, Vector3, type Mesh, type Skeleton } from "@babylonjs/core";
import {
  CORPSE_SECONDS, DEATH_SPEED, SINK_SECONDS, configFor, dollMotion, sinkDepth, throwBody, trunkIndex,
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

describe("the joints", () => {
  it("are ball-and-socket on every box, never Babylon's default hinge", () => {
    // The default hinge turns about each box's X axis as it stood at the
    // death, whichever way the limb pointed. Measured on tide_spitter corpses:
    // 12 of 32 hinged bodies ran away (boxes at ~195 m/s, 10-20 m up at the
    // camera), 0 of 32 with ball joints.
    const config = configFor(fakeSkeleton(["root", "pelvis", "thigh_l", "armature", "body_0", "leg0_0", "arm1_0", "hand_r"]));

    expect(config.length).toBeGreaterThan(0);
    for (const box of config) expect(box.joint).toBe(PhysicsConstraintType.BALL_AND_SOCKET);
  });
});

describe("a fallen body's motion", () => {
  it("is still when every box has all but stopped", () => {
    expect(dollMotion(fakeCorpse([0.02, 0.3, 0]), 3)).toBe("still");
  });

  it("is moving while it is thrown and falls", () => {
    expect(dollMotion(fakeCorpse([0, DEATH_SPEED, 0.3]), 0.1)).toBe("moving");
    expect(dollMotion(fakeCorpse([0, 22, 0]), 0.5)).toBe("moving");
  });

  it("is moving while a lying limb twitches", () => {
    // Measured on Mother Vhal: settled bodies twitch at up to 1.8 m/s.
    expect(dollMotion(fakeCorpse([0.2, 1.8, 0]), 5)).toBe("moving");
  });

  it("is a runaway once any box goes faster than a body can be thrown", () => {
    // Mother Vhal's runaway boxes were measured at ~197 m/s, 8-24 m up.
    expect(dollMotion(fakeCorpse([0.1, 0.1, 40]), 0.2)).toBe("runaway");
  });

  it("is a runaway once a lying body speeds up again", () => {
    // Her runaways start from 1-2 m/s at 1.3-1.9 s and pass 10 m/s within
    // 0.6 s; at 30 m/s the pose is already a metre off the floor.
    expect(dollMotion(fakeCorpse([0.1, 5, 0.2]), 1.5)).toBe("runaway");
  });

  it("is nothing for a corpse with no physics", () => {
    expect(dollMotion({ metadata: null } as unknown as Mesh, 1)).toBeNull();
  });
});

function fakeCorpse(speeds: number[]): Mesh {
  const bodies = speeds.map((v) => {
    const b = new FakeBody();
    b.setLinearVelocity(new Vector3(0, -v, 0));
    return b;
  });
  return { metadata: { doll: {}, bodies } } as unknown as Mesh;
}

function fakeSkeleton(names: string[]): Skeleton {
  const bones = names.map((name) => ({ name, getParent: () => null as unknown }));
  bones.slice(1).forEach((b) => { b.getParent = () => bones[0]; });
  return { bones } as unknown as Skeleton;
}

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
