// Dev-server side of `__dev.capture()`: the page POSTs a PNG of the canvas and it
// lands under docs/todo/playtest/{shots,baselines}/. Mounted by vite.config.ts on
// `vite serve` only, so a production build has no such route.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BYTES = 50 * 1024 * 1024;

/** `dir` is one of two fixed folders and `name` is reduced to a safe file name, so a request cannot write elsewhere. */
export function capturePath(root: string, query: string): string {
  const q = new URLSearchParams(query);
  const dir = q.get("dir") === "baselines" ? "baselines" : "shots";
  const raw = (q.get("name") ?? "").replace(/\.png$/i, "");
  const name = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120) || `capture-${Date.now()}`;
  return join(root, dir, `${name}.png`);
}

export function captureHandler(root: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    const file = capturePath(root, (req.url ?? "").split("?")[1] ?? "");
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
