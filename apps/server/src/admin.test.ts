import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ErrorGroup, LiveSession, Overview, Retention } from "@exiled/telemetry";
import { createApp, type App } from "./app";
import { base32Decode, totpAt } from "./totp";
import { evaluateMilestones, MILESTONES, type MilestoneStats } from "./milestones";
import { batch, post, serve, startEvent, type Served } from "./test-helpers";

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const PASSWORD = "correct horse battery";

let app: App | undefined;
const servers: Served[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  app?.close();
  app = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(opts: { staticDir?: string } = {}) {
  let now = T0;
  app = createApp({ db: ":memory:", now: () => now, stdoutLog: false, staticDir: opts.staticDir, nginxStatusUrl: "http://127.0.0.1:1/", nginxLogDir: join(tmpdir(), "ec-no-such-dir") });
  const admin = await serve(app.admin);
  const ingest = await serve(app.ingest);
  servers.push(admin, ingest);
  const { secret } = await app.admins.add("baer", PASSWORD);
  const key = base32Decode(secret);
  return {
    app, admin: admin.url, ingest: ingest.url,
    setNow: (t: number) => { now = t; },
    code: (offsetSteps = 0) => totpAt(key, Math.floor(now / 1000) + offsetSteps * 30),
  };
}

const j = async (r: Promise<Response>): Promise<any> => (await r).json();

const H = { "x-ec-admin": "1", "content-type": "application/json" };

async function login(url: string, totp: string, password = PASSWORD, headers: Record<string, string> = H) {
  return fetch(`${url}/api/login`, { method: "POST", headers, body: JSON.stringify({ user: "baer", password, totp }) });
}

async function loggedIn(s: Awaited<ReturnType<typeof setup>>) {
  const res = await login(s.admin, s.code());
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const get = (path: string) => fetch(`${s.admin}${path}`, { headers: { cookie } });
  const send = (method: string, path: string, body: unknown, extra: Record<string, string> = H) =>
    fetch(`${s.admin}${path}`, { method, headers: { cookie, ...extra }, body: JSON.stringify(body) });
  return { cookie, get, send };
}

describe("admin auth", () => {
  it("logs in with password + TOTP and sets a hardened cookie", async () => {
    const s = await setup();
    const res = await login(s.admin, s.code());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: "baer", since: T0 });
    const c = res.headers.get("set-cookie")!;
    expect(c).toMatch(/^ec_admin=[A-Za-z0-9_-]{43};/);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/");
    expect(c).not.toContain("Secure");
    const token = c.split(";")[0]!.split("=")[1]!;
    expect(JSON.stringify(s.app.db.prepare("SELECT * FROM admin_sessions").all())).not.toContain(token);
  });

  it("refuses a wrong password and a wrong TOTP with the same answer", async () => {
    const s = await setup();
    const a = await login(s.admin, s.code(), "wrong password!!");
    const b = await login(s.admin, s.code(3));
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
    const audit = s.app.db.prepare("SELECT action FROM audit").all() as { action: string }[];
    expect(audit.map((x) => x.action)).toEqual(["login.failed", "login.failed"]);
  });

  it("refuses a TOTP code reused within its window", async () => {
    const s = await setup();
    const code = s.code();
    expect((await login(s.admin, code)).status).toBe(200);
    expect((await login(s.admin, code)).status).toBe(401);
    s.setNow(T0 + 30_000);
    expect((await login(s.admin, s.code(-1))).status).toBe(401);
    expect((await login(s.admin, s.code())).status).toBe(200);
  });

  it("locks an ip out after 5 failures in 15 minutes", async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++) expect((await login(s.admin, "000000", "wrong password!!")).status).toBe(401);
    expect((await login(s.admin, s.code())).status).toBe(429);
    s.setNow(T0 + 16 * 60_000);
    expect((await login(s.admin, s.code())).status).toBe(200);
  });

  it("counts concurrent failures before the slow password check, per ip and per user", async () => {
    const s = await setup();
    const codes = await Promise.all(Array.from({ length: 12 }, () => login(s.admin, "000000", "wrong password!!").then((r) => r.status)));
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(5);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(7);
    s.setNow(T0 + 16 * 60_000);
    for (let i = 0; i < 5; i++) {
      expect((await login(s.admin, "000000", "wrong password!!", { ...H, "x-real-ip": `10.10.30.${i + 1}` })).status).toBe(401);
    }
    expect((await login(s.admin, s.code(), PASSWORD, { ...H, "x-real-ip": "10.10.30.99" })).status).toBe(429);
  });

  it("requires the session cookie on every api route", async () => {
    const s = await setup();
    for (const p of ["me", "overview", "live", "sessions", "retention", "geo", "gameplay", "perf", "errors", "health", "logs", "traffic", "liveops", "builds", "audit"]) {
      const res = await fetch(`${s.admin}/api/${p}`);
      expect(res.status, p).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect((await fetch(`${s.admin}/api/me`, { headers: { cookie: "ec_admin=forged" } })).status).toBe(401);
  });

  it("expires a session after 12 h idle", async () => {
    const s = await setup();
    const { get } = await loggedIn(s);
    s.setNow(T0 + 11 * 3_600_000);
    expect((await get("/api/me")).status).toBe(200);
    s.setNow(T0 + 23.5 * 3_600_000);
    expect((await get("/api/me")).status).toBe(401);
  });

  it("requires X-EC-Admin and a matching Origin on mutations", async () => {
    const s = await setup();
    expect((await login(s.admin, s.code(), PASSWORD, { "content-type": "application/json" })).status).toBe(403);
    const { send } = await loggedIn(s);
    const cfg = { flags: {}, telemetry: true };
    expect((await send("PUT", "/api/liveops", cfg, { "content-type": "application/json" })).status).toBe(403);
    expect((await send("PUT", "/api/liveops", cfg, { ...H, origin: "https://evil.example" })).status).toBe(403);
    const host = new URL(s.admin).host;
    expect((await send("PUT", "/api/liveops", cfg, { ...H, origin: `http://${host}` })).status).toBe(200);
    expect((await send("POST", "/api/logout", {})).status).toBe(200);
  });

  it("sends the security headers on every admin response", async () => {
    const s = await setup();
    const res = await fetch(`${s.admin}/api/me`);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("build registry", () => {
  it("never takes a build time from the future or raises one already stored", async () => {
    const s = await setup();
    await post(`${s.ingest}/api/t`, batch({ build: "0.3.1+abc1234", builtAt: 1_000 }));
    await post(`${s.ingest}/api/t`, batch({ build: "0.3.1+abc1234", builtAt: 9_000_000_000_000 }));
    await post(`${s.ingest}/api/t`, batch({ build: "0.9.9+fffffff", builtAt: 9_000_000_000_000 }), { "x-real-ip": "203.0.113.7" });
    const { get } = await loggedIn(s);
    const builds = (await j(get("/api/builds"))) as { build: string; builtAt: number }[];
    expect(builds.find((b) => b.build === "0.3.1+abc1234")?.builtAt).toBe(1_000);
    expect(builds.find((b) => b.build === "0.9.9+fffffff")?.builtAt).toBeLessThanOrEqual(T0);
  });
});

describe("admin isolation", () => {
  it("refuses anything that looks like it came from the public site", async () => {
    const s = await setup();
    const me = (headers: Record<string, string>) => fetch(`${s.admin}/api/me`, { headers }).then((r) => r.status);
    expect(await me({})).toBe(401);
    expect(await me({ "x-real-ip": "10.10.30.100" })).toBe(401);
    expect(await me({ "x-real-ip": "203.0.113.9" })).toBe(404);
    expect(await me({ "x-real-ip": "2a01:e0a::1" })).toBe(404);
    // fetch drops a custom Host header, so the host cases go through node:http.
    const rawHost = (host: string, path = "/api/me") => new Promise<{ status: number; body: string }>((done, fail) => {
      const r = request(`${s.admin}${path}`, { headers: { host } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => done({ status: res.statusCode ?? 0, body }));
      });
      r.on("error", fail);
      r.end();
    });
    expect((await rawHost("exiledcasual.com")).status).toBe(404);
    expect((await rawHost("www.ExiledCasual.com:443")).status).toBe(404);
    expect(await me({ "cf-ray": "a4c74ee619e75d3b-VIE" })).toBe(404);
    expect(await me({ "cf-connecting-ip": "10.10.30.100" })).toBe(404);
    const page = await rawHost("exiledcasual.com", "/");
    expect(page.status).toBe(404);
    expect(page.body).toBe("");
  });
});

describe("admin routes", () => {
  it("liveops round-trips to the public config and is audited", async () => {
    const s = await setup();
    const { send, get } = await loggedIn(s);
    const res = await send("PUT", "/api/liveops", { motd: { text: "Patch 0.4 is live", level: "info" }, flags: { bossHp: 1.2 }, telemetry: true });
    expect(res.status).toBe(200);
    const pub = await j(fetch(`${s.ingest}/api/config`));
    expect(pub).toMatchObject({ motd: { text: "Patch 0.4 is live", level: "info" }, flags: { bossHp: 1.2 }, telemetry: true });
    expect(pub.motd.id).toMatch(/^[0-9a-f]{12}$/);
    expect((await send("PUT", "/api/liveops", { telemetry: "yes" })).status).toBe(400);
    const audit = await j(get("/api/audit"));
    expect(audit[0]).toMatchObject({ user: "baer", action: "liveops.update" });
  });

  it("lists only sessions beating in the last 75 s and not ended", async () => {
    const s = await setup();
    const { get } = await loggedIn(s);
    const fresh = randomUUID(), stale = randomUUID(), ended = randomUUID();
    s.setNow(T0 - 100_000);
    await post(`${s.ingest}/api/t`, batch({ sid: stale }));
    s.setNow(T0 - 30_000);
    await post(`${s.ingest}/api/t`, batch({ sid: fresh, events: [startEvent(), { k: "beat", t: 10, view: "game", active: 30, fps: 60, level: 7, classId: "ember" }] }));
    await post(`${s.ingest}/api/t`, batch({ sid: ended, events: [startEvent(), { k: "end", t: 20 }] }));
    s.setNow(T0);
    const live = (await j(get("/api/live"))) as LiveSession[];
    expect(live.map((l) => l.sid)).toEqual([fresh]);
    expect(live[0]).toMatchObject({ view: "game", level: 7, classId: "ember", fps: 60, playSeconds: 30, browser: "Chrome 141" });
  });

  it("buckets retention by character age and session length", async () => {
    const s = await setup();
    const { get } = await loggedIn(s);
    const enter = (ageDays: "0" | "1" | "30+") => batch({ events: [startEvent(), { k: "charAge", t: 100, classId: "ironsworn", level: 1, ageDays }, { k: "beat", t: 45_000, view: "game", active: 45 }] });
    for (const a of ["0", "0", "1", "30+"] as const) await post(`${s.ingest}/api/t`, enter(a));
    const r = (await j(get("/api/retention?days=7"))) as Retention;
    expect(r.ageTotals).toEqual({ "0": 2, "1": 1, "2-6": 0, "7-29": 0, "30+": 1 });
    const today = r.days.find((d) => d.date === "2026-10-18")!;
    expect(today).toMatchObject({ sessions: 4, playSeconds: 180, newCharacters: 2 });
    expect(today.byAge["30+"]).toBe(1);
    expect(r.lengths.find((l) => l.from === 30)!.count).toBe(4);
    expect(r.days[0]!.date).toBe("2026-10-18");
  });

  it("groups errors by fingerprint and reopens a resolved group only for a newer build", async () => {
    const s = await setup();
    const { get, send } = await loggedIn(s);
    const err = (msg: string, builtAt: number) => batch({ builtAt, build: `b${builtAt}`, events: [startEvent(), { k: "error", t: 5, src: "window", msg, stack: "Error\n    at cast (https://x/assets/game-Ab12Cd34.js:1:2)" }] });
    await post(`${s.ingest}/api/t`, err("Cannot read 'hp' of undefined at 12", 1000));
    await post(`${s.ingest}/api/t`, err("Cannot read 'hp' of undefined at 40", 1000));
    let groups = (await j(get("/api/errors"))) as ErrorGroup[];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, sessions: 2, status: "open", builds: ["b1000"], topFrame: "at cast (https://x/assets/game-Ab12Cd34.js:1:2)" });
    const fp = groups[0]!.fingerprint;
    expect((await send("POST", `/api/errors/${fp}`, { status: "resolved" })).status).toBe(200);
    await post(`${s.ingest}/api/t`, err("Cannot read 'hp' of undefined at 7", 1000));
    groups = (await j(get("/api/errors"))) as ErrorGroup[];
    expect(groups[0]!.status).toBe("resolved");
    await post(`${s.ingest}/api/t`, err("Cannot read 'hp' of undefined at 7", 2000));
    groups = (await j(get("/api/errors?status=open"))) as ErrorGroup[];
    expect(groups[0]).toMatchObject({ fingerprint: fp, status: "open", count: 4 });
    const detail = await j(get(`/api/errors/${fp}`));
    expect(detail.hits).toHaveLength(4);
    expect(detail.stack).toContain("at cast");
    expect((await send("POST", `/api/errors/${fp}`, { status: "bogus" })).status).toBe(400);
  });

  it("answers every route with the contract shape", async () => {
    const s = await setup();
    const { get } = await loggedIn(s);
    const sid = randomUUID();
    await post(`${s.ingest}/api/t`, batch({ sid, events: [startEvent(), { k: "load", t: 1, menuMs: 900 }, { k: "beat", t: 30_000, view: "game", active: 30, fps: 55 }, { k: "loot", t: 31_000, normal: 3, magic: 1, rare: 0, unique: 1 }] }), { "cf-ipcountry": "DE", "cf-ipcity": "Berlin", "cf-iplatitude": "52.52", "cf-iplongitude": "13.40" });
    s.app.jobs.minute();
    const ov = (await j(get("/api/overview"))) as Overview;
    expect(ov).toMatchObject({ liveNow: 1, peakToday: 1, sessionsToday: 1, visitorsToday: 1, playSecondsToday: 30, topCountries: [{ country: "DE", sessions: 1 }] });
    expect(ov.sessionsSeries).toHaveLength(49);
    expect(ov.health.checks.find((c) => c.id === "nginx")!.state).toBe("fail");
    expect(ov.milestones.find((m) => m.id === "sessions-1")!.unlockedAt).toBe(T0 - 31_000);
    expect(ov.milestones.find((m) => m.id === "first-unique")!.unlockedAt).not.toBeNull();
    const page = await j(get("/api/sessions?q=rtx"));
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(page.rows[0]).toMatchObject({ sid, gpu: "NVIDIA RTX 4070", furthest: "game", country: "DE" });
    expect((await j(get("/api/sessions?q=nomatch"))).total).toBe(0);
    const detail = await j(get(`/api/sessions/${sid}`));
    expect(detail).toMatchObject({ ipPrefix: "127.0.0.0/24", lang: "en-US", cores: 16, sameDay: [] });
    expect(detail.events).toHaveLength(4);
    expect((await get(`/api/sessions/${randomUUID()}`)).status).toBe(404);
    expect(await j(get("/api/geo"))).toEqual([{ country: "DE", city: "Berlin", lat: 52.5, lon: 13.4, sessions: 1, visitors: 1, playSeconds: 30 }]);
    const gp = await j(get("/api/gameplay"));
    expect(gp.loot).toEqual({ normal: 3, magic: 1, rare: 0, unique: 1 });
    expect(gp.funnel[0]).toEqual({ step: "boot", sessions: 1 });
    const perf = await j(get("/api/perf"));
    expect(perf.byGpu[0]).toEqual({ key: "NVIDIA RTX 4070", sessions: 1, fpsP50: 55, fpsP5: 55 });
    expect(perf.menuLoadMs).toEqual({ p50: 900, p90: 900 });
    const health = await j(get("/api/health"));
    expect(health.nginx.up).toBe(false);
    expect(Object.keys(health)).toEqual(["summary", "host", "nginx", "server", "series"]);
    expect(await j(get("/api/logs?source=access"))).toEqual([]);
    expect(await j(get("/api/logs?source=error"))).toEqual([]);
    const serverLogs = await j(get("/api/logs?source=server"));
    expect(serverLogs[0]).toMatchObject({ source: "server", level: "info", text: expect.stringContaining("admin login") });
    expect((await get("/api/logs?source=nope")).status).toBe(400);
    const traffic = await j(get("/api/traffic"));
    expect(traffic.days[0]).toEqual({ date: "2026-10-18", pageLoads: 0, humans: 0, bots: 0, sessions: 1 });
    expect(await j(get("/api/builds"))).toEqual([{ build: "0.3.1+abc1234", builtAt: 1000, firstSeen: T0, lastSeen: T0, sessions: 1, errors: 0 }]);
    expect((await get("/api/nope")).status).toBe(404);
  });

  it("is not reachable on the ingest listener", async () => {
    const s = await setup();
    const { cookie } = await loggedIn(s);
    for (const p of ["/api/me", "/api/overview", "/api/login", "/index.html"]) {
      expect((await fetch(`${s.ingest}${p}`, { headers: { cookie } })).status).toBe(404);
    }
  });
});

