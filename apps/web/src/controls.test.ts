import { describe, it, expect } from "vitest";
import { barForMode, enforceMode, socketForKey } from "./controls";
import { DEFAULT_KEYBINDS_BY_MODE, MOVE_SOCKET } from "./settings";

const ATTACK = "skill.attack";
// Five numbered sockets, then left, middle and right click.
const fresh = () => ["skill.a", null, null, null, null, MOVE_SOCKET, null, ATTACK];

describe("barForMode", () => {
  it("leaves a fresh character's mouse bar as it was built", () => {
    expect(barForMode(fresh(), "mouse", ATTACK)).toEqual(fresh());
  });

  it("puts the attack on left click for WASD and clears where it was", () => {
    expect(barForMode(fresh(), "wasd", ATTACK))
      .toEqual(["skill.a", null, null, null, null, ATTACK, null, null]);
  });

  it("takes Move off every socket in WASD mode", () => {
    const bar = [MOVE_SOCKET, null, null, null, null, "skill.x", null, MOVE_SOCKET];
    expect(barForMode(bar, "wasd", ATTACK))
      .toEqual([null, null, null, null, null, ATTACK, null, null]);
  });

  it("gives left click back to Move and keeps its skill on right click", () => {
    const wasd = ["skill.a", null, null, null, null, ATTACK, null, null];
    expect(barForMode(wasd, "mouse", ATTACK)).toEqual(fresh());
  });

  it("moves the left-click skill to the first free socket when right click is taken", () => {
    const bar = ["skill.a", null, null, null, null, ATTACK, null, "skill.b"];
    expect(barForMode(bar, "mouse", ATTACK))
      .toEqual(["skill.a", ATTACK, null, null, null, MOVE_SOCKET, null, "skill.b"]);
  });

  it("drops the left-click skill off a full bar; its gem is not touched here", () => {
    const bar = ["a", "b", "c", "d", "e", ATTACK, "m", "r"];
    expect(barForMode(bar, "mouse", ATTACK)).toEqual(["a", "b", "c", "d", "e", MOVE_SOCKET, "m", "r"]);
  });
});

describe("socketForKey", () => {
  it("finds the numbered socket a key is bound to in each mode", () => {
    expect(socketForKey("w", DEFAULT_KEYBINDS_BY_MODE.mouse)).toBe(1);
    expect(socketForKey("f", DEFAULT_KEYBINDS_BY_MODE.wasd)).toBe(4);
    expect(socketForKey("w", DEFAULT_KEYBINDS_BY_MODE.wasd)).toBe(-1);
  });

  it("reads Shift and CapsLock as the same key", () => {
    expect(socketForKey("Q", DEFAULT_KEYBINDS_BY_MODE.wasd)).toBe(0);
  });

  it("never matches an unbound socket", () => {
    const binds = { ...DEFAULT_KEYBINDS_BY_MODE.wasd, skill3: "" };
    expect(socketForKey("", binds)).toBe(-1);
  });
});

describe("enforceMode", () => {
  it("hands back the same bar when it already fits the mode", () => {
    const mouse = fresh();
    expect(enforceMode(mouse, "mouse", ATTACK)).toBe(mouse);
    const wasd = ["skill.a", null, null, null, null, "skill.b", null, null];
    expect(enforceMode(wasd, "wasd", ATTACK)).toBe(wasd);
  });

  it("gives an old mouse character whose left click lost Move its walk back", () => {
    const bar = ["skill.a", null, null, null, null, "skill.b", null, ATTACK];
    expect(enforceMode(bar, "mouse", ATTACK))
      .toEqual(["skill.a", "skill.b", null, null, null, MOVE_SOCKET, null, ATTACK]);
  });

  it("lays a WASD bar out fresh when Move still holds left click", () => {
    expect(enforceMode(fresh(), "wasd", ATTACK))
      .toEqual(["skill.a", null, null, null, null, ATTACK, null, null]);
  });

  it("only takes a stray Move away when left click holds the player's own choice", () => {
    const bar = ["skill.a", null, null, null, null, "skill.b", MOVE_SOCKET, null];
    expect(enforceMode(bar, "wasd", ATTACK))
      .toEqual(["skill.a", null, null, null, null, "skill.b", null, null]);
  });
});
