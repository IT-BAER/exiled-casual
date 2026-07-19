import { describe, it, expect } from "vitest";
import { lerp } from "./interp";

describe("lerp", () => {
  it("midpoint", () => expect(lerp(0, 10, 0.5)).toBe(5));
  it("alpha 0 returns a", () => expect(lerp(3, 7, 0)).toBe(3));
  it("alpha 1 returns b", () => expect(lerp(3, 7, 1)).toBe(7));
  it("clamps below 0", () => expect(lerp(0, 10, -0.5)).toBe(0));
  it("clamps above 1", () => expect(lerp(0, 10, 1.5)).toBe(10));
});
