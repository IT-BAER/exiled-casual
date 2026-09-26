// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Matrix, Vector3 } from "@babylonjs/core";
import { FLINCH_TICKS, MAX_LEAN, flinchPose, flinchStrength, kick, leanToTilt } from "./hit-reaction";

const size = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);

describe("hit flinch", () => {
  it("snaps away from the blow, then settles back to nothing inside the window", () => {
    const f = kick(undefined, 10, 1, 0, 1);
    expect(size(flinchPose(f, 10))).toBeCloseTo(0);

    const samples = Array.from({ length: 41 }, (_, i) => 10 + (i / 40) * FLINCH_TICKS);
    const poses = samples.map((t) => flinchPose(f, t));
    const peak = poses.reduce((best, p, i) => (size(p) > size(poses[best]!) ? i : best), 0);
    // A fast attack: the peak comes in the first third, and it is the full lean.
    expect(samples[peak]! - 10).toBeLessThan(FLINCH_TICKS / 3);
    expect(size(poses[peak]!)).toBeCloseTo(MAX_LEAN, 2);
    expect(poses[peak]!.x).toBeGreaterThan(0);
    expect(poses[peak]!.squash).toBeGreaterThan(0);

    for (const t of [10 + FLINCH_TICKS, 10 + FLINCH_TICKS * 3]) {
      const p = flinchPose(f, t);
      expect(size(p)).toBeCloseTo(0);
      expect(p.squash).toBeCloseTo(0);
    }
  });

  it("a second hit mid-flinch carries on from the pose it interrupts", () => {
    const first = kick(undefined, 0, 0, 1, 1);
    const at = FLINCH_TICKS * 0.4;
    const before = flinchPose(first, at);
    const second = kick(first, at, 1, 0, 1);
    const after = flinchPose(second, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
    expect(after.squash).toBeCloseTo(before.squash);
    // ...and still ends at rest.
    expect(size(flinchPose(second, at + FLINCH_TICKS))).toBeCloseTo(0);
  });

  it("a bigger share of life flinches harder, and a bigger body flinches less", () => {
    const chip = flinchStrength(1, 100, "monster");
    const chunk = flinchStrength(20, 100, "monster");
    expect(chunk).toBeGreaterThan(chip);
    expect(flinchStrength(90, 100, "monster")).toBe(1);
    expect(chip).toBeGreaterThan(0);
    expect(flinchStrength(20, 100, "rare")).toBeLessThan(chunk);
    expect(flinchStrength(20, 100, "boss")).toBeLessThan(flinchStrength(20, 100, "rare"));
  });

  it("tips the head toward the lean whichever way the body faces", () => {
    for (const yaw of [0, 1, 2.5, -2]) {
      for (const [x, z] of [[1, 0], [0, 1], [-0.6, 0.8], [0.3, -0.95]] as const) {
        const { pitch, roll } = leanToTilt(yaw, x * MAX_LEAN, z * MAX_LEAN);
        const head = Vector3.TransformCoordinates(Vector3.Up(), Matrix.RotationYawPitchRoll(yaw, pitch, roll));
        const moved = Math.hypot(head.x, head.z);
        expect(moved).toBeCloseTo(Math.sin(MAX_LEAN), 2);
        expect((head.x * x + head.z * z) / moved).toBeGreaterThan(0.99);
      }
    }
  });
});
