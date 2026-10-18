/**
 * Live ops: `GET /api/config` once at boot, parsed defensively into `LiveConfig`.
 * Anything the server sends that does not fit is dropped, never trusted.
 */
import React from "react";
import { DEFAULT_LIVE_CONFIG, type LiveConfig } from "@exiled/telemetry";
import { telemetry } from "./client";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseLiveConfig(raw: unknown): LiveConfig {
  const out: LiveConfig = { flags: {}, telemetry: true };
  if (!isObj(raw)) return out;
  const m = raw.motd;
  if (isObj(m) && typeof m.id === "string" && typeof m.text === "string" && m.text !== "") {
    out.motd = { id: m.id.slice(0, 80), text: m.text.slice(0, 500), level: m.level === "warn" ? "warn" : "info" };
  }
  const mt = raw.maintenance;
  if (isObj(mt) && typeof mt.text === "string" && mt.text !== "") out.maintenance = { text: mt.text.slice(0, 500) };
  if (typeof raw.minBuiltAt === "number" && Number.isFinite(raw.minBuiltAt) && raw.minBuiltAt > 0) out.minBuiltAt = raw.minBuiltAt;
  if (isObj(raw.flags)) {
    for (const [k, v] of Object.entries(raw.flags)) {
      if (typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) out.flags[k] = v;
    }
  }
  if (raw.telemetry === false) out.telemetry = false;
  return out;
}

let current: LiveConfig = DEFAULT_LIVE_CONFIG;
const listeners = new Set<() => void>();

function set(next: LiveConfig): void {
  current = next;
  for (const l of listeners) l();
}

/** One fetch, 3 s timeout, never throws. Applies the telemetry kill switch. */
export async function loadLiveConfig(fetcher: typeof fetch = fetch): Promise<LiveConfig> {
  try {
    const res = await fetcher("/api/config", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return current;
    set(parseLiveConfig(await res.json()));
  } catch {
    /* offline or no server: defaults stand */
  }
  if (!current.telemetry) telemetry.setEnabled(false);
  return current;
}

/** Remote switch or tuning value; `fallback` until the config arrives or when the flag is absent. */
export function flag<T extends boolean | number | string>(name: string, fallback: T): T {
  const v = current.flags[name];
  return typeof v === typeof fallback ? (v as T) : fallback;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useLiveConfig(): LiveConfig {
  return React.useSyncExternalStore(subscribe, () => current, () => current);
}

/** Test seam. */
export const _setLiveConfig = set;
