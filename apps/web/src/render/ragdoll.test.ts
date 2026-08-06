import { describe, expect, it } from "vitest";
import { CORPSE_SECONDS, SINK_SECONDS, sinkDepth } from "./ragdoll";

describe("corpse sink", () => {
  it("starts at the floor and ends deep enough to swallow a body", () => {
    expect(sinkDepth(0)).toBe(0);
    expect(sinkDepth(1)).toBeGreaterThanOrEqual(1.5);
  });

  it("creeps at the start", () => {
    // The moment the body first moves is the one that is seen; a linear sink
    // would already be a quarter under by here.
    expect(sinkDepth(0.25)).toBeLessThan(sinkDepth(1) * 0.25);
  });

  it("never rises", () => {
    for (let t = 0; t < 1; t += 0.05) {
      expect(sinkDepth(t + 0.05)).toBeGreaterThan(sinkDepth(t));
    }
  });

  it("clamps outside the window", () => {
    expect(sinkDepth(-1)).toBe(0);
    expect(sinkDepth(2)).toBe(sinkDepth(1));
  });

  it("leaves the body lying still far longer than the sink takes", () => {
    expect(CORPSE_SECONDS).toBeGreaterThan(SINK_SECONDS * 4);
  });
});
