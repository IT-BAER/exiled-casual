import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_BATCH_BYTES } from "@exiled/telemetry";
import { createApp, type App } from "./app";
import { batch, CHROME, post, serve, startEvent, type Served } from "./test-helpers";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);

let app: App | undefined;
let served: Served | undefined;
const dirs: string[] = [];

afterEach(async () => {
  await served?.close();
  app?.close();
  app = undefined;
  served = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(dbPath = ":memory:") {
  let now = T0;
  app = createApp({ db: dbPath, now: () => now, stdoutLog: false });
  served = await serve(app.ingest);
  return { app, url: served.url, setNow: (t: number) => { now = t; } };
}

const count = (a: App, sql: string, ...p: (string | number)[]) => (a.db.prepare(sql).get(...p) as { n: number }).n;

describe("POST /api/t", () => {
  it("accepts a batch (text/plain from sendBeacon) and opens a session", async () => {
    const { app, url } = await setup();
    const b = batch();
    const res = await post(`${url}/api/t`, b, { "x-real-ip": "203.0.113.77", "cf-ipcountry": "DE", "cf-ipcity": "Berlin" });
    expect(res.status).toBe(204);
    const s = app.db.prepare("SELECT * FROM sessions WHERE sid = ?").get(b.sid) as Record<string, unknown>;
    expect(s).toMatchObject({ country: "DE", city: "Berlin", browser: "Chrome 141", os: "Windows", mobile: 0, gpu: "NVIDIA RTX 4070", referrer: "reddit.com", ip_prefix: "203.0.113.0/24" });
    expect(s.started_at).toBe(T0);
  });

  it("refuses an oversized body with 413", async () => {
    const { url } = await setup();
    const res = await post(`${url}/api/t`, "x".repeat(MAX_BATCH_BYTES + 1));
    expect(res.status).toBe(413);
  });

  it("refuses unparseable JSON and a bad batch with 400", async () => {
    const { url } = await setup();
    expect((await post(`${url}/api/t`, "{nope")).status).toBe(400);
    expect((await post(`${url}/api/t`, { ...batch(), sid: "not-a-uuid" })).status).toBe(400);
  });

  it("rate limits per client ip and per sid with 429", async () => {
    const { url } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post(`${url}/api/t`, batch(), { "x-real-ip": "198.51.100.1" })).status);
    expect(codes.slice(0, 10).every((c) => c === 204)).toBe(true);
    expect(codes[10]).toBe(429);
    expect((await post(`${url}/api/t`, batch(), { "x-real-ip": "198.51.100.2" })).status).toBe(204);
    const sid = randomUUID();
    const bySid: number[] = [];
    for (let i = 0; i < 11; i++) bySid.push((await post(`${url}/api/t`, batch({ sid, seq: i }), { "x-real-ip": `192.0.2.${i + 1}` })).status);
    expect(bySid[10]).toBe(429);
  });

  it("ignores a replayed (sid, seq)", async () => {
    const { app, url } = await setup();
    const b = batch({ events: [startEvent(), { k: "beat", t: 30_000, view: "menu", active: 30 }] });
    expect((await post(`${url}/api/t`, b)).status).toBe(204);
    expect((await post(`${url}/api/t`, b)).status).toBe(204);
    expect(count(app, "SELECT COUNT(*) AS n FROM events WHERE sid = ?", b.sid)).toBe(2);
    expect(count(app, "SELECT play_seconds AS n FROM sessions WHERE sid = ?", b.sid)).toBe(30);
  });

  it("never stores the full ip anywhere on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ec-ip-"));
    dirs.push(dir);
    const { app, url } = await setup(join(dir, "ec.db"));
    await post(`${url}/api/t`, batch({ events: [startEvent(), { k: "error", t: 5, src: "window", msg: "boom" }] }), { "x-real-ip": "203.0.113.77" });
    app.jobs.minute();
    app.jobs.hourly();
    for (const { name } of app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) {
      expect(JSON.stringify(app.db.prepare(`SELECT * FROM "${name}"`).all())).not.toContain("203.0.113.77");
    }
    app.db.exec("PRAGMA wal_checkpoint(FULL)");
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f)).includes("203.0.113.77")).toBe(false);
    expect(app.logRing().join("\n")).not.toContain("203.0.113.77");
  });

  it("derives a visitor key that is stable within a day and changes across days", async () => {
    const { app, url, setNow } = await setup();
    const a = batch(), b = batch(), c = batch();
    await post(`${url}/api/t`, a, { "x-real-ip": "203.0.113.5" });
    await post(`${url}/api/t`, b, { "x-real-ip": "203.0.113.5" });
    setNow(T0 + DAY);
    await post(`${url}/api/t`, c, { "x-real-ip": "203.0.113.5" });
    const v = (sid: string) => (app.db.prepare("SELECT visitor FROM sessions WHERE sid = ?").get(sid) as { visitor: string }).visitor;
    expect(v(a.sid)).toBe(v(b.sid));
    expect(v(a.sid)).not.toBe(v(c.sid));
    expect(v(a.sid)).toMatch(/^[0-9a-f]{16}$/);
    expect(count(app, "SELECT COUNT(*) AS n FROM salts")).toBe(1);
  });

  it("serves the live config with no-store and nothing else", async () => {
    const { url } = await setup();
    const res = await fetch(`${url}/api/config`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ flags: {}, telemetry: true });
    expect((await fetch(`${url}/admin/api/me`)).status).toBe(404);
    expect((await fetch(`${url}/admin/api/overview`)).status).toBe(404);
    expect((await fetch(`${url}/`)).status).toBe(404);
  });
});

describe("session state", () => {
  it("folds events into the denormalised row and closes on end", async () => {
    const { app, url, setNow } = await setup();
    const sid = randomUUID();
    await post(`${url}/api/t`, batch({ sid, seq: 0, events: [startEvent(), { k: "view", t: 100, view: "menu" }] }));
    setNow(T0 + 60_000);
    await post(`${url}/api/t`, batch({ sid, seq: 1, events: [
      { k: "charAge", t: 50_000, classId: "ironsworn", level: 3, ageDays: "2-6" },
      { k: "beat", t: 59_000, view: "game", active: 25, fps: 58, area: "map", biome: "strand", tier: 2, level: 4, classId: "ironsworn" },
      { k: "mapDone", t: 59_500, node: "the_wrackline", tier: 2 },
      { k: "death", t: 59_600, level: 4, tier: 2, killer: "crab" },
    ] }));
    const s = app.db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid) as Record<string, unknown>;
    expect(s).toMatchObject({ view: "game", furthest: 6, area: "map", biome: "strand", tier: 2, level: 4, class_id: "ironsworn", fps: 58, play_seconds: 25, max_level: 4, age_days: "2-6", maps: 1, deaths: 1, ended_at: null, last_seen: T0 + 60_000 });
    await post(`${url}/api/t`, batch({ sid, seq: 2, events: [{ k: "end", t: 61_000 }] }));
    expect((app.db.prepare("SELECT ended_at FROM sessions WHERE sid = ?").get(sid) as { ended_at: number }).ended_at).toBe(T0 + 60_000);
  });
});
