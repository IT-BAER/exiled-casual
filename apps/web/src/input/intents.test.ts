import { describe, it, expect } from "vitest";
import { keyToIntent, pointerToWorld } from "./intents";
import { fp } from "@exiled/fixed-point";

describe("keyToIntent", () => {
  const aim = { x: 0, y: 0 };

  // The camera is yawed 45° (engine.ts, alpha=-π/4), so each key is a diagonal
  // in world terms and screen-up is world (-1,+1). Keys that read as opposites
  // must stay exact opposites, or strafing drifts.
  it("w → moveDir up-screen (-x,+y)", () => {
    const i = keyToIntent("w", aim);
    expect(i).toEqual({ kind: "moveDir", dx: -1, dy: 1 });
  });
  it("s → moveDir down-screen (+x,-y)", () => {
    const i = keyToIntent("s", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 1, dy: -1 });
  });
  it("a → moveDir left-screen (-x,-y)", () => {
    const i = keyToIntent("a", aim);
    expect(i).toEqual({ kind: "moveDir", dx: -1, dy: -1 });
  });
  it("d → moveDir right-screen (+x,+y)", () => {
    const i = keyToIntent("d", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 1, dy: 1 });
  });

  it("uppercase W (CapsLock/Shift) → moveDir up-screen", () => {
    expect(keyToIntent("W", aim)).toEqual({ kind: "moveDir", dx: -1, dy: 1 });
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
    expect(keyToIntent("Enter", aim)).toBeNull();
  });

  it("q → useFlask life", () => {
    expect(keyToIntent("q", aim)).toEqual({ kind: "useFlask", slot: "life" });
  });

  it("e → useFlask mana", () => {
    expect(keyToIntent("e", aim)).toEqual({ kind: "useFlask", slot: "mana" });
  });

  it("Q (uppercase) → useFlask life", () => {
    expect(keyToIntent("Q", aim)).toEqual({ kind: "useFlask", slot: "life" });
  });
});

describe("pointerToWorld", () => {
  it("maps Babylon xz pick coords to sim Fixed xy", () => {
    const result = pointerToWorld({ x: 3.2, z: -1.7 });
    expect(result).toEqual({ x: fp(3.2), y: fp(-1.7) });
  });
});
