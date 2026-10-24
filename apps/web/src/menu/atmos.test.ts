import { describe, expect, it } from "vitest";
import { ROOT_SINK, bodyBox } from "./atmos";

describe("bodyBox", () => {
  it("cuts the flame at the painted rim and burns it from coals below it", () => {
    const box = bodyBox(500, 300, 100);
    expect(box.bottom).toBe(300);
    expect(ROOT_SINK).toBeGreaterThan(0);
    expect(box.coal).toBeCloseTo(300 + 100 * ROOT_SINK);
    expect(box.top).toBeLessThan(300 - 100);
    expect(box.right - 500).toBeCloseTo(500 - box.left);
  });
});
