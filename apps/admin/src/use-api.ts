import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminRoutes } from "@exiled/telemetry";
import { UnauthorizedError, call, type Query, type RouteKey } from "./api";

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** When `data` was fetched (ms). */
  at: number | null;
  reload: () => void;
}

/**
 * Fetches a contract route and keeps it fresh every `refreshMs` while the tab is visible. A change of
 * route, params or query drops the old data so one record is never shown under another's title.
 */
export function useApi<K extends RouteKey>(
  route: K,
  opts: { params?: Record<string, string>; query?: Query } = {},
  refreshMs?: number,
): ApiState<AdminRoutes[K]> {
  const key = JSON.stringify([route, opts.params ?? null, opts.query ?? null]);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; data?: AdminRoutes[K]; error: string | null; loading: boolean; at: number | null }>({
    key,
    error: null,
    loading: true,
    at: null,
  });
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const ctl = new AbortController();
    let alive = true;
    setState((s) => (s.key === key ? { ...s, loading: true } : { key, error: null, loading: true, at: null }));
    call(route, { ...optsRef.current, signal: ctl.signal }).then(
      (data) => {
        if (alive) setState({ key, data, error: null, loading: false, at: Date.now() });
      },
      (e: unknown) => {
        if (!alive || (e instanceof DOMException && e.name === "AbortError") || e instanceof UnauthorizedError) return;
        setState((s) => ({ ...s, key, error: e instanceof Error ? e.message : String(e), loading: false }));
      },
    );
    return () => {
      alive = false;
      ctl.abort();
    };
  }, [key, tick, route]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) setTick((t) => t + 1);
    }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : null,
    loading: current ? state.loading : true,
    at: current ? state.at : null,
    reload,
  };
}
