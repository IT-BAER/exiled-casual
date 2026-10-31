import { describe, expect, it } from "vitest";
import { createLoadClock, markGameEntry, type LoadPhase } from "./load-phases";

function clock(entry: number | null, mount: number) {
  if (entry !== null) markGameEntry(entry);
  const got: [LoadPhase, number][] = [];
  const c = createLoadClock(mount, (p, ms) => got.push([p, ms]));
  return { c, got };
}

describe("the load clock", () => {
  it("times each phase from its own start and reports it once", () => {
    const { c, got } = clock(1000, 3000);
    c.worker(4200);
    c.models(7000);
    c.models(9000);
    c.settled(8100);
    c.settled(9999);
    expect(got).toEqual([
      ["chunk", 2000],
      ["worker", 1200],
      ["models", 4000],
      // From the later of models and area, here the models.
      ["shaders", 1100],
      // The whole wait, from the click.
      ["frame", 7100],
    ]);
  });

  it("starts the shader phase at the area when the worker is the slower one", () => {
    const { c, got } = clock(1000, 3000);
    c.models(5000);
    c.worker(6000);
    c.settled(6500);
    expect(got.find(([p]) => p === "shaders")).toEqual(["shaders", 500]);
  });

  it("starts at mount when no entry was marked after it", () => {
    // An entry stamped later than the mount belongs to some other load.
    const { got } = clock(5000, 3000);
    expect(got).toEqual([["chunk", 0]]);
  });
});
