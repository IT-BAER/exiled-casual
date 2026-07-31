// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Quaternion } from "@babylonjs/core";
import { applyShieldCarry, type ShieldCarryJoint } from "./shield-carry";

const q = (x: number, y: number, z: number, w: number) => new Quaternion(x, y, z, w);

describe("shield carry pose", () => {
  it.each([
    "shield#base.ashwall_tower_shield",
    "tower#base.ashwall_tower_shield",
    "buckler#base.ember_buckler",
  ])(
    "restores the held arm after locomotion rotates it for %s",
    (look) => {
      const joints: ShieldCarryJoint[] = [
        { node: { rotationQuaternion: q(0.4, 0.3, 0.2, 0.1) }, hold: q(0.1, 0.2, 0.3, 0.9) },
        { node: { rotationQuaternion: q(0.2, 0.4, 0.1, 0.3) }, hold: q(0.3, 0.1, 0.2, 0.9) },
        { node: { rotationQuaternion: null }, hold: q(0.2, 0.3, 0.1, 0.9) },
      ];

      expect(applyShieldCarry(look, joints)).toBe(true);
      for (const { node, hold } of joints) expect(node.rotationQuaternion).toEqual(hold);
    },
  );

  it("leaves the animated arm alone for a focus or an empty hand", () => {
    const run = q(0.4, 0.3, 0.2, 0.1);
    const joints: ShieldCarryJoint[] = [
      { node: { rotationQuaternion: run.clone() }, hold: q(0.1, 0.2, 0.3, 0.9) },
    ];

    expect(applyShieldCarry("focus", joints)).toBe(false);
    expect(joints[0]!.node.rotationQuaternion).toEqual(run);
    expect(applyShieldCarry(null, joints)).toBe(false);
    expect(joints[0]!.node.rotationQuaternion).toEqual(run);
  });
});
