import { describe, it, expect } from "vitest";
import { keyToIntent, pointerToWorld } from "./intents";
import { fp } from "@pact/fixed-point";

describe("keyToIntent", () => {
  const aim = { x: 0, y: 0 };

  it("w → moveDir north (+y)", () => {
    const i = keyToIntent("w", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 0, dy: 1 });
  });
  it("s → moveDir south (-y)", () => {
    const i = keyToIntent("s", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 0, dy: -1 });
  });
  it("a → moveDir west (-x)", () => {
    const i = keyToIntent("a", aim);
    expect(i).toEqual({ kind: "moveDir", dx: -1, dy: 0 });
  });
  it("d → moveDir east (+x)", () => {
    const i = keyToIntent("d", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 1, dy: 0 });
  });

  it("uppercase W (CapsLock/Shift) → moveDir north (+y)", () => {
    expect(keyToIntent("W", aim)).toEqual({ kind: "moveDir", dx: 0, dy: 1 });
  });

  it("1 → useSkill ember_bolt aimed at aim point", () => {
    const aimPt = { x: 3.2, y: -1.7 };
    const i = keyToIntent("1", aimPt);
    expect(i).toEqual({
      kind: "useSkill",
      skillId: "skill.ember_bolt.v1",
      tx: fp(3.2),
      ty: fp(-1.7),
    });
  });
  it("2 → useSkill cinder_ground", () => {
    const i = keyToIntent("2", aim);
    expect(i?.kind).toBe("useSkill");
    expect((i as { skillId: string }).skillId).toBe("skill.cinder_ground.v1");
  });
  it("3 → useSkill blink", () => {
    const i = keyToIntent("3", aim);
    expect(i?.kind).toBe("useSkill");
    expect((i as { skillId: string }).skillId).toBe("skill.blink.v1");
  });

  it("unmapped key → null", () => {
    expect(keyToIntent("q", aim)).toBeNull();
    expect(keyToIntent("Enter", aim)).toBeNull();
  });
});

describe("pointerToWorld", () => {
  it("maps Babylon xz pick coords to sim Fixed xy", () => {
    const result = pointerToWorld({ x: 3.2, z: -1.7 });
    expect(result).toEqual({ x: fp(3.2), y: fp(-1.7) });
  });
});
