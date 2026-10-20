import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { diffImages } from "../../../tools/pixel_diff.mjs";

/** A w x h RGB PNG filled with one colour, with optional per-pixel overrides. */
async function png(w: number, h: number, rgb: [number, number, number], set: [number, number, [number, number, number]][] = []) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) raw.set(rgb, i * 3);
  for (const [x, y, c] of set) raw.set(c, (y * w + x) * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("pixel diff", () => {
  it("counts no change between identical frames", async () => {
    const a = await png(4, 4, [40, 40, 40]);
    const r = await diffImages(a, a);
    expect([r.changed, r.total, r.ratio]).toEqual([0, 16, 0]);
  });

  it("counts a pixel only when a channel moves past the threshold", async () => {
    const a = await png(4, 4, [40, 40, 40]);
    const b = await png(4, 4, [40, 40, 40], [[0, 0, [50, 40, 40]], [1, 0, [40, 80, 40]]]);
    expect((await diffImages(a, b, { threshold: 16 })).changed).toBe(1);
    expect((await diffImages(a, b, { threshold: 5 })).changed).toBe(2);
  });

  it("ignores pixels the mask paints white", async () => {
    const a = await png(4, 4, [0, 0, 0]);
    const b = await png(4, 4, [0, 0, 0], [[0, 0, [255, 255, 255]], [3, 3, [255, 255, 255]]]);
    const mask = await png(4, 4, [0, 0, 0], [[0, 0, [255, 255, 255]]]);
    const r = await diffImages(a, b, { mask });
    expect([r.changed, r.total]).toEqual([1, 15]);
  });

  it("paints changed pixels red in the diff image, at the frame's size", async () => {
    const a = await png(2, 1, [10, 10, 10]);
    const b = await png(2, 1, [10, 10, 10], [[1, 0, [200, 10, 10]]]);
    const { diff } = await diffImages(a, b);
    const { data, info } = await sharp(diff).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([2, 1]);
    expect([...data.subarray(info.channels, info.channels + 3)]).toEqual([255, 0, 0]);
    expect(data[0]).not.toBe(255);
  });

  it("refuses frames of different sizes", async () => {
    await expect(diffImages(await png(2, 2, [0, 0, 0]), await png(3, 2, [0, 0, 0]))).rejects.toThrow(/size/);
  });
});