describe("static admin SPA", () => {
  function raw(url: string, path: string): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
    const u = new URL(url);
    return new Promise((resolve, reject) => {
      const req = request({ host: u.hostname, port: u.port, path, method: "GET" }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("serves files, falls back to index.html, and refuses traversal", async () => {
    const root = mkdtempSync(join(tmpdir(), "ec-static-"));
    dirs.push(root);
    const dist = join(root, "dist");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html>INDEX");
    writeFileSync(join(dist, "assets", "app-1234.js"), "console.log(1)");
    writeFileSync(join(root, "secret.txt"), "TOPSECRET");
    const s = await setup({ staticDir: dist });
    const idx = await raw(s.admin, "/");
    expect(idx.body).toContain("INDEX");
    expect(idx.headers["content-security-policy"]).toBeDefined();
    expect((await raw(s.admin, "/sessions/abc")).body).toContain("INDEX");
    const asset = await raw(s.admin, "/assets/app-1234.js");
    expect(asset.body).toBe("console.log(1)");
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect((await raw(s.admin, "/assets/missing.js")).status).toBe(404);
    for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/..%5csecret.txt", "/%2e%2e%2fsecret.txt"]) {
      const r = await raw(s.admin, p);
      expect(r.body, p).not.toContain("TOPSECRET");
    }
  });
});

describe("milestones", () => {
  const base: MilestoneStats = { sessions: 0, visitorDays: 0, playSeconds: 0, mapsCompleted: 0, uniquesDropped: 0, maxLevel: 0, peakConcurrent: 0, daysWithoutNewError: 0 };
  const at = (stats: Partial<MilestoneStats>, id: string) => evaluateMilestones({ ...base, ...stats }, {}, T0).milestones.find((m) => m.id === id)!;

  it("unlocks exactly at each threshold", () => {
    expect(at({ sessions: 9 }, "sessions-10")).toMatchObject({ progress: 9, target: 10, unlockedAt: null });
    expect(at({ sessions: 10 }, "sessions-10").unlockedAt).toBe(T0);
    expect(at({ sessions: 999 }, "sessions-1000").unlockedAt).toBeNull();
    expect(at({ playSeconds: 10 * 3600 - 1 }, "hours-10").unlockedAt).toBeNull();
    expect(at({ playSeconds: 10 * 3600 }, "hours-10").unlockedAt).toBe(T0);
    expect(at({ maxLevel: 19 }, "level-20").unlockedAt).toBeNull();
    expect(at({ maxLevel: 20 }, "level-20").unlockedAt).toBe(T0);
    expect(at({ peakConcurrent: 50 }, "peak-50").rarity).toBe("unique");
    expect(at({ daysWithoutNewError: 6.9 }, "calm-7").unlockedAt).toBeNull();
    expect(at({ visitorDays: 100 }, "visitor-days-100").rarity).toBe("magic");
  });

  it("keeps a stored unlock and reports progress capped at the target", () => {
    const r = evaluateMilestones({ ...base, sessions: 3 }, { "sessions-10": 42 }, T0);
    expect(r.milestones.find((m) => m.id === "sessions-10")).toMatchObject({ unlockedAt: 42, progress: 3 });
    expect(r.newlyUnlocked).toEqual({ "sessions-1": T0 });
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length);
  });

  it("stores the first unlock time once through the overview", async () => {
    const s = await setup();
    const { get } = await loggedIn(s);
    await post(`${s.ingest}/api/t`, batch());
    await get("/api/overview");
    s.setNow(T0 + 11 * 3_600_000);
    const ov = (await j(get("/api/overview"))) as Overview;
    expect(ov.milestones.find((m) => m.id === "sessions-1")!.unlockedAt).toBe(T0);
  });
});

describe("SPA conventions", () => {
  it("keeps a given motd id, filters logs by bots=0|1 and status class, and stores mem as MB", async () => {
    const s = await setup();
    const { send, get } = await loggedIn(s);
    const res = await j(send("PUT", "/api/liveops", { motd: { id: "patch-04", text: "hi", level: "warn" }, flags: {}, telemetry: true }));
    expect(res.motd).toEqual({ id: "patch-04", text: "hi", level: "warn" });
    const db = s.app.db;
    const ins = db.prepare("INSERT INTO hits (t, ip_prefix, method, path, status, bytes, referrer, ua, bot) VALUES (?, NULL, 'GET', ?, ?, 0, '', 'x', ?)");
    ins.run(T0, "/h", 200, 0);
    ins.run(T0, "/b", 404, 1);
    const paths = async (qs: string) => ((await j(get(`/api/logs?source=access&${qs}`))) as { path: string }[]).map((l) => l.path);
    expect(await paths("bots=1")).toEqual(["/b"]);
    expect(await paths("bots=0")).toEqual(["/h"]);
    expect((await paths("")).sort()).toEqual(["/b", "/h"]);
    expect(await paths("status=4xx")).toEqual(["/b"]);
    await s.app.jobs.sampleHost();
    const mem = db.prepare("SELECT v FROM metrics WHERE kind = 'mem'").get() as { v: number };
    expect(mem.v).toBeGreaterThan(100);
  });
});
