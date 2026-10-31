/**
 * The game's telemetry client: a queue, a 30 s beat and a transport.
 *
 * Cookieless: `sid` lives in memory for one page load and nothing is written to
 * any storage. Read-only toward the game: it is fed, it never feeds back, and it
 * never throws or awaits on a game path.
 */
import { MAX_EVENTS, type Batch, type TelemetryEvent, type View } from "@exiled/telemetry";

type Distribute<E> = E extends TelemetryEvent ? Omit<E, "t"> : never;
/** An event before the client stamps `t` on it. */
export type EventDraft = Distribute<TelemetryEvent>;

export interface Transport {
  /** True when the browser accepted the body for delivery. */
  beacon(url: string, body: string): boolean;
  send(url: string, body: string): void;
}

export interface BeatContext {
  area?: "hideout" | "map";
  biome?: string;
  tier?: number;
  level?: number;
  classId?: string;
  caches?: number;
}

export interface TelemetryOptions {
  build: string;
  builtAt: number;
  /** Ms since the session started. */
  now?: () => number;
  visible?: () => boolean;
  transport?: Transport;
  /** False makes every call a no-op. */
  enabled?: boolean;
  intervalMs?: number;
}

const QUEUE_CAP = 500;
const URL_T = "/api/t";

export const browserTransport: Transport = {
  beacon: (url, body) => {
    try {
      return typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))
        : false;
    } catch {
      return false;
    }
  },
  send: (url, body) => {
    try {
      void fetch(url, { method: "POST", keepalive: true, body, headers: { "content-type": "text/plain" } }).catch(() => {});
    } catch {
      /* no network, no telemetry */
    }
  },
};

/** Global Privacy Control or Do Not Track: honoured, never overridden. */
export function privacySignal(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return false;
  const n = nav as Navigator & { globalPrivacyControl?: boolean };
  return n.globalPrivacyControl === true || n.doNotTrack === "1";
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i]!;
}

export function createTelemetry(opts: TelemetryOptions) {
  const now = opts.now ?? (() => performance.now());
  const visible = opts.visible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const transport = opts.transport ?? browserTransport;
  let enabled = (opts.enabled ?? true) && !privacySignal();
  const sid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
  let seq = 0;
  let queue: TelemetryEvent[] = [];
  let view: View = "boot";
  let fpsSamples: number[] = [];
  let activeMs = 0;
  let visibleSince: number | null = visible() ? now() : null;
  let context: () => BeatContext = () => ({});
  let loading = false;
  const beatHooks = new Set<() => void>();
  const endHooks = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stamp = (e: EventDraft): TelemetryEvent => ({ ...e, t: Math.max(0, Math.round(now())) }) as TelemetryEvent;

  function track(e: EventDraft): void {
    if (!enabled) return;
    try {
      queue.push(stamp(e));
      if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
    } catch {
      /* never on a game path */
    }
  }

  function activeSeconds(): number {
    const live = visibleSince === null ? 0 : now() - visibleSince;
    const s = Math.round((activeMs + live) / 1000);
    activeMs = 0;
    if (visibleSince !== null) visibleSince = now();
    return s;
  }

  function beat(): void {
    for (const hook of beatHooks) {
      try { hook(); } catch { /* a hook must not stop the beat */ }
    }
    const e: EventDraft = { k: "beat", view, active: activeSeconds() };
    if (fpsSamples.length > 0) {
      const sorted = [...fpsSamples].sort((a, b) => a - b);
      Object.assign(e, { fps: Math.round(percentile(sorted, 0.5)), fpsLow: Math.round(percentile(sorted, 0.05)) });
      fpsSamples = [];
    }
    try { Object.assign(e, context()); } catch { /* context is best effort */ }
    track(e);
  }

  /** Sends everything queued, in batches of at most MAX_EVENTS. */
  function flush(useBeacon = false): void {
    if (!enabled) { queue = []; return; }
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_EVENTS);
      const batch: Batch = { v: 1, sid, build: opts.build, builtAt: opts.builtAt, seq: seq++, events };
      const body = JSON.stringify(batch);
      try {
        if (!(useBeacon && transport.beacon(URL_T, body))) transport.send(URL_T, body);
      } catch {
        /* swallowed */
      }
    }
  }

  function onVisibility(): void {
    if (!visible()) {
      if (visibleSince !== null) { activeMs += now() - visibleSince; visibleSince = null; }
      beat();
      flush(true);
    } else if (visibleSince === null) {
      visibleSince = now();
    }
  }

  function onPageHide(): void {
    if (visibleSince !== null) { activeMs += now() - visibleSince; visibleSince = null; }
    beat();
    for (const hook of endHooks) {
      try { hook(); } catch { /* a hook must not stop the end */ }
    }
    let area: BeatContext["area"];
    try { area = context().area; } catch { /* context is best effort */ }
    track({ k: "end", view, loading, ...(area ? { area } : {}) });
    flush(true);
  }

  return {
    sid,
    track,
    setView(v: View): void {
      view = v;
      track({ k: "view", view: v });
    },
    /** One fps reading per second from the render loop. */
    fps(sample: number): void {
      if (enabled && Number.isFinite(sample) && sample > 0) fpsSamples.push(sample);
    },
    setContext(fn: (() => BeatContext) | null): void { context = fn ?? (() => ({})); },
    /** Runs just before each beat so a counter can turn into one event. */
    addBeatHook(fn: () => void): () => void {
      beatHooks.add(fn);
      return () => { beatHooks.delete(fn); };
    },
    /** Runs once as the page goes away, before `end`, so a last word rides the final beacon. */
    addEndHook(fn: () => void): () => void {
      endHooks.add(fn);
      return () => { endHooks.delete(fn); };
    },
    /** A loading plate is up; `end` reports it, so a player who left mid-load is told apart. */
    setLoading(on: boolean): void { loading = on; },
    /** The server's kill switch; false also discards what is queued. */
    setEnabled(on: boolean): void {
      enabled = on && !privacySignal() && (opts.enabled ?? true);
      if (!enabled) queue = [];
    },
    isEnabled: () => enabled,
    flush,
    /** Starts the 30 s beat and the page lifecycle listeners. */
    start(): () => void {
      if (!enabled || timer !== undefined) return () => {};
      timer = setInterval(() => {
        if (!visible()) return;
        beat();
        flush();
      }, opts.intervalMs ?? 30_000);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
      if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
      return () => {
        clearInterval(timer);
        timer = undefined;
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
        if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
      };
    },
    /** Test seams. */
    _onVisibility: onVisibility,
    _onPageHide: onPageHide,
  };
}

export type Telemetry = ReturnType<typeof createTelemetry>;

export const BUILT_AT = Number(import.meta.env?.VITE_EC_BUILT_AT ?? 0) || 0;

const search = typeof location === "undefined" ? "" : location.search;

/** The page's one client. Off in dev unless the URL says `?telemetry`. */
export const telemetry: Telemetry = createTelemetry({
  build: import.meta.env?.VITE_EC_BUILD ?? "0.0.0+dev",
  builtAt: BUILT_AT,
  enabled: !import.meta.env?.DEV || new URLSearchParams(search).has("telemetry"),
});
