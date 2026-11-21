import { describe, expect, it } from "vitest";
import { segments, toStage, type ReferenceClip } from "./reference-skeleton";

// A two-frame "run" authored Z-up, facing -X, its left at -Y, travelling 2 units along -X
// per cycle, legs 1 unit long (thigh to knee 0.5, knee to ankle 0.5).
const NAMES = ["root", "hip", "L_thigh", "R_thigh", "L_knee", "R_knee", "L_ankle", "R_ankle", "L_toe", "R_toe", "head"].map((n) => `${n}_jntBnd`);
const PARENT = [-1, 0, 1, 1, 2, 3, 4, 5, 6, 7, 1];
function frame(travel: number): number[] {
  const at: Record<string, [number, number, number]> = {
    root: [-travel, 0, 0], hip: [-travel, 0, 1.1],
    L_thigh: [-travel, -0.1, 1.0], R_thigh: [-travel, 0.1, 1.0],
    L_knee: [-travel, -0.1, 0.5], R_knee: [-travel, 0.1, 0.5],
    L_ankle: [-travel, -0.1, 0.0], R_ankle: [-travel, 0.1, 0.05],
    L_toe: [-travel - 0.2, -0.1, 0.0], R_toe: [-travel - 0.2, 0.1, 0.05],
    head: [-travel, 0, 1.8],
  };
  return NAMES.flatMap((n) => at[n.replace("_jntBnd", "")]!);
}
const CLIP: ReferenceClip = {
  clip: "run", fps: 60,
  bones: NAMES.map((name, i) => ({ name, parent: PARENT[i]! })),
  frames: [frame(0), frame(1), frame(2)],
};
const joint = (frames: number[][][], f: number, name: string) => frames[f]![NAMES.indexOf(`${name}_jntBnd`)]!;

describe("toStage", () => {
  it("stands the reference up +Y, facing +Z, its left on the subject's left, at the subject's scale", () => {
    for (const leftSign of [1, -1]) {
      const out = toStage(CLIP, { leg: 2, leftSign, ankleY: 0.1 });
      const head = joint(out, 0, "head"), ankle = joint(out, 0, "L_ankle");
      expect(head[1]! - ankle[1]!).toBeCloseTo(3.6);
      expect(joint(out, 0, "L_toe")[2]! - ankle[2]!).toBeCloseTo(0.4);
      expect(Math.sign(joint(out, 0, "L_thigh")[0]! - joint(out, 0, "R_thigh")[0]!)).toBe(leftSign);
      expect(ankle[1]).toBeCloseTo(0.1);
    }
  });

  it("removes the root's travel and centres the hip over the origin", () => {
    const out = toStage(CLIP, { leg: 1, leftSign: 1, ankleY: 0 });
    for (const f of [0, 1, 2]) {
      expect(joint(out, f, "hip")[0]).toBeCloseTo(0);
      expect(joint(out, f, "hip")[2]).toBeCloseTo(0);
    }
  });
});

describe("segments", () => {
  it("draws the body chain and leaves the root out", () => {
    const names = segments(CLIP).map(([p, c]) => `${NAMES[p]}>${NAMES[c]}`);
    expect(names).toContain("L_thigh_jntBnd>L_knee_jntBnd");
    expect(names).toContain("hip_jntBnd>head_jntBnd");
    expect(names.some((s) => s.startsWith("root"))).toBe(false);
  });
});
