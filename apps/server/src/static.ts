import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolves a URL path inside `root`, or null when it would leave it. */
export function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const full = resolve(base, `.${decoded.startsWith("/") ? "" : "/"}${decoded}`);
  return full === base || full.startsWith(base + sep) ? full : null;
}

function sendFile(res: ServerResponse, path: string, cache: string, head: boolean): void {
  const st = statSync(path);
  res.writeHead(200, {
    "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    "content-length": st.size,
    "cache-control": cache,
  });
  if (head) {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}

/** The admin SPA: real files, long cache under /assets/, every other miss is index.html. */
export function serveStatic(root: string | undefined, req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const notFound = () => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  if (!root) return notFound();
  const path = pathname || "/";
  const full = safeJoin(root, path);
  if (!full) return notFound();
  const head = req.method === "HEAD";
  const isAsset = path.startsWith("/assets/");
  if (path !== "/" && isFile(full)) return sendFile(res, full, isAsset ? "public, max-age=31536000, immutable" : "no-cache", head);
  if (isAsset || extname(path)) return notFound();
  const index = safeJoin(root, "/index.html");
  if (!index || !isFile(index)) return notFound();
  sendFile(res, index, "no-cache", head);
}
