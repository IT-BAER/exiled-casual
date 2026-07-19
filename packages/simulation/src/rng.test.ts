import { describe, expect, test } from "vitest";
import { createStream, fnv1a32 } from "./index";

describe("rng", () => {
  test("same seed and name produce the same sequence", () => {
    const a = createStream(12345, "loot");
    const b = createStream(12345, "loot");
    const seqA = [a.nextU32(), a.nextU32(), a.nextU32()];
    const seqB = [b.nextU32(), b.nextU32(), b.nextU32()];
    expect(seqA).toEqual(seqB);
  });

  test("different stream names diverge", () => {
    const loot = createStream(12345, "loot");
    const move = createStream(12345, "movement");
    expect(loot.nextU32()).not.toBe(move.nextU32());
  });

  test("ordinal counts draws", () => {
    const s = createStream(1, "x");
    expect(s.ordinal()).toBe(0);
    s.nextU32();
    s.nextInt(0, 10);
    expect(s.ordinal()).toBe(2);
  });

  test("nextInt stays within inclusive bounds", () => {
    const s = createStream(7, "y");
    for (let i = 0; i < 1000; i++) {
      const v = s.nextInt(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  test("fnv1a32 is stable and unsigned", () => {
    expect(fnv1a32("loot")).toBe(fnv1a32("loot"));
    expect(fnv1a32("loot")).toBeGreaterThanOrEqual(0);
    expect(fnv1a32("loot")).not.toBe(fnv1a32("movement"));
  });
});
