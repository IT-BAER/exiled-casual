import { describe, it, expect } from "vitest";
import { looksForClass } from "./class-looks";

describe("what a class looks like on the rig", () => {
  it("stands each class on its own body", () => {
    expect(looksForClass("class.emberbound").base).toBe("female");
    expect(looksForClass("class.stalker").base).toBe("male");
    expect(looksForClass("class.ironsworn").base).toBe("male");
  });
});
