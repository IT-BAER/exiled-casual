import type { Health, HealthSummary, Milestone, Overview, Point } from "@exiled/telemetry";
import { HostMonitor, fetchStubStatus, type HostSample, type NginxStatus } from "./host";
import { evaluateMilestones, type MilestoneStats } from "./milestones";
import { HOUR, Queries, parseRange } from "./queries";
import { DAY, dayStart } from "./store";

const MIN = 60_000;
const FIVE = 5 * MIN;

/** Accepted and rejected ingest requests per minute, kept for an hour. */
export class IngestCounters {
  private readonly perMin = new Map<number, { ok: number; rejected: number }>();
  constructor(private readonly now: () => number) {}

  private bucket(): { ok: number; rejected: number } {
    const m = Math.floor(this.now() / MIN) * MIN;
    let b = this.perMin.get(m);
    if (!b) {
      b = { ok: 0, rejected: 0 };
      this.perMin.set(m, b);
      for (const k of this.perMin.keys()) if (k < m - HOUR) this.perMin.delete(k);
    }
    return b;
  }

  ok(): void { this.bucket().ok++; }
  rejected(): void { this.bucket().rejected++; }

  sum(key: "ok" | "rejected", sinceMs: number): number {
    const cut = this.now() - sinceMs;
    let n = 0;
    for (const [t, b] of this.perMin) if (t + MIN > cut) n += b[key];
    return n;
  }
}

type State = "ok" | "warn" | "fail";
const worst = (states: State[]): State => (states.includes("fail") ? "fail" : states.includes("warn") ? "warn" : "ok");

export class Monitor {
  private readonly host = new HostMonitor();
  private lastHost: HostSample | null = null;
  private nginxPrev: NginxStatus | null = null;
  private nginxLast: NginxStatus | null = null;
  private nginxCheckedAt = 0;
  readonly startedAt: number;

  constructor(
    private readonly q: Queries,
    private readonly now: () => number,
    private readonly nginxStatusUrl: string,
    readonly ingest: IngestCounters,
  ) {
    this.startedAt = now();
  }

