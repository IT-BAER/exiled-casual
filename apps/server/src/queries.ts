import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  AGE_BUCKETS, LOAD_PHASES, RARITIES, VIEWS,
  type AgeBucket, type AuditRow, type Behaviour, type BuildRow, type ErrorDetail, type ErrorGroup, type ErrorStatus, type GeoRow,
  type Gameplay, type LiveSession, type Page, type Perf, type PerfRow, type Point, type Retention, type SessionDetail,
  type SessionRow, type Traffic, type View, type Area, type ErrorSource, type Rarity,
} from "@exiled/telemetry";
import { DAY, dayStart, utcDay } from "./store";
import { botAgent } from "./nginx";
import { HttpError } from "./http";

export const HOUR = 3_600_000;
export const LIVE_MS = 75_000;
export const MAX_DAYS = 90;
const MAX_SPAN = 400 * DAY;

export interface Range { from: number; to: number }

/** A hit that is the game's page itself, and one that is the client asking for its live config: a boot. */
export const PAGE_LOAD = "method = 'GET' AND path IN ('/', '/index.html') AND status = 200";
export const BOOT = "method = 'GET' AND path = '/api/config' AND status = 200";

/** The key an action is counted under, per event kind (see `Behaviour.actions`). */
const ACTION_KEY: Record<string, string> = {
  device: "json_extract(data, '$.action')",
  atlas: "CAST(json_extract(data, '$.tier') AS TEXT)",
  portal: "json_extract(data, '$.to')",
  respawn: "json_extract(data, '$.where')",
  createFail: "json_extract(data, '$.reason')",
  reload: "json_extract(data, '$.reason')",
  rareSeen: "''",
  rareKill: "''",
  bossSeen: "''",
  bossFight: "''",
};

const intParam = (q: URLSearchParams, k: string, def: number, min: number, max: number): number => {
  const raw = q.get(k);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, `${k} must be a number`);
  return Math.min(max, Math.max(min, Math.floor(n)));
};

/** `from`/`to` (ms) win over `days` (default 7, max 90). */
export function parseRange(q: URLSearchParams, now: number): Range {
  const to = q.has("to") ? intParam(q, "to", now, 0, Number.MAX_SAFE_INTEGER) : now;
  if (q.has("from")) {
    const from = intParam(q, "from", to - 7 * DAY, 0, Number.MAX_SAFE_INTEGER);
    if (from > to) throw new HttpError(400, "from is after to");
    return { from: Math.max(from, to - MAX_SPAN), to };
  }
  const days = intParam(q, "days", 7, 1, MAX_DAYS);
  return { from: to - days * DAY, to };
}

export { intParam };

const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

/** UTC days covering a range, newest first. */
function daysIn(r: Range): string[] {
  const out: string[] = [];
  for (let d = dayStart(r.to); d >= dayStart(r.from); d -= DAY) out.push(utcDay(d));
  return out;
}

function hourly(rows: { t: number; v: number }[], from: number, to: number, step = HOUR): Point[] {
  const m = new Map(rows.map((r) => [r.t, r.v]));
  const out: Point[] = [];
  for (let t = Math.floor(from / step) * step; t <= to; t += step) out.push({ t, v: m.get(t) ?? 0 });
  return out;
}

const emptyAges = (): Record<AgeBucket, number> => Object.fromEntries(AGE_BUCKETS.map((a) => [a, 0])) as Record<AgeBucket, number>;

interface SessionDbRow {
  sid: string; visitor: string; day: string; started_at: number; last_seen: number; ended_at: number | null;
  ip_prefix: string | null; country: string | null; city: string | null; browser: string; browser_family: string;
  os: string; mobile: number; build: string; gpu: string; screen: string; referrer: string; lang: string; dpr: number;
  cores: number; mem_gb: number; touch: number; pwa: number; view: string; furthest: number; area: string | null;
  biome: string | null; tier: number | null; level: number | null; class_id: string | null; fps: number | null;
  play_seconds: number; max_level: number | null; age_days: string | null; maps: number; deaths: number; errors: number;
}

