import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { MAX_BATCH_BYTES, parseBatch } from "@exiled/telemetry";
import { createAdminHandler } from "./admin";
import { Admins } from "./auth";
import { openDb, tx } from "./db";
import { IngestCounters, Monitor } from "./health";
import { HttpError, readJson, refuse, send } from "./http";
import { clientIp } from "./ip";
import { LiveOps } from "./liveops";
import { createLogger, type Logger, type ServerLogLine } from "./log";
import { parseAccessLine, tailAccessLog, type Hit, type TailState } from "./nginx";
import { BOOT, HOUR, MAX_DAYS, PAGE_LOAD, Queries } from "./queries";
import { FailureWindow, TokenBucket } from "./ratelimit";
import { DAY, Store, dayStart, utcDay } from "./store";

export interface AppOptions {
  /** SQLite path, or ":memory:". */
  db: string;
  now?: () => number;
  /** Admin SPA `dist`; static serving is off without it. */
  staticDir?: string;
  nginxLogDir?: string;
  nginxStatusUrl?: string;
  secureCookie?: boolean;
  /** JSON log lines to stdout (journald). Off in tests. */
  stdoutLog?: boolean;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface App {
  db: DatabaseSync;
  ingest: Handler;
  admin: Handler;
  admins: Admins;
  store: Store;
  log: Logger;
  logRing(): string[];
  jobs: {
    /** Close silent sessions, sample the live count, prune limiters. */
    minute(): void;
    /** Retention deletes and the daily rollup. */
    hourly(): void;
    /** Read new nginx access lines into `hits`. */
    tailLogs(): void;
    /** cpu/mem/nginx samples. */
    sampleHost(): Promise<void>;
  };
  /** Starts the job timers (serve only). */
  start(): void;
  close(): void;
}

/** Hits carry the /24 or /48 only; the caller has already dropped the full address. */
export function insertHits(db: DatabaseSync, hits: Hit[]): number {
  const ins = db.prepare("INSERT INTO hits (t, ip_prefix, method, path, status, bytes, referrer, ua, bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const h of hits) ins.run(h.t, h.ipPrefix, h.method, h.path, h.status, h.bytes, h.referrer, h.ua, h.bot ? 1 : 0);
  return hits.length;
}

const SILENT_MS = 10 * 60_000;
const IP_BURST = 10;
const SID_BURST = 10;
const PER_MIN = 30;

export function createApp(opts: AppOptions): App {
  const now = opts.now ?? Date.now;
  const db = openDb(opts.db);
  const log = createLogger(now, opts.stdoutLog ?? true);
  const store = new Store(db, now);
  const queries = new Queries(db, now);
  const counters = new IngestCounters(now);
  const monitor = new Monitor(queries, now, opts.nginxStatusUrl ?? "http://127.0.0.1:8088/nginx_status", counters);
  const liveops = new LiveOps(db, now);
  const admins = new Admins(db, now);
  const ipLimit = new TokenBucket(IP_BURST, PER_MIN / 60_000, now);
  const sidLimit = new TokenBucket(SID_BURST, PER_MIN / 60_000, now);
  const loginFailures = new FailureWindow(5, 15 * 60_000, now);
  const nginxLogDir = opts.nginxLogDir ?? "/var/log/nginx";

  const reject = (res: ServerResponse, status: number, msg: string) => {
    counters.rejected();
    refuse(res, status, msg);
  };

  async function ingestBatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = clientIp(req);
    if (!ipLimit.take(ip)) return reject(res, 429, "rate limited");
    let body: unknown;
    try {
      body = await readJson(req, MAX_BATCH_BYTES);
    } catch (e) {
      if (e instanceof HttpError) return reject(res, e.status, e.message);
      throw e;
    }
    const parsed = parseBatch(body);
    if (!parsed.ok) return reject(res, 400, parsed.error);
    if (!sidLimit.take(parsed.batch.sid)) return reject(res, 429, "rate limited");
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 400);
    store.ingest(parsed.batch, { ip, ua, headers: req.headers });
    counters.ok();
    send(res, 204);
  }

  const ingest: Handler = (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const done = (p: Promise<void>) =>
      p.catch((e: unknown) => {
        log.error("ingest failed", { err: e instanceof Error ? e.message : String(e) });
        refuse(res, 500, "internal error");
      });
    if (path === "/api/t") {
      if (req.method !== "POST") return refuse(res, 405, "method not allowed");
      return void done(ingestBatch(req, res));
    }
    if (path === "/api/config" && (req.method === "GET" || req.method === "HEAD")) {
      return send(res, 200, liveops.get(), { "cache-control": "no-store" });
    }
    refuse(res, 404, "not found");
  };

