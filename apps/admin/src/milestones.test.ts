import { describe, expect, it } from "vitest";
import type { Milestone } from "@exiled/telemetry";
import { orderMilestones } from "./milestones";

const m = (id: string, progress: number, target: number, unlockedAt: number | null): Milestone => ({
  id,
  title: id,
  desc: "",
  rarity: "normal",
  progress,
  target,
  unlockedAt,
});

describe("milestone order", () => {
  it("puts unlocked first, newest first, then locked closest to done", () => {
    const out = orderMilestones([
      m("far", 1, 100, null),
      m("old", 10, 10, 1000),
      m("close", 90, 100, null),
      m("new", 5, 5, 5000),
      m("half", 5, 10, null),
    ]);
    expect(out.map((x) => x.id)).toEqual(["new", "old", "close", "half", "far"]);
  });

  it("keeps ties stable and does not mutate the input", () => {
    const input = [m("a", 1, 2, null), m("b", 2, 4, null)];
    const out = orderMilestones(input);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
    expect(out).not.toBe(input);
  });

  it("treats a zero target as complete progress", () => {
    const out = orderMilestones([m("x", 0, 10, null), m("zero", 0, 0, null)]);
    expect(out[0]!.id).toBe("zero");
  });
});
