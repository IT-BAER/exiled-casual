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

/**
 * A thrown value that is not an Error, as "[type] text". Only an Error carries a
 * message; for anything else Chrome's event reads "Uncaught " and nothing more.
 */
export function thrownText(v: unknown): string {
  let type: string = typeof v;
  try {
    if (typeof v === "object" && v !== null) type = v.constructor?.name || "Object";
  } catch { /* a revoked Proxy throws on any property read */ }
  let text = "";
  try {
    text = typeof v === "string" ? v : v instanceof Event ? v.type : JSON.stringify(v) ?? String(v);
  } catch {
    try { text = String(v); } catch { /* an object without a prototype has no toString */ }
  }
  return `[${type}] ${text}`;
}

/** `instanceof` that cannot throw: a revoked Proxy throws on the prototype read. */
export function isError(v: unknown): boolean {
  try {
    // Not every engine makes DOMException an Error subclass.
    return v instanceof Error || (typeof DOMException !== "undefined" && v instanceof DOMException);
  } catch {
    return false;
  }
}

/** `window` error and unhandledrejection. Returns the remover. */
export function installErrorCapture(report = reportError): () => void {
  const onError = (e: ErrorEvent) => {
    const v = e.error as unknown;
    const err = isError(v) ? (v as Error) : null;
    // Edge reports a DOMException's event message as a bare "Uncaught ".
    const msg = err
      ? (e.message.trim() && e.message.trim() !== "Uncaught" ? e.message : `Uncaught ${err.name}: ${err.message}`)
      : v == null ? e.message || String(v) : `Uncaught ${thrownText(v)}`;
    report("window", msg, err?.stack, e.filename);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as unknown;
    const err = isError(r) ? (r as Error) : null;
    report("promise", err ? err.message : r == null ? String(r) : thrownText(r), err?.stack);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
