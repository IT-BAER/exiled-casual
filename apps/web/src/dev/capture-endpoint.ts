// Dev-server side of `__dev.capture()`: the page POSTs a PNG of the canvas and it
// lands under docs/todo/playtest/{shots,baselines}/; `__dev.record()` POSTs JPEG frames
// to review/skills/<label>/. Mounted by vite.config.ts on `vite serve` only, so a
// production build has no such route.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BYTES = 50 * 1024 * 1024;

/** One path segment reduced to safe characters, never `..`. */
const safe = (raw: string): string => raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);

/**
 * `dir` is one of two fixed folders under `root`, or `skills` under `review` (when
 * wired) with a `label` folder; `name` and `label` are reduced to safe segments,
 * so a request cannot write elsewhere.
 */
export function capturePath(root: string, query: string, review?: string): string {
  const q = new URLSearchParams(query);
  if (q.get("dir") === "skills" && review !== undefined) {
    const label = safe(q.get("label") ?? "") || "unlabelled";
    const frame = safe((q.get("name") ?? "").replace(/\.jpe?g$/i, "")) || `frame-${Date.now()}`;
    return join(review, "skills", label, `${frame}.jpg`);
  }
  const dir = q.get("dir") === "baselines" ? "baselines" : "shots";
  const name = safe((q.get("name") ?? "").replace(/\.png$/i, "")) || `capture-${Date.now()}`;
  return join(root, dir, `${name}.png`);
}

export function captureHandler(root: string, review?: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    const file = capturePath(root, (req.url ?? "").split("?")[1] ?? "", review);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) { res.statusCode = 413; res.end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, Buffer.concat(chunks));
      res.end(file);
    });
  };
}
