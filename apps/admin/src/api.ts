import type { AdminRoutes } from "@exiled/telemetry";

export type RouteKey = keyof AdminRoutes;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The session is gone; the console has already been sent back to the gate. */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface CallOptions {
  params?: Record<string, string>;
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

const SAFE = new Set(["GET", "HEAD"]);

/** One typed call per contract route: `call("GET /api/errors/:fp", { params: { fp } })`. */
export async function call<K extends RouteKey>(route: K, opts: CallOptions = {}): Promise<AdminRoutes[K]> {
  const space = route.indexOf(" ");
  const method = route.slice(0, space);
  const path = route.slice(space + 1).replace(/:(\w+)/g, (_, name: string) => {
    const v = opts.params?.[name];
    if (v === undefined) throw new Error(`missing path parameter ${name} for ${route}`);
    return encodeURIComponent(v);
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const search = qs.toString();
  const url = search ? `${path}?${search}` : path;

  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, credentials: "same-origin", headers, signal: opts.signal };
  if (!SAFE.has(method)) {
    headers["X-EC-Admin"] = "1";
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
  }

  const res = await fetch(url, init);
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `request failed (${res.status})`;
    if (res.status === 401) {
      onUnauthorized?.();
      throw new UnauthorizedError(msg);
    }
    throw new ApiError(res.status, msg);
  }
  return data as AdminRoutes[K];
}
