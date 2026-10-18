import { createHash, randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { VIEWS, type Batch, type TelemetryEvent } from "@exiled/telemetry";
import { tx } from "./db";
import { fingerprintError, topFrame } from "./errors";
import { geoFromHeaders, ipPrefix } from "./ip";
import { parseUserAgent } from "./ua";

export const DAY = 86_400_000;
export const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const dayStart = (t: number): number => Math.floor(t / DAY) * DAY;

export interface ClientInfo { ip: string; ua: string; headers: IncomingHttpHeaders | Record<string, string | undefined> }

interface SessionRow {
  sid: string;
  started_at: number;
  view: string;
  furthest: number;
  area: string | null;
  biome: string | null;
  tier: number | null;
  level: number | null;
  class_id: string | null;
  fps: number | null;
  play_seconds: number;
  max_level: number | null;
  age_days: string | null;
  game_entries: number;
  new_character: number;
  maps: number;
  deaths: number;
  errors: number;
  ended_at: number | null;
  gpu: string;
  screen: string;
  referrer: string;
  lang: string;
  dpr: number;
  cores: number;
  mem_gb: number;
  touch: number;
  pwa: number;
  browser: string;
  os: string;
}

/** Daily salt for the visitor key. A new day creates one and deletes every older one. */
export class Salts {
  private cached: { day: string; salt: Uint8Array } | null = null;
  constructor(private readonly db: DatabaseSync) {}

  forDay(day: string): Uint8Array {
    if (this.cached?.day === day) return this.cached.salt;
    let row = this.db.prepare("SELECT salt FROM salts WHERE day = ?").get(day) as { salt: Uint8Array } | undefined;
    if (!row) {
      this.db.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").run(day, randomBytes(32));
      row = this.db.prepare("SELECT salt FROM salts WHERE day = ?").get(day) as { salt: Uint8Array };
    }
    this.db.prepare("DELETE FROM salts WHERE day < ?").run(day);
    this.cached = { day, salt: row.salt };
    return row.salt;
  }
}

export function visitorKey(salt: Uint8Array, ip: string, ua: string): string {
  return createHash("sha256").update(salt).update(ip).update("\n").update(ua).digest("hex").slice(0, 16);
}

const rank = (v: string) => VIEWS.indexOf(v as (typeof VIEWS)[number]);

export class Store {
  private readonly salts: Salts;
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {
    this.salts = new Salts(db);
  }

  /** Writes one parsed batch. Returns false for a replayed (sid, seq), which changes nothing. */
  ingest(batch: Batch, client: ClientInfo): boolean {
    const now = this.now();
    return tx(this.db, () => {
      const fresh = this.db.prepare("INSERT OR IGNORE INTO batches (sid, seq, t) VALUES (?, ?, ?)").run(batch.sid, batch.seq, now);
      if (fresh.changes === 0) return false;
      this.touchBuild(batch, now);
      let s = this.db.prepare("SELECT * FROM sessions WHERE sid = ?").get(batch.sid) as SessionRow | undefined;
      if (!s) s = this.openSession(batch, client, now);
      this.fold(s, batch, now);
      return true;
    });
  }

  private touchBuild(batch: Batch, now: number): void {
    this.db.prepare(
      `INSERT INTO builds (build, built_at, first_seen, last_seen) VALUES (?, ?, ?, ?)
       ON CONFLICT(build) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen)`,
    ).run(batch.build, Math.min(batch.builtAt, now), now, now);
  }

  private openSession(batch: Batch, client: ClientInfo, now: number): SessionRow {
    const maxT = batch.events.reduce((m, e) => Math.max(m, e.t), 0);
    const started = now - maxT;
    const day = utcDay(started);
    const ua = parseUserAgent(client.ua);
    const geo = geoFromHeaders(client.headers);
    const visitor = visitorKey(this.salts.forDay(utcDay(now)), client.ip, client.ua);
    this.db.prepare(
      `INSERT INTO sessions (sid, visitor, day, started_at, last_seen, ip_prefix, country, city, region, lat, lon,
         browser, browser_family, os, mobile, build, built_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(batch.sid, visitor, day, started, now, ipPrefix(client.ip), geo.country, geo.city, geo.region, geo.lat, geo.lon,
      ua.browser, ua.family, ua.os, ua.mobile ? 1 : 0, batch.build, batch.builtAt);
    return this.db.prepare("SELECT * FROM sessions WHERE sid = ?").get(batch.sid) as unknown as SessionRow;
  }

  private fold(s: SessionRow, batch: Batch, now: number): void {
    const insEvent = this.db.prepare("INSERT INTO events (sid, t, k, data) VALUES (?, ?, ?, ?)");
    let ended: number | null = null;
    for (const e of batch.events) {
      const at = Math.min(now, s.started_at + e.t);
      const { k, t: _t, ...data } = e;
      insEvent.run(batch.sid, at, k, JSON.stringify(data));
      this.apply(s, e, batch, at);
      if (e.k === "end") ended = now;
    }
    this.db.prepare(
      `UPDATE sessions SET last_seen = ?, ended_at = ?, view = ?, furthest = ?, area = ?, biome = ?, tier = ?, level = ?,
         class_id = ?, fps = ?, play_seconds = ?, max_level = ?, age_days = ?, game_entries = ?, new_character = ?,
         maps = ?, deaths = ?, errors = ?, gpu = ?, screen = ?, referrer = ?, lang = ?, dpr = ?, cores = ?, mem_gb = ?,
         touch = ?, pwa = ?, build = ?, built_at = ?
       WHERE sid = ?`,
    ).run(now, ended, s.view, s.furthest, s.area, s.biome, s.tier, s.level, s.class_id, s.fps, s.play_seconds,
      s.max_level, s.age_days, s.game_entries, s.new_character, s.maps, s.deaths, s.errors, s.gpu, s.screen,
      s.referrer, s.lang, s.dpr, s.cores, s.mem_gb, s.touch, s.pwa, batch.build, batch.builtAt, batch.sid);
  }

  private seeView(s: SessionRow, view: string): void {
    s.view = view;
    s.furthest = Math.max(s.furthest, rank(view));
  }

  private seeLevel(s: SessionRow, level: number): void {
    s.level = level;
    s.max_level = Math.max(s.max_level ?? 0, level);
  }

  private apply(s: SessionRow, e: TelemetryEvent, batch: Batch, at: number): void {
    switch (e.k) {
      case "start":
        Object.assign(s, { gpu: e.gpu, screen: e.screen, referrer: e.ref, lang: e.lang, dpr: e.dpr, cores: e.cores, mem_gb: e.memGb, touch: e.touch ? 1 : 0, pwa: e.pwa ? 1 : 0 });
        break;
      case "beat":
        this.seeView(s, e.view);
        s.play_seconds += e.active;
        if (e.fps !== undefined) s.fps = e.fps;
        if (e.area !== undefined) s.area = e.area;
        if (e.biome !== undefined) s.biome = e.biome;
        if (e.tier !== undefined) s.tier = e.tier;
        if (e.level !== undefined) this.seeLevel(s, e.level);
        if (e.classId !== undefined) s.class_id = e.classId;
        break;
      case "view":
        this.seeView(s, e.view);
        break;
      case "charAge":
        s.class_id = e.classId;
        s.age_days = e.ageDays;
        s.game_entries++;
        if (e.ageDays === "0") s.new_character = 1;
        this.seeLevel(s, e.level);
        break;
      case "area":
        s.area = e.area;
        s.biome = e.biome ?? null;
        s.tier = e.tier ?? null;
        break;
      case "mapDone":
        s.maps++;
        break;
      case "death":
        s.deaths++;
        break;
      case "level":
        this.seeLevel(s, e.level);
        break;
      case "error":
        s.errors++;
        this.recordError(e, batch, s, at);
        break;
      case "load":
      case "loot":
      case "end":
        break;
    }
  }

  private recordError(e: Extract<TelemetryEvent, { k: "error" }>, batch: Batch, s: SessionRow, at: number): void {
    const fp = fingerprintError(e.src, e.msg, e.stack);
    const frame = topFrame(e.stack);
    const g = this.db.prepare("SELECT status, resolved_built_at FROM error_groups WHERE fingerprint = ?").get(fp) as
      { status: string; resolved_built_at: number | null } | undefined;
    if (!g) {
      this.db.prepare(
        `INSERT INTO error_groups (fingerprint, src, message, top_frame, last_stack, count, first_seen, last_seen, status)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'open')`,
      ).run(fp, e.src, e.msg, frame, e.stack ?? null, at, at);
    } else {
      const reopen = g.status === "resolved" && batch.builtAt > (g.resolved_built_at ?? 0);
      this.db.prepare(
        `UPDATE error_groups SET count = count + 1, last_seen = MAX(last_seen, ?), top_frame = COALESCE(?, top_frame),
           last_stack = COALESCE(?, last_stack), status = CASE WHEN ? THEN 'open' ELSE status END,
           resolved_built_at = CASE WHEN ? THEN NULL ELSE resolved_built_at END
         WHERE fingerprint = ?`,
      ).run(at, frame, e.stack ?? null, reopen ? 1 : 0, reopen ? 1 : 0, fp);
    }
    this.db.prepare("INSERT INTO error_hits (fingerprint, t, sid, build, built_at, browser, os, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(fp, at, batch.sid, batch.build, batch.builtAt, s.browser, s.os, e.url ?? null);
  }
}
