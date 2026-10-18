import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { TelemetryEvent } from "@exiled/telemetry";

export interface Served { url: string; close(): Promise<void> }

export async function serve(handler: RequestListener): Promise<Served> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export function startEvent(t = 0): TelemetryEvent {
  return { k: "start", t, screen: "1920x1080", dpr: 1, gpu: "NVIDIA RTX 4070", lang: "en-US", ref: "reddit.com", pwa: false, cores: 16, memGb: 8, touch: false };
}

export function batch(over: { sid?: string; seq?: number; events?: TelemetryEvent[]; build?: string; builtAt?: number } = {}) {
  return {
    v: 1,
    sid: over.sid ?? randomUUID(),
    build: over.build ?? "0.3.1+abc1234",
    builtAt: over.builtAt ?? 1_000,
    seq: over.seq ?? 0,
    events: over.events ?? [startEvent()],
  };
}

export async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain", "user-agent": CHROME, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
