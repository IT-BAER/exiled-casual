import { describe, expect, test } from "vitest";
import { validateIntent, isToWorker } from "./index.js";
import { fp } from "@pact/fixed-point";

describe("validateIntent — valid intents pass through", () => {
  test("moveTo with integer coords", () => {
    const intent = { kind: "moveTo", x: fp(3), y: fp(4) };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("moveDir with valid direction", () => {
    const intent = { kind: "moveDir", dx: 1 as const, dy: -1 as const };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("moveDir with all zeros", () => {
    const intent = { kind: "moveDir", dx: 0 as const, dy: 0 as const };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("useSkill with nonempty skillId and integer coords", () => {
    const intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(6) };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("stop", () => {
    expect(validateIntent({ kind: "stop" })).toEqual({ kind: "stop" });
  });
});

describe("validateIntent — malformed inputs throw", () => {
  test("unknown kind throws", () => {
    expect(() => validateIntent({ kind: "dash" })).toThrow();
  });

  test("moveTo missing x throws", () => {
    expect(() => validateIntent({ kind: "moveTo", y: fp(4) })).toThrow();
  });

  test("moveTo non-integer x (1.5) throws", () => {
    expect(() => validateIntent({ kind: "moveTo", x: 1.5, y: fp(4) })).toThrow();
  });

  test("moveDir dx=2 throws", () => {
    expect(() => validateIntent({ kind: "moveDir", dx: 2, dy: 0 })).toThrow();
  });

  test("useSkill empty skillId throws", () => {
    expect(() =>
      validateIntent({ kind: "useSkill", skillId: "", tx: fp(1), ty: fp(2) }),
    ).toThrow();
  });

  test("non-object throws", () => {
    expect(() => validateIntent(42)).toThrow();
  });

  test("null throws", () => {
    expect(() => validateIntent(null)).toThrow();
  });
});

describe("isToWorker", () => {
  test("valid init message", () => {
    expect(isToWorker({ type: "init", seed: 12345 })).toBe(true);
  });

  test("valid intent message", () => {
    expect(
      isToWorker({ type: "intent", intent: { kind: "stop" } }),
    ).toBe(true);
  });

  test("valid reset message", () => {
    expect(isToWorker({ type: "reset" })).toBe(true);
  });

  test("null → false", () => {
    expect(isToWorker(null)).toBe(false);
  });

  test("{type:'nope'} → false", () => {
    expect(isToWorker({ type: "nope" })).toBe(false);
  });

  test("non-object (string) → false", () => {
    expect(isToWorker("intent")).toBe(false);
  });

  test("init without seed → false", () => {
    expect(isToWorker({ type: "init" })).toBe(false);
  });
});