  const adminHandler = createAdminHandler({
    admins, queries, monitor, liveops, log, loginFailures, now, staticDir: opts.staticDir, nginxLogDir,
    secureCookie: opts.secureCookie ?? false,
  });
  const admin: Handler = (req, res) => void adminHandler(req, res);

  function minute(): void {
    const t = now();
    db.prepare("UPDATE sessions SET ended_at = last_seen WHERE ended_at IS NULL AND last_seen < ?").run(t - SILENT_MS);
    monitor.sampleLive();
    ipLimit.prune();
    sidLimit.prune();
    loginFailures.prune();
  }

  function rollup(day: string): void {
    const from = Date.parse(`${day}T00:00:00Z`);
    const to = from + DAY;
    const s = db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT visitor) AS v, COALESCE(SUM(play_seconds), 0) AS p FROM sessions WHERE started_at >= ? AND started_at < ?").get(from, to) as { n: number; v: number; p: number };
    const h = db.prepare(
      `SELECT COALESCE(SUM(bot = 0 AND ${PAGE_LOAD}), 0) AS pl, COALESCE(SUM(bot = 0 AND ${BOOT}), 0) AS bt,
         COALESCE(SUM(bot = 0), 0) AS hu, COALESCE(SUM(bot), 0) AS bo FROM hits WHERE t >= ? AND t < ?`).get(from, to) as { pl: number; bt: number; hu: number; bo: number };
    db.prepare(
      `INSERT INTO daily (day, sessions, visitors, play_seconds, page_loads, humans, bots, boots) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET sessions = excluded.sessions, visitors = excluded.visitors, play_seconds = excluded.play_seconds,
         page_loads = MAX(page_loads, excluded.page_loads), humans = MAX(humans, excluded.humans), bots = MAX(bots, excluded.bots),
         boots = COALESCE(MAX(boots, excluded.boots), boots, excluded.boots)`,
    // A day the hits prune has cut into (it cuts at the time of day) has lost hours, so its
    // boots stay what they were, or unknown: MAX keeps the other counts for the same reason.
    ).run(day, s.n, s.v, s.p, h.pl, h.hu, h.bo, from < now() - MAX_DAYS * DAY ? null : h.bt);
  }

  let rolledAll = false;
  function hourly(): void {
    const t = now();
    // Roll up before deleting, so a day's traffic outlives its raw hits.
    const days = rolledAll ? 2 : MAX_DAYS + 1;
    for (let i = 0; i < days; i++) rollup(utcDay(dayStart(t) - i * DAY));
    rolledAll = true;
    const cut = t - MAX_DAYS * DAY;
    tx(db, () => {
      db.prepare("DELETE FROM events WHERE t < ?").run(cut);
      db.prepare("DELETE FROM hits WHERE t < ?").run(cut);
      db.prepare("DELETE FROM error_hits WHERE t < ?").run(cut);
      db.prepare("DELETE FROM batches WHERE t < ?").run(t - 7 * DAY);
      db.prepare("DELETE FROM metrics WHERE t < ?").run(cut);
    });
    admins.purgeExpired();
  }

  function tailLogs(): void {
    try {
      const row = db.prepare("SELECT ino, offset FROM log_state WHERE name = 'access'").get() as TailState | undefined;
      const { lines, state } = tailAccessLog(nginxLogDir, row ?? null);
      let n = 0;
      tx(db, () => {
        n = insertHits(db, lines.map(parseAccessLine).filter((h): h is Hit => h !== null));
        if (state) db.prepare("INSERT INTO log_state (name, ino, offset) VALUES ('access', ?, ?) ON CONFLICT(name) DO UPDATE SET ino = excluded.ino, offset = excluded.offset").run(state.ino, state.offset);
      });
      if (n) log.info("access log read", { hits: n });
    } catch (e) {
      log.error("access log tail failed", { err: e instanceof Error ? e.message : String(e) });
    }
  }

  const timers: NodeJS.Timeout[] = [];
  const guard = (name: string, fn: () => unknown) => () => {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((e: unknown) => log.error(`${name} failed`, { err: e instanceof Error ? e.message : String(e) }));
    } catch (e) {
      log.error(`${name} failed`, { err: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
    db, ingest, admin, admins, store, log,
    logRing: () => log.ring().map((l: ServerLogLine) => l.text),
    jobs: { minute, hourly, tailLogs, sampleHost: () => monitor.sampleHost() },
    start() {
      guard("hourly", hourly)();
      guard("tail", tailLogs)();
      guard("host", () => monitor.sampleHost())();
      timers.push(
        setInterval(guard("minute", minute), 60_000),
        setInterval(guard("tail", tailLogs), 60_000),
        setInterval(guard("host", () => monitor.sampleHost()), 5 * 60_000),
        setInterval(guard("hourly", hourly), HOUR),
      );
    },
    close() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
      db.close();
    },
  };
}
