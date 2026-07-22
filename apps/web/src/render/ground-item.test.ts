// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Y_LIFT } from "./meshes";

describe("ground item mesh", () => {
  it("has a Y_LIFT entry so it renders on the floor", () => {
    expect(typeof Y_LIFT["groundItem"]).toBe("number");
  });
});
