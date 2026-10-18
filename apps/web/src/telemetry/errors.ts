/**
 * Error capture. Same message and stack is counted once per 60 s per session,
 * so a loop in a render path cannot flood the queue.
 */
import type { ErrorSource } from "@exiled/telemetry";
import { telemetry, type Telemetry } from "./client";

const DEDUPE_MS = 60_000;

export function createErrorReporter(t: Telemetry, clock: () => number = () => Date.now()) {
  const last = new Map<string, number>();
  return function report(src: ErrorSource, msg: string, stack?: string, url?: string): void {
    try {
      const key = `${src}|${msg}|${stack ?? ""}`;
      const at = clock();
      const prev = last.get(key);
      if (prev !== undefined && at - prev < DEDUPE_MS) return;
      last.set(key, at);
      const e: Parameters<Telemetry["track"]>[0] = { k: "error", src, msg: msg.slice(0, 500) };
      if (stack) Object.assign(e, { stack: stack.slice(0, 4000) });
      if (url) Object.assign(e, { url: url.slice(0, 200) });
      t.track(e);
    } catch {
      /* reporting an error must not raise one */
    }
  };
}

export const reportError = createErrorReporter(telemetry);

/** `window` error and unhandledrejection. Returns the remover. */
export function installErrorCapture(report = reportError): () => void {
  const onError = (e: ErrorEvent) => report("window", e.message || String(e.error), (e.error as Error | undefined)?.stack, e.filename);
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as unknown;
    report("promise", r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
