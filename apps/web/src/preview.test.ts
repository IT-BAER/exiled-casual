import { describe, it, expect } from "vitest";
import { femaleWardrobe, previewOn } from "./preview";

describe("previewOn", () => {
  it("shows unsigned work in a dev build", () => {
    expect(previewOn("maren", true, "")).toBe(true);
  });

  it("keeps a release on what last shipped", () => {
    expect(previewOn("maren", false, "")).toBe(false);
    expect(previewOn("maren", false, "?play&map=strand")).toBe(false);
    expect(previewOn("maren", false, "?preview=atlas")).toBe(false);
  });

  it("shows it in a release only when the URL names it", () => {
    expect(previewOn("maren", false, "?preview=maren")).toBe(true);
    expect(previewOn("maren", false, "?play&preview=atlas,maren")).toBe(true);
  });
});

describe("femaleWardrobe", () => {
  it("serves the released female wardrobe unless Maren's new look is previewed", () => {
    expect(femaleWardrobe(false)).toBe("/models/wardrobe-female-released.glb");
    expect(femaleWardrobe(true)).toBe("/models/wardrobe-female.glb");
  });
});
