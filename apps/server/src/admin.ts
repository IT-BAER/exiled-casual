import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { LogLine, LoginRequest, Me } from "@exiled/telemetry";
import type { Admins } from "./auth";
import { ABSOLUTE_MS } from "./auth";
import type { Monitor } from "./health";
import { HttpError, readJson, refuse, send } from "./http";
import { clientIp, isPrivateIp } from "./ip";
import type { LiveOps } from "./liveops";
import { validateLiveConfig } from "./liveops";
import type { Logger } from "./log";
import { parseErrorLine, tailFile } from "./nginx";
import { intParam, type Queries } from "./queries";
import type { FailureWindow } from "./ratelimit";
import { serveStatic } from "./static";

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const COOKIE = "ec_admin";
const MAX_ADMIN_BODY = 64 * 1024;
const LOGIN_FAILED = "invalid credentials";

export interface AdminDeps {
  admins: Admins;
  queries: Queries;
  monitor: Monitor;
  liveops: LiveOps;
  log: Logger;
  loginFailures: FailureWindow;
  now: () => number;
  staticDir?: string;
  nginxLogDir: string;
  secureCookie: boolean;
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function sessionCookie(value: string, maxAgeS: number, secure: boolean): string {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;
}

/** Same-origin belt and braces for every mutation: the custom header, and Origin == Host when sent. */
function checkCsrf(req: IncomingMessage): void {
  if (req.headers["x-ec-admin"] !== "1") throw new HttpError(403, "missing X-EC-Admin header");
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* unparseable origin is refused below */
    }
    if (!host || host !== req.headers.host) throw new HttpError(403, "cross-origin request refused");
  }
}

function logs(d: AdminDeps, q: URLSearchParams): LogLine[] {
  const source = q.get("source") ?? "access";
  const limit = intParam(q, "limit", 300, 1, 2000);
  const text = q.get("q")?.trim().toLowerCase() ?? "";
  const status = q.get("status")?.trim() ?? "";
  if (source === "access") {
    const where: string[] = [];
    const p: (string | number)[] = [];
    if (/^\d{3}$/.test(status)) { where.push("status = ?"); p.push(Number(status)); }
    else if (/^[1-5]xx$/i.test(status)) { const c = Number(status[0]) * 100; where.push("status >= ? AND status < ?"); p.push(c, c + 100); }
    else if (status) throw new HttpError(400, "status must be a code like 404 or a class like 5xx");
    const bots = q.get("bots");
    if (bots === "0" || bots === "false" || bots === "hide") where.push("bot = 0");
    else if (bots === "1" || bots === "true" || bots === "only") where.push("bot = 1");
    if (text) {
      where.push("(lower(path) LIKE ? ESCAPE '\\' OR lower(ua) LIKE ? ESCAPE '\\' OR lower(referrer) LIKE ? ESCAPE '\\' OR ip_prefix LIKE ? ESCAPE '\\')");
      const l = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      p.push(l, l, l, l);
    }
    const rows = d.queries.all<{ t: number; ip_prefix: string | null; method: string; path: string; status: number; bytes: number; referrer: string; ua: string; bot: number }>(
      `SELECT * FROM hits ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t DESC, id DESC LIMIT ?`, ...p, limit);
    return rows.map((r) => ({
      t: r.t, source: "access", ip: r.ip_prefix ?? undefined, method: r.method, path: r.path, status: r.status, bytes: r.bytes,
      referrer: r.referrer, ua: r.ua, bot: !!r.bot, text: `${r.method} ${r.path} ${r.status}`,
    }));
  }
  const match = (l: { level: string; text: string }) =>
    (!text || l.text.toLowerCase().includes(text)) && (!status || l.level.toLowerCase() === status.toLowerCase());
  if (source === "error") {
    return tailFile(join(d.nginxLogDir, "error.log"), 5000)
      .map(parseErrorLine)
      .filter((l): l is NonNullable<typeof l> => !!l && match(l))
      .reverse()
      .slice(0, limit)
      .map((l) => ({ t: l.t, source: "error", level: l.level, text: l.text }));
  }
  if (source === "server") {
    return d.log.ring().filter(match).reverse().slice(0, limit).map((l) => ({ t: l.t, source: "server", level: l.level, text: l.text }));
  }
  throw new HttpError(400, "source must be access, error or server");
}

