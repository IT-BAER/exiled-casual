import { describe, expect, it } from "vitest";
import { FLAME_GLSL, SPARKS, sparkPose, sparkRgb, sparkTable, type SparkPose } from "./flame-field";

describe("the shared brazier fire", () => {
  it("hands both hosts one march to call", () => {
    expect(FLAME_GLSL).toContain("vec3 marchFlame(vec3 entry, vec3 rd, float t)");
  });

  it("draws the same sparks every time, so a captured frame can be retaken", () => {
    const a = sparkTable(2);
    expect(a).toHaveLength(2 * SPARKS);
    expect(sparkTable(2)).toEqual(a);
    const p: SparkPose = { x: 0, y: 0, z: 0, radius: 0, alpha: 0, u: 0 };
    const q: SparkPose = { ...p };
    expect(sparkPose(a[7]!, 12.3, p)).toEqual(sparkPose(a[7]!, 12.3, q));
  });

  it("burns white-hot at the coals and cools to soot red", () => {
    const [r0, g0, b0] = sparkRgb(0);
    const [r1, g1, b1] = sparkRgb(1);
    expect([r0, g0, b0]).toEqual([255, 246, 214]);
    expect(r1).toBeLessThan(r0!);
    expect(g1).toBeLessThan(100);
    expect(b1).toBeLessThan(20);
  });
});
