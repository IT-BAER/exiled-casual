import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { capturePath } from "./capture-endpoint";

const ROOT = join("/tmp", "playtest");

describe("capture endpoint paths", () => {
  it("writes a named shot under shots/", () => {
    expect(capturePath(ROOT, "dir=shots&name=hideout-portal")).toBe(join(ROOT, "shots", "hideout-portal.png"));
  });

  it("writes a baseline under baselines/ and drops a doubled extension", () => {
    expect(capturePath(ROOT, "dir=baselines&name=strand.png")).toBe(join(ROOT, "baselines", "strand.png"));
  });

  it("cannot be steered out of the two folders", () => {
    expect(capturePath(ROOT, "dir=../../etc&name=../../x")).toBe(join(ROOT, "shots", "_.._x.png"));
    expect(capturePath(ROOT, "name=..%2F..%2Fpasswd")).toBe(join(ROOT, "shots", "_.._passwd.png"));
  });

  it("names an unnamed capture by time", () => {
    expect(capturePath(ROOT, "")).toMatch(/shots[\\/]capture-\d+\.png$/);
  });
});
