import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("brazier fire asset", () => {
  it("ships a bounded 48-frame Blender flipbook", () => {
    const path = fileURLToPath(new URL("../../public/textures/effects/brazier-fire.png", import.meta.url));
    const png = readFileSync(path);

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(768);
    expect(png.byteLength).toBeLessThan(1_000_000);
  });
});