function toSessionRow(r: SessionDbRow): SessionRow {
  return {
    sid: r.sid, visitor: r.visitor, startedAt: r.started_at, lastSeen: r.last_seen, playSeconds: r.play_seconds,
    country: r.country, city: r.city, browser: r.browser, os: r.os, mobile: !!r.mobile, gpu: r.gpu, screen: r.screen,
    build: r.build, referrer: r.referrer, furthest: VIEWS[r.furthest] ?? "boot", classId: r.class_id,
    maxLevel: r.max_level, ageDays: (r.age_days as AgeBucket | null) ?? null, maps: r.maps, deaths: r.deaths, errors: r.errors,
  };
}

interface GroupDbRow {
  fingerprint: string; src: string; message: string; top_frame: string | null; last_stack: string | null; count: number;
  first_seen: number; last_seen: number; status: string; resolved_built_at: number | null;
}

export class Queries {
  constructor(readonly db: DatabaseSync, private readonly now: () => number) {}

  all<T>(sql: string, ...p: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...p) as T[];
  }
  get<T>(sql: string, ...p: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...p) as T | undefined;
  }
  num(sql: string, ...p: SQLInputValue[]): number {
    const r = this.db.prepare(sql).get(...p) as Record<string, unknown> | undefined;
    const v = r ? Object.values(r)[0] : 0;
    return typeof v === "number" ? v : Number(v ?? 0) || 0;
  }

  liveCount(now = this.now()): number {
    return this.num("SELECT COUNT(*) FROM sessions WHERE last_seen >= ? AND ended_at IS NULL", now - LIVE_MS);
  }

  live(): LiveSession[] {
    const rows = this.all<SessionDbRow>("SELECT * FROM sessions WHERE last_seen >= ? AND ended_at IS NULL ORDER BY started_at DESC", this.now() - LIVE_MS);
    return rows.map((r) => ({
      sid: r.sid, startedAt: r.started_at, lastBeat: r.last_seen, country: r.country, city: r.city, browser: r.browser,
      os: r.os, mobile: !!r.mobile, build: r.build, view: r.view as View, area: (r.area as Area | null) ?? null,
      biome: r.biome, tier: r.tier, level: r.level, classId: r.class_id, fps: r.fps, playSeconds: r.play_seconds,
    }));
  }

  sessions(q: URLSearchParams): Page<SessionRow> {
    const r = parseRange(q, this.now());
    const page = intParam(q, "page", 1, 1, 1_000_000);
    const pageSize = intParam(q, "pageSize", 50, 1, 200);
    const where = ["started_at >= ?", "started_at <= ?"];
    const p: SQLInputValue[] = [r.from, r.to];
    const country = q.get("country");
    if (country) { where.push("country = ?"); p.push(country.toUpperCase()); }
    const text = q.get("q")?.trim();
    if (text) {
      where.push("(build LIKE ? ESCAPE '\\' OR browser LIKE ? ESCAPE '\\' OR os LIKE ? ESCAPE '\\' OR gpu LIKE ? ESCAPE '\\' OR referrer LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')");
      const l = likeEscape(text);
      p.push(l, l, l, l, l, l);
    }
    const w = where.join(" AND ");
    const total = this.num(`SELECT COUNT(*) FROM sessions WHERE ${w}`, ...p);
    const rows = this.all<SessionDbRow>(`SELECT * FROM sessions WHERE ${w} ORDER BY started_at DESC LIMIT ? OFFSET ?`, ...p, pageSize, (page - 1) * pageSize);
    return { rows: rows.map(toSessionRow), total, page, pageSize };
  }

  session(sid: string): SessionDetail {
    const r = this.get<SessionDbRow>("SELECT * FROM sessions WHERE sid = ?", sid);
    if (!r) throw new HttpError(404, "no such session");
    const events = this.all<{ t: number; k: string; data: string }>("SELECT t, k, data FROM events WHERE sid = ? ORDER BY t DESC, id DESC LIMIT 2000", sid)
      .map((e) => ({ t: e.t, k: e.k, data: JSON.parse(e.data) as Record<string, unknown> }));
    const sameDay = this.all<{ sid: string }>("SELECT sid FROM sessions WHERE visitor = ? AND day = ? AND sid != ? ORDER BY started_at DESC", r.visitor, r.day, sid).map((x) => x.sid);
    return {
      session: toSessionRow(r), ipPrefix: r.ip_prefix, lang: r.lang, dpr: r.dpr, cores: r.cores, memGb: r.mem_gb,
      touch: !!r.touch, pwa: !!r.pwa, events, sameDay,
    };
  }

  retention(q: URLSearchParams): Retention {
    const r = parseRange(q, this.now());
    const perDay = new Map(this.all<{ day: string; sessions: number; visitors: number; play: number; fresh: number }>(
      `SELECT day, COUNT(*) AS sessions, COUNT(DISTINCT visitor) AS visitors, SUM(play_seconds) AS play, SUM(new_character) AS fresh
       FROM sessions WHERE started_at >= ? AND started_at <= ? GROUP BY day`, r.from, r.to).map((x) => [x.day, x]));
    const ages = this.all<{ day: string; age: string; n: number }>(
      `SELECT day, age_days AS age, SUM(game_entries) AS n FROM sessions
       WHERE started_at >= ? AND started_at <= ? AND age_days IS NOT NULL GROUP BY day, age_days`, r.from, r.to);
    const ageTotals = emptyAges();
    const byDay = new Map<string, Record<AgeBucket, number>>();
    for (const a of ages) {
      const rec = byDay.get(a.day) ?? emptyAges();
      rec[a.age as AgeBucket] += a.n;
      ageTotals[a.age as AgeBucket] += a.n;
      byDay.set(a.day, rec);
    }
    const days = daysIn(r).map((date) => {
      const d = perDay.get(date);
      return { date, sessions: d?.sessions ?? 0, visitors: d?.visitors ?? 0, playSeconds: d?.play ?? 0, newCharacters: d?.fresh ?? 0, byAge: byDay.get(date) ?? emptyAges() };
    });
    const edges = [0, 30, 60, 300, 900, 1800, 3600, 7200];
    const lens = this.all<{ len: number }>("SELECT (last_seen - started_at) / 1000 AS len FROM sessions WHERE started_at >= ? AND started_at <= ?", r.from, r.to);
    const lengths = edges.map((from, i) => ({ from, to: edges[i + 1] ?? null, count: 0 }));
    for (const { len } of lens) {
      let i = edges.length - 1;
      while (i > 0 && len < edges[i]!) i--;
      lengths[i]!.count++;
    }
    return { days, lengths, ageTotals };
  }

  geo(q: URLSearchParams): GeoRow[] {
    const r = parseRange(q, this.now());
    return this.all<GeoRow>(
      `SELECT country, city, ROUND(AVG(lat), 1) AS lat, ROUND(AVG(lon), 1) AS lon, COUNT(*) AS sessions,
         COUNT(DISTINCT visitor) AS visitors, SUM(play_seconds) AS playSeconds
       FROM sessions WHERE started_at >= ? AND started_at <= ? AND country IS NOT NULL
       GROUP BY country, city ORDER BY sessions DESC`, r.from, r.to);
  }

  gameplay(q: URLSearchParams): Gameplay {
    const r = parseRange(q, this.now());
    const inRange = "started_at >= ? AND started_at <= ?";
    const classes = this.all<{ classId: string; entries: number; playSeconds: number }>(
      `SELECT class_id AS classId, SUM(game_entries) AS entries, SUM(play_seconds) AS playSeconds FROM sessions
       WHERE ${inRange} AND class_id IS NOT NULL GROUP BY class_id ORDER BY entries DESC`, r.from, r.to);
    const levels = this.all<{ level: number; characters: number }>(
      `SELECT lvl AS level, COUNT(*) AS characters FROM (
         SELECT MAX(max_level) AS lvl FROM sessions WHERE ${inRange} AND class_id IS NOT NULL AND max_level IS NOT NULL
         GROUP BY visitor, class_id) GROUP BY lvl ORDER BY lvl`, r.from, r.to);
    const maps = this.all<{ biome: string; tier: number; opened: number; completed: number; deaths: number }>(
      `SELECT COALESCE(json_extract(data, '$.biome'), '(unknown)') AS biome, COALESCE(json_extract(data, '$.tier'), 0) AS tier,
         SUM(k = 'area') AS opened, SUM(k = 'mapDone') AS completed, SUM(k = 'death') AS deaths
       FROM events WHERE t >= ? AND t <= ? AND (k IN ('mapDone', 'death') OR (k = 'area' AND json_extract(data, '$.area') = 'map'))
       GROUP BY 1, 2 ORDER BY opened DESC, completed DESC`, r.from, r.to);
    const killers = this.all<{ killer: string; element: string | null; rare: number; deaths: number }>(
      `SELECT COALESCE(json_extract(data, '$.killer'), '(unknown)') AS killer, json_extract(data, '$.element') AS element,
         COALESCE(json_extract(data, '$.rare'), 0) AS rare, COUNT(*) AS deaths
       FROM events WHERE k = 'death' AND t >= ? AND t <= ? GROUP BY 1, 2, 3 ORDER BY deaths DESC LIMIT 50`, r.from, r.to)
      .map((k) => ({ ...k, rare: !!k.rare }));
    const lootRow = this.get<Record<Rarity, number | null>>(
      `SELECT SUM(json_extract(data, '$.normal')) AS normal, SUM(json_extract(data, '$.magic')) AS magic,
         SUM(json_extract(data, '$.rare')) AS rare, SUM(json_extract(data, '$.unique')) AS "unique"
       FROM events WHERE k = 'loot' AND t >= ? AND t <= ?`, r.from, r.to);
    const loot = Object.fromEntries(RARITIES.map((x) => [x, lootRow?.[x] ?? 0])) as Record<Rarity, number>;
    const funnel: Gameplay["funnel"] = VIEWS.map((step, i) => ({ step: step as string, sessions: this.num(`SELECT COUNT(*) FROM sessions WHERE ${inRange} AND furthest >= ?`, r.from, r.to, i) }));
    funnel.push(
      { step: "map entered", sessions: this.num(`SELECT COUNT(DISTINCT e.sid) FROM events e JOIN sessions s ON s.sid = e.sid WHERE s.${inRange} AND e.k = 'area' AND json_extract(e.data, '$.area') = 'map'`, r.from, r.to) },
      { step: "map completed", sessions: this.num(`SELECT COUNT(*) FROM sessions WHERE ${inRange} AND maps > 0`, r.from, r.to) },
    );
    return { classes, levels, maps, killers, loot, funnel };
  }

  perf(q: URLSearchParams): Perf {
    const r = parseRange(q, this.now());
    const beats = this.all<{ sid: string; gpu: string; browser: string; fps: number; t: number }>(
      `SELECT e.sid, s.gpu, s.browser_family AS browser, json_extract(e.data, '$.fps') AS fps, e.t
       FROM events e JOIN sessions s ON s.sid = e.sid
       WHERE e.k = 'beat' AND e.t >= ? AND e.t <= ? AND json_extract(e.data, '$.view') = 'game' AND json_extract(e.data, '$.fps') IS NOT NULL`, r.from, r.to);
    const rows = (key: "gpu" | "browser"): PerfRow[] => {
      const g = new Map<string, { sids: Set<string>; fps: number[] }>();
      for (const b of beats) {
        const k = b[key] || "(unknown)";
        const e = g.get(k) ?? { sids: new Set(), fps: [] };
        e.sids.add(b.sid);
        e.fps.push(b.fps);
        g.set(k, e);
      }
      return [...g].map(([k, v]) => {
        const s = v.fps.sort((a, b) => a - b);
        return { key: k, sessions: v.sids.size, fpsP50: percentile(s, 50), fpsP5: percentile(s, 5) };
      }).sort((a, b) => b.sessions - a.sessions).slice(0, 40);
    };
    const loads = (field: string) => {
      const v = this.all<{ v: number }>(`SELECT json_extract(data, '$.${field}') AS v FROM events WHERE k = 'load' AND t >= ? AND t <= ? AND v IS NOT NULL ORDER BY v`, r.from, r.to).map((x) => x.v);
      return { p50: percentile(v, 50), p90: percentile(v, 90) };
    };
    const step = r.to - r.from <= 3 * DAY ? HOUR : DAY;
    const buckets = new Map<number, number[]>();
    for (const b of beats) {
      const t = Math.floor(b.t / step) * step;
      buckets.set(t, [...(buckets.get(t) ?? []), b.fps]);
    }
    const fpsSeries = [...buckets].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v: percentile(v.sort((a, b) => a - b), 50)! }));
    const phaseMs = new Map<string, number[]>();
    for (const p of this.all<{ phase: string; ms: number }>(
      `SELECT json_extract(data, '$.phase') AS phase, json_extract(data, '$.ms') AS ms FROM events
       WHERE k = 'loadPhase' AND t >= ? AND t <= ? ORDER BY ms`, r.from, r.to)) phaseMs.set(p.phase, [...(phaseMs.get(p.phase) ?? []), p.ms]);
    const loadPhases = LOAD_PHASES.map((phase) => {
      const v = phaseMs.get(phase) ?? [];
      return { phase, n: v.length, p50: percentile(v, 50), p90: percentile(v, 90) };
    });
    return { byGpu: rows("gpu"), byBrowser: rows("browser"), menuLoadMs: loads("menuMs"), gameLoadMs: loads("gameMs"), loadPhases, fpsSeries };
  }

  behaviour(q: URLSearchParams): Behaviour {
    const r = parseRange(q, this.now());
    const kinds = Object.keys(ACTION_KEY);
    const actions = this.all<Behaviour["actions"][number]>(
      `SELECT k AS kind, CASE k ${kinds.map((k) => `WHEN '${k}' THEN ${ACTION_KEY[k]}`).join(" ")} END AS key,
         COUNT(DISTINCT sid) AS sessions, COUNT(*) AS count
       FROM events WHERE t >= ? AND t <= ? AND k IN (${kinds.map(() => "?").join(",")})
       GROUP BY 1, 2 ORDER BY 1, count DESC`, r.from, r.to, ...kinds);
    const caches = this.get<{ opened: number | null; sessions: number }>(
      `SELECT SUM(json_extract(data, '$.caches')) AS opened, COUNT(DISTINCT sid) AS sessions
       FROM events WHERE k = 'beat' AND t >= ? AND t <= ? AND json_extract(data, '$.caches') > 0`, r.from, r.to);
    const exits = this.all<{ view: View; area: Area | null; loading: number; sessions: number }>(
      `SELECT json_extract(data, '$.view') AS view, json_extract(data, '$.area') AS area,
         COALESCE(json_extract(data, '$.loading'), 0) AS loading, COUNT(DISTINCT sid) AS sessions
       FROM events WHERE k = 'end' AND t >= ? AND t <= ? AND json_extract(data, '$.view') IS NOT NULL
       GROUP BY 1, 2, 3 ORDER BY sessions DESC`, r.from, r.to).map((x) => ({ ...x, loading: !!x.loading }));
    const rosters = { none: 0, ...emptyAges() } as Behaviour["rosters"];
    for (const x of this.all<{ age: AgeBucket | null; n: number }>(
      `SELECT json_extract(data, '$.oldestAge') AS age, COUNT(*) AS n FROM events
       WHERE k = 'roster' AND t >= ? AND t <= ? GROUP BY 1`, r.from, r.to)) rosters[x.age ?? "none"] += x.n;
    return { actions, caches: { opened: caches?.opened ?? 0, sessions: caches?.sessions ?? 0 }, exits, rosters };
  }

  private groups(rows: GroupDbRow[]): ErrorGroup[] {
    if (!rows.length) return [];
    const now = this.now();
    const fps = rows.map((r) => r.fingerprint);
    const marks = fps.map(() => "?").join(",");
    const sessions = new Map(this.all<{ fp: string; n: number }>(`SELECT fingerprint AS fp, COUNT(DISTINCT sid) AS n FROM error_hits WHERE fingerprint IN (${marks}) GROUP BY fingerprint`, ...fps).map((x) => [x.fp, x.n]));
    const builds = new Map<string, string[]>();
    for (const b of this.all<{ fp: string; build: string }>(`SELECT fingerprint AS fp, build, MAX(built_at) AS ba FROM error_hits WHERE fingerprint IN (${marks}) GROUP BY fingerprint, build ORDER BY ba DESC`, ...fps)) {
      builds.set(b.fp, [...(builds.get(b.fp) ?? []), b.build]);
    }
    const from = now - 48 * HOUR;
    const series = new Map<string, { t: number; v: number }[]>();
    for (const s of this.all<{ fp: string; t: number; v: number }>(`SELECT fingerprint AS fp, (t / ${HOUR}) * ${HOUR} AS t, COUNT(*) AS v FROM error_hits WHERE fingerprint IN (${marks}) AND t >= ? GROUP BY 1, 2`, ...fps, from)) {
      series.set(s.fp, [...(series.get(s.fp) ?? []), { t: s.t, v: s.v }]);
    }
    return rows.map((r) => ({
      fingerprint: r.fingerprint, src: r.src as ErrorSource, message: r.message, topFrame: r.top_frame, count: r.count,
      sessions: sessions.get(r.fingerprint) ?? 0, firstSeen: r.first_seen, lastSeen: r.last_seen,
      builds: (builds.get(r.fingerprint) ?? []).slice(0, 20), status: r.status as ErrorStatus,
      series: hourly(series.get(r.fingerprint) ?? [], from, now),
    }));
  }

  errors(q: URLSearchParams): ErrorGroup[] {
    const r = parseRange(q, this.now());
    const status = q.get("status");
    if (status && !["open", "resolved", "ignored"].includes(status)) throw new HttpError(400, "status must be open, resolved or ignored");
    const rows = this.all<GroupDbRow>(
      `SELECT * FROM error_groups WHERE last_seen >= ? AND first_seen <= ? ${status ? "AND status = ?" : ""} ORDER BY last_seen DESC LIMIT 500`,
      ...(status ? [r.from, r.to, status] : [r.from, r.to]));
    return this.groups(rows);
  }

  errorDetail(fp: string): ErrorDetail {
    const row = this.get<GroupDbRow>("SELECT * FROM error_groups WHERE fingerprint = ?", fp);
    if (!row) throw new HttpError(404, "no such error group");
    const hits = this.all<ErrorDetail["hits"][number]>("SELECT t, sid, build, browser, os, url FROM error_hits WHERE fingerprint = ? ORDER BY t DESC LIMIT 200", fp);
    return { group: this.groups([row])[0]!, stack: row.last_stack, hits };
  }

  /** Resolving records the newest known build; a hit from a newer one reopens the group. */
  setErrorStatus(fp: string, status: unknown): ErrorGroup {
    if (status !== "open" && status !== "resolved" && status !== "ignored") throw new HttpError(400, "status must be open, resolved or ignored");
    const resolvedAt = status === "resolved" ? this.num("SELECT COALESCE(MAX(built_at), 0) FROM builds") : null;
    const changed = this.db.prepare("UPDATE error_groups SET status = ?, resolved_built_at = ? WHERE fingerprint = ?").run(status, resolvedAt, fp);
    if (changed.changes === 0) throw new HttpError(404, "no such error group");
    return this.errorDetail(fp).group;
  }

  traffic(q: URLSearchParams): Traffic {
    const r = parseRange(q, this.now());
    const human = "bot = 0";
    const page = PAGE_LOAD;
    type DayHits = { day: string; pageLoads: number; humans: number; bots: number; boots: number };
    const hitDays = new Map(this.all<DayHits>(
      `SELECT date(t / 1000, 'unixepoch') AS day, SUM(${human} AND ${page}) AS pageLoads, SUM(${human}) AS humans, SUM(bot) AS bots,
         SUM(${human} AND ${BOOT}) AS boots
       FROM hits WHERE t >= ? AND t <= ? GROUP BY day`, r.from, r.to).map((x) => [x.day, x]));
    const rolled = new Map(this.all<DayHits>(
      "SELECT day, page_loads AS pageLoads, humans, bots, boots FROM daily WHERE day >= ? AND day <= ?", utcDay(r.from), utcDay(r.to)).map((x) => [x.day, x]));
    const sessions = new Map(this.all<{ day: string; n: number }>("SELECT day, COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at <= ? GROUP BY day", r.from, r.to).map((x) => [x.day, x.n]));
    const days = daysIn(r).map((date) => {
      const h = hitDays.get(date) ?? rolled.get(date);
      return { date, pageLoads: h?.pageLoads ?? 0, humans: h?.humans ?? 0, bots: h?.bots ?? 0, boots: h?.boots ?? 0, sessions: sessions.get(date) ?? 0 };
    });
    const referrers = this.all<{ referrer: string; visits: number }>(
      `SELECT referrer, COUNT(*) AS visits FROM hits WHERE t >= ? AND t <= ? AND ${human} AND ${page} AND referrer != '' GROUP BY referrer ORDER BY visits DESC LIMIT 30`, r.from, r.to);
    const paths = this.all<{ path: string; hits: number }>(
      `SELECT path, COUNT(*) AS hits FROM hits WHERE t >= ? AND t <= ? AND ${human} GROUP BY path ORDER BY hits DESC LIMIT 30`, r.from, r.to);
    const statuses = this.all<{ status: number; hits: number }>(
      "SELECT status, COUNT(*) AS hits FROM hits WHERE t >= ? AND t <= ? GROUP BY status ORDER BY hits DESC", r.from, r.to);
    const agents = new Map<string, number>();
    for (const b of this.all<{ ua: string; n: number }>("SELECT ua, COUNT(*) AS n FROM hits WHERE t >= ? AND t <= ? AND bot = 1 GROUP BY ua", r.from, r.to)) {
      const a = botAgent(b.ua);
      agents.set(a, (agents.get(a) ?? 0) + b.n);
    }
    const bots = [...agents].map(([agent, hits]) => ({ agent, hits })).sort((a, b) => b.hits - a.hits).slice(0, 30);
    const bouncedBeforeBoot = days.reduce((s, d) => s + Math.max(0, d.pageLoads - d.boots), 0);
    return { days, referrers, paths, statuses, bots, bouncedBeforeBoot };
  }

  builds(): BuildRow[] {
    return this.all<BuildRow>(
      `SELECT b.build, b.built_at AS builtAt, b.first_seen AS firstSeen, b.last_seen AS lastSeen,
         (SELECT COUNT(*) FROM sessions s WHERE s.build = b.build) AS sessions,
         (SELECT COUNT(*) FROM error_hits h WHERE h.build = b.build) AS errors
       FROM builds b ORDER BY b.built_at DESC, b.first_seen DESC LIMIT 200`);
  }

  audit(q: URLSearchParams): AuditRow[] {
    const limit = intParam(q, "limit", 300, 1, 2000);
    return this.all<AuditRow>("SELECT t, user, action, detail FROM audit ORDER BY t DESC, id DESC LIMIT ?", limit);
  }
}
