/**
 * Compare two frames of the same size and count the pixels that moved. A pixel
 * counts when any RGB channel differs by more than `threshold`; pixels a mask
 * paints white (luma >= 128) are left out of the count and the total. The diff
 * image is the first frame dimmed to a quarter, with every changed pixel red.
 *
 *   node tools/pixel_diff.mjs a.png b.png [--threshold 16] [--mask m.png] [--max-ratio 0.001] [--out diff.png]
 *
 * Exits 1 when the changed share is above --max-ratio (default 0), 2 on bad usage.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rgb = (input) => sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });

export async function diffImages(a, b, { threshold = 16, mask } = {}) {
  const [fa, fb] = await Promise.all([rgb(a), rgb(b)]);
  const { width, height } = fa.info;
  if (fb.info.width !== width || fb.info.height !== height) {
    throw new Error(`frame size differs: ${width}x${height} vs ${fb.info.width}x${fb.info.height}`);
  }
  let m;
  if (mask) {
    m = await sharp(mask).removeAlpha().greyscale().resize(width, height, { fit: "fill" }).raw().toBuffer();
  }
  const out = Buffer.alloc(width * height * 3);
  let changed = 0;
  let total = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 3;
    out[o] = fa.data[o] >> 2;
    out[o + 1] = fa.data[o + 1] >> 2;
    out[o + 2] = fa.data[o + 2] >> 2;
    if (m && m[i] >= 128) continue;
    total++;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(fa.data[o + c] - fb.data[o + c]));
    if (d > threshold) {
      changed++;
      out[o] = 255;
      out[o + 1] = 0;
      out[o + 2] = 0;
    }
  }
  const diff = await sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return { changed, total, ratio: total === 0 ? 0 : changed / total, width, height, diff };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const threshold = Number(flag("--threshold") ?? 16);
  const maskPath = flag("--mask");
  const maxRatio = Number(flag("--max-ratio") ?? 0);
  const outPath = flag("--out");
  if (args.length !== 2 || !Number.isFinite(threshold) || !Number.isFinite(maxRatio)) {
    console.error("usage: node tools/pixel_diff.mjs a.png b.png [--threshold 16] [--mask m.png] [--max-ratio 0.001] [--out diff.png]");
    process.exit(2);
  }
  const r = await diffImages(args[0], args[1], { threshold, mask: maskPath });
  if (outPath) writeFileSync(outPath, r.diff);
  console.log(`${r.changed}/${r.total} pixels changed (${(r.ratio * 100).toFixed(3)}%) at threshold ${threshold}`);
  process.exit(r.ratio > maxRatio ? 1 : 0);
}
