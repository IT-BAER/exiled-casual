import { describe, it, expect } from "vitest";
import { heldToMoveIntent, keyToIntent, pointerToWorld } from "./intents";
import { DEFAULT_SETTINGS } from "../settings";
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

  // Y is the way home, and it arrives as the scroll intent so the key and the
  // right-click on a Portal Scroll are one action all the way down.
  it("y → usePortalScroll", () => {
    expect(keyToIntent("y", aim)).toEqual({ kind: "usePortalScroll" });
    expect(keyToIntent("Y", aim)).toEqual({ kind: "usePortalScroll" });
  });

  /**
   * The key row IS the skill bar's order now: what 1 fires is whatever the player
   * dragged into the first socket, so the mapping comes in as a lookup rather than
   * living here.
   */
  const defaultBar = DEFAULT_SETTINGS.ui.skillBar;
  const barLookup = (bar: (string | null)[]) => (key: string) => bar[Number(key) - 1] ?? null;

  it("1 → useSkill ember_bolt aimed at aim point", () => {
    const aimPt = { x: 3.2, y: -1.7 };
    const i = keyToIntent("1", aimPt, barLookup(defaultBar));
    expect(i).toEqual({
      kind: "useSkill",
      skillId: "skill.ember_bolt.v1",
      tx: fp(3.2),
      ty: fp(-1.7),
    });
  });
  it("2 → useSkill cinder_ground", () => {
    const i = keyToIntent("2", aim, barLookup(defaultBar));
    expect((i as { skillId: string }).skillId).toBe("skill.cinder_ground.v1");
  });
  it("3 → useSkill blink", () => {
    const i = keyToIntent("3", aim, barLookup(defaultBar));
    expect((i as { skillId: string }).skillId).toBe("skill.blink.v1");
  });

  it("follows the bar: a skill dragged to socket 5 fires on 5", () => {
    const moved = ["skill.cinder_ground.v1", null, "skill.blink.v1", null, "skill.ember_bolt.v1"];
    expect((keyToIntent("5", aim, barLookup(moved)) as { skillId: string }).skillId)
      .toBe("skill.ember_bolt.v1");
    expect(keyToIntent("2", aim, barLookup(moved))).toBeNull();
  });

  it("with no bar at all, the number keys do nothing", () => {
    expect(keyToIntent("1", aim)).toBeNull();
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

describe("heldToMoveIntent", () => {
  // Every key is already a world diagonal, so two of them read as the direction
  // between the two — which on screen is the cardinal the player pressed for.
  it("w+d → straight up-right on screen, i.e. world +y", () => {
    expect(heldToMoveIntent(["w", "d"])).toEqual({ kind: "moveDir", dx: 0, dy: 1 });
  });

  it("a+s → the opposite of w+d", () => {
    expect(heldToMoveIntent(["a", "s"])).toEqual({ kind: "moveDir", dx: 0, dy: -1 });
  });

  it("w+a → world -x", () => {
    expect(heldToMoveIntent(["w", "a"])).toEqual({ kind: "moveDir", dx: -1, dy: 0 });
  });

  it("one key still gives that key's own diagonal", () => {
    expect(heldToMoveIntent(["d"])).toEqual({ kind: "moveDir", dx: 1, dy: 1 });
  });

  // Both hands on the keyboard beats a lockout: opposing keys cancel to a stop
  // rather than letting whichever was pressed last win.
  it("w+s cancel out → stop", () => {
    expect(heldToMoveIntent(["w", "s"])).toEqual({ kind: "stop" });
  });

  it("nothing held → stop", () => {
    expect(heldToMoveIntent([])).toEqual({ kind: "stop" });
  });

  it("three keys sum, so w+a+d is w", () => {
    expect(heldToMoveIntent(["w", "a", "d"])).toEqual({ kind: "moveDir", dx: -1, dy: 1 });
  });
});

describe("pointerToWorld", () => {
  it("maps Babylon xz pick coords to sim Fixed xy", () => {
    const result = pointerToWorld({ x: 3.2, z: -1.7 });
    expect(result).toEqual({ x: fp(3.2), y: fp(-1.7) });
  });
});
