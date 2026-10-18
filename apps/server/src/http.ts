import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

/** Reads the body, refusing it with 413 as soon as it passes `max` bytes (declared or streamed). */
export async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, "body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  const text = await readBody(req, max);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

/** Ends a refused request without reading the rest; closes the socket so the client stops sending. */
export function refuse(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  send(res, status, { error: message }, status === 413 ? { connection: "close" } : {});
}
