import { describe, expect, it, test } from "vitest";
import { readFileSync } from "node:fs";
import { validateIntent, isToWorker, SKILL_SLOT_COUNT } from "./index.js";
import type { FromWorker } from "./index.js";
import { fp } from "@exiled/fixed-point";
import { generateArea } from "@exiled/mapgen";

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

  test("pause carries a boolean and nothing else will do", () => {
    expect(isToWorker({ type: "pause", paused: true })).toBe(true);
    expect(isToWorker({ type: "pause", paused: false })).toBe(true);
    expect(isToWorker({ type: "pause" })).toBe(false);
    expect(isToWorker({ type: "pause", paused: "yes" })).toBe(false);
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

describe("validateIntent — interact", () => {
  test("interact without targetId throws", () => {
    expect(() => validateIntent({ kind: "interact" })).toThrow();
  });

  test("interact with a non-integer targetId throws", () => {
    expect(() => validateIntent({ kind: "interact", targetId: 1.5 })).toThrow();
  });

  test("interact with integer targetId round-trips", () => {
    const intent = { kind: "interact", targetId: 42 };
    expect(validateIntent(intent)).toEqual({ kind: "interact", targetId: 42 });
  });
});

describe("validateIntent — activateMap", () => {
  test("validates activateMap", () => {
    expect(validateIntent({ kind: "activateMap", atlasNodeId: "node.the_wrackline", x: 0, y: 0 }))
      .toEqual({ kind: "activateMap", atlasNodeId: "node.the_wrackline", x: 0, y: 0 });
  });
  test("rejects activateMap with empty ids", () => {
    expect(() => validateIntent({ kind: "activateMap", atlasNodeId: "", x: 0, y: 0 })).toThrow();
    expect(() => validateIntent({ kind: "activateMap", atlasNodeId: "n", x: 0, y: "notint" })).toThrow();
  });
});

describe("validateIntent — pickupItem", () => {
  test("validates a pickupItem intent", () => {
    expect(validateIntent({ kind: "pickupItem", entityId: 7 })).toEqual({ kind: "pickupItem", entityId: 7 });
  });
  test("rejects pickupItem with a non-integer entityId", () => {
    expect(() => validateIntent({ kind: "pickupItem", entityId: "x" })).toThrow();
  });
});

describe("validateIntent — useFlask", () => {
  test("valid life flask round-trips", () => {
    expect(validateIntent({ kind: "useFlask", slot: "life" })).toEqual({ kind: "useFlask", slot: "life" });
  });

  test("valid mana flask round-trips", () => {
    expect(validateIntent({ kind: "useFlask", slot: "mana" })).toEqual({ kind: "useFlask", slot: "mana" });
  });

  test("unknown slot throws", () => {
    expect(() => validateIntent({ kind: "useFlask", slot: "stamina" })).toThrow();
  });

  test("missing slot throws", () => {
    expect(() => validateIntent({ kind: "useFlask" })).toThrow();
  });
});

describe("validateIntent — setSkillBar", () => {
  it("validates setSkillBar and refuses a bar that is not an array of ids", () => {
    expect(validateIntent({ kind: "setSkillBar", bar: ["skill.a.v1", null] }))
      .toEqual({ kind: "setSkillBar", bar: ["skill.a.v1", null] });
    expect(() => validateIntent({ kind: "setSkillBar", bar: "nope" })).toThrow();
    expect(() => validateIntent({ kind: "setSkillBar", bar: [1, 2] })).toThrow();
    expect(() => validateIntent({ kind: "setSkillBar" })).toThrow();
  });

  it("refuses a bar longer than SKILL_SLOT_COUNT rather than truncating it silently", () => {
    const long = new Array(SKILL_SLOT_COUNT + 1).fill(null);
    expect(() => validateIntent({ kind: "setSkillBar", bar: long })).toThrow();
  });
});

describe("FromWorker area message", () => {
  // postMessage clones with the structured-clone algorithm; this guards against a
  // future "optimisation" (e.g. JSON) that would silently drop the Uint8Array grid.
  test("survives a structured-clone round-trip with grid.cells intact", () => {
    const layout = generateArea(42, "slice1.v1");
    const msg: FromWorker = { type: "area", area: "map", layout, mapBaseId: "map.vaal_stone" };
    const clone = structuredClone(msg);
    expect(clone.type).toBe("area");
    if (clone.type !== "area") throw new Error("unreachable");
    expect(clone.area).toBe("map");
    expect(clone.layout.grid.cells).toBeInstanceOf(Uint8Array);
    expect(clone.layout.grid.cells).toEqual(layout.grid.cells);
    expect(clone.layout.hash).toBe(layout.hash);
  });
});

/**
 * The trust boundary is also a silent one.
 *
 * `sim-worker.ts` hands every inbound intent to `validateIntent` and does not catch:
 * an unknown kind throws inside the message handler, the intent is dropped, and the
 * page sees nothing at all. Both `revive` and `usePortalScroll` shipped that way -
 * every unit test green, both features dead in the browser, found only by pressing
 * the button in the running game.
 *
 * So this is a source scan and not a list of samples. A list has to be remembered;
 * the whole failure was that something was not.
 */
describe("validateIntent covers every intent kind", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  /** Kinds declared on the `Intent` union. */
  const declared = (): Set<string> => {
    const body = src.slice(src.indexOf("export type Intent ="), src.indexOf("export type CommandType"));
    return new Set([...body.matchAll(/kind:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]!));
  };

  /** Kinds `validateIntent` has a case for. */
  const handled = (): Set<string> => {
    const body = src.slice(src.indexOf("export function validateIntent"));
    const end = body.indexOf("const TO_WORKER_TYPES");
    return new Set([...body.slice(0, end).matchAll(/case\s+"([a-zA-Z]+)":/g)].map((m) => m[1]!));
  };

  it("finds the union and the validator", () => {
    expect(declared().size).toBeGreaterThan(10);
    expect(handled().size).toBeGreaterThan(10);
  });

  it("validates every kind the client can send", () => {
    const missing = [...declared()].filter((k) => !handled().has(k));
    expect(missing).toEqual([]);
  });

  it("and validates nothing that is not an intent", () => {
    const extra = [...handled()].filter((k) => !declared().has(k));
    expect(extra).toEqual([]);
  });

  it("passes the two that were dropped", () => {
    expect(validateIntent({ kind: "revive", where: "checkpoint" }))
      .toEqual({ kind: "revive", where: "checkpoint" });
    expect(validateIntent({ kind: "revive", where: "hideout" }))
      .toEqual({ kind: "revive", where: "hideout" });
    expect(validateIntent({ kind: "usePortalScroll" })).toEqual({ kind: "usePortalScroll" });
    expect(() => validateIntent({ kind: "revive", where: "somewhere else" })).toThrow();
  });
});
