import { describe, it, expect } from "vitest";
import { settleGate, SETTLE_FRAMES, SETTLE_FRAME_MS, SETTLE_CAP_MS } from "./settle";

/** Feeds frame intervals (ms) and returns the index of the frame that settled, or -1. */
const run = (gaps: number[]): number => {
  const settled = settleGate(0);
  let t = 0;
  return gaps.findIndex((g) => settled((t += g)));
};

describe("settleGate", () => {
  it("settles after a run of fast frames", () => {
    expect(run(Array(SETTLE_FRAMES + 5).fill(16))).toBe(SETTLE_FRAMES - 1);
  });

  it("restarts the run on a slow frame, which is a first-draw shader compile", () => {
    const gaps = [...Array(SETTLE_FRAMES - 1).fill(16), 1200, ...Array(SETTLE_FRAMES).fill(16)];
    expect(run(gaps)).toBe(gaps.length - 1);
  });

  it("does not count a frame at the threshold as fast", () => {
    expect(run(Array(SETTLE_FRAMES).fill(SETTLE_FRAME_MS))).toBe(-1);
  });

  it("gives up at the cap on a GPU that never settles", () => {
    const gaps = Array(Math.ceil(SETTLE_CAP_MS / 500) + 2).fill(500);
    expect(run(gaps)).toBe(SETTLE_CAP_MS / 500 - 1);
  });
});