  private kv(key: string): string | null {
    return this.q.get<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)?.value ?? null;
  }
  private setKv(key: string, value: string): void {
    this.q.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  peakAllTime(): { v: number; t: number } {
    const raw = this.kv("peak");
    return raw ? (JSON.parse(raw) as { v: number; t: number }) : { v: 0, t: 0 };
  }

  /** Every minute: the live count into metrics and the all-time peak. */
  sampleLive(): number {
    const now = this.now();
    const live = this.q.liveCount(now);
    this.q.db.prepare("INSERT INTO metrics (kind, t, v) VALUES ('live', ?, ?) ON CONFLICT(kind, t) DO UPDATE SET v = MAX(v, excluded.v)").run(Math.floor(now / MIN) * MIN, live);
    if (live > this.peakAllTime().v) this.setKv("peak", JSON.stringify({ v: live, t: now }));
    return live;
  }

  /** Every 5 minutes: cpu, memory and nginx request rate. */
  async sampleHost(): Promise<void> {
    const now = this.now();
    const t = Math.floor(now / FIVE) * FIVE;
    const h = this.host.sample();
    this.lastHost = h;
    const ins = this.q.db.prepare("INSERT OR REPLACE INTO metrics (kind, t, v) VALUES (?, ?, ?)");
    ins.run("cpu", t, h.cpuPct);
    ins.run("mem", t, h.memUsedMb);
    await this.checkNginx(now);
    const rate = this.reqPerSec();
    if (rate !== null) ins.run("reqs", t, rate);
  }

  private async checkNginx(now: number): Promise<NginxStatus | null> {
    const s = await fetchStubStatus(this.nginxStatusUrl, now);
    this.nginxCheckedAt = now;
    if (s) {
      if (!this.nginxLast || s.t - this.nginxLast.t >= 1000) this.nginxPrev = this.nginxLast;
      this.nginxLast = s;
    } else {
      this.nginxPrev = null;
      this.nginxLast = null;
    }
    return s;
  }

  private reqPerSec(): number | null {
    const a = this.nginxPrev, b = this.nginxLast;
    if (!a || !b || b.t <= a.t || b.requests < a.requests) return null;
    return Math.round(((b.requests - a.requests) / ((b.t - a.t) / 1000)) * 100) / 100;
  }

  private dbMb(): number {
    const pages = this.q.num("PRAGMA page_count");
    const size = this.q.num("PRAGMA page_size");
    return Math.round(((pages * size) / 1024 / 1024) * 10) / 10;
  }

  private statusLastHour(min: number, max: number): number {
    return this.q.num("SELECT COUNT(*) FROM hits WHERE t >= ? AND status >= ? AND status <= ?", this.now() - HOUR, min, max);
  }

  async summary(): Promise<HealthSummary> {
    const now = this.now();
    if (!this.lastHost) this.lastHost = this.host.sample();
    if (now - this.nginxCheckedAt > MIN) await this.checkNginx(now);
    const h = this.lastHost;
    const checks: HealthSummary["checks"] = [];
    const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
    const level = (p: number): State => (p > 95 ? "fail" : p > 85 ? "warn" : "ok");
    const disk = pct(h.diskUsedGb, h.diskTotalGb);
    checks.push({ id: "disk", label: "Disk", state: level(disk), detail: `${disk.toFixed(1)}% of ${h.diskTotalGb} GB used` });
    const mem = pct(h.memUsedMb, h.memTotalMb);
    checks.push({ id: "mem", label: "Memory", state: level(mem), detail: `${mem.toFixed(1)}% of ${h.memTotalMb} MB used` });
    checks.push({ id: "load", label: "Load", state: h.load[0] > h.cores * 1.5 ? "warn" : "ok", detail: `load1 ${h.load[0].toFixed(2)} on ${h.cores} cores` });
    checks.push({ id: "nginx", label: "nginx", state: this.nginxLast ? "ok" : "fail", detail: this.nginxLast ? `${this.nginxLast.active} active connections` : "stub_status unreachable" });
    const total = this.q.num("SELECT COUNT(*) FROM hits WHERE t >= ?", now - HOUR);
    const s5 = this.statusLastHour(500, 599);
    const share = total ? (s5 / total) * 100 : 0;
    checks.push({ id: "5xx", label: "Server errors", state: share > 1 ? "warn" : "ok", detail: `${s5} of ${total} requests (${share.toFixed(2)}%) in the last hour` });
    const fresh = this.q.num("SELECT COUNT(*) FROM error_groups WHERE first_seen >= ?", now - HOUR);
    checks.push({ id: "errors", label: "New error groups", state: fresh > 0 ? "warn" : "ok", detail: `${fresh} new in the last hour` });
    const dbMb = this.dbMb();
    checks.push({ id: "db", label: "Database", state: dbMb > 1024 ? "warn" : "ok", detail: `${dbMb} MB` });
    const rejected = this.ingest.sum("rejected", HOUR);
    checks.push({ id: "ingest", label: "Ingest rejects", state: rejected > 100 ? "warn" : "ok", detail: `${rejected} rejected in the last hour` });
    return { state: worst(checks.map((c) => c.state)), checks };
  }

  private series(kind: string, from: number): Point[] {
    return this.q.all<Point>("SELECT t, v FROM metrics WHERE kind = ? AND t >= ? ORDER BY t", kind, from);
  }

  async health(): Promise<Health> {
    const now = this.now();
    this.lastHost = this.host.sample();
    await this.checkNginx(now);
    const summary = await this.summary();
    const from = now - 24 * HOUR;
    const live = this.q.all<Point>(`SELECT (t / ${FIVE}) * ${FIVE} AS t, MAX(v) AS v FROM metrics WHERE kind = 'live' AND t >= ? GROUP BY 1 ORDER BY 1`, from);
    return {
      summary,
      host: this.lastHost,
      nginx: {
        up: !!this.nginxLast,
        active: this.nginxLast?.active ?? null,
        reqPerSec: this.reqPerSec(),
        status5xxLastHour: this.statusLastHour(500, 599),
        status4xxLastHour: this.statusLastHour(400, 499),
      },
      server: {
        uptimeSeconds: Math.round((now - this.startedAt) / 1000),
        rssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
        dbMb: this.dbMb(),
        ingestPerMin: Math.round((this.ingest.sum("ok", FIVE) / 5) * 10) / 10,
        rejectedLastHour: this.ingest.sum("rejected", HOUR),
        node: process.version,
      },
      series: { cpu: this.series("cpu", from), mem: this.series("mem", from), reqs: this.series("reqs", from), live },
    };
  }

  milestones(): Milestone[] {
    const q = this.q;
    const now = this.now();
    const lastGroup = q.num("SELECT COALESCE(MAX(first_seen), 0) FROM error_groups");
    const firstSession = q.num("SELECT COALESCE(MIN(started_at), 0) FROM sessions");
    const calmSince = lastGroup || firstSession;
    const peak = this.peakAllTime();
    const stats: MilestoneStats = {
      sessions: q.num("SELECT COUNT(*) FROM sessions"),
      visitorDays: q.num("SELECT COUNT(*) FROM (SELECT DISTINCT visitor, day FROM sessions)"),
      playSeconds: q.num("SELECT COALESCE(SUM(play_seconds), 0) FROM sessions"),
      mapsCompleted: q.num("SELECT COALESCE(SUM(maps), 0) FROM sessions"),
      uniquesDropped: q.num("SELECT COALESCE(SUM(json_extract(data, '$.unique')), 0) FROM events WHERE k = 'loot'"),
      maxLevel: q.num("SELECT COALESCE(MAX(max_level), 0) FROM sessions"),
      peakConcurrent: peak.v,
      daysWithoutNewError: calmSince ? (now - calmSince) / DAY : 0,
    };
    const unlocked: Record<string, number> = {};
    for (const r of q.all<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key LIKE 'milestone:%'")) unlocked[r.key.slice(10)] = Number(r.value);
    const derive = (id: string): number | null => {
      const n = /^sessions-(\d+)$/.exec(id);
      if (n) return q.get<{ t: number }>("SELECT started_at AS t FROM sessions ORDER BY started_at LIMIT 1 OFFSET ?", Number(n[1]) - 1)?.t ?? null;
      if (id === "first-map") return q.get<{ t: number | null }>("SELECT MIN(t) AS t FROM events WHERE k = 'mapDone'")?.t ?? null;
      if (id === "first-unique") return q.get<{ t: number | null }>("SELECT MIN(t) AS t FROM events WHERE k = 'loot' AND json_extract(data, '$.unique') > 0")?.t ?? null;
      if (id === "level-20") return q.get<{ t: number | null }>("SELECT MIN(t) AS t FROM events WHERE (k = 'level' OR k = 'charAge') AND json_extract(data, '$.level') >= 20")?.t ?? null;
      if (id.startsWith("peak-")) return peak.t || null;
      if (id === "calm-7") return calmSince + 7 * DAY;
      return null;
    };
    const { milestones, newlyUnlocked } = evaluateMilestones(stats, unlocked, now, derive);
    for (const [id, t] of Object.entries(newlyUnlocked)) this.setKv(`milestone:${id}`, String(t));
    return milestones;
  }

  async overview(params: URLSearchParams): Promise<Overview> {
    const q = this.q;
    const now = this.now();
    const r = parseRange(params, now);
    const today = dayStart(now);
    const liveNow = q.liveCount(now);
    const peakToday = Math.max(liveNow, q.num("SELECT COALESCE(MAX(v), 0) FROM metrics WHERE kind = 'live' AND t >= ?", today));
    const stored = this.peakAllTime();
    const peakAllTime = liveNow > stored.v ? { v: liveNow, t: now } : stored;
    const entries = q.get<{ n: number; old: number | null }>("SELECT COUNT(*) AS n, SUM(json_extract(data, '$.ageDays') != '0') AS old FROM events WHERE k = 'charAge' AND t >= ?", now - 7 * DAY);
    const from48 = now - 48 * HOUR;
    const sessionsByHour = q.all<Point>(`SELECT (started_at / ${HOUR}) * ${HOUR} AS t, COUNT(*) AS v FROM sessions WHERE started_at >= ? GROUP BY 1`, from48);
    const liveByHour = q.all<Point>(`SELECT (t / ${HOUR}) * ${HOUR} AS t, MAX(v) AS v FROM metrics WHERE kind = 'live' AND t >= ? GROUP BY 1`, from48);
    const fill = (rows: Point[]): Point[] => {
      const m = new Map(rows.map((p) => [p.t, p.v]));
      const out: Point[] = [];
      for (let t = Math.floor(from48 / HOUR) * HOUR; t <= now; t += HOUR) out.push({ t, v: m.get(t) ?? 0 });
      return out;
    };
    return {
      liveNow,
      peakToday,
      peakAllTime,
      sessionsToday: q.num("SELECT COUNT(*) FROM sessions WHERE started_at >= ?", today),
      visitorsToday: q.num("SELECT COUNT(DISTINCT visitor) FROM sessions WHERE started_at >= ?", today),
      playSecondsToday: q.num("SELECT COALESCE(SUM(json_extract(data, '$.active')), 0) FROM events WHERE k = 'beat' AND t >= ?", today),
      avgSessionSeconds7d: Math.round(q.num("SELECT COALESCE(AVG((last_seen - started_at) / 1000.0), 0) FROM sessions WHERE started_at >= ? AND furthest >= 1", now - 7 * DAY)),
      returningShare7d: entries && entries.n ? Math.round(((entries.old ?? 0) / entries.n) * 1000) / 1000 : 0,
      errorsLastHour: q.num("SELECT COUNT(*) FROM error_hits WHERE t >= ?", now - HOUR),
      newErrorGroups24h: q.num("SELECT COUNT(*) FROM error_groups WHERE first_seen >= ?", now - 24 * HOUR),
      sessionsSeries: fill(sessionsByHour),
      liveSeries: fill(liveByHour),
      topCountries: q.all<{ country: string; sessions: number }>(
        "SELECT country, COUNT(*) AS sessions FROM sessions WHERE started_at >= ? AND started_at <= ? AND country IS NOT NULL GROUP BY country ORDER BY sessions DESC LIMIT 10", r.from, r.to),
      health: await this.summary(),
      milestones: this.milestones(),
    };
  }
}
