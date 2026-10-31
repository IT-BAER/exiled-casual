import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createApp, type App } from "./app";
import { tailAccessLog } from "./nginx";

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const dirs: string[] = [];
let app: App | undefined;

afterEach(() => {
  app?.close();
  app = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const line = (path: string, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0", status = 200, ip = "203.0.113.9") =>
  `${ip} - - [18/Oct/2026:11:00:00 +0000] "GET ${path} HTTP/1.1" ${status} 100 "-" "${ua}"\n`;

function logDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ec-nginx-"));
  dirs.push(d);
  return d;
}

describe("access log tail", () => {
  it("backfills gz + .1 + current on first start, then reads only new complete lines", () => {
    const d = logDir();
    writeFileSync(join(d, "access.log.3.gz"), gzipSync(line("/old3")));
    writeFileSync(join(d, "access.log.2.gz"), gzipSync(line("/old2")));
    writeFileSync(join(d, "access.log.1"), line("/old1"));
    writeFileSync(join(d, "access.log"), line("/cur1") + "203.0.113.9 - - [partial");
    const first = tailAccessLog(d, null);
    expect(first.lines.map((l) => l.split('"')[1])).toEqual(["GET /old3 HTTP/1.1", "GET /old2 HTTP/1.1", "GET /old1 HTTP/1.1", "GET /cur1 HTTP/1.1"]);
    appendFileSync(join(d, "access.log"), ` - - [18/Oct/2026:11:00:00 +0000] "GET /cur2 HTTP/1.1" 200 1 "-" "x"\n`);
    const second = tailAccessLog(d, first.state);
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]).toContain("/cur2");
    expect(tailAccessLog(d, second.state).lines).toEqual([]);
  });

  it("reads the rest of the rotated file, then the new one from the start", () => {
    const d = logDir();
    writeFileSync(join(d, "access.log"), line("/a"));
    const s1 = tailAccessLog(d, null);
    appendFileSync(join(d, "access.log"), line("/b"));
    renameSync(join(d, "access.log"), join(d, "access.log.1"));
    writeFileSync(join(d, "access.log"), line("/c"));
    const s2 = tailAccessLog(d, s1.state);
    expect(s2.lines.map((l) => l.split(" ")[6])).toEqual(["/b", "/c"]);
  });

  it("stores hits with the /24 only, flags bots, and feeds traffic and logs", async () => {
    const d = logDir();
    writeFileSync(join(d, "access.log"),
      line("/") + line("/") + line("/assets/x.js") + line("/.env") + line("/", "Googlebot/2.1", 200, "198.51.100.4") + line("/missing", undefined, 404));
    writeFileSync(join(d, "error.log"), "2026/10/18 11:00:00 [error] 12#12: *1 open() failed, client: 203.0.113.9, server: _\n");
    app = createApp({ db: ":memory:", now: () => T0, stdoutLog: false, nginxLogDir: d });
    app.jobs.tailLogs();
    app.jobs.tailLogs();
    const hits = app.db.prepare("SELECT path, ip_prefix, bot FROM hits ORDER BY id").all() as { path: string; ip_prefix: string; bot: number }[];
    expect(hits).toHaveLength(6);
    expect(hits.filter((h) => h.bot).map((h) => h.path)).toEqual(["/.env", "/"]);
    expect(JSON.stringify(app.db.prepare("SELECT * FROM hits").all())).not.toContain("203.0.113.9");
    app.jobs.hourly();
    const daily = app.db.prepare("SELECT * FROM daily WHERE day = '2026-10-18'").get();
    expect(daily).toMatchObject({ page_loads: 2, humans: 4, bots: 2, sessions: 0 });
  });
});