export function createAdminHandler(d: AdminDeps) {
  const audit = (user: string, action: string, detail: string) =>
    d.queries.db.prepare("INSERT INTO audit (t, user, action, detail) VALUES (?, ?, ?, ?)").run(d.now(), user, action, detail.slice(0, 1000));

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/\/+$/, "");
    const q = url.searchParams;
    const mutating = method === "POST" || method === "PUT" || method === "DELETE";
    if (mutating) checkCsrf(req);

    if (path === "/api/login") {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const ip = clientIp(req);
      const body = (await readJson(req, MAX_ADMIN_BODY)) as Partial<LoginRequest> | null;
      const user = typeof body?.user === "string" ? body.user.slice(0, 40) : "";
      const password = typeof body?.password === "string" ? body.password.slice(0, 1024) : "";
      const totp = typeof body?.totp === "string" ? body.totp.trim() : "";
      // Per ip AND per user, and reserved before the slow scrypt check, so parallel
      // attempts and rotating addresses both stop at the same five.
      const keys = [`ip:${ip}`, `user:${user.toLowerCase()}`];
      if (keys.some((k) => d.loginFailures.blocked(k))) {
        audit(user || "-", "login.blocked", "too many failures");
        throw new HttpError(429, "too many attempts, try again later");
      }
      for (const k of keys) d.loginFailures.fail(k);
      const result = await d.admins.login(user, password, totp);
      if (result.ok) for (const k of keys) d.loginFailures.forgive(k);
      if (!result.ok) {
        audit(user || "-", "login.failed", "");
        d.log.warn("admin login failed", { user });
        throw new HttpError(401, LOGIN_FAILED);
      }
      audit(user, "login", "");
      d.log.info("admin login", { user });
      const me: Me = { user, since: result.since };
      send(res, 200, me, { "set-cookie": sessionCookie(result.token, ABSOLUTE_MS / 1000, d.secureCookie), ...SECURITY_HEADERS, "cache-control": "no-store" });
      return;
    }

    const token = cookie(req, COOKIE);
    const me = d.admins.session(token);
    if (!me) throw new HttpError(401, "not logged in");

    const ok = (body: unknown) => send(res, 200, body);
    const seg = path.split("/").slice(2);
    const route = `${method} /${seg[0] ?? ""}${seg.length > 1 ? "/:id" : ""}`;
    if (seg.length > 2) throw new HttpError(404, "no such route");
    const id = seg[1] ? decodeURIComponent(seg[1]) : "";

    switch (route) {
      case "POST /logout":
        d.admins.logout(token);
        audit(me.user, "logout", "");
        send(res, 200, { ok: true }, { "set-cookie": sessionCookie("", 0, d.secureCookie) });
        return;
      case "GET /me": return ok(me satisfies Me);
      case "GET /overview": return ok(await d.monitor.overview(q));
      case "GET /live": return ok(d.queries.live());
      case "GET /sessions": return ok(d.queries.sessions(q));
      case "GET /sessions/:id": return ok(d.queries.session(id));
      case "GET /retention": return ok(d.queries.retention(q));
      case "GET /geo": return ok(d.queries.geo(q));
      case "GET /gameplay": return ok(d.queries.gameplay(q));
      case "GET /perf": return ok(d.queries.perf(q));
      case "GET /errors": return ok(d.queries.errors(q));
      case "GET /errors/:id": return ok(d.queries.errorDetail(id));
      case "POST /errors/:id": {
        const body = (await readJson(req, MAX_ADMIN_BODY)) as { status?: unknown } | null;
        const group = d.queries.setErrorStatus(id, body?.status);
        audit(me.user, "error.status", `${id} -> ${group.status}`);
        return ok(group);
      }
      case "GET /health": return ok(await d.monitor.health());
      case "GET /logs": return ok(logs(d, q));
      case "GET /traffic": return ok(d.queries.traffic(q));
      case "GET /liveops": return ok(d.liveops.get());
      case "PUT /liveops": {
        const cfg = validateLiveConfig(await readJson(req, MAX_ADMIN_BODY));
        d.liveops.set(cfg);
        audit(me.user, "liveops.update", JSON.stringify(cfg));
        return ok(cfg);
      }
      case "GET /builds": return ok(d.queries.builds());
      case "GET /audit": return ok(d.queries.audit(q));
      default: {
        const known = ["logout", "me", "overview", "live", "sessions", "retention", "geo", "gameplay", "perf", "errors", "health", "logs", "traffic", "liveops", "builds", "audit"];
        throw new HttpError(known.includes(seg[0] ?? "") ? 405 : 404, known.includes(seg[0] ?? "") ? "method not allowed" : "no such route");
      }
    }
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    // The console exists only for the private network. A public client address, the
    // public host name or any Cloudflare header means a proxy was pointed here by
    // mistake: answer as if nothing lives here.
    const host = String(req.headers.host ?? "").toLowerCase();
    const viaCloudflare = Object.keys(req.headers).some((h) => h.startsWith("cf-"));
    if (host.includes("exiledcasual") || viaCloudflare || !isPrivateIp(clientIp(req))) {
      d.log.warn("admin refused non-private request", { host: host.slice(0, 80), cf: viaCloudflare });
      res.statusCode = 404;
      res.end();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://admin.local");
    } catch {
      refuse(res, 400, "bad url");
      return;
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      res.setHeader("cache-control", "no-store");
      try {
        await api(req, res, url);
      } catch (e) {
        if (e instanceof HttpError) refuse(res, e.status, e.message);
        else {
          d.log.error("admin request failed", { path: url.pathname, err: e instanceof Error ? e.message : String(e) });
          refuse(res, 500, "internal error");
        }
      }
      return;
    }
    try {
      serveStatic(d.staticDir, req, res, url.pathname);
    } catch (e) {
      d.log.error("static failed", { path: url.pathname, err: e instanceof Error ? e.message : String(e) });
      refuse(res, 500, "internal error");
    }
  };
}
